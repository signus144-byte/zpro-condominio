// Tareas programadas (CONTRATO_API.md §11), con hora de Caracas. Cada una es una función exportada y probada.
import { Cron } from 'croner';
import type { Contexto } from '../contexto.js';
import { actualizarTasaBcv, hoyCaracas } from './tasa-bcv.js';
import { purgarChat, purgarHuerfanos } from './purga.js';
import { facturarMes, suspenderMorosos } from './facturacion.js';
import { recordarPagosPendientes, vencerAlertas } from './recordatorios.js';

export { actualizarTasaBcv, extraerTasaBcv } from './tasa-bcv.js';
export { purgarChat, purgarHuerfanos } from './purga.js';
export { facturarMes, suspenderMorosos } from './facturacion.js';
export { recordarPagosPendientes, vencerAlertas } from './recordatorios.js';

type Log = { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
const consola: Log = { info: (o, m) => console.log(m ?? '', o), error: (o, m) => console.error(m ?? '', o) };

export function iniciarTareas(ctx: Contexto, log: Log = consola): { detener(): void } {
  const zona = { timezone: 'America/Caracas', protect: true } as const;
  const tarea = (nombre: string, patron: string, fn: () => Promise<unknown>) =>
    new Cron(patron, { ...zona, name: nombre }, async () => {
      try { log.info({ resultado: await fn() }, `tarea ${nombre} lista`); }
      catch (e) { log.error({ e }, `tarea ${nombre} falló`); }
    });

  const trabajos = [
    tarea('tasa-bcv', '30 9,17 * * 1-5', () => actualizarTasaBcv(ctx)),        // 9:30 y 17:30, lun–vie
    tarea('purga-chat', '0 3 * * *', () => purgarChat(ctx)),                   // 3:00
    tarea('purga-huerfanos', '30 3 * * 0', () => purgarHuerfanos(ctx)),       // domingos 3:30
    tarea('facturacion', '0 6 1 * *', () => facturarMes(ctx, hoyCaracas())),   // día 1, 6:00
    tarea('suspension', '0 7 * * *', () => suspenderMorosos(ctx, 10)),         // 7:00
    tarea('recordatorio-pagos', '0 8 * * *', () => recordarPagosPendientes(ctx)), // 8:00: pagos sin aprobar/rechazar
    tarea('vencer-alertas', '*/15 * * * *', () => vencerAlertas(ctx)),           // cada 15 min: alertas de más de 3 h
  ];
  return { detener() { for (const t of trabajos) t.stop(); } };
}
