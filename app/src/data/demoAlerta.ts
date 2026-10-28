// Alerta vecinal y enlace de invitación en MODO DEMO: mismas reglas que 0019_alerta_vecinal.sql y 0020_enlace_invitacion.sql.
import type { DatosParticipacion, EventoAlerta } from './api';
import type {
  AlertaVecinal, CercaniaUnidad, ConfigAlerta, EnlaceInvitacion, EstadoAlerta, InfoInvitacion, NuevaAlerta, Notificacion,
  ParticipanteAlerta, RespuestaAlerta, Rol, Sesion, TipoAlerta, TipoNotificacion, Unidad,
} from './tipos';

interface Miembro { usuarioId: string; nombre: string; rol: Rol; unidadId: string | null; activo: boolean }
interface Participante extends DatosParticipacion { usuarioId: string; suspendidoHasta: string | null; motivoSuspension: string | null }
interface AlertaDemo {
  id: string; tipo: TipoAlerta; nota: string | null; alcance: 'cercanos' | 'todos'; estado: EstadoAlerta;
  verificacion: AlertaVecinal['verificacion']; creadoEn: string; cerradaEn: string | null; notaCierre: string | null;
  emisorId: string; unidadId: string;
  destinatarios: Map<string, { motivo: string; vistoEn: string | null }>;
  respuestas: Map<string, { respuesta: RespuestaAlerta; creadoEn: string }>;
}

export interface ContextoAlertaDemo {
  unidades: Unidad[];
  miembros: () => Miembro[];
  sesion: () => Sesion | null;
  condominio: () => string;
  telefonoDe: (usuarioId: string) => string | null;
  notificar: (usuarios: string[], tipo: TipoNotificacion, titulo: string, cuerpo: string, datos?: Notificacion['datos']) => void;
  etiquetaUnidad: (uid: string | null) => string | null;
  /** Usuario de la cuenta demo actual (sesión o cuenta recién creada). */
  usuarioActual: () => { id: string; nombre: string } | null;
  nuevaSolicitud: (usuarioId: string, nombre: string, unidadId: string, rol: Rol) => void;
  nuevoId: () => string;
}

const JUNTA: Rol[] = ['presidente', 'tesorero', 'vocal', 'administrador'];
const NOMBRE_TIPO: Record<TipoAlerta, string> = {
  seguridad: 'Emergencia de seguridad', medica: 'Emergencia médica', incendio: 'Incendio', otra: 'Emergencia',
};
const espera = () => new Promise((r) => setTimeout(r, 120));

export function crearAlertaDemo(k: ContextoAlertaDemo) {
  const red = { activa: true, radio: 3 };
  const cercania = new Map<string, { sector: string | null; posicion: number | null }>();
  const participantes = new Map<string, Participante>([
    ['usr-elena', { usuarioId: 'usr-elena', activo: true, tieneVehiculo: false, personalSalud: false, telefono: '0414-123 45 67', suspendidoHasta: null, motivoSuspension: null }],
    ['usr-pedro', { usuarioId: 'usr-pedro', activo: true, tieneVehiculo: true, personalSalud: false, telefono: '0412-765 43 21', suspendidoHasta: null, motivoSuspension: null }],
    ['usr-rosa', { usuarioId: 'usr-rosa', activo: true, tieneVehiculo: false, personalSalud: true, telefono: '0424-555 12 12', suspendidoHasta: null, motivoSuspension: null }],
    ['usr-ana', { usuarioId: 'usr-ana', activo: true, tieneVehiculo: true, personalSalud: false, telefono: null, suspendidoHasta: null, motivoSuspension: null }],
  ]);
  const alertas: AlertaDemo[] = [];
  const oyentes = new Set<(e: EventoAlerta) => void>();
  const temporizadores: ReturnType<typeof setTimeout>[] = [];
  let enlace: EnlaceInvitacion = nuevoEnlace();

  function nuevoEnlace(): EnlaceInvitacion {
    const ALF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const codigo = 'INV-' + Array.from({ length: 6 }, () => ALF[Math.floor(Math.random() * ALF.length)]).join('');
    const base = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : 'https://condominio.zentapro.com/';
    return { codigo, url: `${base}#/invitacion/${codigo}`, expiraEn: new Date(Date.now() + 365 * 86_400_000).toISOString(), usos: 0 };
  }

  const yo = () => { const s = k.sesion(); if (!s) throw new Error('Inicie sesión'); return s; };
  const nombreDe = (uid: string) => k.miembros().find((m) => m.usuarioId === uid)?.nombre ?? 'Vecino';
  const unidadDe = (uid: string) => k.miembros().find((m) => m.usuarioId === uid && m.activo && m.unidadId)?.unidadId ?? null;
  const esJunta = (uid: string) => k.miembros().some((m) => m.usuarioId === uid && m.activo && JUNTA.includes(m.rol));
  const puedeConfigurar = (s: Sesion) => ['presidente', 'administrador'].includes(s.rol);
  const sector = (u: Unidad) => (cercania.get(u.id)?.sector ?? u.bloque ?? '').toUpperCase();
  const posicion = (u: Unidad) => cercania.get(u.id)?.posicion ?? (Number((u.numero.match(/\d+/) ?? [])[0]) || null);
  function cercanas(uid: string, radio: number) {
    const u = k.unidades.find((x) => x.id === uid)!;
    return new Set(k.unidades.filter((o) => o.id !== uid && (radio === 0 || (sector(o) === sector(u)
      && posicion(o) != null && posicion(u) != null && Math.abs(posicion(o)! - posicion(u)!) <= radio))).map((o) => o.id));
  }
  const participanteActivo = (uid: string) => {
    const p = participantes.get(uid);
    return !!p && p.activo && !(p.suspendidoHasta && p.suspendidoHasta > new Date().toISOString());
  };
  const avisar = (e: EventoAlerta) => { for (const f of oyentes) f(e); };

  function motivoNoEmitir(uid: string): string | null {
    if (!red.activa) return 'La junta no ha activado la alerta vecinal';
    const p = participantes.get(uid);
    if (!p || !p.activo) return 'Inscríbase en la alerta vecinal para poder avisar';
    if (p.suspendidoHasta && p.suspendidoHasta > new Date().toISOString()) {
      return `La junta suspendió su participación hasta el ${p.suspendidoHasta.slice(0, 10).split('-').reverse().join('/')}`;
    }
    if (alertas.some((a) => a.emisorId === uid && a.estado === 'activa')) return 'Ya tiene una alerta activa';
    const dia = Date.now() - 86_400_000;
    if (alertas.filter((a) => a.emisorId === uid && new Date(a.creadoEn).getTime() > dia).length >= 3) {
      return 'Llegó al máximo de 3 alertas en 24 horas. Si es una emergencia, llame al 911 o a la junta';
    }
    return null;
  }

  function vencer() {
    const limite = Date.now() - 3 * 3600_000;
    for (const a of alertas) if (a.estado === 'activa' && new Date(a.creadoEn).getTime() < limite) { a.estado = 'vencida'; a.cerradaEn = new Date().toISOString(); }
  }

  const puedoVer = (a: AlertaDemo, uid: string) => a.emisorId === uid || esJunta(uid) || a.destinatarios.has(uid);

  function vista(a: AlertaDemo, uid: string): AlertaVecinal {
    const activa = a.estado === 'activa';
    const pe = participantes.get(a.emisorId);
    return {
      id: a.id, tipo: a.tipo, nota: a.nota, alcance: a.alcance, estado: a.estado, verificacion: a.verificacion,
      creadoEn: a.creadoEn, cerradaEn: a.cerradaEn, notaCierre: a.notaCierre,
      emisor: { nombre: nombreDe(a.emisorId), unidad: k.etiquetaUnidad(a.unidadId) ?? '', telefono: pe?.telefono ?? k.telefonoDe(a.emisorId) },
      soyEmisor: a.emisorId === uid, puedoCerrar: activa && (a.emisorId === uid || esJunta(uid)),
      puedoResponder: activa && a.destinatarios.has(uid), miRespuesta: a.respuestas.get(uid)?.respuesta ?? null,
      destinatarios: a.destinatarios.size, vistos: [...a.destinatarios.values()].filter((d) => d.vistoEn).length,
      respuestas: [...a.respuestas.entries()].sort((x, y) => x[1].creadoEn.localeCompare(y[1].creadoEn)).map(([ru, r]) => {
        const p = participantes.get(ru);
        return {
          usuarioId: ru, nombre: nombreDe(ru), unidad: k.etiquetaUnidad(unidadDe(ru)), respuesta: r.respuesta, creadoEn: r.creadoEn,
          tieneVehiculo: p?.tieneVehiculo ?? false, personalSalud: p?.personalSalud ?? false,
          telefono: r.respuesta === 'no_puedo' ? null : p?.telefono ?? k.telefonoDe(ru),
        };
      }),
    };
  }

  function buscar(id: string) {
    vencer();
    const s = yo();
    const a = alertas.find((x) => x.id === id);
    if (!a || !puedoVer(a, s.usuarioId)) throw new Error('No se encontró.');
    return { a, s };
  }

  /** Crea la alerta, sus destinatarios y las notificaciones (lo mismo que emitir_alerta en SQL). */
  function crear(emisorId: string, tipo: TipoAlerta, nota: string | null, verificacion: AlertaVecinal['verificacion']): AlertaDemo {
    const unidadId = unidadDe(emisorId)!;
    const alcance: AlertaDemo['alcance'] = tipo === 'incendio' || red.radio === 0 ? 'todos' : 'cercanos';
    const cerca = cercanas(unidadId, red.radio);
    const a: AlertaDemo = {
      id: k.nuevoId(), tipo, nota: nota?.trim() || null, alcance, estado: 'activa', verificacion,
      creadoEn: new Date().toISOString(), cerradaEn: null, notaCierre: null, emisorId, unidadId,
      destinatarios: new Map(), respuestas: new Map(),
    };
    const agregar = (uid: string, motivo: string) => { if (uid !== emisorId && !a.destinatarios.has(uid)) a.destinatarios.set(uid, { motivo, vistoEn: null }); };
    for (const m of k.miembros().filter((x) => x.activo)) {
      if (m.unidadId === unidadId) agregar(m.usuarioId, 'misma_casa');
      if (participanteActivo(m.usuarioId) && m.unidadId && (alcance === 'todos' || cerca.has(m.unidadId))) {
        agregar(m.usuarioId, alcance === 'todos' ? 'condominio' : 'cercano');
      }
      if (JUNTA.includes(m.rol)) agregar(m.usuarioId, 'junta');
    }
    alertas.unshift(a);
    const casa = k.etiquetaUnidad(unidadId);
    k.notificar([...a.destinatarios.keys()], 'alerta', `🚨 ${NOMBRE_TIPO[tipo]} en ${casa}`,
      `${nombreDe(emisorId)} (${casa}) pide ayuda.${a.nota ? ` «${a.nota}»` : ''} Abra la alerta para responder.`,
      { alertaId: a.id, pantalla: 'alerta', tipoAlerta: tipo });
    avisar({ alertaId: a.id, evento: 'nueva' });
    return a;
  }

  function responder(a: AlertaDemo, uid: string, r: RespuestaAlerta) {
    if (a.estado !== 'activa') throw new Error('La alerta ya está cerrada');
    a.respuestas.set(uid, { respuesta: r, creadoEn: new Date().toISOString() });
    const d = a.destinatarios.get(uid);
    if (d && !d.vistoEn) d.vistoEn = new Date().toISOString();
    avisar({ alertaId: a.id, evento: 'respuesta' });
  }

  /** En la demostración, cuando usted pide ayuda, algunos vecinos "responden" a los pocos segundos. */
  function simularRespuestas(a: AlertaDemo) {
    const otros = [...a.destinatarios.keys()].filter((uid) => participantes.has(uid));
    const respuestas: RespuestaAlerta[] = ['voy', 'llamo_autoridades', 'voy'];
    otros.slice(0, 3).forEach((uid, i) => {
      temporizadores.push(setTimeout(() => {
        const d = a.destinatarios.get(uid);
        if (d && !d.vistoEn) { d.vistoEn = new Date().toISOString(); avisar({ alertaId: a.id, evento: 'visto' }); }
      }, 1500 + i * 1200));
      temporizadores.push(setTimeout(() => {
        if (a.estado === 'activa') responder(a, uid, participantes.get(uid)?.tieneVehiculo ? 'vehiculo' : respuestas[i % 3]);
      }, 4000 + i * 2500));
    });
  }

  return {
    async configAlerta(): Promise<ConfigAlerta> {
      vencer();
      const s = yo();
      const p = participantes.get(s.usuarioId);
      const motivo = s.unidadId ? motivoNoEmitir(s.usuarioId) : 'Solo los residentes con casa registrada pueden emitir alertas';
      return {
        redActiva: red.activa, radio: red.radio, puedoEmitir: motivo == null, motivoNoPuede: motivo,
        puedoConfigurar: puedeConfigurar(s),
        alertasActivas: alertas.filter((a) => a.estado === 'activa' && puedoVer(a, s.usuarioId)).length,
        participacion: p ? { activo: p.activo, tieneVehiculo: p.tieneVehiculo, personalSalud: p.personalSalud, telefono: p.telefono,
                             suspendidoHasta: p.suspendidoHasta, motivoSuspension: p.motivoSuspension } : null,
      };
    },
    async fijarParticipacion(d: DatosParticipacion) {
      const s = yo();
      if (!s.unidadId) throw new Error('Solo los residentes con casa registrada participan en la alerta vecinal');
      const previo = participantes.get(s.usuarioId);
      participantes.set(s.usuarioId, { usuarioId: s.usuarioId, ...d, telefono: d.telefono?.trim() || null,
        suspendidoHasta: previo?.suspendidoHasta ?? null, motivoSuspension: previo?.motivoSuspension ?? null });
      await espera();
    },
    async configurarRedAlerta(activa: boolean, radio?: number) {
      const s = yo();
      if (!puedeConfigurar(s)) throw new Error('Solo presidencia o la administración configura la alerta vecinal');
      const cambio = red.activa !== activa;
      red.activa = activa;
      if (radio !== undefined) red.radio = Math.max(0, Math.min(50, Math.round(radio)));
      if (cambio) {
        k.notificar([...new Set(k.miembros().filter((m) => m.activo).map((m) => m.usuarioId))], 'general',
          activa ? 'Alerta vecinal disponible' : 'Alerta vecinal desactivada',
          activa ? 'La junta activó la alerta vecinal. Si quiere avisar o recibir avisos de emergencia de sus vecinos, inscríbase en Alerta vecinal.'
                 : 'La junta desactivó la alerta vecinal en el condominio.', { pantalla: 'alerta' });
      }
      await espera();
    },
    async participantesAlerta(): Promise<ParticipanteAlerta[]> {
      const s = yo();
      if (!s.esJunta) throw new Error('Solo la junta ve los participantes');
      return [...participantes.values()].map((p) => ({
        usuarioId: p.usuarioId, nombre: nombreDe(p.usuarioId), unidad: k.etiquetaUnidad(unidadDe(p.usuarioId)), activo: p.activo,
        tieneVehiculo: p.tieneVehiculo, personalSalud: p.personalSalud, suspendidoHasta: p.suspendidoHasta, motivoSuspension: p.motivoSuspension,
        alertasEmitidas: alertas.filter((a) => a.emisorId === p.usuarioId).length,
        falsasAlarmas: alertas.filter((a) => a.emisorId === p.usuarioId && a.estado === 'falsa_alarma').length,
      })).sort((a, b) => (a.unidad ?? '').localeCompare(b.unidad ?? ''));
    },
    async suspenderDeAlerta(uid: string, dias: number, motivo?: string) {
      const s = yo();
      if (!puedeConfigurar(s)) throw new Error('Sin permiso');
      const p = participantes.get(uid);
      if (!p) throw new Error('Esa persona no participa en la alerta vecinal');
      p.suspendidoHasta = dias > 0 ? new Date(Date.now() + dias * 86_400_000).toISOString() : null;
      p.motivoSuspension = dias > 0 ? motivo?.trim() || null : null;
    },
    async cercania(): Promise<CercaniaUnidad[]> {
      const s = yo();
      if (!s.esJunta) throw new Error('Solo la junta ve la cercanía');
      return k.unidades.map((u) => ({ unidadId: u.id, etiqueta: k.etiquetaUnidad(u.id)!, sector: sector(u), posicion: posicion(u),
                                      personalizada: cercania.has(u.id) }))
        .sort((a, b) => a.sector.localeCompare(b.sector) || (a.posicion ?? 1e9) - (b.posicion ?? 1e9));
    },
    async fijarCercania(cambios: { unidadId: string; sector: string | null; posicion: number | null }[]) {
      const s = yo();
      if (!puedeConfigurar(s)) throw new Error('Sin permiso');
      for (const c of cambios) cercania.set(c.unidadId, { sector: c.sector?.trim() || null, posicion: c.posicion });
      return cambios.length;
    },
    async emitirAlerta(n: NuevaAlerta): Promise<AlertaVecinal> {
      const s = yo();
      if (n.verificacion === 'clave' && !n.clave?.trim()) throw new Error('Clave incorrecta: no se envió la alerta');
      if (!s.unidadId) throw new Error('Solo los residentes con casa registrada pueden emitir alertas');
      const motivo = motivoNoEmitir(s.usuarioId);
      if (motivo) throw new Error(motivo);
      await espera();
      const a = crear(s.usuarioId, n.tipo, n.nota ?? null, n.verificacion);
      simularRespuestas(a);
      return vista(a, s.usuarioId);
    },
    async alertas(soloActivas?: boolean): Promise<AlertaVecinal[]> {
      vencer();
      const s = yo();
      return alertas.filter((a) => puedoVer(a, s.usuarioId) && (!soloActivas || a.estado === 'activa')).slice(0, 30).map((a) => vista(a, s.usuarioId));
    },
    async alerta(id: string) { const { a, s } = buscar(id); return vista(a, s.usuarioId); },
    async marcarAlertaVista(id: string) {
      const { a, s } = buscar(id);
      const d = a.destinatarios.get(s.usuarioId);
      if (d && !d.vistoEn) { d.vistoEn = new Date().toISOString(); avisar({ alertaId: a.id, evento: 'visto' }); }
    },
    async responderAlerta(id: string, r: RespuestaAlerta) {
      const { a, s } = buscar(id);
      if (!a.destinatarios.has(s.usuarioId)) throw new Error('No tiene permiso para esto.');
      responder(a, s.usuarioId, r);
      return vista(a, s.usuarioId);
    },
    async cerrarAlerta(id: string, estado: 'atendida' | 'falsa_alarma' | 'cancelada', nota?: string) {
      const { a, s } = buscar(id);
      if (!(a.emisorId === s.usuarioId || s.esJunta)) throw new Error('No tiene permiso para esto.');
      if (a.estado !== 'activa') throw new Error('La alerta ya está cerrada');
      a.estado = estado; a.cerradaEn = new Date().toISOString(); a.notaCierre = nota?.trim() || null;
      const casa = k.etiquetaUnidad(a.unidadId);
      k.notificar([...a.destinatarios.keys()], 'alerta_cerrada',
        estado === 'atendida' ? `✅ Emergencia atendida en ${casa}` : estado === 'falsa_alarma' ? `Falsa alarma en ${casa}` : `Alerta cancelada en ${casa}`,
        (estado === 'atendida' ? `La situación en ${casa} ya fue atendida. Gracias a quienes respondieron.`
          : estado === 'falsa_alarma' ? `La alerta de ${casa} fue una falsa alarma. No hace falta acudir.`
          : 'Quien emitió la alerta la canceló. No hace falta acudir.') + (a.notaCierre ? ` Nota: ${a.notaCierre}` : ''),
        { alertaId: a.id, pantalla: 'alerta' });
      avisar({ alertaId: a.id, evento: 'cerrada' });
      return vista(a, s.usuarioId);
    },
    async ampliarAlerta(id: string) {
      const { a, s } = buscar(id);
      if (!(a.emisorId === s.usuarioId || s.esJunta)) throw new Error('No tiene permiso para esto.');
      if (a.estado !== 'activa') throw new Error('La alerta ya está cerrada');
      if (a.alcance === 'todos') return vista(a, s.usuarioId);
      a.alcance = 'todos';
      const nuevos: string[] = [];
      for (const m of k.miembros()) {
        if (m.activo && participanteActivo(m.usuarioId) && m.usuarioId !== a.emisorId && !a.destinatarios.has(m.usuarioId)) {
          a.destinatarios.set(m.usuarioId, { motivo: 'condominio', vistoEn: null }); nuevos.push(m.usuarioId);
        }
      }
      const casa = k.etiquetaUnidad(a.unidadId);
      k.notificar(nuevos, 'alerta', `🚨 Emergencia en ${casa} (aviso a todo el condominio)`,
        `Se amplió una alerta de ${casa} a todo el condominio. Abra la alerta para responder.`, { alertaId: a.id, pantalla: 'alerta', tipoAlerta: a.tipo });
      avisar({ alertaId: a.id, evento: 'ampliada' });
      return vista(a, s.usuarioId);
    },
    suscribirAlertas(f: (e: EventoAlerta) => void) { oyentes.add(f); return () => { oyentes.delete(f); }; },
    async simularAlertaVecino() {
      const s = yo();
      // Un vecino cercano e inscrito pide ayuda (Pedro, B-34; si usted es Pedro, Rosa, B-31).
      const emisor = s.usuarioId === 'usr-pedro' ? 'usr-rosa' : 'usr-pedro';
      const previa = alertas.find((a) => a.emisorId === emisor && a.estado === 'activa');
      if (previa) { previa.estado = 'cancelada'; previa.cerradaEn = new Date().toISOString(); }
      if (!red.activa) throw new Error('La alerta vecinal está desactivada en el condominio');
      if (!s.esJunta && !participanteActivo(s.usuarioId)) throw new Error('Inscríbase en la alerta vecinal para recibir los avisos de sus vecinos');
      const tipos: TipoAlerta[] = ['seguridad', 'medica'];
      const tipo = tipos[alertas.length % 2];
      crear(emisor, tipo, tipo === 'seguridad' ? 'Hay una persona extraña saltando la reja del estacionamiento' : 'Mi mamá se cayó y no se puede levantar', 'biometria');
      if (!alertas[0].destinatarios.has(s.usuarioId) && !s.esJunta) {
        throw new Error('Usted no está cerca de esa casa: con el radio actual no le llegó la alerta');
      }
    },
    cancelarSimulaciones() { for (const t of temporizadores) clearTimeout(t); temporizadores.length = 0; },

    // ---- Enlace de invitación ----
    async enlaceInvitacion(regenerar?: boolean): Promise<EnlaceInvitacion> {
      const s = yo();
      if (!puedeConfigurar(s)) throw new Error('Solo presidencia o la administración comparte el enlace de invitación');
      if (regenerar) enlace = nuevoEnlace();
      return { ...enlace };
    },
    async infoInvitacion(codigo: string): Promise<InfoInvitacion> {
      await espera();
      if (codigo.trim().toUpperCase() !== enlace.codigo && codigo.trim().toUpperCase() !== 'INV-DEMO26') {
        throw new Error('Enlace inválido o vencido. Pida uno nuevo a su junta de condominio');
      }
      return { condominioId: 'demo-condo', condominio: k.condominio(), ciudad: 'Maracay',
               unidades: k.unidades.map((u) => ({ id: u.id, etiqueta: k.etiquetaUnidad(u.id)! })) };
    },
    async unirseConEnlace(codigo: string, unidadId: string, rol: 'propietario' | 'inquilino'): Promise<'pendiente' | 'aprobada'> {
      await this.infoInvitacion(codigo);
      const u = k.usuarioActual();
      if (!u) throw new Error('Inicie sesión');
      if (!k.unidades.some((x) => x.id === unidadId)) throw new Error('Esa casa no pertenece a este condominio');
      enlace.usos++;
      k.nuevaSolicitud(u.id, u.nombre, unidadId, rol);
      const casa = k.etiquetaUnidad(unidadId);
      k.notificar(k.miembros().filter((m) => m.activo && ['presidente', 'administrador'].includes(m.rol)).map((m) => m.usuarioId),
        'solicitud_ingreso', `Solicitud de ingreso: ${casa}`,
        `${u.nombre} pide entrar al condominio como residente de ${casa}. Verifique que sea de esa casa antes de aprobar.`, { pantalla: 'accesos' });
      return 'pendiente';
    },
  };
}
