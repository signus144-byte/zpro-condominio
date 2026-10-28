// Reportes de irregularidades, con opción anónima (CONTRATO_API.md §5).
// Anónimo = la junta y los vecinos no ven quién lo envió. Por eso sus fotos:
//   · se re-codifican (se pierden EXIF, GPS y modelo del teléfono) y
//   · se guardan con el rol de servicio y owner = NULL (no queda rastro del autor en storage.objects).
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import type { ComentarioReporte, Reporte } from '../../../compartido/tipos.js';
import { bd, bdServicio } from '../contexto.js';
import { guardarArchivo, leerFormulario, urlFirmada, type ArchivoSubido } from '../archivos/archivos.js';
import { ErrorApi } from '../util/errores.js';
import { ParamsC, Uuid } from './condominio.js';
import { booleano, exigirMiembro, iso } from './_comun.js';

const Categoria = z.enum(['ruido', 'dano_area_comun', 'seguridad', 'limpieza', 'mascotas', 'estacionamiento', 'filtracion', 'electricidad', 'otro']);
const MAX_FOTOS = 4;

/** Re-codifica a JPEG sin metadatos (sharp no copia EXIF salvo que se pida con withMetadata). */
async function limpiarFoto(a: ArchivoSubido): Promise<ArchivoSubido> {
  let datos: Buffer;
  try {
    datos = await sharp(a.datos, { failOn: 'error' }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  } catch {
    throw new ErrorApi(400, 'Una de las fotos no es una imagen válida', 'invalido');
  }
  return { datos, mime: 'image/jpeg', nombreOriginal: 'foto.jpg', sha256: createHash('sha256').update(datos).digest('hex') };
}

export default async function rutasReportes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get('/c/:cid/reportes', async (req): Promise<Reporte[]> => {
    const { cid } = ParamsC.parse(req.params);
    const { filas, mios, fotos } = await bd(req, async (c) => ({
      filas: (await c.query(`select r.*, p.nombre as autor_nombre from reportes r left join perfiles p on p.id = r.autor_id
                              where r.condominio_id = $1 order by r.creado_en desc limit 300`, [cid])).rows,
      mios: (await c.query(`select * from mis_reportes() where condominio_id = $1`, [cid])).rows,
      fotos: (await c.query(`select * from reporte_fotos_visibles($1)`, [cid])).rows,
    }));
    const misIds = new Set(mios.map((r) => r.id as string));
    const porId = new Map<string, Record<string, any>>();
    for (const r of [...filas, ...mios]) if (!porId.has(r.id)) porId.set(r.id, r);
    const fotosPor = new Map<string, string[]>();
    for (const f of fotos) fotosPor.set(f.reporte_id, [...(fotosPor.get(f.reporte_id) ?? []), f.path]);
    const lista = await Promise.all([...porId.values()].map(async (r): Promise<Reporte> => ({
      id: r.id, categoria: r.categoria, titulo: r.titulo, descripcion: r.descripcion, ubicacion: r.ubicacion,
      anonimo: r.anonimo, autorNombre: r.anonimo ? null : (r.autor_nombre ?? null), visibilidad: r.visibilidad, estado: r.estado,
      fotos: (await Promise.all((fotosPor.get(r.id) ?? []).map((p) => urlFirmada(ctx, 'reportes', p)))).filter((u): u is string => !!u),
      creadoEn: iso(r.creado_en)!, esMio: misIds.has(r.id),
    })));
    return lista.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  });

  // multipart: categoria, titulo, descripcion, ubicacion, anonimo, visibilidad + archivos "fotos" (≤ 4)
  app.post('/c/:cid/reportes', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const { campos, archivos } = await leerFormulario(req);
    const d = z.object({
      categoria: Categoria, titulo: z.string().trim().min(3).max(120), descripcion: z.string().trim().min(3).max(3000),
      ubicacion: z.string().trim().max(150).optional(), visibilidad: z.enum(['presidencia', 'comunidad']).default('presidencia'),
    }).parse(campos);
    const anonimo = booleano(campos.anonimo);
    const brutas = archivos.fotos ?? [];
    if (brutas.length > MAX_FOTOS) throw new ErrorApi(400, `Máximo ${MAX_FOTOS} fotos por reporte`, 'invalido');
    const fotos = await Promise.all(brutas.map(limpiarFoto));
    const carpeta = `${cid}/${randomUUID()}`;
    const rutas = fotos.map((_, i) => `${carpeta}/${i + 1}.jpg`);

    if (anonimo && fotos.length) {
      // 1) Se comprueba con la identidad del usuario que es miembro (y que no pasó su límite diario lo verifica crear_reporte).
      await bd(req, (c) => exigirMiembro(c, cid));
      // 2) Las fotos se guardan SIN dueño, con el rol de servicio.
      await bdServicio(ctx, async (c) => { for (const [i, f] of fotos.entries()) await guardarArchivo(ctx, c, 'reportes', rutas[i], f, null); });
    }
    const id = await bd(req, async (c) => {
      if (!anonimo) for (const [i, f] of fotos.entries()) await guardarArchivo(ctx, c, 'reportes', rutas[i], f);
      const r = await c.query(`select crear_reporte($1, $2, $3, $4, $5, $6, $7, $8) as id`,
        [cid, d.categoria, d.titulo, d.descripcion, d.ubicacion || null, anonimo, d.visibilidad, rutas]);
      return r.rows[0].id as string;
    }).catch(async (e) => {
      // Si el reporte no se creó (límite diario, etc.), se eliminan las fotos anónimas ya guardadas.
      if (anonimo && fotos.length) {
        await bdServicio(ctx, (c) => c.query(`delete from storage.objects where bucket_id = 'reportes' and name = any($1)`, [rutas])).catch(() => {});
        await ctx.almacen.borrar('reportes', rutas).catch(() => {});
      }
      throw e;
    });
    return rep.status(201).send({ id });
  });

  // La junta cambia el estado y, opcionalmente, deja una respuesta oficial.
  app.patch('/c/:cid/reportes/:id', async (req, rep) => {
    const p = ParamsC.extend({ id: Uuid }).parse(req.params);
    const d = z.object({
      estado: z.enum(['nuevo', 'en_revision', 'en_proceso', 'resuelto', 'descartado']),
      respuesta: z.string().trim().max(2000).optional(),
    }).parse(req.body);
    await bd(req, async (c) => {
      const r = await c.query(`update reportes set estado = $3 where id = $1 and condominio_id = $2`, [p.id, p.cid, d.estado]);
      if (!r.rowCount) throw new ErrorApi(403, 'Solo la junta cambia el estado de un reporte', 'sin_permiso');
      if (d.respuesta) await c.query(`select comentar_reporte($1, $2, true)`, [p.id, d.respuesta]);
    });
    return rep.status(204).send();
  });

  app.get('/c/:cid/reportes/:id/comentarios', async (req): Promise<ComentarioReporte[]> => {
    const p = ParamsC.extend({ id: Uuid }).parse(req.params);
    const filas = await bd(req, async (c) => {
      const r = await c.query(`select condominio_id from reportes where id = $1`, [p.id]).catch(() => ({ rows: [] as any[] }));
      if (r.rows[0] && r.rows[0].condominio_id !== p.cid) throw new ErrorApi(404, 'Reporte no existe', 'no_encontrado');
      return (await c.query(`select * from comentarios_reporte($1)`, [p.id])).rows;
    });
    return filas.map((f) => ({ id: f.id, autor: f.autor, esOficial: f.es_oficial, texto: f.texto, creadoEn: iso(f.creado_en)! }));
  });

  app.post('/c/:cid/reportes/:id/comentarios', async (req, rep) => {
    const p = ParamsC.extend({ id: Uuid }).parse(req.params);
    const d = z.object({ texto: z.string().trim().min(1).max(2000), oficial: z.boolean().default(false) }).parse(req.body);
    const id = await bd(req, async (c) => (await c.query(`select comentar_reporte($1, $2, $3) as id`, [p.id, d.texto, d.oficial])).rows[0].id);
    return rep.status(201).send({ id });
  });
}
