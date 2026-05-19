#!/usr/bin/env node
// Cross-platform echo-ping smoke: spawn the C# smoke harness, send a
// BridgeRequest for the `echo.ping` method over stdio, and assert the
// BridgeResponse round-trips correctly.
//
// Used by the windows-latest and macos-latest smoke jobs to prove the
// real C# bridge wire format works on each OS end-to-end.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const projectPath =
  process.env.VIDRA_SMOKE_PROJECT ??
  resolve(
    repoRoot,
    "tests",
    "dotnet",
    "Vidra.Bridge.Smoke",
    "Vidra.Bridge.Smoke.csproj",
  );

const args = [
  "run",
  "--no-build",
  "--project",
  projectPath,
  "-c",
  process.env.VIDRA_SMOKE_CONFIG ?? "Release",
];

const child = spawn("dotnet", args, {
  stdio: ["pipe", "pipe", "inherit"],
});

child.on("error", (err) => {
  console.error("[smoke] failed to spawn dotnet:", err.message);
  process.exit(2);
});

const rl = createInterface({ input: child.stdout });

const responses = [];
rl.on("line", (line) => responses.push(line));

function send(request) {
  child.stdin.write(JSON.stringify(request) + "\n");
}

async function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for smoke response.`);
}

try {
  send({
    id: "smoke-1",
    module: "echo",
    method: "ping",
    payload: { text: "hello, vidra" },
  });

  await waitFor(() => responses.length >= 1, 60_000);

  const parsed = JSON.parse(responses[0]);
  if (parsed.id !== "smoke-1")
    throw new Error(`expected id=smoke-1, got id=${parsed.id}`);
  if (parsed.success !== true)
    throw new Error(`expected success=true, got ${JSON.stringify(parsed)}`);
  if (parsed.data?.text !== "hello, vidra")
    throw new Error(
      `expected data.text='hello, vidra', got ${JSON.stringify(parsed.data)}`,
    );
  if (parsed.data?.length !== "hello, vidra".length)
    throw new Error(
      `expected data.length=12, got ${JSON.stringify(parsed.data)}`,
    );

  send({
    id: "smoke-2",
    module: "ghost",
    method: "ping",
    payload: {},
  });

  await waitFor(() => responses.length >= 2, 60_000);
  const err = JSON.parse(responses[1]);
  if (err.success !== false || err.error?.code !== "MODULE_NOT_FOUND")
    throw new Error(
      `expected MODULE_NOT_FOUND error, got ${JSON.stringify(err)}`,
    );

  console.log("[smoke] echo-ping passed:", responses[0]);
} finally {
  child.stdin.end();
  await once(child, "exit");
}
