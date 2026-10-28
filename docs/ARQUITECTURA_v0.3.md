# ZPro Condominio · Arquitectura v0.4 (servidor propio)

*27-oct-2026 · Technical Digital TD, C.A. · Reemplaza a la v0.2 en todo lo relativo al servidor. v0.4: decisiones comerciales de Dirección (§6).*

## 1. Decisiones

| Tema | Decisión |
|---|---|
| Servidor | **Propio**, sin servicios de terceros: Node.js + TypeScript (Fastify) + PostgreSQL 18 |
| Desarrollo | Todo **en local con Docker** hasta que el producto esté aprobado para la venta |
| Producción | El **mismo Docker** en un Droplet de DigitalOcean: piloto de **1 GB ($6/mes)**, se agranda al crecer |
| Respaldo | Propio y gratuito (script nocturno → Google Drive) mientras no haya ingresos |
| Lenguaje | Un solo lenguaje (TypeScript) en servidor, app y consola; tipos compartidos en `compartido/` |

## 2. Piezas

```
 Teléfonos (app Android/iOS/web)          Consola master (web, equipo ZentaPro)
            │  HTTPS + WebSocket                     │ HTTPS
            └──────────────┬─────────────────────────┘
                     Caddy (HTTPS automático, sirve app y consola)
                           │ /api
                 Servidor ZPro (Node.js, un solo proceso)
     ┌──────────┬──────────┼────────────┬──────────────┬─────────────┐
   API REST   Inicio de   Archivos     Chat en tiempo  Tareas         Notificaciones
   (rutas)    sesión      (disco →     real (WebSocket programadas    push (Firebase,
              propio      Spaces)      + LISTEN/NOTIFY) (BCV, purga,  opcional)
                                                       facturación)
                           │
                 PostgreSQL 18: tablas + reglas + seguridad por filas (RLS)
```

| Pieza | Cómo funciona |
|---|---|
| **Permisos** | Los decide la **base de datos**, no el servidor: en cada petición el servidor abre una transacción con la identidad del usuario (`app.uid`) y el rol `authenticated`; las políticas RLS deciden qué ve y qué puede hacer. Un error en una ruta no puede saltarse los permisos |
| **Inicio de sesión** | Correo + clave (argon2id). Token de acceso de 15 min + token de refresco de 60 días que rota en cada uso; si alguien reusa uno viejo (posible robo) se cierran todas las sesiones. Bloqueo de 15 min tras 5 intentos fallidos. Correo de verificación y "olvidé mi clave" con enlaces de un solo uso |
| **Archivos** | Metadatos y permisos en `storage.objects` (RLS); bytes en disco (piloto) o en Spaces (más adelante). Se ven con URLs firmadas que vencen en 1 hora |
| **Reportes anónimos** | La autoría va a una tabla que nadie puede leer desde la app; las fotos se re-codifican sin datos de ubicación ni del teléfono y se guardan **sin dueño** |
| **Chat** | Mensajes en PostgreSQL; cada mensaje nuevo dispara `NOTIFY` y el servidor lo reenvía por WebSocket a quien tiene la conversación abierta (en la prueba: 85 ms). Si el WebSocket se cae, la app consulta cada 10 s |
| **Tareas** | Dentro del mismo servidor (hora de Caracas): tasa BCV 9:30 y 17:30 · purga de archivos vencidos 3:00 · archivos huérfanos (domingos) · facturación de ZentaPro el día 1 · suspensión de morosos 7:00 · recordatorio de pagos sin revisar 8:00 |
| **Notificaciones** | Guardadas en la base de datos (se ven en la app aunque no haya Firebase); llegan al instante por WebSocket, por push si hay Firebase y por correo las importantes |
| **Pagos bancarios** | Extracto Excel/CSV (todos los bancos) y webhook firmado (HMAC) para bancos o agregadores |

## 3. Recursos y costos

| Etapa | Droplet | Memoria usada (aprox.) | Costo/mes |
|---|---|---|---|
| Piloto (1–3 condominios) | 1 GB | PostgreSQL ≤400 MB + servidor ≤350 MB + Caddy ≤100 MB, con swap de 2 GB | **$6** |
| ~10 condominios | 2 GB | | $12 + respaldo DO |
| ~30 condominios | 4 GB + Spaces | | ≈ $36–55 |
| ~100 condominios | 8 núcleos / 16 GB | | ≈ $130 |

A diferencia del plan anterior (Supabase), **el chat en tiempo real sí cabe en 1 GB** porque es parte del mismo servidor.

## 4. Pruebas

- **106 pruebas de la API** + reglas SQL, todas contra **PostgreSQL 18 real** (cuentas, sesiones, permisos de cada rol, finanzas, conciliación, votaciones, reportes anónimos, documentos, chat, WebSocket con clientes reales, tareas, webhook, consola).
- **Recorrido de punta a punta** con el servidor compilado como en producción: inicio de sesión real, chat en tiempo real entre una residente y la presidenta, pago reportado y confirmado, consola master. Sin errores.
- Docker no se pudo ejecutar en el entorno de desarrollo (sin acceso a Docker Hub); los archivos están listos y se prueban en su PC con `docker compose up --build`.

## 5. Pendientes antes de vender

1. Probar `docker compose up` en su PC (Docker Desktop).
2. Pruebas con usuarios reales de un condominio piloto.
3. Correo saliente real (SMTP de zentapro.com) y Firebase para notificaciones push.
4. Imprenta digital autorizada (SENIAT) para las facturas de ZentaPro.
5. Adaptadores de bancos/agregadores (Pabilo, Mercantil, Banco de Venezuela, Activo) según los bancos del piloto.
6. Verificar en el Droplet que la página del BCV responde bien (históricamente ha tenido problemas de certificado).
7. Política de privacidad y términos; registro en Google Play cuando llegue el D-U-N-S.

## 6. Decisiones comerciales (v0.4, Dirección, 27-oct-2026)

| Tema | Decisión | Cómo quedó |
|---|---|---|
| **Moneda del cobro de ZentaPro** | Solo bolívares | La mensualidad se expresa en dólares y se paga en Bs (Pago Móvil o transferencia) **a la tasa BCV del día del pago**. Cada abono se convierte a dólares con la tasa de su día; la factura queda pagada cuando los abonos confirmados cubren el monto. La base de datos rechaza pagos en dólares |
| **Precio** | Precio global al mes según el tamaño, no por casa | Planes: **Pequeño** hasta 50 unidades **$40** · **Mediano** hasta 150 **$70** · **Grande** hasta 300 **$110** · **Extra grande** más de 300 **$150**. Todos incluyen todo (cuenta de la junta, todas las casas, chat, documentos, conciliación). El plan se asigna solo según las unidades cargadas. ZentaPro puede fijar un **precio especial** por condominio. Los montos se cambian desde la consola (pantalla "Planes y precios") |
| **Chat entre vecinos** | Opcional, lo decide la junta | Viene **apagado**; presidencia o la administración lo enciende. Apagado: nadie abre chats nuevos entre casas y los existentes quedan de solo lectura (nada se borra). Casa ↔ junta, grupos y avisos siguen. Cada cambio queda en la bitácora y se avisa a todos |
| **Bancos** | No importa qué banco use cada condominio | El flujo base es: la casa sube su comprobante (captura del Pago Móvil, voucher) → la junta concilia en su banco → **aprueba o rechaza** (con motivo) → la casa recibe el aviso y las finanzas se actualizan solas. La conciliación por extracto y el webhook quedan como ayudas opcionales |
| **Recordatorio** | Siempre visible mientras haya pagos sin revisar | Aviso fijo en la pantalla de la junta + notificación cada mañana (8:00) con cuántos pagos esperan y desde cuándo, también por correo |
| **Nombre de la app** | Por decidir | Se mantiene "ZPro Condominio" y `com.zentapro.condominio` como provisionales. No se firma ninguna versión hasta tener el nombre definitivo y la cuenta de Google Play aprobada |
