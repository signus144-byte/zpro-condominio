// Importación de unidades desde Excel (.xlsx) o CSV.
// Columnas esperadas (en cualquier orden, con o sin acentos): bloque, numero, tipo, alicuota, propietario.
import type { TipoDesarrollo, TipoUnidad, UnidadImport } from './data/tipos';
import { r2 } from './formato';

export interface ResultadoImport {
  unidades: UnidadImport[];
  errores: string[];        // bloquean la importación
  avisos: string[];         // informativos
  sumaAlicuotas: number;
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const COLUMNAS: Record<string, keyof UnidadImport> = {
  bloque: 'bloque', torre: 'bloque', edificio: 'bloque', manzana: 'bloque', calle: 'bloque',
  numero: 'numero', 'n°': 'numero', nro: 'numero', apto: 'numero', apartamento: 'numero', casa: 'numero', unidad: 'numero',
  tipo: 'tipo',
  alicuota: 'alicuota', 'alicuota %': 'alicuota', 'alicuota (%)': 'alicuota', porcentaje: 'alicuota', '%': 'alicuota',
  propietario: 'propietario', dueno: 'propietario', nombre: 'propietario',
};
const TIPOS: Record<string, TipoUnidad> = {
  apartamento: 'apartamento', apto: 'apartamento', casa: 'casa', local: 'local', oficina: 'oficina',
  townhouse: 'townhouse', th: 'townhouse', 'town house': 'townhouse',
};

/** Convierte "11,5", "11.5", "0,115000" o "11,5 %" en número. */
export function numeroFlexible(v: unknown): number {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace('%', '').trim();
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(',', '.');
  return Number(s);
}

function separarCsv(texto: string): string[][] {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return [];
  const sep = (lineas[0].match(/;/g)?.length ?? 0) >= (lineas[0].match(/,/g)?.length ?? 0) ? ';' : lineas[0].includes('\t') ? '\t' : ',';
  return lineas.map((l) => {
    const celdas: string[] = []; let actual = ''; let comillas = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (comillas) {
        if (c === '"' && l[i + 1] === '"') { actual += '"'; i++; } else if (c === '"') comillas = false; else actual += c;
      } else if (c === '"') comillas = true;
      else if (c === sep) { celdas.push(actual); actual = ''; } else actual += c;
    }
    celdas.push(actual);
    return celdas.map((x) => x.trim());
  });
}

async function leerXlsx(archivo: File): Promise<string[][]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await archivo.arrayBuffer());
  const hoja = wb.worksheets[0];
  if (!hoja) return [];
  const filas: string[][] = [];
  hoja.eachRow({ includeEmpty: false }, (fila) => {
    const valores: string[] = [];
    for (let c = 1; c <= fila.cellCount; c++) {
      const v = fila.getCell(c).value as unknown;
      const txt = v == null ? '' : typeof v === 'object' && v !== null && 'result' in v ? String((v as { result: unknown }).result ?? '')
        : typeof v === 'object' && v !== null && 'text' in v ? String((v as { text: unknown }).text) : String(v);
      valores.push(txt.trim());
    }
    filas.push(valores);
  });
  return filas;
}

export async function leerArchivoUnidades(archivo: File, tipoDesarrollo: TipoDesarrollo): Promise<ResultadoImport> {
  const esExcel = /\.xlsx$/i.test(archivo.name);
  const filas = esExcel ? await leerXlsx(archivo) : separarCsv(await archivo.text());
  return validarFilas(filas, tipoDesarrollo);
}

export function validarFilas(filas: string[][], tipoDesarrollo: TipoDesarrollo): ResultadoImport {
  const errores: string[] = []; const avisos: string[] = []; const unidades: UnidadImport[] = [];
  if (filas.length < 2) return { unidades, errores: ['El archivo no tiene filas de datos.'], avisos, sumaAlicuotas: 0 };
  const cab = filas[0].map((h) => COLUMNAS[sinAcentos(h)]);
  if (!cab.includes('numero')) errores.push('Falta la columna "numero".');
  if (!cab.includes('alicuota')) errores.push('Falta la columna "alicuota".');
  if (errores.length) return { unidades, errores, avisos, sumaAlicuotas: 0 };
  const tipoPorDefecto: TipoUnidad = tipoDesarrollo === 'urbanizacion' ? 'casa' : tipoDesarrollo === 'centro_comercial' ? 'local' : 'apartamento';
  const vistos = new Set<string>();
  let sinTipo = 0;

  filas.slice(1).forEach((f, i) => {
    const n = i + 2; // número de fila tal como la ve el usuario en Excel
    const get = (k: keyof UnidadImport) => { const j = cab.indexOf(k); return j >= 0 ? (f[j] ?? '').trim() : ''; };
    if (f.every((c) => !c.trim())) return;
    const numero = get('numero');
    const bloque = get('bloque') || null;
    const alic = numeroFlexible(get('alicuota'));
    const tipoTxt = sinAcentos(get('tipo'));
    const tipo = tipoTxt ? TIPOS[tipoTxt] : tipoPorDefecto;
    if (!tipoTxt) sinTipo++;
    if (!numero) { errores.push(`Fila ${n}: falta el número de la unidad.`); return; }
    if (!tipo) { errores.push(`Fila ${n}: tipo "${get('tipo')}" no válido (use apartamento, casa, local, oficina o townhouse).`); return; }
    if (!(alic > 0) || alic > 100) { errores.push(`Fila ${n}: alícuota "${get('alicuota')}" no válida.`); return; }
    const clave = `${bloque ?? ''}|${numero}`.toUpperCase();
    if (vistos.has(clave)) { errores.push(`Fila ${n}: la unidad ${bloque ? bloque + '-' : ''}${numero} está repetida.`); return; }
    vistos.add(clave);
    unidades.push({ bloque, numero, tipo, alicuota: alic, propietario: get('propietario') || null });
  });

  let suma = r2(unidades.reduce((s, u) => s + u.alicuota, 0) * 10000) / 10000;
  // Algunos documentos de condominio expresan la alícuota como fracción (0,115 en vez de 11,5 %).
  if (unidades.length && Math.abs(suma - 1) <= 0.0001) {
    unidades.forEach((u) => { u.alicuota = r2(u.alicuota * 100 * 10000) / 10000; });
    suma = 100;
    avisos.push('Las alícuotas venían como fracción (suman 1); se convirtieron a porcentaje.');
  }
  if (unidades.length && Math.abs(suma - 100) > 0.01) {
    errores.push(`Las alícuotas suman ${suma.toLocaleString('es-VE', { maximumFractionDigits: 4 })} %; deben sumar 100 % (tolerancia 0,01). Revise el documento de condominio.`);
  }
  if (sinTipo && unidades.length) avisos.push(`${sinTipo} fila(s) sin tipo: se asumió "${tipoPorDefecto}".`);
  return { unidades, errores, avisos, sumaAlicuotas: suma };
}
