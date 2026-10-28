// Plantillas PDF con la marca del condominio.
import type { Cargo, CuentaFinanciera, EstadoCuenta, FilaActa, Gasto, Partida, Unidad } from '../data/tipos';
import {
  ESTADO_PAGO, METODOS, TIPO_CARGO, URL_VERIFICAR, bs, etiquetaUnidad, fechaCorta, fechaLarga, mesLargo, pct, r2, usd,
  type MarcaDoc, type OpcionesDoc,
} from './comun';
import { Lienzo, type FilaTabla } from './pdf';

const suma = (xs: { montoUsd: number }[]) => r2(xs.reduce((s, x) => s + x.montoUsd, 0));
function porPeriodo(cargos: Cargo[]) {
  const m = new Map<string, Cargo[]>();
  [...cargos].sort((a, b) => b.periodo.localeCompare(a.periodo)).forEach((c) => m.set(c.periodo, [...(m.get(c.periodo) ?? []), c]));
  return m;
}
const unidadTxt = (u: Unidad) =>
  `Unidad ${etiquetaUnidad(u)}${u.propietario ? ` · ${u.propietario}` : ''} · alícuota ${pct(u.alicuota)}`;

// ---------------- Estado de cuenta ----------------
export async function estadoCuentaPdf(marca: MarcaDoc, e: EstadoCuenta, o: OpcionesDoc = {}): Promise<Uint8Array> {
  const l = await Lienzo.crear(marca, { titulo: 'Estado de cuenta', subtitulo: unidadTxt(e.unidad), codigo: o.codigo, fecha: o.fecha, banda: true });
  const confirmados = e.pagos.filter((p) => p.estado === 'confirmado');
  const pendientes = e.pagos.filter((p) => p.estado === 'reportado');
  const debe = e.saldoUsd > 0.009;
  l.cifras([
    { etiqueta: 'Total facturado', valor: usd(suma(e.cargos)) },
    { etiqueta: 'Pagos confirmados', valor: usd(suma(confirmados)) },
    {
      etiqueta: debe ? 'Saldo pendiente' : e.saldoUsd < -0.009 ? 'Saldo a favor' : 'Estado',
      valor: debe || e.saldoUsd < -0.009 ? usd(Math.abs(e.saldoUsd)) : 'Solvente',
      nota: debe && o.tasaBcv ? `= ${bs(e.saldoUsd * o.tasaBcv)} (tasa BCV ${o.tasaBcv.toLocaleString('es-VE')})` : undefined,
      destacar: true,
    },
  ]);

  l.seccion('Recibos por mes');
  const filas: FilaTabla[] = [];
  for (const [periodo, cs] of porPeriodo(e.cargos)) {
    cs.forEach((c, i) => filas.push({ celdas: [i === 0 ? mesLargo(periodo) : '', c.concepto, TIPO_CARGO[c.tipo] ?? c.tipo, usd(c.montoUsd)] }));
    filas.push({ celdas: ['', `Total ${mesLargo(periodo)}`, '', usd(suma(cs))], negrita: true, fondo: 'marca' });
  }
  if (filas.length) l.tabla([
    { titulo: 'Mes', ancho: 0.2 }, { titulo: 'Concepto', ancho: 0.45 }, { titulo: 'Tipo', ancho: 0.2 }, { titulo: 'Monto', ancho: 0.15, alinear: 'der' },
  ], filas);
  else l.parrafo('Aún no hay recibos emitidos.', { color: 'gris' });

  l.seccion('Pagos');
  if (e.pagos.length) l.tabla([
    { titulo: 'Fecha', ancho: 0.13 }, { titulo: 'Método', ancho: 0.16 }, { titulo: 'Referencia', ancho: 0.17 },
    { titulo: 'Monto', ancho: 0.2, alinear: 'der' }, { titulo: 'Equivale', ancho: 0.15, alinear: 'der' }, { titulo: 'Estado', ancho: 0.19 },
  ], [...e.pagos].sort((a, b) => b.fechaPago.localeCompare(a.fechaPago)).map((p) => ({
    celdas: [fechaCorta(p.fechaPago), METODOS[p.metodo] ?? p.metodo, p.referencia ?? '-',
      p.moneda === 'USD' ? usd(p.monto) : bs(p.monto), usd(p.montoUsd), ESTADO_PAGO[p.estado] ?? p.estado],
  })));
  else l.parrafo('No hay pagos registrados.', { color: 'gris' });

  if (pendientes.length) l.parrafo(`Hay ${pendientes.length} pago(s) por confirmar por un total de ${usd(suma(pendientes))}. Se descuentan del saldo cuando Tesorería los verifica en el banco.`, { tam: 8.5, color: 'gris' });
  l.parrafo('Montos expresados en dólares (moneda de cuenta). Los pagos en bolívares se convierten a la tasa oficial del BCV del día del pago.', { tam: 8, color: 'gris' });
  return l.terminar();
}

// ---------------- Recibo mensual ----------------
export async function reciboPdf(marca: MarcaDoc, e: EstadoCuenta, periodo: string,
  o: OpcionesDoc & { vence?: string; cuentas?: CuentaFinanciera[] } = {}): Promise<Uint8Array> {
  const l = await Lienzo.crear(marca, { titulo: 'Recibo de condominio', subtitulo: `${mesLargo(periodo)} · ${unidadTxt(e.unidad)}`, codigo: o.codigo, fecha: o.fecha });
  const delMes = e.cargos.filter((c) => c.periodo === periodo);
  const totalMes = suma(delMes);
  const anterior = r2(e.saldoUsd - totalMes);
  l.cifras([
    { etiqueta: 'Este mes', valor: usd(totalMes) },
    { etiqueta: anterior >= 0 ? 'Saldo anterior' : 'Saldo a favor anterior', valor: usd(Math.abs(anterior)) },
    {
      etiqueta: 'Total a pagar', valor: usd(Math.max(0, e.saldoUsd)), destacar: true,
      nota: o.tasaBcv && e.saldoUsd > 0 ? `= ${bs(e.saldoUsd * o.tasaBcv)} a tasa BCV` : o.vence ? `Vence: ${fechaCorta(o.vence)}` : undefined,
    },
  ]);
  l.seccion('Detalle del mes');
  l.tabla([{ titulo: 'Concepto', ancho: 0.55 }, { titulo: 'Tipo', ancho: 0.25 }, { titulo: 'Monto', ancho: 0.2, alinear: 'der' }],
    [...delMes.map((c) => ({ celdas: [c.concepto, TIPO_CARGO[c.tipo] ?? c.tipo, usd(c.montoUsd)] })),
     { celdas: ['Total del mes', '', usd(totalMes)], negrita: true, fondo: 'marca' as const }]);
  if (o.vence) l.parrafo(`Fecha de vencimiento: ${fechaCorta(o.vence)}.`, { negrita: true, tam: 9 });
  if (o.cuentas?.length) {
    l.seccion('Dónde pagar');
    for (const c of o.cuentas) l.parrafo(`${c.nombre}: ${c.datosPago ?? ''}`, { tam: 9 });
    l.parrafo('Después de pagar, reporte el pago en la app ZPro Condominio con la referencia y la captura del comprobante.', { tam: 8.5, color: 'gris' });
  }
  return l.terminar();
}

// ---------------- Solvencia ----------------
export interface DatosSolvencia {
  unidad: Unidad;
  codigo: string;               // de api.emitirSolvencia()
  vigenteHasta: string;         // AAAA-MM-DD
  firmante?: string;            // "María Fernández, Presidenta"
}
export async function solvenciaPdf(marca: MarcaDoc, d: DatosSolvencia, o: OpcionesDoc = {}): Promise<Uint8Array> {
  const fecha = o.fecha ?? new Date();
  const l = await Lienzo.crear(marca, { titulo: 'Constancia de solvencia', codigo: d.codigo, fecha, banda: true });
  l.y -= 16;
  l.parrafo('CONSTANCIA DE SOLVENCIA', { tam: 20, negrita: true, color: 'marca', centrado: true });
  l.y -= 14;
  const u = d.unidad;
  l.parrafo(
    `La Junta de Condominio de ${marca.nombre}${marca.rif ? `, RIF ${marca.rif}` : ''}, hace constar que la unidad ${etiquetaUnidad(u)}` +
    `${u.propietario ? `, cuyo propietario es ${u.propietario},` : ''} con una alícuota de ${pct(u.alicuota)}, se encuentra SOLVENTE ` +
    `con sus obligaciones de condominio a la fecha de ${fechaLarga(fecha)}.`,
    { tam: 11.5, interlineado: 1.6 });
  l.y -= 6;
  l.parrafo(`Esta constancia es válida hasta el ${fechaCorta(d.vigenteHasta)}.`, { tam: 11, negrita: true });
  l.y -= 24;
  // QR + instrucciones
  l.espacio(130);
  const lado = 110, top = l.y;
  l.qr(`${URL_VERIFICAR}/${d.codigo}`, l.izq, top, lado);
  const x = l.izq + lado + 18, ancho = l.ancho - lado - 18;
  l.y = top - 4;
  l.parrafo('Verificación', { x, ancho, negrita: true, tam: 11 });
  l.parrafo(`Escanee el código QR o ingrese en zentapro.com/verificar el código:`, { x, ancho, tam: 9.5 });
  l.y -= 2;
  l.parrafo(d.codigo.replace(/(.{5})(.{5})/, '$1 $2'), { x, ancho, negrita: true, tam: 20, color: 'marca' });
  l.y -= 2;
  l.parrafo('La verificación muestra si la constancia es auténtica y si sigue vigente. No requiere cuenta.', { x, ancho, tam: 8.5, color: 'gris' });
  l.y = Math.min(l.y, top - lado - 10);
  l.firmas([d.firmante ?? 'Presidente(a) de la Junta de Condominio'], true);
  return l.terminar();
}

// ---------------- Relación de gastos (PDF) ----------------
export async function relacionGastosPdf(marca: MarcaDoc, periodo: string, gastos: Gasto[], o: OpcionesDoc & { fondoReservaPct?: number } = {}): Promise<Uint8Array> {
  const l = await Lienzo.crear(marca, { titulo: 'Relación de gastos', subtitulo: mesLargo(periodo), codigo: o.codigo, fecha: o.fecha });
  const comunes = gastos.filter((g) => g.tipo === 'comun');
  const total = suma(gastos), totalComun = suma(comunes);
  const fondo = o.fondoReservaPct ? r2(totalComun * o.fondoReservaPct / 100) : null;
  l.cifras([
    { etiqueta: 'Gastos comunes', valor: usd(totalComun) },
    ...(fondo != null ? [{ etiqueta: `Fondo de reserva ${pct(o.fondoReservaPct!)}`, valor: usd(fondo) }] : []),
    { etiqueta: 'Total del mes', valor: usd(total), destacar: true },
  ]);
  const cats = new Map<string, Gasto[]>();
  gastos.forEach((g) => cats.set(g.categoria, [...(cats.get(g.categoria) ?? []), g]));
  l.seccion('Por categoría');
  const filas: FilaTabla[] = [];
  for (const [cat, gs] of [...cats.entries()].sort((a, b) => suma(b[1]) - suma(a[1]))) {
    gs.forEach((g, i) => filas.push({ celdas: [i === 0 ? cat : '', g.descripcion, g.tipo === 'comun' ? 'Común' : g.tipo === 'no_comun' ? 'No común' : 'Partida',
      g.moneda === 'VES' ? bs(g.monto) : usd(g.monto), g.tasaBcv ? g.tasaBcv.toLocaleString('es-VE') : '-', usd(g.montoUsd)] }));
    if (gs.length > 1) filas.push({ celdas: ['', `Subtotal ${cat}`, '', '', '', usd(suma(gs))], negrita: true, fondo: 'marca' });
  }
  filas.push({ celdas: ['TOTAL', '', '', '', '', usd(total)], negrita: true, fondo: 'marca' });
  l.tabla([
    { titulo: 'Categoría', ancho: 0.15 }, { titulo: 'Descripción', ancho: 0.38 }, { titulo: 'Tipo', ancho: 0.09 },
    { titulo: 'Monto', ancho: 0.15, alinear: 'der' }, { titulo: 'Tasa', ancho: 0.09, alinear: 'der' }, { titulo: 'En $', ancho: 0.14, alinear: 'der' },
  ], filas);
  l.parrafo('Las facturas de cada gasto están disponibles para los propietarios en la app.', { tam: 8, color: 'gris' });
  return l.terminar();
}

// ---------------- Acta de votación (para firma y sello) ----------------
export async function actaVotacionPdf(marca: MarcaDoc, p: Partida, filas: FilaActa[],
  o: OpcionesDoc & { lugar?: string; firmantes?: string[] } = {}): Promise<Uint8Array> {
  const fecha = o.fecha ?? new Date();
  const v = p.votacion;
  const l = await Lienzo.crear(marca, { titulo: 'Acta de votación', subtitulo: v?.titulo ?? p.titulo, codigo: o.codigo, fecha, banda: true });
  const lugar = o.lugar ?? marca.ciudad ?? '';
  l.parrafo(
    `En ${lugar ? lugar + ', ' : ''}a los ${fechaLarga(fecha).replace(/^(\d+) de /, '$1 días del mes de ')}, la Junta de Condominio de ${marca.nombre} ` +
    `deja constancia del resultado de la consulta a los propietarios realizada por medios electrónicos a través de la aplicación ZPro Condominio, ` +
    `sobre la partida especial que se describe a continuación.`, { tam: 9.5, interlineado: 1.5 });

  l.seccion('Partida especial');
  l.tabla([{ titulo: 'Concepto', ancho: 0.3 }, { titulo: 'Detalle', ancho: 0.7 }], [
    { celdas: ['Título', p.titulo] },
    { celdas: ['Presupuesto', usd(p.presupuestoUsd)] },
    { celdas: ['Forma de pago', `${p.numeroCuotas} cuota(s)${p.primeraCuota ? ` desde ${mesLargo(p.primeraCuota)}` : ''} · reparto ${p.reparto === 'alicuota' ? 'por alícuota' : 'en partes iguales'}`] },
  ]);
  if (p.descripcion) l.parrafo(p.descripcion, { tam: 9, color: 'gris' });

  const total = filas.length, votaron = filas.filter((f) => f.opcion).length;
  const alicVoto = r2(filas.filter((f) => f.opcion).reduce((s, f) => s + f.alicuota, 0));
  const aprobar = v?.opciones.find((x) => x.orden === 0);
  const aprobada = p.estado === 'aprobada' || p.estado === 'en_ejecucion' || p.estado === 'cerrada'
    ? true : p.estado === 'rechazada' ? false : null;

  l.seccion('Resultado');
  l.cifras([
    { etiqueta: 'Participación', valor: `${votaron} de ${total}`, nota: `${pct(alicVoto)} de las alícuotas` },
    { etiqueta: 'Mayoría requerida', valor: v ? pct(v.umbralPct) : '-', nota: v?.ponderacion === 'unidad' ? 'un voto por unidad' : 'ponderada por alícuota' },
    {
      etiqueta: 'Decisión', destacar: true,
      valor: aprobada === true ? 'APROBADA' : aprobada === false ? 'RECHAZADA' : 'EN CURSO',
      nota: aprobar ? `Aprobar: ${pct(aprobar.pesoPct)} del total` : undefined,
    },
  ]);
  if (v) l.tabla([{ titulo: 'Opción', ancho: 0.5 }, { titulo: 'Unidades', ancho: 0.2, alinear: 'der' }, { titulo: 'Peso sobre el total', ancho: 0.3, alinear: 'der' }],
    [...v.opciones].sort((a, b) => a.orden - b.orden).map((x) => ({ celdas: [x.texto, String(x.unidades), pct(x.pesoPct)] })));

  l.seccion('Votos por unidad');
  l.tabla([
    { titulo: 'Unidad', ancho: 0.12 }, { titulo: 'Propietario', ancho: 0.27 }, { titulo: 'Alícuota', ancho: 0.11, alinear: 'der' },
    { titulo: 'Voto', ancho: 0.14 }, { titulo: 'Emitido por', ancho: 0.2 }, { titulo: 'Fecha', ancho: 0.16 },
  ], filas.map((f) => ({ celdas: [f.unidad, f.propietario ?? '-', pct(f.alicuota), f.opcion ?? 'No votó', f.votante ?? '-', f.emitidoEn ? fechaCorta(f.emitidoEn) : '-'] })), { tam: 8 });

  l.parrafo('Nota: la validez de esta votación como consulta por escrito depende de lo establecido en el documento de condominio y en la Ley de Propiedad Horizontal. ' +
    'El registro electrónico de cada voto (fecha, hora y usuario) se conserva en el sistema y puede verificarse con el código de este documento.', { tam: 7.5, color: 'gris' });
  l.firmas(o.firmantes ?? ['Presidente(a)', 'Secretario(a) / Tesorero(a)', 'Testigo'], true);
  return l.terminar();
}
