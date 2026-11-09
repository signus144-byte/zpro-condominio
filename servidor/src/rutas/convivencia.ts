// Transparencia y convivencia (v0.8, 0025_convivencia.sql):
//   · lista pública de casas con cuotas vencidas (opcional, la decide la junta; con o sin montos; sin nombres)
//   · mensajes anónimos a otra casa, con respuesta, denuncia a la junta y suspensión sin revelar al remitente.
// Las fotos de los mensajes anónimos se re-codifican (sin EXIF/GPS) y se guardan SIN dueño, igual que las de los
// reportes anónimos: en el servidor no queda rastro de quién las subió.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ConfigConvivencia, DenunciaAnonima, MensajeAnonimo, MorosoPublico, RespuestaAnonima } from '../../../compartido/tipos.js';
import { bd, bdServicio, type Contexto } from '../contexto.js';
import { guardarArchivo, leerFormulario, urlFirmada } from '../archivos/archivos.js';
import { ErrorApi } from '../util/errores.js';
import { ParamsC, Uuid } from './condominio.js';
import { booleano, exigirJunta, exigirMiembro, iso, num } from './_comun.js';
import { Categoria, MAX_FOTOS, limpiarFoto } from './reportes.js';

const respuestas = (j: unknown): RespuestaAnonima[] =>
  ((j ?? []) as { id: string; de: 'casa' | 'remitente'; texto: string; creadoEn: string }[]).map((r) => ({ ...r, creadoEn: iso(r.creadoEn)! }));
const firmar = (ctx: Contexto, fotos: string[] | null) => Promise.all((fotos ?? []).map((f) => urlFirmada(ctx, 'anonimos', f)))
  .then((xs) => xs.filter((u): u is string => !!u));

export default async function rutasConvivencia(app: FastifyInstance) {
  const ctx = app.ctx;

  // ---------- Configuración ----------
  app.get('/c/:cid/convivencia', async (req): Promise<ConfigConvivencia> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      await exigirMiembro(c, cid);
      const k = (await c.query(`select morosos_publicos, morosos_meses_min, mensajes_anonimos from condominios where id = $1`, [cid])).rows[0];
      return { morososPublicos: k.morosos_publicos, morososMesesMin: num(k.morosos_meses_min), mensajesAnonimos: k.mensajes_anonimos };
    });
  });

  app.put('/c/:cid/convivencia', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({
      morososPublicos: z.enum(['no', 'casas', 'casas_y_montos']), morososMesesMin: z.number().int().min(1).max(12),
      mensajesAnonimos: z.boolean(),
    }).parse(req.body);
    await bd(req, (c) => c.query(`select fijar_convivencia($1, $2, $3::smallint, $4)`, [cid, d.morososPublicos, d.morososMesesMin, d.mensajesAnonimos]));
    return rep.status(204).send();
  });

  // ---------- Casas con cuotas vencidas ----------
  app.get('/c/:cid/morosos', async (req): Promise<MorosoPublico[]> => {
    const { cid } = ParamsC.parse(req.params);
    const { vistaPrevia } = z.object({ vistaPrevia: z.string().optional() }).parse(req.query);
    const filas = await bd(req, async (c) => (await c.query(`select * from morosos_publicos($1, $2)`, [cid, booleano(vistaPrevia)])).rows);
    return filas.map((f) => ({
      unidadId: f.unidad_id, etiqueta: f.etiqueta, mesesVencidos: num(f.meses_vencidos),
      montoVencidoUsd: f.monto_vencido_usd == null ? null : num(f.monto_vencido_usd), desde: f.desde,
    }));
  });

  // ---------- Mensajes anónimos ----------
  // multipart: unidadId, categoria, texto, tambienJunta, titulo? + fotos (≤ 4)
  app.post('/c/:cid/anonimos', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const { campos, archivos } = await leerFormulario(req);
    const d = z.object({
      unidadId: Uuid, categoria: Categoria.default('otro'), texto: z.string().trim().min(3).max(2000),
      titulo: z.string().trim().min(3).max(120).optional(),
    }).parse({ ...campos, titulo: campos.titulo?.trim() || undefined });
    const tambienJunta = booleano(campos.tambienJunta);
    const brutas = archivos.fotos ?? [];
    if (brutas.length > MAX_FOTOS) throw new ErrorApi(400, `Máximo ${MAX_FOTOS} fotos`, 'invalido');
    const fotos = await Promise.all(brutas.map(limpiarFoto));
    const id = randomUUID();
    const rutasMsg = fotos.map((_, i) => `${cid}/${id}/${i + 1}.jpg`);
    const carpetaRep = `${cid}/${randomUUID()}`;
    const rutasRep = tambienJunta ? fotos.map((_, i) => `${carpetaRep}/${i + 1}.jpg`) : [];

    await bd(req, (c) => exigirMiembro(c, cid));
    // Fotos SIN dueño (rol de servicio): no queda rastro del remitente.
    if (fotos.length) {
      await bdServicio(ctx, async (c) => {
        for (const [i, f] of fotos.entries()) await guardarArchivo(ctx, c, 'anonimos', rutasMsg[i], f, null);
        for (const [i, f] of rutasRep.entries()) await guardarArchivo(ctx, c, 'reportes', f, fotos[i], null);
      });
    }
    try {
      const r = await bd(req, async (c) => {
        let reporteId: string | null = null;
        if (tambienJunta) {
          const t = d.titulo ?? `Reporte sobre ${(await c.query(`select etiqueta_unidad(u) e from unidades u where id = $1`, [d.unidadId])).rows[0]?.e ?? 'una casa'}`;
          reporteId = (await c.query(`select crear_reporte($1, $2, $3, $4, null, true, 'presidencia', $5, $6) as id`,
            [cid, d.categoria, t, d.texto, rutasRep, d.unidadId])).rows[0].id;
        }
        await c.query(`select enviar_mensaje_anonimo($1, $2, $3, $4, $5, $6, $7)`, [id, cid, d.unidadId, d.categoria, d.texto, rutasMsg, reporteId]);
        return { id, reporteId };
      });
      return rep.status(201).send(r);
    } catch (e) {
      if (fotos.length) {
        const todas = [...rutasMsg, ...rutasRep];
        await bdServicio(ctx, (c) => c.query(`delete from storage.objects where bucket_id in ('anonimos', 'reportes') and name = any($1)`, [todas])).catch(() => {});
        await ctx.almacen.borrar('anonimos', rutasMsg).catch(() => {});
        if (rutasRep.length) await ctx.almacen.borrar('reportes', rutasRep).catch(() => {});
      }
      throw e;
    }
  });

  app.get('/c/:cid/anonimos', async (req): Promise<MensajeAnonimo[]> => {
    const { cid } = ParamsC.parse(req.params);
    const filas = await bd(req, async (c) => (await c.query(`select * from mis_mensajes_anonimos($1)`, [cid])).rows);
    return Promise.all(filas.map(async (m) => ({
      id: m.id, direccion: m.direccion, aUnidad: m.a_unidad, categoria: m.categoria, texto: m.texto, fotos: await firmar(ctx, m.fotos),
      tambienJunta: m.tambien_junta, leidoEn: iso(m.leido_en), denunciadoEn: iso(m.denunciado_en), revision: m.revision,
      creadoEn: iso(m.creado_en)!, respuestas: respuestas(m.respuestas),
    })));
  });

  const ParamsM = ParamsC.extend({ id: Uuid });
  async function delCondominio(req: Parameters<typeof bd>[0], cid: string, id: string) {
    // Comprueba que el mensaje es de este condominio sin revelar si existe a quien no puede verlo.
    const ok = await bd(req, (c) => c.query(`select 1 from mensajes_anonimos where id = $1 and condominio_id = $2`, [id, cid]));
    if (!ok.rowCount) throw new ErrorApi(404, 'Mensaje no existe', 'no_encontrado');
  }

  app.post('/c/:cid/anonimos/:id/leido', async (req, rep) => {
    const p = ParamsM.parse(req.params);
    await bd(req, (c) => c.query(`select marcar_mensaje_anonimo_leido($1)`, [p.id]));
    return rep.status(204).send();
  });

  app.post('/c/:cid/anonimos/:id/responder', async (req, rep) => {
    const p = ParamsM.parse(req.params);
    const d = z.object({ texto: z.string().trim().min(1).max(1000) }).parse(req.body);
    await delCondominio(req, p.cid, p.id);
    await bd(req, (c) => c.query(`select responder_mensaje_anonimo($1, $2)`, [p.id, d.texto]));
    return rep.status(204).send();
  });

  app.post('/c/:cid/anonimos/:id/denunciar', async (req, rep) => {
    const p = ParamsM.parse(req.params);
    const d = z.object({ motivo: z.string().trim().min(3).max(500) }).parse(req.body);
    await delCondominio(req, p.cid, p.id);
    await bd(req, (c) => c.query(`select denunciar_mensaje_anonimo($1, $2)`, [p.id, d.motivo]));
    return rep.status(204).send();
  });

  // ---------- Junta: denuncias ----------
  app.get('/c/:cid/anonimos/denuncias', async (req): Promise<DenunciaAnonima[]> => {
    const { cid } = ParamsC.parse(req.params);
    const filas = await bd(req, async (c) => { await exigirJunta(c, cid); return (await c.query(`select * from denuncias_anonimas($1)`, [cid])).rows; });
    return Promise.all(filas.map(async (m) => ({
      id: m.id, aUnidad: m.a_unidad, categoria: m.categoria, texto: m.texto, fotos: await firmar(ctx, m.fotos), motivo: m.motivo,
      denunciadoEn: iso(m.denunciado_en)!, revision: m.revision, creadoEn: iso(m.creado_en)!, respuestas: respuestas(m.respuestas),
      reincidente: m.reincidente,
    })));
  });

  app.post('/c/:cid/anonimos/:id/revisar', async (req, rep) => {
    const p = ParamsM.parse(req.params);
    const d = z.object({ accion: z.enum(['bloquear', 'descartar']), dias: z.number().int().min(1).max(365).default(30) }).parse(req.body);
    await delCondominio(req, p.cid, p.id);
    await bd(req, (c) => c.query(`select revisar_denuncia_anonima($1, $2, $3)`, [p.id, d.accion, d.dias]));
    return rep.status(204).send();
  });
}
