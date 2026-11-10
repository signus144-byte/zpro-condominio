# Historial de versiones · Vecinos ZPro

## 0.10 · 10-nov-2026 · Lectura del comprobante, recordatorios y análisis completo
- **La app lee el comprobante**: al subir la captura del Pago Móvil o la transferencia (galería, cámara o pegándola), llena sola la referencia, el monto, la fecha y el banco de origen, y revisa que el pago haya ido a la cuenta del condominio (teléfono, cédula o RIF, cuenta, banco). Si fue a otra cuenta, lo advierte antes de enviar. La imagen se lee en el teléfono (Tesseract, dentro de la app; no se envía a terceros).
- **La junta revisa el comprobante con un toque**: compara lo que dice la captura con lo que reportó el vecino y con las cuentas del condominio.
- **Recordatorio de pago a cada casa**: 3 días antes de que venza su recibo y el día después, solo si tiene saldo y no ha reportado un pago. Encendido por defecto; la junta lo apaga en Transparencia y convivencia.
- **Accesibilidad (WCAG 2 AA)**: corregidos los contrastes de la etiqueta DEMO, etiquetas grises, botón de WhatsApp, botón SOS en modo oscuro e íconos de canales; textos mínimos a 12 px; un selector sin nombre. 0 fallas en las 41 pantallas.
- **Arranque más rápido**: las pantallas de uso ocasional se cargan al abrirlas (código inicial de 817 KB a 593 KB).
- Corregido: si faltaba la tasa BCV de la fecha del comprobante, el formulario de reporte desaparecía.
- 190 pruebas (178 de la API, 2 de reglas SQL, 10 del lector), todas pasan.

## 0.9 · 10-nov-2026 · Datos para pagar y cuentas del condominio opcionales
- **Datos para pagar** (Más → Datos para pagar): la junta carga cada cuenta por campos: banco (lista de los 26 bancos), teléfono de Pago Móvil, cédula o RIF, número de cuenta, titular, correo de Zelle y una nota. La app los limpia (acepta "0414-123.45.67", "+58 414…", "V-12.345.678") y rechaza lo que haría fallar el pago (teléfono fijo, cuenta que no empieza por el código del banco…).
- **El vecino copia dato por dato**: en Pagar, según cómo va a pagar (Pago Móvil, transferencia, Zelle, efectivo), ve cada dato con su botón **Copiar** para pegarlo en la app de su banco: banco, teléfono, cédula o RIF (solo los números), número de cuenta y **monto ya calculado a la tasa BCV, escrito como lo piden los bancos (55467,33)**. Botón **Copiar todo**.
- **QR de cobro del banco**: la junta sube la captura del QR que genera la app de su banco o le **toma una foto con la cámara** (por ejemplo, a la hoja impresa). La app lee el QR y lo guarda **nítido, con el mismo contenido**, y avisa si es de otro banco. El vecino lo ve en Pagar y lo guarda para abrirlo desde la app de su banco. También hay un QR con los datos en texto, que lee cualquier lector de QR.
- **Contra el fraude**: cada cambio de los datos para pagar avisa a toda la junta (quién lo hizo y qué cambió). Si cambiaron en los últimos 7 días, el vecino lo ve en Pagar y se le sugiere confirmar con la junta.
- Mensualidad de ZentaPro con los mismos botones Copiar.
- **Cuentas del condominio para los vecinos, solo si la junta quiere** (Más → Transparencia y convivencia). **Por defecto no se muestra nada**: cada casa ve solo lo suyo. Presidencia o la administración puede publicar los **totales** (cobrado, gastado por categoría, fondo de reserva, avance de las cuotas especiales) o **todo el detalle** (además cada gasto con su factura y los saldos de las cuentas). Nunca se muestra qué casas pagaron. Al publicar se avisa a los vecinos; al dejar de publicar, solo a la junta.
- Cambio: antes los vecinos veían siempre el avance de las cuotas especiales; ahora solo si la junta publica los números.
- 177 pruebas de la API + reglas SQL, todas pasan.

## 0.8.1 · 10-nov-2026 · "Asistencia vecinal"
- El botón de emergencia ahora se llama **Asistencia vecinal** en las dos apps: tarjeta de inicio, pantalla SOS, historial, inscripción, configuración de la junta, canal de notificaciones de Android, avisos y mensajes de error. Cada aviso individual sigue llamándose "alerta" ("Enviar alerta", "alerta activa").
- Contrato de servicio: el mismo nombre.

## 0.8 · 9-nov-2026 · Transparencia y convivencia sin represalias
- **Lista de casas con cuotas vencidas, opcional**: la decide presidencia o la administración. Tres modos: no publicar (por defecto), publicar solo las casas (con los meses vencidos) o publicar casas y montos. Se puede exigir un mínimo de meses vencidos. **Nunca muestra nombres.** Al encenderla se avisa a todos los vecinos. PDF para la cartelera. Cuenta solo recibos ya vencidos y sin pagar; quien paga sale de la lista sola.
- **Mensajes anónimos a otra casa**: "A una casa, sin mi nombre". Ej.: "El perrito hace pupú en la entrada; les agradecería recogerlo", con foto. La casa lo recibe y puede responder sin saber a quién; la conversación sigue anónima.
  - Contra el acoso: 3 por día, 1 por día a la misma casa, máximo 10 respuestas por conversación. La casa puede **denunciar** un mensaje ofensivo; la junta ve el mensaje y el motivo (nunca el remitente) y puede **suspender al remitente** de 7 a 365 días sin saber quién es (se le avisa que fue suspendido). La junta también puede desactivar los mensajes anónimos.
- **Reportes a la junta sobre una casa**: "¿Sobre qué casa?" (opcional). Un reporte sobre una casa lo ve solo la junta, que puede escribirle a esa casa como junta con un toque. Opción "A los dos": la casa recibe el mensaje anónimo y la junta un reporte anónimo.
- Anónimo por defecto. Las fotos se re-codifican (se borran la ubicación GPS y el modelo del teléfono) y se guardan sin dueño. Quién envió algo anónimo queda en tablas que ninguna pantalla puede leer; el servidor lo usa solo para los límites, las respuestas y las suspensiones.
- 162 pruebas de la API + reglas SQL, todas pasan.

## 0.7 · 9-nov-2026 · Tasa BCV garantizada, pago por concepto y cierre del mes
- **Tasa BCV con dos fuentes.** El servidor consulta cada 30 minutos (todos los días y al arrancar) la página del BCV y DolarApi. La tasa solo se acepta si **las dos dan el mismo número**; si una no responde o no coinciden, no hay tasa y los vecinos **no pueden reportar pagos en bolívares** (en dólares sí). La junta puede servir de segunda fuente copiando el número de bcv.org.ve (toda la junta cuenta como una sola fuente). Si a las 9:05 no hay tasa confirmada, la junta recibe un aviso.
- Respeta la **fecha valor** del BCV: la tasa publicada el viernes en la tarde rige desde el lunes; el fin de semana sigue la del viernes.
- La app **siempre consulta la tasa al abrir la pantalla de pago y al volver a la app**; sin internet dice "Conéctese a internet" y no muestra montos en Bs. Antes de enviar, vuelve a comprobarla.
- En modo demostración el teléfono consulta las mismas dos fuentes: ya no hay tasa ficticia.
- **El vecino elige qué paga**: "¿Qué quiere pagar?" con la cuota del mes y cada cuota especial por separado, botón **Pagar** que lleva al formulario con el **monto en Bs ya calculado** con la tasa del día.
- **Al aprobar, el pago se descuenta de lo elegido**; lo que sobra va a la deuda más antigua y, si no hay, queda a favor y se descuenta solo del próximo recibo. La junta ve a qué lo destinó el vecino y puede cambiarlo antes de aprobar. El aviso al vecino dice de qué se descontó.
- Cada recibo y cada cargo muestran **Pagado / Abonado / Pendiente**.
- **Avance de cada cuota especial**: barra de recaudación, casas al día, y para la junta la lista de quién pagó y quién debe.
- **Reporte y cierre del mes**: quién pagó y quién no, pagos aprobados / rechazados / en revisión, ingresos, gastos, saldos de las cuentas, fondo de reserva y cuotas especiales. Se ve en la app mes a mes, se descarga en **PDF** (para firma y sello) y **Excel**, con **libro de ingresos y egresos**. El día 1 se cierra solo el mes anterior; la junta puede volver a cerrarlo si aprueba pagos tarde.
- Pagos de la junta filtrables por mes.
- 152 pruebas de la API + reglas SQL, todas pasan.

## 0.6 · 8-nov-2026 · Votaciones por sector y mensajes masivos
- **Cuotas especiales para algunas casas**: una calle con portón propio, un piso con su llave, o casas elegidas. Solo esas casas ven la cuota y su votación, solo sus propietarios votan (el porcentaje se mide sobre ellas), el acta lista solo esas casas y el recibo cobra solo a ellas, repartido entre ellas.
- **Mensajes masivos** de la junta: a todo el condominio, a un grupo guardado, a casas elegidas, a las casas de una cuota especial o solo a las que aún no han votado; vista previa de cuántas casas y personas lo recibirán; opción "solo propietarios"; historial. Al crear una cuota especial se avisa de una vez a las casas incluidas.
- **Grupos de casas** guardados ("Calle 3 · portón", "Torre B · piso 4") y piso de cada casa (se deduce del número y se puede corregir).
- Compartir por WhatsApp el aviso de una votación.
- 138 pruebas de la API + reglas SQL, todas pasan.

## 0.5 · 28-oct-2026 · Alerta vecinal y dos apps (Admin y Miembros)
- **Alerta vecinal (botón SOS)**: 4 botones grandes (Seguridad, Emergencia médica, Incendio, Otra emergencia). Quien avisa confirma que es el dueño del teléfono con huella, rostro, patrón o PIN (en la web, con su clave) y la alerta sale con su nombre y su casa.
  - Avisa a las casas cercanas inscritas (por defecto 3 a cada lado: si avisa la 28, suenan de la 25 a la 31), a la familia de la misma casa y a la junta. Incendio avisa a todo el condominio; cualquier alerta se puede ampliar.
  - Los teléfonos suenan como alarma (sirena y vibración) con la app abierta; con la app cerrada, cuando se configure Firebase.
  - Los vecinos responden: "Voy en camino", "Tengo vehículo disponible", "Llamé a las autoridades" o "No puedo"; quien pidió ayuda ve quién viene, su casa, si tiene vehículo o es personal de salud, y puede llamarlo.
  - Participar es voluntario. Contra el abuso: una alerta activa a la vez, máximo 3 por día, la junta marca falsas alarmas y puede suspender; las alertas olvidadas se cierran solas a las 3 horas.
  - La junta activa la red, fija el radio y ajusta la cercanía de las casas (calle/bloque y posición).
- **Dos apps desde el mismo código**: Vecinos ZPro Junta (junta) y Vecinos ZPro (vecinos), con íconos distintos. La de administración comparte un **enlace de invitación** (QR, WhatsApp) para que cada vecino entre eligiendo su casa; la junta aprueba y recibe aviso de cada solicitud.
- Las APK de prueba pueden conectarse a un servidor de la red local o funcionar en modo demostración.
- Proyecto Android con los dos sabores, canal "Alerta vecinal" con sonido de alarma, script `app/compilar_apk.ps1` y compilación en GitHub (`.github/workflows/apk-prueba.yml`).
- 128 pruebas de la API + reglas SQL, todas pasan.

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
