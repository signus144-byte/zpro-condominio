// Grupos de casas y difusión masiva (0021_alcance_y_difusion.sql). Solo la junta.
//  - Grupos guardados: "Calle 3 · portón", "Torre B · piso 4".
//  - Difusión: mensaje a todo el condominio, a un grupo, a casas elegidas, a las casas de una cuota especial
//    o solo a las que aún no han votado. Llega como notificación (y push y correo si están disponibles).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AlcanceCasas, Difusion, GrupoUnidades, PreviaDifusion, UnidadAlcance } from '../../../compartido/tipos.js';
import { bd } from '../contexto.js';
import type { Tx } from '../db/conexion.js';
import { ErrorApi } from '../util/errores.js';
import { ParamsC, Uuid } from './condominio.js';
import { exigirJunta, iso, num } from './_comun.js';

export const AlcanceCasasZ = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('todos') }),
  z.object({ tipo: z.literal('grupo'), grupoId: Uuid }),
  z.object({ tipo: z.literal('unidades'), unidadIds: z.array(Uuid).min(1).max(5000), nombre: z.string().trim().max(80).optional() }),
]);
const AlcanceDifusionZ = z.discriminatedUnion('tipo', [
  ...AlcanceCasasZ.options,
  z.object({ tipo: z.literal('partida'), partidaId: Uuid }),
  z.object({ tipo: z.literal('sin_votar'), partidaId: Uuid }),
]);

export const textoMonto = (usd: number) =>
  '$' + usd.toLocaleString('es-VE', { minimumFractionDigits: usd % 1 ? 2 : 0, maximumFractionDigits: 2 });

/** Convierte el alcance pedido en la lista de casas (validando que sean del condominio) y un nombre legible. */
export async function resolverAlcance(c: Tx, cid: string, a: AlcanceCasas):
  Promise<{ tipo: 'todos' | 'unidades'; nombre: string | null; unidadIds: string[] }> {
  if (a.tipo === 'todos') return { tipo: 'todos', nombre: null, unidadIds: [] };
  if (a.tipo === 'grupo') {
    const g = (await c.query(`select nombre from grupos_unidades where id = $1 and condominio_id = $2`, [a.grupoId, cid])).rows[0];
    if (!g) throw new ErrorApi(400, 'Ese grupo no existe', 'invalido');
    const ids = (await c.query(`select unidad_id from grupo_unidades where grupo_id = $1`, [a.grupoId])).rows.map((r) => r.unidad_id as string);
    if (!ids.length) throw new ErrorApi(400, 'Ese grupo no tiene casas', 'invalido');
    return { tipo: 'unidades', nombre: g.nombre, unidadIds: ids };
  }
  const ids = [...new Set(a.unidadIds)];
  const ok = num((await c.query(`select count(*) n from unidades where condominio_id = $1 and id = any($2::uuid[])`, [cid, ids])).rows[0].n);
  if (ok !== ids.length) throw new ErrorApi(400, 'Alguna casa no pertenece a este condominio', 'invalido');
  const total = num((await c.query(`select count(*) n from unidades where condominio_id = $1`, [cid])).rows[0].n);
  if (ok === total) return { tipo: 'todos', nombre: null, unidadIds: [] };
  let nombre = a.nombre?.trim() || null;
  if (!nombre) {
    const et = (await c.query(`select etiqueta_unidad(u) e from unidades u where id = any($1::uuid[]) order by u.bloque nulls first, u.numero limit 4`, [ids])).rows.map((r) => r.e);
    nombre = ids.length <= 3 ? et.join(', ') : `${et.slice(0, 2).join(', ')} y ${ids.length - 2} casas más`;
  }
  return { tipo: 'unidades', nombre, unidadIds: ids };
}

function argsDifusion(a: z.infer<typeof AlcanceDifusionZ>) {
  return {
    alcance: a.tipo,
    grupo: a.tipo === 'grupo' ? a.grupoId : null,
    unidades: a.tipo === 'unidades' ? a.unidadIds : null,
    partida: a.tipo === 'partida' || a.tipo === 'sin_votar' ? a.partidaId : null,
  };
}

export default async function rutasDifusion(app: FastifyInstance) {
  // Casas con datos para filtrar (por bloque/calle o piso).
  app.get('/c/:cid/unidades-alcance', async (req): Promise<UnidadAlcance[]> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      await exigirJunta(c, cid);
      const f = (await c.query(`select u.id, etiqueta_unidad(u) etiqueta, u.bloque, sector_unidad(u) sector, piso_unidad(u) piso, u.alicuota
                                  from unidades u where u.condominio_id = $1
                                 order by sector_unidad(u), u.bloque nulls first, posicion_unidad(u) nulls last, u.numero`, [cid])).rows;
      return f.map((u) => ({ id: u.id, etiqueta: u.etiqueta, bloque: u.bloque, sector: u.sector, piso: u.piso, alicuota: num(u.alicuota) }));
    });
  });

  // ---------- Grupos ----------
  const leerGrupos = async (c: Tx, cid: string): Promise<GrupoUnidades[]> =>
    (await c.query(`select g.id, g.nombre, g.descripcion,
                           coalesce(array_agg(x.unidad_id) filter (where x.unidad_id is not null), '{}') ids
                      from grupos_unidades g left join grupo_unidades x on x.grupo_id = g.id
                     where g.condominio_id = $1 group by g.id order by g.nombre`, [cid])).rows
      .map((g) => ({ id: g.id, nombre: g.nombre, descripcion: g.descripcion, unidadIds: g.ids }));

  app.get('/c/:cid/grupos', async (req): Promise<GrupoUnidades[]> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => { await exigirJunta(c, cid); return leerGrupos(c, cid); });
  });

  const GrupoZ = z.object({ nombre: z.string().trim().min(2).max(80), descripcion: z.string().trim().max(300).nullable().optional(),
                            unidadIds: z.array(Uuid).min(1).max(5000) });
  const guardarMiembros = async (c: Tx, cid: string, gid: string, ids: string[]) => {
    const unicos = [...new Set(ids)];
    const ok = num((await c.query(`select count(*) n from unidades where condominio_id = $1 and id = any($2::uuid[])`, [cid, unicos])).rows[0].n);
    if (ok !== unicos.length) throw new ErrorApi(400, 'Alguna casa no pertenece a este condominio', 'invalido');
    await c.query(`delete from grupo_unidades where grupo_id = $1`, [gid]);
    await c.query(`insert into grupo_unidades (grupo_id, unidad_id) select $1, unnest($2::uuid[])`, [gid, unicos]);
  };

  app.post('/c/:cid/grupos', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = GrupoZ.parse(req.body);
    const g = await bd(req, async (c) => {
      await exigirJunta(c, cid);
      const normal = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
      const nombres = (await c.query(`select nombre from grupos_unidades where condominio_id = $1`, [cid])).rows.map((r) => normal(r.nombre));
      if (nombres.includes(normal(d.nombre))) throw new ErrorApi(409, 'Ya existe un grupo con ese nombre', 'duplicado');
      const id = (await c.query(`insert into grupos_unidades (condominio_id, nombre, descripcion, creado_por) values ($1, $2, $3, auth.uid()) returning id`,
        [cid, d.nombre, d.descripcion ?? null])).rows[0].id as string;
      await guardarMiembros(c, cid, id, d.unidadIds);
      return (await leerGrupos(c, cid)).find((x) => x.id === id)!;
    });
    return rep.status(201).send(g);
  });

  app.put('/c/:cid/grupos/:gid', async (req): Promise<GrupoUnidades> => {
    const p = ParamsC.extend({ gid: Uuid }).parse(req.params);
    const d = GrupoZ.parse(req.body);
    return bd(req, async (c) => {
      await exigirJunta(c, p.cid);
      const r = await c.query(`update grupos_unidades set nombre = $3, descripcion = $4 where id = $1 and condominio_id = $2`,
        [p.gid, p.cid, d.nombre, d.descripcion ?? null]);
      if (!r.rowCount) throw new ErrorApi(404, 'Grupo no existe', 'no_encontrado');
      await guardarMiembros(c, p.cid, p.gid, d.unidadIds);
      return (await leerGrupos(c, p.cid)).find((x) => x.id === p.gid)!;
    });
  });

  app.delete('/c/:cid/grupos/:gid', async (req, rep) => {
    const p = ParamsC.extend({ gid: Uuid }).parse(req.params);
    await bd(req, async (c) => {
      await exigirJunta(c, p.cid);
      const r = await c.query(`delete from grupos_unidades where id = $1 and condominio_id = $2`, [p.gid, p.cid]);
      if (!r.rowCount) throw new ErrorApi(404, 'Grupo no existe', 'no_encontrado');
    });
    return rep.status(204).send();
  });

  // ---------- Difusión ----------
  const DifusionZ = z.object({
    titulo: z.string().trim().min(3).max(120), cuerpo: z.string().trim().min(3).max(2000),
    alcance: AlcanceDifusionZ, soloPropietarios: z.boolean().default(false), partidaId: Uuid.optional(),
  });

  app.post('/c/:cid/difusiones/previa', async (req): Promise<PreviaDifusion> => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({ alcance: AlcanceDifusionZ, soloPropietarios: z.boolean().default(false) }).parse(req.body);
    const a = argsDifusion(d.alcance);
    const r = await bd(req, (c) => c.query(`select unidades, personas from personas_difusion($1, $2, $3, $4, $5, $6)`,
      [cid, a.alcance, a.grupo, a.unidades, a.partida, d.soloPropietarios]));
    return { unidades: num(r.rows[0].unidades), personas: num(r.rows[0].personas) };
  });

  app.post('/c/:cid/difusiones', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = DifusionZ.parse(req.body);
    const a = argsDifusion(d.alcance);
    const r = await bd(req, (c) => c.query(`select * from difundir($1, $2, $3, $4, $5, $6, $7, $8)`,
      [cid, d.titulo, d.cuerpo, a.alcance, a.grupo, a.unidades, a.partida ?? d.partidaId ?? null, d.soloPropietarios]));
    const f = r.rows[0];
    return rep.status(201).send({ id: f.id, unidades: num(f.unidades), personas: num(f.personas) });
  });

  app.get('/c/:cid/difusiones', async (req): Promise<Difusion[]> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      await exigirJunta(c, cid);
      const f = (await c.query(`select d.*, nombre_visible(d.creado_por) quien from difusiones d
                                 where d.condominio_id = $1 order by d.creado_en desc limit 100`, [cid])).rows;
      return f.map((x) => ({ id: x.id, titulo: x.titulo, cuerpo: x.cuerpo, alcance: x.alcance, alcanceNombre: x.alcance_nombre,
        partidaId: x.partida_id, soloPropietarios: x.solo_propietarios, unidades: x.unidades, personas: x.personas,
        creadoEn: iso(x.creado_en)!, creadoPor: x.quien ?? null }));
    });
  });
}
