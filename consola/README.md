# Consola ZentaPro · ZPro Condominio

Aplicación web **solo para el equipo de ZentaPro** (Technical Digital TD, C.A.). Desde aquí se dan de alta los condominios, se activan, suspenden o dan de baja, se cobran las mensualidades y se da soporte.

> Es un sitio aparte (por ejemplo `consola.zentapro.com`). **Nunca** va dentro de la app de residentes ni en Google Play.

## Pantallas

| Pantalla | Qué hace |
|---|---|
| Resumen | Condominios por estado, ingreso mensual recurrente en $ y Bs, cobrado vs. pendiente del mes, adopción de la app, condominios en riesgo |
| Condominios | Tabla con búsqueda y filtros. Detalle con marca, plan, adopción, morosidad interna (solo %), facturas y acciones: activar, suspender, reactivar, dar de baja, precio especial (dueño o finanzas), código de activación, códigos por unidad (CSV para imprimir) |
| Alta de condominio | Asistente: datos → marca (asociación, RIF, color, logo, foto de entrada) → unidades desde Excel/CSV (valida que las alícuotas sumen 100 %) → días de prueba (el plan sale solo de la cantidad de unidades) → código de activación |
| Planes y precios | Planes por tamaño con precio global al mes (Pequeño, Mediano, Grande, Extra grande). El dueño cambia topes y precios; los condominios se reubican solos |
| Facturación | Facturas del mes en $ (cobradas solo en Bs a la tasa BCV del día del pago, con abonos parciales), emitir facturas del mes, confirmar o rechazar (con motivo) pagos reportados, tasa BCV del día, suspender morosos |
| Soporte | Buscar usuarios y condominios, solicitudes de ingreso pendientes |
| Equipo | Personas de ZentaPro y su rol (dueño, soporte, finanzas) |

**Privacidad por diseño:** la consola no puede ver chats, pagos ni saldos de residentes, ni quién envió un reporte anónimo. Lo impide la seguridad por filas de la base de datos, no solo la interfaz.

## Correrla en tu PC (modo demo)

Requiere Node.js 22 o superior.

```powershell
cd "C:\Users\signu\ZENTAPRO APP\condominio\consola"
npm install
npm run dev
```

Abre http://localhost:5174 y toca **Entrar como ZentaPro (dueño)**. Los datos son ficticios (12 condominios de Aragua, Carabobo y Caracas) y se reinician al recargar.

## Conectarla al servidor propio de ZPro

La consola habla con el **servidor propio de ZPro** (`../servidor/`, rutas `/api/v1/plataforma/*`, ver `../servidor/CONTRATO_API.md` §9). No usa servicios de terceros.

1. Copiar `.env.example` a `.env` y poner la dirección del servidor: `VITE_API_URL=http://localhost:3000` (en local con Docker) o `https://condominio.zentapro.com` (producción).
2. El servidor aplica solo sus migraciones al arrancar (`0004` planes y facturas, `0010` soporte y equipo, `0014` alta y pagos de la consola).
3. La primera persona del equipo se registra en la app y se le da el rol una sola vez:
   `insert into plataforma_admins (usuario_id, rol) select id, 'dueno' from auth.users where email = 'su-correo@zentapro.com';`
   Las demás se agregan desde **Equipo** (deben registrarse antes).
4. Se entra con correo y clave. Si la cuenta no es del equipo de ZentaPro, la consola lo dice y no deja pasar.

## Publicarla

```powershell
npm run build
```

La carpeta `dist/` la sirve Caddy en el mismo Droplet bajo `consola.zentapro.com` (ver `../despliegue/digitalocean/`). Recomendado: restringir además el acceso (por IP o con una capa de acceso) para que solo el equipo pueda abrirla.

## Importar unidades

Plantilla descargable en el paso 3 del asistente. Columnas (en cualquier orden, con o sin acentos): `bloque`, `numero`, `tipo`, `alicuota`, `propietario`. Acepta Excel (.xlsx) y CSV con `;` o `,`, y alícuotas con coma decimal (`4,5`). Si las alícuotas vienen como fracción (suman 1), se convierten a porcentaje.

## Estado

- Modo demo probado de punta a punta en navegador (alta con CSV de 20 unidades, facturar, confirmar pago, suspender y reactivar), escritorio y móvil.
- Modo servidor: probado contra el servidor propio con PostgreSQL real (inicio de sesión, resumen, alta con CSV, facturación, confirmar pago). Las rutas tienen 12 pruebas automáticas en `../servidor/pruebas/plataforma.test.ts`.
- El número de control fiscal lo debe asignar una imprenta digital autorizada por el SENIAT: integración pendiente.
