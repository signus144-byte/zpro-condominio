// Cobro de ZentaPro: factura mensual (día 1) en bolívares a tasa BCV y suspensión diaria de morosos.
import type { Contexto } from '../contexto.js';
import { comoServicio } from '../db/conexion.js';

const periodoDe = (fecha: string) => `${fecha.slice(0, 7)}-01`;

/** Emite la factura del mes a cada condominio activo con plan. Repetirla no duplica (las existentes se omiten). */
export async function facturarMes(ctx: Contexto, fecha: string) {
  const periodo = periodoDe(fecha);
  const condos = await comoServicio(ctx.pool, async (c) => (await c.query(
    `select c.id, c.nombre from condominios c
      where c.estado = 'activo' and c.plan_id is not null
        and not exists (select 1 from facturas_plataforma f where f.condominio_id = c.id and f.periodo = $1)`, [periodo])).rows);
  const emitidas: string[] = [];
  const fallidas: { condominio: string; motivo: string }[] = [];
  for (const k of condos) {
    try {
      await comoServicio(ctx.pool, (c) => c.query(`select facturar_condominio($1, $2)`, [k.id, periodo]));
      emitidas.push(k.nombre);
    } catch (e) { fallidas.push({ condominio: k.nombre, motivo: (e as Error).message }); }
  }
  return { periodo, emitidas, fallidas };
}

/** Marca vencidas y pasa a solo lectura a quien pase los días de gracia. */
export async function suspenderMorosos(ctx: Contexto, diasGracia = 10) {
  return comoServicio(ctx.pool, async (c) => (await c.query(`select suspender_morosos_plataforma($1) as n`, [diasGracia])).rows[0].n as number);
}
