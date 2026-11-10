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
  /** v0.8: lista pública de casas con cuotas vencidas ('no' = apagada, por defecto). */
  morososPublicos?: ModoMorosos; morososMesesMin?: number;
  /** v0.8: los vecinos pueden enviar mensajes anónimos a otra casa (encendido por defecto). */
  mensajesAnonimos?: boolean;
  /** v0.9: qué números del condominio ven los vecinos ('no' por defecto). */
  finanzasPublicas?: ModoFinanzasPublicas;
}
export type ModoMorosos = 'no' | 'casas' | 'casas_y_montos';

export interface Unidad { id: string; bloque: string | null; numero: string; alicuota: number; propietario: string | null }
export interface UnidadConSaldo extends Unidad { cargosUsd: number; pagadoUsd: number; saldoUsd: number }

export type TipoCuenta = 'banco_bs' | 'banco_usd' | 'caja' | 'zelle' | 'usdt' | 'fondo_reserva';
export interface CuentaFinanciera {
  id: string; nombre: string;
  tipo: TipoCuenta;
  moneda: Moneda;
  /** Resumen en una línea (para recibos y PDF): se arma con los campos de abajo o es la nota libre. */
  datosPago: string | null;
  // Datos para pagar, por campos (0027). Vacíos si la junta aún no los cargó.
  bancoCodigo?: string | null; titular?: string | null;
  documento?: string | null;          // letra + números: V12345678, J301234567
  telefono?: string | null;           // Pago Móvil, 11 dígitos: 04141234567
  numeroCuenta?: string | null;       // 20 dígitos
  correo?: string | null;             // Zelle
  nota?: string | null;               // texto libre (p. ej. "Entregar al tesorero contra recibo")
  qrUrl?: string | null;              // imagen del QR de cobro que generó la app del banco
  actualizadoEn?: string | null; actualizadoPor?: string | null;
}
export interface DatosCuentaPago {
  nombre?: string; bancoCodigo?: string | null; titular?: string | null; documento?: string | null; telefono?: string | null;
  numeroCuenta?: string | null; correo?: string | null; nota?: string | null;
}

export type EstadoCargo = 'pagado' | 'parcial' | 'pendiente' | 'credito';
export interface Cargo {
  id: string; unidadId: string; periodo: string; tipo: TipoCargo; concepto: string; montoUsd: number;
  /** v0.7: cuánto de este cargo ya se descontó con pagos aprobados, cuánto falta y su estado. */
  pagadoUsd?: number; pendienteUsd?: number; estado?: EstadoCargo; partidaId?: string | null;
}
/** A qué deuda va (o fue) un pago. */
export interface AplicacionPago { cargoId: string; concepto: string; periodo: string; montoUsd: number }

export interface Pago {
  id: string; unidadId: string; unidadEtiqueta: string; fechaPago: string; metodo: MetodoPago; moneda: Moneda;
  monto: number; tasaBcv: number | null; montoUsd: number; referencia: string | null;
  bancoOrigen: string | null; comprobanteUrl: string | null; nota: string | null;
  estado: EstadoPago; motivoRechazo: string | null; creadoEn: string;
  /** v0.7: lo que el vecino (o la junta al aprobar) eligió pagar; montoUsd = lo pendiente de esa deuda. */
  destinos?: AplicacionPago[];
  /** v0.7: cómo quedó descontado al aprobarse (lo elegido primero; lo que sobra, a la deuda más antigua). */
  aplicaciones?: AplicacionPago[];
}

export interface NuevoPago {
  unidadId: string; fechaPago: string; metodo: MetodoPago; moneda: Moneda; monto: number;
  referencia?: string; bancoOrigen?: string; cuentaDestinoId?: string; nota?: string; comprobante?: Blob | null;
  /** v0.7: deudas que cubre este pago (en el orden elegido). */
  cargoIds?: string[];
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
  sinVotar?: number | null;         // solo para la junta: casas con derecho a voto que aún no votan
}
export interface Partida {
  id: string; titulo: string; descripcion: string | null; presupuestoUsd: number; numeroCuotas: number;
  primeraCuota: string | null; reparto: Ponderacion; estado: EstadoPartida; creadoEn: string;
  votacion: Votacion | null;
  cuotaMiUnidadUsd: number | null;  // cuánto le tocaría pagar por cuota a la unidad del residente (null si no le aplica)
  /** A quién aplica (v0.6): todo el condominio o solo algunas casas (una calle, un piso…). Solo esas la ven, votan y pagan. */
  alcance: { tipo: 'todos' | 'unidades'; nombre: string | null; unidades: number };
  meAfecta: boolean;                // alguna de mis casas está incluida
  unidadIds?: string[];             // solo para la junta: las casas incluidas
  /** v0.7: cuánto se ha emitido y cobrado de esta cuota especial. */
  avance?: AvancePartida | null;
}
export interface AvancePartida {
  emitidoUsd: number; cobradoUsd: number; pendienteUsd: number; casas: number; casasAlDia: number; cuotasEmitidas: number;
}
/** Detalle por casa del cobro de una cuota especial (solo la junta). */
export interface CobroPartidaCasa { unidadId: string; etiqueta: string; propietario: string | null; cargadoUsd: number; pagadoUsd: number; pendienteUsd: number }
/** A quién se dirige algo (cuota especial o mensaje masivo). */
export type AlcanceCasas =
  | { tipo: 'todos' }
  | { tipo: 'grupo'; grupoId: string }
  | { tipo: 'unidades'; unidadIds: string[]; nombre?: string };
export interface NuevaPartida {
  titulo: string; descripcion: string; presupuestoUsd: number; numeroCuotas: number; primeraCuota: string;
  reparto: Ponderacion; someterAVotacion: boolean; umbralPct: number; cierraEn: string | null;
  alcance?: AlcanceCasas;           // por defecto todo el condominio
  /** Avisar de una vez a las casas incluidas (mensaje masivo). Por defecto sí. */
  difundir?: boolean;
}

export interface Reporte {
  id: string; categoria: CategoriaReporte; titulo: string; descripcion: string; ubicacion: string | null;
  anonimo: boolean; autorNombre: string | null; visibilidad: Visibilidad; estado: EstadoReporte;
  fotos: string[]; creadoEn: string; esMio: boolean;
  /** v0.8: casa a la que se refiere (solo la ven la junta y quien lo envió). */
  unidadId?: string | null; unidad?: string | null;
}
export interface NuevoReporte {
  categoria: CategoriaReporte; titulo: string; descripcion: string; ubicacion: string;
  anonimo: boolean; visibilidad: Visibilidad; fotos: Blob[];
  /** v0.8: casa a la que se refiere (solo con visibilidad 'presidencia'). */
  unidadId?: string;
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
  | 'convocatoria' | 'morosidad' | 'libro_ingresos_egresos' | 'circular' | 'reporte_mensual';
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
export interface DatosPagoZentaPro { banco: string; titular: string; rif: string; telefonoPagoMovil: string; cuenta: string; bancoCodigo?: string }

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
  | 'alerta' | 'alerta_cerrada' | 'solicitud_ingreso' | 'difusion' | 'cierre_mes' | 'tasa_bcv' | 'mensaje_anonimo' | 'denuncia_anonima' | 'datos_pago' | 'recordatorio_pago';
export interface Notificacion {
  id: string; tipo: TipoNotificacion; condominioId: string | null;
  titulo: string; cuerpo: string;
  datos: { pagoId?: string; alertaId?: string; tipoAlerta?: TipoAlerta;
           pantalla?: 'pagos' | 'estado-cuenta' | 'chat' | 'alerta' | 'accesos' | 'partidas' | 'avisos' | 'cierre' | 'tasa' | 'anonimos' | 'denuncias' | 'morosos' | 'datos-pago' | 'finanzas' | 'pagar'; pendientes?: number;
           partidaId?: string; difusionId?: string; periodo?: string; mensajeId?: string; cuentaId?: string };
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
export interface CercaniaUnidad { unidadId: string; etiqueta: string; sector: string; posicion: number | null; personalizada: boolean;
  piso?: string | null }          // v0.6: piso (cargado o deducido del número)

// ---------------- v0.6: grupos de casas y difusión masiva ----------------
/** Casa con los datos para filtrar (por bloque/calle o por piso) al elegir a quién va algo. */
export interface UnidadAlcance { id: string; etiqueta: string; bloque: string | null; sector: string; piso: string | null; alicuota: number }
export interface GrupoUnidades { id: string; nombre: string; descripcion: string | null; unidadIds: string[] }
export interface NuevoGrupo { nombre: string; descripcion?: string | null; unidadIds: string[] }
export type AlcanceDifusion = AlcanceCasas | { tipo: 'partida'; partidaId: string } | { tipo: 'sin_votar'; partidaId: string };
export interface NuevaDifusion {
  titulo: string; cuerpo: string; alcance: AlcanceDifusion;
  soloPropietarios?: boolean;      // por defecto a todos los de cada casa (propietarios e inquilinos)
  partidaId?: string;              // para enlazar el mensaje a una cuota especial
}
export interface PreviaDifusion { unidades: number; personas: number }
export interface Difusion {
  id: string; titulo: string; cuerpo: string; alcance: AlcanceDifusion['tipo']; alcanceNombre: string | null;
  partidaId: string | null; soloPropietarios: boolean; unidades: number; personas: number; creadoEn: string; creadoPor: string | null;
}

// ---------------- v0.5: enlace de invitación ----------------
export interface EnlaceInvitacion { codigo: string; url: string; expiraEn: string; usos: number }
export interface InfoInvitacion { condominioId: string; condominio: string; ciudad: string | null; unidades: { id: string; etiqueta: string }[] }

// ---------------- v0.3: cuentas y administración desde la app ----------------
export interface NuevaCuenta { nombre: string; correo: string; clave: string; telefono?: string }
/** Fila leída del extracto bancario (Excel/CSV) en el teléfono antes de subirla. */
export interface MovimientoExtracto { fecha: string; referencia: string; descripcion: string; monto: number }
/** Pago de la mensualidad de ZentaPro: SOLO en bolívares (Pago Móvil o transferencia). */
export interface NuevoPagoZentaPro { metodo: 'pago_movil' | 'transferencia'; montoVes: number; referencia: string; fechaPago?: string }

// ---------------- v0.7: tasa BCV verificada y cierre mensual ----------------

/** Tasa BCV que rige un día. usdVes = null si no está confirmada por dos fuentes: NO se puede pagar en Bs. */
export interface TasaBcv {
  hoy: string;                      // fecha de hoy en Caracas (AAAA-MM-DD)
  fecha: string | null;             // fecha valor de la tasa
  usdVes: number | null;
  verificada: boolean;
  fuentes: string[];                // p. ej. ['BCV', 'DolarApi'] o ['DolarApi', 'Junta']
  verificadaEn: string | null;
  ultimaConsulta: string | null;    // última consulta automática del servidor
  motivo: string | null;            // por qué no hay tasa (para mostrarlo tal cual)
}
export interface LecturaTasa { fuente: string; automatica: boolean; fechaValor: string | null; usdVes: number | null; error: string | null; leidaEn: string }
export interface ResultadoConfirmarTasa { resultado: 'verificada' | 'una_fuente' | 'no_coinciden' | 'sin_datos'; tasa: TasaBcv }

export interface CasaReporteMensual {
  unidadId: string; etiqueta: string; propietario: string | null; alicuota: number;
  saldoAnteriorUsd: number; facturadoUsd: number; pagadoUsd: number; saldoFinalUsd: number;
  estado: 'al_dia' | 'debe' | 'a_favor';
  recibo: 'pagado' | 'parcial' | 'pendiente' | 'sin_recibo';
  pagosRechazados: number; pagosEnRevision: number;
}
export interface PagoReporteMensual {
  id: string; unidad: string; fechaPago: string; metodo: MetodoPago; moneda: Moneda; monto: number; tasaBcv: number | null;
  montoUsd: number; referencia: string | null; estado: EstadoPago; motivoRechazo: string | null; revisadoEn: string | null;
  aplicadoA: { concepto: string; periodo: string; montoUsd: number }[];
}
export interface ReporteMensual {
  periodo: string; desde: string; hasta: string; generadoEn: string; tasaBcv: number | null; tasaFecha: string | null;
  resumen: {
    facturadoUsd: number; facturadoPorTipo: Partial<Record<TipoCargo, number>>;
    cobradoUsd: number; cobradoBs: number; cobradoDivisasUsd: number; gastosUsd: number;
    deudaInicialUsd: number; deudaFinalUsd: number; aFavorUsd: number;
    totalCasas: number; casasAlDia: number; casasConDeuda: number;
    pagosAprobados: number; pagosRechazados: number; pagosEnRevision: number; enRevisionUsd: number;
  };
  casas: CasaReporteMensual[];
  pagos: PagoReporteMensual[];
  gastos: { fecha: string; categoria: string; descripcion: string; tipo: 'comun' | 'no_comun' | 'partida'; moneda: Moneda; monto: number;
            tasaBcv: number | null; montoUsd: number; cuenta: string | null; proveedor: string | null }[];
  cuentas: { nombre: string; moneda: Moneda; tipo: string; saldoInicial: number; entradas: number; salidas: number; saldoFinal: number }[];
  fondoReserva: { facturadoAcumUsd: number; cobradoAcumUsd: number };
  partidas: { id: string; titulo: string; presupuestoUsd: number; estado: EstadoPartida; emitidoUsd: number; cobradoUsd: number; casas: number }[];
}
/** Reporte de un mes: el guardado al cerrarlo (cerrado != null) o el calculado en vivo si aún no se cierra. */
export interface ReporteDelMes {
  periodo: string;
  cerrado: { en: string; automatico: boolean; por: string | null } | null;
  datos: ReporteMensual;
}
export interface CierreMes { periodo: string; cerradoEn: string; automatico: boolean; por: string | null }

// ---------------- v0.8: transparencia y convivencia ----------------
/** Casa con cuotas vencidas en la lista pública (nunca lleva nombres). montoVencidoUsd = null si la junta no publica montos. */
export interface MorosoPublico { unidadId: string; etiqueta: string; mesesVencidos: number; montoVencidoUsd: number | null; desde: string }
export interface ConfigConvivencia {
  morososPublicos: ModoMorosos; morososMesesMin: number; mensajesAnonimos: boolean;
  /** v0.9: qué números del condominio ven los vecinos (por defecto ninguno). */
  finanzasPublicas: ModoFinanzasPublicas;
  /** v0.10: recordar a cada casa su recibo 3 días antes de vencer y el día después (encendido por defecto). */
  recordatorioVencimiento: boolean;
}
/** 'no': nada (cada casa ve solo lo suyo) · 'totales': cobrado, gastado por categoría, fondo y cuotas especiales · 'detalle': además cada gasto y los saldos. */
export type ModoFinanzasPublicas = 'no' | 'totales' | 'detalle';
/** Números del mes para los vecinos (sin nada por casa). */
export interface FinanzasPublicas {
  modo: ModoFinanzasPublicas; periodo: string; cerrado: boolean;
  cobradoUsd: number; facturadoUsd: number; gastosUsd: number;
  gastosPorCategoria: { categoria: string; montoUsd: number }[];
  fondoReservaUsd: number;
  partidas: { titulo: string; presupuestoUsd: number; emitidoUsd: number; cobradoUsd: number; estado: EstadoPartida }[];
  /** Solo con 'detalle' (y para la junta). */
  cuentas: { nombre: string; moneda: Moneda; saldoFinal: number }[] | null;
}

export interface RespuestaAnonima { id: string; de: 'casa' | 'remitente'; texto: string; creadoEn: string }
/** Mensaje anónimo a una casa. Nunca trae quién lo envió. */
export interface MensajeAnonimo {
  id: string; direccion: 'recibido' | 'enviado'; aUnidad: string; categoria: CategoriaReporte; texto: string; fotos: string[];
  tambienJunta: boolean; leidoEn: string | null; denunciadoEn: string | null; revision: 'bloqueado' | 'descartada' | null;
  creadoEn: string; respuestas: RespuestaAnonima[];
}
export interface NuevoMensajeAnonimo {
  unidadId: string; categoria: CategoriaReporte; texto: string; fotos: Blob[];
  /** Enviar también a la junta como reporte anónimo (con la casa relacionada). */
  tambienJunta: boolean; titulo?: string;
}
/** Para la junta: un mensaje anónimo denunciado por la casa que lo recibió (sin remitente). */
export interface DenunciaAnonima {
  id: string; aUnidad: string; categoria: CategoriaReporte; texto: string; fotos: string[]; motivo: string | null;
  denunciadoEn: string; revision: 'bloqueado' | 'descartada' | null; creadoEn: string; respuestas: RespuestaAnonima[];
  reincidente: boolean;   // el mismo remitente ya tuvo otro mensaje denunciado (sin decir quién)
}
