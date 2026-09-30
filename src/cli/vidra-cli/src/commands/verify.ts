import path from "node:path";
import fs from "fs-extra";
import { parseArgs } from "@vidra-dev/cli-shared/utils";
import { detectPlatform, detectProject } from "../project.js";
import {
  assessGatekeeper,
  inspectMacHardening,
  REQUIRED_MAC_ENTITLEMENTS,
  verifyMacSignature,
} from "../signing.js";
import { verifyWindowsSignature } from "../windows-signing.js";
import {
  extractArchive,
  findAppBundle,
  findWindowsExecutableRecursive,
  mountDiskImage,
} from "../artifacts.js";
import {
  dim,
  footer,
  header,
  kv,
  row,
  STEP_LABEL_WIDTH as LABEL_WIDTH,
  value,
} from "@vidra-dev/cli-shared/theme";
import { verifyAndroidPackage } from "../targets/android.js";

/**
 * `vidra verify [artifact]` — inspect a built artifact and report whether it is
 * actually shippable.
 *
 * This exists so there is **one** implementation of every distribution check.
 * `vidra build` runs the same functions inline, and CI calls this command
 * instead of re-implementing `codesign`/`signtool` invocations in shell, which
 * previously duplicated the logic in three places.
 *
 * Gatekeeper's verdict is reported, never fatal: it is *expected* to reject a
 * build that isn't both Developer ID signed and notarized.
 */
export const verifyCommand = async (argv: string[]): Promise<void> => {
  const args = parseArgs(["_", "_", ...argv]);
  const explicit = (args._ as string[])[0];

  const artifact = explicit ?? discoverArtifact();
  if (!artifact) {
    console.error();
    console.error(
      row({
        glyph: "error",
        detail: dim("no artifact given and none found in dist/ — pass a path"),
      }),
    );
    process.exit(1);
  }
  if (!fs.existsSync(artifact)) {
    console.error();
    console.error(row({ glyph: "error", detail: dim(`not found: ${artifact}`) }));
    process.exit(1);
  }

  console.log();
  console.log(header("verify", path.basename(artifact)));
  console.log(kv("artifact", artifact));
  console.log();

  const kind = artifactKind(artifact);
  const failures =
    kind === "macos"
      ? verifyMacArtifact(artifact)
      : kind === "android"
        ? verifyAndroidArtifact(artifact)
        : verifyWindowsArtifact(artifact);

  console.log();
  if (failures.length > 0) {
    console.log(
      footer(dim(`${failures.length} check(s) failed: ${failures.join(", ")}`)),
    );
    console.log();
    process.exit(1);
  }
  console.log(footer(dim("all checks passed")));
  console.log();
};

/**
 * Which platform's checks an artifact wants.
 *
 * Extension first, and `.app` explicitly: a `.app` bundle is a *directory*, so
 * any "is it a directory?" test claims it for the Windows path and then fails
 * looking for an `.exe` inside a macOS bundle. Only a directory that isn't a
 * `.app` — a Windows publish folder — falls through.
 */
export const artifactKind = (artifact: string): "macos" | "windows" | "android" => {
  if (artifact.endsWith(".dmg") || artifact.endsWith(".app")) return "macos";
  if (artifact.endsWith(".apk") || artifact.endsWith(".aab")) return "android";
  return "windows";
};

const verifyAndroidArtifact = (artifact: string): string[] => {
  const result = verifyAndroidPackage(artifact);
  report(
    result.ok,
    "android signature",
    result.ok
      ? `${result.tool} verification passed`
      : `${result.tool} verification failed`,
    result.output,
  );
  return result.ok ? [] : ["android signature"];
};

const verifyMacArtifact = (artifact: string): string[] => {
  const failures: string[] = [];
  let appBundle = artifact;
  let mounted: { release: () => void } | null = null;

  if (artifact.endsWith(".dmg")) {
    const dmgSig = verifyMacSignature(artifact);
    report(dmgSig.ok, "dmg signature", dmgSig.ok ? "signed" : "not signed", dmgSig.output);
    if (!dmgSig.ok) failures.push("dmg signature");

    const image = mountDiskImage(artifact);
    mounted = image;
    const inner = findAppBundle(image.mountPoint);
    if (!inner) {
      image.release();
      report(false, "app bundle", "no .app inside the disk image");
      return [...failures, "app bundle"];
    }
    appBundle = inner;
  }

  try {
    const sig = verifyMacSignature(appBundle);
    report(sig.ok, "signature", sig.ok ? "codesign --verify --strict passed" : "FAILED", sig.output);
    if (!sig.ok) failures.push("signature");

    const hardening = inspectMacHardening(appBundle);
    report(
      hardening.hardened,
      "hardened runtime",
      hardening.hardened ? "enabled" : "NOT enabled — cannot be notarized",
    );
    if (!hardening.hardened) failures.push("hardened runtime");

    const entitlementsOk = hardening.missing.length === 0;
    report(
      entitlementsOk,
      "entitlements",
      entitlementsOk
        ? `${REQUIRED_MAC_ENTITLEMENTS.length} required present`
        : `missing: ${hardening.missing.join(", ")} — the .NET JIT will be killed at launch`,
    );
    if (!entitlementsOk) failures.push("entitlements");

    // Informational: expected to reject until Developer ID + notarization.
    const assessment = assessGatekeeper(artifact);
    console.log(
      row({
        glyph: assessment.ok ? "done" : "manual",
        label: "gatekeeper",
        labelWidth: LABEL_WIDTH,
        detail: dim(
          assessment.ok
            ? "spctl accepted — this opens on other Macs"
            : "spctl rejected — needs Developer ID + notarization (expected otherwise)",
        ),
      }),
    );
  } finally {
    mounted?.release();
  }

  return failures;
};

const verifyWindowsArtifact = (artifact: string): string[] => {
  const failures: string[] = [];

  // The shipped Windows artifact is a zip and a zip carries no signature of its
  // own — the signature is on the `.exe` inside, so unpack before looking.
  let extracted: { release: () => void } | null = null;
  let searchRoot = artifact;
  if (artifact.endsWith(".zip")) {
    try {
      const archive = extractArchive(artifact);
      extracted = archive;
      searchRoot = archive.dir;
    } catch (error) {
      report(false, "archive", `could not open ${path.basename(artifact)}`, String(error));
      return ["archive"];
    }
  }

  try {
    const exe = artifact.endsWith(".exe")
      ? artifact
      : findWindowsExecutableRecursive(searchRoot);

    if (!exe) {
      report(false, "executable", `no .exe found under ${artifact}`);
      return ["executable"];
    }
    console.log(kv("executable", path.basename(exe)));

    const sig = verifyWindowsSignature(exe);
    report(
      sig.ok,
      "authenticode",
      sig.untrustedRoot
        ? "signed and intact; chain not trusted (expected for a self-signed certificate)"
        : sig.ok
          ? "signature verified and trusted"
          : "not signed or not verifiable",
      sig.output,
    );
    if (!sig.ok) failures.push("authenticode");
  } finally {
    extracted?.release();
  }

  return failures;
};

const report = (
  ok: boolean,
  label: string,
  detail: string,
  output?: string,
): void => {
  console.log(
    row({
      glyph: ok ? "done" : "error",
      label,
      labelWidth: LABEL_WIDTH,
      detail: dim(detail),
    }),
  );
  if (!ok && output) console.error(dim(output.trim()));
};

/** Newest artifact in the project's dist/, so `vidra verify` usually needs no argument. */
const discoverArtifact = (): string | null => {
  const project = detectProject(process.cwd());
  const dist = path.join(project.root, "dist");
  if (!fs.existsSync(dist)) return null;

  const platform = detectPlatform();
  const wanted =
    platform === "windows"
      ? [".zip"]
      : platform === "android"
        ? [".aab", ".apk"]
        : [".dmg"];
  const candidates = fs
    .readdirSync(dist)
    .filter((file) => wanted.some((extension) => file.endsWith(extension)))
    .map((f) => path.join(dist, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  return candidates[0] ?? null;
};
