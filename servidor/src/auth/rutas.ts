// Cuentas y sesiones: registro, entrar, refrescar, salir, olvidé mi clave, restablecer, verificar correo, mi perfil.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';
import { bd, bdSistema, requiereSesion, type Contexto } from '../contexto.js';
import { ErrorApi } from '../util/errores.js';
import { hashToken, tokenAleatorio } from './tokens.js';
import type { Tx } from '../db/conexion.js';

const Clave = z.string().min(8, 'debe tener al menos 8 caracteres').max(128);
const Correo = z.string().trim().toLowerCase().email('no es un correo válido').max(200);
const MAX_INTENTOS = 5, BLOQUEO_MIN = 15;

async function emitirSesion(ctx: Contexto, c: Tx, usuarioId: string, req: FastifyRequest) {
  const secreto = tokenAleatorio();
  const { rows } = await c.query(
    `insert into auth.sesiones (usuario_id, refresco_hash, expira_en, agente, ip)
     values ($1, $2, now() + make_interval(days => $3), $4, $5) returning id`,
    [usuarioId, hashToken(secreto), ctx.cfg.REFRESCO_DIAS, String(req.headers['user-agent'] ?? '').slice(0, 200), req.ip]);
  return {
    acceso: await ctx.firmador.acceso(usuarioId, ctx.cfg.ACCESO_MINUTOS),
    refresco: `${rows[0].id}.${secreto}`,
    accesoExpiraEn: new Date(Date.now() + ctx.cfg.ACCESO_MINUTOS * 60_000).toISOString(),
  };
}

async function enviarEnlace(ctx: Contexto, c: Tx, usuarioId: string, correo: string, tipo: 'verificar' | 'restablecer') {
  const token = tokenAleatorio();
  const horas = tipo === 'verificar' ? 72 : 1;
  await c.query(`insert into auth.tokens_correo (usuario_id, tipo, token_hash, expira_en)
                 values ($1, $2, $3, now() + make_interval(hours => $4))`, [usuarioId, tipo, hashToken(token), horas]);
  const url = `${ctx.cfg.URL_APP}/#/${tipo === 'verificar' ? 'verificar-correo' : 'restablecer'}?t=${token}`;
  const asunto = tipo === 'verificar' ? 'Confirme su correo · ZPro Condominio' : 'Restablecer su clave · ZPro Condominio';
  const texto = tipo === 'verificar'
    ? `Bienvenido a ZPro Condominio.\n\nConfirme su correo abriendo este enlace (vence en 72 horas):\n${url}\n`
    : `Recibimos una solicitud para cambiar su clave.\n\nSi fue usted, abra este enlace (vence en 1 hora):\n${url}\n\nSi no fue usted, ignore este correo: su clave no cambia.`;
  // El correo sale después de confirmar la transacción para no enviar enlaces que no existen.
  return () => ctx.enviarCorreo({ para: correo, asunto, texto });
}

export default async function rutasAuth(app: FastifyInstance) {
  const ctx = app.ctx;
  const limiteEstricto = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };

  app.post('/auth/registro', limiteEstricto, async (req, rep) => {
    const d = z.object({ nombre: z.string().trim().min(2).max(120), correo: Correo, clave: Clave,
                         telefono: z.string().trim().max(30).optional() }).parse(req.body);
    const claveHash = await hash(d.clave);
    let enviar: () => Promise<void> = async () => {};
    const sesion = await bdSistema(ctx, async (c) => {
      const { rows } = await c.query(`insert into auth.users (email, clave_hash) values ($1, $2) returning id`, [d.correo, claveHash]);
      const id = rows[0].id as string;
      // El perfil se crea con la identidad del nuevo usuario (la política exige id = auth.uid()).
      await c.query(`select set_config('app.uid', $1, true)`, [id]);
      await c.query('set local role authenticated');
      await c.query(`insert into perfiles (id, nombre, telefono) values ($1, $2, $3)`, [id, d.nombre, d.telefono ?? null]);
      await c.query('reset role');
      enviar = await enviarEnlace(ctx, c, id, d.correo, 'verificar');
      return { id, ...(await emitirSesion(ctx, c, id, req)) };
    });
    enviar().catch((e) => req.log.warn({ e }, 'No se pudo enviar el correo de verificación'));
    return rep.status(201).send(sesion);
  });

  app.post('/auth/entrar', limiteEstricto, async (req) => {
    const d = z.object({ correo: Correo, clave: z.string().max(128) }).parse(req.body);
    return bdSistema(ctx, async (c) => {
      const { rows } = await c.query(`select id, clave_hash, intentos_fallidos, bloqueado_hasta from auth.users where email = $1 for update`, [d.correo]);
      const u = rows[0];
      const error = new ErrorApi(401, 'Correo o clave incorrectos', 'credenciales');
      if (!u) { await hash(d.clave); throw error; }               // mismo tiempo de respuesta exista o no
      if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
        throw new ErrorApi(429, 'Demasiados intentos. Intente de nuevo en unos minutos o restablezca su clave.', 'bloqueado');
      }
      if (!(await verify(u.clave_hash, d.clave))) {
        const n = u.intentos_fallidos + 1;
        const bloquear = n >= MAX_INTENTOS;
        await c.query(`update auth.users set intentos_fallidos = $2::smallint,
                         bloqueado_hasta = case when $3::boolean then now() + make_interval(mins => $4::int) else null end
                        where id = $1`, [u.id, bloquear ? 0 : n, bloquear, BLOQUEO_MIN]);
        // Se confirma la transacción para que el contador quede guardado, y luego se informa el error.
        await c.query('commit'); await c.query('begin');
        throw error;
      }
      await c.query(`update auth.users set intentos_fallidos = 0, bloqueado_hasta = null, ultimo_ingreso_en = now() where id = $1`, [u.id]);
      return { id: u.id, ...(await emitirSesion(ctx, c, u.id, req)) };
    });
  });

  app.post('/auth/refrescar', async (req) => {
    const d = z.object({ refresco: z.string().min(10).max(200) }).parse(req.body);
    const [sesionId, secreto] = d.refresco.split('.');
    if (!sesionId || !secreto || !/^[0-9a-f-]{36}$/.test(sesionId)) throw new ErrorApi(401, 'Sesión inválida', 'sin_sesion');
    return bdSistema(ctx, async (c) => {
      const { rows } = await c.query(`select * from auth.sesiones where id = $1 for update`, [sesionId]);
      const s = rows[0];
      if (!s) throw new ErrorApi(401, 'Sesión inválida', 'sin_sesion');
      if (s.refresco_hash !== hashToken(secreto)) {
        // Alguien presentó un token viejo de esta sesión: posible robo. Se cierran todas las sesiones del usuario.
        await c.query(`update auth.sesiones set revocada_en = now() where usuario_id = $1 and revocada_en is null`, [s.usuario_id]);
        await c.query('commit'); await c.query('begin');
        throw new ErrorApi(401, 'Sesión inválida. Por seguridad, vuelva a iniciar sesión.', 'sin_sesion');
      }
      if (s.revocada_en || new Date(s.expira_en) < new Date()) throw new ErrorApi(401, 'Sesión vencida', 'sin_sesion');
      const nuevo = tokenAleatorio();
      await c.query(`update auth.sesiones set refresco_hash = $2, usado_en = now(),
                       expira_en = now() + make_interval(days => $3) where id = $1`, [s.id, hashToken(nuevo), ctx.cfg.REFRESCO_DIAS]);
      return {
        id: s.usuario_id,
        acceso: await ctx.firmador.acceso(s.usuario_id, ctx.cfg.ACCESO_MINUTOS),
        refresco: `${s.id}.${nuevo}`,
        accesoExpiraEn: new Date(Date.now() + ctx.cfg.ACCESO_MINUTOS * 60_000).toISOString(),
      };
    });
  });

  app.post('/auth/salir', async (req, rep) => {
    const d = z.object({ refresco: z.string().max(200) }).parse(req.body);
    const sesionId = d.refresco.split('.')[0];
    if (/^[0-9a-f-]{36}$/.test(sesionId)) {
      await bdSistema(ctx, (c) => c.query(`update auth.sesiones set revocada_en = now() where id = $1`, [sesionId]));
    }
    return rep.status(204).send();
  });

  app.post('/auth/olvide', limiteEstricto, async (req, rep) => {
    const d = z.object({ correo: Correo }).parse(req.body);
    let enviar: (() => Promise<void>) | null = null;
    await bdSistema(ctx, async (c) => {
      const { rows } = await c.query(`select id from auth.users where email = $1`, [d.correo]);
      if (rows[0]) enviar = await enviarEnlace(ctx, c, rows[0].id, d.correo, 'restablecer');
    });
    if (enviar) (enviar as () => Promise<void>)().catch((e) => req.log.warn({ e }, 'No se pudo enviar el correo'));
    // Misma respuesta exista o no la cuenta: no se revela qué correos están registrados.
    return rep.status(202).send({ ok: true });
  });

  app.post('/auth/restablecer', limiteEstricto, async (req, rep) => {
    const d = z.object({ token: z.string().min(10).max(200), clave: Clave }).parse(req.body);
    const claveHash = await hash(d.clave);
    await bdSistema(ctx, async (c) => {
      const { rows } = await c.query(`update auth.tokens_correo set usado_en = now()
          where token_hash = $1 and tipo = 'restablecer' and usado_en is null and expira_en > now() returning usuario_id`,
        [hashToken(d.token)]);
      if (!rows[0]) throw new ErrorApi(400, 'El enlace no es válido o ya venció. Pida uno nuevo.', 'token');
      await c.query(`update auth.users set clave_hash = $2, intentos_fallidos = 0, bloqueado_hasta = null where id = $1`, [rows[0].usuario_id, claveHash]);
      await c.query(`update auth.sesiones set revocada_en = now() where usuario_id = $1 and revocada_en is null`, [rows[0].usuario_id]);
    });
    return rep.status(204).send();
  });

  app.post('/auth/verificar-correo', async (req, rep) => {
    const d = z.object({ token: z.string().min(10).max(200) }).parse(req.body);
    await bdSistema(ctx, async (c) => {
      const { rows } = await c.query(`update auth.tokens_correo set usado_en = now()
          where token_hash = $1 and tipo = 'verificar' and usado_en is null and expira_en > now() returning usuario_id`,
        [hashToken(d.token)]);
      if (!rows[0]) throw new ErrorApi(400, 'El enlace no es válido o ya venció', 'token');
      await c.query(`update auth.users set correo_verificado_en = now() where id = $1`, [rows[0].usuario_id]);
    });
    return rep.status(204).send();
  });

  app.post('/auth/cambiar-clave', { preHandler: requiereSesion }, async (req, rep) => {
    const d = z.object({ actual: z.string().max(128), nueva: Clave }).parse(req.body);
    const nuevoHash = await hash(d.nueva);
    await bdSistema(ctx, async (c) => {
      const { rows } = await c.query(`select clave_hash from auth.users where id = $1`, [req.usuarioId]);
      if (!rows[0] || !(await verify(rows[0].clave_hash, d.actual))) throw new ErrorApi(400, 'La clave actual no es correcta', 'credenciales');
      await c.query(`update auth.users set clave_hash = $2 where id = $1`, [req.usuarioId, nuevoHash]);
    });
    return rep.status(204).send();
  });

  // Quién soy: perfil, condominios a los que pertenezco (con rol y casa) y rol en ZentaPro si lo tengo.
  app.get('/auth/yo', { preHandler: requiereSesion }, async (req) => {
    const correo = await bdSistema(ctx, async (c) =>
      (await c.query(`select email, correo_verificado_en from auth.users where id = $1`, [req.usuarioId])).rows[0]);
    return bd(req, async (c) => {
      const perfil = (await c.query(`select nombre, telefono, avisos_por_correo from perfiles where id = auth.uid()`)).rows[0];
      const membresias = (await c.query(`
        select m.condominio_id, c.nombre as condominio, c.estado, m.rol, m.unidad_id,
               case when u.id is null then null else etiqueta_unidad(u) end as unidad
          from membresias m join condominios c on c.id = m.condominio_id
          left join unidades u on u.id = m.unidad_id
         where m.usuario_id = auth.uid() and m.activo
         order by c.nombre, m.rol`)).rows;
      const pendientes = (await c.query(`select * from mis_solicitudes()`)).rows;
      const plataforma = (await c.query(`select rol from plataforma_admins where usuario_id = auth.uid() and activo`)).rows[0];
      return {
        usuario: { id: req.usuarioId, nombre: perfil?.nombre ?? '', telefono: perfil?.telefono ?? null,
                   correo: correo?.email ?? null, correoVerificado: Boolean(correo?.correo_verificado_en),
                   avisosPorCorreo: perfil?.avisos_por_correo ?? true },
        membresias: membresias.map((m) => ({ condominioId: m.condominio_id, condominio: m.condominio, estadoCondominio: m.estado,
                                             rol: m.rol, unidadId: m.unidad_id, unidad: m.unidad })),
        solicitudesPendientes: pendientes.map((p) => ({ condominioId: p.condominio_id, condominio: p.condominio, unidad: p.unidad, rol: p.rol, creadoEn: p.creado_en })),
        rolPlataforma: plataforma?.rol ?? null,
      };
    });
  });

  app.patch('/auth/yo', { preHandler: requiereSesion }, async (req, rep) => {
    const d = z.object({ nombre: z.string().trim().min(2).max(120).optional(), telefono: z.string().trim().max(30).nullable().optional(),
                         avisosPorCorreo: z.boolean().optional() }).parse(req.body);
    await bd(req, (c) => c.query(`update perfiles set nombre = coalesce($1, nombre), telefono = case when $3 then $2 else telefono end,
                                  avisos_por_correo = coalesce($4, avisos_por_correo) where id = auth.uid()`,
      [d.nombre ?? null, d.telefono ?? null, d.telefono !== undefined, d.avisosPorCorreo ?? null]));
    return rep.status(204).send();
  });

  // Unirse a un condominio con el código de la casa, o activarlo (presidente) con el código de ZentaPro.
  app.post('/auth/unirse', { preHandler: requiereSesion }, async (req) => {
    const d = z.object({ codigo: z.string().trim().min(4).max(40) }).parse(req.body);
    const r = await bd(req, (c) => c.query(`select unirse_con_codigo($1) as r`, [d.codigo]));
    return { estado: r.rows[0].r as 'pendiente' | 'aprobada' };
  });
  app.post('/auth/activar-condominio', { preHandler: requiereSesion }, async (req) => {
    const d = z.object({ codigo: z.string().trim().min(4).max(40) }).parse(req.body);
    const r = await bd(req, (c) => c.query(`select activar_condominio($1) as id`, [d.codigo]));
    return { condominioId: r.rows[0].id as string };
  });

  // Registrar el teléfono para notificaciones push.
  app.post('/auth/dispositivos', { preHandler: requiereSesion }, async (req, rep) => {
    const d = z.object({ token: z.string().min(10).max(500), plataforma: z.enum(['android', 'ios', 'web']) }).parse(req.body);
    await bd(req, (c) => c.query(`insert into dispositivos (token, usuario_id, plataforma) values ($1, auth.uid(), $2)
                                  on conflict (token) do update set usuario_id = auth.uid(), plataforma = $2, actualizado_en = now()`, [d.token, d.plataforma]));
    return rep.status(204).send();
  });
}
