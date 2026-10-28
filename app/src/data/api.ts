import type {
  Adjunto, CambiosMarca, CasaDirectorio, Conversacion, FilaActa, Marca, Mensaje, NuevoDocumento, NuevoMensaje,
  Aviso, Condominio, CuentaFinanciera, EstadoCuenta, EstadoReporte, Gasto, NuevaPartida, NuevoGasto,
  NuevoPago, NuevoReporte, Pago, Partida, Reporte, ResumenPanel, Sesion, UnidadConSaldo,
  CodigoAcceso, ComentarioReporte, DatosPagoZentaPro, FacturaZentaPro, MiembroCondominio, MovimientoBancario,
  MovimientoExtracto, NuevaCuenta, NuevoPagoZentaPro, ResultadoExtracto, Rol, SolicitudIngresoJunta, Yo,
  BandejaNotificaciones, Notificacion,
  AlertaVecinal, CercaniaUnidad, ConfigAlerta, EnlaceInvitacion, EstadoAlerta, InfoInvitacion, NuevaAlerta,
  ParticipanteAlerta, RespuestaAlerta,
} from './tipos';

/** Evento en vivo de una alerta vecinal (nueva, respuesta de un vecino, cerrada…). */
export interface EventoAlerta { alertaId: string; evento: 'nueva' | 'ampliada' | 'respuesta' | 'visto' | 'cerrada' }
export interface DatosParticipacion { activo: boolean; tieneVehiculo: boolean; personalSalud: boolean; telefono: string | null }

// Contrato único de datos. Hay dos implementaciones:
//  - demo.ts     → en memoria, para mostrar la app sin servidor
//  - servidor.ts → servidor propio de ZPro Condominio (API REST + WebSocket, ver servidor/CONTRATO_API.md)
export interface Api {
  readonly modo: 'demo' | 'servidor';

  // ---------------- Sesión ----------------
  /** Sesión dentro del condominio activo (null si no ha entrado o aún no pertenece a ningún condominio). */
  sesion(): Sesion | null;
  /** Cuenta del usuario (perfil, condominios, solicitudes). null si no ha iniciado sesión. */
  cuenta(): Yo | null;
  restaurar(): Promise<Sesion | null>;   // recupera la sesión guardada al abrir la app
  entrar(datos: { correo: string; clave: string } | { demoComo: 'residente' | 'presidencia' }): Promise<Sesion | null>;
  salir(): Promise<void>;

  // ---------------- Cuenta (v0.3) ----------------
  registrar(d: NuevaCuenta): Promise<void>;                 // crea la cuenta e inicia sesión
  olvideClave(correo: string): Promise<void>;
  restablecerClave(token: string, clave: string): Promise<void>;
  verificarCorreo(token: string): Promise<void>;
  cambiarClave(actual: string, nueva: string): Promise<void>;
  yo(): Promise<Yo>;                                        // recarga la cuenta desde el servidor
  /** Elige el condominio activo (se recuerda en el dispositivo). */
  elegirCondominio(condominioId: string): Promise<Sesion>;
  unirse(codigo: string): Promise<'pendiente' | 'aprobada'>;
  activarCondominio(codigo: string): Promise<string>;       // devuelve el id del condominio
  fijarAvisosPorCorreo(activo: boolean): Promise<void>;     // recibir también por correo los avisos de pagos

  // ---------------- Notificaciones (v0.4) ----------------
  /** Bandeja de avisos del usuario en el condominio activo (pagos aprobados/rechazados, recordatorios…). */
  notificaciones(): Promise<BandejaNotificaciones>;
  /** Marca como leídas las indicadas (sin ids: todas). */
  marcarNotificaciones(ids?: string[]): Promise<void>;
  /** Avisa al instante cuando llega una notificación nueva (WebSocket en servidor; local en la demo). */
  suscribirNotificaciones(alRecibir: (n: Notificacion) => void): () => void;

  // ---------------- Comunes ----------------
  condominio(): Promise<Condominio>;
  cuentasDePago(): Promise<CuentaFinanciera[]>;             // las que tienen datos para pagar
  cuentasFinancieras(): Promise<CuentaFinanciera[]>;        // todas las activas (conciliación)
  tasaBcv(): Promise<{ fecha: string; usdVes: number } | null>;
  fijarTasaBcv(usdVes: number): Promise<void>;              // junta con finanzas
  avisos(): Promise<Aviso[]>;
  crearAviso(a: { titulo: string; cuerpo: string; fijado: boolean }): Promise<void>;
  borrarAviso(id: string): Promise<void>;
  /** La junta (presidencia o administración) permite o no el chat casa ↔ casa. */
  fijarChatVecinos(activo: boolean): Promise<void>;

  // ---------------- Residente ----------------
  estadoCuenta(unidadId: string): Promise<EstadoCuenta>;
  reportarPago(p: NuevoPago): Promise<void>;

  // ---------------- Presidencia · finanzas ----------------
  panel(): Promise<ResumenPanel>;
  pagos(filtro: 'reportado' | 'todos'): Promise<Pago[]>;
  confirmarPago(id: string): Promise<void>;
  rechazarPago(id: string, motivo: string): Promise<void>;
  gastos(periodo: string): Promise<Gasto[]>;
  registrarGasto(g: NuevoGasto): Promise<void>;
  generarRecibos(periodo: string): Promise<number>;
  unidadesConSaldo(): Promise<UnidadConSaldo[]>;

  // Conciliación bancaria (v0.3)
  movimientosBancarios(soloPendientes: boolean): Promise<MovimientoBancario[]>;
  cargarExtracto(cuentaId: string, archivo: string, movimientos: MovimientoExtracto[]): Promise<ResultadoExtracto>;
  asignarMovimiento(movimientoId: string, unidadId: string): Promise<void>;

  // Factura de ZentaPro al condominio (v0.3)
  facturasZentaPro(): Promise<FacturaZentaPro[]>;
  datosPagoZentaPro(): Promise<DatosPagoZentaPro>;
  reportarPagoZentaPro(facturaId: string, p: NuevoPagoZentaPro): Promise<void>;

  // Accesos de la junta (v0.3)
  miembros(): Promise<MiembroCondominio[]>;
  cambiarMiembro(usuarioId: string, c: { rol?: Rol; activo?: boolean }): Promise<void>;
  codigosAcceso(): Promise<CodigoAcceso[]>;
  generarCodigos(d: { unidadIds?: string[]; todas?: boolean; rol?: Rol }): Promise<CodigoAcceso[]>;
  solicitudes(): Promise<SolicitudIngresoJunta[]>;
  resolverSolicitud(id: string, aprobar: boolean): Promise<void>;

  // ---------------- Partidas especiales y votaciones ----------------
  partidas(): Promise<Partida[]>;
  crearPartida(p: NuevaPartida): Promise<void>;
  votar(votacionId: string, opcionId: string): Promise<void>;
  cerrarVotacion(votacionId: string): Promise<boolean>;

  // ---------------- Reportes de irregularidades ----------------
  reportes(): Promise<Reporte[]>;
  crearReporte(r: NuevoReporte): Promise<void>;
  cambiarEstadoReporte(id: string, estado: EstadoReporte, respuesta?: string): Promise<void>;
  comentariosReporte(id: string): Promise<ComentarioReporte[]>;
  comentarReporte(id: string, texto: string): Promise<void>;

  // ---------------- Marca y documentos ----------------
  marca(): Promise<Marca>;
  guardarMarca(c: CambiosMarca): Promise<void>;
  registrarDocumento(d: NuevoDocumento): Promise<string>;     // devuelve el código de verificación
  emitirSolvencia(unidadId: string): Promise<string>;         // falla si la unidad debe
  datosActa(votacionId: string): Promise<FilaActa[]>;         // solo junta

  // ---------------- Directorio de casas y chat ----------------
  directorio(): Promise<CasaDirectorio[]>;
  mostrarEnDirectorio(mostrar: boolean): Promise<void>;
  conversaciones(): Promise<Conversacion[]>;
  abrirConCasa(unidadId: string): Promise<string>;            // residente: casa↔casa · junta: junta↔casa
  abrirConJunta(): Promise<string>;                           // residente → junta
  crearSala(tipo: 'grupo' | 'canal', titulo: string, unidades: string[]): Promise<string>;
  mensajes(conversacionId: string, antesDe?: string): Promise<Mensaje[]>;
  enviarMensaje(conversacionId: string, m: NuevoMensaje): Promise<Mensaje>;
  marcarLeido(conversacionId: string): Promise<void>;
  suscribirConversacion(conversacionId: string, alRecibir: (m: Mensaje) => void): () => void;
  /** Avisa cuando cambia algo en la bandeja (mensaje nuevo en cualquier conversación). */
  suscribirBandeja(alCambiar: () => void): () => void;
  descargarAdjunto(a: Adjunto): Promise<Blob>;
  bloquearCasa(unidadId: string, bloquear: boolean): Promise<void>;
  denunciarMensaje(mensajeId: string, motivo: string): Promise<void>;

  // ---------------- Alerta vecinal (v0.5) ----------------
  configAlerta(): Promise<ConfigAlerta>;
  fijarParticipacion(p: DatosParticipacion): Promise<void>;
  /** Junta (presidencia o administración): activar la red y fijar el radio (casas a cada lado; 0 = todo el condominio). */
  configurarRedAlerta(activa: boolean, radio?: number): Promise<void>;
  participantesAlerta(): Promise<ParticipanteAlerta[]>;
  suspenderDeAlerta(usuarioId: string, dias: number, motivo?: string): Promise<void>;
  cercania(): Promise<CercaniaUnidad[]>;
  fijarCercania(cambios: { unidadId: string; sector: string | null; posicion: number | null }[]): Promise<number>;
  emitirAlerta(a: NuevaAlerta): Promise<AlertaVecinal>;
  alertas(soloActivas?: boolean): Promise<AlertaVecinal[]>;
  alerta(id: string): Promise<AlertaVecinal>;
  marcarAlertaVista(id: string): Promise<void>;
  responderAlerta(id: string, r: RespuestaAlerta): Promise<AlertaVecinal>;
  cerrarAlerta(id: string, estado: Extract<EstadoAlerta, 'atendida' | 'falsa_alarma' | 'cancelada'>, nota?: string): Promise<AlertaVecinal>;
  ampliarAlerta(id: string): Promise<AlertaVecinal>;
  suscribirAlertas(alCambiar: (e: EventoAlerta) => void): () => void;
  /** Solo demostración: un vecino cercano pide ayuda, para ver la alarma en pantalla. */
  simularAlertaVecino?(): Promise<void>;
  /** Registrar el teléfono para notificaciones push (Firebase). */
  registrarDispositivo(token: string, plataforma: 'android' | 'ios' | 'web'): Promise<void>;

  // ---------------- Enlace de invitación (v0.5) ----------------
  enlaceInvitacion(regenerar?: boolean): Promise<EnlaceInvitacion>;   // junta
  infoInvitacion(codigo: string): Promise<InfoInvitacion>;            // público
  unirseConEnlace(codigo: string, unidadId: string, rol: 'propietario' | 'inquilino'): Promise<'pendiente' | 'aprobada'>;
}
