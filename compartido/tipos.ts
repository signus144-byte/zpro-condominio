// Tipos de dominio compartidos por la app, la consola y el servidor (única fuente de verdad).

export type Rol = 'presidente' | 'tesorero' | 'vocal' | 'administrador' | 'propietario' | 'inquilino';
export type Moneda = 'USD' | 'VES';
export type MetodoPago = 'pago_movil' | 'transferencia' | 'zelle' | 'efectivo_usd' | 'efectivo_bs' | 'usdt' | 'otro';
export type EstadoPago = 'reportado' | 'confirmado' | 'rechazado';
export type TipoCargo = 'ordinaria' | 'fondo_reserva' | 'extraordinaria' | 'no_comun' | 'multa' | 'ajuste';
export type EstadoPartida = 'borrador' | 'en_votacion' | 'aprobada' | 'rechazada' | 'en_ejecucion' | 'cerrada';
export type Ponderacion = 'alicuota' | 'unidad';
export type CategoriaReporte =
  | 'ruido' | 'dano_area_comun' | 'seguridad' | 'limpieza' | 'mascotas'
  | 'estacionamiento' | 'filtracion' | 'electricidad' | 'otro';
export type Visibilidad = 'presidencia' | 'comunidad';
export type EstadoReporte = 'nuevo' | 'en_revision' | 'en_proceso' | 'resuelto' | 'descartado';

export interface Sesion {
  usuarioId: string;
  nombre: string;
  rol: Rol;
  unidadId: string | null;     // null para junta sin apartamento asignado
  esJunta: boolean;            // presidente, tesorero, vocal, administrador
  manejaFinanzas: boolean;     // presidente, tesorero, administrador
  condominioId?: string;       // condominio activo (servidor propio: el usuario puede pertenecer a varios)
  condominio?: string;
  unidad?: string | null;      // seudónimo de la unidad: "Apto B-33", "Casa 28"
}

export interface Condominio {
  id: string; nombre: string; rif: string | null; direccion: string | null;
  fondoReservaPct: number; diaVencimiento: number;
  chatVecinos: boolean;              // la junta permite el chat casa ↔ casa (apagado por defecto)
}

export interface Unidad { id: string; bloque: string | null; numero: string; alicuota: number; propietario: string | null }
export interface UnidadConSaldo extends Unidad { cargosUsd: number; pagadoUsd: number; saldoUsd: number }

export interface CuentaFinanciera {
  id: string; nombre: string;
  tipo: 'banco_bs' | 'banco_usd' | 'caja' | 'zelle' | 'usdt' | 'fondo_reserva';
  moneda: Moneda; datosPago: string | null;
}

export interface Cargo { id: string; unidadId: string; periodo: string; tipo: TipoCargo; concepto: string; montoUsd: number }

export interface Pago {
  id: string; unidadId: string; unidadEtiqueta: string; fechaPago: string; metodo: MetodoPago; moneda: Moneda;
  monto: number; tasaBcv: number | null; montoUsd: number; referencia: string | null;
  bancoOrigen: string | null; comprobanteUrl: string | null; nota: string | null;
  estado: EstadoPago; motivoRechazo: string | null; creadoEn: string;
}

export interface NuevoPago {
  unidadId: string; fechaPago: string; metodo: MetodoPago; moneda: Moneda; monto: number;
  referencia?: string; bancoOrigen?: string; cuentaDestinoId?: string; nota?: string; comprobante?: Blob | null;
}

export interface EstadoCuenta { unidad: Unidad; cargos: Cargo[]; pagos: Pago[]; saldoUsd: number }

export interface Gasto {
  id: string; periodo: string; tipo: 'comun' | 'no_comun' | 'partida'; categoria: string; descripcion: string;
  moneda: Moneda; monto: number; tasaBcv: number | null; montoUsd: number; fechaGasto: string;
  facturaUrl: string | null; unidadId: string | null; partidaId: string | null; cuentaId: string | null;
}
export interface NuevoGasto {
  periodo: string; tipo: 'comun' | 'no_comun' | 'partida'; categoria: string; descripcion: string;
  moneda: Moneda; monto: number; tasaBcv?: number; unidadId?: string; partidaId?: string; cuentaId?: string;
  factura?: Blob | null;
}

export interface OpcionVoto { id: string; texto: string; orden: number; unidades: number; pesoPct: number }
export interface Votacion {
  id: string; titulo: string; ponderacion: Ponderacion; umbralPct: number;
  estado: 'borrador' | 'abierta' | 'cerrada' | 'anulada'; cierraEn: string | null;
  opciones: OpcionVoto[]; miVotoOpcionId: string | null;
}
export interface Partida {
  id: string; titulo: string; descripcion: string | null; presupuestoUsd: number; numeroCuotas: number;
  primeraCuota: string | null; reparto: Ponderacion; estado: EstadoPartida; creadoEn: string;
  votacion: Votacion | null;
  cuotaMiUnidadUsd: number | null;  // cuánto le tocaría pagar por cuota a la unidad del residente
}
export interface NuevaPartida {
  titulo: string; descripcion: string; presupuestoUsd: number; numeroCuotas: number; primeraCuota: string;
  reparto: Ponderacion; someterAVotacion: boolean; umbralPct: number; cierraEn: string | null;
}

export interface Reporte {
  id: string; categoria: CategoriaReporte; titulo: string; descripcion: string; ubicacion: string | null;
  anonimo: boolean; autorNombre: string | null; visibilidad: Visibilidad; estado: EstadoReporte;
  fotos: string[]; creadoEn: string; esMio: boolean;
}
export interface NuevoReporte {
  categoria: CategoriaReporte; titulo: string; descripcion: string; ubicacion: string;
  anonimo: boolean; visibilidad: Visibilidad; fotos: Blob[];
}

export interface Aviso { id: string; titulo: string; cuerpo: string; fijado: boolean; creadoEn: string }

export interface ResumenPanel {
  periodo: string;
  recaudadoMesUsd: number;
  facturadoMesUsd: number;
  gastosMesUsd: number;
  pagosPorConfirmar: number;
  unidadesMorosas: number;
  totalUnidades: number;
  deudaTotalUsd: number;
  reportesAbiertos: number;
  saldosCuentas: { nombre: string; moneda: Moneda; saldo: number }[];
}

// ---------------- v0.2: marca, documentos, directorio y chat ----------------

export interface Marca {
  nombre: string;                    // "Residencias Los Samanes"
  nombreAsociacion: string | null;   // "Asociación Civil de Propietarios Res. Los Samanes"
  rif: string | null; direccion: string | null; ciudad: string | null;
  telefono: string | null; correo: string | null;
  colorPrimario: string;             // "#0f4c4a"
  logoUrl: string | null;            // URL utilizable en <img> y para descargar los bytes
  fotoEntradaUrl: string | null;     // foto de la fachada o portón de la urbanización
}
export type CambiosMarca = Partial<Omit<Marca, 'logoUrl' | 'fotoEntradaUrl'>> & { logo?: Blob; fotoEntrada?: Blob };

export type TipoDocumento =
  | 'estado_cuenta' | 'recibo' | 'solvencia' | 'relacion_gastos' | 'acta_votacion'
  | 'convocatoria' | 'morosidad' | 'libro_ingresos_egresos' | 'circular';
export interface NuevoDocumento {
  tipo: TipoDocumento; formato: 'pdf' | 'xlsx';
  unidadId?: string; periodo?: string; votacionId?: string; sha256?: string;
}
export interface FilaActa {
  unidad: string; propietario: string | null; alicuota: number;
  opcion: string | null; emitidoEn: string | null; votante: string | null;
}

export interface CasaDirectorio { unidadId: string; etiqueta: string; nombres: string[] }   // etiqueta: "Casa 28", "Apto B-34"

export type TipoConversacion = 'directa' | 'junta' | 'grupo' | 'canal';
export interface Conversacion {
  id: string; tipo: TipoConversacion;
  titulo: string;                    // lo que se muestra: "Casa 28 · Familia Pérez", "Junta de condominio", "Bloque B"
  subtitulo: string | null;
  ultimoMensaje: string | null; ultimoMensajeEn: string | null;
  noLeidos: number;
  puedoEscribir: boolean;
}
export interface Adjunto {
  id: string; nombre: string; mime: string; bytes: number;
  url: string | null;                // null si ya venció en el servidor y no hay copia local
  expiraEn: string; vencido: boolean;
  guardadoLocal: boolean;            // hay copia en este dispositivo (constancia local)
}
export interface Mensaje {
  id: string; conversacionId: string;
  autorNombre: string | null;        // "Elena Castro" (el chat NO es anónimo)
  autorEtiqueta: string;             // "Apto B-33" o "Junta de condominio"
  esMio: boolean; comoJunta: boolean;
  tipo: 'texto' | 'imagen' | 'archivo' | 'audio' | 'documento_emitido' | 'sistema';
  texto: string | null; adjunto: Adjunto | null;
  creadoEn: string; editado: boolean; eliminado: boolean;
  estado: 1 | 2 | 3 | null;          // solo en mensajes propios: ✓ enviado, ✓✓ entregado, ✓✓ azul leído
}
export interface NuevoMensaje { texto?: string; archivo?: File; comoJunta?: boolean }

// ---------------- v0.3: servidor propio (cuentas, membresías, administración de la junta) ----------------

export interface SesionTokens { id: string; acceso: string; refresco: string; accesoExpiraEn: string }

export type EstadoCondominio = 'prueba' | 'activo' | 'suspendido' | 'baja';
export interface Membresia {
  condominioId: string; condominio: string; estadoCondominio: EstadoCondominio;
  rol: Rol; unidadId: string | null; unidad: string | null;          // unidad: "Apto B-33", "Casa 28"
}
export interface Yo {
  usuario: { id: string; nombre: string; telefono: string | null; correo: string | null; correoVerificado: boolean;
             avisosPorCorreo: boolean };   // recibir también por correo los avisos de pagos
  membresias: Membresia[];
  solicitudesPendientes: { condominioId: string; condominio: string; unidad: string | null; rol: Rol; creadoEn: string }[];
  rolPlataforma: 'dueno' | 'soporte' | 'finanzas' | null;
}

export interface CodigoAcceso {
  codigo: string; unidadId: string | null; unidad: string | null; rol: Rol;
  usos: number; usosMax: number; expiraEn: string; requiereAprobacion: boolean;
}
export interface SolicitudIngresoJunta {
  id: string; usuarioNombre: string; unidadId: string | null; unidad: string | null; rol: Rol; creadoEn: string;
}
export interface MiembroCondominio {
  usuarioId: string; nombre: string; rol: Rol; unidadId: string | null; unidad: string | null; activo: boolean; altaEn: string;
}

export interface MovimientoBancario {
  id: string; cuentaId: string; cuenta: string; fecha: string; referencia: string | null; descripcion: string | null;
  monto: number; moneda: Moneda; origen: 'extracto' | 'api';
  pagoId: string | null; unidad: string | null;                    // con qué pago/casa quedó conciliado
}
export interface ResultadoExtracto { cargados: number; duplicados: number; conciliados: number }

export interface FacturaZentaPro {
  id: string; periodo: string; plan: string | null;
  montoUsd: number;                   // la mensualidad se expresa en dólares…
  tasaBcv: number; montoVes: number;  // …referencia en Bs a la tasa del día de emisión
  abonadoUsd: number; saldoUsd: number;
  tasaHoy: number | null; saldoVesHoy: number | null;   // …y se paga en Bs a la tasa BCV del día del pago
  vence: string;
  estado: 'emitida' | 'pagada' | 'vencida' | 'anulada'; numeroControl: string | null; pagadaEn: string | null;
  pagoPorConfirmar: boolean;          // la junta reportó un pago que ZentaPro aún no confirma
}
export interface DatosPagoZentaPro { banco: string; titular: string; rif: string; telefonoPagoMovil: string; cuenta: string }

export interface ComentarioReporte { id: string; autor: string | null; esOficial: boolean; texto: string; creadoEn: string }

/** Evento del WebSocket /api/v1/tiempo-real */
export type EventoTiempoReal =
  | { tipo: 'mensaje'; conversacionId: string; mensaje: Mensaje }
  | { tipo: 'mensaje_actualizado'; conversacionId: string; mensaje: Mensaje }
  | { tipo: 'bandeja'; conversacionId: string }                       // hay algo nuevo en una conversación (refrescar lista)
  | { tipo: 'pago'; pagoId: string; estado: EstadoPago }
  | { tipo: 'notificacion'; notificacion: Notificacion }
  | { tipo: 'alerta'; alertaId: string; evento: 'nueva' | 'ampliada' | 'respuesta' | 'visto' | 'cerrada' }
  | { tipo: 'pong' }
  | { tipo: 'suscrito'; conversacionId: string }
  | { tipo: 'error'; error: string };

// ---------------- v0.4: notificaciones ----------------
export type TipoNotificacion = 'pago_reportado' | 'pago_confirmado' | 'pago_rechazado' | 'pagos_pendientes' | 'chat_vecinos' | 'general'
  | 'alerta' | 'alerta_cerrada' | 'solicitud_ingreso';
export interface Notificacion {
  id: string; tipo: TipoNotificacion; condominioId: string | null;
  titulo: string; cuerpo: string;
  datos: { pagoId?: string; alertaId?: string; tipoAlerta?: TipoAlerta;
           pantalla?: 'pagos' | 'estado-cuenta' | 'chat' | 'alerta' | 'accesos'; pendientes?: number };
  leida: boolean; creadoEn: string;
}
export interface BandejaNotificaciones { noLeidas: number; notificaciones: Notificacion[] }

// ---------------- v0.5: alerta vecinal ----------------
export type TipoAlerta = 'seguridad' | 'medica' | 'incendio' | 'otra';
export type EstadoAlerta = 'activa' | 'atendida' | 'falsa_alarma' | 'cancelada' | 'vencida';
export type RespuestaAlerta = 'voy' | 'vehiculo' | 'llamo_autoridades' | 'no_puedo';
/** Cómo confirmó su identidad quien emitió: huella/rostro, patrón o PIN del teléfono, o su clave (web). */
export type VerificacionAlerta = 'biometria' | 'credencial' | 'clave';

export interface ParticipacionAlerta {
  activo: boolean; tieneVehiculo: boolean; personalSalud: boolean;
  telefono: string | null;           // se muestra SOLO dentro de una alerta
  suspendidoHasta: string | null; motivoSuspension: string | null;
}
export interface ConfigAlerta {
  redActiva: boolean;                // la junta activó la alerta vecinal
  radio: number;                     // casas a cada lado (0 = todo el condominio)
  participacion: ParticipacionAlerta | null;
  puedoEmitir: boolean; motivoNoPuede: string | null;
  puedoConfigurar: boolean;          // presidente o administrador
  alertasActivas: number;            // que puedo ver ahora
}
export interface RespuestaVecino {
  usuarioId: string; nombre: string; unidad: string | null; respuesta: RespuestaAlerta; creadoEn: string;
  tieneVehiculo: boolean; personalSalud: boolean; telefono: string | null;
}
export interface AlertaVecinal {
  id: string; tipo: TipoAlerta; nota: string | null; alcance: 'cercanos' | 'todos'; estado: EstadoAlerta;
  verificacion: VerificacionAlerta; creadoEn: string; cerradaEn: string | null; notaCierre: string | null;
  emisor: { nombre: string; unidad: string; telefono: string | null };
  soyEmisor: boolean; puedoCerrar: boolean; puedoResponder: boolean; miRespuesta: RespuestaAlerta | null;
  destinatarios: number; vistos: number; respuestas: RespuestaVecino[];
}
export interface NuevaAlerta { tipo: TipoAlerta; nota?: string; verificacion: VerificacionAlerta; clave?: string }
export interface ParticipanteAlerta {
  usuarioId: string; nombre: string; unidad: string | null; activo: boolean; tieneVehiculo: boolean; personalSalud: boolean;
  suspendidoHasta: string | null; motivoSuspension: string | null; alertasEmitidas: number; falsasAlarmas: number;
}
export interface CercaniaUnidad { unidadId: string; etiqueta: string; sector: string; posicion: number | null; personalizada: boolean }

// ---------------- v0.5: enlace de invitación ----------------
export interface EnlaceInvitacion { codigo: string; url: string; expiraEn: string; usos: number }
export interface InfoInvitacion { condominioId: string; condominio: string; ciudad: string | null; unidades: { id: string; etiqueta: string }[] }

// ---------------- v0.3: cuentas y administración desde la app ----------------
export interface NuevaCuenta { nombre: string; correo: string; clave: string; telefono?: string }
/** Fila leída del extracto bancario (Excel/CSV) en el teléfono antes de subirla. */
export interface MovimientoExtracto { fecha: string; referencia: string; descripcion: string; monto: number }
/** Pago de la mensualidad de ZentaPro: SOLO en bolívares (Pago Móvil o transferencia). */
export interface NuevoPagoZentaPro { metodo: 'pago_movil' | 'transferencia'; montoVes: number; referencia: string; fechaPago?: string }
