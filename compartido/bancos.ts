// Bancos de Venezuela (código de 4 dígitos que va al inicio del número de cuenta y en el Pago Móvil)
// y ayudas para mostrar y copiar los datos de pago tal como los piden las plataformas de los bancos.

export const BANCOS: { codigo: string; nombre: string }[] = [
  { codigo: '0102', nombre: 'Banco de Venezuela' },
  { codigo: '0104', nombre: 'Venezolano de Crédito' },
  { codigo: '0105', nombre: 'Mercantil' },
  { codigo: '0108', nombre: 'Provincial' },
  { codigo: '0114', nombre: 'Bancaribe' },
  { codigo: '0115', nombre: 'Exterior' },
  { codigo: '0128', nombre: 'Banco Caroní' },
  { codigo: '0134', nombre: 'Banesco' },
  { codigo: '0137', nombre: 'Sofitasa' },
  { codigo: '0138', nombre: 'Banco Plaza' },
  { codigo: '0146', nombre: 'Bangente' },
  { codigo: '0151', nombre: 'BFC Banco Fondo Común' },
  { codigo: '0156', nombre: '100% Banco' },
  { codigo: '0157', nombre: 'DelSur' },
  { codigo: '0163', nombre: 'Banco del Tesoro' },
  { codigo: '0166', nombre: 'Banco Agrícola de Venezuela' },
  { codigo: '0168', nombre: 'Bancrecer' },
  { codigo: '0169', nombre: 'R4 Banco Microfinanciero' },
  { codigo: '0171', nombre: 'Banco Activo' },
  { codigo: '0172', nombre: 'Bancamiga' },
  { codigo: '0173', nombre: 'Banco Internacional de Desarrollo' },
  { codigo: '0174', nombre: 'Banplus' },
  { codigo: '0175', nombre: 'Banco Digital de los Trabajadores' },
  { codigo: '0177', nombre: 'Banfanb' },
  { codigo: '0178', nombre: 'N58 Banco Digital' },
  { codigo: '0191', nombre: 'Banco Nacional de Crédito (BNC)' },
];

export const nombreBanco = (codigo: string | null | undefined) =>
  codigo ? (BANCOS.find((b) => b.codigo === codigo)?.nombre ?? `Banco ${codigo}`) : '';

/** Solo dígitos. */
export const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** "0414-123.45.67" → "04141234567"; acepta +58 y 58 al inicio. null si no es un celular venezolano. */
export function normalizarTelefono(s: string): string | null {
  let d = digitos(s);
  if (d.startsWith('58') && d.length === 12) d = '0' + d.slice(2);
  if (d.length === 10 && d.startsWith('4')) d = '0' + d;
  return /^04\d{9}$/.test(d) ? d : null;
}
export const formatoTelefono = (t: string) => (t.length === 11 ? `${t.slice(0, 4)}-${t.slice(4)}` : t);

/** "V-12.345.678", "j 30123456 7" → "V12345678" / "J301234567". null si no se entiende. */
export function normalizarDocumento(s: string): string | null {
  const m = s.trim().toUpperCase().match(/^([VEJGP])[\s.-]*([\d.\s-]+)$/);
  if (!m) return null;
  const n = digitos(m[2]);
  return n.length >= 5 && n.length <= 10 ? m[1] + n : null;
}
/** Para mostrar: V-12.345.678 · J-30123456-7 (en RIF el último dígito es el verificador). */
export function formatoDocumento(doc: string) {
  const letra = doc[0], n = doc.slice(1);
  if ('JGP'.includes(letra) && n.length >= 6) return `${letra}-${n.slice(0, -1)}-${n.slice(-1)}`;
  return `${letra}-${Number(n).toLocaleString('es-VE')}`;
}

export const formatoCuenta = (c: string) => (c.length === 20 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 10)}-${c.slice(10)}` : c);

/** Monto como lo escriben las apps de los bancos: sin puntos de miles y con coma decimal (75393,22). */
export const montoParaBanco = (m: number) => m.toFixed(2).replace('.', ',');

/**
 * Línea de Pago Móvil en una sola línea: código del banco, teléfono, cédula o RIF y monto, separados por espacio
 * ("0134 04141234567 J301234567 75393,22"). Va dentro del QR que arma la app y en "Copiar todo".
 */
export function lineaPagoMovil(d: { bancoCodigo: string; telefono: string; documento: string }, monto?: number | null) {
  return [d.bancoCodigo, d.telefono, d.documento, monto && monto > 0 ? montoParaBanco(monto) : null].filter(Boolean).join(' ');
}

/** Datos de una cuenta tal como se cargan (undefined = no se toca; null o '' = se borra). */
export interface CamposCuenta {
  bancoCodigo?: string | null; titular?: string | null; documento?: string | null; telefono?: string | null;
  numeroCuenta?: string | null; correo?: string | null; nota?: string | null;
}

/**
 * Normaliza y valida lo que carga la junta (igual en el servidor y en la demostración). Devuelve los campos listos para
 * guardar (sin guiones ni puntos; null = borrar; undefined = no se tocó) o lanza Error con un mensaje para el usuario.
 */
export function validarCamposCuenta(d: CamposCuenta): CamposCuenta {
  const vacio = (x: string | null | undefined) => (x === undefined ? undefined : x === null || x.trim() === '' ? null : x.trim());
  const banco = vacio(d.bancoCodigo);
  if (banco && !BANCOS.some((b) => b.codigo === banco)) throw new Error('Elija el banco de la lista');
  const tel = vacio(d.telefono);
  const telefono = tel == null ? tel : normalizarTelefono(tel);
  if (tel && !telefono) throw new Error('El teléfono de Pago Móvil debe ser un celular de 11 dígitos (0414…, 0424…, 0412…, 0416…, 0426…)');
  const doc = vacio(d.documento);
  const documento = doc == null ? doc : normalizarDocumento(doc);
  if (doc && !documento) throw new Error('La cédula o el RIF debe empezar con V, E, J, G o P, seguido de los números');
  const nc = vacio(d.numeroCuenta);
  const numeroCuenta = nc == null ? nc : digitos(nc);
  if (numeroCuenta && numeroCuenta.length !== 20) throw new Error('El número de cuenta tiene 20 dígitos');
  if (numeroCuenta && banco && !numeroCuenta.startsWith(banco)) throw new Error(`El número de cuenta debe empezar por ${banco}, el código de ${nombreBanco(banco)}`);
  const correo = vacio(d.correo);
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('Revise el correo');
  const titular = vacio(d.titular);
  if (titular && titular.length < 2) throw new Error('Escriba el nombre del titular');
  return { bancoCodigo: banco, titular, documento, telefono, numeroCuenta, correo, nota: vacio(d.nota) };
}

/** Resumen de una línea ("Pago Móvil 0134 Banesco · 0414-1234567 · Cuenta … · J-30123456-7 · titular · correo · nota"). */
export function resumenCuenta(c: CamposCuenta): string | null {
  const partes: string[] = [];
  if (c.telefono) partes.push(`Pago Móvil ${c.bancoCodigo ?? ''} ${nombreBanco(c.bancoCodigo)} · ${formatoTelefono(c.telefono)}`.replace(/\s+/g, ' '));
  else if (c.bancoCodigo) partes.push(`${c.bancoCodigo} ${nombreBanco(c.bancoCodigo)}`);
  if (c.numeroCuenta) partes.push(`Cuenta ${formatoCuenta(c.numeroCuenta)}`);
  if (c.documento) partes.push(formatoDocumento(c.documento));
  if (c.titular) partes.push(c.titular);
  if (c.correo) partes.push(c.correo);
  if (c.nota) partes.push(c.nota);
  return partes.length ? partes.join(' · ') : null;
}
