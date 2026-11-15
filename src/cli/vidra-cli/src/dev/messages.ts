import path from "node:path";
import {
  dim,
  footer,
  header,
  kv,
  lime,
  taggedRow,
  value,
  type GlyphName,
} from "@vidra-dev/cli-shared/theme";
import type { WatchStrategy } from "./dotnet-watch.js";
import type { DevCommand, DevTarget } from "./options.js";

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A `[host]` status line with dimmed text. */
export const hostStatus = (glyph: GlyphName, text: string): void => {
  console.log(taggedRow(glyph, "host", dim(text)));
};

/** How C# edits reach the app, in words the user can trust. */
export const csharpLoopLabel = (strategy: WatchStrategy): string =>
  strategy === "rebuild" ? "C# rebuild + relaunch" : "C# hot reload active";

/** The same, phrased for "on save" lines. */
export const csharpLoopSuffix = (strategy: WatchStrategy): string =>
  strategy === "rebuild" ? "C# rebuild + relaunch on save" : "hot reload on save";

/** `csharpLoop` is null when no C# loop is running. */
export const hostReadyText = (
  projectName: string,
  csharpLoop: WatchStrategy | null,
): string => {
  const loop = csharpLoop ? ` ${dim(`· ${csharpLoopSuffix(csharpLoop)}`)}` : "";
  return `${dim("host ready —")} ${value(projectName)}${loop}`;
};

export const printSessionHeader = (
  command: DevCommand,
  target: DevTarget,
  projectName: string,
): void => {
  console.log();
  console.log(header(command, target.name));
  console.log(kv("project", projectName));
  console.log(kv("target", target.framework));
  console.log();
};

export interface LoopBannerOptions {
  readonly vite: boolean;
  readonly hostDir: string;
  /** Null when no C# loop is running (`vidra run`, `--no-hot-reload`). */
  readonly csharpLoop: WatchStrategy | null;
}

/** What to edit and what reacts to it, printed once everything has started. */
export const printLoopBanner = ({ vite, hostDir, csharpLoop }: LoopBannerOptions): void => {
  if (!vite) {
    console.log();
    console.log(footer(dim("host only · serve the UI separately · ctrl-c to stop")));
    console.log();
    return;
  }

  // UI edits always hot reload; the headline only stops saying so when the C#
  // half of the loop cannot.
  const headline = lime(csharpLoop === "rebuild" ? "reload on save active" : "hot reload active");
  const hostDirLabel = `src/${path.basename(hostDir)}`;
  const editHint = csharpLoop
    ? `— edit ui/src or ${hostDirLabel} and save`
    : "— edit ui/src and save";
  const watched = csharpLoop
    ? `${value("ui/")} ${dim("·")} ${value(`${hostDirLabel}/`)} ${dim(`· ${csharpLoopSuffix(csharpLoop)} · ctrl-c to stop`)}`
    : `${value("ui/")} ${dim("· hot reload on save · ctrl-c to stop")}`;

  console.log(taggedRow("active", null, `${headline} ${dim(editHint)}`));
  console.log();
  console.log(footer(`${dim("watching")} ${watched}`));
  console.log();
};
