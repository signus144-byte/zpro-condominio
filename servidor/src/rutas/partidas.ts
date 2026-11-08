// Partidas especiales y votaciones (CONTRATO_API.md §4). Un voto por unidad, del propietario,
// ponderado por alícuota (o 1 por unidad); el umbral se mide sobre el total del condominio.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FilaActa, Partida, Votacion } from '../../../compartido/tipos.js';
import { AlcanceCasasZ, resolverAlcance, textoMonto } from './difusion.js';
import { bd } from '../contexto.js';
import type { Tx } from '../db/conexion.js';
import { ErrorApi } from '../util/errores.js';
import { ParamsC, Periodo, Uuid } from './condominio.js';
import { exigirJunta, iso, num, r2 } from './_comun.js';

/** Unidades del usuario en sesión en este condominio (primero donde es propietario). */
async function misUnidades(c: Tx, cid: string): Promise<{ id: string; alicuota: number }[]> {
  const r = await c.query(`select distinct on (u.id) u.id, u.alicuota, (m.rol = 'propietario') as prop, u.numero
                             from membresias m join unidades u on u.id = m.unidad_id
                            where m.usuario_id = auth.uid() and m.condominio_id = $1 and m.activo
                            order by u.id, (m.rol = 'propietario') desc`, [cid]);
  return r.rows.sort((a, b) => Number(b.prop) - Number(a.prop) || String(a.numero).localeCompare(String(b.numero)))
    .map((x) => ({ id: x.id, alicuota: num(x.alicuota) }));
}

export default async function rutasPartidas(app: FastifyInstance) {
  app.get('/c/:cid/partidas', async (req): Promise<Partida[]> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      // RLS: una cuota especial limitada a algunas casas solo la ven esas casas y la junta.
      const partidas = (await c.query(`select * from partidas_especiales where condominio_id = $1 order by creado_en desc`, [cid])).rows;
      const mias = await misUnidades(c, cid);
      const junta = (await c.query(`select es_junta($1) as j`, [cid])).rows[0].j as boolean;
      const salida: Partida[] = [];
      for (const p of partidas) {
        const incluidas = (await c.query(`select u.id, u.alicuota from unidades u where u.id in (select unidades_partida($1))`, [p.id])).rows;
        const ids = new Set(incluidas.map((u) => u.id as string));
        const yo = mias.find((u) => ids.has(u.id)) ?? null;
        const nUnidades = incluidas.length || 1;
        const baseAlicuota = p.alcance === 'todos' ? 100 : incluidas.reduce((s, u) => s + num(u.alicuota), 0) || 100;
        const v = (await c.query(`select * from votaciones where partida_id = $1 order by creado_en desc limit 1`, [p.id])).rows[0];
        let votacion: Votacion | null = null;
        if (v) {
          const opciones = (await c.query(`select * from resultado_votacion($1)`, [v.id])).rows;
          const mio = yo ? (await c.query(`select opcion_id from votos where votacion_id = $1 and unidad_id = $2`, [v.id, yo.id])).rows[0] : null;
          const faltan = junta ? num((await c.query(`select count(*) n from unidades_votacion($1) x
                                   where not exists (select 1 from votos vt where vt.votacion_id = $1 and vt.unidad_id = x)`, [v.id])).rows[0].n) : null;
          votacion = {
            id: v.id, titulo: v.titulo, ponderacion: v.ponderacion, umbralPct: num(v.umbral_aprobacion_pct), estado: v.estado,
            cierraEn: iso(v.cierra_en), miVotoOpcionId: mio?.opcion_id ?? null,
            opciones: opciones.map((o) => ({ id: o.opcion_id, texto: o.texto, orden: o.orden, unidades: num(o.unidades), pesoPct: r2(num(o.peso_pct)) })),
            sinVotar: faltan,
          };
        }
        const presupuesto = num(p.presupuesto_usd);
        salida.push({
          id: p.id, titulo: p.titulo, descripcion: p.descripcion, presupuestoUsd: presupuesto, numeroCuotas: p.numero_cuotas,
          primeraCuota: p.primera_cuota, reparto: p.reparto, estado: p.estado, creadoEn: iso(p.creado_en)!, votacion,
          cuotaMiUnidadUsd: yo ? (p.reparto === 'alicuota' ? r2(presupuesto / p.numero_cuotas * yo.alicuota / baseAlicuota)
                                                         : r2(presupuesto / p.numero_cuotas / nUnidades)) : null,
          alcance: { tipo: p.alcance, nombre: p.alcance_nombre ?? null, unidades: incluidas.length },
          meAfecta: Boolean(yo),
          ...(junta ? { unidadIds: [...ids] } : {}),
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
      alcance: AlcanceCasasZ.default({ tipo: 'todos' }),
      difundir: z.boolean().default(true),
    }).parse(req.body);
    const r = await bd(req, async (c) => {
      await exigirJunta(c, cid);
      const al = await resolverAlcance(c, cid, d.alcance);
      const p = (await c.query(`insert into partidas_especiales (condominio_id, titulo, descripcion, presupuesto_usd, numero_cuotas,
            primera_cuota, reparto, estado, creado_por, alcance, alcance_nombre)
          values ($1, $2, $3, $4, $5, $6, $7, $8, auth.uid(), $9, $10) returning id`,
        [cid, d.titulo, d.descripcion || null, d.presupuestoUsd, d.numeroCuotas, d.primeraCuota, d.reparto,
         d.someterAVotacion ? 'en_votacion' : 'aprobada', al.tipo, al.nombre])).rows[0].id as string;
      if (al.tipo === 'unidades') {
        await c.query(`insert into partida_unidades (partida_id, unidad_id) select $1, unnest($2::uuid[])`, [p, al.unidadIds]);
      }
      if (d.someterAVotacion) {
        const v = (await c.query(`insert into votaciones (condominio_id, titulo, partida_id, ponderacion, umbral_aprobacion_pct,
              abre_en, cierra_en, estado, creado_por)
            values ($1, $2, $3, $4, $5, now(), $6, 'abierta', auth.uid()) returning id`,
          [cid, `¿Aprueba: ${d.titulo}?`, p, d.reparto, d.umbralPct, d.cierraEn ?? null])).rows[0].id;
        // Convención: la opción de orden 0 es "Aprobar" (la usa cerrar_votacion).
        await c.query(`insert into votacion_opciones (votacion_id, texto, orden) values ($1, 'Aprobar', 0), ($1, 'Rechazar', 1)`, [v]);
      }
      // Aviso masivo a las casas incluidas (solo ellas: las demás ni la ven).
      let difusion: { id: string; unidades: number; personas: number } | null = null;
      if (d.difundir) {
        const quien = al.tipo === 'todos' ? 'todo el condominio' : (al.nombre ?? 'algunas casas');
        const cuerpo = (d.someterAVotacion
          ? `La junta propone la cuota especial "${d.titulo}" por ${textoMonto(d.presupuestoUsd)} en ${d.numeroCuotas} ${d.numeroCuotas === 1 ? 'cuota' : 'cuotas'}, para ${quien}. Los propietarios pueden votar desde la app.`
          : `La junta aprobó la cuota especial "${d.titulo}" por ${textoMonto(d.presupuestoUsd)} en ${d.numeroCuotas} ${d.numeroCuotas === 1 ? 'cuota' : 'cuotas'}, para ${quien}.`)
          + (d.descripcion ? ` ${d.descripcion.slice(0, 600)}` : '');
        difusion = (await c.query(`select * from difundir($1, $2, $3, 'partida', null, null, $4, false)`,
          [cid, d.someterAVotacion ? `Votación: ${d.titulo}`.slice(0, 120) : `Cuota especial: ${d.titulo}`.slice(0, 120), cuerpo.slice(0, 2000), p])).rows[0];
      }
      return { id: p, difusion };
    });
    return rep.status(201).send(r);
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
