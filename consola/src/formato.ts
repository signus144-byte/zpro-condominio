import type { EstadoCondominio, EstadoFactura, MetodoPago, Plan, RolPlataforma, TipoDesarrollo, TipoUnidad } from './data/tipos';

const numF = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entF = new Intl.NumberFormat('es-VE');

export const usd = (x: number) => `${x < 0 ? '−' : ''}$${numF.format(Math.abs(x))}`;
export const bs = (x: number) => `Bs ${numF.format(x)}`;
export const entero = (x: number) => entF.format(x);
const pctF = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 1 });
export const pct = (x: number | null) => (x == null ? '—' : `${pctF.format(x)} %`);
export const r2 = (x: number) => Math.round(x * 100) / 100;

export function fecha(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function mes(periodo: string) {
  const t = new Date(periodo + 'T12:00:00').toLocaleDateString('es-VE', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export const periodoDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
export const periodoActual = () => periodoDe(new Date());
const mover = (p: string, n: number) => { const d = new Date(p + 'T12:00:00'); d.setMonth(d.getMonth() + n); return periodoDe(d); };
export const mesSiguiente = (p: string) => mover(p, 1);
export const mesAnterior = (p: string) => mover(p, -1);
/** Fecha de hoy en la hora local (Venezuela), AAAA-MM-DD. */
export const hoy = () => new Date().toLocaleDateString('en-CA');
export const sumarDias = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** Planes por tamaño ordenados de menor a mayor tope (el "sin límite" al final). */
export const ordenarPlanes = (planes: Plan[]) =>
  [...planes].sort((a, b) => (a.hastaUnidades ?? Infinity) - (b.hastaUnidades ?? Infinity) || a.precioUsdMes - b.precioUsdMes);
/** Plan que le toca a un condominio con n unidades: el de menor tope que alcance (igual que plan_para_unidades en la BD). */
export const planPara = (unidades: number, planes: Plan[]) =>
  ordenarPlanes(planes).find((p) => p.hastaUnidades == null || p.hastaUnidades >= unidades) ?? null;
/** "Hasta 50 unidades" · "51 a 150 unidades" · "Más de 300 unidades" */
export function rangoPlan(p: Plan, planes: Plan[]) {
  const ord = ordenarPlanes(planes);
  const i = ord.findIndex((x) => x.id === p.id);
  const desde = i > 0 ? (ord[i - 1].hastaUnidades ?? 0) + 1 : 1;
  if (p.hastaUnidades == null) return desde <= 1 ? 'Cualquier cantidad de unidades' : `Más de ${entero(desde - 1)} unidades`;
  return desde <= 1 ? `Hasta ${entero(p.hastaUnidades)} unidades` : `${entero(desde)} a ${entero(p.hastaUnidades)} unidades`;
}

export const ESTADOS: Record<EstadoCondominio, string> = { prueba: 'En prueba', activo: 'Activo', suspendido: 'Suspendido', baja: 'De baja' };
export const TONO_ESTADO: Record<EstadoCondominio, 'info' | 'ok' | 'alerta' | 'neutro'> = { prueba: 'info', activo: 'ok', suspendido: 'alerta', baja: 'neutro' };
export const TIPOS: Record<TipoDesarrollo, string> = {
  edificio: 'Edificio', conjunto_residencial: 'Conjunto residencial', urbanizacion: 'Urbanización', centro_comercial: 'Centro comercial',
};
export const TIPOS_UNIDAD: Record<TipoUnidad, string> = { apartamento: 'Apartamento', casa: 'Casa', local: 'Local', oficina: 'Oficina', townhouse: 'Townhouse' };
export const ESTADO_FACTURA: Record<EstadoFactura, string> = { emitida: 'Por cobrar', pagada: 'Pagada', vencida: 'Vencida', anulada: 'Anulada' };
export const TONO_FACTURA: Record<EstadoFactura, 'info' | 'ok' | 'error' | 'neutro'> = { emitida: 'info', pagada: 'ok', vencida: 'error', anulada: 'neutro' };
export const ROLES: Record<RolPlataforma, string> = { dueno: 'Dueño', soporte: 'Soporte', finanzas: 'Finanzas' };
export const METODOS: Record<MetodoPago, string> = {
  pago_movil: 'Pago Móvil', transferencia: 'Transferencia', zelle: 'Zelle', efectivo_usd: 'Efectivo $',
  efectivo_bs: 'Efectivo Bs', usdt: 'USDT', otro: 'Otro',
};

// Códigos fáciles de dictar por teléfono (sin 0/O/1/I).
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function aleatorio(n: number) {
  const b = new Uint32Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ALFABETO[x % ALFABETO.length]).join('');
}
export function codigoActivacion(nombre: string) {
  const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\b(RESIDENCIAS?|CONJUNTO|RESIDENCIAL|URBANIZACION|URB|EDIFICIO|EDF|RES|TORRES?|LOS|LAS|EL|LA|DE|DEL)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')[0] || 'CONDO';
  return `${base.slice(0, 8)}-${aleatorio(4)}`;
}
export const etiquetaUnidad = (u: { tipo: TipoUnidad; bloque: string | null; numero: string }) =>
  ({ casa: 'Casa ', townhouse: 'TH ', local: 'Local ', oficina: 'Ofic. ', apartamento: 'Apto ' }[u.tipo] ?? '') +
  (u.bloque ? `${u.bloque}-` : '') + u.numero;

export function descargar(nombre: string, contenido: BlobPart, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const csv = (filas: (string | number | null)[][]) =>
  '﻿' + filas.map((f) => f.map((c) => {
    const s = c == null ? '' : String(c);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
