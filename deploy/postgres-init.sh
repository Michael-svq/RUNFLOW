#!/bin/sh
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$RUNFLOW_APP_DB_PASSWORD" -f /docker-entrypoint-initdb.d/runflow-init.sql.tpl
