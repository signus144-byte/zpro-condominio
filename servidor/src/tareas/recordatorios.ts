// Recordatorio diario a la junta: mientras haya pagos reportados sin aprobar ni rechazar, cada mañana
// le llega una notificación (en la app, push y correo). No se repite el mismo día.
import type { Contexto } from '../contexto.js';
import { comoServicio } from '../db/conexion.js';

export async function recordarPagosPendientes(ctx: Contexto) {
  const filas = await comoServicio(ctx.pool, async (c) => (await c.query(`select * from recordar_pagos_pendientes()`)).rows);
  return {
    condominios: filas.length,
    pagosPendientes: filas.reduce((s, f) => s + Number(f.pendientes), 0),
    personasAvisadas: filas.reduce((s, f) => s + Number(f.notificados), 0),
  };
}

/** Alertas vecinales olvidadas (más de 3 horas activas) se cierran solas como "vencida". */
export async function vencerAlertas(ctx: Contexto, horas = 3) {
  return comoServicio(ctx.pool, async (c) => Number((await c.query(`select vencer_alertas($1) as n`, [horas])).rows[0].n));
}
