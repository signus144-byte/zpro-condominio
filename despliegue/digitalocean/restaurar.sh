#!/usr/bin/env bash
# Restaura un respaldo de respaldo.sh. Ensayarlo cada mes en un Droplet de prueba.
# Uso: bash restaurar.sh 2026-10-27
set -euo pipefail
FECHA="${1:?Fecha del respaldo, p. ej. 2026-10-27}"
cd "$(dirname "$0")"
COMPOSE="docker compose -f docker-compose.prod.yml"
TMP=$(mktemp -d)
trap 'rm -r -- "${TMP:?}"' EXIT

rclone copy "drive:ZPro-Condominio/respaldos/$FECHA" "$TMP"
$COMPOSE up -d db && sleep 5
$COMPOSE exec -T db pg_restore -U postgres -d zpro --clean --if-exists < "$TMP/db-$FECHA.dump"
$COMPOSE up -d servidor && sleep 3
$COMPOSE exec -T servidor tar -C /datos -xzf - < "$TMP/archivos-$FECHA.tar.gz"
$COMPOSE up -d
echo "Restaurado $FECHA"
