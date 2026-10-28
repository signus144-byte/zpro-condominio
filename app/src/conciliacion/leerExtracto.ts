// Lectura del extracto bancario en el teléfono (Excel o CSV que se descarga de la banca en línea).
// Cada banco usa columnas distintas: aquí se leen las filas crudas, se adivinan las columnas y el usuario confirma.
import type { MovimientoExtracto } from '../data/tipos';

export type Celda = string | number | Date | null;
export interface TablaCruda { filas: Celda[][] }
export interface Columnas { encabezado: number; fecha: number; referencia: number; monto: number; descripcion: number | null }

/** CSV con separador ; , o tabulador (se detecta), comillas dobles y saltos de línea dentro de comillas. */
export function leerCsv(texto: string): TablaCruda {
  const limpio = texto.replace(/^﻿/, '');
  const primera = limpio.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].map((s) => [s, primera.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const filas: Celda[][] = [];
  let fila: string[] = [], campo = '', comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila.map((c) => c.trim())); fila = []; campo = '';
    } else campo += ch;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila.map((c) => c.trim())); }
  return { filas: filas.filter((f) => f.some((c) => c !== '')) };
}

/** Excel (.xlsx): primera hoja con datos. exceljs se carga solo cuando hace falta (pesa ~1 MB). */
export async function leerXlsx(datos: ArrayBuffer): Promise<TablaCruda> {
  const ExcelJS = (await import('exceljs')).default;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(datos);
  const hoja = libro.worksheets.find((h) => h.rowCount > 0);
  if (!hoja) return { filas: [] };
  const filas: Celda[][] = [];
  hoja.eachRow({ includeEmpty: false }, (row) => {
    const valores: Celda[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      const v = row.getCell(c).value as unknown;
      if (v === null || v === undefined) valores.push(null);
      else if (v instanceof Date || typeof v === 'number' || typeof v === 'string') valores.push(v);
      else if (typeof v === 'object' && v && 'result' in v) valores.push((v as { result: Celda }).result ?? null);   // fórmulas
      else if (typeof v === 'object' && v && 'richText' in v) valores.push((v as { richText: { text: string }[] }).richText.map((t) => t.text).join(''));
      else if (typeof v === 'object' && v && 'text' in v) valores.push(String((v as { text: string }).text));
      else valores.push(String(v));
    }
    filas.push(valores);
  });
  return { filas };
}

export async function leerArchivo(archivo: File): Promise<TablaCruda> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.xlsx')) return leerXlsx(await archivo.arrayBuffer());
  if (nombre.endsWith('.xls')) throw new Error('El formato .xls antiguo no se puede leer. En su banco descargue el movimiento como Excel (.xlsx) o CSV.');
  return leerCsv(await archivo.text());
}

const texto = (c: Celda) => (c instanceof Date ? c.toISOString() : c === null ? '' : String(c)).trim();

/** Adivina la fila de encabezados y las columnas por sus nombres habituales en los bancos venezolanos. */
export function adivinarColumnas(t: TablaCruda): Columnas {
  const encabezado = Math.max(0, t.filas.slice(0, 15).findIndex((f) => f.filter((c) => typeof c === 'string' && /[a-zA-Z]/.test(c)).length >= 3));
  const nombres = (t.filas[encabezado] ?? []).map((c) => texto(c).toLowerCase());
  const buscar = (re: RegExp, evitar?: RegExp) => nombres.findIndex((n) => re.test(n) && !(evitar && evitar.test(n)));
  const fecha = buscar(/fecha/);
  const referencia = buscar(/ref|n[uú]mero|documento|comprobante|serial/);
  let monto = buscar(/cr[eé]dito|abono|ingreso|haber/);
  if (monto < 0) monto = buscar(/monto|importe|cantidad/, /saldo/);
  const descripcion = buscar(/descrip|concepto|detalle|observ/);
  return { encabezado, fecha: Math.max(fecha, 0), referencia: Math.max(referencia, 0), monto: Math.max(monto, 0), descripcion: descripcion >= 0 ? descripcion : null };
}

/** Fecha → AAAA-MM-DD. Acepta Date, 27/10/2026, 27-10-2026, 27/10/26, 2026-10-27 y número de serie de Excel. */
export function normalizarFecha(c: Celda): string | null {
  if (c instanceof Date && !isNaN(c.getTime())) return c.toISOString().slice(0, 10);
  if (typeof c === 'number' && c > 20000 && c < 80000) {                        // serie de Excel (días desde 1899-12-30)
    return new Date(Date.UTC(1899, 11, 30) + c * 86_400_000).toISOString().slice(0, 10);
  }
  const s = texto(c);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
    const mes = Number(m[2]), dia = Number(m[1]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  return null;
}

/** Monto → número. Acepta 1.234,56 (formato venezolano), 1,234.56, -15,00, (15,00) y "Bs. 1.234,56". */
export function normalizarMonto(c: Celda): number | null {
  if (typeof c === 'number') return isFinite(c) ? c : null;
  let s = texto(c).replace(/bs\.?|\$|usd|ves/gi, '').replace(/\s/g, '');
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negativo = true; s = s.slice(1); }
  if (s.endsWith('-')) { negativo = true; s = s.slice(0, -1); }
  const ultimaComa = s.lastIndexOf(','), ultimoPunto = s.lastIndexOf('.');
  if (ultimaComa > ultimoPunto) s = s.replace(/\./g, '').replace(',', '.');          // 1.234,56
  else if (ultimoPunto > ultimaComa && ultimaComa >= 0) s = s.replace(/,/g, '');     // 1,234.56
  else if (ultimaComa >= 0 && ultimoPunto < 0) s = s.replace(',', '.');              // 15,5
  else if (ultimoPunto >= 0 && ultimaComa < 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // 1.234 (miles)
  const n = Number(s);
  if (!isFinite(n)) return null;
  return Math.round((negativo ? -n : n) * 100) / 100;
}

/** Convierte la tabla en movimientos con las columnas elegidas. Descarta filas sin fecha o sin monto. */
export function aMovimientos(t: TablaCruda, col: Columnas): { movimientos: MovimientoExtracto[]; descartadas: number } {
  const movimientos: MovimientoExtracto[] = [];
  let descartadas = 0;
  for (const f of t.filas.slice(col.encabezado + 1)) {
    const fecha = normalizarFecha(f[col.fecha] ?? null);
    const monto = normalizarMonto(f[col.monto] ?? null);
    if (!fecha || monto === null || monto === 0) { descartadas++; continue; }
    movimientos.push({
      fecha, monto, referencia: texto(f[col.referencia] ?? null).replace(/\.0+$/, ''),
      descripcion: col.descripcion === null ? '' : texto(f[col.descripcion] ?? null).slice(0, 300),
    });
  }
  return { movimientos, descartadas };
}
