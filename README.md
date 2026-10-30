# ZPro Condominio

| | |
|---|---|
| **Qué es** | Administración de condominios: columna financiera para Presidencia, app para residentes con chat por casa, y consola master de ZentaPro |
| **Paquetes (applicationId)** | Vecinos ZPro Junta `com.zentapro.condominio.admin` · Vecinos ZPro `com.zentapro.condominio` ⚠ *provisionales: el nombre de la app está por decidir* |
| **Desarrollador** | Technical Digital TD, C.A. (ZentaPro) · soporte@zentapro.com |
| **Versión** | 0.5 · servidor propio en Docker local · alerta vecinal · dos apps: Vecinos ZPro Junta (junta) y Vecinos ZPro (vecinos) |
| **Estado** | Funciona de punta a punta en local. Aún no publicado ni instalado en DigitalOcean |

## Cómo correrlo en su PC

1. Instalar **Docker Desktop** para Windows (gratis para empresas pequeñas): https://www.docker.com/products/docker-desktop/
2. Abrir PowerShell en esta carpeta y correr:
   ```powershell
   cd "C:\Users\signu\ZENTAPRO APP\condominio"
   docker compose up --build
   ```
   La primera vez tarda unos minutos (descarga e instala todo). Después, `docker compose up` arranca en segundos.
3. Abrir en el navegador:

| Qué | Dirección | Usuario de prueba (clave `demo-1234`) |
|---|---|---|
| App (residentes y junta) | http://localhost:8080 | `elena@demo.zpro` (Apto B-33) · `pedro@demo.zpro` (B-34) · `presidenta@demo.zpro` · `tesorero@demo.zpro` |
| Consola master ZentaPro | http://localhost:8081 | `soporte@demo.zpro` |
| Correos que "envía" el sistema | http://localhost:8025 | (verificación de cuenta, olvidé mi clave) |
| Estado del servidor | http://localhost:3000/salud | |

Para apagar: `Ctrl+C` o `docker compose down`. Los datos quedan guardados; para empezar de cero: `docker compose down -v`.

## Qué hay en cada carpeta

| Carpeta | Contenido |
|---|---|
| `servidor/` | **Servidor propio** (Node.js + TypeScript + PostgreSQL 18): API, inicio de sesión, archivos, chat en tiempo real, notificaciones, tareas programadas. Ver `servidor/CONTRATO_API.md` |
| `servidor/db/migraciones/` | Base de datos: 21 archivos SQL con tablas, reglas y seguridad por filas. Se aplican solos al arrancar |
| `servidor/pruebas/` | 128 pruebas de la API + pruebas de reglas SQL, contra PostgreSQL real |
| `app/` | App de residentes y junta (React + Capacitor: Android, iOS y web) |
| `consola/` | Consola master de ZentaPro (web aparte) |
| `compartido/` | Tipos de datos comunes a app, consola y servidor |
| `despliegue/` | Docker para local y para DigitalOcean (Droplet de $6), respaldo propio a Google Drive |
| `docs/` | Arquitectura, estudio de mercado, especificación, muestras de documentos |

## Desarrollo sin Docker (opcional, para programar)

Con Node.js 22: `cd servidor && npm install && npm run dev` (necesita un PostgreSQL; ver `servidor/.env.example`),
`cd app && npm install && npm run dev`, `cd consola && npm install && npm run dev`.
Sin `VITE_API_URL`, la app y la consola arrancan en **modo demostración** (datos en memoria, sin servidor).

## Pruebas

```powershell
cd servidor
npm install
npm test          # 128 pruebas de la API (levanta un PostgreSQL temporal solo)
npm run test:sql  # reglas de la base de datos
```

## APK de Android (dos apps: Vecinos ZPro Junta y Vecinos ZPro)

Las dos salen del mismo código (`app/`) como dos "sabores" de Android con paquetes, nombres e íconos distintos.

**APK de prueba** (para ver en el teléfono; paquete con `.prueba` y llave SOLO de prueba en `_firma\llaves\condominio-prueba\`):
```powershell
cd "C:\Users\signu\ZENTAPRO APP\condominio\app"
powershell -ExecutionPolicy Bypass -File .\compilar_apk.ps1          # necesita Android Studio y Node.js 22
```
Quedan en `releases\v0.5-prueba\` con sus huellas SHA-256. También se pueden compilar en GitHub (Actions → "APK de prueba").

- Sin servidor, las apps abren en **modo demostración**. Para usarlas con el Docker de su PC: vea el comentario al inicio de
  `docker-compose.yml` y en la app toque "Conectar a un servidor" → `http://IP-DE-SU-PC:3000`.
- La alarma de la alerta vecinal suena con la app abierta. Para que suene con la app cerrada hace falta Firebase (gratis):
  poner `google-services.json` en `app/android/app/` y `FCM_CUENTA_SERVICIO` en el servidor.
- Las versiones oficiales se firman con la llave de la app (`android/keystore.properties`) cuando esté decidido el nombre
  y aprobada la cuenta de Google. Nunca distribuir builds de depuración.

## Documentos

- [docs/ARQUITECTURA_v0.3.md](docs/ARQUITECTURA_v0.3.md): **empezar aquí** (incluye las decisiones comerciales de la v0.4)
- [servidor/CONTRATO_API.md](servidor/CONTRATO_API.md): todas las rutas del servidor
- [despliegue/digitalocean/README.md](despliegue/digitalocean/README.md): pasar a producción
- [docs/ESTUDIO_MERCADO_CONDOMINIOS.md](docs/ESTUDIO_MERCADO_CONDOMINIOS.md) · [CHANGELOG.md](CHANGELOG.md)
