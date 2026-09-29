#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/dist/packages"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Evict our own packages from the global cache first.
#
# A scaffolded app pins an exact version, and NuGet will not re-extract a package
# it already has under that version — so a freshly packed 0.4.0 is silently
# ignored in favour of whatever 0.4.0 landed there earlier. On a CI runner with a
# restored cache, or on a developer machine that packed yesterday, that means
# building against stale code while every log line says the build succeeded.
NUGET_CACHE="${NUGET_PACKAGES:-$HOME/.nuget/packages}"
if [ -d "$NUGET_CACHE" ]; then
  rm -rf "$NUGET_CACHE"/vidra.* 2>/dev/null || true
  echo "Evicted stale vidra.* packages from $NUGET_CACHE"
fi

echo "Packing Vidra packages to $OUT_DIR ..."

dotnet pack "$SCRIPT_DIR/src/bridge/Vidra.Bridge/Vidra.Bridge.csproj" \
  -c Release -o "$OUT_DIR" --no-restore 2>/dev/null || \
dotnet pack "$SCRIPT_DIR/src/bridge/Vidra.Bridge/Vidra.Bridge.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/updates/Vidra.Updates/Vidra.Updates.csproj" \
  -c Release -o "$OUT_DIR"

# Multi-targeted: the plain net10.0 half packs on every OS, the platform half
# only where its workload is installed. release-nuget.yml merges macOS, Windows,
# and Linux/Android results; duplicate assets are byte-identical.
dotnet pack "$SCRIPT_DIR/src/updates/Vidra.Updates.Native/Vidra.Updates.Native.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/Vidra.Modules.FileSystem/Vidra.Modules.FileSystem.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/Vidra.Modules.Clipboard/Vidra.Modules.Clipboard.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/Vidra.Modules.Dialogs/Vidra.Modules.Dialogs.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/Vidra.Modules.Notifications/Vidra.Modules.Notifications.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/Vidra.Modules.AppLifecycle/Vidra.Modules.AppLifecycle.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/Vidra.Modules.Windowing/Vidra.Modules.Windowing.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/Vidra.Modules.Essentials/Vidra.Modules.Essentials.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/host/Vidra.Host.Maui.Core/Vidra.Host.Maui.Core.csproj" \
  -c Release -o "$OUT_DIR"

echo ""
echo "Done! Packages:"
ls -1 "$OUT_DIR"/*.nupkg
echo ""
echo "Local feed: $OUT_DIR"
