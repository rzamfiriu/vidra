import { PassThrough } from "node:stream";
import { describe, it, expect } from "vitest";
import {
  describeExit,
  exitedCleanly,
  forEachLine,
  sessionExitCode,
} from "../dev/processes.js";

const collectLines = (writes: (string | Buffer)[]): Promise<string[]> => {
  const stream = new PassThrough();
  const lines: string[] = [];
  forEachLine(stream, (line) => lines.push(line));
  const ended = new Promise<string[]>((resolve) => stream.on("end", () => resolve(lines)));
  writes.forEach((chunk) => stream.write(chunk));
  stream.end();
  return ended;
};

describe("forEachLine", () => {
  it("reassembles a line split across chunks", async () => {
    expect(await collectLines(["Build succ", "eeded.\nnext\n"])).toEqual([
      "Build succeeded.",
      "next",
    ]);
  });

  it("treats CRLF like LF", async () => {
    expect(await collectLines(["one\r", "\ntwo\r\n"])).toEqual(["one", "two"]);
  });

  it("flushes a final line with no newline", async () => {
    expect(await collectLines(["[vidra] host ready"])).toEqual(["[vidra] host ready"]);
  });

  it("does not corrupt a multi-byte character split across chunks", async () => {
    const bytes = Buffer.from("rebuilding…\n");
    const cut = bytes.length - 2;
    expect(await collectLines([bytes.subarray(0, cut), bytes.subarray(cut)])).toEqual([
      "rebuilding…",
    ]);
  });
});

describe("process exit helpers", () => {
  it("describes an exit by its signal, else its code", () => {
    expect(describeExit({ code: null, signal: "SIGKILL" })).toBe("signal SIGKILL");
    expect(describeExit({ code: 3, signal: null })).toBe("code 3");
  });

  it("counts only a zero (or absent) code with no signal as clean", () => {
    expect(exitedCleanly({ code: 0, signal: null })).toBe(true);
    expect(exitedCleanly({ code: 1, signal: null })).toBe(false);
    expect(exitedCleanly({ code: null, signal: "SIGTERM" })).toBe(false);
  });

  it("passes a child's exit code through, and fails a signalled one", () => {
    expect(sessionExitCode({ code: 2, signal: null })).toBe(2);
    expect(sessionExitCode({ code: null, signal: "SIGTERM" })).toBe(1);
    expect(sessionExitCode({ code: null, signal: null })).toBe(0);
  });
});
