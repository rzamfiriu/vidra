import chalk, { type ChalkInstance } from "chalk";

/**
 * Shared terminal styling for the vidra CLI: one visual language across every
 * command — a status glyph in the gutter, muted connective words, and bright
 * key values.
 *
 * chalk auto-downsamples these truecolor hexes on terminals that lack 24-bit
 * color and disables them entirely under NO_COLOR / non-TTY, so call sites can
 * use the palette unconditionally.
 */

export const CLI_VERSION = "0.3.0";

/** Shared width of the bright label column in step/check rows, for alignment. */
export const STEP_LABEL_WIDTH = 16;

// --- Palette -----------------------------------------------------------------

export const lime = chalk.hex("#c8f751"); // the vidra color — wordmark, active
export const value = chalk.hex("#e8e8ec"); // bright key values
export const dim = chalk.hex("#7a7a86"); // muted connective words
export const amber = chalk.hex("#ffcf5c"); // manual / fix / plan badge
const green = chalk.hex("#86d98f"); // done
const red = chalk.hex("#ff8585"); // error
const slate = chalk.hex("#a9b0bd"); // plan / skipped
const uiColor = chalk.hex("#6fd3e0"); // [ui] module tag
const hostColor = chalk.hex("#a48ce8"); // [host] module tag

// --- Status glyphs (the gutter language) -------------------------------------

export type GlyphName =
  | "done" // ✓ a step completed · a check passed
  | "active" // ▸ the step happening now · next up
  | "error" // ✗ missing requirement · failed step
  | "manual" // ? needs a human · could not verify
  | "plan" // ◆ planned · being-built · informational
  | "skip"; // ⊘ deliberately not run on this target

const GLYPH_CHAR: Record<GlyphName, string> = {
  done: "\u2713",
  active: "\u25b8",
  error: "\u2717",
  manual: "?",
  plan: "\u25c6",
  skip: "\u2298",
};

const GLYPH_COLOR: Record<GlyphName, ChalkInstance> = {
  done: green,
  active: lime,
  error: red,
  manual: amber,
  plan: slate,
  skip: slate,
};

/** A colored status glyph for the gutter. */
export const glyph = (name: GlyphName): string =>
  GLYPH_COLOR[name](GLYPH_CHAR[name]);

// --- Module tags ([ui] / [host]) ---------------------------------------------

export type TagName = "ui" | "host";
const TAG_COLOR: Record<TagName, ChalkInstance> = {
  ui: uiColor,
  host: hostColor,
};
// Width of the padded tag column ("[host] " is the widest tag).
const TAG_WIDTH = 6;

/** A colored, fixed-width module tag, e.g. cyan `[ui]` or purple `[host]`. */
export const tag = (name: TagName): string =>
  TAG_COLOR[name](`[${name}]`.padEnd(TAG_WIDTH));

/** Blank space the width of a tag, to keep tagless rows aligned under tagged ones. */
const blankTag = (): string => " ".repeat(TAG_WIDTH);

// --- Composition primitives --------------------------------------------------

/** The vidra wordmark, always lime. */
export const wordmark = (): string => lime("vidra");

/** `vidra <sub>` with an optional dim "— context" suffix. */
export const header = (sub: string, context?: string): string => {
  const base = `  ${wordmark()} ${value(sub)}`;
  return context ? `${base} ${dim(`\u2014 ${context}`)}` : base;
};

/** A dim "label   value" context line (no status glyph). */
export const kv = (label: string, val: string, width = 9): string =>
  `  ${dim(label.padEnd(width))} ${value(val)}`;

/**
 * A gutter row: glyph, an optional fixed-width bright label, and a pre-colored
 * detail. The plain label is padded *before* coloring so embedded ANSI codes
 * never skew column alignment.
 */
export const row = (opts: {
  glyph: GlyphName;
  label?: string;
  labelWidth?: number;
  detail?: string;
}): string => {
  const parts = [`  ${glyph(opts.glyph)}`];
  if (opts.label !== undefined) {
    const padded = opts.labelWidth
      ? opts.label.padEnd(opts.labelWidth)
      : opts.label;
    parts.push(value(padded));
  }
  if (opts.detail) parts.push(opts.detail);
  return parts.join(" ");
};

/** A streaming/status line: glyph, a module tag (or aligned blank), then text. */
export const taggedRow = (
  glyphName: GlyphName,
  tagName: TagName | null,
  text: string,
): string =>
  `  ${glyph(glyphName)} ${tagName ? tag(tagName) : blankTag()} ${text}`;

/** Prefix for raw child-process output passed through to the user. */
export const streamPrefix = (tagName: TagName): string =>
  `  ${dim("\u00b7")} ${tag(tagName)}`;

/** A dim footer line. Pass pre-colored content for embedded values/wordmark. */
export const footer = (content: string): string => `  ${content}`;

/** An indented `fix:` hint — amber label, lime command. */
export const fixLine = (cmd: string, label = "fix:"): string =>
  `      ${amber(label)} ${lime(cmd)}`;

/** The amber "being built" badge used by plan steps. */
export const planBadge = (text = "PLAN ONLY \u00b7 BEING BUILT"): string =>
  amber(`[ ${text} ]`);
