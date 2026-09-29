import type { CommandSpec } from "../help.js";

/**
 * What every command accepts, in one place.
 *
 * Kept apart from the commands themselves so `vidra --help`, `vidra <cmd>
 * --help` and unknown-flag rejection all read the same declaration, and so a
 * flag cannot be added to a command without becoming documented.
 */
export const DEV: CommandSpec = {
  name: "dev",
  summary: "start vite + the native host (UI and C# reload on save)",
  usage: "dev [--target <os>] [--no-hot-reload]",
  flags: [
    { name: "--target", arg: "os", describe: "macos, windows, or android (default: this machine)" },
    { name: "--no-hot-reload", describe: "skip dotnet watch, build and launch once" },
    { name: "--port", arg: "n", describe: "vite port (default: 5173, or the next free one)" },
    { name: "--verbose", describe: "stream the full build output" },
  ],
  examples: [
    { args: "dev", describe: "the usual loop" },
    { args: "dev --target windows", describe: "run the windows host" },
  ],
};

export const RUN: CommandSpec = {
  name: "run",
  summary: "launch the native host only",
  usage: "run [--target <os>]",
  flags: [
    { name: "--target", arg: "os", describe: "macos, windows, or android (default: this machine)" },
    { name: "--verbose", describe: "stream the full build output" },
  ],
};

export const BUILD: CommandSpec = {
  name: "build",
  summary: "build the app, and publish whatever vidra.config.ts configures",
  usage: "build [--app|--web] [--channel <name>] [--target <os>] [--plan]",
  flags: [
    { name: "--app", describe: "the installable app and its release, no web bundle" },
    { name: "--web", describe: "the web bundle only, no compile and no platform" },
    { name: "--channel", arg: "name", describe: "publish to a ring (env: VIDRA_CHANNEL)" },
    { name: "--target", arg: "os", describe: "macos, windows, or android (default: this machine)" },
    { name: "--sign", arg: "key.pem", describe: "sign the web feed (env: VIDRA_UPDATE_SIGNING_KEY)" },
    { name: "--plan", describe: "print every step and artifact, run nothing" },
    { name: "--dry-run", describe: "alias for --plan" },
    { name: "--verbose", describe: "stream the full build output" },
  ],
  examples: [
    { args: "build", describe: "everything this app is configured for" },
    { args: "build --web", describe: "ship a UI fix without compiling" },
    { args: "build --app --channel beta", describe: "an installer for the beta ring" },
    { args: "build --plan", describe: "preview it, run nothing" },
  ],
};

export const UPDATES: CommandSpec = {
  name: "updates",
  summary: "turn updates on by giving them a feed URL",
  usage: "updates [init] [--feed <url>] [--web <url>] [--app <url>] [--keygen]",
  flags: [
    { name: "--feed", arg: "url", describe: "one destination for both tiers" },
    { name: "--web", arg: "url", describe: "web bundles here instead" },
    { name: "--app", arg: "url", describe: "whole-app releases here instead" },
    { name: "--keygen", describe: "also make a signing key and trust it" },
    { name: "--force", describe: "move a feed installed apps are already checking" },
  ],
  examples: [
    { args: "updates", describe: "which tiers are on, and where they point" },
    { args: "updates init --feed https://updates.acme.com/notes/", describe: "turn both on" },
    { args: "updates init --web https://cdn/ --app https://dl/", describe: "split them" },
  ],
};

export const KEYGEN: CommandSpec = {
  name: "keygen",
  summary: "create the key that signs your update feed",
  usage: "keygen [--out <key.pem>] [--force]",
  flags: [
    { name: "--out", arg: "key.pem", describe: "where to write it (default: vidra-signing-key.pem)" },
    { name: "--force", describe: "overwrite an existing key — strands every install that trusts it" },
  ],
};

export const VERIFY: CommandSpec = {
  name: "verify",
  summary: "check a built artifact is actually shippable",
  usage: "verify [<artifact>]",
};

export const DOCTOR: CommandSpec = {
  name: "doctor",
  summary: "check your environment, and this project's update wiring",
  usage: "doctor [--target <os>]",
  flags: [
    { name: "--target", arg: "os", describe: "macos, windows, or android (default: this machine)" },
  ],
};

/** The order `vidra --help` lists them in: daily loop first, release second. */
export const ALL: CommandSpec[] = [DEV, RUN, BUILD, UPDATES, KEYGEN, VERIFY, DOCTOR];
