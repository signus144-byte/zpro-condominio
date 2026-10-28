// Tasa oficial USD/VES del Banco Central de Venezuela (bcv.org.ve).
// La página muestra el dólar en un bloque con id="dolar" y la "Fecha Valor" (día en que rige la tasa).
// Si el BCV cambia su HTML, la extracción falla en voz alta y la junta puede cargar la tasa a mano.
import type { Contexto } from '../contexto.js';
import { comoServicio } from '../db/conexion.js';

export interface TasaLeida { usdVes: number; fecha: string | null }

/** Extrae la tasa del HTML del BCV. Acepta "215,50050000" o "215.50". */
export function extraerTasaBcv(html: string): TasaLeida {
  const bloque = html.match(/id=["']dolar["'][\s\S]{0,800}?<strong>\s*([\d.,]+)\s*<\/strong>/i);
  if (!bloque) throw new Error('No se encontró la tasa USD en la página del BCV (¿cambió su formato?)');
  const crudo = bloque[1].trim();
  // Formato venezolano: punto de miles opcional y coma decimal.
  const valor = crudo.includes(',') ? Number(crudo.replace(/\./g, '').replace(',', '.')) : Number(crudo);
  if (!(valor > 0) || valor > 1e7) throw new Error(`Tasa inválida en la página del BCV: ${crudo}`);
  const fv = html.match(/Fecha\s*Valor[\s\S]{0,300}?content=["'](\d{4}-\d{2}-\d{2})/i)
          ?? html.match(/date-display-single[^>]*content=["'](\d{4}-\d{2}-\d{2})/i);
  return { usdVes: Math.round(valor * 10000) / 10000, fecha: fv?.[1] ?? null };
}

export const hoyCaracas = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });

/** Descarga la página del BCV y guarda la tasa (con su fecha valor) en tasas_bcv. */
export async function actualizarTasaBcv(ctx: Contexto, fetchFn: typeof fetch = fetch): Promise<TasaLeida & { fecha: string }> {
  const r = await fetchFn('https://www.bcv.org.ve/', {
    headers: { 'user-agent': 'ZProCondominio/1.0 (+https://zentapro.com)' }, signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`El BCV respondió ${r.status}`);
  const t = extraerTasaBcv(await r.text());
  const fecha = t.fecha ?? hoyCaracas();
  await comoServicio(ctx.pool, (c) => c.query(
    `insert into tasas_bcv (fecha, usd_ves, fuente) values ($1, $2, 'BCV')
     on conflict (fecha) do update set usd_ves = excluded.usd_ves, fuente = excluded.fuente`, [fecha, t.usdVes]));
  return { ...t, fecha };
}
