import { describe, it, expect } from "vitest";
import { coalesce } from "../dev/coalesce.js";

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("coalesce", () => {
  it("never overlaps runs, and collapses calls made during one into a single rerun", async () => {
    const gates = [deferred(), deferred()];
    let runs = 0;
    let active = 0;
    let maxActive = 0;

    const run = coalesce(async () => {
      const gate = gates[runs++];
      active++;
      maxActive = Math.max(maxActive, active);
      await gate?.promise;
      active--;
    });

    const first = run();
    await Promise.all([run(), run(), run()]);
    expect(runs).toBe(1);

    gates.forEach((gate) => gate.resolve());
    await first;

    expect(runs).toBe(2);
    expect(maxActive).toBe(1);
  });

  it("runs again for a call made after the previous run finished", async () => {
    let runs = 0;
    const run = coalesce(async () => {
      runs++;
    });

    await run();
    await run();
    expect(runs).toBe(2);
  });

  it("recovers after a run throws", async () => {
    let runs = 0;
    const run = coalesce(async () => {
      runs++;
      if (runs === 1) throw new Error("boom");
    });

    await expect(run()).rejects.toThrow("boom");
    await run();
    expect(runs).toBe(2);
  });
});
