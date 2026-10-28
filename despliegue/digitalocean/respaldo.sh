#!/usr/bin/env bash
# Respaldo nocturno propio y gratuito: base de datos + archivos → Google Drive (rclone). Se guardan 30 días.
# Instalar una vez en el Droplet:  apt install rclone  →  rclone config  (remoto "drive", tipo Google Drive)
# y en /etc/cron.d/zpro-respaldo:
#   15 7 * * * root /opt/zpro/condominio/despliegue/digitalocean/respaldo.sh >> /var/log/zpro-respaldo.log 2>&1   (3:15 a. m. VET)
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE="docker compose -f docker-compose.prod.yml"
DESTINO="drive:ZPro-Condominio/respaldos"
FECHA=$(date +%F)
TMP=$(mktemp -d)
trap 'rm -r -- "${TMP:?}"' EXIT

# 1. Base de datos (formato custom de pg_dump: comprimido y restaurable por partes)
$COMPOSE exec -T db pg_dump -U postgres -d zpro -Fc > "$TMP/db-$FECHA.dump"

# 2. Archivos subidos (comprobantes, facturas, marca, chat vigente, fotos de reportes)
$COMPOSE exec -T servidor tar -C /datos -czf - archivos > "$TMP/archivos-$FECHA.tar.gz"

# 3. Fuera del servidor + limpieza de copias de más de 30 días
rclone copy "$TMP" "$DESTINO/$FECHA"
rclone delete --min-age 30d "$DESTINO"
rclone rmdirs --leave-root "$DESTINO"
echo "$(date -Is) respaldo $FECHA: $(du -sh "$TMP" | cut -f1)"
