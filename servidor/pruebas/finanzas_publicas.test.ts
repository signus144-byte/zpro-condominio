// v0.9 · 0028: mostrar los números del condominio a los vecinos es decisión de cada condominio (por defecto, nada).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, crearPrueba, type Prueba } from './_api.js';

let P: Prueba;
type U = { id: string; acceso: string };
let pres: U, teso: U, elena: U;
const MES = '2026-10-01';   // la semilla trae gastos de octubre

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  teso = await P.miembro('Jorge Tesorero', 'tesorero');
  elena = await P.miembro('Elena Castro', 'propietario', 'b3');
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

const ver = (u: U) => P.pedir('GET', `c/${C}/finanzas-publicas?periodo=${MES}`, u.acceso);
const gastos = async (u: U) => (await P.pedir('GET', `c/${C}/gastos?periodo=${MES}`, u.acceso)).json.length;
const fijar = (u: U, modo: string) => P.pedir('PUT', `c/${C}/finanzas-publicas`, u.acceso, { modo });
const avisos = async (u: U) => (await P.base.admin.query(
  `select cuerpo from notificaciones where usuario_id = $1 and titulo = 'Cuentas del condominio' order by creado_en`, [u.id])).rows;

describe('cuentas del condominio para los vecinos', () => {
  it('por defecto el vecino no ve nada del condominio; la junta ve la vista previa', async () => {
    assert.equal((await P.pedir('GET', `c/${C}/convivencia`, elena.acceso)).json.finanzasPublicas, 'no');
    const v = await ver(elena);
    assert.equal(v.status, 200);
    assert.equal(v.json, null);
    assert.equal(await gastos(elena), 0);
    const j = (await ver(teso)).json;
    assert.equal(j.modo, 'no');
    assert.ok(j.gastosUsd > 0);
    assert.ok(Array.isArray(j.cuentas), 'la junta ve los saldos');
  });

  it('solo presidencia o la administración decide', async () => {
    const r = await fijar(teso, 'detalle');
    assert.ok(r.status >= 400);
    assert.match(r.json.error, /presidencia o la administración/);
    assert.equal((await fijar(elena, 'detalle')).status >= 400, true);
    assert.equal((await fijar(pres, 'todo')).status, 400);
  });

  it('"totales": el vecino ve cuánto entró y se gastó (por categoría), sin cada gasto ni saldos', async () => {
    assert.equal((await fijar(pres, 'totales')).status, 204);
    const v = (await ver(elena)).json;
    assert.equal(v.modo, 'totales');
    assert.ok(v.gastosUsd > 0);
    assert.ok(v.gastosPorCategoria.length > 0);
    assert.equal(Math.round(v.gastosPorCategoria.reduce((s: number, g: any) => s + g.montoUsd, 0) * 100) / 100, v.gastosUsd);
    assert.equal(v.cuentas, null);
    assert.equal(await gastos(elena), 0, 'cada gasto solo con "detalle"');
    assert.ok(!('casas' in v) && !('pagos' in v), 'nunca quién pagó y quién no');
    assert.match((await avisos(elena)).at(-1).cuerpo, /publicó los totales/);
  });

  it('"detalle": además cada gasto y los saldos de las cuentas', async () => {
    assert.equal((await fijar(pres, 'detalle')).status, 204);
    const v = (await ver(elena)).json;
    assert.ok(v.cuentas.length >= 1);
    assert.equal(await gastos(elena), 4);
    assert.match((await avisos(elena)).at(-1).cuerpo, /cada gasto con su factura/);
  });

  it('al dejar de publicar, el vecino vuelve a no ver nada (y no se le avisa); la junta sí se entera', async () => {
    const antes = (await avisos(elena)).length;
    assert.equal((await fijar(pres, 'no')).status, 204);
    assert.equal((await ver(elena)).json, null);
    assert.equal(await gastos(elena), 0);
    assert.equal((await avisos(elena)).length, antes);
    assert.match((await avisos(teso)).at(-1).cuerpo, /Se dejaron de mostrar/);
    const b = await P.base.admin.query(`select antes, despues from bitacora where accion = 'finanzas_publicas' order by id desc limit 1`);
    assert.deepEqual(b.rows[0], { antes: { finanzas_publicas: 'detalle' }, despues: { finanzas_publicas: 'no' } });
  });
});
