import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";
const POLL_INTERVAL_MS = 500;
const PROBE_TIMEOUT_MS = 1_000;

export const buildViteArgs = (
  devUrl: string,
  exposeNetwork = false,
): string[] => [
  "run",
  "dev",
  "--",
  "--port",
  new URL(devUrl).port,
  "--strictPort",
  ...(exposeNetwork ? ["--host", "0.0.0.0"] : []),
];

/**
 * Starts `npm run dev` in the UI directory. `exposeNetwork` makes Vite listen
 * on every interface, for devices that reach it over the LAN.
 */
export const spawnVite = (
  devUrl: string,
  uiDir: string,
  exposeNetwork: boolean,
): ChildProcess =>
  spawn(NPM_COMMAND, buildViteArgs(devUrl, exposeNetwork), {
    cwd: uiDir,
    stdio: ["ignore", "pipe", "pipe"],
    // `npm` on Windows is a `.cmd` shim, and since the fix for CVE-2024-27980
    // Node refuses to `spawn` `.cmd`/`.bat` files directly (it throws
    // `spawn EINVAL`) unless they're run through a shell. `taskkill /T` in
    // killChild already tears down the wrapping cmd.exe and its children.
    shell: process.platform === "win32",
  });

/** Resolves true once anything answers a HEAD request at `url`. */
const probe = (url: URL): Promise<boolean> =>
  new Promise((resolve) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "HEAD",
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });

/** Polls `url` until it answers; rejects after `timeoutMs`. */
export const waitForServer = async (url: string, timeoutMs: number): Promise<void> => {
  const target = new URL(url);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (await probe(target)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${url} after ${timeoutMs}ms`);
};
