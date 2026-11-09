// Tasa BCV REAL para el modo demostración (sin servidor propio): el teléfono consulta las mismas dos fuentes que el
// servidor (página del BCV y DolarApi) y aplica la misma regla que 0022_tasa_verificada.sql:
//   · Solo hay tasa cuando DOS fuentes coinciden (± 0,01 %). La junta cuenta como una fuente.
//   · Solo vale para HOY si se comprobó hoy. Sin internet, no hay tasa: la app pide conectarse.
// Con servidor propio, la app NO usa este módulo: le pregunta la tasa al servidor.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { TasaBcv } from './tipos';

interface Lectura { fuente: string; fecha: string; usdVes: number; automatica: boolean; en: number }
interface Verificada { fecha: string; usdVes: number; fuentes: string[]; en: number; vigenteHasta: string }

export const hoyCaracas = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
const coinciden = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.min(a, b) * 0.0001);
const dias = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
const sumarDias = (f: string, n: number) => new Date(Date.parse(f) + n * 86_400_000).toISOString().slice(0, 10);

const numeroVe = (crudo: string) => (crudo.includes(',') ? Number(crudo.replace(/\./g, '').replace(',', '.')) : Number(crudo));

export function extraerTasaBcv(html: string): { usdVes: number; fecha: string } {
  const bloque = html.match(/id=["']dolar["'][\s\S]{0,800}?<strong>\s*([\d.,]+)\s*<\/strong>/i);
  if (!bloque) throw new Error('No se encontró la tasa en la página del BCV');
  const v = numeroVe(bloque[1].trim());
  if (!(v > 0) || v > 1e7) throw new Error('Tasa inválida en la página del BCV');
  const fv = html.match(/Fecha\s*Valor[\s\S]{0,300}?content=["'](\d{4}-\d{2}-\d{2})/i)
          ?? html.match(/date-display-single[^>]*content=["'](\d{4}-\d{2}-\d{2})/i);
  if (!fv) throw new Error('La página del BCV no muestra la fecha valor');
  return { usdVes: Math.round(v * 10000) / 10000, fecha: fv[1] };
}

export function extraerDolarApi(json: unknown): { usdVes: number; fecha: string } {
  const d = json as { fuente?: string; promedio?: unknown; fechaActualizacion?: unknown };
  if (!d || d.fuente !== 'oficial' || typeof d.promedio !== 'number' || !(d.promedio > 0)) throw new Error('DolarApi no devolvió la tasa oficial');
  const f = typeof d.fechaActualizacion === 'string' ? d.fechaActualizacion.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error('DolarApi no indicó la fecha');
  return { usdVes: Math.round(d.promedio * 10000) / 10000, fecha: f };
}

async function obtener(url: string, json: boolean): Promise<unknown> {
  if (Capacitor.isNativePlatform()) {
    // Nativo: sin restricciones CORS del navegador.
    const r = await CapacitorHttp.get({ url, responseType: json ? 'json' : 'text', connectTimeout: 15_000, readTimeout: 15_000,
                                        headers: { accept: json ? 'application/json' : 'text/html' } });
    if (r.status >= 400) throw new Error(`respondió ${r.status}`);
    return json && typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`respondió ${r.status}`);
  return json ? r.json() : r.text();
}

// ---------- Estado (en memoria; las tasas ya verificadas se recuerdan en el teléfono) ----------
const lecturas = new Map<string, Lectura>();
let historial: Verificada[] = [];
let ultimaConsulta = 0;          // última vez que respondió al menos una fuente
let ultimoIntento = 0;
let sinConexion = false;
let enCurso: Promise<void> | null = null;
const CLAVE = 'zpro.demo.tasas';
try { historial = JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as Verificada[]; } catch { historial = []; }
const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(historial.slice(-30))); } catch { /* sin almacenamiento */ } };

/** Para pruebas y capturas: reemplaza la consulta a internet. */
let lector: (url: string, json: boolean) => Promise<unknown> = obtener;
export function usarLectorDePrueba(fn: (url: string, json: boolean) => Promise<unknown>) { lector = fn; ultimoIntento = 0; ultimaConsulta = 0; }

/** Consulta las dos fuentes (como mucho cada 10 minutos, salvo que se fuerce). */
export function consultarFuentes(forzar = false): Promise<void> {
  if (enCurso) return enCurso;
  if (!forzar && Date.now() - ultimoIntento < 10 * 60_000 && ultimaConsulta) return Promise.resolve();
  ultimoIntento = Date.now();
  enCurso = (async () => {
    const r = await Promise.allSettled([
      lector('https://www.bcv.org.ve/', false).then((h) => ({ fuente: 'BCV', ...extraerTasaBcv(String(h)) })),
      lector('https://ve.dolarapi.com/v1/dolares/oficial', true).then((j) => ({ fuente: 'DolarApi', ...extraerDolarApi(j) })),
    ]);
    const ok = r.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []));
    sinConexion = ok.length === 0;
    for (const l of ok) lecturas.set(l.fuente, { ...l, automatica: true, en: Date.now() });
    if (ok.length) ultimaConsulta = Date.now();
    consolidar();
  })().finally(() => { enCurso = null; });
  return enCurso;
}

/** La junta confirma la tasa (una fuente más). */
export function confirmarManual(usdVes: number, fecha = hoyCaracas()) {
  lecturas.set('Junta', { fuente: 'Junta', fecha, usdVes: Math.round(usdVes * 10000) / 10000, automatica: false, en: Date.now() });
  return consolidar();
}

function vigentes(): Lectura[] {
  const ahora = Date.now();
  return [...lecturas.values()].filter((l) => ahora - l.en < (l.automatica ? 6 : 24) * 3600_000);
}

function consolidar(): 'verificada' | 'una_fuente' | 'no_coinciden' | 'sin_datos' {
  const ls = vigentes();
  if (!ls.length) return 'sin_datos';
  const orden = [...ls].sort((a, b) => b.fecha.localeCompare(a.fecha) || Number(b.fuente === 'BCV') - Number(a.fuente === 'BCV'));
  let elegida: Verificada | null = null;
  for (const g of orden) {
    const grupo = ls.filter((b) => coinciden(g.usdVes, b.usdVes) && Math.abs(dias(b.fecha, g.fecha)) <= 4);
    if (grupo.length >= 2) {
      const porFecha = [...grupo].sort((a, b) => Number(b.fuente === 'BCV') - Number(a.fuente === 'BCV') || Number(a.automatica) - Number(b.automatica))[0];
      const porValor = [...grupo].sort((a, b) => Number(b.fuente === 'BCV') - Number(a.fuente === 'BCV') || Number(b.automatica) - Number(a.automatica))[0];
      elegida = { fecha: porFecha.fecha, usdVes: porValor.usdVes, fuentes: grupo.map((x) => x.fuente).sort(), en: Date.now(), vigenteHasta: '' };
      break;
    }
  }
  const conflicto = ls.some((a) => ls.some((b) => a.fuente < b.fuente && a.fecha === b.fecha && !coinciden(a.usdVes, b.usdVes)
                                               && (!elegida || a.fecha >= elegida.fecha)));
  if (!elegida || conflicto) return conflicto ? 'no_coinciden' : 'una_fuente';
  const hoy = hoyCaracas();
  const previa = historial.find((h) => h.fecha === elegida!.fecha);
  elegida.vigenteHasta = elegida.fecha <= hoy ? (previa && previa.vigenteHasta > hoy ? previa.vigenteHasta : hoy) : elegida.fecha;
  historial = historial.filter((h) => h.fecha !== elegida!.fecha);
  if (elegida.fecha > hoy) {
    // Publicada para un día próximo: la anterior sigue rigiendo hoy (si se había comprobado ayer o hoy).
    const ant = historial.filter((h) => h.fecha < elegida!.fecha).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
    if (ant && ant.vigenteHasta >= sumarDias(hoy, -1) && ant.vigenteHasta < hoy) ant.vigenteHasta = hoy;
  }
  for (const h of historial) if (h.fecha < elegida.fecha && h.vigenteHasta >= elegida.fecha) h.vigenteHasta = sumarDias(elegida.fecha, -1);
  historial.push(elegida);
  historial.sort((a, b) => a.fecha.localeCompare(b.fecha));
  guardar();
  return 'verificada';
}

/** La tasa que rige un día (por defecto hoy) o el motivo por el que no hay. */
export function tasaPara(fecha = hoyCaracas()): TasaBcv {
  const hoy = hoyCaracas();
  const t = historial.filter((h) => h.fecha <= fecha).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  const base = { hoy, ultimaConsulta: ultimaConsulta ? new Date(ultimaConsulta).toISOString() : null };
  if (t && fecha <= t.vigenteHasta) {
    return { ...base, fecha: t.fecha, usdVes: t.usdVes, verificada: true, fuentes: t.fuentes, verificadaEn: new Date(t.en).toISOString(), motivo: null };
  }
  const ls = vigentes();
  const conflicto = ls.some((a) => ls.some((b) => a.fuente < b.fuente && a.fecha === b.fecha && !coinciden(a.usdVes, b.usdVes)));
  const motivo = sinConexion && !ls.length
    ? 'Sin conexión a internet: conéctese para actualizar la tasa BCV de hoy antes de pagar en bolívares.'
    : conflicto ? 'Las fuentes de la tasa BCV no coinciden. La junta debe confirmarla antes de recibir pagos en bolívares.'
    : ls.length === 1 ? `Solo respondió una fuente (${ls[0].fuente}). Hacen falta dos para confirmar la tasa; intente en unos minutos.`
    : 'La tasa BCV de hoy aún no está confirmada por dos fuentes. Intente en unos minutos.';
  return { ...base, fecha: null, usdVes: null, verificada: false, fuentes: [], verificadaEn: null, motivo };
}

/** True si la última consulta no llegó a ninguna fuente y no hay lecturas recientes (teléfono sin internet). */
export function sinInternet() { return sinConexion && vigentes().length === 0; }

export function lecturasActuales() {
  return [...lecturas.values()].map((l) => ({ fuente: l.fuente, automatica: l.automatica, fechaValor: l.fecha, usdVes: l.usdVes, error: null,
                                              leidaEn: new Date(l.en).toISOString() }));
}
