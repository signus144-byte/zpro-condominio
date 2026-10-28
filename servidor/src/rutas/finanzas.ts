// Finanzas del condominio: panel, unidades y estados de cuenta, pagos, gastos, recibos,
// conciliación bancaria y la mensualidad de ZentaPro (CONTRATO_API.md §3).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  DatosPagoZentaPro, EstadoCuenta, FacturaZentaPro, Gasto, MovimientoBancario, Pago, ResultadoExtracto,
  ResumenPanel, UnidadConSaldo,
} from '../../../compartido/tipos.js';
import { bd, type Contexto } from '../contexto.js';
import type { Tx } from '../db/conexion.js';
import { extension, guardarArchivo, leerFormulario, urlFirmada } from '../archivos/archivos.js';
import { ErrorApi } from '../util/errores.js';
import { ParamsC, Periodo, Uuid } from './condominio.js';
import { etiquetaCorta, exigir, exigirFinanzas, exigirJunta, iso, num } from './_comun.js';

const Metodo = z.enum(['pago_movil', 'transferencia', 'zelle', 'efectivo_usd', 'efectivo_bs', 'usdt', 'otro']);
const Moneda = z.enum(['USD', 'VES']);
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'debe ser AAAA-MM-DD');
const Monto = z.coerce.number().positive().max(1e12);
const opt = (s: string | undefined) => (s === undefined || s.trim() === '' ? undefined : s.trim());

async function mapPago(ctx: Contexto, p: Record<string, any>): Promise<Pago> {
  return {
    id: p.id, unidadId: p.unidad_id, unidadEtiqueta: etiquetaCorta(p.bloque, p.numero), fechaPago: p.fecha_pago,
    metodo: p.metodo, moneda: p.moneda, monto: num(p.monto), tasaBcv: p.tasa_bcv == null ? null : num(p.tasa_bcv),
    montoUsd: num(p.monto_usd), referencia: p.referencia, bancoOrigen: p.banco_origen,
    comprobanteUrl: await urlFirmada(ctx, 'comprobantes', p.comprobante_path), nota: p.nota, estado: p.estado,
    motivoRechazo: p.motivo_rechazo, creadoEn: iso(p.creado_en)!,
  };
}
const SELECT_PAGO = `select p.*, u.bloque, u.numero from pagos p join unidades u on u.id = p.unidad_id`;

async function mapGasto(ctx: Contexto, g: Record<string, any>): Promise<Gasto> {
  return {
    id: g.id, periodo: g.periodo, tipo: g.tipo, categoria: g.categoria, descripcion: g.descripcion, moneda: g.moneda,
    monto: num(g.monto), tasaBcv: g.tasa_bcv == null ? null : num(g.tasa_bcv), montoUsd: num(g.monto_usd),
    fechaGasto: g.fecha_gasto, facturaUrl: await urlFirmada(ctx, 'facturas', g.factura_path),
    unidadId: g.unidad_id, partidaId: g.partida_id, cuentaId: g.cuenta_id,
  };
}

export async function estadoCuenta(ctx: Contexto, c: Tx, cid: string, uid: string): Promise<EstadoCuenta> {
  const u = (await c.query(`select * from unidades where id = $1 and condominio_id = $2`, [uid, cid])).rows[0];
  if (!u) throw new ErrorApi(404, 'Unidad no existe', 'no_encontrado');
  await exigir(c, 'es_junta($1) or es_de_mi_unidad($2)', [cid, uid], 'Solo puede ver el estado de cuenta de su unidad');
  const cargos = (await c.query(`select * from cargos where unidad_id = $1 order by periodo desc, tipo`, [uid])).rows;
  const pagos = (await c.query(`${SELECT_PAGO} where p.unidad_id = $1 order by p.creado_en desc`, [uid])).rows;
  const saldo = (await c.query(`select saldo_usd from estado_cuenta_unidad where unidad_id = $1`, [uid])).rows[0];
  return {
    unidad: { id: u.id, bloque: u.bloque, numero: u.numero, alicuota: num(u.alicuota), propietario: u.propietario_nombre },
    cargos: cargos.map((x) => ({ id: x.id, unidadId: x.unidad_id, periodo: x.periodo, tipo: x.tipo, concepto: x.concepto, montoUsd: num(x.monto_usd) })),
    pagos: await Promise.all(pagos.map((p) => mapPago(ctx, p))),
    saldoUsd: num(saldo?.saldo_usd),
  };
}

export default async function rutasFinanzas(app: FastifyInstance) {
  const ctx = app.ctx;

  // ---------- Panel de la junta ----------
  app.get('/c/:cid/panel', async (req): Promise<ResumenPanel> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      await exigirJunta(c, cid);
      const periodo = (await c.query(`select to_char(date_trunc('month', now() at time zone 'America/Caracas'), 'YYYY-MM-DD') as p`)).rows[0].p as string;
      const q = async (sql: string, p: unknown[] = [cid]) => (await c.query(sql, p)).rows[0];
      const fact = await q(`select coalesce(sum(monto_usd), 0) s from cargos where condominio_id = $1 and periodo = $2`, [cid, periodo]);
      const cobr = await q(`select coalesce(sum(monto_usd), 0) s from pagos where condominio_id = $1 and estado = 'confirmado' and fecha_pago >= $2::date`, [cid, periodo]);
      const gast = await q(`select coalesce(sum(monto_usd), 0) s from gastos where condominio_id = $1 and periodo = $2`, [cid, periodo]);
      const pend = await q(`select count(*) n from pagos where condominio_id = $1 and estado = 'reportado'`);
      const mor = await q(`select count(*) filter (where saldo_usd > 0.009) morosas, count(*) total,
                                  coalesce(sum(greatest(saldo_usd, 0)), 0) deuda
                             from estado_cuenta_unidad where condominio_id = $1`);
      const rep = await q(`select count(*) n from reportes where condominio_id = $1 and estado in ('nuevo','en_revision','en_proceso')`);
      const saldos = (await c.query(`select nombre, moneda, saldo from saldo_cuentas where condominio_id = $1 order by tipo, nombre`, [cid])).rows;
      return {
        periodo, facturadoMesUsd: num(fact.s), recaudadoMesUsd: num(cobr.s), gastosMesUsd: num(gast.s),
        pagosPorConfirmar: num(pend.n), unidadesMorosas: num(mor.morosas), totalUnidades: num(mor.total),
        deudaTotalUsd: num(mor.deuda), reportesAbiertos: num(rep.n),
        saldosCuentas: saldos.map((s) => ({ nombre: s.nombre, moneda: s.moneda, saldo: num(s.saldo) })),
      };
    });
  });

  // ---------- Unidades y estados de cuenta ----------
  app.get('/c/:cid/unidades', async (req): Promise<UnidadConSaldo[]> => {
    const { cid } = ParamsC.parse(req.params);
    const filas = await bd(req, async (c) => (await c.query(`
      select u.*, e.total_cargos_usd, e.total_pagado_usd, e.saldo_usd
        from unidades u join estado_cuenta_unidad e on e.unidad_id = u.id
       where u.condominio_id = $1 and (es_junta($1) or es_de_mi_unidad(u.id))
       order by u.bloque nulls first, u.numero`, [cid])).rows);
    return filas.map((u) => ({
      id: u.id, bloque: u.bloque, numero: u.numero, alicuota: num(u.alicuota), propietario: u.propietario_nombre,
      cargosUsd: num(u.total_cargos_usd), pagadoUsd: num(u.total_pagado_usd), saldoUsd: num(u.saldo_usd),
    }));
  });

  app.get('/c/:cid/unidades/:uid/estado-cuenta', async (req) => {
    const p = ParamsC.extend({ uid: Uuid }).parse(req.params);
    return bd(req, (c) => estadoCuenta(ctx, c, p.cid, p.uid));
  });

  // ---------- Pagos ----------
  app.get('/c/:cid/pagos', async (req): Promise<Pago[]> => {
    const { cid } = ParamsC.parse(req.params);
    const { estado } = z.object({ estado: z.enum(['reportado', 'todos']).default('todos') }).parse(req.query);
    const filas = await bd(req, async (c) => {
      await exigirJunta(c, cid);
      return (await c.query(`${SELECT_PAGO} where p.condominio_id = $1 and ($2 = 'todos' or p.estado = 'reportado')
                             order by p.creado_en desc limit 500`, [cid, estado])).rows;
    });
    return Promise.all(filas.map((p) => mapPago(ctx, p)));
  });

  app.post('/c/:cid/pagos', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const { campos, archivos } = await leerFormulario(req);
    const d = z.object({
      unidadId: Uuid, fechaPago: Fecha, metodo: Metodo, moneda: Moneda, monto: Monto,
      referencia: z.string().max(40).optional(), bancoOrigen: z.string().max(60).optional(),
      cuentaDestinoId: Uuid.optional(), nota: z.string().max(500).optional(),
    }).parse({ ...campos, referencia: opt(campos.referencia), bancoOrigen: opt(campos.bancoOrigen),
               cuentaDestinoId: opt(campos.cuentaDestinoId), nota: opt(campos.nota) });
    if (d.fechaPago > new Date().toISOString().slice(0, 10)) throw new ErrorApi(400, 'La fecha del pago no puede ser futura', 'invalido');
    const comp = archivos.comprobante?.[0];
    if (comp && !(comp.mime.startsWith('image/') || comp.mime === 'application/pdf')) {
      throw new ErrorApi(400, 'El comprobante debe ser una imagen o un PDF', 'invalido');
    }
    const id = await bd(req, async (c) => {
      const u = await c.query(`select 1 from unidades where id = $1 and condominio_id = $2`, [d.unidadId, cid]);
      if (!u.rowCount) throw new ErrorApi(404, 'Unidad no existe', 'no_encontrado');
      const ruta = comp ? `${cid}/${req.usuarioId}/${Date.now()}.${extension(comp.mime, comp.nombreOriginal)}` : null;
      // monto_usd lo recalcula el servidor de BD con la tasa BCV del día del pago (trigger pagos_bi).
      const { rows } = await c.query(`insert into pagos (condominio_id, unidad_id, fecha_pago, metodo, moneda, monto, monto_usd,
          referencia, banco_origen, cuenta_destino_id, nota, comprobante_path)
        values ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11) returning id`,
        [cid, d.unidadId, d.fechaPago, d.metodo, d.moneda, d.monto, d.referencia ?? null, d.bancoOrigen ?? null,
         d.cuentaDestinoId ?? null, d.nota ?? null, ruta]);
      if (comp && ruta) await guardarArchivo(ctx, c, 'comprobantes', ruta, comp);
      return rows[0].id as string;
    });
    return rep.status(201).send({ id });
  });

  app.post('/c/:cid/pagos/:id/confirmar', async (req, rep) => {
    const p = ParamsC.extend({ id: Uuid }).parse(req.params);
    const d = z.object({ cuentaDestinoId: Uuid.optional() }).parse(req.body ?? {});
    await bd(req, async (c) => {
      const ok = await c.query(`select 1 from pagos where id = $1 and condominio_id = $2`, [p.id, p.cid]);
      if (!ok.rowCount) throw new ErrorApi(404, 'Pago no existe', 'no_encontrado');
      await c.query(`select confirmar_pago($1, $2)`, [p.id, d.cuentaDestinoId ?? null]);
    });
    return rep.status(204).send();
  });

  app.post('/c/:cid/pagos/:id/rechazar', async (req, rep) => {
    const p = ParamsC.extend({ id: Uuid }).parse(req.params);
    const d = z.object({ motivo: z.string().trim().min(3).max(300) }).parse(req.body);
    await bd(req, async (c) => {
      const ok = await c.query(`select 1 from pagos where id = $1 and condominio_id = $2`, [p.id, p.cid]);
      if (!ok.rowCount) throw new ErrorApi(404, 'Pago no existe', 'no_encontrado');
      await c.query(`select rechazar_pago($1, $2)`, [p.id, d.motivo]);
    });
    return rep.status(204).send();
  });

  // ---------- Gastos y recibos ----------
  app.get('/c/:cid/gastos', async (req): Promise<Gasto[]> => {
    const { cid } = ParamsC.parse(req.params);
    const { periodo } = z.object({ periodo: Periodo }).parse(req.query);
    const filas = await bd(req, async (c) => (await c.query(
      `select * from gastos where condominio_id = $1 and periodo = $2 order by fecha_gasto desc, creado_en desc`, [cid, periodo])).rows);
    return Promise.all(filas.map((g) => mapGasto(ctx, g)));
  });

  app.post('/c/:cid/gastos', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const { campos, archivos } = await leerFormulario(req);
    const d = z.object({
      periodo: Periodo, tipo: z.enum(['comun', 'no_comun', 'partida']).default('comun'),
      categoria: z.string().trim().min(2).max(60), descripcion: z.string().trim().min(2).max(300),
      moneda: Moneda, monto: Monto, tasaBcv: z.coerce.number().positive().optional(),
      unidadId: Uuid.optional(), partidaId: Uuid.optional(), cuentaId: Uuid.optional(), fechaGasto: Fecha.optional(),
    }).parse({ ...campos, tasaBcv: opt(campos.tasaBcv), unidadId: opt(campos.unidadId), partidaId: opt(campos.partidaId),
               cuentaId: opt(campos.cuentaId), fechaGasto: opt(campos.fechaGasto) });
    if (d.moneda === 'VES' && !d.tasaBcv) throw new ErrorApi(400, 'Indique la tasa BCV del gasto en bolívares', 'invalido');
    if (d.tipo === 'no_comun' && !d.unidadId) throw new ErrorApi(400, 'Indique el apartamento del gasto no común', 'invalido');
    if (d.tipo === 'partida' && !d.partidaId) throw new ErrorApi(400, 'Indique la partida especial', 'invalido');
    const factura = archivos.factura?.[0];
    const id = await bd(req, async (c) => {
      await exigirFinanzas(c, cid);
      const { rows } = await c.query(`insert into gastos (condominio_id, periodo, tipo, categoria, descripcion, moneda, monto,
          tasa_bcv, monto_usd, unidad_id, partida_id, cuenta_id, fecha_gasto)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $7, $9, $10, $11, coalesce($12::date, current_date)) returning id`,
        [cid, d.periodo, d.tipo, d.categoria, d.descripcion, d.moneda, d.monto, d.moneda === 'VES' ? d.tasaBcv : null,
         d.unidadId ?? null, d.partidaId ?? null, d.cuentaId ?? null, d.fechaGasto ?? null]);
      const gid = rows[0].id as string;
      if (factura) {
        const ruta = `${cid}/${gid}.${extension(factura.mime, factura.nombreOriginal)}`;
        await guardarArchivo(ctx, c, 'facturas', ruta, factura);
        await c.query(`update gastos set factura_path = $2 where id = $1`, [gid, ruta]);
      }
      return gid;
    });
    return rep.status(201).send({ id });
  });

  app.post('/c/:cid/recibos', async (req) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({ periodo: Periodo }).parse(req.body);
    const r = await bd(req, (c) => c.query(`select generar_recibos($1, $2) as n`, [cid, d.periodo]));
    return { emitidos: num(r.rows[0].n) };
  });

  // ---------- Conciliación bancaria ----------
  app.get('/c/:cid/conciliacion/movimientos', async (req): Promise<MovimientoBancario[]> => {
    const { cid } = ParamsC.parse(req.params);
    const { pendientes } = z.object({ pendientes: z.string().optional() }).parse(req.query);
    const filas = await bd(req, async (c) => {
      await exigirFinanzas(c, cid);
      return (await c.query(`
        select m.*, cu.nombre as cuenta, un.bloque, un.numero
          from movimientos_bancarios m
          join cuentas_financieras cu on cu.id = m.cuenta_id
          left join pagos p on p.id = m.pago_id
          left join unidades un on un.id = p.unidad_id
         where m.condominio_id = $1 and ($2 = false or (m.pago_id is null and m.monto > 0))
         order by m.fecha desc, m.creado_en desc limit 500`, [cid, pendientes === '1' || pendientes === 'true'])).rows;
    });
    return filas.map((m) => ({
      id: m.id, cuentaId: m.cuenta_id, cuenta: m.cuenta, fecha: m.fecha, referencia: m.referencia, descripcion: m.descripcion,
      monto: num(m.monto), moneda: m.moneda, origen: m.origen, pagoId: m.pago_id,
      unidad: m.numero ? etiquetaCorta(m.bloque, m.numero) : null,
    }));
  });

  app.post('/c/:cid/conciliacion/extractos', async (req): Promise<ResultadoExtracto> => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({
      cuentaId: Uuid, archivo: z.string().trim().min(1).max(200),
      movimientos: z.array(z.object({
        fecha: Fecha, referencia: z.string().max(60).nullable().default(''), descripcion: z.string().max(300).nullable().default(''),
        monto: z.number().refine((x) => x !== 0 && Math.abs(x) < 1e12, 'monto inválido'),
      })).min(1).max(5000),
    }).parse(req.body);
    const r = await bd(req, async (c) => {
      const cu = await c.query(`select 1 from cuentas_financieras where id = $1 and condominio_id = $2`, [d.cuentaId, cid]);
      if (!cu.rowCount) throw new ErrorApi(404, 'Cuenta no existe', 'no_encontrado');
      return (await c.query(`select * from cargar_extracto($1, $2, $3::jsonb)`, [d.cuentaId, d.archivo, JSON.stringify(d.movimientos)])).rows[0];
    });
    return { cargados: num(r.cargados), duplicados: num(r.duplicados), conciliados: num(r.conciliados) };
  });

  app.post('/c/:cid/conciliacion/movimientos/:id/asignar', async (req, rep) => {
    const p = ParamsC.extend({ id: Uuid }).parse(req.params);
    const d = z.object({ unidadId: Uuid }).parse(req.body);
    await bd(req, async (c) => {
      const ok = await c.query(`select 1 from unidades where id = $1 and condominio_id = $2`, [d.unidadId, p.cid]);
      if (!ok.rowCount) throw new ErrorApi(404, 'Unidad no existe', 'no_encontrado');
      await c.query(`select asignar_movimiento($1, $2)`, [p.id, d.unidadId]);
    });
    return rep.status(204).send();
  });

  // ---------- Mensualidad de ZentaPro (lo que el condominio le paga a la plataforma) ----------
  app.get('/c/:cid/zentapro/facturas', async (req): Promise<FacturaZentaPro[]> => {
    const { cid } = ParamsC.parse(req.params);
    const filas = await bd(req, async (c) => {
      await exigirFinanzas(c, cid);
      return (await c.query(`select f.*, pl.nombre as plan, abonado_usd_factura(f.id) as abonado_usd,
                                    (select usd_ves from tasas_bcv where fecha <= current_date order by fecha desc limit 1) as tasa_hoy,
                                    exists (select 1 from pagos_plataforma p where p.factura_id = f.id and p.estado = 'reportado') as pago_por_confirmar
                               from facturas_plataforma f left join planes pl on pl.id = f.plan_id
                              where f.condominio_id = $1 order by f.periodo desc`, [cid])).rows;
    });
    return filas.map((f) => {
      const saldoUsd = ['pagada', 'anulada'].includes(f.estado) ? 0 : Math.max(0, Math.round((num(f.monto_usd) - num(f.abonado_usd)) * 100) / 100);
      const tasaHoy = f.tasa_hoy == null ? null : num(f.tasa_hoy);
      return {
      id: f.id, periodo: f.periodo, plan: f.plan ?? null, montoUsd: num(f.monto_usd), tasaBcv: num(f.tasa_bcv), montoVes: num(f.monto_ves),
      abonadoUsd: num(f.abonado_usd), saldoUsd, tasaHoy, saldoVesHoy: tasaHoy == null ? null : Math.round(saldoUsd * tasaHoy * 100) / 100,
      vence: f.vence, estado: f.estado, numeroControl: f.numero_control, pagadaEn: iso(f.pagada_en),
      pagoPorConfirmar: Boolean(f.pago_por_confirmar),
    }; });
  });

  app.get('/zentapro/datos-pago', async (req): Promise<DatosPagoZentaPro> => {
    if (!req.usuarioId) throw new ErrorApi(401, 'Inicie sesión', 'sin_sesion');
    return JSON.parse(ctx.cfg.DATOS_PAGO_ZENTAPRO);
  });

  app.post('/c/:cid/zentapro/facturas/:id/pagos', async (req, rep) => {
    const p = ParamsC.extend({ id: Uuid }).parse(req.params);
    // ZentaPro cobra SOLO en bolívares; se convierte a dólares con la tasa BCV del día del pago.
    const d = z.object({ metodo: z.enum(['pago_movil', 'transferencia']), montoVes: z.number().positive().max(1e12),
                         referencia: z.string().trim().min(3).max(40), fechaPago: Fecha.optional() }).parse(req.body);
    const id = await bd(req, async (c) => {
      await exigirFinanzas(c, p.cid);
      const f = await c.query(`select estado from facturas_plataforma where id = $1 and condominio_id = $2`, [p.id, p.cid]);
      if (!f.rowCount) throw new ErrorApi(404, 'Factura no existe', 'no_encontrado');
      if (f.rows[0].estado === 'pagada' || f.rows[0].estado === 'anulada') throw new ErrorApi(400, 'Esa factura no admite pagos', 'invalido');
      return (await c.query(`insert into pagos_plataforma (factura_id, condominio_id, metodo, moneda, monto, referencia, reportado_por, fecha_pago)
                             values ($1, $2, $3, 'VES', $4, $5, auth.uid(), coalesce($6::date, current_date)) returning id`,
        [p.id, p.cid, d.metodo, d.montoVes, d.referencia, d.fechaPago ?? null])).rows[0].id as string;
    });
    return rep.status(201).send({ id });
  });
}
