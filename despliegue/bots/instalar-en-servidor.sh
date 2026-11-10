#!/usr/bin/env bash
# Vecinos ZPro · instala (o actualiza) el PILOTO en el servidor de los bots, junto a Alabanza y Viñas.
# Usa el Caddy de Alabanza para el HTTPS. Los bots, Alabanza y Viñas no se detienen ni se tocan.
# Uso (como root), dentro de /opt/vecinos:
#   bash instalar-en-servidor.sh [dominio_base]        → vecinos.<IP>.sslip.io y consola-vecinos.<IP>.sslip.io
#   ADMIN_CORREO=correo ADMIN_NOMBRE="Nombre" bash instalar-en-servidor.sh   → además crea el administrador dueño
set -euo pipefail
cd "$(dirname "$0")"
BASE="${1:-}"
if [ -z "$BASE" ]; then
  IP=$(curl -fs4 --max-time 10 https://api.ipify.org || curl -fs4 --max-time 10 https://ifconfig.me || true)
  [ -n "$IP" ] || { echo "No pude averiguar la IP pública. Pásala así: bash instalar-en-servidor.sh 1-2-3-4.sslip.io"; exit 1; }
  BASE="${IP//./-}.sslip.io"
fi
APP="vecinos.${BASE}"
CONSOLA="consola-vecinos.${BASE}"
echo "==> App y API:  https://${APP}"
echo "==> Consola:    https://${CONSOLA}"

# ---------- Revisiones (no cambian nada) ----------
command -v docker >/dev/null || { echo "Falta Docker en este servidor."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Falta 'docker compose' (plugin v2)."; exit 1; }
docker network inspect alabanza_default >/dev/null 2>&1 || { echo "Falta la red de Alabanza (alabanza_default). Instala o actualiza Alabanza primero."; exit 1; }
docker inspect alabanza-caddy --format '{{range .Mounts}}{{.Destination}} {{end}}' 2>/dev/null | grep -q /etc/caddy/sitios \
  || { echo "El Caddy de Alabanza no tiene la carpeta de sitios. Actualiza Alabanza primero."; exit 1; }
LIBRE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
[ "$LIBRE_MB" -gt 3000 ] || { echo "Hay menos de 3 GB libres en disco ($LIBRE_MB MB). Libera espacio primero."; exit 1; }
if ss -ltn | awk '{print $4}' | grep -qE '127\.0\.0\.1:8092$' && ! docker ps --format '{{.Names}}' | grep -qx vecinos-servidor; then
  echo "El puerto 127.0.0.1:8092 lo usa otro programa."; exit 1
fi

# ---------- Configuración (se crea una sola vez y se conserva en cada actualización) ----------
clave() { local s; s=$(set +o pipefail; LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-40}"); [ ${#s} -ge 32 ] || { echo "No se pudo generar una clave." >&2; exit 1; }; printf '%s' "$s"; }
if [ ! -f .env ]; then
  umask 077
  cat > .env <<EOF
# Vecinos ZPro · piloto. Generado en el servidor: NUNCA copiarlo a otro lado.
DOMINIO_APP=${APP}
DOMINIO_CONSOLA=${CONSOLA}
POSTGRES_CLAVE=$(clave 40)
API_CLAVE_BD=$(clave 40)
JWT_SECRETO=$(clave 64)
SMTP_HOST=
SMTP_PUERTO=587
SMTP_USUARIO=
SMTP_CLAVE=
FCM_CUENTA_SERVICIO=
DATOS_PAGO_ZENTAPRO=
EOF
  echo "==> Claves nuevas generadas en .env (solo root las puede leer)."
fi
chmod 600 .env
sed -i "s|^DOMINIO_APP=.*|DOMINIO_APP=${APP}|; s|^DOMINIO_CONSOLA=.*|DOMINIO_CONSOLA=${CONSOLA}|" .env
mkdir -p respaldos && chmod 700 respaldos

# ---------- Construir y encender (la base de datos conserva sus datos entre versiones) ----------
echo "==> Construyendo y encendiendo Vecinos ZPro (la primera vez tarda unos minutos)…"
docker compose -f docker-compose.bots.yml up -d --build
for i in $(seq 1 90); do curl -fs http://127.0.0.1:8092/salud >/dev/null && break; sleep 2; done
if ! curl -fs http://127.0.0.1:8092/salud >/dev/null; then
  echo "El servidor no respondió. Estado: $(docker ps -a --filter name=^vecinos-servidor$ --format '{{.Status}}')"
  echo "Últimas líneas del registro (para Claude):"
  docker logs --tail 60 vecinos-servidor 2>&1 | tail -40 | cut -c1-240 | sed 's/^/   /'
  exit 1
fi
echo "✓ Servidor funcionando: $(curl -fs http://127.0.0.1:8092/salud)"

# ---------- HTTPS con el Caddy de Alabanza ----------
echo "==> Conectando el HTTPS…"
cat > /opt/caddy-sitios/vecinos.caddy <<EOF
# Vecinos ZPro (piloto). Lo escribe /opt/vecinos/instalar-en-servidor.sh
${APP} {
	encode gzip
	@api path /api/* /verificar/* /salud
	handle @api {
		reverse_proxy vecinos-servidor:3000
	}
	handle {
		reverse_proxy vecinos-web:8080
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		-Server
	}
}

${CONSOLA} {
	encode gzip
	reverse_proxy vecinos-web:8081
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Frame-Options DENY
		-Server
	}
}
EOF
docker exec alabanza-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
for i in $(seq 1 30); do curl -fs "https://${APP}/salud" >/dev/null && break; sleep 3; done
if curl -fs "https://${APP}/salud" >/dev/null; then echo "✓ HTTPS listo."; else echo "Aviso: el HTTPS todavía no responde (el certificado puede tardar un minuto)."; fi

# ---------- Respaldo propio: base de datos cada noche, archivos cada domingo; se guardan 14 días ----------
cat > /etc/cron.d/vecinos-respaldo <<'EOF'
# Vecinos ZPro · respaldo local (lo escribe /opt/vecinos/instalar-en-servidor.sh)
15 3 * * * root docker exec vecinos-db pg_dump -U postgres -Fc zpro > /opt/vecinos/respaldos/zpro-$(date +\%F).dump 2>/dev/null; find /opt/vecinos/respaldos -name 'zpro-*.dump' -mtime +14 -delete
45 3 * * 0 root docker run --rm -v vecinos_archivos:/a:ro -v /opt/vecinos/respaldos:/r alpine:3 tar czf /r/archivos-$(date +\%F).tgz -C /a . 2>/dev/null; find /opt/vecinos/respaldos -name 'archivos-*.tgz' -mtime +14 -delete
EOF
chmod 644 /etc/cron.d/vecinos-respaldo

# ---------- Administrador dueño de la plataforma (solo si se pidió) ----------
if [ -n "${ADMIN_CORREO:-}" ]; then
  echo "==> Administrador de la plataforma:"
  docker exec vecinos-servidor node dist/servidor/src/db/crear_admin.js "${ADMIN_CORREO}" "${ADMIN_NOMBRE:-Administración}"
fi

echo
echo "Dirección para la app:   https://${APP}"
echo "Consola:                 https://${CONSOLA}"
echo
echo "Uso de recursos ahora:"
docker stats --no-stream vecinos-db vecinos-servidor vecinos-web
