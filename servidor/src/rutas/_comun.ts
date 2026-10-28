// Utilidades compartidas por los módulos de rutas del condominio.
import type { Tx } from '../db/conexion.js';
import { ErrorApi } from '../util/errores.js';

/** timestamptz → ISO; date ya viene como 'AAAA-MM-DD'. */
export const iso = (d: Date | string | null | undefined) => (d == null ? null : d instanceof Date ? d.toISOString() : d);

/** "B-33" (para listas de pagos/unidades); el chat y los documentos usan etiqueta_unidad() → "Apto B-33". */
export const etiquetaCorta = (bloque: string | null, numero: string) => `${bloque ? bloque + '-' : ''}${numero}`;

export async function exigir(c: Tx, sql: string, params: unknown[], mensaje = 'Sin permiso') {
  const { rows } = await c.query(`select (${sql}) as ok`, params);
  if (!rows[0]?.ok) throw new ErrorApi(403, mensaje, 'sin_permiso');
}
export const exigirJunta = (c: Tx, cid: string) => exigir(c, 'es_junta($1)', [cid]);
export const exigirFinanzas = (c: Tx, cid: string) => exigir(c, 'maneja_finanzas($1)', [cid]);
export const exigirMiembro = (c: Tx, cid: string) => exigir(c, 'es_miembro($1)', [cid]);

export const num = (x: unknown) => (x == null ? 0 : Number(x));
export const r2 = (x: number) => Math.round(x * 100) / 100;

/** Booleano desde un campo de formulario multipart ('true', '1', 'si'). */
export const booleano = (v: string | undefined) => v === 'true' || v === '1' || v === 'si' || v === 'on';
