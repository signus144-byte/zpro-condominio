// Tasa oficial USD/VES del Banco Central de Venezuela, comprobada con DOS fuentes (0022_tasa_verificada.sql):
//   1. La página del BCV (bcv.org.ve): bloque id="dolar" y su "Fecha Valor".
//   2. DolarApi Venezuela (ve.dolarapi.com/v1/dolares/oficial): la misma tasa oficial publicada por un tercero.
// Cada consulta queda registrada (lecturas_tasa) y la base de datos solo acepta la tasa cuando las dos coinciden.
// Si una fuente falla o no coinciden, NO se inventa nada: la junta ve el motivo y puede confirmar la tasa ella
// misma como segunda fuente; mientras tanto los vecinos no pueden reportar pagos en bolívares.
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import type { Contexto } from '../contexto.js';
import { comoServicio } from '../db/conexion.js';

export interface TasaLeida { usdVes: number; fecha: string | null }
export interface ResultadoTasa {
  estado: 'verificada' | 'una_fuente' | 'no_coinciden' | 'sin_datos';
  fecha: string | null; usdVes: number | null; fuentes: string[];
  lecturas: { fuente: string; ok: boolean; usdVes?: number; fecha?: string; error?: string }[];
}

export const hoyCaracas = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });

const numeroVe = (crudo: string) =>
  crudo.includes(',') ? Number(crudo.replace(/\./g, '').replace(',', '.')) : Number(crudo);
function validar(valor: number, crudo: string, fuente: string) {
  if (!(valor > 0) || valor > 1e7) throw new Error(`Tasa inválida en ${fuente}: ${crudo}`);
  return Math.round(valor * 10000) / 10000;
}

/** Extrae la tasa del HTML del BCV. Acepta "215,50050000" o "215.50". */
export function extraerTasaBcv(html: string): TasaLeida {
  const bloque = html.match(/id=["']dolar["'][\s\S]{0,800}?<strong>\s*([\d.,]+)\s*<\/strong>/i);
  if (!bloque) throw new Error('No se encontró la tasa USD en la página del BCV (¿cambió su formato?)');
  const crudo = bloque[1].trim();
  const usdVes = validar(numeroVe(crudo), crudo, 'la página del BCV');
  const fv = html.match(/Fecha\s*Valor[\s\S]{0,300}?content=["'](\d{4}-\d{2}-\d{2})/i)
          ?? html.match(/date-display-single[^>]*content=["'](\d{4}-\d{2}-\d{2})/i);
  return { usdVes, fecha: fv?.[1] ?? null };
}

/** Lee la respuesta de DolarApi: {"fuente":"oficial","promedio":897.5383,"fechaActualizacion":"2026-11-09T00:00:00-04:00"}. */
export function extraerDolarApi(json: unknown): TasaLeida {
  const d = json as { fuente?: string; promedio?: unknown; venta?: unknown; fechaActualizacion?: unknown };
  if (!d || typeof d !== 'object' || d.fuente !== 'oficial') throw new Error('DolarApi no devolvió la tasa oficial');
  const v = typeof d.promedio === 'number' ? d.promedio : typeof d.venta === 'number' ? d.venta : NaN;
  const usdVes = validar(v, String(d.promedio), 'DolarApi');
  const f = typeof d.fechaActualizacion === 'string' ? d.fechaActualizacion.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null : null;
  if (!f) throw new Error('DolarApi no indicó la fecha de la tasa');
  return { usdVes, fecha: f };
}

// El certificado del BCV a veces llega sin su cadena intermedia. Si el servidor tiene el certificado intermedio
// (BCV_CA_EXTRA=/ruta/intermedio.pem), se agrega a los de confianza; NUNCA se desactiva la verificación TLS.
let despachadorBcv: unknown;
async function opcionesBcv(): Promise<Record<string, unknown>> {
  const ruta = process.env.BCV_CA_EXTRA;
  if (!ruta) return {};
  if (!despachadorBcv) {
    const { Agent } = await import('undici');
    despachadorBcv = new Agent({ connect: { ca: [...rootCertificates, readFileSync(ruta, 'utf8')] } });
  }
  return { dispatcher: despachadorBcv };
}

const UA = { 'user-agent': 'VecinosZPro/0.7 (Technical Digital TD; tasa oficial para condominios)' };

async function leerBcv(fetchFn: typeof fetch): Promise<TasaLeida & { fecha: string }> {
  const r = await fetchFn('https://www.bcv.org.ve/', { headers: UA, signal: AbortSignal.timeout(20_000), ...(await opcionesBcv()) } as RequestInit);
  if (!r.ok) throw new Error(`El BCV respondió ${r.status}`);
  const t = extraerTasaBcv(await r.text());
  if (!t.fecha) throw new Error('La página del BCV no muestra la fecha valor');
  return t as TasaLeida & { fecha: string };
}

async function leerDolarApi(fetchFn: typeof fetch): Promise<TasaLeida & { fecha: string }> {
  const r = await fetchFn('https://ve.dolarapi.com/v1/dolares/oficial', { headers: { ...UA, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`DolarApi respondió ${r.status}`);
  return extraerDolarApi(await r.json()) as TasaLeida & { fecha: string };
}

const causa = (e: unknown) => {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  return (err.cause?.code ? `${err.message} (${err.cause.code})` : err.message).slice(0, 300);
};

/**
 * Consulta las dos fuentes, registra lo que dijo cada una y deja que la base de datos decida.
 * Se ejecuta cada 30 minutos, todos los días (también fines de semana: así se comprueba que la tasa del viernes
 * sigue rigiendo el sábado y el domingo).
 */
export async function actualizarTasaBcv(ctx: Contexto, fetchFn: typeof fetch = fetch): Promise<ResultadoTasa> {
  const fuentes = [['BCV', leerBcv], ['DolarApi', leerDolarApi]] as const;
  const lecturas = await Promise.all(fuentes.map(async ([fuente, leer]) => {
    try { const t = await leer(fetchFn); return { fuente, ok: true, usdVes: t.usdVes, fecha: t.fecha }; }
    catch (e) { return { fuente, ok: false, error: causa(e) }; }
  }));
  const r = await comoServicio(ctx.pool, async (c) => {
    for (const l of lecturas) {
      await c.query(`select registrar_lectura_tasa($1, $2, $3, $4)`,
        [l.fuente, l.ok ? l.fecha : null, l.ok ? l.usdVes : null, l.ok ? null : l.error]);
    }
    return (await c.query(`select * from consolidar_tasa()`)).rows[0];
  });
  return { estado: r.estado, fecha: r.fecha, usdVes: r.usd_ves == null ? null : Number(r.usd_ves), fuentes: r.fuentes ?? [], lecturas };
}
