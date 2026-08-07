// End-to-end proof for over-the-air bundle updates (macOS + Windows).
//
// Serves a real feed over HTTP and launches the packaged app repeatedly, because
// every interesting property of an update system is a property of a *sequence*
// of launches: an update applies on the next one, a rejected bundle never
// applies at all, and a bundle that cannot boot has to be undone after failing
// twice. Each launch writes a JSON proof (tests/smoke/ota-main-page.cs.in) saying
// what actually served — read out of the loaded page, not from a log line.
//
// Claims, one per phase:
//   staged     a newer compatible bundle is downloaded but does NOT hot-swap
//   promoted   the next launch serves it, and the bridge still works
//   mismatch   a bundle for a different contract is refused, however new
//   corrupt    a bundle whose sha256 does not match is refused
//   rollback   a bundle that never boots is undone after two attempts
//   tampered   a manifest edited after signing is refused
//   unsigned   a feed that drops its signature is refused
//
// Usage:
//   node ota-e2e.mjs --bin <app binary> --project <scaffold root> --cli <cli.js>
//                    --work <scratch dir> [--port 8099]

import { spawn, spawnSync } from "node:child_process";
import crypto, { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const bin = required("bin");
const project = required("project");
const cli = required("cli");
const work = required("work");
const port = Number(args.port ?? 8099);
const signingKey = args["signing-key"] ?? null;
const feed = path.join(work, "feed");

// How long a local static server gets to start listening.
//
// This was 40 attempts of 250ms, which is a budget of ten seconds when the probe
// fails fast and fifty when it does not, depending on whether the OS refuses the
// connection or lets it hang. On a cold Windows runner ten seconds is not enough
// and the suite fails on a server that was about to come up, which is a red
// release gate for no defect. A deadline says what the budget actually is.
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 250;

const MARKER = "ota-bundle-1-3-0";
let failures = 0;
let server;
let goodArchive;
let fingerprints;

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(feed, { recursive: true });

try {
  // The server first, then the publish. Publishing merges from the live index
  // and a *refused connection* is a hard failure by design: it cannot be told
  // apart from a reachable feed that is temporarily broken, and quietly
  // publishing an index containing only the newest entry would strand every
  // install that can only run an older one. A 404 is different, and is the
  // ordinary first publish.
  server = serveFeed();
  await waitForServer();
  publishGoodBundle();
  await waitForFeed();

  // ---- staged: the update is downloaded, and does not take effect yet --------
  // The first launch gets a longer window and one retry: the app's first HTTP
  // request of the run has been seen to take longer than every later one, and a
  // check that has not come back yet is not the same claim as a check that
  // refused something.
  let staged = launch("staged", { timeout: 90 });
  if (staged.pendingVersion === null) {
    console.log("==> the first check did not come back in time; retrying once");
    staged = launch("staged-retry", { timeout: 90 });
  }
  expect(staged.marker, "undefined", "the embedded bundle carries no marker");
  expect(staged.pendingVersion, "1.3.0", "bundle staged for the next launch");
  expect(staged.currentVersion, null, "nothing promoted mid-session");
  expectBridge(staged);

  // ---- promoted: the next launch serves it ---------------------------------
  const promoted = launch("promoted");
  expect(promoted.marker, MARKER, "the updated bundle served");
  expect(promoted.currentVersion, "1.3.0", "current version");
  expectBridge(promoted, "the bridge still works from an updated bundle");

  // ---- mismatch: newer, but built against a different contract --------------
  addEntry({
    version: "1.4.0",
    url: goodArchive.name,
    sha256: goodArchive.sha256,
    size: goodArchive.size,
    coreFingerprint: "0".repeat(64),
    appFingerprint: fingerprints.app,
  });
  const mismatch = launch("mismatch");
  expect(mismatch.pendingVersion, null, "a bundle for another core contract is refused");
  expect(mismatch.marker, MARKER, "still serving the last good bundle");

  // ---- corrupt: the manifest's hash does not describe the archive -----------
  addEntry({
    version: "1.5.0",
    url: goodArchive.name,
    sha256: "b".repeat(64),
    size: goodArchive.size,
    coreFingerprint: fingerprints.core,
    appFingerprint: fingerprints.app,
  });
  const corrupt = launch("corrupt");
  expect(corrupt.pendingVersion, null, "a bundle whose sha256 does not match is refused");
  expect(corrupt.marker, MARKER, "still serving the last good bundle");

  // ---- rollback: a bundle that cannot boot is undone ------------------------
  const broken = publishBrokenBundle("1.6.0");
  addEntry(broken);

  const stagedBroken = launch("rollback-download");
  expect(stagedBroken.pendingVersion, "1.6.0", "the broken bundle is staged like any other");

  // It is only "broken" at runtime — nothing about it is detectable before it
  // runs, which is exactly why probation exists.
  const attempt1 = launch("rollback-attempt-1", { timeout: 25 });
  expect(attempt1.currentVersion, "1.6.0", "promoted on probation");
  expect(attempt1.counter, null, "the broken bundle never reaches the bridge");

  const attempt2 = launch("rollback-attempt-2", { timeout: 25 });
  expect(attempt2.currentVersion, "1.6.0", "given a second launch before giving up");

  const rolledBack = launch("rolled-back");
  expect(rolledBack.currentVersion, "1.3.0", "rolled back to the last bundle that worked");
  expect(rolledBack.marker, MARKER, "and it is really serving it");
  expectBridge(rolledBack, "the app works again after a rollback");

  // A rolled-back bundle must never be reinstalled, or rollback is a loop.
  const afterRollback = launch("after-rollback");
  expect(afterRollback.pendingVersion, null, "the failed bundle is not downloaded again");

  if (signingKey) {
    // ---- tampered: the index changed after it was signed -------------------
    // This is the attack signing exists to stop: a feed host swapping in an
    // entry pointing at an archive of its choosing, with a hash that matches it.
    const tampered = readManifest();
    tampered.bundles.push({
      version: "2.0.0",
      url: goodArchive.name,
      sha256: goodArchive.sha256,
      size: goodArchive.size,
      coreFingerprint: fingerprints.core,
      appFingerprint: fingerprints.app,
    });
    writeManifest(tampered, { sign: false });
    console.log("==> feed edited to offer 2.0.0, signature left untouched");

    const edited = launch("tampered");
    expect(edited.pendingVersion, null, "an unsigned edit to the manifest is refused");
    expect(edited.currentVersion, "1.3.0", "and nothing about what is running changed");

    // ---- unsigned: the signature simply disappears --------------------------
    // Fail closed. Dropping the file is what an attacker who cannot forge a
    // signature would try next.
    fs.rmSync(path.join(feed, "bundles.json.sig"), { force: true });
    console.log("==> signature removed from the feed");

    const stripped = launch("unsigned");
    expect(stripped.pendingVersion, null, "a feed that drops its signature is refused");
    expect(stripped.currentVersion, "1.3.0", "and nothing about what is running changed");
  }
} catch (error) {
  failures++;
  console.log(`::error::${error.message}`);
} finally {
  if (server) server.kill();
}

console.log(`\n==> ${failures === 0 ? "PASS" : "FAIL"} — over-the-air updates`);
process.exit(failures === 0 ? 0 : 1);

// ------------------------------------------------------------------ helpers --

/**
 * Publishes the bundle under test with `vidra build --web` — the command a real
 * publisher runs — after marking `ui/dist` so the loaded page can be identified,
 * and bumping the version so it outranks what the app shipped with.
 *
 * The output directory is not passed: it is derived from the app's own
 * `vidra.updates.feed`, which the rig points at this scratch feed. Publishing
 * somewhere the app is not reading from is the failure that costs a release, so
 * the two are one setting rather than two.
 */
function publishGoodBundle() {
  const dist = path.join(project, "ui", "dist");
  const indexPath = path.join(dist, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  fs.writeFileSync(
    indexPath,
    html.replace("</head>", `  <script>window.__vidraBundleMarker = "${MARKER}";</script>\n  </head>`),
  );

  const pkgPath = path.join(project, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.version = "1.3.0";
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  run(
    "node",
    [cli, "build", "--web", ...(signingKey ? ["--sign", signingKey] : [])],
    project,
  );

  // `--web` writes into the layout's feed directory; the rig serves its own, so
  // move what was produced. Copying rather than pointing the app at dist/ keeps
  // the "feed edited behind the app's back" cases below working on files nothing
  // else rewrites.
  fs.cpSync(path.join(project, "dist", "feed"), feed, { recursive: true });
  console.log(`==> copied dist/feed into ${feed}`);

  const manifest = readManifest();
  const entry = manifest.bundles.at(-1);
  if (!entry) throw new Error("vidra bundle wrote no manifest entry");

  goodArchive = { name: entry.url, sha256: entry.sha256, size: entry.size };
  fingerprints = { core: entry.coreFingerprint, app: entry.appFingerprint };
  console.log(
    `==> published ${entry.version} ${entry.url} ` +
      `(core=${entry.coreFingerprint.slice(0, 12)} app=${entry.appFingerprint.slice(0, 12)})`,
  );
}

/** A bundle that installs and serves, but whose page never boots the SDK. */
function publishBrokenBundle(version) {
  const name = `bundle-${version}-broken.zip`;
  const script = [
    "import zipfile, sys",
    "z = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)",
    "z.writestr('index.html', '<!doctype html><html><body><h1>no sdk here</h1></body></html>')",
    "z.close()",
  ].join("\n");
  run("python3", ["-c", script, path.join(feed, name)], feed);

  const bytes = fs.readFileSync(path.join(feed, name));
  return {
    version,
    url: name,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    coreFingerprint: fingerprints.core,
    appFingerprint: fingerprints.app,
  };
}

/** Adds an entry the way a publisher would — re-signing what it changed. */
function addEntry(entry) {
  const manifest = readManifest();
  manifest.bundles.push(entry);
  writeManifest(manifest, { sign: true });
  console.log(`==> feed now offers ${entry.version}`);
}

function writeManifest(manifest, { sign }) {
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(feed, "bundles.json"), bytes);

  if (!signingKey) return;

  if (sign) {
    const signature = crypto.sign("sha256", bytes, crypto.createPrivateKey(fs.readFileSync(signingKey, "utf8")));
    const spki = crypto
      .createPublicKey(crypto.createPrivateKey(fs.readFileSync(signingKey, "utf8")))
      .export({ format: "der", type: "spki" });
    fs.writeFileSync(
      path.join(feed, "bundles.json.sig"),
      `${JSON.stringify(
        {
          algorithm: "ecdsa-p256-sha256",
          keyId: crypto.createHash("sha256").update(spki).digest("hex").slice(0, 8),
          signature: signature.toString("base64"),
        },
        null,
        2,
      )}\n`,
    );
  }
}

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(feed, "bundles.json"), "utf8"));
}

/** Polls until `probe` returns true, or gives up after READY_TIMEOUT_MS. */
async function waitUntil(probe) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  do {
    try {
      if (await probe()) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  } while (Date.now() < deadline);
  return false;
}

/**
 * Blocks until the port is listening, whatever it answers.
 *
 * A 404 is a serving feed with nothing published yet, which is exactly the
 * state the first publish merges from. A refused connection is not, and telling
 * them apart is the whole reason publishing fails closed.
 */
async function waitForServer() {
  const url = `http://127.0.0.1:${port}/`;
  const up = await waitUntil(async () => {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  });
  if (!up) {
    throw new Error(
      `the feed server never came up on ${port} within ${READY_TIMEOUT_MS / 1000}s`,
    );
  }
  console.log(`==> feed server is listening on ${port}`);
}

/** Blocks until the published index is actually being served, so launch 1 is not a race. */
async function waitForFeed() {
  const url = `http://127.0.0.1:${port}/bundles.json`;
  const answering = await waitUntil(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    await response.text();
    return true;
  });
  if (!answering) {
    throw new Error(
      `the feed never answered at ${url} within ${READY_TIMEOUT_MS / 1000}s`,
    );
  }
  console.log(`==> feed is answering at ${url}`);
}

function serveFeed() {
  const child = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: feed,
    stdio: "ignore",
  });
  console.log(`==> serving ${feed} on http://127.0.0.1:${port}`);
  return child;
}

/** Runs the app once and returns the proof it wrote. */
function launch(name, { timeout = 60 } = {}) {
  const proofPath = path.join(work, `${name}.json`);
  fs.rmSync(proofPath, { force: true });

  console.log(`\n=================== launch: ${name} ===================`);
  const result = spawnSync(bin, [], {
    cwd: path.dirname(bin),
    env: {
      ...process.env,
      VIDRA_OTA_PROOF: proofPath,
      VIDRA_OTA_TIMEOUT: String(timeout),
      // The check is what each phase is waiting for; there is nothing to gain
      // from the production delay in a test that launches the app eleven times.
      VIDRA_UPDATE_STARTUP_DELAY: "1",
    },
    timeout: (timeout + 45) * 1000,
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  for (const line of output.split(/\r?\n/)) {
    if (line.includes("[vidra]") || line.includes("error")) console.log(`    ${line}`);
  }

  if (!fs.existsSync(proofPath)) {
    throw new Error(`launch ${name} wrote no proof (exit=${result.status}, signal=${result.signal})`);
  }

  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  console.log(
    `    marker=${proof.marker} current=${proof.currentVersion} ` +
      `pending=${proof.pendingVersion} counter=${proof.counter}`,
  );
  return proof;
}

function expect(actual, expected, what) {
  const normalized = actual === "undefined" ? "undefined" : actual;
  if (normalized === expected) {
    console.log(`    ✓ ${what}`);
    return;
  }
  failures++;
  console.log(
    `::error::${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function expectBridge(proof, what = "the bridge completed a round-trip") {
  if (proof.counter === 1) {
    console.log(`    ✓ ${what}`);
    return;
  }
  failures++;
  console.log(`::error::${what}: counter=${JSON.stringify(proof.counter)} error=${proof.bridgeError}`);
}

function run(command, argv, cwd) {
  const result = spawnSync(command, argv, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${argv.join(" ")} failed with ${result.status}`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    out[argv[i].slice(2)] = argv[i + 1];
    i++;
  }
  return out;
}

function required(name) {
  if (!args[name]) {
    console.log(`::error::missing --${name}`);
    process.exit(1);
  }
  return args[name];
}
