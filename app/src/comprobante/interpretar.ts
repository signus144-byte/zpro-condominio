// Interpreta el texto de la captura de un pago (Pago Móvil, transferencia) de cualquier banco venezolano:
// referencia, monto, fecha, banco de origen y a qué teléfono / cédula / cuenta se pagó. Funciona con el texto
// que devuelve el lector (OCR), que trae errores típicos: "O" por "0", "l" por "1", espacios de más.
import { BANCOS, digitos, normalizarDocumento, normalizarTelefono } from '../bancos';

export interface LecturaComprobante {
  referencia: string | null;
  monto: number | null;
  fecha: string | null;            // AAAA-MM-DD
  bancoOrigen: string | null;      // código de 4 dígitos
  bancoDestino: string | null;
  telefonos: string[];             // 04141234567 (todos los que aparecen)
  documentos: string[];            // V12345678, J301234567
  cuentas: string[];               // números de 20 dígitos completos
  texto: string;
}

/** Nombres con que los bancos aparecen en los comprobantes (sin acentos, en mayúsculas). */
const ALIAS: [string, RegExp][] = [
  ['0102', /\b(BANCO DE VENEZUELA|BDV)\b/],
  ['0104', /\bVENEZOLANO DE CREDITO\b/],
  ['0105', /\b(MERCANTIL|TPAGO)\b/],
  ['0108', /\b(PROVINCIAL|BBVA)\b/],
  ['0114', /\bBANCARIBE\b/],
  ['0115', /\bBANCO EXTERIOR\b|\bEXTERIOR\b/],
  ['0128', /\bCARONI\b/],
  ['0134', /\bBANESCO\b/],
  ['0137', /\bSOFITASA\b/],
  ['0138', /\bBANCO PLAZA\b/],
  ['0146', /\bBANGENTE\b/],
  ['0151', /\b(BFC|FONDO COMUN)\b/],
  ['0156', /\b100 ?% ?BANCO\b/],
  ['0157', /\bDEL ?SUR\b/],
  ['0163', /\bBANCO DEL TESORO\b|\bTESORO\b/],
  ['0166', /\bBANCO AGRICOLA\b/],
  ['0168', /\bBANCRECER\b/],
  ['0169', /\b(R4|MI BANCO)\b/],
  ['0171', /\bBANCO ACTIVO\b/],
  ['0172', /\bBANCAMIGA\b/],
  ['0173', /\bBANCO INTERNACIONAL DE DESARROLLO\b/],
  ['0174', /\bBANPLUS\b/],
  ['0175', /\b(BICENTENARIO|DIGITAL DE LOS TRABAJADORES)\b/],
  ['0177', /\bBANFANB\b/],
  ['0178', /\bN58\b/],
  ['0191', /\b(BNC|NACIONAL DE CREDITO)\b/],
];
const CODIGOS = new Set(BANCOS.map((b) => b.codigo));

const MESES: Record<string, number> = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12 };

/** Mayúsculas, sin acentos, y arregla letras que el OCR confunde con números dentro de cifras. */
function normalizar(texto: string) {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[“”«»]/g, '"')
    .replace(/(?<=\d)[O](?=\d)|(?<=\d)[O]\b|\b[O](?=\d)/g, '0')
    .replace(/\b([VEJGP])([-.\s]?)([O0-9][O0-9.\s-]{4,})/g, (_m, l: string, sep: string, n: string) => l + sep + n.replace(/O/g, '0'))
    .replace(/\b[G8](?=AN(?:CO|ESCO|CAMIGA|PLUS|CARIBE|GENTE|FANB|CRECER)\b)/g, 'B')
    .replace(/(?<=\d)[IL|](?=\d)/g, '1')
    .replace(/[ \t]+/g, ' ');
}

/** "2.000,00" → 2000 · "2,000.00" → 2000 · "2000,5" → 2000.5 · "75393,22" → 75393.22 */
export function leerMonto(s: string): number | null {
  const t = s.replace(/\s/g, '');
  if (!/\d/.test(t)) return null;
  let n: number;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t) || /^\d+,\d{1,2}$/.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(t)) n = Number(t.replace(/,/g, ''));
  else if (/^\d+\.\d{1,2}$/.test(t)) n = Number(t);
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ''));
  else if (/^\d+$/.test(t)) n = Number(t);
  else return null;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const NUM_MONTO = String.raw`\d{1,3}(?:\.\d{3})+,\d{1,2}|\d{1,3}(?:,\d{3})+\.\d{1,2}|\d+,\d{2}|\d+\.\d{2}`;

/** Busca el valor que acompaña a una etiqueta: en la misma línea o, si la etiqueta está sola, en la siguiente. */
function trasEtiqueta(lineas: string[], etiqueta: RegExp, valor: RegExp): string | null {
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(etiqueta);
    if (!m) continue;
    const resto = lineas[i].slice((m.index ?? 0) + m[0].length);
    const v = resto.match(valor) ?? (lineas[i + 1] ?? '').match(valor);
    if (v) return v[1] ?? v[0];
  }
  return null;
}

function fechaIso(d: number, m: number, a: number): string | null {
  if (a < 100) a += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2020 || a > 2100) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function interpretarComprobante(textoOriginal: string, hoy = new Date()): LecturaComprobante {
  const texto = normalizar(textoOriginal);
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // ---------- Teléfonos, documentos y cuentas ----------
  const telefonos = new Set<string>();
  for (const m of texto.matchAll(/(?<![\d.,])(?:\+?58[\s-]?)?\(?0?4\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?![\d,])/g)) {
    const t = normalizarTelefono(m[0]);
    if (t) telefonos.add(t);
  }
  const documentos = new Set<string>();
  for (const m of texto.matchAll(/\b([VEJGP])[\s.:-]{0,3}(\d{1,3}(?:[.\s]?\d{3}){1,2}(?:[\s-]?\d)?)\b/g)) {
    const d = normalizarDocumento(m[1] + digitos(m[2]));
    if (d) documentos.add(d);
  }
  const cuentas = new Set<string>();
  for (const m of texto.matchAll(/\b01\d{2}[\s-]?\d{4}[\s-]?\d{2}[\s-]?\d{10}\b/g)) cuentas.add(digitos(m[0]));

  // ---------- Monto ----------
  let monto: number | null = null;
  const etiquetaMonto = /\b(MONTO(?: (?:TOTAL|DEBITADO|PAGADO|ENVIADO|DE LA OPERACION|TRANSFERIDO))?|IMPORTE|TOTAL(?: PAGADO)?|CANTIDAD|HAS PAGADO|PAGASTE)\b/;
  const v = trasEtiqueta(lineas, etiquetaMonto, new RegExp(`(?:BS\\.?S?\\s*|VES\\s*)?(${NUM_MONTO})`));
  if (v) monto = leerMonto(v);
  if (monto == null) {
    // Cifra pegada a "Bs" (antes o después).
    const conBs = [...texto.matchAll(new RegExp(`(?:BS\\.?S?|VES)\\s*(${NUM_MONTO})|(${NUM_MONTO})\\s*(?:BS\\.?S?|VES)\\b`, 'g'))]
      .map((m) => leerMonto(m[1] ?? m[2])).filter((x): x is number => x != null);
    if (conBs.length) monto = Math.max(...conBs);
  }

  // ---------- Referencia ----------
  const etiquetaRef = /\b(N(?:RO|UMERO|°|º|O)?\.?\s*(?:DE\s*)?(?:REFERENCIA|REF|OPERACION|COMPROBANTE|CONFIRMACION|TRANSACCION)|REFERENCIA(?: BANCARIA)?|REF\.?|OPERACION(?: N(?:RO|°|º)?\.?)?|COMPROBANTE(?: N(?:RO|°|º)?\.?)?|SECUENCIA|NRO\.? DE OPERACION|ID DE (?:LA )?TRANSACCION)\b/;
  let referencia = trasEtiqueta(lineas, etiquetaRef, /[:#\s]*([0-9][0-9\s-]{3,24}[0-9])/);
  if (referencia) {
    referencia = digitos(referencia);
    // No confundir con un teléfono, una cuenta o una cédula.
    if (normalizarTelefono(referencia) && telefonos.has(normalizarTelefono(referencia)!) || referencia.length > 20 || referencia.length < 4) referencia = null;
  }

  // ---------- Fecha ----------
  let fecha: string | null = null;
  const f1 = texto.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  const f2 = texto.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const f3 = texto.match(/\b(\d{1,2})(?: DE)? (ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC)[A-Z]*\.?(?: DE)?,? (\d{4})\b/);
  if (f2) fecha = fechaIso(Number(f2[3]), Number(f2[2]), Number(f2[1]));
  if (!fecha && f1) fecha = fechaIso(Number(f1[1]), Number(f1[2]), Number(f1[3]));
  if (!fecha && f3) fecha = fechaIso(Number(f3[1]), MESES[f3[2]], Number(f3[3]));
  if (fecha && fecha > hoy.toISOString().slice(0, 10)) fecha = null;   // una fecha futura es un mal reconocimiento

  // ---------- Bancos ----------
  const enLinea = (l: string) => {
    const r: string[] = [];
    for (const m of l.matchAll(/\b(01\d{2})\b/g)) if (CODIGOS.has(m[1])) r.push(m[1]);
    for (const [cod, re] of ALIAS) if (re.test(l)) r.push(cod);
    return r;
  };
  let bancoOrigen: string | null = null, bancoDestino: string | null = null;
  const marcaDestino = /\b(DESTINO|RECEPTOR|BENEFICIARIO|DESTINATARIO|RECEPTORA|AL BANCO|BANCO RECEPTOR|PARA)\b/;
  const marcaOrigen = /\b(ORIGEN|EMISOR|ORDENANTE|DESDE|PAGADOR|DEBITO|CUENTA A DEBITAR)\b/;
  const todos: string[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const aqui = enLinea(lineas[i]);
    const conSiguiente = aqui.length ? aqui : (/\bBANCO\b/.test(lineas[i]) ? enLinea(lineas[i + 1] ?? '') : []);
    if (!conSiguiente.length) continue;
    todos.push(...conSiguiente);
    if (marcaDestino.test(lineas[i]) && !bancoDestino) bancoDestino = conSiguiente[0];
    else if (marcaOrigen.test(lineas[i]) && !bancoOrigen) bancoOrigen = conSiguiente[0];
  }
  // Cuentas de 20 dígitos completas: sus 4 primeros dígitos son el banco.
  if (!bancoDestino && cuentas.size) bancoDestino = [...cuentas][0].slice(0, 4);
  // Sin etiquetas: el banco que no es el de destino es el de origen (la app del banco suele poner su nombre arriba).
  if (!bancoOrigen) bancoOrigen = todos.find((c) => c !== bancoDestino) ?? null;

  return {
    referencia, monto, fecha, bancoOrigen, bancoDestino,
    telefonos: [...telefonos], documentos: [...documentos], cuentas: [...cuentas], texto: textoOriginal,
  };
}

/** ¿El comprobante muestra que se pagó a esta cuenta? (teléfono, cédula o RIF, o número de cuenta). */
export function comprobarDestino(l: LecturaComprobante, c: { telefono?: string | null; documento?: string | null; numeroCuenta?: string | null; bancoCodigo?: string | null }) {
  const coincide: string[] = [], distinto: string[] = [];
  if (c.telefono && l.telefonos.length) (l.telefonos.includes(c.telefono) ? coincide : distinto).push('teléfono');
  if (c.documento && l.documentos.length) {
    // Algunos comprobantes muestran la cédula del que paga y la del que recibe: basta con que aparezca la del condominio.
    (l.documentos.some((d) => digitos(d) === digitos(c.documento)) ? coincide : distinto).push(c.documento[0] === 'V' || c.documento[0] === 'E' ? 'cédula' : 'RIF');
  }
  if (c.numeroCuenta && l.cuentas.length) (l.cuentas.includes(c.numeroCuenta) ? coincide : distinto).push('número de cuenta');
  if (c.bancoCodigo && l.bancoDestino) (l.bancoDestino === c.bancoCodigo ? coincide : distinto).push('banco');
  // Si el teléfono o la cuenta coinciden, otra cédula en la captura suele ser la del que paga: no es un error.
  const fuerte = coincide.includes('teléfono') || coincide.includes('número de cuenta');
  return { coincide, distinto: fuerte ? distinto.filter((x) => x === 'banco') : distinto };
}
