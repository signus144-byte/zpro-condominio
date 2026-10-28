// Alerta vecinal (botón de emergencia) y enlace de invitación del condominio. Reglas en 0019 y 0020.
import { verify } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  AlertaVecinal, CercaniaUnidad, ConfigAlerta, EnlaceInvitacion, InfoInvitacion, ParticipanteAlerta,
} from '../../../compartido/tipos.js';
import { bd, bdAnonimo, bdSistema, requiereSesion } from '../contexto.js';
import type { Tx } from '../db/conexion.js';
import { ErrorApi } from '../util/errores.js';
import { ParamsC, Uuid } from './condominio.js';
import { exigirMiembro, iso } from './_comun.js';

type Fila = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TipoAlerta = z.enum(['seguridad', 'medica', 'incendio', 'otra']);

async function leerAlerta(c: Tx, id: string): Promise<AlertaVecinal> {
  const a = (await c.query(`select * from detalle_alerta($1)`, [id])).rows[0] as Fila | undefined;
  if (!a) throw new ErrorApi(404, 'Alerta no existe', 'no_encontrado');
  const yo = (await c.query(`select auth.uid() as uid, es_junta($1) as junta,
        exists (select 1 from alerta_destinatarios where alerta_id = $2 and usuario_id = auth.uid()) as destinatario,
        (select respuesta from alerta_respuestas where alerta_id = $2 and usuario_id = auth.uid()) as respuesta`,
    [a.condominio_id, id])).rows[0];
  const activa = a.estado === 'activa';
  return {
    id: a.id, tipo: a.tipo, nota: a.nota, alcance: a.alcance, estado: a.estado, verificacion: a.verificacion,
    creadoEn: iso(a.creado_en)!, cerradaEn: iso(a.cerrada_en), notaCierre: a.nota_cierre,
    emisor: { nombre: a.emisor, unidad: a.unidad, telefono: a.emisor_telefono ?? null },
    soyEmisor: a.emisor_id === yo.uid, puedoCerrar: activa && (a.emisor_id === yo.uid || yo.junta),
    puedoResponder: activa && yo.destinatario, miRespuesta: yo.respuesta ?? null,
    destinatarios: a.destinatarios, vistos: a.vistos,
    respuestas: (a.respuestas as Fila[]).map((r) => ({
      usuarioId: r.usuarioId, nombre: r.nombre, unidad: r.unidad ?? null, respuesta: r.respuesta, creadoEn: r.creadoEn,
      tieneVehiculo: r.tieneVehiculo, personalSalud: r.personalSalud, telefono: r.telefono ?? null,
    })),
  };
}

export default async function rutasAlertas(app: FastifyInstance) {
  const ctx = app.ctx;

  // ---------- Configuración y participación ----------
  app.get('/c/:cid/alerta', async (req): Promise<ConfigAlerta> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      await exigirMiembro(c, cid);
      const k = (await c.query(`select alerta_activa, alerta_radio, motivo_no_emitir($1) as motivo,
             tiene_rol($1, array['presidente','administrador']::rol_condominio[]) as configura,
             (select count(*)::int from alertas a where a.condominio_id = $1 and a.estado = 'activa' and puedo_ver_alerta(a.id)) as activas
           from condominios where id = $1`, [cid])).rows[0];
      const p = (await c.query(`select * from participantes_alerta where condominio_id = $1 and usuario_id = auth.uid()`, [cid])).rows[0];
      return {
        redActiva: k.alerta_activa, radio: k.alerta_radio, puedoEmitir: k.motivo == null, motivoNoPuede: k.motivo,
        puedoConfigurar: k.configura, alertasActivas: k.activas,
        participacion: p ? { activo: p.activo, tieneVehiculo: p.tiene_vehiculo, personalSalud: p.personal_salud, telefono: p.telefono,
                             suspendidoHasta: iso(p.suspendido_hasta), motivoSuspension: p.motivo_suspension } : null,
      };
    });
  });

  app.put('/c/:cid/alerta/participacion', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({ activo: z.boolean(), tieneVehiculo: z.boolean().default(false), personalSalud: z.boolean().default(false),
                         telefono: z.string().trim().max(30).nullable().optional() }).parse(req.body);
    await bd(req, (c) => c.query(`select inscribir_alerta($1, $2, $3, $4, $5)`, [cid, d.activo, d.tieneVehiculo, d.personalSalud, d.telefono ?? null]));
    return rep.status(204).send();
  });

  app.put('/c/:cid/alerta/red', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({ activa: z.boolean(), radio: z.number().int().min(0).max(50).optional() }).parse(req.body);
    await bd(req, (c) => c.query(`select configurar_red_alerta($1, $2, $3)`, [cid, d.activa, d.radio ?? null]));
    return rep.status(204).send();
  });

  app.get('/c/:cid/alerta/participantes', async (req): Promise<ParticipanteAlerta[]> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      const r = await c.query(`select es_junta($1) as j`, [cid]);
      if (!r.rows[0].j) throw new ErrorApi(403, 'Solo la junta ve los participantes', 'sin_permiso');
      const filas = (await c.query(`
        select pa.*, nombre_visible(pa.usuario_id) as nombre,
               (select etiqueta_unidad(u) from membresias m join unidades u on u.id = m.unidad_id
                 where m.usuario_id = pa.usuario_id and m.condominio_id = pa.condominio_id and m.activo limit 1) as unidad,
               (select count(*)::int from alertas a where a.emisor_id = pa.usuario_id and a.condominio_id = pa.condominio_id) as emitidas,
               (select count(*)::int from alertas a where a.emisor_id = pa.usuario_id and a.condominio_id = pa.condominio_id
                   and a.estado = 'falsa_alarma') as falsas
          from participantes_alerta pa where pa.condominio_id = $1 order by unidad nulls last, nombre`, [cid])).rows;
      return filas.map((p) => ({ usuarioId: p.usuario_id, nombre: p.nombre, unidad: p.unidad, activo: p.activo,
        tieneVehiculo: p.tiene_vehiculo, personalSalud: p.personal_salud, suspendidoHasta: iso(p.suspendido_hasta),
        motivoSuspension: p.motivo_suspension, alertasEmitidas: p.emitidas, falsasAlarmas: p.falsas }));
    });
  });

  app.post('/c/:cid/alerta/participantes/:usuarioId/suspender', async (req, rep) => {
    const p = ParamsC.extend({ usuarioId: Uuid }).parse(req.params);
    const d = z.object({ dias: z.number().int().min(0).max(365), motivo: z.string().trim().max(200).optional() }).parse(req.body);
    await bd(req, (c) => c.query(`select suspender_de_alerta($1, $2, $3, $4)`, [p.cid, p.usuarioId, d.dias, d.motivo ?? null]));
    return rep.status(204).send();
  });

  // Cercanía: sector (calle/bloque) y posición de cada casa. Por defecto, bloque y número.
  app.get('/c/:cid/alerta/cercania', async (req): Promise<CercaniaUnidad[]> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      const r = await c.query(`select es_junta($1) as j`, [cid]);
      if (!r.rows[0].j) throw new ErrorApi(403, 'Solo la junta ve la cercanía', 'sin_permiso');
      const filas = (await c.query(`select u.id, etiqueta_unidad(u) as etiqueta, sector_unidad(u) as sector, posicion_unidad(u) as posicion,
                                           (u.sector is not null or u.posicion is not null) as personalizada
                                      from unidades u where u.condominio_id = $1 order by sector_unidad(u), posicion_unidad(u) nulls last, u.numero`, [cid])).rows;
      return filas.map((u) => ({ unidadId: u.id, etiqueta: u.etiqueta, sector: u.sector, posicion: u.posicion, personalizada: u.personalizada }));
    });
  });

  app.put('/c/:cid/alerta/cercania', async (req) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.array(z.object({ unidadId: Uuid, sector: z.string().trim().max(40).nullable(), posicion: z.number().int().min(-100000).max(100000).nullable() }))
      .max(5000).parse(req.body);
    const r = await bd(req, (c) => c.query(`select fijar_cercania($1, $2::uuid[], $3::text[], $4::int[]) as n`,
      [cid, d.map((x) => x.unidadId), d.map((x) => x.sector), d.map((x) => x.posicion)]));
    return { actualizadas: Number(r.rows[0].n) };
  });

  // ---------- Alertas ----------
  // Emitir: la app confirma la identidad con huella/patrón; en la web se exige la clave y el servidor la verifica.
  app.post('/c/:cid/alertas', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({ tipo: TipoAlerta, nota: z.string().trim().max(300).optional(),
                         verificacion: z.enum(['biometria', 'credencial', 'clave']), clave: z.string().max(200).optional() }).parse(req.body);
    if (!req.usuarioId) throw new ErrorApi(401, 'Inicie sesión', 'sin_sesion');
    if (d.verificacion === 'clave') {
      const u = await bdSistema(ctx, async (c) => (await c.query(`select clave_hash from auth.users where id = $1`, [req.usuarioId])).rows[0]);
      if (!d.clave || !u || !(await verify(u.clave_hash, d.clave))) throw new ErrorApi(401, 'Clave incorrecta: no se envió la alerta', 'clave');
    }
    const r = await bd(req, async (c) => {
      const id = (await c.query(`select emitir_alerta($1, $2, $3, $4) as id`, [cid, d.tipo, d.nota ?? null, d.verificacion])).rows[0].id as string;
      return leerAlerta(c, id);
    });
    req.log.warn({ alerta: r.id, tipo: r.tipo, condominio: cid, usuario: req.usuarioId }, 'ALERTA VECINAL emitida');
    return rep.status(201).send(r);
  });

  app.get('/c/:cid/alertas', async (req): Promise<AlertaVecinal[]> => {
    const { cid } = ParamsC.parse(req.params);
    const q = z.object({ activas: z.enum(['si', 'no']).default('no'), limite: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    return bd(req, async (c) => {
      await exigirMiembro(c, cid);
      const ids = (await c.query(`select id from alertas where condominio_id = $1 and puedo_ver_alerta(id)
                                    and ($2::boolean is false or estado = 'activa') order by creado_en desc limit $3`,
        [cid, q.activas === 'si', q.limite])).rows.map((x) => x.id as string);
      const out: AlertaVecinal[] = [];
      for (const id of ids) out.push(await leerAlerta(c, id));
      return out;
    });
  });

  const ParamsA = ParamsC.extend({ id: Uuid });
  const enCondominio = async (c: Tx, cid: string, id: string) => {
    const r = await c.query(`select 1 from alertas where id = $1 and condominio_id = $2`, [id, cid]);
    if (!r.rowCount) throw new ErrorApi(404, 'Alerta no existe', 'no_encontrado');
  };

  app.get('/c/:cid/alertas/:id', async (req): Promise<AlertaVecinal> => {
    const p = ParamsA.parse(req.params);
    return bd(req, async (c) => { await enCondominio(c, p.cid, p.id); return leerAlerta(c, p.id); });
  });

  app.post('/c/:cid/alertas/:id/visto', async (req, rep) => {
    const p = ParamsA.parse(req.params);
    await bd(req, async (c) => { await enCondominio(c, p.cid, p.id); await c.query(`select marcar_alerta_vista($1)`, [p.id]); });
    return rep.status(204).send();
  });

  app.post('/c/:cid/alertas/:id/responder', async (req): Promise<AlertaVecinal> => {
    const p = ParamsA.parse(req.params);
    const d = z.object({ respuesta: z.enum(['voy', 'vehiculo', 'llamo_autoridades', 'no_puedo']) }).parse(req.body);
    return bd(req, async (c) => {
      await enCondominio(c, p.cid, p.id);
      await c.query(`select responder_alerta($1, $2)`, [p.id, d.respuesta]);
      return leerAlerta(c, p.id);
    });
  });

  app.post('/c/:cid/alertas/:id/cerrar', async (req): Promise<AlertaVecinal> => {
    const p = ParamsA.parse(req.params);
    const d = z.object({ estado: z.enum(['atendida', 'falsa_alarma', 'cancelada']), nota: z.string().trim().max(300).optional() }).parse(req.body);
    return bd(req, async (c) => {
      await enCondominio(c, p.cid, p.id);
      await c.query(`select cerrar_alerta($1, $2, $3)`, [p.id, d.estado, d.nota ?? null]);
      return leerAlerta(c, p.id);
    });
  });

  app.post('/c/:cid/alertas/:id/ampliar', async (req): Promise<AlertaVecinal> => {
    const p = ParamsA.parse(req.params);
    return bd(req, async (c) => {
      await enCondominio(c, p.cid, p.id);
      await c.query(`select ampliar_alerta($1)`, [p.id]);
      return leerAlerta(c, p.id);
    });
  });

  // ---------- Enlace de invitación (app de administración) ----------
  const aEnlace = (k: Fila): EnlaceInvitacion => ({
    codigo: k.codigo, url: `${ctx.cfg.URL_APP.replace(/\/$/, '')}/#/invitacion/${k.codigo}`,
    expiraEn: iso(k.expira_en)!, usos: k.usos,
  });
  app.get('/c/:cid/invitacion', async (req): Promise<EnlaceInvitacion> => {
    const { cid } = ParamsC.parse(req.params);
    return aEnlace(await bd(req, async (c) => (await c.query(`select * from enlace_invitacion($1, false)`, [cid])).rows[0]));
  });
  app.post('/c/:cid/invitacion/regenerar', async (req): Promise<EnlaceInvitacion> => {
    const { cid } = ParamsC.parse(req.params);
    return aEnlace(await bd(req, async (c) => (await c.query(`select * from enlace_invitacion($1, true)`, [cid])).rows[0]));
  });

  // Pública: quien recibe el enlace ve el condominio y elige su casa.
  app.get('/invitacion/:codigo', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req): Promise<InfoInvitacion> => {
    const { codigo } = z.object({ codigo: z.string().trim().min(4).max(40) }).parse(req.params);
    const f = await bdAnonimo(req, async (c) => (await c.query(`select * from info_invitacion($1)`, [codigo])).rows[0]);
    return { condominioId: f.condominio_id, condominio: f.condominio, ciudad: f.ciudad, unidades: f.unidades };
  });

  app.post('/invitacion/:codigo/unirse', { preHandler: requiereSesion }, async (req) => {
    const { codigo } = z.object({ codigo: z.string().trim().min(4).max(40) }).parse(req.params);
    const d = z.object({ unidadId: Uuid, rol: z.enum(['propietario', 'inquilino']).default('propietario') }).parse(req.body);
    const r = await bd(req, (c) => c.query(`select unirse_con_enlace($1, $2, $3) as r`, [codigo, d.unidadId, d.rol]));
    return { estado: r.rows[0].r as 'pendiente' | 'aprobada' };
  });
}
