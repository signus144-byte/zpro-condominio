# -*- coding: utf-8 -*-
"""
Vecinos ZPro · instalar (o actualizar) el PILOTO en el servidor de los bots (VPS DigitalOcean).

Se ejecuta en la PC con el Python de Ani Trade (que ya trae paramiko), desde «INSTALAR EN SERVIDOR.bat»:
    "C:\\Trading Bot Ani\\.venv\\Scripts\\python.exe" desplegar_vecinos.py            → instalar / actualizar
    "C:\\Trading Bot Ani\\.venv\\Scripts\\python.exe" desplegar_vecinos.py --revisar  → solo mirar (no cambia nada)

1. DIAGNÓSTICO (solo lectura): memoria, disco, Docker, Caddy de Alabanza, bots y Vecinos ZPro si ya está.
2. Pregunta antes de tocar nada. Si se confirma con S:
   - sube vecinos-servidor.zip a /opt y ejecuta /opt/vecinos/instalar-en-servidor.sh,
   - la primera vez crea el administrador dueño de la consola y muestra su clave UNA vez.
   Los bots, Alabanza y Viñas no se detienen ni se tocan. Las claves de Vecinos ZPro se crean EN el servidor.

La contraseña del servidor se lee de VPS_PASSWORD (variable de entorno o el .env de Ani Trade). Nunca se muestra.
Deja «informe-servidor.txt» (sin claves) para que Claude lo revise.
"""
import getpass
import os
import shlex
import ssl
import sys
import urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    import paramiko
except ImportError:
    sys.exit("❌ Falta paramiko. Usa el Python de Ani Trade: C:\\Trading Bot Ani\\.venv\\Scripts\\python.exe")

AQUI = Path(__file__).resolve().parent
PAQUETE = AQUI / "vecinos-servidor.zip"
HOST = os.environ.get("VPS_HOST", "165.245.244.208")
USUARIO = os.environ.get("VPS_USER", "root")
BASE = HOST.replace(".", "-") + ".sslip.io"
APP = f"https://vecinos.{BASE}"
CONSOLA = f"https://consola-vecinos.{BASE}"
ENVS = [Path(r"C:\Trading Bot Ani\.env"), Path(r"C:\Trading Bot Ani\Ani Trade Real\.env")]
INFORME = AQUI / "informe-servidor.txt"


def leer_password():
    pw = os.environ.get("VPS_PASSWORD")
    if pw:
        return pw
    for env in ENVS:
        if env.exists():
            for linea in env.read_text(encoding="utf-8", errors="ignore").splitlines():
                linea = linea.strip()
                if linea.startswith("VPS_PASSWORD="):
                    return linea.split("=", 1)[1].strip().strip('"').strip("'")
    return getpass.getpass("Contraseña del servidor: ")


def ejecutar(cli, comando, timeout=900, mostrar=True):
    """Ejecuta en el servidor y muestra la salida en vivo (ocultando claves). Devuelve (código, salida)."""
    _, stdout, _ = cli.exec_command(f"bash -lc {shlex.quote(comando)} 2>&1", timeout=timeout)
    salida = []
    for linea in iter(stdout.readline, ""):
        salida.append(linea)
        if mostrar and "CLAVE_ADMIN" not in linea:
            print("   " + linea.rstrip())
    return stdout.channel.recv_exit_status(), "".join(salida)


def sin_claves(texto):
    return "\n".join(l for l in texto.splitlines() if not any(k in l.upper() for k in ("CLAVE", "PASSWORD", "SECRETO", "TOKEN")))


def probar_desde_pc(url):
    try:
        with urllib.request.urlopen(url + "/salud", timeout=20, context=ssl.create_default_context()) as r:
            return r.status, r.read(300).decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:
        return 0, str(e)[:200]


DIAGNOSTICO = r"""
echo "[SISTEMA]  $(uname -m) · $( (. /etc/os-release && echo $PRETTY_NAME) ) · $(nproc) núcleos"
echo "[CARGA]    $(uptime | sed 's/.*load average/load average/')"
free -m | awk '/Mem:/ {print "[MEMORIA]  total " $2 " MB · disponible " $7 " MB"} /Swap:/ {print "[SWAP]     " $2 " MB"}'
df -Pm / | awk 'NR==2 {print "[DISCO]    libre " $4 " MB de " $2 " MB"}'
command -v docker >/dev/null && echo "[DOCKER]   $(docker --version)" || echo "[DOCKER]   NO instalado"
docker network inspect alabanza_default >/dev/null 2>&1 && echo "[RED]      alabanza_default sí" || echo "[RED]      alabanza_default NO"
docker inspect alabanza-caddy --format '{{range .Mounts}}{{.Destination}} {{end}}' 2>/dev/null | grep -q /etc/caddy/sitios && echo "[CADDY]    con carpeta de sitios" || echo "[CADDY]    NO listo"
echo "[BOTS]     servicios ani-* activos: $(systemctl list-units --type=service --state=running --no-pager --plain 2>/dev/null | grep -c '^ani-')"
echo "[OTRAS]    $(docker ps --format '{{.Names}}' | grep -vE '^vecinos-' | tr '\n' ' ')"
if [ -f /opt/vecinos/.env ]; then echo "[VECINOS]  ya instalado (versión $(cat /opt/vecinos/VERSION 2>/dev/null))"; else echo "[VECINOS]  no instalado"; fi
docker ps -a --filter name=vecinos- --format '[CONTENEDOR] {{.Names}} · {{.Status}}'
echo "[SALUD]    $(curl -s -m 8 http://127.0.0.1:8092/salud || echo 'no responde')"
docker stats --no-stream --format '[USO]      {{.Name}} · {{.MemUsage}} · CPU {{.CPUPerc}}' 2>/dev/null
"""

REVISION_EXTRA = r"""
echo "[REGISTRO] últimas líneas del servidor de Vecinos ZPro:"
docker logs --tail 80 vecinos-servidor 2>&1 | grep -vE '"incoming request"|"request completed"' | tail -30 | cut -c1-240 | sed 's/^/            /'
echo "[RESPALDOS] $(ls -1 /opt/vecinos/respaldos 2>/dev/null | tail -5 | tr '\n' ' ')"
echo "[CADDY]    avisos de certificados:"
docker logs --tail 300 alabanza-caddy 2>&1 | grep -iE 'vecinos' | grep -iE 'error|fail|obtain|certificate' | tail -5 | cut -c1-220 | sed 's/^/            /'
"""


def conectar():
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"\n🔌 Conectando a {USUARIO}@{HOST}…")
    try:
        cli.connect(HOST, username=USUARIO, password=leer_password(), timeout=20)
    except Exception as e:
        sys.exit(f"❌ No se pudo conectar: {e}")
    print("✅ Conectado.\n")
    return cli


def main():
    revisar = "--revisar" in sys.argv
    print("=" * 66)
    print("  Vecinos ZPro · " + ("revisar el servidor del piloto" if revisar else "piloto en el servidor de los bots"))
    print("=" * 66)
    cli = conectar()
    print("🩺 Diagnóstico (solo lectura):")
    _, diag = ejecutar(cli, DIAGNOSTICO + (REVISION_EXTRA if revisar else ""), timeout=120)
    informe = [diag]

    if revisar:
        cod, txt = probar_desde_pc(APP)
        linea = f"[DESDE PC] {APP}/salud → {cod} {txt}"
        print("\n" + linea)
        informe.append(linea)
        INFORME.write_text(sin_claves("\n".join(informe)), encoding="utf-8")
        cli.close()
        print(f"\nInforme guardado en {INFORME.name} (sin claves).")
        return

    if not PAQUETE.exists():
        sys.exit(f"❌ No encuentro {PAQUETE.name} junto a este script.")
    if "[CADDY]    NO" in diag or "[RED]      alabanza_default NO" in diag:
        sys.exit("❌ No encuentro el Caddy de Alabanza con su carpeta de sitios. Avísale a Claude (no se cambió nada).")
    disponible = 0
    for l in diag.splitlines():
        if l.startswith("[MEMORIA]"):
            try:
                disponible = int(l.split("disponible")[1].split("MB")[0])
            except Exception:
                pass
    primera = "[VECINOS]  no instalado" in diag

    print("\n📋 Plan:")
    print("   • " + ("Instalar" if primera else "Actualizar") + " Vecinos ZPro en /opt/vecinos: base de datos, servidor y app web.")
    print("     Topes: 256 MB la base, 256 MB el servidor, 48 MB la web (en reposo usan unos 100 MB en total), prioridad baja.")
    print(f"   • HTTPS con el Caddy de Alabanza: {APP}  y  {CONSOLA}")
    print("   • Respaldo nocturno de la base de datos en /opt/vecinos/respaldos (se guardan 14 días).")
    print("   • Los bots, Alabanza y Viñas no se detienen ni se tocan.")
    if disponible and disponible < 500:
        print(f"   ⚠️  Solo hay {disponible} MB de memoria disponible. Vecinos ZPro usa ~100 MB en reposo y puede subir a ~560 MB.")

    resp = input("\n¿" + ("Instalar" if primera else "Actualizar") + " ahora? Escribe S y Enter para continuar: ").strip().lower()
    if resp not in ("s", "si", "sí"):
        print("Cancelado. No se cambió nada en el servidor.")
        cli.close()
        return

    correo = ""
    if primera:
        print("\n👤 Administrador de la consola (Technical Digital TD).")
        correo = input("   Correo con el que vas a entrar a la consola (Enter para hacerlo después): ").strip()

    print("\n📦 Subiendo el paquete…")
    sftp = cli.open_sftp()
    sftp.put(str(PAQUETE), "/opt/vecinos-servidor.zip")
    sftp.close()

    print("\n🚀 Instalando (la primera vez tarda unos minutos)…")
    variables = f"ADMIN_CORREO={shlex.quote(correo)} ADMIN_NOMBRE={shlex.quote('Technical Digital TD')} " if correo else ""
    comando = ("cd /opt && rm -rf vecinos/servidor vecinos/web && unzip -o -q vecinos-servidor.zip && "
               f"cd vecinos && {variables}bash instalar-en-servidor.sh {shlex.quote(BASE)}")
    cod, salida = ejecutar(cli, comando, timeout=2400)
    informe.append(salida)
    cli.close()
    INFORME.write_text(sin_claves("\n".join(informe)), encoding="utf-8")
    if cod != 0:
        sys.exit("❌ La instalación no terminó bien. Ya quedó el informe para Claude (informe-servidor.txt).")

    (AQUI / "servidor.txt").write_text(f"App y API: {APP}\nConsola:   {CONSOLA}\n", encoding="utf-8")
    cod, txt = probar_desde_pc(APP)
    print("\n✅ Responde desde internet: " + txt if cod == 200 else
          "\n⚠️  Todavía no responde desde internet (el certificado puede tardar un minuto). Prueba de nuevo con REVISAR SERVIDOR.bat")

    clave = next((l.split("CLAVE_ADMIN:", 1)[1].strip() for l in salida.splitlines() if "CLAVE_ADMIN:" in l), "")
    print("\n" + "-" * 66)
    print(f"   App (vecinos):  {APP}")
    print(f"   Consola:        {CONSOLA}")
    if clave:
        print(f"\n   🔑 Clave de la consola para {correo}:   {clave}")
        print("      Anótala ahora: no se vuelve a mostrar. Puedes cambiarla después desde la app.")
    elif correo:
        print(f"\n   👤 {correo} ya tenía cuenta: ahora es dueño de la consola (su clave no cambió).")
    print("-" * 66)


if __name__ == "__main__":
    main()
