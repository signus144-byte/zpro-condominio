// Hub de tiempo real: conexiones WebSocket + LISTEN de PostgreSQL (zpro_mensajes, zpro_pagos, zpro_notificaciones).
// Las notificaciones además salen por push (Firebase, si está configurado) y por correo (si la persona lo permite).
// Un solo cliente pg escucha; cada aviso se lee una vez (rol servicio) y se reparte a los sockets autorizados.
import type { FastifyBaseLogger } from 'fastify';
import pg from 'pg';
import type { WebSocket } from 'ws';
import type { EventoTiempoReal, Notificacion } from '../../../compartido/tipos.js';
import type { Config } from '../config.js';
import type { EnviarCorreo, HubTiempoReal } from '../contexto.js';
import { comoServicio, comoUsuario } from '../db/conexion.js';
import { crearFirmador } from '../auth/tokens.js';
import { leerMensaje, mapMensaje } from '../rutas/chat-datos.js';
import { crearPush, type Push } from '../push.js';

const MAX_SUSCRIPCIONES = 300;
const MAX_CONEXIONES_POR_USUARIO = 6;

export interface Conexion {
  usuarioId: string;
  socket: WebSocket;
  suscritas: Set<string>;
}

export interface HubReal extends HubTiempoReal {
  conectar(usuarioId: string, socket: WebSocket): Conexion;
  desconectar(con: Conexion): void;
  /** Suscribe si el usuario puede ver la conversación (lo decide la BD con su identidad). */
  suscribir(con: Conexion, conversacionId: string): Promise<boolean>;
  /** Para pruebas: cuántos sockets hay. */
  conectados(): number;
}

export const esHubReal = (h: HubTiempoReal): h is HubReal => typeof (h as HubReal).conectar === 'function';

const enviar = (s: WebSocket, ev: EventoTiempoReal | Record<string, unknown>) => {
  if (s.readyState === 1) s.send(JSON.stringify(ev));
};

export async function crearHub(cfg: Config, pool: pg.Pool, log: FastifyBaseLogger, enviarCorreo?: EnviarCorreo): Promise<HubReal> {
  const firmador = crearFirmador(cfg.JWT_SECRETO);
  const firmar = async (path: string) => `${cfg.URL_PUBLICA}/api/v1/archivos/f/${await firmador.archivo('chat', path)}`;
  const push: Push | null = crearPush(cfg.FCM_CUENTA_SERVICIO, pool, log);
  const porUsuario = new Map<string, Set<Conexion>>();
  let cerrando = false;
  let oyente: pg.Client | null = null;
  let reintento: NodeJS.Timeout | null = null;

  const todas = () => [...porUsuario.values()].flatMap((s) => [...s]);

  async function alMensaje(d: { op: string; id: string; conversacion_id: string }) {
    if (d.op === 'INSERT' && push) push.mensaje(d.id).catch((e) => log.warn({ e }, 'push de mensaje falló'));
    if (!porUsuario.size) return;
    const { fila, participantes } = await comoServicio(pool, async (c) => ({
      fila: await leerMensaje(c, d.id),
      participantes: (await c.query(`select participantes_conversacion($1) as u`, [d.conversacion_id])).rows.map((r) => r.u as string),
    }));
    if (!fila) return;
    const tipo = d.op === 'INSERT' ? 'mensaje' : 'mensaje_actualizado';
    const autorizados = new Set(participantes);
    for (const con of todas()) {
      if (!autorizados.has(con.usuarioId)) { con.suscritas.delete(d.conversacion_id); continue; }   // perdió el acceso
      if (con.suscritas.has(d.conversacion_id)) {
        enviar(con.socket, { tipo, conversacionId: d.conversacion_id, mensaje: await mapMensaje(fila, con.usuarioId, firmar) } as EventoTiempoReal);
      } else if (d.op === 'INSERT') {
        enviar(con.socket, { tipo: 'bandeja', conversacionId: d.conversacion_id });
      }
    }
  }

  async function alPago(d: { id: string; unidad_id: string; estado: string }) {
    if (!porUsuario.size) return;   // el aviso a la casa lo lleva la notificación (zpro_notificaciones)
    const usuarios = await comoServicio(pool, async (c) =>
      (await c.query(`select usuarios_de_unidad($1) as u`, [d.unidad_id])).rows.map((r) => r.u as string));
    hub.aUsuarios(usuarios, { tipo: 'pago', pagoId: d.id, estado: d.estado });
  }

  async function alNotificacion(d: { id: string; usuario_id: string }) {
    const n = await comoServicio(pool, async (c) => (await c.query(`select n.*, e.email, e.nombre as persona, e.avisos_por_correo,
             e.condominio, e.tokens from notificaciones n, datos_envio_notificacion(n.id) e where n.id = $1`, [d.id])).rows[0]);
    if (!n) return;
    hub.aUsuarios([d.usuario_id], { tipo: 'notificacion', notificacion: aNotificacion(n) });
    if (push && n.tokens?.length) {
      push.enviarA(n.tokens, n.titulo, n.cuerpo, { tipo: n.tipo, notificacionId: n.id,
          ...(n.datos?.pagoId ? { pagoId: n.datos.pagoId } : {}), ...(n.datos?.alertaId ? { alertaId: n.datos.alertaId } : {}) },
        n.tipo === 'alerta')
        .catch((e) => log.warn({ e }, 'push de notificación falló'));
    }
    if (enviarCorreo && n.correo && n.email && n.avisos_por_correo) {
      enviarCorreo({
        para: n.email, asunto: `${n.titulo} · ${n.condominio ?? 'ZPro Condominio'}`,
        texto: `Hola ${n.persona},\n\n${n.cuerpo}\n\nAbra la app ZPro Condominio para ver el detalle.\n\n` +
               `(Puede dejar de recibir estos correos en la app: Mi cuenta → Avisos por correo.)`,
      }).catch((e) => log.warn({ e }, 'correo de notificación falló'));
    }
  }

  async function alAlerta(d: { alerta_id: string; evento: string }) {
    if (!porUsuario.size) return;
    const usuarios = await comoServicio(pool, async (c) =>
      (await c.query(`select usuarios_alerta($1) as u`, [d.alerta_id])).rows.map((r) => r.u as string));
    hub.aUsuarios(usuarios, { tipo: 'alerta', alertaId: d.alerta_id, evento: d.evento } as EventoTiempoReal);
  }

  async function escuchar() {
    if (cerrando) return;
    const c = new pg.Client({ connectionString: cfg.DATABASE_URL });
    c.on('error', (e) => { log.warn({ e }, 'oyente de tiempo real: error'); programarReconexion(); });
    c.on('end', () => programarReconexion());
    c.on('notification', (n) => {
      let datos: any;
      try { datos = JSON.parse(n.payload ?? '{}'); } catch { return; }
      const tarea = n.channel === 'zpro_mensajes' ? alMensaje(datos) : n.channel === 'zpro_pagos' ? alPago(datos)
        : n.channel === 'zpro_notificaciones' ? alNotificacion(datos) : n.channel === 'zpro_alertas' ? alAlerta(datos) : null;
      tarea?.catch((e) => log.error({ e }, 'tiempo real: no se pudo repartir un aviso'));
    });
    try {
      await c.connect();
      await c.query('listen zpro_mensajes');
      await c.query('listen zpro_pagos');
      await c.query('listen zpro_notificaciones');
      await c.query('listen zpro_alertas');
      oyente = c;
    } catch (e) {
      log.warn({ e }, 'oyente de tiempo real: no conecta, reintento en 5 s');
      c.removeAllListeners('end');
      await c.end().catch(() => {});
      programarReconexion();
    }
  }

  function programarReconexion() {
    if (cerrando || reintento) return;
    oyente = null;
    reintento = setTimeout(() => { reintento = null; void escuchar(); }, 5000);
  }

  // Latido: detecta sockets muertos (teléfono sin señal) y los cierra.
  const vivos = new WeakSet<WebSocket>();
  const latido = setInterval(() => {
    for (const con of todas()) {
      if (!vivos.has(con.socket)) { con.socket.terminate(); continue; }
      vivos.delete(con.socket);
      try { con.socket.ping(); } catch { /* ya cerrado */ }
    }
  }, 30_000);
  latido.unref();

  const hub: HubReal = {
    aUsuarios(usuarios, evento) {
      for (const u of new Set(usuarios)) for (const con of porUsuario.get(u) ?? []) enviar(con.socket, evento);
    },
    conectar(usuarioId, socket) {
      const set = porUsuario.get(usuarioId) ?? new Set<Conexion>();
      if (set.size >= MAX_CONEXIONES_POR_USUARIO) {
        const vieja = set.values().next().value as Conexion;   // se cierra la más antigua
        vieja.socket.close(4008, 'Demasiadas conexiones');
        set.delete(vieja);
      }
      const con: Conexion = { usuarioId, socket, suscritas: new Set() };
      set.add(con);
      porUsuario.set(usuarioId, set);
      vivos.add(socket);
      socket.on('pong', () => vivos.add(socket));
      return con;
    },
    desconectar(con) {
      const set = porUsuario.get(con.usuarioId);
      set?.delete(con);
      if (set && !set.size) porUsuario.delete(con.usuarioId);
    },
    async suscribir(con, conversacionId) {
      if (con.suscritas.size >= MAX_SUSCRIPCIONES) return false;
      const ok = await comoUsuario(pool, con.usuarioId, async (c) =>
        (await c.query(`select puedo_ver_conversacion($1) as ok`, [conversacionId])).rows[0].ok as boolean);
      if (ok) con.suscritas.add(conversacionId);
      return ok;
    },
    conectados: () => todas().length,
    async cerrar() {
      cerrando = true;
      clearInterval(latido);
      if (reintento) clearTimeout(reintento);
      for (const con of todas()) con.socket.close(1001, 'Servidor cerrando');
      porUsuario.clear();
      if (oyente) { oyente.removeAllListeners('end'); await oyente.end().catch(() => {}); }
    },
  };

  await escuchar();
  return hub;
}

type Fila = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const aNotificacion = (n: Fila): Notificacion => ({
  id: n.id, tipo: n.tipo, condominioId: n.condominio_id ?? null, titulo: n.titulo, cuerpo: n.cuerpo, datos: n.datos ?? {},
  leida: n.leida_en != null, creadoEn: n.creado_en instanceof Date ? n.creado_en.toISOString() : n.creado_en,
});
