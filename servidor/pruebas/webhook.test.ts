// Webhook bancario: el banco avisa un crédito → se registra y se concilia con el pago reportado por la casa.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { C, UNI, crearPrueba, type Prueba } from './_api.js';

let P: Prueba;
const TOKEN = 'token-webhook-prueba-0123456789';
const SECRETO = 'secreto-hmac-del-banco';
let pagoId: string;

before(async () => {
  P = await crearPrueba({ SECRETOS_BANCOS: JSON.stringify({ banco_demo: SECRETO }) });
  const cuenta = (await P.base.admin.query(`select id from cuentas_financieras where condominio_id = $1 and tipo = 'banco_bs'`, [C])).rows[0].id;
  await P.base.admin.query(`insert into conexiones_bancarias (condominio_id, cuenta_id, proveedor, secreto_vault, webhook_token)
                            values ($1, $2, 'generico', 'banco_demo', $3), ($1, $2, 'generico', 'sin_secreto', 'token-sin-secreto-0123456789')`,
    [C, cuenta, TOKEN]);
  pagoId = (await P.base.admin.query(`insert into pagos (condominio_id, unidad_id, fecha_pago, metodo, moneda, monto, monto_usd, referencia, cuenta_destino_id)
    values ($1, $2, current_date, 'pago_movil', 'VES', 21550, 1, '000123456789', $3) returning id`, [C, UNI('b4'), cuenta])).rows[0].id;
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
function avisar(cuerpo: string, firma: string, token = TOKEN) {
  return P.app.inject({ method: 'POST', url: `/api/v1/webhooks/banco?t=${token}`, payload: cuerpo,
                        headers: { 'content-type': 'application/json', 'x-firma': firma } });
}
const firmar = (s: string, secreto = SECRETO) => createHmac('sha256', secreto).update(s).digest('hex');

describe('POST /api/v1/webhooks/banco', () => {
  it('firma inválida → 401 y no registra nada', async () => {
    const cuerpo = JSON.stringify({ fecha: hoy(), referencia: '123456789', monto: 21550 });
    assert.equal((await avisar(cuerpo, firmar(cuerpo, 'otro-secreto'))).statusCode, 401);
    assert.equal((await avisar(cuerpo, '')).statusCode, 401);
    assert.equal((await P.base.admin.query(`select count(*)::int n from movimientos_bancarios`)).rows[0].n, 0);
  });

  it('conexión desconocida → 404; sin secreto configurado → 503', async () => {
    const cuerpo = JSON.stringify({ fecha: hoy(), referencia: '1', monto: 1 });
    assert.equal((await avisar(cuerpo, firmar(cuerpo), 'token-que-no-existe-0000000')).statusCode, 404);
    assert.equal((await avisar(cuerpo, firmar(cuerpo), 'token-sin-secreto-0123456789')).statusCode, 503);
  });

  it('firma válida: registra el movimiento y confirma solo el Pago Móvil de B-34', async () => {
    const cuerpo = JSON.stringify({ fecha: hoy(), referencia: '123456789', monto: 21550, descripcion: 'PAGO MOVIL 0414' });
    const r = await avisar(cuerpo, firmar(cuerpo));
    assert.equal(r.statusCode, 200);
    assert.deepEqual(JSON.parse(r.body), { ok: true, duplicado: false, conciliado: true });
    const p = (await P.base.admin.query(`select estado, confirmado_por_via from pagos where id = $1`, [pagoId])).rows[0];
    assert.equal(p.estado, 'confirmado');
    assert.equal(p.confirmado_por_via, 'api');
  });

  it('el banco reintenta el mismo aviso: no se duplica', async () => {
    const cuerpo = JSON.stringify({ fecha: hoy(), referencia: '123456789', monto: 21550, descripcion: 'PAGO MOVIL 0414' });
    const r = await avisar(cuerpo, firmar(cuerpo));
    assert.deepEqual(JSON.parse(r.body), { ok: true, duplicado: true, conciliado: false });
    assert.equal((await P.base.admin.query(`select count(*)::int n from movimientos_bancarios`)).rows[0].n, 1);
  });

  it('dinero sin pago reportado queda como movimiento pendiente de asignar', async () => {
    const cuerpo = JSON.stringify({ fecha: hoy(), referencia: '55550000', monto: 10000 });
    assert.deepEqual(JSON.parse((await avisar(cuerpo, firmar(cuerpo))).body), { ok: true, duplicado: false, conciliado: false });
    const m = (await P.base.admin.query(`select pago_id, origen from movimientos_bancarios where referencia = '55550000'`)).rows[0];
    assert.equal(m.pago_id, null);
    assert.equal(m.origen, 'api');
  });

  it('datos inválidos firmados → 400', async () => {
    const cuerpo = JSON.stringify({ fecha: 'ayer', referencia: '1', monto: -5 });
    assert.equal((await avisar(cuerpo, firmar(cuerpo))).statusCode, 400);
  });
});
