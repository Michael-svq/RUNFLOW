#!/bin/sh
set -e
# Aplica las migraciones pendientes antes de arrancar (si hay usuario propietario).
if [ -n "$DATABASE_OWNER_URL" ]; then
  node dist/migrate.js
fi
exec "$@"
