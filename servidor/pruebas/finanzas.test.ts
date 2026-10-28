// Finanzas: recibos, estados de cuenta, pagos, gastos, panel, conciliación y mensualidad de ZentaPro.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, PNG, UNI, crearPrueba, formulario, type Prueba } from './_api.js';

let P: Prueba;
let teso: { id: string; acceso: string }, pres: { id: string; acceso: string };
let b33: { id: string; acceso: string }, b34: { id: string; acceso: string }, extrano: { acceso: string };
const hoy = () => new Date().toISOString().slice(0, 10);

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  teso = await P.miembro('Jorge Tesorero', 'tesorero');
  b33 = await P.miembro('Elena Castro', 'propietario', 'b3');
  b34 = await P.miembro('Pedro Salas', 'propietario', 'b4');
  extrano = await P.registrar('Extrano Total', 'extrano-fin@correo.com');
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

describe('recibos y estados de cuenta', () => {
  it('solo la junta con finanzas emite recibos; reparte por alícuota + 10 % de fondo', async () => {
    assert.equal((await P.pedir('POST', `c/${C}/recibos`, b33.acceso, { periodo: '2026-10-01' })).status, 403);
    const r = await P.pedir('POST', `c/${C}/recibos`, teso.acceso, { periodo: '2026-10-01' });
    assert.equal(r.status, 200);
    assert.equal(r.json.emitidos, 8);
    assert.equal((await P.pedir('POST', `c/${C}/recibos`, teso.acceso, { periodo: '2026-10-01' })).status, 400, 'no se emite dos veces');
    // Gastos comunes $1.000 (600 + 250 + Bs 21.550/215,5 + 50) → B-33 (14 %) = $140 + fondo $14 = $154
    const e = await P.pedir('GET', `c/${C}/unidades/${UNI('b3')}/estado-cuenta`, b33.acceso);
    assert.equal(e.status, 200);
    assert.equal(e.json.saldoUsd, 154);
    assert.equal(e.json.cargos.length, 2);
    assert.equal(e.json.unidad.alicuota, 14);
  });

  it('un vecino no ve el estado de cuenta de otra casa; un extraño tampoco', async () => {
    assert.equal((await P.pedir('GET', `c/${C}/unidades/${UNI('b3')}/estado-cuenta`, b34.acceso)).status, 403);
    assert.notEqual((await P.pedir('GET', `c/${C}/unidades/${UNI('b3')}/estado-cuenta`, extrano.acceso)).status, 200);
    assert.equal((await P.pedir('GET', `c/${C}/unidades/${UNI('b3')}/estado-cuenta`, pres.acceso)).status, 200, 'la junta sí');
  });

  it('unidades: la junta ve las 8 con saldo; el residente solo la suya', async () => {
    const j = await P.pedir('GET', `c/${C}/unidades`, pres.acceso);
    assert.equal(j.json.length, 8);
    assert.equal(j.json.find((u: { numero: string; bloque: string }) => u.bloque === 'B' && u.numero === '34').saldoUsd, 154);
    const r = await P.pedir('GET', `c/${C}/unidades`, b33.acceso);
    assert.deepEqual(r.json.map((u: { id: string }) => u.id), [UNI('b3')]);
  });
});

describe('pagos', () => {
  let pagoId = '';
  it('el residente reporta un Pago Móvil en Bs con comprobante: queda por confirmar y se convierte a $ con la tasa BCV', async () => {
    const f = formulario({ unidadId: UNI('b3'), fechaPago: hoy(), metodo: 'pago_movil', moneda: 'VES', monto: '21550', referencia: '00123456', bancoOrigen: 'Banesco' },
      [{ campo: 'comprobante', nombre: 'captura.png', mime: 'image/png', datos: PNG }]);
    const r = await P.pedir('POST', `c/${C}/pagos`, b33.acceso, f);
    assert.equal(r.status, 201, r.body);
    pagoId = r.json.id;
    const e = await P.pedir('GET', `c/${C}/unidades/${UNI('b3')}/estado-cuenta`, b33.acceso);
    const p = e.json.pagos.find((x: { id: string }) => x.id === pagoId);
    assert.equal(p.estado, 'reportado');
    assert.equal(p.montoUsd, 100);
    assert.equal(p.tasaBcv, 215.5);
    assert.equal(p.unidadEtiqueta, 'B-33');
    assert.equal(e.json.saldoUsd, 154, 'el saldo no cambia hasta confirmar');
    const img = await P.pedir('GET', p.comprobanteUrl.replace('http://prueba', ''));
    assert.equal(img.status, 200);
  });

  it('no puede reportar por otra casa ni repetir la referencia; fecha futura no', async () => {
    const otra = formulario({ unidadId: UNI('b4'), fechaPago: hoy(), metodo: 'zelle', moneda: 'USD', monto: '10', referencia: 'ZL1' });
    assert.equal((await P.pedir('POST', `c/${C}/pagos`, b33.acceso, otra)).status, 403);
    const dup = formulario({ unidadId: UNI('b3'), fechaPago: hoy(), metodo: 'pago_movil', moneda: 'VES', monto: '100', referencia: '00123456' });
    assert.equal((await P.pedir('POST', `c/${C}/pagos`, b33.acceso, dup)).status, 409);
    const fut = formulario({ unidadId: UNI('b3'), fechaPago: '2099-01-01', metodo: 'zelle', moneda: 'USD', monto: '10' });
    assert.equal((await P.pedir('POST', `c/${C}/pagos`, b33.acceso, fut)).status, 400);
  });

  it('la lista de pagos es de la junta; el residente no confirma', async () => {
    assert.equal((await P.pedir('GET', `c/${C}/pagos?estado=reportado`, b33.acceso)).status, 403);
    const l = await P.pedir('GET', `c/${C}/pagos?estado=reportado`, teso.acceso);
    assert.ok(l.json.some((x: { id: string }) => x.id === pagoId));
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${pagoId}/confirmar`, b33.acceso, {})).status, 403);
  });

  it('tesorería confirma → baja el saldo; rechazar exige motivo', async () => {
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${pagoId}/confirmar`, teso.acceso, {})).status, 204);
    assert.equal((await P.pedir('GET', `c/${C}/unidades/${UNI('b3')}/estado-cuenta`, b33.acceso)).json.saldoUsd, 54);
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${pagoId}/confirmar`, teso.acceso, {})).status, 400, 'ya revisado');
    const f = formulario({ unidadId: UNI('b4'), fechaPago: hoy(), metodo: 'zelle', moneda: 'USD', monto: '50', referencia: 'ZL-FALSO' });
    const otro = (await P.pedir('POST', `c/${C}/pagos`, b34.acceso, f)).json.id;
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${otro}/rechazar`, teso.acceso, { motivo: '' })).status, 400);
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${otro}/rechazar`, teso.acceso, { motivo: 'No aparece en Zelle' })).status, 204);
    const e = await P.pedir('GET', `c/${C}/unidades/${UNI('b4')}/estado-cuenta`, b34.acceso);
    assert.equal(e.json.pagos[0].motivoRechazo, 'No aparece en Zelle');
  });
});

describe('panel y gastos', () => {
  it('panel: solo junta; muestra facturado, deuda y saldos por cuenta', async () => {
    assert.equal((await P.pedir('GET', `c/${C}/panel`, b33.acceso)).status, 403);
    const p = await P.pedir('GET', `c/${C}/panel`, pres.acceso);
    assert.equal(p.status, 200);
    assert.equal(p.json.totalUnidades, 8);
    assert.equal(p.json.deudaTotalUsd, 1000, "facturado $1.100 − $100 confirmados");
    assert.equal(p.json.unidadesMorosas, 8);
    assert.ok(p.json.saldosCuentas.length >= 4);
  });

  it('gastos: todos los miembros ven la relación; solo finanzas registra (Bs con tasa, con factura)', async () => {
    assert.equal((await P.pedir('GET', `c/${C}/gastos?periodo=2026-10-01`, b33.acceso)).json.length, 4);
    assert.equal((await P.pedir('GET', `c/${C}/gastos?periodo=octubre`, b33.acceso)).status, 400);
    const f = formulario({ periodo: '2026-11-01', categoria: 'Agua', descripcion: 'Hidrocentro noviembre', moneda: 'VES', monto: '4310', tasaBcv: '215.5' },
      [{ campo: 'factura', nombre: 'factura.png', mime: 'image/png', datos: PNG }]);
    assert.equal((await P.pedir('POST', `c/${C}/gastos`, b33.acceso, f)).status, 403);
    const f2 = formulario({ periodo: '2026-11-01', categoria: 'Agua', descripcion: 'Hidrocentro noviembre', moneda: 'VES', monto: '4310', tasaBcv: '215.5' },
      [{ campo: 'factura', nombre: 'factura.png', mime: 'image/png', datos: PNG }]);
    assert.equal((await P.pedir('POST', `c/${C}/gastos`, teso.acceso, f2)).status, 201);
    const g = (await P.pedir('GET', `c/${C}/gastos?periodo=2026-11-01`, b34.acceso)).json[0];
    assert.equal(g.montoUsd, 20);
    assert.equal((await P.pedir('GET', g.facturaUrl.replace('http://prueba', ''))).status, 200, 'los vecinos ven la factura');
    const sinTasa = formulario({ periodo: '2026-11-01', categoria: 'Agua', descripcion: 'x', moneda: 'VES', monto: '10' });
    assert.equal((await P.pedir('POST', `c/${C}/gastos`, teso.acceso, sinTasa)).status, 400);
  });
});

describe('conciliación bancaria', () => {
  it('el extracto confirma solo el Pago Móvil que coincide; lo no identificado se asigna a una casa', async () => {
    const cuentas = (await P.pedir('GET', `c/${C}/cuentas`, teso.acceso)).json;
    const bs = cuentas.find((c: { tipo: string }) => c.tipo === 'banco_bs').id;
    const f = formulario({ unidadId: UNI('b4'), fechaPago: hoy(), metodo: 'pago_movil', moneda: 'VES', monto: '33187', referencia: '000123456789', cuentaDestinoId: bs });
    const pago = (await P.pedir('POST', `c/${C}/pagos`, b34.acceso, f)).json.id;
    const movs = [
      { fecha: hoy(), referencia: '123456789', descripcion: 'PAGO MOVIL RECIBIDO', monto: 33187 },
      { fecha: hoy(), referencia: '55550000', descripcion: 'PAGO MOVIL RECIBIDO', monto: 10000 },
      { fecha: hoy(), referencia: '', descripcion: 'COMISION', monto: -14 },
    ];
    assert.equal((await P.pedir('POST', `c/${C}/conciliacion/extractos`, b33.acceso, { cuentaId: bs, archivo: 'oct.xlsx', movimientos: movs })).status, 403);
    const r = await P.pedir('POST', `c/${C}/conciliacion/extractos`, teso.acceso, { cuentaId: bs, archivo: 'oct.xlsx', movimientos: movs });
    assert.deepEqual(r.json, { cargados: 3, duplicados: 0, conciliados: 1 });
    const e = await P.pedir('GET', `c/${C}/unidades/${UNI('b4')}/estado-cuenta`, b34.acceso);
    assert.equal(e.json.pagos.find((x: { id: string }) => x.id === pago).estado, 'confirmado');
    const pend = (await P.pedir('GET', `c/${C}/conciliacion/movimientos?pendientes=1`, teso.acceso)).json;
    assert.equal(pend.length, 1);
    assert.equal((await P.pedir('POST', `c/${C}/conciliacion/movimientos/${pend[0].id}/asignar`, teso.acceso, { unidadId: UNI('a1') })).status, 204);
    const todos = (await P.pedir('GET', `c/${C}/conciliacion/movimientos`, teso.acceso)).json;
    assert.deepEqual(todos.filter((m: { unidad: string | null }) => m.unidad).map((m: { unidad: string }) => m.unidad).sort(), ['A-11', 'B-34']);
    assert.equal((await P.pedir('POST', `c/${C}/conciliacion/extractos`, teso.acceso, { cuentaId: bs, archivo: 'oct.xlsx', movimientos: movs })).json.duplicados, 3);
  });
});

describe('mensualidad de ZentaPro', () => {
  it('finanzas ve sus facturas y reporta el pago; un residente no', async () => {
    const f = (await P.base.admin.query(`insert into facturas_plataforma (condominio_id, periodo, plan_id, unidades_facturadas, precio_usd_unidad,
        monto_usd, tasa_bcv, monto_ves, vence) values ($1, '2026-11-01', 'completo', 8, 0.45, 40, 215.5, 8620, '2026-11-10') returning id`, [C])).rows[0].id;
    assert.equal((await P.pedir('GET', `c/${C}/zentapro/facturas`, b33.acceso)).status, 403);
    const l = await P.pedir('GET', `c/${C}/zentapro/facturas`, teso.acceso);
    assert.equal(l.json[0].montoVes, 8620);
    assert.equal((await P.pedir('GET', 'zentapro/datos-pago', teso.acceso)).json.rif, 'J-00000000-0');
    const tasaHoy = l.json[0].tasaHoy as number;
    assert.ok(tasaHoy > 0);
    assert.equal(l.json[0].saldoUsd, 40);
    assert.equal(l.json[0].saldoVesHoy, Math.round(40 * tasaHoy * 100) / 100, 'se cobra a la tasa BCV de hoy');
    // Solo bolívares: Zelle o dólares no se aceptan.
    assert.equal((await P.pedir('POST', `c/${C}/zentapro/facturas/${f}/pagos`, teso.acceso, { metodo: 'zelle', montoVes: 40, referencia: 'ZL1' })).status, 400);
    assert.equal((await P.pedir('POST', `c/${C}/zentapro/facturas/${f}/pagos`, teso.acceso, { metodo: 'pago_movil', moneda: 'USD', monto: 40, referencia: 'X1' })).status, 400);
    const r = await P.pedir('POST', `c/${C}/zentapro/facturas/${f}/pagos`, teso.acceso, { metodo: 'pago_movil', montoVes: 8620, referencia: '778899' });
    assert.equal(r.status, 201, r.body);
    const pg = (await P.base.admin.query(`select moneda, tasa_bcv, monto_usd from pagos_plataforma where id = $1`, [r.json.id])).rows[0];
    assert.equal(pg.moneda, 'VES');
    assert.equal(Number(pg.monto_usd), Math.round((8620 / Number(pg.tasa_bcv)) * 100) / 100, 'convertido a la tasa del día del pago');
    assert.equal((await P.pedir('GET', `c/${C}/zentapro/facturas`, teso.acceso)).json[0].pagoPorConfirmar, true);
    assert.equal((await P.pedir('POST', `c/${C}/zentapro/facturas/${f}/pagos`, b33.acceso, { metodo: 'pago_movil', montoVes: 1, referencia: '111' })).status, 403);
  });
});

describe('tasa BCV manual', () => {
  it('la presidenta carga y luego corrige la tasa del mismo día; un residente no puede', async () => {
    const pres = await P.miembro('Pres Tasa', 'presidente');
    const res = await P.miembro('Res Tasa', 'propietario', 'a2');
    assert.equal((await P.pedir('POST', `c/${C}/tasa-bcv`, pres.acceso, { usdVes: 230.5 })).status, 204);
    assert.equal((await P.pedir('POST', `c/${C}/tasa-bcv`, pres.acceso, { usdVes: 231.25 })).status, 204, 'corregir la del mismo día');
    assert.equal((await P.pedir('GET', 'tasa-bcv', res.acceso)).json.usdVes, 231.25);
    assert.equal((await P.pedir('POST', `c/${C}/tasa-bcv`, res.acceso, { usdVes: 1 })).status, 403);
  });
});
