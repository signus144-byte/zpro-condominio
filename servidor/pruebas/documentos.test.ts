// Documentos: registro con código, solvencia (solo sin deuda) y verificación pública (JSON y página HTML).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, UNI, crearPrueba, formulario, type Prueba } from './_api.js';

let P: Prueba;
let teso: { acceso: string }, b33: { acceso: string }, b34: { acceso: string };

before(async () => {
  P = await crearPrueba();
  teso = await P.miembro('Jorge Tesorero', 'tesorero');
  b33 = await P.miembro('Elena Castro', 'propietario', 'b3');
  b34 = await P.miembro('Pedro Salas', 'propietario', 'b4');
  await P.pedir('POST', `c/${C}/recibos`, teso.acceso, { periodo: '2026-10-01' });
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

describe('documentos', () => {
  it('el residente registra el estado de cuenta de SU unidad; no de otra; no actas', async () => {
    const r = await P.pedir('POST', `c/${C}/documentos`, b33.acceso, { tipo: 'estado_cuenta', formato: 'pdf', unidadId: UNI('b3') });
    assert.equal(r.status, 200);
    assert.match(r.json.codigo, /^[A-Z2-9]{10}$/);
    assert.equal((await P.pedir('POST', `c/${C}/documentos`, b33.acceso, { tipo: 'estado_cuenta', formato: 'pdf', unidadId: UNI('b4') })).status, 403);
    assert.equal((await P.pedir('POST', `c/${C}/documentos`, b33.acceso, { tipo: 'acta_votacion', formato: 'pdf' })).status, 403);
    assert.equal((await P.pedir('POST', `c/${C}/documentos`, teso.acceso, { tipo: 'relacion_gastos', formato: 'xlsx', periodo: '2026-10-01' })).status, 200);
  });

  it('solvencia: se niega si la unidad debe; tras pagar se emite y se verifica sin sesión', async () => {
    const no = await P.pedir('POST', `c/${C}/unidades/${UNI('b3')}/solvencia`, b33.acceso);
    assert.equal(no.status, 400);
    assert.match(no.json.error, /saldo pendiente/);
    assert.equal((await P.pedir('POST', `c/${C}/unidades/${UNI('b3')}/solvencia`, b34.acceso)).status, 403, 'no la de otra casa');
    const f = formulario({ unidadId: UNI('b3'), fechaPago: new Date().toISOString().slice(0, 10), metodo: 'zelle', moneda: 'USD', monto: '154', referencia: 'ZL998877' });
    const pago = (await P.pedir('POST', `c/${C}/pagos`, b33.acceso, f)).json.id;
    await P.pedir('POST', `c/${C}/pagos/${pago}/confirmar`, teso.acceso, {});
    const s = await P.pedir('POST', `c/${C}/unidades/${UNI('b3')}/solvencia`, b33.acceso);
    assert.equal(s.status, 200);
    const v = await P.pedir('GET', `verificar/${s.json.codigo.toLowerCase()}`);
    assert.equal(v.status, 200);
    assert.deepEqual({ tipo: v.json.tipo, unidad: v.json.unidad, vigente: v.json.vigente }, { tipo: 'solvencia', unidad: 'Apto B-33', vigente: true });
    assert.equal(v.json.condominio, 'Residencias Los Samanes (demo)');
    assert.equal((await P.pedir('GET', 'verificar/NOEXISTE00')).status, 404);
    assert.equal((await P.pedir('GET', 'verificar/../../x')).status, 404);

    const html = await P.pedir('GET', `/verificar/${s.json.codigo}`);
    assert.equal(html.status, 200);
    assert.match(String(html.headers['content-type']), /text\/html/);
    assert.match(html.body, /auténtico y vigente/);
    assert.match(html.body, /Apto B-33/);
    const falso = await P.pedir('GET', '/verificar/ZZZZZZZZZZ');
    assert.equal(falso.status, 404);
    assert.match(falso.body, /no encontrado/i);
    const red = await P.pedir('GET', `/verificar?c=${s.json.codigo}`);
    assert.equal(red.status, 302);
    const xss = await P.pedir('GET', '/verificar/%3Cscript%3E');
    assert.equal(xss.status, 400);
    assert.ok(!xss.body.includes('<script>'));
  });
});
