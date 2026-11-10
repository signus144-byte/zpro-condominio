# Contrato de la API · Vecinos ZPro v0.8

Base: `/api/v1`. JSON en camelCase. Los tipos de respuesta están en `compartido/tipos.ts` (app) y
`compartido/plataforma.ts` (consola): **el servidor devuelve exactamente esos tipos**.

- **Sesión:** cabecera `Authorization: Bearer <acceso>`. El token de acceso dura 15 min; la app lo renueva con `POST auth/refrescar`.
- **Errores:** `{ "error": "mensaje para el usuario", "codigo": "..." }` con estado 400 (datos), 401 (sin sesión), 403 (sin permiso), 404, 409 (duplicado), 410 (archivo vencido), 413 (archivo grande), 429 (demasiados intentos).
- **Permisos:** los decide la base de datos (RLS). El servidor solo traduce. `:cid` = id del condominio.
- **Archivos:** `multipart/form-data`, máx. 25 MB por archivo. Las URLs de archivos que devuelve la API son **firmadas** (`/api/v1/archivos/f/<token>`, válidas 1 h) y sirven directo en `<img src>`.
- **Fechas:** `periodo` = `AAAA-MM-01`; fechas `AAAA-MM-DD`; instantes ISO 8601.
- Estado: ✅ hecho y probado · 🔲 por hacer.

## 1. Cuentas (`src/auth/rutas.ts`) ✅

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| POST `auth/registro` | `{nombre, correo, clave, telefono?}` | 201 `SesionTokens` (+ correo de verificación) |
| POST `auth/entrar` | `{correo, clave}` | `SesionTokens` · 401 · 429 (5 intentos → 15 min) |
| POST `auth/refrescar` | `{refresco}` | `SesionTokens` (el refresco rota; reusar uno viejo cierra todas las sesiones) |
| POST `auth/salir` | `{refresco}` | 204 |
| POST `auth/olvide` | `{correo}` | 202 siempre (correo con enlace `URL_APP/#/restablecer?t=…`, 1 h) |
| POST `auth/restablecer` | `{token, clave}` | 204 (cierra todas las sesiones) |
| POST `auth/verificar-correo` | `{token}` | 204 |
| POST `auth/cambiar-clave` | `{actual, nueva}` | 204 |
| GET `auth/yo` | — | `Yo` |
| PATCH `auth/yo` | `{nombre?, telefono?, avisosPorCorreo?}` | 204 |
| POST `auth/unirse` | `{codigo}` | `{estado: 'pendiente' \| 'aprobada'}` |
| POST `auth/activar-condominio` | `{codigo}` | `{condominioId}` |
| POST `auth/dispositivos` | `{token, plataforma}` | 204 (token de notificaciones push) |

## 2. Condominio (`src/rutas/condominio.ts`) ✅

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| GET `c/:cid` | — | `Condominio` (incluye `chatVecinos`) |
| PUT `c/:cid/chat-vecinos` | `{activo}` | 204 (presidente o administrador; queda en la bitácora y se avisa a todos) |
| GET `c/:cid/marca` | — | `Marca` |
| PATCH `c/:cid/marca` | multipart: campos de `Marca` + archivos `logo`, `fotoEntrada` | 204 |
| GET `c/:cid/cuentas` | — | `CuentaFinanciera[]` (v0.9: `bancoCodigo, titular, documento, telefono, numeroCuenta, correo, nota, qrUrl, actualizadoEn, actualizadoPor`; `datosPago` es el resumen de una línea) |
| POST `c/:cid/cuentas` | `{nombre, tipo}` (`banco_bs·banco_usd·caja·zelle·usdt`) | 201 `{id}` (finanzas) |
| PUT `c/:cid/cuentas/:id` | `DatosCuentaPago` (campo ausente = no se toca; `null` o `''` = se borra) | 204 (finanzas). Se normaliza (sin guiones ni puntos) y valida con `compartido/bancos.ts`: banco de la lista, celular de 11 dígitos (acepta +58), cédula o RIF con letra V/E/J/G/P, cuenta de 20 dígitos que empiece por el código del banco, correo. Cada cambio avisa a **toda la junta menos a quien lo hizo** (`datos_pago`: quién y qué cambió) y sella `actualizadoEn/Por` |
| PUT `c/:cid/cuentas/:id/qr` | multipart: `qr` (imagen) | 204 (finanzas). Se re-codifica en PNG; se avisa a la junta. La app ya lo envía leído y redibujado nítido desde la captura o la foto |
| DELETE `c/:cid/cuentas/:id/qr` · DELETE `c/:cid/cuentas/:id` | — | 204 · 204 (la cuenta queda inactiva; el fondo de reserva no se quita → 400) |
| GET `tasa-bcv?fecha=` | — | `TasaBcv` (v0.7): tasa que rige ese día (por defecto hoy en Caracas). `usdVes = null` si **no hay dos fuentes que coincidan** o no se comprobó vigente ese día; `motivo` lo explica |
| POST `c/:cid/tasa-bcv` | `{usdVes, fecha?}` | `ResultadoConfirmarTasa` (junta con finanzas). La junta cuenta como **una** fuente; con otra que coincida queda verificada |
| GET `c/:cid/tasa-bcv/lecturas` | — | `LecturaTasa[]`: qué dijo cada fuente en 24 h (junta) |
| GET `c/:cid/avisos` · POST · DELETE `c/:cid/avisos/:id` | `{titulo, cuerpo, fijado?}` | `Aviso[]` · 201 `{id}` · 204 |
| POST `archivos/firmar` | `{bucket, nombre}` | `{url}` |
| GET `archivos/f/:token` | — | bytes del archivo |

## 3. Finanzas (`src/rutas/finanzas.ts`) ✅

| Método y ruta | Cuerpo / consulta | Respuesta |
|---|---|---|
| GET `c/:cid/panel` | — | `ResumenPanel` (junta) |
| GET `c/:cid/unidades` | — | `UnidadConSaldo[]` (junta: todas; residente: la suya) |
| GET `c/:cid/unidades/:uid/estado-cuenta` | — | `EstadoCuenta` (`comprobanteUrl` firmada) |
| GET `c/:cid/pagos?estado=reportado\|todos&mes=AAAA-MM-01` | — | `Pago[]` (junta) con `destinos` (lo elegido) y `aplicaciones` (cómo se descontó) |
| POST `c/:cid/pagos` | multipart: `unidadId, fechaPago, metodo, moneda, monto, referencia?, bancoOrigen?, cuentaDestinoId?, nota?, cargoIds?` (JSON `["id",…]` o `id1,id2`) + archivo `comprobante` | 201 `{id}` · en Bs: 400 si la tasa BCV de `fechaPago` no está verificada |
| POST `c/:cid/pagos/:id/confirmar` | `{cuentaDestinoId?, cargoIds?}` | 204 · `cargoIds` cambia a qué deudas va antes de aprobar |
| GET `c/:cid/reportes/mensual?periodo=` | — | `ReporteDelMes` (junta): el cierre guardado o, si no se ha cerrado, en vivo |
| POST `c/:cid/reportes/mensual/cerrar` | `{periodo}` | `{cerradoEn}` (finanzas; solo meses terminados; se puede volver a cerrar) |
| GET `c/:cid/cierres` | — | `CierreMes[]` |
| POST `c/:cid/pagos/:id/rechazar` | `{motivo}` | 204 |
| GET `c/:cid/gastos?periodo=` | — | `Gasto[]` (todos los miembros; `facturaUrl` firmada) |
| POST `c/:cid/gastos` | multipart: campos de `NuevoGasto` + archivo `factura` | 201 `{id}` |
| POST `c/:cid/recibos` | `{periodo}` | `{emitidos}` |
| GET `c/:cid/conciliacion/movimientos?pendientes=1` | — | `MovimientoBancario[]` |
| POST `c/:cid/conciliacion/extractos` | `{cuentaId, archivo, movimientos: {fecha, referencia, descripcion, monto}[]}` (la app lee el Excel/CSV) | `ResultadoExtracto` |
| POST `c/:cid/conciliacion/movimientos/:id/asignar` | `{unidadId}` | 204 |
| GET `c/:cid/zentapro/facturas` | — | `FacturaZentaPro[]` (junta con finanzas) |
| GET `zentapro/datos-pago` | — | `DatosPagoZentaPro` |
| POST `c/:cid/zentapro/facturas/:id/pagos` | `{metodo: 'pago_movil'\|'transferencia', montoVes, referencia, fechaPago?}` | 201 · **solo bolívares**, convertidos a la tasa BCV del día del pago; abonos parciales |

## 4. Partidas y votaciones (`src/rutas/partidas.ts`) ✅

v0.7: cada `Partida` trae `avance` (emitido, cobrado, casas al día). GET `c/:cid/partidas/:pid/cobro` → `CobroPartidaCasa[]` (junta): quién pagó y quién no.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| GET `c/:cid/partidas` | — | `Partida[]` (con votación, resultados y mi voto) |
| POST `c/:cid/partidas` | `NuevaPartida` | 201 `{id}` |
| POST `c/:cid/votaciones/:vid/votar` | `{opcionId, unidadId?}` | 204 (por defecto, la unidad del propietario en sesión; 403 si no es propietario) |
| POST `c/:cid/votaciones/:vid/cerrar` | — | `{aprobada}` |
| GET `c/:cid/votaciones/:vid/acta` | — | `FilaActa[]` (junta) |

## 5. Reportes (`src/rutas/reportes.ts`) ✅

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| GET `c/:cid/reportes` | — | `Reporte[]` (visibles + `mis_reportes()`; `fotos` = URLs firmadas) |
| POST `c/:cid/reportes` | multipart: `categoria, titulo, descripcion, ubicacion, anonimo, visibilidad` + archivos `fotos` (≤4) | 201 `{id}` — si es anónimo, las fotos se re-codifican (sin EXIF/GPS) y se guardan **sin dueño** |
| PATCH `c/:cid/reportes/:id` | `{estado, respuesta?}` | 204 (junta; `respuesta` = comentario oficial) |
| GET `c/:cid/reportes/:id/comentarios` · POST | `{texto, oficial?}` | `ComentarioReporte[]` · 201 (el autor de un reporte anónimo comenta como "Autor del reporte") |

## 6. Documentos (`src/rutas/documentos.ts`) ✅

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| POST `c/:cid/documentos` | `NuevoDocumento` | `{codigo}` |
| POST `c/:cid/unidades/:uid/solvencia` | — | `{codigo}` (400 si debe) |
| GET `verificar/:codigo` | — | sin sesión: `{tipo, condominio, unidad, emitidoEn, vigente}` · 404 |
| GET `/verificar/:codigo` (fuera de /api) | — | página HTML legible para quien escanea el QR |

## 7. Miembros y accesos de la junta (`src/rutas/miembros.ts`) ✅

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| GET `c/:cid/miembros` | — | `MiembroCondominio[]` (junta) |
| PATCH `c/:cid/miembros/:usuarioId` | `{rol?, activo?, rolActual?}` | 204 (presidente/administrador; siempre queda al menos uno activo) |
| GET `c/:cid/codigos` · POST `c/:cid/codigos` · DELETE `c/:cid/codigos/:codigo` | `{unidadIds?, todas?, rol?, usosMax?, dias?, requiereAprobacion?}` (rol de junta sin casas = código de junta) | `CodigoAcceso[]` (201 al crear) |
| GET `c/:cid/solicitudes` · POST `c/:cid/solicitudes/:id` | `{aprobar}` | `SolicitudIngresoJunta[]` · 204 |
| GET `c/:cid/directorio` · PATCH `c/:cid/directorio/yo` | `{mostrar}` | `CasaDirectorio[]` · 204 |

## 8. Chat (`src/rutas/chat.ts`) ✅

Pruebas: `pruebas/chat.test.ts` (16), `pruebas/tiempo-real.test.ts` (6, sockets reales). SQL propio: `0013_chat_servidor.sql`.
El envío acepta también JSON `{texto, comoJunta?, respondeA?}`. Si quien escribe no tiene casa en la conversación y es junta, escribe como junta automáticamente.
Títulos de la bandeja con nombres del directorio ("Apto B-33 · Elena Castro"). WebSocket: además de `EventoTiempoReal`, responde
`{tipo:'suscrito', conversacionId}` o `{tipo:'error', conversacionId?, mensaje}` a cada `suscribir`; acepta `{tipo:'desuscribir'}`;
cierra con 4401 (token inválido) o 4001 (token vencido: reconectar con uno nuevo). Extra: GET `c/:cid/denuncias` (junta) → denuncias con el mensaje denunciado.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| GET `c/:cid/conversaciones` | — | `Conversacion[]` (función `bandeja`) |
| POST `c/:cid/conversaciones/casa` | `{unidadId, comoJunta?}` | `{id}` (residente: casa↔casa; junta sin casa o con `comoJunta`: junta↔casa) |
| POST `c/:cid/conversaciones/junta` | — | `{id}` (residente → junta) |
| POST `c/:cid/salas` | `{tipo, titulo, unidades}` | `{id}` |
| GET `c/:cid/conversaciones/:id/mensajes?antes=ISO&limite=50` | — | `Mensaje[]` (orden cronológico) |
| POST `c/:cid/conversaciones/:id/mensajes` | multipart: `texto?, comoJunta?` + archivo `archivo?` | 201 `Mensaje` |
| PATCH `c/:cid/mensajes/:id` | `{texto?}` o `{eliminar: true}` | 204 |
| POST `c/:cid/conversaciones/:id/leido` | — | 204 |
| POST `c/:cid/conversaciones/:id/silenciar` | `{silenciar}` | 204 |
| GET `c/:cid/chat/estado` | — | `{bloqueadas: string[], silenciadas: string[]}` |
| POST `c/:cid/bloqueos` · DELETE `c/:cid/bloqueos/:unidadId` | `{unidadId}` | 204 |
| POST `c/:cid/mensajes/:id/denunciar` | `{motivo}` | 204 |
| WS `tiempo-real?token=<acceso>` | cliente envía `{tipo:'suscribir', conversacionId}` / `{tipo:'ping'}` | `EventoTiempoReal` |

**Chat entre vecinos (v0.4):** apagado por defecto en cada condominio. Apagado: `conversaciones/casa` de un residente → 400
"La junta de condominio no ha habilitado el chat entre vecinos"; las conversaciones casa↔casa existentes llegan con `puedoEscribir: false`
y escribir en ellas → 403. Casa↔junta, grupos y canal no cambian.

## 8b. Notificaciones (`src/rutas/notificaciones.ts`) ✅ — v0.4

Las crea la base de datos (`0018_notificaciones.sql`); llegan al instante por WebSocket (`{tipo:'notificacion', notificacion}`),
por push (si hay Firebase) y por correo las marcadas como importantes (si la persona tiene el correo verificado y `avisosPorCorreo`).

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| GET `notificaciones?condominioId=&limite=50` | — | `BandejaNotificaciones` `{noLeidas, notificaciones}` |
| POST `notificaciones/leidas` | `{ids?}` (sin ids = todas) | `{marcadas}` |

| Tipo | Para quién | Cuándo | Correo |
|---|---|---|---|
| `pago_reportado` | presidente, tesorero, administrador | una casa reporta un pago | no |
| `pago_confirmado` | todas las personas de la casa | la junta (o la conciliación) aprueba el pago; incluye el saldo | sí |
| `pago_rechazado` | todas las personas de la casa | la junta lo rechaza; incluye el motivo | sí |
| `pagos_pendientes` | presidente, tesorero, administrador | cada día 8:00 mientras haya pagos sin revisar (uno por día) | sí |
| `chat_vecinos` | todos los miembros | la junta enciende o apaga el chat entre vecinos | no |

Pruebas: `pruebas/notificaciones.test.ts` y `pruebas/tiempo-real.test.ts` (WebSocket + correo reales).

## 8c. Alerta vecinal (`src/rutas/alertas.ts`) ✅ — v0.5

SQL: `0019_alerta_vecinal.sql`. Participar es voluntario; la junta siempre recibe las alertas. Cercanía = mismo sector
(por defecto el bloque) y a lo sumo `radio` posiciones (por defecto el número de la casa). Incendio avisa a todo el condominio.
Límites: una alerta activa por persona, 3 por 24 h; se cierran solas a las 3 h ("vencida"). Push con canal Android `alarma_vecinal`.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| GET `c/:cid/alerta` | — | `ConfigAlerta` |
| PUT `c/:cid/alerta/participacion` | `{activo, tieneVehiculo?, personalSalud?, telefono?}` | 204 (solo residentes con casa) |
| PUT `c/:cid/alerta/red` | `{activa, radio?}` | 204 (presidente o administrador; bitácora; aviso a todos al encender/apagar) |
| GET `c/:cid/alerta/participantes` | — | `ParticipanteAlerta[]` (junta) |
| POST `c/:cid/alerta/participantes/:usuarioId/suspender` | `{dias, motivo?}` (0 = reactivar) | 204 |
| GET · PUT `c/:cid/alerta/cercania` | `[{unidadId, sector, posicion}]` | `CercaniaUnidad[]` · `{actualizadas}` |
| POST `c/:cid/alertas` | `{tipo, nota?, verificacion: 'biometria'\|'credencial'\|'clave', clave?}` | 201 `AlertaVecinal` · 401 si la clave no coincide (web) · 400 con el motivo si no puede |
| GET `c/:cid/alertas?activas=si` · GET `c/:cid/alertas/:id` | — | `AlertaVecinal[]` · `AlertaVecinal` (404 si no fue avisado) |
| POST `c/:cid/alertas/:id/visto` | — | 204 |
| POST `c/:cid/alertas/:id/responder` | `{respuesta: 'voy'\|'vehiculo'\|'llamo_autoridades'\|'no_puedo'}` | `AlertaVecinal` |
| POST `c/:cid/alertas/:id/cerrar` | `{estado: 'atendida'\|'falsa_alarma'\|'cancelada', nota?}` | `AlertaVecinal` (quien la emitió o la junta) |
| POST `c/:cid/alertas/:id/ampliar` | — | `AlertaVecinal` (a todo el condominio) |
| WS | — | `{tipo:'alerta', alertaId, evento}` a emisor, avisados y junta; además `notificacion` tipo `alerta` / `alerta_cerrada` |

## 8d. Enlace de invitación (`src/rutas/alertas.ts`) ✅ — v0.5

SQL: `0020_enlace_invitacion.sql`. Un enlace por condominio (1 año, muchos usos, regenerable); quien entra elige su casa y la junta aprueba.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| GET `c/:cid/invitacion` · POST `c/:cid/invitacion/regenerar` | — | `EnlaceInvitacion` (presidente o administrador) |
| GET `invitacion/:codigo` | — (pública) | `InfoInvitacion` (condominio y etiquetas de casas, sin nombres) |
| POST `invitacion/:codigo/unirse` | `{unidadId, rol: 'propietario'\|'inquilino'}` | `{estado: 'pendiente'\|'aprobada'}` (con sesión) |

Cada solicitud de ingreso nueva notifica a presidencia/administración (`solicitud_ingreso`).

## 8e. Alcance de las cuotas especiales y difusión masiva (`src/rutas/difusion.ts`) ✅ — v0.6

SQL: `0021_alcance_y_difusion.sql`. Una cuota especial puede ser de todo el condominio o solo de algunas casas (una calle con
portón propio, un piso con su llave). Con alcance limitado **solo esas casas la ven** (RLS), **solo sus propietarios votan**
(el % se mide sobre ellas), el acta lista solo esas casas y **solo a ellas se les cobra** (por alícuota relativa o partes iguales).

`AlcanceCasas` = `{tipo:'todos'}` · `{tipo:'grupo', grupoId}` · `{tipo:'unidades', unidadIds, nombre?}`.
`AlcanceDifusion` = lo anterior · `{tipo:'partida', partidaId}` (las casas de la cuota) · `{tipo:'sin_votar', partidaId}`.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| POST `c/:cid/partidas` | + `alcance?: AlcanceCasas`, `difundir?: boolean` (por defecto sí) | 201 `{id, difusion: {id, unidades, personas} \| null}` |
| GET `c/:cid/partidas` | — | `Partida[]` con `alcance {tipo, nombre, unidades}`, `meAfecta`, `unidadIds` (solo junta), `votacion.sinVotar` (solo junta) |
| GET `c/:cid/unidades-alcance` | — | `UnidadAlcance[]` (bloque, sector, piso, alícuota) · junta |
| GET · POST `c/:cid/grupos` · PUT · DELETE `c/:cid/grupos/:gid` | `{nombre, descripcion?, unidadIds}` | `GrupoUnidades` · junta; nombre único sin importar mayúsculas ni acentos (409) |
| POST `c/:cid/difusiones/previa` | `{alcance, soloPropietarios?}` | `{unidades, personas}` |
| POST `c/:cid/difusiones` | `{titulo, cuerpo, alcance, soloPropietarios?, partidaId?}` | 201 `{id, unidades, personas}` · junta · máx. 20 por día |
| GET `c/:cid/difusiones` | — | `Difusion[]` (historial) · junta |
| PUT `c/:cid/alerta/cercania` | + `piso` por casa | el piso se deduce del número si no se carga (34 → 3, 1204 → 12) |

Cada difusión llega como notificación `difusion` (app, push y correo) a las personas de esas casas, salvo quien la envía.

## 8f. Transparencia y convivencia (`src/rutas/convivencia.ts`) ✅ — v0.8

| Método y ruta | Cuerpo / consulta | Respuesta |
|---|---|---|
| GET `c/:cid/convivencia` | — | `ConfigConvivencia` |
| PUT `c/:cid/convivencia` | `{morososPublicos: 'no'\|'casas'\|'casas_y_montos', morososMesesMin, mensajesAnonimos}` | 204 (presidente o administrador; bitácora; al encender la lista se avisa a todos) |
| PUT `c/:cid/finanzas-publicas` | `{modo: 'no'\|'totales'\|'detalle'}` | 204 (v0.9, presidente o administrador; bitácora). Por defecto `'no'`: los vecinos no ven gastos, saldos ni el avance de las cuotas especiales. Al publicar se avisa a todos; al apagar, solo a la junta |
| GET `c/:cid/finanzas-publicas?periodo=AAAA-MM-01` | — | `FinanzasPublicas \| null` (null si no se publica; la junta siempre recibe la vista previa). Nunca trae datos por casa. `cuentas` solo con `'detalle'`; cada gasto: `GET c/:cid/gastos` (RLS: junta, o vecinos con `'detalle'`) |
| GET `c/:cid/morosos?vistaPrevia=1` | — | `MorosoPublico[]` (sin nombres; `montoVencidoUsd` null si no se publican montos). 400 si está apagada (la junta puede pedir vista previa) |
| POST `c/:cid/anonimos` | multipart: `unidadId, categoria, texto, tambienJunta, titulo?` + `fotos` (≤ 4) | 201 `{id, reporteId}` · límites: 3/día, 1/día a la misma casa; no a su propia casa; la casa debe usar la app |
| GET `c/:cid/anonimos` | — | `MensajeAnonimo[]` (recibidos por mis casas y enviados por mí; nunca el remitente) |
| POST `c/:cid/anonimos/:id/leido` · `/responder {texto}` · `/denunciar {motivo}` | | 204 |
| GET `c/:cid/anonimos/denuncias` | — | `DenunciaAnonima[]` (junta; contenido, casa y motivo, sin remitente) |
| POST `c/:cid/anonimos/:id/revisar` | `{accion: 'bloquear'\|'descartar', dias?}` | 204 · bloquear suspende al remitente sin revelarlo |

POST `c/:cid/reportes` acepta `unidadId` (casa relacionada; solo con visibilidad `presidencia`). `Reporte` trae `unidadId` y `unidad`.

## 9. Plataforma / consola master (`src/rutas/plataforma.ts`) ✅

Solo `plataforma_admins` (cualquier otro usuario: 403 en todas). Roles: crear/estado/códigos = dueño o soporte;
emitir facturas, confirmar o rechazar pagos, precio especial, suspender, tasa = dueño o finanzas; editar planes = dueño; soporte/usuarios y solicitudes = dueño o soporte; equipo (escribir) = dueño.
Respuestas con los tipos de `compartido/plataforma.ts`; métodos 1:1 con `ApiConsola`. Respuestas especiales: crear → 201 `{id, codigoActivacion}`;
`codigo-activacion` → `{codigo}`; `codigos-unidades` → `CodigoUnidad[]` (invalida los códigos anteriores sin usar); `suspender-morosos` → `{suspendidos}`;
el resto de acciones → 204. Alta en una transacción con validación de alícuotas (100 % ± 0,01) y unidades sin repetir; crea 4 cuentas de pago vacías.
**Planes por tamaño (v0.4):** precio global al mes según la cantidad de unidades (Pequeño ≤50 $40 · Mediano ≤150 $70 · Grande ≤300 $110 ·
Extra grande $150; editables). El plan se asigna solo al cargar unidades. **Cobro solo en bolívares**, a la tasa BCV del día de cada pago.
Pruebas: `pruebas/plataforma.test.ts` (14). SQL propio: `0014_plataforma_servidor.sql`, `0016_planes_y_cobro_bs.sql`.
`GET plataforma/planes`, `GET plataforma/condominios`, `GET plataforma/condominios/:id`, `POST plataforma/condominios` (multipart con logo, foto y `unidades` en JSON),
`POST plataforma/condominios/:id/estado {estado}`, `POST …/:id/precio {precioEspecialUsd|null, nota?}`, `POST …/:id/codigo-activacion`, `POST …/:id/codigos-unidades`,
`PATCH plataforma/planes/:id {nombre?, descripcion?, precioUsdMes?, hastaUnidades?}` → `Plan[]` (reubica a todos los condominios; debe quedar un plan sin límite),
`GET plataforma/facturas?periodo=`, `POST plataforma/facturas/emitir {periodo}`, `GET plataforma/pagos?estado=`, `POST plataforma/pagos/:id/confirmar`, `POST plataforma/pagos/:id/rechazar {motivo}`,
`POST plataforma/suspender-morosos {diasGracia}`, `POST plataforma/tasa-bcv {usdVes}`, `GET plataforma/soporte/usuarios?q=`, `GET plataforma/soporte/solicitudes`,
`GET plataforma/equipo`, `POST plataforma/equipo {correo, rol}`, `PATCH plataforma/equipo/:usuarioId {rol?, activo?}`.

## 10. Integraciones (`src/rutas/integraciones.ts`) ✅

| Ruta | Qué hace |
|---|---|
| POST `webhooks/banco?t=<webhook_token>` | Banco/agregador avisa un crédito → `movimientos_bancarios` + `conciliar_movimiento()` → `{ok, duplicado, conciliado}` |

Adaptador `generico`: JSON `{fecha, referencia, monto, descripcion?}` y `x-firma` = HMAC-SHA256 (hex) del cuerpo exacto con el secreto
`SECRETOS_BANCOS[conexion.secreto_vault]`. 401 firma inválida · 404 token desconocido · 503 sin secreto configurado · idempotente.
Pruebas: `pruebas/webhook.test.ts` (6).

## 11. Tareas programadas (`src/tareas/`) ✅ — `croner`, hora de Caracas

Funciones exportadas y probadas (`pruebas/tareas.test.ts`): `actualizarTasaBcv(ctx, fetch?)` (lee BCV y DolarApi, registra cada lectura y
`consolidar_tasa()` decide: solo con dos fuentes que coinciden), `extraerTasaBcv(html)`, `extraerDolarApi(json)`, `avisarTasaSinVerificar(ctx)`,
`cierreAutomatico(ctx)`, `purgarChat(ctx)` (también borra la fila de `storage.objects`), `facturarMes(ctx, fecha)`, `suspenderMorosos(ctx, dias)`,
`recordarPagosPendientes(ctx)`.
Push en `src/push.ts` (`crearPush`), llamado por el hub de tiempo real en cada mensaje nuevo y cambio de estado de pago.

| Tarea | Cuándo | Qué |
|---|---|---|
| Tasa BCV | cada 30 min, todos los días, y al arrancar | Lee bcv.org.ve y DolarApi → `lecturas_tasa` → `consolidar_tasa()`. Certificado intermedio del BCV opcional: `BCV_CA_EXTRA=/ruta.pem` (nunca se apaga TLS) |
| Aviso de tasa | 9:05 y 13:05 | `avisar_tasa_sin_verificar()`: si hoy no hay tasa con dos fuentes, avisa a la junta (una vez al día) |
| Cierre del mes | día 1, 7:30 | `cierre_automatico()`: guarda el reporte del mes anterior y avisa a la junta |
| Purga | 3:00 | `purgar_adjuntos_vencidos()` + borrar bytes; `purgar_mensajes_antiguos()`; archivos huérfanos |
| Facturación ZentaPro | día 1, 6:00 | `facturar_condominio()` a cada condominio activo |
| Suspensión | diario 7:00 | `suspender_morosos_plataforma(10)` |
| Vencer alertas | cada 15 min | `vencer_alertas(3)`: alertas activas de más de 3 h → "vencida" |
| Recordatorio de pagos | diario 8:00 | `recordar_pagos_pendientes()`: la junta recibe aviso mientras haya pagos sin aprobar o rechazar |
| Push | evento | `zpro_mensajes` (chat) y `zpro_notificaciones` (pagos, recordatorios) → Firebase Cloud Messaging (si hay credenciales) |
