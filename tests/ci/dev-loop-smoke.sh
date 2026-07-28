#!/usr/bin/env bash
# Exercise `vidra dev` end to end: Vite starts, the host builds under
# `dotnet watch`, the app actually launches, and a C# edit puts a fresh build of
# it back on screen.
#
# Usage: dev-loop-smoke.sh <path/to/scaffolded/app> <path/to/cli.js> <macos|windows>
#
# The C# dev loop is the headline feature of the 0.3 line and had no automated
# coverage at all — unit tests cover argument construction and log
# classification, but nothing ever started a real session.
#
# Everything here is a hard assertion. It did not used to be: on Mac Catalyst
# `dotnet watch run` never launched the app (`dotnet run` does not produce the
# .app bundle its RunCommand points at), so the session parked forever and the
# two most valuable checks — the app reaching readiness, and reacting to an
# edit — could only be reported as warnings. `vidra dev` now drives Catalyst
# with `dotnet watch build` plus a launch of its own, which is a loop that
# works, so the checks gate again.
#
# What is deliberately NOT asserted is *how* the edit lands. On Windows it is a
# hot reload delta; on Mac Catalyst MAUI sets StartupHookSupport=False, so it is
# a rebuild and relaunch. Both are correct, and pinning one would make the test
# lie on the other platform. What both owe us is a running app afterwards, and
# that is what we check.
#
# Everything is time-bounded and the session is always torn down, because a
# hanging dev server is exactly the failure this must not cause.
set -uo pipefail

APP_DIR="${1:?usage: dev-loop-smoke.sh <app-dir> <cli.js> <target>}"
CLI="${2:?missing cli.js path}"
TARGET="${3:?missing target}"

READY_TIMEOUT="${VIDRA_DEV_READY_TIMEOUT:-300}"
RELOAD_TIMEOUT="${VIDRA_DEV_RELOAD_TIMEOUT:-180}"

# dotnet watch's default file watcher relies on native filesystem notifications,
# which routinely fail to fire for a working directory on a CI runner — the
# session sits in "Waiting for a file to change" and never notices an edit.
# Polling is slower but deterministic, which is the right trade for a test.
export DOTNET_USE_POLLING_FILE_WATCHER="${DOTNET_USE_POLLING_FILE_WATCHER:-1}"

# The CLI prints this once per launch, and only after the host process itself
# printed the `[vidra] host ready` sentinel from VidraPage — so it means the app
# got as far as loading its page, not merely that a process was spawned.
READY_LINE='host ready'

LOG="$(mktemp)"
cd "$APP_DIR"

cleanup() {
  if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    # `vidra dev` supervises Vite, a dotnet watch process group and the app it
    # launched, so signal the group and give it a moment to take its children
    # with it.
    kill -TERM "-$DEV_PID" 2>/dev/null || kill -TERM "$DEV_PID" 2>/dev/null || true
    sleep 3
    kill -KILL "-$DEV_PID" 2>/dev/null || kill -KILL "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

dump_log() { sed -e 's/^/    /' "$LOG"; }

# Number of times the session has reported a ready host so far. The raw
# `[vidra] host ready` sentinel is filtered out of the passthrough output, but
# excluding it explicitly keeps the count meaning "the CLI said so" even if a
# chunk boundary ever lets one through.
ready_count() { grep "$READY_LINE" "$LOG" | grep -cv '\[vidra\]'; }

# Waits until at least $1 ready reports have been seen, or $2 seconds elapse.
# Fails the run if `vidra dev` dies while we wait.
wait_for_ready() {
  local want="$1" limit="$2" waited=0
  while [ "$waited" -lt "$limit" ]; do
    [ "$(ready_count)" -ge "$want" ] && return 0
    if ! kill -0 "$DEV_PID" 2>/dev/null; then
      echo "::error::vidra dev exited before the host reached readiness"
      dump_log
      exit 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

echo "==> starting: vidra dev --target $TARGET"
# `setsid` is util-linux and does not exist on macOS. Enabling job control makes
# bash place the background job in its own process group with the child as
# leader, which gives us the same `kill -- -PID` teardown portably.
set -m
node "$CLI" dev --target "$TARGET" >"$LOG" 2>&1 &
DEV_PID=$!
set +m

if ! wait_for_ready 1 "$READY_TIMEOUT"; then
  echo "::error::the host never reached readiness within ${READY_TIMEOUT}s"
  dump_log
  exit 1
fi
echo "==> host ready"

grep -q "vite ready" "$LOG" \
  || { echo "::error::Vite never reported ready"; dump_log; exit 1; }
echo "==> vite ready"

# Touch a method body and require the session to put a running app back up.
# Whether that happens by delta or by relaunch is the platform's business.
MAIN_PAGE="$(find src -name 'MainPage.cs' -print -quit)"
if [ -z "$MAIN_PAGE" ]; then
  echo "::error::could not find MainPage.cs to edit"
  exit 1
fi

echo "==> editing $MAIN_PAGE"
# `wc -l` pads its output with spaces on macOS, and `tail -n +"  42"` fails
# with "illegal offset" — which would silently blank the diagnostic exactly
# when it is needed.
before="$(wc -l < "$LOG" | tr -d '[:space:]')"
printf '\n// touched by dev-loop-smoke at build time\n' >> "$MAIN_PAGE"
touch "$MAIN_PAGE"

if ! wait_for_ready 2 "$RELOAD_TIMEOUT"; then
  echo "::error::the session did not bring the host back up after a C# edit within ${RELOAD_TIMEOUT}s"
  echo "---- output produced after the edit ----"
  tail -n +"$before" "$LOG" | sed -e 's/^/    /'
  exit 1
fi

echo "---- session output ----"
dump_log | tail -40

echo "==> the session rebuilt and relaunched the host after a C# edit"
echo "==> PASS — dev session starts, serves, launches the app, and survives an edit"
