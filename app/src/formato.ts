import type { CategoriaReporte, EstadoPago, EstadoPartida, EstadoReporte, MetodoPago, TipoCargo } from './data/tipos';

const numF = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const usd = (x: number) => `${x < 0 ? '−' : ''}$${numF.format(Math.abs(x))}`;
export const bs = (x: number) => `Bs ${numF.format(x)}`;
export const monto = (x: number, moneda: 'USD' | 'VES') => (moneda === 'USD' ? usd(x) : bs(x));
export const pct = (x: number) => `${numF.format(x)} %`;

export function fecha(iso: string) {
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function mes(periodo: string) {
  const d = new Date(periodo + 'T12:00:00');
  const t = d.toLocaleDateString('es-VE', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const METODOS: Record<MetodoPago, string> = {
  pago_movil: 'Pago Móvil', transferencia: 'Transferencia', zelle: 'Zelle', efectivo_usd: 'Efectivo $',
  efectivo_bs: 'Efectivo Bs', usdt: 'USDT', otro: 'Otro',
};
export const ESTADO_PAGO: Record<EstadoPago, string> = { reportado: 'En revisión', confirmado: 'Aprobado', rechazado: 'Rechazado' };
export const TIPO_CARGO: Record<TipoCargo, string> = {
  ordinaria: 'Cuota ordinaria', fondo_reserva: 'Fondo de reserva', extraordinaria: 'Partida especial',
  no_comun: 'Gasto no común', multa: 'Multa', ajuste: 'Ajuste',
};
export const ESTADO_PARTIDA: Record<EstadoPartida, string> = {
  borrador: 'Borrador', en_votacion: 'En votación', aprobada: 'Aprobada', rechazada: 'Rechazada',
  en_ejecucion: 'En ejecución', cerrada: 'Cerrada',
};
export const CATEGORIAS: Record<CategoriaReporte, string> = {
  ruido: 'Ruido', dano_area_comun: 'Daño en área común', seguridad: 'Seguridad', limpieza: 'Limpieza',
  mascotas: 'Mascotas', estacionamiento: 'Estacionamiento', filtracion: 'Filtración', electricidad: 'Electricidad', otro: 'Otro',
};
export const ESTADO_REPORTE: Record<EstadoReporte, string> = {
  nuevo: 'Nuevo', en_revision: 'En revisión', en_proceso: 'En proceso', resuelto: 'Resuelto', descartado: 'Descartado',
};

// Periodos contables: siempre el día 1 del mes (AAAA-MM-01).
export const periodoDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
export const periodoActual = () => periodoDe(new Date());
const mover = (p: string, n: number) => { const d = new Date(p + 'T12:00:00'); d.setMonth(d.getMonth() + n); return periodoDe(d); };
export const mesSiguiente = (p: string) => mover(p, 1);
export const mesAnterior = (p: string) => mover(p, -1);

/** Tiempo relativo corto: "hace 5 min", "hace 3 h", "ayer", "12 oct 2026". */
export function hace(iso: string, ahora = Date.now()) {
  const seg = Math.max(0, (ahora - new Date(iso).getTime()) / 1000);
  if (seg < 60) return 'ahora';
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86_400) return `hace ${Math.floor(seg / 3600)} h`;
  if (seg < 2 * 86_400) return 'ayer';
  if (seg < 7 * 86_400) return `hace ${Math.floor(seg / 86_400)} días`;
  return fecha(iso);
}

/** Fecha de hoy según la hora del teléfono (AAAA-MM-DD). No usar toISOString: en Venezuela, después de las 8 p. m. ya es "mañana" en UTC. */
export function hoyLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
