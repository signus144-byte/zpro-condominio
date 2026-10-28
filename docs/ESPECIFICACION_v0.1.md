# ZPro Condominio · Especificación v0.1 (esqueleto)

*27-oct-2026 · Technical Digital TD, C.A.*

## 1. Qué es

Una app con dos caras sobre la misma base de datos:

- **Presidencia** (junta de condominio y administrador): la columna financiera del condominio. Gastos, recibos, cobranza, saldos por cuenta, morosidad, partidas especiales, votaciones y reportes recibidos.
- **Residentes**: estado de cuenta, reporte de pagos con captura, avisos, reportes de irregularidades (con nombre o anónimos, con fotos), votaciones y partidas especiales.

Regla central: **el residente reporta; Tesorería confirma.** Ningún saldo cambia hasta que un miembro de la junta con permiso de finanzas confirme el pago contra el banco.

## 2. Roles

| Rol | Ve | Puede |
|---|---|---|
| Presidente | Todo el condominio | Todo; gestionar miembros |
| Tesorero | Todo el condominio | Finanzas: confirmar/rechazar pagos, gastos, recibos |
| Vocal | Todo el condominio | Partidas, votaciones, reportes (sin tocar dinero) |
| Administrador (persona o empresa contratada) | Todo el condominio | Igual que presidente |
| Propietario | Su apartamento, gastos del condominio, reportes públicos | Reportar pagos, votar (1 voto por apartamento), reportar irregularidades |
| Inquilino | Su apartamento, gastos, reportes públicos | Reportar pagos y reportes. **No vota** |

## 3. Módulos

### 3.1 Columna financiera (Presidencia)
- **Panel**: facturado del mes, cobrado del mes y % de cobranza, gastos del mes, deuda total, apartamentos morosos, pagos por confirmar, reportes abiertos, saldo de cada cuenta.
- **Cuentas**: banco en Bs (Pago Móvil), banco en $, Zelle, USDT, caja, fondo de reserva. Cada una con saldo inicial al migrar. Saldo = inicial + pagos confirmados que entraron − gastos pagados desde ella.
- **Gastos**: comunes (se reparten por alícuota), no comunes (se cargan a un apartamento) y de partida especial. En $ o Bs con tasa BCV. Foto de factura. **Todos los residentes ven la relación de gastos.**
- **Recibos**: un botón por mes. Reparte gastos comunes por alícuota, suma el fondo de reserva (% configurable), cuotas de partidas aprobadas y gastos no comunes. No se puede emitir dos veces el mismo mes.
- **Pagos**: bandeja de "por confirmar" con monto, equivalencia en $, referencia, banco y captura. Confirmar o rechazar con motivo.
- **Apartamentos**: lista ordenada por deuda y estado de cuenta de cada uno.
- **Bitácora**: cada cambio en pagos, gastos, cargos y partidas queda registrado (quién, cuándo, antes y después).

### 3.2 Residentes
- **Inicio**: saldo en $ y su equivalente en Bs a tasa BCV, avisos fijados, accesos rápidos.
- **Estado de cuenta**: recibos por mes con su desglose y los pagos con su estado.
- **Reportar pago**: método (Pago Móvil, transferencia, Zelle, efectivo, USDT), datos de la cuenta del condominio, monto, fecha, referencia, banco y captura.
- **Reportes**: categoría, título, descripción, ubicación, fotos; **anónimo** sí/no; visibilidad "solo Presidencia" o "compartir con vecinos". Límite de 5 por día.
- **Votaciones y partidas**: ver presupuesto, cuánto le toca por cuota y votar.

### 3.3 Partidas especiales y votaciones
- Presidencia crea la partida: título, descripción y presupuestos recibidos, monto, número de cuotas, mes de la primera cuota, reparto (por alícuota o partes iguales).
- Opcional: someterla a votación con umbral (50,01 %, 66,67 % o 75 % del total del condominio).
- Un voto por apartamento, solo del propietario. Peso = alícuota (o 1 por apartamento).
- Al cerrar: si "Aprobar" alcanza el umbral, la partida queda **aprobada** y sus cuotas entran solas en los recibos de los meses siguientes.

### 3.4 Reportes anónimos (cómo se garantiza)
- El reporte anónimo se guarda **sin autor**. La autoría va a una tabla aparte que **ninguna pantalla puede leer**, ni la de Presidencia. Solo la usa el servidor para el límite anti-abuso.
- El autor sigue su propio caso en "Mis reportes".
- El denunciado no ve un reporte dirigido solo a Presidencia.
- Lo que la app le dice al usuario: *"Presidencia y los vecinos no verán su nombre"*. No se le dice "nadie lo sabrá", porque el operador de la plataforma sí podría.

## 4. Arquitectura

| Capa | Elección | Por qué |
|---|---|---|
| App | React + TypeScript + Vite, empaquetada con **Capacitor 8** para Android | Mismo enfoque que Léeme Hoy; una sola base de código para Android, web e iOS después |
| Datos | **Supabase** (Postgres + autenticación + archivos) | Las reglas de seguridad viven en la base de datos (RLS), no en la app. Es código abierto: si el servicio en la nube deja de estar disponible desde Venezuela, se autoaloja en un VPS sin reescribir nada |
| Modo demo | Datos ficticios en memoria | Para mostrar la app a una junta sin crear cuentas |

Archivos clave:

```
app/
├── supabase/migrations/0001_esquema.sql             tablas, tipos, vistas
├── supabase/migrations/0002_funciones_y_seguridad.sql  reglas de negocio + RLS
├── supabase/migrations/0003_almacenamiento.sql      fotos, comprobantes, facturas
├── supabase/seed.sql                                condominio de demostración
├── supabase/pruebas/reglas.test.mjs                 27 pruebas de reglas y permisos
├── src/data/api.ts        contrato de datos
├── src/data/demo.ts       modo demo
├── src/data/supabase.ts   producción
└── src/screens/           pantallas (residente, presidencia, compartidas)
```

## 5. Qué está probado

- **Base de datos (27 pruebas, todas pasan)**: reparto por alícuota y fondo de reserva; no emitir dos veces; el residente no puede confirmarse un pago, reportar por otro apartamento, repetir una referencia ni ver pagos ajenos; conversión Bs→$ con la tasa BCV; un voto por apartamento y solo del propietario; resultado ponderado; aprobación por umbral; cuotas de la partida aprobada en el recibo siguiente; reporte anónimo sin autor para Presidencia; límite de 5 por día; bitácora solo para la junta.
- **App (modo demo)**: recorrido completo en navegador (reportar pago → confirmar/rechazar; reporte anónimo → llega sin nombre; votar → cerrar votación; emitir recibos), sin errores de consola.
- **Sin probar todavía**: la conexión a un proyecto Supabase real (`src/data/supabase.ts` compila, pero no se ha ejecutado contra un servidor).

## 6. Pendientes antes del piloto

1. **Fotos en reportes anónimos.** Supabase guarda quién subió cada archivo. Hace falta una función de servidor (`subir-foto-reporte`) que suba las fotos sin dueño. Mientras tanto, en producción el reporte anónimo va sin fotos (la app lo avisa).
2. **Tasa BCV automática**: tarea diaria que la cargue en `tasas_bcv`. Hoy se carga a mano.
3. **Alta de residentes**: invitación por enlace o código por apartamento, aprobada por Presidencia.
4. **Notificaciones**: aviso al residente cuando confirman o rechazan su pago y cuando abre una votación.
5. **Solvencia en PDF** con código verificable (Recinta ya lo ofrece; es lo que más piden).
6. **Traspasos entre cuentas** (p. ej. banco → fondo de reserva) y conciliación bancaria.
7. **Comentarios y respuesta oficial** en los reportes (la tabla existe; falta la pantalla).
8. **Validez legal de las votaciones**: revisar con un abogado (ver estudio de mercado).
9. **Confirmar nombre y paquete**: `ZPro Condominio` y `com.zentapro.condominio` son provisionales. El paquete no se puede cambiar después de publicar.

## 7. Modelo de negocio (propuesta para validar)

- Cobro mensual por condominio según el número de apartamentos, pagado por Pago Móvil, Zelle o USDT en zentapro.com (no dentro de Google Play, porque es un servicio a la junta).
- Referencia de precio: Recinta, desde USD 39/mes.
- Piloto sugerido en el estudio del 24-oct: 2 edificios en Aragua, feb–abr 2027. Como ya hay interés de Presidencia, se puede adelantar.
