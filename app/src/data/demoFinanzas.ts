// Reglas de finanzas del modo demostración: las mismas de 0023_pagos_por_concepto.sql.
//  · Un pago aprobado cubre primero lo que eligió el vecino (o la junta al aprobar); lo que sobra, la deuda más antigua.
//  · El saldo a favor (y las notas de crédito) cubren solas las deudas nuevas.
//  · Reporte mensual con la misma forma que reporte_mensual().
import type {
  AplicacionPago, Cargo, CuentaFinanciera, EstadoCargo, Gasto, Pago, Partida, ReporteMensual, TipoCargo, Unidad,
} from './tipos';

export type PagoDemo = Pago & { cuentaDestinoId: string | null; revisadoEn?: string | null; destinoIds?: string[] };

const r2 = (x: number) => Math.round(x * 100) / 100;
const PRIO: Record<TipoCargo, number> = { ordinaria: 1, fondo_reserva: 2, no_comun: 3, multa: 4, extraordinaria: 5, ajuste: 6 };
export const prioridad = (t: TipoCargo) => PRIO[t] ?? 6;

export interface Aplicacion { porPago: Map<string, AplicacionPago[]>; porCargo: Map<string, number> }

/** Recalcula cómo quedan descontados los pagos aprobados de una casa (determinista, como reaplicar_pagos_unidad). */
export function aplicarUnidad(cargos: Cargo[], pagos: PagoDemo[], uid: string): Aplicacion {
  const propios = cargos.filter((c) => c.unidadId === uid);
  const idx = new Map(propios.map((c, i) => [c.id, i]));
  const deuda = propios.filter((c) => c.montoUsd > 0)
    .sort((a, b) => a.periodo.localeCompare(b.periodo) || prioridad(a.tipo) - prioridad(b.tipo) || idx.get(a.id)! - idx.get(b.id)!);
  const pend = new Map(deuda.map((c) => [c.id, c.montoUsd]));
  const porPago = new Map<string, AplicacionPago[]>();
  const porCargo = new Map<string, number>();
  const anotar = (pagoId: string | null, c: Cargo, m: number) => {
    porCargo.set(c.id, r2((porCargo.get(c.id) ?? 0) + m));
    pend.set(c.id, (pend.get(c.id) ?? 0) - m);
    if (pagoId) porPago.set(pagoId, [...(porPago.get(pagoId) ?? []), { cargoId: c.id, concepto: c.concepto, periodo: c.periodo, montoUsd: r2(m) }]);
  };
  const confirmados = pagos.filter((p) => p.unidadId === uid && p.estado === 'confirmado')
    .sort((a, b) => (a.revisadoEn ?? a.creadoEn).localeCompare(b.revisadoEn ?? b.creadoEn) || a.creadoEn.localeCompare(b.creadoEn));
  const resto = new Map<string, number>();
  // 1) Lo que se eligió pagar
  for (const p of confirmados) {
    let r = p.montoUsd;
    for (const cid of p.destinoIds ?? []) {
      const c = deuda.find((x) => x.id === cid);
      if (!c || r <= 0.004) continue;
      const m = Math.min(r, pend.get(cid) ?? 0);
      if (m > 0.004) { anotar(p.id, c, m); r -= m; }
    }
    resto.set(p.id, r);
  }
  // 2) Notas de crédito y lo que sobró: a lo más antiguo
  const creditos: { pagoId: string | null; monto: number }[] = [
    ...propios.filter((c) => c.montoUsd < 0).map((c) => ({ pagoId: null, monto: -c.montoUsd })),
    ...confirmados.map((p) => ({ pagoId: p.id, monto: resto.get(p.id) ?? 0 })),
  ];
  for (const cr of creditos) {
    let r = cr.monto;
    for (const c of deuda) {
      if (r <= 0.004) break;
      const m = Math.min(r, pend.get(c.id) ?? 0);
      if (m > 0.004) { anotar(cr.pagoId, c, m); r -= m; }
    }
  }
  return { porPago, porCargo };
}

export function cargoConEstado(c: Cargo, porCargo: Map<string, number>): Cargo {
  const pagado = r2(porCargo.get(c.id) ?? 0);
  const estado: EstadoCargo = c.montoUsd <= 0 ? 'credito' : pagado >= c.montoUsd - 0.005 ? 'pagado' : pagado > 0 ? 'parcial' : 'pendiente';
  return { ...c, pagadoUsd: pagado, pendienteUsd: r2(Math.max(c.montoUsd - pagado, 0)), estado };
}

export function pagoConDestinos(p: PagoDemo, cargos: Cargo[], ap: Aplicacion): Pago {
  const { destinoIds, revisadoEn: _r, cuentaDestinoId: _c, ...base } = p;
  return {
    ...base,
    destinos: (destinoIds ?? []).flatMap((id) => {
      const c = cargos.find((x) => x.id === id);
      return c ? [{ cargoId: c.id, concepto: c.concepto, periodo: c.periodo, montoUsd: r2(Math.max(c.montoUsd - (ap.porCargo.get(c.id) ?? 0), 0)) }] : [];
    }),
    aplicaciones: ap.porPago.get(p.id) ?? [],
  };
}

const finDeMes = (periodo: string) => {
  const d = new Date(Date.UTC(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
};

/** Misma forma que reporte_mensual() del servidor. */
export function reporteMensual(periodo: string, d: {
  unidades: Unidad[]; cargos: Cargo[]; pagos: PagoDemo[]; gastos: Gasto[]; cuentas: CuentaFinanciera[];
  saldoInicial: Record<string, number>; partidas: Partida[]; tasa: { fecha: string | null; usdVes: number | null };
  etiqueta: (u: Unidad) => string;
}): ReporteMensual {
  const ini = periodo, fin = finDeMes(periodo);
  const ap = new Map(d.unidades.map((u) => [u.id, aplicarUnidad(d.cargos, d.pagos, u.id)]));
  const pagado = (cid: string, uid: string) => ap.get(uid)?.porCargo.get(cid) ?? 0;
  const conf = d.pagos.filter((p) => p.estado === 'confirmado');
  const delMes = d.pagos.filter((p) => p.fechaPago >= ini && p.fechaPago <= fin);
  const suma = (xs: number[]) => r2(xs.reduce((s, x) => s + x, 0));
  const casas = d.unidades.map((u) => {
    const cs = d.cargos.filter((c) => c.unidadId === u.id);
    const ps = conf.filter((p) => p.unidadId === u.id);
    const anterior = suma(cs.filter((c) => c.periodo < ini).map((c) => c.montoUsd)) - suma(ps.filter((p) => p.fechaPago < ini).map((p) => p.montoUsd));
    const facturado = suma(cs.filter((c) => c.periodo === ini).map((c) => c.montoUsd));
    const pag = suma(ps.filter((p) => p.fechaPago >= ini && p.fechaPago <= fin).map((p) => p.montoUsd));
    const final = r2(anterior + facturado - pag);
    const delRecibo = cs.filter((c) => c.periodo === ini);
    const pendRecibo = suma(delRecibo.filter((c) => c.montoUsd > 0).map((c) => Math.max(c.montoUsd - pagado(c.id, u.id), 0)));
    const pagRecibo = suma(delRecibo.map((c) => pagado(c.id, u.id)));
    return {
      unidadId: u.id, etiqueta: d.etiqueta(u), propietario: u.propietario, alicuota: u.alicuota,
      saldoAnteriorUsd: r2(anterior), facturadoUsd: facturado, pagadoUsd: pag, saldoFinalUsd: final,
      estado: (final > 0.009 ? 'debe' : final < -0.009 ? 'a_favor' : 'al_dia') as 'debe' | 'a_favor' | 'al_dia',
      recibo: (!delRecibo.length ? 'sin_recibo' : pendRecibo <= 0.009 ? 'pagado' : pagRecibo > 0 ? 'parcial' : 'pendiente') as 'sin_recibo' | 'pagado' | 'parcial' | 'pendiente',
      pagosRechazados: delMes.filter((p) => p.unidadId === u.id && p.estado === 'rechazado').length,
      pagosEnRevision: delMes.filter((p) => p.unidadId === u.id && p.estado === 'reportado').length,
    };
  });
  const porTipo: Partial<Record<TipoCargo, number>> = {};
  for (const c of d.cargos.filter((x) => x.periodo === ini)) porTipo[c.tipo] = r2((porTipo[c.tipo] ?? 0) + c.montoUsd);
  const gastosMes = d.gastos.filter((g) => g.periodo === ini);
  const enMoneda = (m: { moneda: string; monto: number; montoUsd: number; tasaBcv: number | null }, moneda: string) =>
    m.moneda === moneda ? m.monto : moneda === 'USD' ? m.montoUsd : r2(m.monto * (m.tasaBcv ?? 0));
  const cuentas = d.cuentas.map((c) => {
    const ent = (cond: (p: PagoDemo) => boolean) => suma(conf.filter((p) => p.cuentaDestinoId === c.id && cond(p)).map((p) => enMoneda(p, c.moneda)));
    const sal = (cond: (g: Gasto) => boolean) => suma(d.gastos.filter((g) => g.cuentaId === c.id && cond(g)).map((g) => enMoneda(g, c.moneda)));
    const inicial = r2((d.saldoInicial[c.id] ?? 0) + ent((p) => p.fechaPago < ini) - sal((g) => g.periodo < ini));
    const entradas = ent((p) => p.fechaPago >= ini && p.fechaPago <= fin), salidas = sal((g) => g.periodo === ini);
    return { nombre: c.nombre, moneda: c.moneda, tipo: c.tipo, saldoInicial: inicial, entradas, salidas, saldoFinal: r2(inicial + entradas - salidas) };
  });
  const aplicadoHasta = (filtro: (c: Cargo) => boolean) => suma(d.unidades.flatMap((u) => {
    const a = ap.get(u.id)!;
    return [...a.porPago.entries()].flatMap(([pid, xs]) => {
      const p = d.pagos.find((x) => x.id === pid);
      if (!p || p.fechaPago > fin) return [];
      return xs.filter((x) => { const c = d.cargos.find((k) => k.id === x.cargoId); return !!c && filtro(c); }).map((x) => x.montoUsd);
    });
  }));
  return {
    periodo: ini, desde: ini, hasta: fin, generadoEn: new Date().toISOString(), tasaBcv: d.tasa.usdVes, tasaFecha: d.tasa.fecha,
    resumen: {
      facturadoUsd: suma(d.cargos.filter((c) => c.periodo === ini).map((c) => c.montoUsd)), facturadoPorTipo: porTipo,
      cobradoUsd: suma(delMes.filter((p) => p.estado === 'confirmado').map((p) => p.montoUsd)),
      cobradoBs: suma(delMes.filter((p) => p.estado === 'confirmado' && p.moneda === 'VES').map((p) => p.monto)),
      cobradoDivisasUsd: suma(delMes.filter((p) => p.estado === 'confirmado' && p.moneda === 'USD').map((p) => p.monto)),
      gastosUsd: suma(gastosMes.map((g) => g.montoUsd)),
      deudaInicialUsd: suma(casas.map((c) => Math.max(c.saldoAnteriorUsd, 0))),
      deudaFinalUsd: suma(casas.map((c) => Math.max(c.saldoFinalUsd, 0))),
      aFavorUsd: suma(casas.map((c) => Math.max(-c.saldoFinalUsd, 0))),
      totalCasas: casas.length, casasAlDia: casas.filter((c) => c.saldoFinalUsd <= 0.009).length,
      casasConDeuda: casas.filter((c) => c.saldoFinalUsd > 0.009).length,
      pagosAprobados: delMes.filter((p) => p.estado === 'confirmado').length,
      pagosRechazados: delMes.filter((p) => p.estado === 'rechazado').length,
      pagosEnRevision: delMes.filter((p) => p.estado === 'reportado').length,
      enRevisionUsd: suma(delMes.filter((p) => p.estado === 'reportado').map((p) => p.montoUsd)),
    },
    casas,
    pagos: [...delMes].sort((a, b) => a.fechaPago.localeCompare(b.fechaPago) || a.creadoEn.localeCompare(b.creadoEn)).map((p) => ({
      id: p.id, unidad: p.unidadEtiqueta, fechaPago: p.fechaPago, metodo: p.metodo, moneda: p.moneda, monto: p.monto, tasaBcv: p.tasaBcv,
      montoUsd: p.montoUsd, referencia: p.referencia, estado: p.estado, motivoRechazo: p.motivoRechazo, revisadoEn: p.revisadoEn ?? null,
      aplicadoA: (ap.get(p.unidadId)?.porPago.get(p.id) ?? []).map((x) => ({ concepto: x.concepto, periodo: x.periodo, montoUsd: x.montoUsd })),
    })),
    gastos: gastosMes.map((g) => ({
      fecha: g.fechaGasto, categoria: g.categoria, descripcion: g.descripcion, tipo: g.tipo, moneda: g.moneda, monto: g.monto,
      tasaBcv: g.tasaBcv, montoUsd: g.montoUsd, cuenta: d.cuentas.find((c) => c.id === g.cuentaId)?.nombre ?? null, proveedor: null,
    })).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    cuentas,
    fondoReserva: {
      facturadoAcumUsd: suma(d.cargos.filter((c) => c.tipo === 'fondo_reserva' && c.periodo <= ini).map((c) => c.montoUsd)),
      cobradoAcumUsd: aplicadoHasta((c) => c.tipo === 'fondo_reserva' && c.periodo <= ini),
    },
    partidas: d.partidas.filter((p) => d.cargos.some((c) => c.partidaId === p.id && c.periodo <= ini)).map((p) => ({
      id: p.id, titulo: p.titulo, presupuestoUsd: p.presupuestoUsd, estado: p.estado,
      emitidoUsd: suma(d.cargos.filter((c) => c.partidaId === p.id && c.periodo <= ini && c.montoUsd > 0).map((c) => c.montoUsd)),
      cobradoUsd: aplicadoHasta((c) => c.partidaId === p.id && c.periodo <= ini),
      casas: new Set(d.cargos.filter((c) => c.partidaId === p.id && c.periodo <= ini).map((c) => c.unidadId)).size,
    })),
  };
}
