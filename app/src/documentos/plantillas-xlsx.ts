// Plantillas Excel (.xlsx) con la marca del condominio.
// Solo valores, formatos de número y SUMA(): se abren igual en Excel, Google Sheets y LibreOffice.
import ExcelJS from 'exceljs';
import type { EstadoCuenta, Gasto, UnidadConSaldo } from '../data/tipos';
import {
  ESTADO_PAGO, METODOS, PIE, TIPO_CARGO, aBase64, argb, etiquetaUnidad, fechaCorta, hexARgb, mesLargo, r2,
  type MarcaDoc, type OpcionesDoc,
} from './comun';

const FMT_USD = '"$"#,##0.00';
const FMT_BS = '"Bs "#,##0.00';
const FMT_PCT = '0.00" %"';
const FMT_FECHA = 'dd/mm/yyyy';
/** Fecha real (no texto) para que se pueda ordenar y filtrar en Excel/Sheets. */
const fechaXl = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 12));

interface Col { titulo: string; ancho: number; fmt?: string }

/** Crea una hoja con el encabezado de marca (filas 1–5) y la tabla desde la fila 7. Devuelve la fila de encabezado. */
function hojaConMarca(wb: ExcelJS.Workbook, nombre: string, marca: MarcaDoc, titulo: string, cols: Col[], o: OpcionesDoc) {
  const ws = wb.addWorksheet(nombre, {
    views: [{ state: 'frozen', ySplit: 7, showGridLines: false }],
    // Al imprimir: carta, una página de ancho, repite encabezado de tabla.
    pageSetup: { paperSize: 1 as ExcelJS.PaperSize, orientation: cols.length > 5 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: '7:7', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  const color = hexARgb(marca.colorPrimario);
  ws.columns = cols.map((c) => ({ width: c.ancho }));
  // Logo en A1:A5 (si hay)
  const colTexto = marca.logo ? 2 : 1;
  if (marca.logo) {
    const id = wb.addImage({ base64: aBase64(marca.logo.bytes), extension: marca.logo.tipo === 'png' ? 'png' : 'jpeg' });
    ws.addImage(id, { tl: { col: 0.15, row: 0.2 }, ext: { width: 64, height: 64 } });
  }
  const fila = (n: number, texto: string, font: Partial<ExcelJS.Font>) => {
    const c = ws.getCell(n, colTexto);
    c.value = texto;
    c.font = { name: 'Arial', ...font };
  };
  fila(1, marca.nombre, { size: 14, bold: true, color: { argb: argb(color) } });
  if (marca.nombreAsociacion) fila(2, marca.nombreAsociacion, { size: 9, color: { argb: 'FF5B6662' } });
  fila(3, [marca.rif && `RIF ${marca.rif}`, marca.direccion, marca.ciudad].filter(Boolean).join(' · '), { size: 9, color: { argb: 'FF5B6662' } });
  fila(4, titulo, { size: 12, bold: true });
  fila(5, `Emitido: ${fechaCorta(o.fecha ?? new Date())}${o.codigo ? ` · Código: ${o.codigo}` : ''}`, { size: 9, color: { argb: 'FF5B6662' } });
  for (let r = 1; r <= 5; r++) ws.getRow(r).height = r === 1 ? 20 : 15;
  // Encabezado de tabla en la fila 7
  const enc = ws.getRow(7);
  cols.forEach((c, i) => {
    const cell = enc.getCell(i + 1);
    cell.value = c.titulo;
    cell.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(color) } };
    cell.alignment = { vertical: 'middle', horizontal: c.fmt && c.fmt !== FMT_FECHA ? 'right' : 'left' };
  });
  enc.height = 20;
  ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7, column: cols.length } };
  return { ws, color, cols };
}

function agregarFilas(ws: ExcelJS.Worksheet, cols: Col[], filas: (string | number | Date | null)[][], desde = 8) {
  filas.forEach((f, i) => {
    const row = ws.getRow(desde + i);
    f.forEach((v, j) => {
      const c = row.getCell(j + 1);
      c.value = v as ExcelJS.CellValue;
      c.font = { name: 'Arial', size: 10 };
      if (cols[j].fmt) c.numFmt = cols[j].fmt!;
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F6F2' } };
    });
  });
  return desde + filas.length;
}

/** Fila de totales con SUMA() en las columnas indicadas. */
function filaTotal(ws: ExcelJS.Worksheet, cols: Col[], fila: number, desde: number, hasta: number, colsSuma: number[], etiqueta = 'TOTAL', tinte = 'FFE2EFED') {
  const row = ws.getRow(fila);
  row.getCell(1).value = etiqueta;
  cols.forEach((c, j) => {
    const cell = row.getCell(j + 1);
    cell.font = { name: 'Arial', bold: true, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tinte } };
    if (colsSuma.includes(j + 1)) {
      const L = ws.getColumn(j + 1).letter;
      cell.value = hasta >= desde ? { formula: `SUM(${L}${desde}:${L}${hasta})` } : 0;
      cell.numFmt = c.fmt ?? FMT_USD;
    }
  });
}

function pie(ws: ExcelJS.Worksheet, fila: number, codigo?: string | null) {
  const c = ws.getCell(fila + 2, 1);
  c.value = PIE(codigo);
  c.font = { name: 'Arial', size: 8, italic: true, color: { argb: 'FF5B6662' } };
}

async function bytes(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  wb.creator = 'ZPro Condominio';
  wb.created = new Date();
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

// ---------------- Estado de cuenta ----------------
export async function estadoCuentaXlsx(marca: MarcaDoc, e: EstadoCuenta, o: OpcionesDoc = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const u = e.unidad;
  const titulo = `Estado de cuenta · Unidad ${etiquetaUnidad(u)}${u.propietario ? ` · ${u.propietario}` : ''}`;

  const colsS: Col[] = [{ titulo: 'Concepto', ancho: 34 }, { titulo: 'Monto ($)', ancho: 16, fmt: FMT_USD }, { titulo: 'Equivale (Bs)', ancho: 18, fmt: FMT_BS }];
  const s = hojaConMarca(wb, 'Resumen', marca, titulo, colsS, o);
  const t = o.tasaBcv ?? null;
  const conf = r2(e.pagos.filter((x) => x.estado === 'confirmado').reduce((a, x) => a + x.montoUsd, 0));
  const porConf = r2(e.pagos.filter((x) => x.estado === 'reportado').reduce((a, x) => a + x.montoUsd, 0));
  const tot = r2(e.cargos.reduce((a, x) => a + x.montoUsd, 0));
  const finS = agregarFilas(s.ws, colsS, [
    ['Total facturado', tot, t ? r2(tot * t) : null],
    ['Pagos confirmados', conf, t ? r2(conf * t) : null],
    ['Pagos por confirmar', porConf, t ? r2(porConf * t) : null],
    [e.saldoUsd >= 0 ? 'Saldo pendiente' : 'Saldo a favor', Math.abs(e.saldoUsd), t ? r2(Math.abs(e.saldoUsd) * t) : null],
  ]);
  s.ws.getRow(finS - 1).font = { name: 'Arial', bold: true, size: 11 };
  if (t) { const c = s.ws.getCell(finS + 1, 1); c.value = `Tasa BCV usada: ${t.toLocaleString('es-VE')} Bs/$`; c.font = { name: 'Arial', size: 9 }; }
  pie(s.ws, finS + 1, o.codigo);
  const colsR: Col[] = [{ titulo: 'Mes', ancho: 16 }, { titulo: 'Concepto', ancho: 44 }, { titulo: 'Tipo', ancho: 18 }, { titulo: 'Monto ($)', ancho: 14, fmt: FMT_USD }];
  const r = hojaConMarca(wb, 'Recibos', marca, titulo, colsR, o);
  const cargos = [...e.cargos].sort((a, b) => b.periodo.localeCompare(a.periodo));
  const fin = agregarFilas(r.ws, colsR, cargos.map((c) => [mesLargo(c.periodo), c.concepto, TIPO_CARGO[c.tipo] ?? c.tipo, c.montoUsd]));
  filaTotal(r.ws, colsR, fin, 8, fin - 1, [4], 'TOTAL FACTURADO');
  pie(r.ws, fin, o.codigo);

  const colsP: Col[] = [
    { titulo: 'Fecha', ancho: 12, fmt: FMT_FECHA }, { titulo: 'Método', ancho: 16 }, { titulo: 'Referencia', ancho: 16 }, { titulo: 'Moneda', ancho: 9 },
    { titulo: 'Monto', ancho: 16, fmt: '#,##0.00' }, { titulo: 'Tasa BCV', ancho: 11, fmt: '#,##0.0000' },
    { titulo: 'Equivale ($)', ancho: 14, fmt: FMT_USD }, { titulo: 'Estado', ancho: 14 },
  ];
  const p = hojaConMarca(wb, 'Pagos', marca, titulo, colsP, o);
  const pagos = [...e.pagos].sort((a, b) => b.fechaPago.localeCompare(a.fechaPago));
  const finP = agregarFilas(p.ws, colsP, pagos.map((x) => [fechaXl(x.fechaPago), METODOS[x.metodo] ?? x.metodo, x.referencia ?? '',
    x.moneda === 'USD' ? '$' : 'Bs', x.monto, x.tasaBcv, x.montoUsd, ESTADO_PAGO[x.estado] ?? x.estado]));
  pie(p.ws, finP, o.codigo);

  return bytes(wb);
}

// ---------------- Relación de gastos ----------------
export async function relacionGastosXlsx(marca: MarcaDoc, periodo: string, gastos: Gasto[], o: OpcionesDoc = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const cols: Col[] = [
    { titulo: 'Categoría', ancho: 18 }, { titulo: 'Descripción', ancho: 40 }, { titulo: 'Tipo', ancho: 11 }, { titulo: 'Fecha', ancho: 12, fmt: FMT_FECHA },
    { titulo: 'Moneda', ancho: 9 }, { titulo: 'Monto', ancho: 15, fmt: '#,##0.00' }, { titulo: 'Tasa BCV', ancho: 11, fmt: '#,##0.0000' },
    { titulo: 'Monto ($)', ancho: 14, fmt: FMT_USD },
  ];
  const { ws } = hojaConMarca(wb, 'Gastos', marca, `Relación de gastos · ${mesLargo(periodo)}`, cols, o);
  const gs = [...gastos].sort((a, b) => a.categoria.localeCompare(b.categoria));
  const fin = agregarFilas(ws, cols, gs.map((g) => [g.categoria, g.descripcion, g.tipo === 'comun' ? 'Común' : g.tipo === 'no_comun' ? 'No común' : 'Partida',
    fechaXl(g.fechaGasto), g.moneda === 'USD' ? '$' : 'Bs', g.monto, g.tasaBcv, g.montoUsd]));
  filaTotal(ws, cols, fin, 8, fin - 1, [8]);
  pie(ws, fin, o.codigo);

  // Resumen por categoría (valores, sin fórmulas de búsqueda)
  const colsC: Col[] = [{ titulo: 'Categoría', ancho: 24 }, { titulo: 'Gastos', ancho: 10, fmt: '0' }, { titulo: 'Total ($)', ancho: 16, fmt: FMT_USD }, { titulo: '% del mes', ancho: 12, fmt: FMT_PCT }];
  const r = hojaConMarca(wb, 'Por categoría', marca, `Resumen por categoría · ${mesLargo(periodo)}`, colsC, o);
  const total = gastos.reduce((s, g) => s + g.montoUsd, 0) || 1;
  const cats = new Map<string, Gasto[]>();
  gastos.forEach((g) => cats.set(g.categoria, [...(cats.get(g.categoria) ?? []), g]));
  const filas = [...cats.entries()].map(([c, xs]) => {
    const t = r2(xs.reduce((s, g) => s + g.montoUsd, 0));
    return [c, xs.length, t, r2(100 * t / total)] as (string | number)[];
  }).sort((a, b) => (b[2] as number) - (a[2] as number));
  const finC = agregarFilas(r.ws, colsC, filas);
  filaTotal(r.ws, colsC, finC, 8, finC - 1, [2, 3]);
  pie(r.ws, finC, o.codigo);
  return bytes(wb);
}

// ---------------- Morosidad ----------------
export async function morosidadXlsx(marca: MarcaDoc, unidades: UnidadConSaldo[], o: OpcionesDoc = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const t = o.tasaBcv ?? null;
  const cols: Col[] = [
    { titulo: 'Unidad', ancho: 10 }, { titulo: 'Propietario', ancho: 28 }, { titulo: 'Alícuota', ancho: 10, fmt: FMT_PCT },
    { titulo: 'Facturado ($)', ancho: 15, fmt: FMT_USD }, { titulo: 'Pagado ($)', ancho: 15, fmt: FMT_USD },
    { titulo: 'Saldo ($)', ancho: 15, fmt: FMT_USD }, ...(t ? [{ titulo: 'Saldo (Bs)', ancho: 18, fmt: FMT_BS }] : []),
  ];
  const { ws } = hojaConMarca(wb, 'Morosidad', marca, 'Reporte de morosidad', cols, o);
  const morosas = unidades.filter((u) => u.saldoUsd > 0.009).sort((a, b) => b.saldoUsd - a.saldoUsd);
  const fin = agregarFilas(ws, cols, morosas.map((u) => [etiquetaUnidad(u), u.propietario ?? '', u.alicuota, u.cargosUsd, u.pagadoUsd, u.saldoUsd, ...(t ? [r2(u.saldoUsd * t)] : [])]));
  // Resaltar saldos en rojo
  for (let i = 8; i < fin; i++) ws.getCell(i, 6).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFB42318' } };
  filaTotal(ws, cols, fin, 8, fin - 1, t ? [4, 5, 6, 7] : [4, 5, 6]);
  const n = ws.getCell(fin + 1, 1);
  n.value = `${morosas.length} de ${unidades.length} unidades con saldo pendiente${t ? ` · tasa BCV ${t.toLocaleString('es-VE')} Bs/$` : ''}`;
  n.font = { name: 'Arial', size: 9 };
  pie(ws, fin + 1, o.codigo);
  return bytes(wb);
}
