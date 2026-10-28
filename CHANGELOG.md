# Historial de versiones · ZPro Condominio

## 0.4 · 27-oct-2026 · Decisiones comerciales de Dirección
- **Cobro de ZentaPro solo en bolívares**, a la tasa BCV del día del pago: abonos parciales, cada uno convertido con la tasa de su día; la base de datos rechaza pagos en dólares. ZentaPro puede rechazar un pago reportado con motivo.
- **Planes por tamaño con precio global**: Pequeño (hasta 50 unidades) $40, Mediano (hasta 150) $70, Grande (hasta 300) $110, Extra grande $150. Se asignan solos según las unidades; precio especial por condominio; editables en la consola ("Planes y precios").
- **Chat entre vecinos opcional**: apagado por defecto, lo enciende presidencia o la administración; apagado, las conversaciones entre casas quedan de solo lectura. Queda en la bitácora.
- **Notificaciones**: la casa recibe "Pago aprobado" (con su saldo) o "Pago rechazado" (con el motivo); la junta recibe "Pago por revisar" al instante y un recordatorio cada mañana mientras haya pagos sin aprobar o rechazar. En la app (campana), en tiempo real, por push (con Firebase) y por correo (se puede apagar).
- 106 pruebas de la API + reglas SQL, todas pasan.

## 0.3 · 27-oct-2026 · Servidor propio y Docker local
- **Sin Supabase.** Servidor propio en Node.js + TypeScript (Fastify) + PostgreSQL 18, con las mismas reglas y seguridad por filas en la base de datos.
- Inicio de sesión propio: registro, verificación de correo, olvidé mi clave, sesiones que rotan, bloqueo por intentos fallidos.
- Archivos propios con permisos de la base de datos y URLs firmadas; fotos de reportes anónimos sin EXIF y sin dueño.
- Chat en tiempo real con WebSocket + LISTEN/NOTIFY; notificaciones push con Firebase (opcional).
- Tareas programadas dentro del servidor: tasa BCV, purgas, facturación de ZentaPro, suspensión de morosos.
- Webhook bancario firmado (HMAC) para confirmar pagos automáticamente.
- App y consola conectadas al servidor; pantallas nuevas: crear cuenta, olvidé/restablecer clave, unirme a mi condominio, elegir condominio, accesos (códigos por casa, solicitudes, miembros), conciliación bancaria, factura de ZentaPro, avisos y tasa BCV.
- Docker: `docker-compose.yml` local (base de datos, servidor, app, consola, buzón de correo de prueba) y `docker-compose.prod.yml` para el Droplet de 1 GB.
- 92 pruebas de la API + reglas SQL contra PostgreSQL real; recorrido de punta a punta sin errores.
- Corregido: un vecino no veía el nombre de otro (política de perfiles); la junta no podía corregir la tasa BCV del día; borrar un mensaje de solo texto fallaba.

## 0.2 · 27-oct-2026 · Esqueleto ampliado (escala 100 condominios)
- **Multi-condominio y consola master** (`consola/`): alta con importación de casas desde Excel, código de activación para el presidente, códigos por casa con aprobación, planes, estados (prueba/activo/suspendido/baja), métricas sin datos personales.
- **Chat tipo WhatsApp por casa**: casa↔casa (con nombre, no anónimo), casa↔junta, grupos y canal de avisos; directorio "Casa 28 · a nombre de quién"; ✓/✓✓ leído; bloqueo y denuncia; archivos que vencen en el servidor (15/60 días según plan) y quedan guardados en cada teléfono; exportar conversación.
- **Documentos con la marca del condominio** (logo, foto de la entrada, asociación): estado de cuenta (PDF/Excel), recibo, solvencia con QR verificable, relación de gastos, morosidad y acta de votación con espacio para firma y sello.
- **Conciliación bancaria**: subir el extracto del banco (Excel/CSV) confirma solos los pagos que coinciden; dinero sin aviso se asigna a una casa; base para webhooks de bancos o agregadores.
- **Cobro de ZentaPro**: factura mensual en bolívares a tasa BCV, pago reportado por la junta, suspensión a solo lectura tras 10 días de gracia y reactivación automática.
- Funciones de servidor: tasa BCV, purga nocturna, facturación, webhook bancario, notificaciones push, fotos anónimas sin dueño.
- Servidor: DigitalOcean por etapas, piloto en Droplet de $6 (1 GB); respaldo propio gratuito a Google Drive.
- 93 pruebas de reglas y permisos, todas pasan.
- Pendiente: instalar en el servidor (nada se ha probado contra un servidor real), imprenta digital SENIAT, quitar metadatos de fotos anónimas, scripts de tareas del piloto.

## 0.1 · 27-oct-2026 · Esqueleto
- Estudio de mercado (internacional, Latinoamérica y Venezuela) y especificación.
- Base de datos: condominio, apartamentos con alícuota, roles, cuentas, tasa BCV, gastos, recibos, cargos, pagos, partidas especiales, votaciones, reportes (con opción anónima), avisos y bitácora.
- Reglas en el servidor: reparto por alícuota y fondo de reserva, confirmación de pagos, votación ponderada con umbral, reportes anónimos y límite anti-abuso. Seguridad por filas en todas las tablas.
- 27 pruebas de reglas y permisos, todas pasan.
- App: 6 pantallas de residente, 6 de Presidencia, modo demo, modo claro y oscuro, funciona sin conexión a internet para estilos e iconos.
- Sin probar contra un servidor Supabase real.
