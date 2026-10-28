// Partidas especiales y votaciones (CONTRATO_API.md §4). Un voto por unidad, del propietario,
// ponderado por alícuota (o 1 por unidad); el umbral se mide sobre el total del condominio.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FilaActa, Partida, Votacion } from '../../../compartido/tipos.js';
import { bd } from '../contexto.js';
import type { Tx } from '../db/conexion.js';
import { ErrorApi } from '../util/errores.js';
import { ParamsC, Periodo, Uuid } from './condominio.js';
import { exigirJunta, iso, num, r2 } from './_comun.js';

/** Unidad del usuario en sesión en este condominio (la primera donde es propietario; si no, cualquiera). */
async function miUnidad(c: Tx, cid: string): Promise<{ id: string; alicuota: number } | null> {
  const r = await c.query(`select u.id, u.alicuota from membresias m join unidades u on u.id = m.unidad_id
                            where m.usuario_id = auth.uid() and m.condominio_id = $1 and m.activo
                            order by (m.rol = 'propietario') desc, u.numero limit 1`, [cid]);
  return r.rows[0] ? { id: r.rows[0].id, alicuota: num(r.rows[0].alicuota) } : null;
}

export default async function rutasPartidas(app: FastifyInstance) {
  app.get('/c/:cid/partidas', async (req): Promise<Partida[]> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      const partidas = (await c.query(`select * from partidas_especiales where condominio_id = $1 order by creado_en desc`, [cid])).rows;
      const yo = await miUnidad(c, cid);
      const nUnidades = num((await c.query(`select count(*) n from unidades where condominio_id = $1`, [cid])).rows[0].n) || 1;
      const salida: Partida[] = [];
      for (const p of partidas) {
        const v = (await c.query(`select * from votaciones where partida_id = $1 order by creado_en desc limit 1`, [p.id])).rows[0];
        let votacion: Votacion | null = null;
        if (v) {
          const opciones = (await c.query(`select * from resultado_votacion($1)`, [v.id])).rows;
          const mio = yo ? (await c.query(`select opcion_id from votos where votacion_id = $1 and unidad_id = $2`, [v.id, yo.id])).rows[0] : null;
          votacion = {
            id: v.id, titulo: v.titulo, ponderacion: v.ponderacion, umbralPct: num(v.umbral_aprobacion_pct), estado: v.estado,
            cierraEn: iso(v.cierra_en), miVotoOpcionId: mio?.opcion_id ?? null,
            opciones: opciones.map((o) => ({ id: o.opcion_id, texto: o.texto, orden: o.orden, unidades: num(o.unidades), pesoPct: r2(num(o.peso_pct)) })),
          };
        }
        const presupuesto = num(p.presupuesto_usd);
        salida.push({
          id: p.id, titulo: p.titulo, descripcion: p.descripcion, presupuestoUsd: presupuesto, numeroCuotas: p.numero_cuotas,
          primeraCuota: p.primera_cuota, reparto: p.reparto, estado: p.estado, creadoEn: iso(p.creado_en)!, votacion,
          cuotaMiUnidadUsd: yo ? (p.reparto === 'alicuota' ? r2(presupuesto / p.numero_cuotas * yo.alicuota / 100)
                                                         : r2(presupuesto / p.numero_cuotas / nUnidades)) : null,
        });
      }
      return salida;
    });
  });

  app.post('/c/:cid/partidas', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({
      titulo: z.string().trim().min(3).max(150), descripcion: z.string().trim().max(3000).default(''),
      presupuestoUsd: z.number().positive().max(1e9), numeroCuotas: z.number().int().min(1).max(24),
      primeraCuota: Periodo, reparto: z.enum(['alicuota', 'unidad']).default('alicuota'),
      someterAVotacion: z.boolean().default(true), umbralPct: z.number().min(1).max(100).default(50.01),
      cierraEn: z.string().datetime({ offset: true }).nullable().optional(),
    }).parse(req.body);
    const id = await bd(req, async (c) => {
      await exigirJunta(c, cid);
      const p = (await c.query(`insert into partidas_especiales (condominio_id, titulo, descripcion, presupuesto_usd, numero_cuotas,
            primera_cuota, reparto, estado, creado_por)
          values ($1, $2, $3, $4, $5, $6, $7, $8, auth.uid()) returning id`,
        [cid, d.titulo, d.descripcion || null, d.presupuestoUsd, d.numeroCuotas, d.primeraCuota, d.reparto,
         d.someterAVotacion ? 'en_votacion' : 'aprobada'])).rows[0].id as string;
      if (d.someterAVotacion) {
        const v = (await c.query(`insert into votaciones (condominio_id, titulo, partida_id, ponderacion, umbral_aprobacion_pct,
              abre_en, cierra_en, estado, creado_por)
            values ($1, $2, $3, $4, $5, now(), $6, 'abierta', auth.uid()) returning id`,
          [cid, `¿Aprueba: ${d.titulo}?`, p, d.reparto, d.umbralPct, d.cierraEn ?? null])).rows[0].id;
        // Convención: la opción de orden 0 es "Aprobar" (la usa cerrar_votacion).
        await c.query(`insert into votacion_opciones (votacion_id, texto, orden) values ($1, 'Aprobar', 0), ($1, 'Rechazar', 1)`, [v]);
      }
      return p;
    });
    return rep.status(201).send({ id });
  });

  app.post('/c/:cid/votaciones/:vid/votar', async (req, rep) => {
    const p = ParamsC.extend({ vid: Uuid }).parse(req.params);
    const d = z.object({ opcionId: Uuid, unidadId: Uuid.optional() }).parse(req.body);
    await bd(req, async (c) => {
      const v = await c.query(`select 1 from votaciones where id = $1 and condominio_id = $2`, [p.vid, p.cid]);
      if (!v.rowCount) throw new ErrorApi(404, 'Votación no existe', 'no_encontrado');
      const propias = (await c.query(`select unidad_id from membresias where usuario_id = auth.uid() and condominio_id = $1
                                       and activo and rol = 'propietario' and unidad_id is not null`, [p.cid])).rows.map((r) => r.unidad_id as string);
      const unidad = d.unidadId ?? propias[0];
      if (!unidad || !propias.includes(unidad)) throw new ErrorApi(403, 'Solo el propietario de la unidad puede votar', 'sin_permiso');
      await c.query(`select emitir_voto($1, $2, $3)`, [p.vid, unidad, d.opcionId]);
    });
    return rep.status(204).send();
  });

  app.post('/c/:cid/votaciones/:vid/cerrar', async (req) => {
    const p = ParamsC.extend({ vid: Uuid }).parse(req.params);
    const r = await bd(req, async (c) => {
      const v = await c.query(`select 1 from votaciones where id = $1 and condominio_id = $2`, [p.vid, p.cid]);
      if (!v.rowCount) throw new ErrorApi(404, 'Votación no existe', 'no_encontrado');
      return c.query(`select cerrar_votacion($1) as aprobada`, [p.vid]);
    });
    return { aprobada: Boolean(r.rows[0].aprobada) };
  });

  app.get('/c/:cid/votaciones/:vid/acta', async (req): Promise<FilaActa[]> => {
    const p = ParamsC.extend({ vid: Uuid }).parse(req.params);
    const filas = await bd(req, async (c) => {
      const v = await c.query(`select 1 from votaciones where id = $1 and condominio_id = $2`, [p.vid, p.cid]);
      if (!v.rowCount) throw new ErrorApi(404, 'Votación no existe', 'no_encontrado');
      return (await c.query(`select * from datos_acta_votacion($1)`, [p.vid])).rows;
    });
    return filas.map((f) => ({
      unidad: f.unidad, propietario: f.propietario, alicuota: num(f.alicuota), opcion: f.opcion,
      emitidoEn: iso(f.emitido_en), votante: f.votante,
    }));
  });
}
