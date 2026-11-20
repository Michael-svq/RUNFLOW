#!/usr/bin/env bash
# Empaqueta RunFlow Station en una carpeta autónoma para Linux, macOS o Windows
# (se empaqueta en el mismo sistema en que se va a instalar; necesita Node 22).
#
#   scripts/package-station.sh [carpeta-destino]
#
# Resultado:
#   runflow-station/
#     main.js, node_modules/    lanzador (PostgreSQL integrado, mDNS, HTTPS)
#     server/                   servidor de RunFlow
#     web/                      la aplicación web
#     install-*.sh / .ps1       instalación como servicio
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/out/runflow-station}
TMP="$OUT.tmp"
rm -rf "$OUT" "$TMP"
mkdir -p "$TMP" "$OUT/server"
cd "$ROOT"

pnpm --filter @runflow/web build
pnpm --filter @runflow/server build
pnpm --filter @runflow/station build
pnpm --filter @runflow/station deploy --prod --legacy "$TMP/station"
pnpm --filter @runflow/server deploy --prod --legacy "$TMP/server"

cp -r "$TMP/station/dist/." "$OUT/"
cp -r "$TMP/station/node_modules" "$OUT/node_modules"
cp "$TMP/station/package.json" "$OUT/package.json"
cp -r "$TMP/server/dist/." "$OUT/server/"
cp -r "$TMP/server/node_modules" "$OUT/server/node_modules"
cp "$TMP/server/package.json" "$OUT/server/package.json"
cp -r apps/web/dist "$OUT/web"
cp deploy/station/* "$OUT/"
chmod +x "$OUT"/*.sh "$OUT/main.js"
rm -rf "$TMP"
echo "RunFlow Station empaquetada en $OUT"
