// Genera muestras de todas las plantillas con datos ficticios del condominio demo.
// Uso:  npx tsx scripts/muestras-documentos.ts   → /home/claude/condominio/docs/muestras/ (o la carpeta que se pase como argumento)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Cargo, CuentaFinanciera, EstadoCuenta, FilaActa, Gasto, Pago, Partida, Unidad, UnidadConSaldo } from '../src/data/tipos';
import {
  actaVotacionPdf, estadoCuentaPdf, estadoCuentaXlsx, morosidadXlsx, reciboPdf, relacionGastosPdf, relacionGastosXlsx,
  sha256, solvenciaPdf, type MarcaDoc,
} from '../src/documentos';

const aqui = dirname(fileURLToPath(import.meta.url));
const SALIDA = resolve(process.argv[2] ?? join(aqui, '../../docs/muestras'));
mkdirSync(SALIDA, { recursive: true });

const TASA = 215.5;
const SEP = '2026-09-01', OCT = '2026-10-01';
const r2 = (x: number) => Math.round(x * 100) / 100;

const marca: MarcaDoc = {
  nombre: 'Residencias Los Samanes',
  nombreAsociacion: 'Asociación Civil de Propietarios Residencias Los Samanes',
  rif: 'J-00000000-0', direccion: 'Av. Las Delicias, Urb. El Limón', ciudad: 'Maracay, Aragua',
  telefono: '0243-000.00.00', correo: 'junta@lossamanes.demo',
  colorPrimario: '#0f4c4a', logoUrl: null, fotoEntradaUrl: null,
  logo: { bytes: new Uint8Array(readFileSync(join(aqui, '../public/demo/logo.png'))), tipo: 'png' },
  fotoEntrada: { bytes: new Uint8Array(readFileSync(join(aqui, '../public/demo/entrada.jpg'))), tipo: 'jpg' },
};

const unidades: Unidad[] = ([
  ['A', '11', 11, 'Familia Pérez'], ['A', '12', 11, 'Carlos Rivas'], ['A', '13', 13, 'Ana Gómez'], ['A', '14', 13, 'Luis Medina'],
  ['B', '31', 12, 'Rosa Herrera'], ['B', '32', 12, 'José Blanco'], ['B', '33', 14, 'Elena Castro'], ['B', '34', 14, 'Pedro Salas'],
] as const).map(([bloque, numero, alicuota, propietario]) => ({ id: `u-${bloque}${numero}`, bloque, numero, alicuota, propietario }));

// Gastos comunes: $1.000/mes; fondo de reserva 10 %; impermeabilización $2.400 en 4 cuotas desde septiembre.
const gastos: Gasto[] = [
  ['Vigilancia', 'Servicio de vigilancia 24 h (Seguridad Aragua C.A.)', 'USD', 600],
  ['Conserjería', 'Conserje: sueldo y bono de alimentación', 'USD', 250],
  ['Electricidad', 'Corpoelec áreas comunes y bombas', 'VES', 21550],
  ['Mantenimiento', 'Mantenimiento preventivo de bomba de agua', 'USD', 50],
].map(([categoria, descripcion, moneda, monto], i) => ({
  id: `g${i}`, periodo: OCT, tipo: 'comun' as const, categoria: categoria as string, descripcion: descripcion as string,
  moneda: moneda as 'USD' | 'VES', monto: monto as number, tasaBcv: moneda === 'VES' ? TASA : null,
  montoUsd: moneda === 'VES' ? r2((monto as number) / TASA) : (monto as number),
  fechaGasto: '2026-10-0' + (i + 2), facturaUrl: null, unidadId: null, partidaId: null, cuentaId: null,
}));
gastos.push({ id: 'g9', periodo: OCT, tipo: 'partida', categoria: 'Impermeabilización', descripcion: 'Anticipo 2/4 a Impermeabilizaciones del Centro', moneda: 'USD',
  monto: 600, tasaBcv: null, montoUsd: 600, fechaGasto: '2026-10-15', facturaUrl: null, unidadId: null, partidaId: 'p1', cuentaId: null });

function cargosDe(u: Unidad): Cargo[] {
  return [SEP, OCT].flatMap((p, k) => [
    { id: `${u.id}-o${k}`, unidadId: u.id, periodo: p, tipo: 'ordinaria' as const, concepto: `Gastos comunes ${p.slice(5, 7)}/${p.slice(0, 4)}`, montoUsd: r2(1000 * u.alicuota / 100) },
    { id: `${u.id}-f${k}`, unidadId: u.id, periodo: p, tipo: 'fondo_reserva' as const, concepto: 'Fondo de reserva 10 %', montoUsd: r2(100 * u.alicuota / 100) },
    { id: `${u.id}-e${k}`, unidadId: u.id, periodo: p, tipo: 'extraordinaria' as const, concepto: `Impermeabilización techo Bloque A (cuota ${k + 1}/4)`, montoUsd: r2(600 * u.alicuota / 100) },
  ]);
}
const b33 = unidades.find((u) => u.numero === '33')!;
const cargosB33 = cargosDe(b33);
const sepB33 = r2(cargosB33.filter((c) => c.periodo === SEP).reduce((s, c) => s + c.montoUsd, 0));
const pagosB33: Pago[] = [
  { id: 'p1', unidadId: b33.id, unidadEtiqueta: 'B-33', fechaPago: '2026-09-06', metodo: 'pago_movil', moneda: 'VES', monto: r2(sepB33 * 198.2),
    tasaBcv: 198.2, montoUsd: sepB33, referencia: '00045123', bancoOrigen: 'Banesco', comprobanteUrl: null, nota: null, estado: 'confirmado', motivoRechazo: null, creadoEn: '2026-09-06' },
  { id: 'p2', unidadId: b33.id, unidadEtiqueta: 'B-33', fechaPago: '2026-10-27', metodo: 'pago_movil', moneda: 'VES', monto: 10775, tasaBcv: TASA,
    montoUsd: 50, referencia: '55551234', bancoOrigen: 'Mercantil', comprobanteUrl: null, nota: null, estado: 'reportado', motivoRechazo: null, creadoEn: '2026-10-27' },
];
const saldo = (cs: Cargo[], ps: Pago[]) => r2(cs.reduce((s, c) => s + c.montoUsd, 0) - ps.filter((p) => p.estado === 'confirmado').reduce((s, p) => s + p.montoUsd, 0));
const ecB33: EstadoCuenta = { unidad: b33, cargos: cargosB33, pagos: pagosB33, saldoUsd: saldo(cargosB33, pagosB33) };

// Unidad al día para la solvencia
const a13 = unidades.find((u) => u.numero === '13')!;

const conSaldo: UnidadConSaldo[] = unidades.map((u, i) => {
  const cargos = r2(cargosDe(u).reduce((s, c) => s + c.montoUsd, 0));
  const pagado = [0, 2, 4].includes(i) ? cargos : [3, 6].includes(i) ? r2(cargos / 2) : 0;
  return { ...u, cargosUsd: cargos, pagadoUsd: pagado, saldoUsd: r2(cargos - pagado) };
});

const votos: Record<string, string | null> = { '11': 'Aprobar', '12': 'Rechazar', '13': 'Aprobar', '14': null, '31': 'Aprobar', '32': 'Aprobar', '33': 'Aprobar', '34': 'Rechazar' };
const filasActa: FilaActa[] = unidades.map((u) => ({
  unidad: `${u.bloque}-${u.numero}`, propietario: u.propietario, alicuota: u.alicuota, opcion: votos[u.numero],
  emitidoEn: votos[u.numero] ? '2026-10-2' + (Number(u.numero) % 7) + 'T19:30:00' : null,
  votante: votos[u.numero] ? u.propietario : null,
}));
const peso = (op: string) => filasActa.filter((f) => f.opcion === op).reduce((s, f) => s + f.alicuota, 0);
const partida: Partida = {
  id: 'p2', titulo: 'Pintura de fachada Bloque B', descripcion: 'Pintura exterior y reparación de grietas. Se recibieron 3 presupuestos; se propone el más bajo (Pinturas Maracay, $3.000).',
  presupuestoUsd: 3000, numeroCuotas: 3, primeraCuota: '2026-11-01', reparto: 'alicuota', estado: 'aprobada', creadoEn: '2026-10-15', cuotaMiUnidadUsd: null,
  votacion: {
    id: 'v1', titulo: '¿Aprueba la pintura de la fachada del Bloque B?', ponderacion: 'alicuota', umbralPct: 50.01, estado: 'cerrada', cierraEn: '2026-10-27', miVotoOpcionId: null,
    opciones: [
      { id: 'o1', texto: 'Aprobar', orden: 0, unidades: filasActa.filter((f) => f.opcion === 'Aprobar').length, pesoPct: peso('Aprobar') },
      { id: 'o2', texto: 'Rechazar', orden: 1, unidades: filasActa.filter((f) => f.opcion === 'Rechazar').length, pesoPct: peso('Rechazar') },
    ],
  },
};
const cuentas: CuentaFinanciera[] = [
  { id: 'c1', nombre: 'Pago Móvil (Bs)', tipo: 'banco_bs', moneda: 'VES', datosPago: 'Banco 0102 · 0414-0000000 · RIF J-00000000-0' },
  { id: 'c2', nombre: 'Zelle', tipo: 'zelle', moneda: 'USD', datosPago: 'junta@lossamanes.demo · Residencias Los Samanes' },
];

const fecha = new Date('2026-10-27T15:00:00');
const muestras: [string, Promise<Uint8Array>][] = [
  ['estado_cuenta_B-33.pdf', estadoCuentaPdf(marca, ecB33, { codigo: 'HYSQ7Y4JCW', tasaBcv: TASA, fecha })],
  ['estado_cuenta_B-33.xlsx', estadoCuentaXlsx(marca, ecB33, { codigo: 'HYSQ7Y4JCW', tasaBcv: TASA, fecha })],
  ['recibo_B-33_octubre_2026.pdf', reciboPdf(marca, ecB33, OCT, { codigo: 'RC8K2M4PQA', tasaBcv: TASA, fecha, vence: '2026-11-05', cuentas })],
  ['solvencia_A-13.pdf', solvenciaPdf(marca, { unidad: a13, codigo: 'SLV3NQ8T2K', vigenteHasta: '2026-10-31', firmante: 'María Fernández · Presidenta' }, { fecha })],
  ['relacion_gastos_octubre_2026.pdf', relacionGastosPdf(marca, OCT, gastos, { codigo: 'GT5W9R2HZE', fecha, fondoReservaPct: 10 })],
  ['relacion_gastos_octubre_2026.xlsx', relacionGastosXlsx(marca, OCT, gastos, { codigo: 'GT5W9R2HZE', fecha })],
  ['acta_votacion_pintura_bloque_B.pdf', actaVotacionPdf(marca, partida, filasActa, { codigo: 'AC4X7M2NVB', fecha, lugar: 'Maracay, estado Aragua' })],
  ['morosidad_octubre_2026.xlsx', morosidadXlsx(marca, conSaldo, { codigo: 'MR6Y3T8KLD', tasaBcv: TASA, fecha })],
];
for (const [nombre, p] of muestras) {
  const bytes = await p;
  writeFileSync(join(SALIDA, nombre), bytes);
  console.log(`${nombre.padEnd(40)} ${String(bytes.length).padStart(8)} bytes  sha256 ${(await sha256(bytes)).slice(0, 16)}…`);
}
console.log(`\nMuestras en ${SALIDA}`);
