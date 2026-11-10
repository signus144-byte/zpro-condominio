#!/usr/bin/env bash
# Arma vecinos-servidor.zip (piloto en el servidor de los bots) con TODO ya compilado:
#   servidor/dist + package.json/lock · web/app (con la dirección del servidor) · web/consola · Docker · instalador.
# Uso (desde cualquier carpeta):  bash despliegue/bots/armar_paquete.sh 165-245-244-208.sslip.io [salida.zip]
set -euo pipefail
BASE="${1:?falta el dominio base, p. ej. 165-245-244-208.sslip.io}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
SALIDA="${2:-$RAIZ/vecinos-servidor.zip}"
VERSION=$(node -p "require('$RAIZ/app/package.json').version")
T=$(mktemp -d); P="$T/vecinos"; mkdir -p "$P/servidor" "$P/web"
echo "==> Servidor $VERSION"
( cd "$RAIZ/servidor" && rm -rf dist && npm run --silent build )
cp -r "$RAIZ/servidor/dist" "$P/servidor/dist"
cp "$RAIZ/servidor/package.json" "$RAIZ/servidor/package-lock.json" "$P/servidor/"
echo "==> App web (https://vecinos.$BASE)"
( cd "$RAIZ/app" && VITE_API_URL="https://vecinos.$BASE" VITE_VERSION="$VERSION" npx vite build --outDir "$P/web/app" --emptyOutDir >/dev/null )
echo "==> Consola"
( cd "$RAIZ/consola" && VITE_API_URL="https://vecinos.$BASE" npx vite build --outDir "$P/web/consola" --emptyOutDir >/dev/null )
cp "$AQUI/docker-compose.bots.yml" "$AQUI/servidor.Dockerfile" "$AQUI/web.Dockerfile" "$AQUI/Caddyfile.web" "$AQUI/instalar-en-servidor.sh" "$P/"
echo "$VERSION" > "$P/VERSION"
# Permisos explícitos (lección de Alabanza: un zip con 0700 deja al usuario del contenedor sin poder leer).
python3 - "$T" "$SALIDA" <<'PY'
import os, sys, zipfile
raiz, salida = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(salida, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, fs in os.walk(os.path.join(raiz, 'vecinos')):
        rel = os.path.relpath(d, raiz)
        zi = zipfile.ZipInfo(rel + '/'); zi.external_attr = (0o40755 << 16) | 0x10; z.writestr(zi, '')
        for f in sorted(fs):
            p = os.path.join(d, f); zi = zipfile.ZipInfo.from_file(p, os.path.join(rel, f))
            zi.external_attr = ((0o100755 if f.endswith('.sh') else 0o100644) << 16); zi.compress_type = zipfile.ZIP_DEFLATED
            with open(p, 'rb') as h: z.writestr(zi, h.read())
PY
rm -rf "$T"
echo "✓ $(du -h "$SALIDA" | cut -f1)  $SALIDA"
