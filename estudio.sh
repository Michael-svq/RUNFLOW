#!/usr/bin/env bash
# Estudio virtual de RunFlow (macOS / Linux): ./estudio.sh [arrancar|parar|borrar]
set -euo pipefail
cd "$(dirname "$0")"
compose=(docker compose -f docker-compose.estudio.yml)
case "${1:-arrancar}" in
  parar) "${compose[@]}" stop; echo "Estudio parado."; exit 0 ;;
  borrar) "${compose[@]}" down -v; echo "Estudio borrado."; exit 0 ;;
esac
command -v docker >/dev/null || { echo "Falta Docker: https://www.docker.com/products/docker-desktop/"; exit 1; }
"${compose[@]}" up -d --build
echo "Esperando a RunFlow..."
for _ in $(seq 1 90); do
  curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 && break
  sleep 2
done
echo
echo "Listo:"
echo "  RunFlow ........... http://localhost:3000  (demo@runflow.test / runflow-demo)"
echo "  Monitor programa .. http://localhost:8090"
(command -v open >/dev/null && open http://localhost:8090 http://localhost:3000/entrar) ||
  (command -v xdg-open >/dev/null && xdg-open http://localhost:3000/entrar) || true
