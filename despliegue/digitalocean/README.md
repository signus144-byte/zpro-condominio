# ZPro Condominio en DigitalOcean (cuando esté aprobado para la venta)

Hoy todo se desarrolla y se prueba **en local con Docker** (ver `../../README.md`). Esta guía es para el día en
que se contrate el servidor. Es el **mismo Docker**: lo que funciona en su PC funciona en el Droplet.

Criterio: **gastar solo lo que ya produce dinero.** Se arranca con lo mínimo y se agranda el Droplet ("Resize",
minutos, sin reinstalar) cuando entren condominios pagando.

## Etapas y costos

| Etapa | Droplet | Respaldo | Costo/mes |
|---|---|---|---|
| **Piloto** (1–3 condominios) | Básico **1 GB** / 1 núcleo / 25 GB | Propio y gratis: `respaldo.sh` → Google Drive | **$6** |
| Primeros contratos (~10) | 2 GB | Propio + semanal de DigitalOcean (+20 %) | ≈ $15 |
| ~30 condominios | 4 GB, archivos en Spaces | Propio + diario de DigitalOcean (+30 %) | ≈ $36–55 |
| ~100 condominios | 8 núcleos / 16 GB | Ídem | ≈ $130 |

## Qué corre en el Droplet (todo en Docker)

| Contenedor | Qué es | Memoria máx. |
|---|---|---|
| `db` | PostgreSQL 18 (ajustado para 1 GB) | 400 MB |
| `servidor` | API + chat en tiempo real (WebSocket) + tareas programadas (Node.js) | 350 MB |
| `caddy` | HTTPS automático, sirve la app y la consola, reenvía `/api` al servidor | 100 MB |

Total ≈ 850 MB tope; en uso normal mucho menos. El chat en tiempo real **sí** funciona en 1 GB (va dentro del servidor).
Se recomienda además 2 GB de memoria de intercambio (swap) para picos.

Dominios: `condominio.zentapro.com` (app + API) y `consola.zentapro.com` (consola master). Registros A → IP del Droplet.

## Instalación (una vez)

```bash
# En el Droplet (Ubuntu 24.04), como root
apt update && apt -y upgrade && apt -y install docker.io docker-compose-v2 git rclone ufw
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab

mkdir -p /opt/zpro && cd /opt/zpro        # copiar aquí la carpeta condominio/ (scp o git)
cd condominio/despliegue/digitalocean
cp produccion.env.example .env && nano .env     # dominios, claves aleatorias, SMTP
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f servidor   # debe decir que aplicó las migraciones
```

El primer administrador de ZentaPro se crea registrándose en la app y luego, una sola vez:
```bash
docker compose -f docker-compose.prod.yml exec db psql -U postgres -d zpro \
  -c "insert into plataforma_admins (usuario_id, rol) select id, 'dueno' from auth.users where email = 'su-correo@zentapro.com';"
```

## Actualizar a una versión nueva

```bash
cd /opt/zpro/condominio && git pull        # o copiar la carpeta nueva
cd despliegue/digitalocean && docker compose -f docker-compose.prod.yml up -d --build
```
Las migraciones de base de datos se aplican solas al arrancar el servidor.

## Respaldo propio y gratuito

`respaldo.sh` cada noche: volcado de la base de datos + archivos subidos → Google Drive (15 GB gratis), 30 días.
`restaurar.sh <fecha>` lo devuelve. **Ensayar la restauración una vez al mes** en un Droplet temporal.
Cuando haya condominios pagando, sumar el respaldo de DigitalOcean (restaura el servidor completo en minutos).

## Seguridad

- Droplet **aparte** del de ZentaPro/bots.
- Cortafuegos: solo 22 (SSH con llave), 80 y 443. PostgreSQL no se expone a internet.
- `.env` solo legible por root; claves largas y aleatorias; nunca usar `SEMILLA_DEMO` en producción (el servidor se niega).
- Actualizaciones de seguridad de Ubuntu automáticas (`unattended-upgrades`).
