#!/usr/bin/env bash
# Instala RunFlow Station como servicio de systemd (ejecutar con sudo desde la
# carpeta empaquetada). Datos en /var/lib/runflow-station.
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)
DEST=/opt/runflow-station
NODE=$(command -v node || true)
if [ -z "$NODE" ]; then echo "Instala antes Node.js 22"; exit 1; fi
id runflow >/dev/null 2>&1 || useradd --system --home /var/lib/runflow-station --shell /usr/sbin/nologin runflow
mkdir -p /var/lib/runflow-station
chown runflow:runflow /var/lib/runflow-station
rm -rf "$DEST" && mkdir -p "$DEST" && cp -r "$SRC/." "$DEST/"
sed "s#@NODE@#$NODE#" "$DEST/runflow-station.service" > /etc/systemd/system/runflow-station.service
systemctl daemon-reload
systemctl enable --now runflow-station
sleep 5
sudo -u runflow RUNFLOW_STATION_DATA=/var/lib/runflow-station "$NODE" "$DEST/main.js" info
echo "Registro: journalctl -u runflow-station -f"
