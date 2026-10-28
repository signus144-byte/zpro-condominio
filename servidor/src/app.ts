// Construye el servidor HTTP (Fastify). Las piezas externas (correo, almacén, hub) se inyectan para poder probar.
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import type { Contexto, EnviarCorreo, HubTiempoReal } from './contexto.js';
import { crearPool } from './db/conexion.js';
import { almacenLocal, type Almacen } from './archivos/almacen.js';
import { crearFirmador } from './auth/tokens.js';
import { crearCorreo } from './correo.js';
import { manejarError } from './util/errores.js';
import { MAX_BYTES } from './archivos/archivos.js';
import { RUTAS } from './rutas/index.js';
import { paginaVerificar } from './rutas/documentos.js';
import { crearHub } from './tiempo-real/hub.js';
import { iniciarTareas } from './tareas/index.js';

export interface Dependencias { enviarCorreo?: EnviarCorreo; almacen?: Almacen; hub?: HubTiempoReal }

export async function construirApp(cfg: Config, dep: Dependencias = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: cfg.NODE_ENV === 'test' ? false : { level: cfg.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'body.clave', 'body.refresco'] },
    trustProxy: true,           // detrás de Caddy
    routerOptions: { maxParamLength: 2048 },   // las URLs firmadas de archivos llevan un token largo
    bodyLimit: 2 * 1024 * 1024, // JSON; los archivos van por multipart
  });

  const pool = crearPool(cfg.DATABASE_URL, cfg.NODE_ENV === 'production' ? 20 : 10, (e) => app.log.error(e, 'conexión de BD'));
  const enviarCorreo = dep.enviarCorreo ?? crearCorreo(cfg);
  const ctx: Contexto = {
    cfg, pool, enviarCorreo,
    almacen: dep.almacen ?? almacenLocal(cfg.ARCHIVOS_DIR),
    firmador: crearFirmador(cfg.JWT_SECRETO),
    hub: dep.hub ?? await crearHub(cfg, pool, app.log, enviarCorreo),
  };
  app.decorate('ctx', ctx);
  app.decorateRequest('usuarioId', null);

  await app.register(cors, { origin: cfg.CORS_ORIGENES.split(',').map((s) => s.trim()), credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] });   // la app (Capacitor) es otro origen
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', global: true });
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 6, fields: 40 } });
  await app.register(websocket);

  // Lee el token de acceso (si viene). Las rutas que lo exigen usan requiereSesion o bd().
  app.addHook('onRequest', async (req) => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) {
      try { req.usuarioId = await ctx.firmador.verificarAcceso(h.slice(7)); }
      catch { req.usuarioId = null; }   // token vencido → la ruta responderá 401 y la app refrescará
    }
  });
  app.addHook('onSend', async (_req, rep) => {
    rep.header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer');
  });
  app.setErrorHandler(manejarError);

  app.get('/salud', async () => {
    await pool.query('select 1');
    return { ok: true, version: '0.5.0' };
  });

  await app.register(async (api) => {
    for (const r of RUTAS) await api.register(r);
  }, { prefix: '/api/v1' });
  await app.register(paginaVerificar);

  const tareas = cfg.TAREAS_ACTIVAS === 'si' ? iniciarTareas(ctx, app.log) : { detener() {} };
  app.addHook('onClose', async () => { tareas.detener(); await ctx.hub.cerrar(); await pool.end(); });
  return app;
}
