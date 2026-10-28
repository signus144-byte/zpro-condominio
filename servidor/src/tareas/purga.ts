// Retención del chat: borra del servidor los archivos vencidos (las copias quedan en los teléfonos)
// y los mensajes más viejos que la retención de cada condominio.
import type { Contexto } from '../contexto.js';
import { comoServicio } from '../db/conexion.js';

export async function purgarChat(ctx: Contexto, lote = 1000, maxLotes = 50) {
  let archivos = 0;
  for (let i = 0; i < maxLotes; i++) {
    const rutas = await comoServicio(ctx.pool, async (c) => {
      const r = (await c.query(`select path from purgar_adjuntos_vencidos($1)`, [lote])).rows.map((f) => f.path as string);
      if (r.length) await c.query(`delete from storage.objects where bucket_id = 'chat' and name = any($1)`, [r]);
      return r;
    });
    if (!rutas.length) break;
    await ctx.almacen.borrar('chat', rutas);
    archivos += rutas.length;
  }
  const mensajes = await comoServicio(ctx.pool, async (c) => (await c.query(`select purgar_mensajes_antiguos() as n`)).rows[0].n as number);
  return { archivos, mensajes };
}

const BUCKETS = ['chat', 'comprobantes', 'facturas', 'reportes', 'marca', 'documentos'];

/**
 * Archivos huérfanos: bytes en disco sin fila en storage.objects (p. ej. una subida cuya transacción falló).
 * Solo se borran si tienen más de `horas` de antigüedad, para no tocar subidas en curso.
 */
export async function purgarHuerfanos(ctx: Contexto, horas = 24) {
  if (!ctx.almacen.listar) return { huerfanos: 0 };
  const limite = Date.now() - horas * 3600_000;
  let huerfanos = 0;
  for (const bucket of BUCKETS) {
    let lote: string[] = [];
    const revisar = async () => {
      if (!lote.length) return;
      const existen = new Set(await comoServicio(ctx.pool, async (c) => (await c.query(
        `select name from storage.objects where bucket_id = $1 and name = any($2)`, [bucket, lote])).rows.map((r) => r.name as string)));
      const borrar = lote.filter((n) => !existen.has(n));
      if (borrar.length) { await ctx.almacen.borrar(bucket, borrar); huerfanos += borrar.length; }
      lote = [];
    };
    for await (const f of ctx.almacen.listar(bucket)) {
      if (f.modificado.getTime() > limite) continue;
      lote.push(f.nombre);
      if (lote.length >= 500) await revisar();
    }
    await revisar();
  }
  return { huerfanos };
}
