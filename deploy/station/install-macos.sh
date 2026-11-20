#!/usr/bin/env bash
# Instala RunFlow Station para que arranque al iniciar sesión (launchd).
# Datos en ~/Library/Application Support/RunFlow Station.
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)
DEST="$HOME/Applications/RunFlow Station"
NODE=$(command -v node || true)
if [ -z "$NODE" ]; then echo "Instala antes Node.js 22"; exit 1; fi
rm -rf "$DEST" && mkdir -p "$DEST" && cp -R "$SRC/." "$DEST/"
PLIST="$HOME/Library/LaunchAgents/app.runflow.station.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.runflow.station</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DEST/main.js</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/runflow-station.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/runflow-station.log</string>
</dict>
</plist>
PLIST
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 5
"$NODE" "$DEST/main.js" info
