// Implementación de producción: servidor propio de ZPro Condominio (API REST + WebSocket).
// Contrato: servidor/CONTRATO_API.md. El servidor devuelve exactamente los tipos de compartido/tipos.ts.
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type { Api, EventoAlerta } from './api';
import type {
  Adjunto, CasaDirectorio, CodigoAcceso, ComentarioReporte, Condominio, Conversacion, CuentaFinanciera, DatosPagoZentaPro,
  EstadoCuenta, EventoTiempoReal, FacturaZentaPro, FilaActa, Gasto, Marca, MiembroCondominio, Mensaje, MovimientoBancario,
  Pago, Partida, Reporte, ResultadoExtracto, ResumenPanel, Rol, Sesion, SesionTokens, SolicitudIngresoJunta,
  UnidadConSaldo, Yo, Aviso, BandejaNotificaciones, Notificacion,
  AlertaVecinal, CercaniaUnidad, ConfigAlerta, EnlaceInvitacion, InfoInvitacion, ParticipanteAlerta,
} from './tipos';

const JUNTA: Rol[] = ['presidente', 'tesorero', 'vocal', 'administrador'];
const FINANZAS: Rol[] = ['presidente', 'tesorero', 'administrador'];
const CLAVE_REFRESCO = 'zpro.refresco';
const CLAVE_CONDOMINIO = 'zpro.condominio';

export class ErrorServidor extends Error {
  constructor(mensaje: string, public estado: number, public codigo?: string) { super(mensaje); }
}

// ---------- Guardado de datos de sesión en el dispositivo ----------
// Teléfono: Preferences (almacenamiento nativo). Web: localStorage (puede fallar en modo privado → solo memoria).
const memoria = new Map<string, string>();
const guardado = {
  async leer(k: string): Promise<string | null> {
    try {
      if (Capacitor.isNativePlatform()) return (await Preferences.get({ key: k })).value;
      return localStorage.getItem(k) ?? memoria.get(k) ?? null;
    } catch { return memoria.get(k) ?? null; }
  },
  async escribir(k: string, v: string) {
    memoria.set(k, v);
    try {
      if (Capacitor.isNativePlatform()) await Preferences.set({ key: k, value: v });
      else localStorage.setItem(k, v);
    } catch { /* sin almacenamiento persistente: queda en memoria */ }
  },
  async borrar(k: string) {
    memoria.delete(k);
    try {
      if (Capacitor.isNativePlatform()) await Preferences.remove({ key: k });
      else localStorage.removeItem(k);
    } catch { /* nada */ }
  },
};

const MENSAJE_POR_ESTADO: Record<number, string> = {
  401: 'Su sesión venció. Vuelva a iniciar sesión.', 403: 'No tiene permiso para esto.', 404: 'No se encontró.',
  409: 'Ya existe.', 413: 'El archivo es demasiado grande (máx. 25 MB).', 429: 'Demasiados intentos. Espere unos minutos.',
};

type Cuerpo = Record<string, unknown> | unknown[] | FormData | undefined;

/** Construye un FormData: los valores undefined/null se omiten; los booleanos y números van como texto. */
function formulario(campos: Record<string, unknown>, archivos: Record<string, Blob | Blob[] | null | undefined> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null && v !== '') f.append(k, String(v));
  for (const [k, v] of Object.entries(archivos)) {
    for (const b of Array.isArray(v) ? v : v ? [v] : []) {
      const nombre = (b as File).name || `${k}.${b.type === 'image/png' ? 'png' : b.type === 'application/pdf' ? 'pdf' : 'jpg'}`;
      f.append(k, b, nombre);
    }
  }
  return f;
}

export function crearApiServidor(base: string): Api {
  const raiz = base.replace(/\/+$/, '');
  let acceso: string | null = null;
  let accesoVence = 0;
  let refresco: string | null = null;
  let renovando: Promise<boolean> | null = null;
  let yo: Yo | null = null;
  let sesion: Sesion | null = null;

  // ---------- HTTP ----------
  async function fijarTokens(t: SesionTokens) {
    acceso = t.acceso;
    accesoVence = new Date(t.accesoExpiraEn).getTime();
    refresco = t.refresco;
    await guardado.escribir(CLAVE_REFRESCO, t.refresco);
  }
  async function olvidarSesion() {
    acceso = null; refresco = null; accesoVence = 0; yo = null; sesion = null;
    tiempoReal.cerrar();
    await guardado.borrar(CLAVE_REFRESCO);
  }

  /** Una sola renovación a la vez aunque varias peticiones reciban 401 juntas. */
  function renovar(): Promise<boolean> {
    if (!renovando) {
      renovando = (async () => {
        if (!refresco) return false;
        try {
          const r = await fetch(`${raiz}/api/v1/auth/refrescar`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresco }),
          });
          if (!r.ok) { if (r.status === 401) await olvidarSesion(); return false; }
          await fijarTokens(await r.json());
          return true;
        } catch { return false; }       // sin conexión: se reintenta en la próxima petición
      })().finally(() => { renovando = null; });
    }
    return renovando;
  }

  async function pedir<T>(metodo: string, ruta: string, cuerpo?: Cuerpo, conSesion = true): Promise<T> {
    if (conSesion && refresco && (!acceso || Date.now() > accesoVence - 30_000)) await renovar();
    const esForm = cuerpo instanceof FormData;
    const hacer = () => fetch(`${raiz}/api/v1/${ruta}`, {
      method: metodo,
      headers: {
        ...(conSesion && acceso ? { authorization: `Bearer ${acceso}` } : {}),
        ...(cuerpo !== undefined && !esForm ? { 'content-type': 'application/json' } : {}),
      },
      body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
    });
    let r: Response;
    try {
      r = await hacer();
      // 401 por sesión vencida → se renueva y se reintenta. (401 "clave" = la clave que escribió la persona es incorrecta.)
      if (r.status === 401 && conSesion && refresco) {
        const j = await r.clone().json().catch(() => null) as { codigo?: string } | null;
        if (j?.codigo !== 'clave' && await renovar()) r = await hacer();
      }
    } catch {
      throw new ErrorServidor('Sin conexión con el servidor. Revise su internet e intente de nuevo.', 0, 'red');
    }
    if (!r.ok) {
      const j = await r.json().catch(() => null) as { error?: string; codigo?: string } | null;
      throw new ErrorServidor(j?.error ?? MENSAJE_POR_ESTADO[r.status] ?? `Error del servidor (${r.status})`, r.status, j?.codigo);
    }
    if (r.status === 204 || r.status === 202 && !r.headers.get('content-type')?.includes('json')) return undefined as T;
    const texto = await r.text();
    return (texto ? JSON.parse(texto) : undefined) as T;
  }

  // ---------- Sesión dentro de un condominio ----------
  function sesionDe(y: Yo, condominioId: string): Sesion | null {
    const ms = y.membresias.filter((m) => m.condominioId === condominioId);
    if (!ms.length) return null;
    const roles = ms.map((m) => m.rol);
    const conUnidad = ms.find((m) => m.unidadId);
    return {
      usuarioId: y.usuario.id, nombre: y.usuario.nombre,
      rol: roles.find((r) => JUNTA.includes(r)) ?? roles[0],
      unidadId: conUnidad?.unidadId ?? null, unidad: conUnidad?.unidad ?? null,
      esJunta: roles.some((r) => JUNTA.includes(r)), manejaFinanzas: roles.some((r) => FINANZAS.includes(r)),
      condominioId, condominio: ms[0].condominio,
    };
  }
  async function cargarYo(): Promise<Sesion | null> {
    yo = await pedir<Yo>('GET', 'auth/yo');
    const condos = [...new Set(yo.membresias.map((m) => m.condominioId))];
    const recordado = await guardado.leer(CLAVE_CONDOMINIO);
    const cid = recordado && condos.includes(recordado) ? recordado : condos.length === 1 ? condos[0] : null;
    sesion = cid ? sesionDe(yo, cid) : null;
    if (sesion) tiempoReal.asegurar();
    return sesion;
  }
  const exigir = () => { if (!sesion?.condominioId) throw new ErrorServidor('Elija su condominio', 0); return sesion; };
  const c = (ruta = '') => `c/${exigir().condominioId}${ruta}`;

  // ---------- Tiempo real (WebSocket) ----------
  const tiempoReal = (() => {
    let ws: WebSocket | null = null;
    let intentos = 0;
    let ping: ReturnType<typeof setInterval> | null = null;
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let cerrado = false;
    const subs = new Map<string, Set<(m: Mensaje) => void>>();
    const bandeja = new Set<() => void>();
    const avisos = new Set<(n: Notificacion) => void>();
    const alertas = new Set<(e: EventoAlerta) => void>();
    const enviar = (o: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };
    const hayInteres = () => subs.size > 0 || bandeja.size > 0 || avisos.size > 0 || alertas.size > 0;

    async function conectar() {
      reintento = null;
      if (cerrado || ws || !refresco) return;
      if (!acceso || Date.now() > accesoVence - 30_000) await renovar();
      if (!acceso) return;
      const url = `${raiz.replace(/^http/, 'ws')}/api/v1/tiempo-real?token=${encodeURIComponent(acceso)}`;
      try { ws = new WebSocket(url); } catch { programar(); return; }
      ws.onopen = () => {
        intentos = 0;
        for (const cid of subs.keys()) enviar({ tipo: 'suscribir', conversacionId: cid });
        ping = setInterval(() => enviar({ tipo: 'ping' }), 25_000);
      };
      ws.onmessage = (e) => {
        let ev: EventoTiempoReal;
        try { ev = JSON.parse(String(e.data)); } catch { return; }
        if (ev.tipo === 'mensaje' || ev.tipo === 'mensaje_actualizado') {
          subs.get(ev.conversacionId)?.forEach((f) => f(ev.mensaje));
          bandeja.forEach((f) => f());
        } else if (ev.tipo === 'bandeja') bandeja.forEach((f) => f());
        else if (ev.tipo === 'notificacion') avisos.forEach((f) => f(ev.notificacion));
        else if (ev.tipo === 'alerta') alertas.forEach((f) => f({ alertaId: ev.alertaId, evento: ev.evento }));
      };
      ws.onclose = () => {
        if (ping) clearInterval(ping);
        ping = null; ws = null;
        if (!cerrado && hayInteres()) programar();
      };
      ws.onerror = () => { /* onclose se encarga */ };
    }
    function programar() {
      if (reintento || cerrado) return;
      const espera = Math.min(30_000, 1000 * 2 ** intentos++) + Math.random() * 500;   // 1 s, 2 s, 4 s… máx. 30 s
      reintento = setTimeout(() => { void conectar(); }, espera);
    }
    return {
      abierto: () => ws?.readyState === WebSocket.OPEN,
      asegurar() { cerrado = false; if (!ws && hayInteres()) void conectar(); },
      conversacion(cid: string, fn: (m: Mensaje) => void) {
        cerrado = false;
        const set = subs.get(cid) ?? new Set();
        set.add(fn); subs.set(cid, set);
        if (ws?.readyState === WebSocket.OPEN) enviar({ tipo: 'suscribir', conversacionId: cid });
        else void conectar();
        return () => { set.delete(fn); if (!set.size) subs.delete(cid); };
      },
      bandeja(fn: () => void) {
        cerrado = false;
        bandeja.add(fn);
        void conectar();
        return () => { bandeja.delete(fn); };
      },
      notificaciones(fn: (n: Notificacion) => void) {
        cerrado = false;
        avisos.add(fn);
        void conectar();
        return () => { avisos.delete(fn); };
      },
      alertas(fn: (e: EventoAlerta) => void) {
        cerrado = false;
        alertas.add(fn);
        void conectar();
        return () => { alertas.delete(fn); };
      },
      cerrar() {
        cerrado = true;
        if (reintento) clearTimeout(reintento);
        reintento = null;
        ws?.close(); ws = null; subs.clear(); bandeja.clear(); avisos.clear(); alertas.clear();
      },
    };
  })();

  const api: Api = {
    modo: 'servidor',
    sesion: () => sesion,
    cuenta: () => yo,

    async restaurar() {
      refresco = await guardado.leer(CLAVE_REFRESCO);
      if (!refresco) return null;
      try { return await cargarYo(); }
      catch (e) {
        if ((e as ErrorServidor).estado === 401) await olvidarSesion();
        return null;
      }
    },
    async entrar(datos) {
      if (!('correo' in datos)) throw new ErrorServidor('La demostración no está disponible con servidor', 400);
      await fijarTokens(await pedir<SesionTokens>('POST', 'auth/entrar', { correo: datos.correo, clave: datos.clave }, false));
      return cargarYo();
    },
    async salir() {
      const r = refresco;
      await olvidarSesion();
      if (r) await pedir('POST', 'auth/salir', { refresco: r }, false).catch(() => {});
    },

    // ---- Cuenta ----
    async registrar(d) {
      await fijarTokens(await pedir<SesionTokens>('POST', 'auth/registro', { ...d }, false));
      await cargarYo();
    },
    async olvideClave(correo) { await pedir('POST', 'auth/olvide', { correo }, false); },
    async restablecerClave(token, clave) { await pedir('POST', 'auth/restablecer', { token, clave }, false); },
    async verificarCorreo(token) { await pedir('POST', 'auth/verificar-correo', { token }, false); },
    async cambiarClave(actual, nueva) { await pedir('POST', 'auth/cambiar-clave', { actual, nueva }); },
    async yo() { await cargarYo(); return yo!; },
    async elegirCondominio(cid) {
      if (!yo) await cargarYo();
      const s = sesionDe(yo!, cid);
      if (!s) throw new ErrorServidor('No pertenece a ese condominio', 403);
      sesion = s;
      await guardado.escribir(CLAVE_CONDOMINIO, cid);
      tiempoReal.asegurar();
      return s;
    },
    async unirse(codigo) {
      const r = await pedir<{ estado: 'pendiente' | 'aprobada' }>('POST', 'auth/unirse', { codigo });
      await cargarYo();
      return r.estado;
    },
    async fijarAvisosPorCorreo(activo) {
      await pedir('PATCH', 'auth/yo', { avisosPorCorreo: activo });
      if (yo) yo.usuario.avisosPorCorreo = activo;
    },

    // ---- Notificaciones ----
    notificaciones: () => pedir<BandejaNotificaciones>('GET',
      `notificaciones?limite=60${sesion?.condominioId ? `&condominioId=${sesion.condominioId}` : ''}`),
    async marcarNotificaciones(ids) { await pedir('POST', 'notificaciones/leidas', ids ? { ids } : {}); },
    suscribirNotificaciones(alRecibir) {
      // Vía principal: WebSocket. Respaldo: si no está abierto, se consulta cada 30 s y se entregan las nuevas.
      const vistas = new Set<string>();
      const entregar = (n: Notificacion) => {
        if (vistas.has(n.id)) return;
        vistas.add(n.id);
        if (!n.condominioId || n.condominioId === sesion?.condominioId) alRecibir(n);
      };
      // Las que ya existían al suscribirse no se entregan como nuevas.
      const semilla = api.notificaciones().then((b) => { for (const n of b.notificaciones) vistas.add(n.id); }).catch(() => {});
      const quitar = tiempoReal.notificaciones(entregar);
      const respaldo = setInterval(async () => {
        if (tiempoReal.abierto() || !sesion) return;
        try {
          await semilla;
          const b = await api.notificaciones();
          for (const n of [...b.notificaciones].reverse()) if (!n.leida) entregar(n);
        } catch { /* sin conexión */ }
      }, 30_000);
      return () => { quitar(); clearInterval(respaldo); };
    },
    async activarCondominio(codigo) {
      const r = await pedir<{ condominioId: string }>('POST', 'auth/activar-condominio', { codigo });
      await cargarYo();
      await api.elegirCondominio(r.condominioId);
      return r.condominioId;
    },

    // ---- Comunes ----
    condominio: () => pedir<Condominio>('GET', c()),
    async cuentasDePago() { return (await pedir<CuentaFinanciera[]>('GET', c('/cuentas'))).filter((x) => x.datosPago); },
    cuentasFinancieras: () => pedir<CuentaFinanciera[]>('GET', c('/cuentas')),
    tasaBcv: () => pedir('GET', 'tasa-bcv'),
    async fijarTasaBcv(usdVes) { await pedir('POST', c('/tasa-bcv'), { usdVes }); },
    avisos: () => pedir<Aviso[]>('GET', c('/avisos')),
    async crearAviso(a) { await pedir('POST', c('/avisos'), { ...a }); },
    async borrarAviso(id) { await pedir('DELETE', c(`/avisos/${id}`)); },
    async fijarChatVecinos(activo) { await pedir('PUT', c('/chat-vecinos'), { activo }); },

    // ---- Residente ----
    estadoCuenta: (uid) => pedir<EstadoCuenta>('GET', c(`/unidades/${uid}/estado-cuenta`)),
    async reportarPago(p) {
      await pedir('POST', c('/pagos'), formulario({
        unidadId: p.unidadId, fechaPago: p.fechaPago, metodo: p.metodo, moneda: p.moneda, monto: p.monto,
        referencia: p.referencia, bancoOrigen: p.bancoOrigen, cuentaDestinoId: p.cuentaDestinoId, nota: p.nota,
      }, { comprobante: p.comprobante }));
    },

    // ---- Finanzas ----
    panel: () => pedir<ResumenPanel>('GET', c('/panel')),
    pagos: (filtro) => pedir<Pago[]>('GET', c(`/pagos?estado=${filtro}`)),
    async confirmarPago(id) { await pedir('POST', c(`/pagos/${id}/confirmar`), {}); },
    async rechazarPago(id, motivo) { await pedir('POST', c(`/pagos/${id}/rechazar`), { motivo }); },
    gastos: (periodo) => pedir<Gasto[]>('GET', c(`/gastos?periodo=${periodo}`)),
    async registrarGasto(g) {
      await pedir('POST', c('/gastos'), formulario({
        periodo: g.periodo, tipo: g.tipo, categoria: g.categoria, descripcion: g.descripcion, moneda: g.moneda, monto: g.monto,
        tasaBcv: g.tasaBcv, unidadId: g.unidadId, partidaId: g.partidaId, cuentaId: g.cuentaId,
      }, { factura: g.factura }));
    },
    async generarRecibos(periodo) { return (await pedir<{ emitidos: number }>('POST', c('/recibos'), { periodo })).emitidos; },
    unidadesConSaldo: () => pedir<UnidadConSaldo[]>('GET', c('/unidades')),

    movimientosBancarios: (soloPendientes) =>
      pedir<MovimientoBancario[]>('GET', c(`/conciliacion/movimientos${soloPendientes ? '?pendientes=1' : ''}`)),
    cargarExtracto: (cuentaId, archivo, movimientos) =>
      pedir<ResultadoExtracto>('POST', c('/conciliacion/extractos'), { cuentaId, archivo, movimientos }),
    async asignarMovimiento(id, unidadId) { await pedir('POST', c(`/conciliacion/movimientos/${id}/asignar`), { unidadId }); },

    facturasZentaPro: () => pedir<FacturaZentaPro[]>('GET', c('/zentapro/facturas')),
    datosPagoZentaPro: () => pedir<DatosPagoZentaPro>('GET', 'zentapro/datos-pago'),
    async reportarPagoZentaPro(fid, p) { await pedir('POST', c(`/zentapro/facturas/${fid}/pagos`), { ...p }); },

    miembros: () => pedir<MiembroCondominio[]>('GET', c('/miembros')),
    async cambiarMiembro(uid, cambios) { await pedir('PATCH', c(`/miembros/${uid}`), { ...cambios }); },
    codigosAcceso: () => pedir<CodigoAcceso[]>('GET', c('/codigos')),
    generarCodigos: (d) => pedir<CodigoAcceso[]>('POST', c('/codigos'), { ...d }),
    solicitudes: () => pedir<SolicitudIngresoJunta[]>('GET', c('/solicitudes')),
    async resolverSolicitud(id, aprobar) { await pedir('POST', c(`/solicitudes/${id}`), { aprobar }); },

    // ---- Partidas ----
    partidas: () => pedir<Partida[]>('GET', c('/partidas')),
    async crearPartida(p) { await pedir('POST', c('/partidas'), { ...p }); },
    async votar(vid, opcionId) { await pedir('POST', c(`/votaciones/${vid}/votar`), { opcionId }); },
    async cerrarVotacion(vid) { return (await pedir<{ aprobada: boolean }>('POST', c(`/votaciones/${vid}/cerrar`), {})).aprobada; },

    // ---- Reportes ----
    reportes: () => pedir<Reporte[]>('GET', c('/reportes')),
    async crearReporte(r) {
      await pedir('POST', c('/reportes'), formulario({
        categoria: r.categoria, titulo: r.titulo, descripcion: r.descripcion, ubicacion: r.ubicacion,
        anonimo: r.anonimo, visibilidad: r.visibilidad,
      }, { fotos: r.fotos }));
    },
    async cambiarEstadoReporte(id, estado, respuesta) { await pedir('PATCH', c(`/reportes/${id}`), { estado, respuesta }); },
    comentariosReporte: (id) => pedir<ComentarioReporte[]>('GET', c(`/reportes/${id}/comentarios`)),
    async comentarReporte(id, texto) { await pedir('POST', c(`/reportes/${id}/comentarios`), { texto }); },

    // ---- Marca y documentos ----
    marca: () => pedir<Marca>('GET', c('/marca')),
    async guardarMarca(cm) {
      const { logo, fotoEntrada, ...campos } = cm;
      await pedir('PATCH', c('/marca'), formulario(campos, { logo, fotoEntrada }));
    },
    async registrarDocumento(d) { return (await pedir<{ codigo: string }>('POST', c('/documentos'), { ...d })).codigo; },
    async emitirSolvencia(uid) { return (await pedir<{ codigo: string }>('POST', c(`/unidades/${uid}/solvencia`), {})).codigo; },
    datosActa: (vid) => pedir<FilaActa[]>('GET', c(`/votaciones/${vid}/acta`)),

    // ---- Directorio y chat ----
    directorio: () => pedir<CasaDirectorio[]>('GET', c('/directorio')),
    async mostrarEnDirectorio(mostrar) { await pedir('PATCH', c('/directorio/yo'), { mostrar }); },
    conversaciones: () => pedir<Conversacion[]>('GET', c('/conversaciones')),
    async abrirConCasa(unidadId) { return (await pedir<{ id: string }>('POST', c('/conversaciones/casa'), { unidadId })).id; },
    async abrirConJunta() { return (await pedir<{ id: string }>('POST', c('/conversaciones/junta'), {})).id; },
    async crearSala(tipo, titulo, unidades) { return (await pedir<{ id: string }>('POST', c('/salas'), { tipo, titulo, unidades })).id; },
    mensajes: (cid, antesDe) =>
      pedir<Mensaje[]>('GET', c(`/conversaciones/${cid}/mensajes?limite=50${antesDe ? `&antes=${encodeURIComponent(antesDe)}` : ''}`)),
    enviarMensaje: (cid, m) =>
      pedir<Mensaje>('POST', c(`/conversaciones/${cid}/mensajes`), formulario({ texto: m.texto, comoJunta: m.comoJunta || undefined }, { archivo: m.archivo })),
    async marcarLeido(cid) { await pedir('POST', c(`/conversaciones/${cid}/leido`), {}); },
    suscribirConversacion(cid, alRecibir) {
      // Vía principal: WebSocket. Respaldo: si el WebSocket no está abierto, se consulta cada 10 s.
      const vistos = new Set<string>();
      let desde = new Date().toISOString();
      const entregar = (m: Mensaje) => {
        if (m.creadoEn > desde) desde = m.creadoEn;
        vistos.add(m.id);
        alRecibir(m);
      };
      const quitar = tiempoReal.conversacion(cid, entregar);
      const respaldo = setInterval(async () => {
        if (tiempoReal.abierto() || !sesion) return;
        try {
          const ultimos = await api.mensajes(cid);
          for (const m of ultimos) if (m.creadoEn >= desde && !vistos.has(m.id)) entregar(m);
        } catch { /* sin conexión: se intenta en la próxima vuelta */ }
      }, 10_000);
      return () => { quitar(); clearInterval(respaldo); };
    },
    suscribirBandeja(alCambiar) { return tiempoReal.bandeja(alCambiar); },
    async descargarAdjunto(a: Adjunto) {
      if (a.vencido || !a.url) throw new ErrorServidor('El archivo ya no está en el servidor', 410);
      const r = await fetch(a.url).catch(() => null);
      if (!r) throw new ErrorServidor('Sin conexión con el servidor', 0);
      if (r.status === 410) throw new ErrorServidor('El archivo ya no está en el servidor', 410);
      if (r.status === 403) throw new ErrorServidor('El enlace del archivo venció: vuelva a abrir la conversación', 403);
      if (!r.ok) throw new ErrorServidor('No se pudo descargar el archivo', r.status);
      return r.blob();
    },
    async bloquearCasa(unidadId, bloquear) {
      if (bloquear) await pedir('POST', c('/bloqueos'), { unidadId });
      else await pedir('DELETE', c(`/bloqueos/${unidadId}`));
    },
    async denunciarMensaje(id, motivo) { await pedir('POST', c(`/mensajes/${id}/denunciar`), { motivo }); },

    // ---- Alerta vecinal ----
    configAlerta: () => pedir<ConfigAlerta>('GET', c('/alerta')),
    async fijarParticipacion(p) { await pedir('PUT', c('/alerta/participacion'), { ...p }); },
    async configurarRedAlerta(activa, radio) { await pedir('PUT', c('/alerta/red'), radio === undefined ? { activa } : { activa, radio }); },
    participantesAlerta: () => pedir<ParticipanteAlerta[]>('GET', c('/alerta/participantes')),
    async suspenderDeAlerta(uid, dias, motivo) { await pedir('POST', c(`/alerta/participantes/${uid}/suspender`), { dias, motivo }); },
    cercania: () => pedir<CercaniaUnidad[]>('GET', c('/alerta/cercania')),
    async fijarCercania(cambios) { return (await pedir<{ actualizadas: number }>('PUT', c('/alerta/cercania'), cambios)).actualizadas; },
    emitirAlerta: (a) => pedir<AlertaVecinal>('POST', c('/alertas'), { ...a }),
    alertas: (soloActivas) => pedir<AlertaVecinal[]>('GET', c(`/alertas${soloActivas ? '?activas=si' : ''}`)),
    alerta: (id) => pedir<AlertaVecinal>('GET', c(`/alertas/${id}`)),
    async marcarAlertaVista(id) { await pedir('POST', c(`/alertas/${id}/visto`), {}); },
    responderAlerta: (id, respuesta) => pedir<AlertaVecinal>('POST', c(`/alertas/${id}/responder`), { respuesta }),
    cerrarAlerta: (id, estado, nota) => pedir<AlertaVecinal>('POST', c(`/alertas/${id}/cerrar`), nota ? { estado, nota } : { estado }),
    ampliarAlerta: (id) => pedir<AlertaVecinal>('POST', c(`/alertas/${id}/ampliar`), {}),
    suscribirAlertas(alCambiar) {
      // WebSocket; de respaldo, si no está abierto, se consultan las activas cada 20 s y se avisa de las nuevas.
      const conocidas = new Set<string>();
      let primera = true;
      const quitar = tiempoReal.alertas(alCambiar);
      const respaldo = setInterval(async () => {
        if (tiempoReal.abierto() || !sesion) return;
        try {
          const activas = await api.alertas(true);
          for (const a of activas) {
            if (!conocidas.has(a.id) && !primera) alCambiar({ alertaId: a.id, evento: 'nueva' });
            conocidas.add(a.id);
          }
          primera = false;
        } catch { /* sin conexión */ }
      }, 20_000);
      return () => { quitar(); clearInterval(respaldo); };
    },
    async registrarDispositivo(token, plataforma) { await pedir('POST', 'auth/dispositivos', { token, plataforma }); },

    // ---- Enlace de invitación ----
    enlaceInvitacion: (regenerar) => regenerar
      ? pedir<EnlaceInvitacion>('POST', c('/invitacion/regenerar'), {})
      : pedir<EnlaceInvitacion>('GET', c('/invitacion')),
    infoInvitacion: (codigo) => pedir<InfoInvitacion>('GET', `invitacion/${encodeURIComponent(codigo.trim().toUpperCase())}`, undefined, false),
    async unirseConEnlace(codigo, unidadId, rol) {
      const r = await pedir<{ estado: 'pendiente' | 'aprobada' }>('POST', `invitacion/${encodeURIComponent(codigo.trim().toUpperCase())}/unirse`, { unidadId, rol });
      await cargarYo();
      return r.estado;
    },
  };
  return api;
}
