#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/dist/packages"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "Packing UINet packages to $OUT_DIR ..."

dotnet pack "$SCRIPT_DIR/src/bridge/UINet.Bridge/UINet.Bridge.csproj" \
  -c Release -o "$OUT_DIR" --no-restore 2>/dev/null || \
dotnet pack "$SCRIPT_DIR/src/bridge/UINet.Bridge/UINet.Bridge.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/UINet.Modules.FileSystem/UINet.Modules.FileSystem.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/UINet.Modules.Clipboard/UINet.Modules.Clipboard.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/UINet.Modules.Dialogs/UINet.Modules.Dialogs.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/UINet.Modules.Notifications/UINet.Modules.Notifications.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/UINet.Modules.AppLifecycle/UINet.Modules.AppLifecycle.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/modules/UINet.Modules.Windowing/UINet.Modules.Windowing.csproj" \
  -c Release -o "$OUT_DIR"

dotnet pack "$SCRIPT_DIR/src/host/UINet.Host.Maui.Core/UINet.Host.Maui.Core.csproj" \
  -c Release -o "$OUT_DIR"

echo ""
echo "Done! Packages:"
ls -1 "$OUT_DIR"/*.nupkg
echo ""
echo "Local feed: $OUT_DIR"
