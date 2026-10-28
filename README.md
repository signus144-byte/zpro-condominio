# ZPro Condominio

| | |
|---|---|
| **Qué es** | Administración de condominios: columna financiera para Presidencia, app para residentes con chat por casa, y consola master de ZentaPro |
| **Paquete (applicationId)** | `com.zentapro.condominio` ⚠ *provisional, confirmar antes de la primera versión firmada* |
| **Desarrollador** | Technical Digital TD, C.A. (ZentaPro) · soporte@zentapro.com |
| **Versión** | 0.4 · servidor propio, todo en Docker local · cobro solo en Bs, planes por tamaño, chat entre vecinos opcional, notificaciones de pagos |
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
| `servidor/db/migraciones/` | Base de datos: 19 archivos SQL con tablas, reglas y seguridad por filas. Se aplican solos al arrancar |
| `servidor/pruebas/` | 106 pruebas de la API + pruebas de reglas SQL, contra PostgreSQL real |
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
npm test          # 106 pruebas de la API (levanta un PostgreSQL temporal solo)
npm run test:sql  # reglas de la base de datos
```

## APK de Android

```powershell
cd app
npm install
npx cap add android      # solo la primera vez
npm run android          # compila, copia a Android y abre Android Studio
```
Firmar con la llave propia de la app (`..\_firma\crear_llave_firma.ps1 -AppId condominio`). Nunca distribuir builds de depuración.

## Documentos

- [docs/ARQUITECTURA_v0.3.md](docs/ARQUITECTURA_v0.3.md): **empezar aquí** (incluye las decisiones comerciales de la v0.4)
- [servidor/CONTRATO_API.md](servidor/CONTRATO_API.md): todas las rutas del servidor
- [despliegue/digitalocean/README.md](despliegue/digitalocean/README.md): pasar a producción
- [docs/ESTUDIO_MERCADO_CONDOMINIOS.md](docs/ESTUDIO_MERCADO_CONDOMINIOS.md) · [CHANGELOG.md](CHANGELOG.md)
