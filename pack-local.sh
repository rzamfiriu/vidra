#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/dist/packages"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "Packing Vidra packages to $OUT_DIR ..."

dotnet pack "$SCRIPT_DIR/src/bridge/Vidra.Bridge/Vidra.Bridge.csproj" \
  -c Release -o "$OUT_DIR" --no-restore 2>/dev/null || \
dotnet pack "$SCRIPT_DIR/src/bridge/Vidra.Bridge/Vidra.Bridge.csproj" \
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
