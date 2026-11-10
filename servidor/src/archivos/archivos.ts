// Subida y descarga de archivos con permisos de la base de datos (políticas de storage.objects).
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import { bd, bdServicio, type Contexto } from '../contexto.js';
import type { Tx } from '../db/conexion.js';
import { ErrorApi } from '../util/errores.js';
import { validarRuta } from './almacen.js';

export const MAX_BYTES = 25 * 1024 * 1024;

const EXT_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/webm': 'webm',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'text/plain': 'txt',
};
export const extension = (mime: string, nombre?: string) =>
  EXT_POR_MIME[mime] ?? (nombre?.match(/\.([A-Za-z0-9]{1,5})$/)?.[1]?.toLowerCase() ?? 'bin');

export interface ArchivoSubido { datos: Buffer; mime: string; nombreOriginal: string; sha256: string }

/** Lee un archivo de una petición multipart (máx. 25 MB). */
export async function leerArchivo(parte: MultipartFile): Promise<ArchivoSubido> {
  const datos = await parte.toBuffer();
  if (parte.file.truncated) throw new ErrorApi(413, 'El archivo supera 25 MB', 'muy_grande');
  return { datos, mime: parte.mimetype, nombreOriginal: parte.filename, sha256: createHash('sha256').update(datos).digest('hex') };
}

/** Lee un formulario multipart: campos de texto + archivos (por nombre de campo). */
export async function leerFormulario(req: FastifyRequest) {
  const campos: Record<string, string> = {};
  const archivos: Record<string, ArchivoSubido[]> = {};
  for await (const parte of req.parts({ limits: { fileSize: MAX_BYTES, files: 6 } })) {
    if (parte.type === 'file') (archivos[parte.fieldname] ??= []).push(await leerArchivo(parte));
    else campos[parte.fieldname] = String(parte.value);
  }
  return { campos, archivos };
}

/**
 * Registra el archivo en storage.objects DENTRO de la transacción de la petición (las políticas deciden si se
 * puede) y luego guarda los bytes. Si la transacción falla después, el archivo huérfano lo limpia la purga.
 * owner = null para fotos de reportes anónimos (se llama con bdServicio).
 */
export async function guardarArchivo(ctx: Contexto, c: Tx, bucket: string, nombre: string, a: ArchivoSubido,
                                     owner: string | null | 'sesion' = 'sesion') {
  validarRuta(bucket, nombre);
  await c.query(`insert into storage.objects (bucket_id, name, owner, mime, bytes, sha256)
                 values ($1, $2, ${owner === 'sesion' ? 'auth.uid()' : '$6::uuid'}, $3, $4, $5)`,
    owner === 'sesion' ? [bucket, nombre, a.mime, a.datos.length, a.sha256] : [bucket, nombre, a.mime, a.datos.length, a.sha256, owner]);
  await ctx.almacen.guardar(bucket, nombre, a.datos);
  return nombre;
}

export const nombreUnico = (prefijo: string, a: ArchivoSubido) => `${prefijo}/${randomUUID()}.${extension(a.mime, a.nombreOriginal)}`;

/** URL temporal (1 h) para mostrar un archivo en la app sin enviar cabeceras (p. ej. <img src>). */
export async function urlFirmada(ctx: Contexto, bucket: string, nombre: string | null | undefined) {
  if (!nombre) return null;
  return `${ctx.cfg.URL_PUBLICA}/api/v1/archivos/f/${await ctx.firmador.archivo(bucket, nombre)}`;
}

export default async function rutasArchivos(app: FastifyInstance) {
  const ctx = app.ctx;

  // Pide una URL temporal para un archivo que el usuario PUEDE ver (lo decide la política de storage.objects).
  app.post('/archivos/firmar', async (req) => {
    const d = z.object({ bucket: z.string(), nombre: z.string() }).parse(req.body);
    validarRuta(d.bucket, d.nombre);
    const ok = await bd(req, (c) => c.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [d.bucket, d.nombre]));
    if (!ok.rowCount) throw new ErrorApi(404, 'Archivo no disponible', 'no_encontrado');
    return { url: await urlFirmada(ctx, d.bucket, d.nombre) };
  });

  // Descarga con URL firmada (sin sesión: la firma ya prueba el permiso y vence en 1 hora).
  app.get<{ Params: { token: string } }>('/archivos/f/:token', async (req, rep) => {
    let ref: { bucket: string; nombre: string };
    try { ref = await ctx.firmador.verificarArchivo(req.params.token); }
    catch { throw new ErrorApi(403, 'Enlace vencido o inválido', 'sin_permiso'); }
    const meta = (await bdServicio(ctx, (c) => c.query(
      `select mime from storage.objects where bucket_id = $1 and name = $2`, [ref.bucket, ref.nombre]))).rows[0];
    if (!meta) throw new ErrorApi(410, 'El archivo ya no está en el servidor', 'vencido');
    let archivo;
    try { archivo = await ctx.almacen.leer(ref.bucket, ref.nombre); }
    catch { throw new ErrorApi(410, 'El archivo ya no está en el servidor', 'vencido'); }
    rep.header('content-type', meta?.mime ?? 'application/octet-stream')
       .header('content-length', archivo.bytes)
       .header('cache-control', 'private, max-age=3600')
       .header('x-content-type-options', 'nosniff');
    return rep.send(archivo.flujo);
  });
}
