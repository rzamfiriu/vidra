import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it, expect } from "vitest";
import { buildViteArgs, waitForServer } from "../dev/vite.js";

describe("buildViteArgs", () => {
  it("starts Vite on the port selected for the native host", () => {
    expect(buildViteArgs("http://localhost:6000/")).toEqual([
      "run",
      "dev",
      "--",
      "--port",
      "6000",
      "--strictPort",
    ]);
  });

  it("exposes Vite to the LAN only for Android fallback networking", () => {
    expect(buildViteArgs("http://localhost:6000/", true)).toContain("0.0.0.0");
    expect(buildViteArgs("http://localhost:6000/")).not.toContain("--host");
  });
});

describe("waitForServer", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  const listen = (): Promise<string> =>
    new Promise((resolve) => {
      server = createServer((_req, res) => res.end()).listen(0, "127.0.0.1", () => {
        resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/`);
      });
    });

  it("resolves once the server answers", async () => {
    await expect(waitForServer(await listen(), 2_000)).resolves.toBeUndefined();
  });

  it("rejects when nothing answers before the timeout", async () => {
    const url = await listen();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;

    await expect(waitForServer(url, 200)).rejects.toThrow(/Timed out waiting for/);
  });
});
