import type {
  Adjunto, CambiosMarca, CasaDirectorio, Conversacion, FilaActa, Marca, Mensaje, NuevoDocumento, NuevoMensaje,
  Aviso, Condominio, CuentaFinanciera, EstadoCuenta, EstadoReporte, Gasto, NuevaPartida, NuevoGasto,
  NuevoPago, NuevoReporte, Pago, Partida, Reporte, ResumenPanel, Sesion, UnidadConSaldo,
  CodigoAcceso, ComentarioReporte, DatosPagoZentaPro, FacturaZentaPro, MiembroCondominio, MovimientoBancario,
  MovimientoExtracto, NuevaCuenta, NuevoPagoZentaPro, ResultadoExtracto, Rol, SolicitudIngresoJunta, Yo,
  BandejaNotificaciones, Notificacion,
  AlertaVecinal, CercaniaUnidad, ConfigAlerta, EnlaceInvitacion, EstadoAlerta, InfoInvitacion, NuevaAlerta,
  ParticipanteAlerta, RespuestaAlerta,
  AlcanceDifusion, Difusion, GrupoUnidades, NuevaDifusion, NuevoGrupo, PreviaDifusion, UnidadAlcance,
  CierreMes, CobroPartidaCasa, LecturaTasa, ReporteDelMes, ResultadoConfirmarTasa, TasaBcv,
  ConfigConvivencia, DenunciaAnonima, MensajeAnonimo, MorosoPublico, NuevoMensajeAnonimo,
} from './tipos';

/** Resultado de un mensaje masivo. */
export interface DifusionEnviada { id: string; unidades: number; personas: number }

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
  /** Tasa BCV que rige ese día (por defecto hoy). usdVes = null si no está confirmada por dos fuentes (ver motivo).
   *  Lanza error de red si no hay conexión: la app NUNCA usa una tasa guardada de otro día para cobrar. */
  tasaBcv(fecha?: string): Promise<TasaBcv>;
  /** La junta (finanzas) confirma la tasa como una fuente más. */
  fijarTasaBcv(usdVes: number, fecha?: string): Promise<ResultadoConfirmarTasa>;
  lecturasTasa(): Promise<LecturaTasa[]>;                   // junta: qué dijo cada fuente
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
  pagos(filtro: 'reportado' | 'todos', mes?: string): Promise<Pago[]>;
  /** cargoIds: la junta cambia a qué deudas va el pago antes de aprobarlo (si no, va a lo que eligió el vecino). */
  confirmarPago(id: string, cargoIds?: string[]): Promise<void>;
  rechazarPago(id: string, motivo: string): Promise<void>;
  gastos(periodo: string): Promise<Gasto[]>;
  registrarGasto(g: NuevoGasto): Promise<void>;
  generarRecibos(periodo: string): Promise<number>;
  unidadesConSaldo(): Promise<UnidadConSaldo[]>;

  // Reporte y cierre del mes (v0.7)
  reporteMensual(periodo: string): Promise<ReporteDelMes>;
  cerrarMes(periodo: string): Promise<void>;
  cierres(): Promise<CierreMes[]>;

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
  /** Junta: quién pagó y quién no una cuota especial. */
  cobroPartida(partidaId: string): Promise<CobroPartidaCasa[]>;
  /** Crea la cuota especial; si se pidió, avisa de una vez a las casas incluidas (difusion != null). */
  crearPartida(p: NuevaPartida): Promise<{ id: string; difusion: DifusionEnviada | null }>;
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

  // ---------------- Transparencia y convivencia (v0.8) ----------------
  convivencia(): Promise<ConfigConvivencia>;
  /** Presidencia o administración: lista de cuotas vencidas (no / casas / casas y montos) y mensajes anónimos. */
  fijarConvivencia(c: ConfigConvivencia): Promise<void>;
  /** Casas con cuotas vencidas (sin nombres). vistaPrevia: la junta la ve aunque esté apagada. */
  morosos(vistaPrevia?: boolean): Promise<MorosoPublico[]>;
  mensajesAnonimos(): Promise<MensajeAnonimo[]>;
  enviarMensajeAnonimo(m: NuevoMensajeAnonimo): Promise<{ id: string; reporteId: string | null }>;
  marcarAnonimoLeido(id: string): Promise<void>;
  responderAnonimo(id: string, texto: string): Promise<void>;
  /** La casa que lo recibió lo denuncia a la junta (ofensivo o falso). */
  denunciarAnonimo(id: string, motivo: string): Promise<void>;
  denunciasAnonimas(): Promise<DenunciaAnonima[]>;                       // junta
  revisarDenuncia(id: string, accion: 'bloquear' | 'descartar', dias?: number): Promise<void>;

  // ---------------- Alerta vecinal (v0.5) ----------------
  configAlerta(): Promise<ConfigAlerta>;
  fijarParticipacion(p: DatosParticipacion): Promise<void>;
  /** Junta (presidencia o administración): activar la red y fijar el radio (casas a cada lado; 0 = todo el condominio). */
  configurarRedAlerta(activa: boolean, radio?: number): Promise<void>;
  participantesAlerta(): Promise<ParticipanteAlerta[]>;
  suspenderDeAlerta(usuarioId: string, dias: number, motivo?: string): Promise<void>;
  cercania(): Promise<CercaniaUnidad[]>;
  fijarCercania(cambios: { unidadId: string; sector: string | null; posicion: number | null; piso?: string | null }[]): Promise<number>;

  // ---------------- Grupos de casas y mensajes masivos (v0.6, junta) ----------------
  unidadesAlcance(): Promise<UnidadAlcance[]>;
  grupos(): Promise<GrupoUnidades[]>;
  crearGrupo(g: NuevoGrupo): Promise<GrupoUnidades>;
  editarGrupo(id: string, g: NuevoGrupo): Promise<GrupoUnidades>;
  borrarGrupo(id: string): Promise<void>;
  previaDifusion(alcance: AlcanceDifusion, soloPropietarios: boolean): Promise<PreviaDifusion>;
  difundir(d: NuevaDifusion): Promise<DifusionEnviada>;
  difusiones(): Promise<Difusion[]>;
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
