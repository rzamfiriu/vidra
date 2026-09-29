import path from "node:path";
import { parseArgs } from "@vidra-dev/cli-shared/utils";
import { detectProject } from "../project.js";
import {
  resolveFeeds,
  type FeedSplit,
  type UpdateConfig,
} from "../update-config.js";
import { loadVidraConfig, writeVidraUpdateConfig } from "../config.js";
import { FeedUriError } from "../feed-uri.js";
import { writeSigningKeyPair } from "./keygen.js";
import { resolveVpk } from "../velopack.js";
import { rejectUnknownFlags } from "../help.js";
import { UPDATES } from "./specs.js";
import {
  amber,
  dim,
  footer,
  header,
  lime,
  row,
  STEP_LABEL_WIDTH as LABEL_WIDTH,
  value,
} from "@vidra-dev/cli-shared/theme";

/**
 * `vidra updates` — reading and writing the only switch there is.
 *
 * Every scaffolded app already carries the whole updater *and* a blank `feed`
 * field in `vidra.config.ts`. Typing a URL in is the entire opt-in, so this
 * command is a convenience rather than a gate: `init` writes the same field a
 * hand-edit would, and `vidra updates` reads back what that left on.
 */
export const updatesCommand = async (argv: string[]): Promise<void> => {
  const args = parseArgs(["_", "_", ...argv]);
  if (rejectUnknownFlags(UPDATES, args)) return process.exit(1);

  const sub = (args._ as string[])[0] ?? "status";

  switch (sub) {
    case "status":
      await printStatus();
      break;
    case "init":
      await initUpdates(args);
      break;
    default:
      console.error(
        row({ glyph: "error", detail: dim(`unknown subcommand: vidra updates ${sub}`) }),
      );
      console.error(footer(dim("try: vidra updates · vidra updates init --feed <url>")));
      process.exit(1);
  }
};

const initUpdates = async (args: ReturnType<typeof parseArgs>): Promise<void> => {
  const project = detectProject(process.cwd());
  const existing = (await loadVidraConfig(project.root, configContext())).updates;
  const force = !!args.force;

  const feed = typeof args.feed === "string" ? args.feed.trim() : null;
  const web = typeof args.web === "string" ? args.web.trim() : null;
  const app = typeof args.app === "string" ? args.app.trim() : null;

  if (!feed && !web && !app && !args.keygen) {
    console.error(row({ glyph: "error", detail: dim("nothing to configure") }));
    console.error(
      footer(
        dim(
          `pass a feed: ${lime("vidra updates init --feed")} ${value("https://updates.example.com/notes/")}`,
        ),
      ),
    );
    return process.exit(1);
  }

  // `--feed` is one destination for both tiers, which is the common case and the
  // shape that keeps everything in one directory. `--web` / `--app` split them,
  // for when the app packages are big enough to want their own bucket.
  const next: string | FeedSplit | undefined = feed
    ? feed
    : web || app
      ? { ...(web ? { web } : {}), ...(app ? { app } : {}) }
      : existing?.feed;

  // Refusing to silently repoint a live feed is the same rule as `keygen`: apps
  // already installed are looking at the old URL, and nothing about that is
  // recoverable from the terminal afterwards.
  if (existing?.feed && next && !force && JSON.stringify(existing.feed) !== JSON.stringify(next)) {
    console.error(
      row({
        glyph: "error",
        label: "already set",
        labelWidth: LABEL_WIDTH,
        detail: dim(
          "updates.feed already points somewhere else — installed apps are checking that URL",
        ),
      }),
    );
    console.error(footer(dim("pass --force if you mean to move the feed")));
    return process.exit(1);
  }

  console.log(header("updates", "init"));

  let written: UpdateConfig = {
    ...existing,
    ...(next ? { feed: next } : {}),
    ...(!next && !existing && args.keygen ? { feed: "" } : {}),
  };
  writeVidraUpdateConfig(project.root, written);

  let feeds;
  try {
    feeds = resolveFeeds(written);
  } catch (error) {
    if (!(error instanceof FeedUriError)) throw error;
    console.error(row({ glyph: "error", label: "feed", labelWidth: LABEL_WIDTH, detail: dim(error.message) }));
    return process.exit(1);
  }

  feedRow("web bundle", feeds.web?.base ?? null, "npx vidra build --web publishes here");
  feedRow("whole app", feeds.app?.base ?? null, "npx vidra build packs a release here");

  if (args.keygen) {
    const publicKey = signWithNewKey(project.root, force);
    if (publicKey) {
      written = {
        ...written,
        publicKeys: [
          ...(written.publicKeys ?? []).filter((key) => key !== publicKey),
          publicKey,
        ],
      };
      writeVidraUpdateConfig(project.root, written);
    }
  }

  console.log(
    row({
      glyph: "done",
      label: "vidra.config.ts",
      labelWidth: LABEL_WIDTH,
      detail: dim("written — the app already carries the updater, so that is the whole setup"),
    }),
  );

  if (feeds.app && !resolveVpk()) {
    console.log(
      row({
        glyph: "manual",
        label: "vpk",
        labelWidth: LABEL_WIDTH,
        detail: amber("not installed — `dotnet tool install -g vpk` before the next build"),
      }),
    );
  }

  if (!args.keygen && !(written?.publicKeys?.length ?? 0)) {
    console.log(
      row({
        glyph: "manual",
        label: "signing",
        labelWidth: LABEL_WIDTH,
        detail: dim("this feed is unsigned — anyone who can write to it can run code in your app"),
      }),
    );
    console.log(footer(dim(`sign it: ${lime("npx vidra updates init --keygen")}`)));
  }

  console.log();
  console.log(footer(dim(`next: ${lime("npm version patch")} ${dim("then")} ${lime("npx vidra build")}`)));
  console.log();
};

/** Generates a key, wires the public half, and says where the private half went. */
const signWithNewKey = (projectRoot: string, force: boolean): string | null => {
  const out = path.join(projectRoot, "vidra-signing-key.pem");
  const key = writeSigningKeyPair(out, force);

  if (!key) {
    console.log(
      row({
        glyph: "skip",
        label: "signing key",
        labelWidth: LABEL_WIDTH,
        detail: dim("vidra-signing-key.pem already exists — kept, and left trusted as it is"),
      }),
    );
    return null;
  }

  console.log(
    row({
      glyph: "done",
      label: "signing key",
      labelWidth: LABEL_WIDTH,
      detail: `${value("vidra-signing-key.pem")} ${dim(`(key ${key.keyId}) — trusted in vidra.config.ts`)}`,
    }),
  );
  console.log(
    row({
      glyph: "manual",
      label: "keep it safe",
      labelWidth: LABEL_WIDTH,
      detail: amber("never commit it — it is the authority to run code in every installed copy"),
    }),
  );
  return key.publicKey;
};

const printStatus = async (): Promise<void> => {
  const project = detectProject(process.cwd());
  const config = (await loadVidraConfig(project.root, configContext())).updates;

  console.log(header("updates", project.projectName));

  let feeds;
  try {
    feeds = resolveFeeds(config);
  } catch (error) {
    if (!(error instanceof FeedUriError)) throw error;
    console.log(row({ glyph: "error", label: "feed", labelWidth: LABEL_WIDTH, detail: dim(error.message) }));
    console.log();
    return;
  }

  feedRow("web bundle", feeds.web?.base ?? null, "updates.feed is empty");
  feedRow("whole app", feeds.app?.base ?? null, "updates.feed is empty");

  const keys = config?.publicKeys?.length ?? 0;
  console.log(
    row({
      glyph: keys > 0 ? "done" : "manual",
      label: "signing",
      labelWidth: LABEL_WIDTH,
      detail:
        keys > 0
          ? dim(`${keys} trusted key${keys === 1 ? "" : "s"} — an unsigned feed is refused`)
          : dim("no trusted keys — this app accepts an unsigned feed"),
    }),
  );

  console.log();
  if (!feeds.web && !feeds.app) {
    console.log(
      footer(
        dim(
          `the field is in vidra.config.ts waiting for a URL — fill it in, or: ${lime("npx vidra updates init --feed <url>")}`,
        ),
      ),
    );
  } else {
    console.log(
      footer(
        dim(
          `resolved at build time and stamped into the app; a ${value("--channel")} adds a path segment`,
        ),
      ),
    );
  }
  console.log();
};

const configContext = () => ({
  command: "updates" as const,
  mode: "production" as const,
  target: process.platform === "darwin"
    ? "macos" as const
    : process.platform === "win32"
      ? "windows" as const
      : "android" as const,
});

const feedRow = (label: string, base: string | null, off: string): void => {
  console.log(
    row({
      glyph: base ? "done" : "skip",
      label,
      labelWidth: LABEL_WIDTH,
      detail: base ? value(base) : dim(`off — ${off}`),
    }),
  );
};
