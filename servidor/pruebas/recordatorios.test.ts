// v0.10 · 0029: recordatorio amable a cada casa, 3 días antes de vencer su recibo y el día después.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, UNI, crearPrueba, formulario, type Prueba } from './_api.js';
import { recordarVencimientos } from '../src/tareas/index.js';

let P: Prueba;
type U = { id: string; acceso: string };
let pres: U, teso: U, vocal: U, elena: U, pedro: U;
let vence = '';
const dias = (f: string, n: number) => new Date(Date.parse(f + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10);

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  teso = await P.miembro('Jorge Tesorero', 'tesorero');
  vocal = await P.miembro('Rosa Vocal', 'vocal');
  elena = await P.miembro('Elena Castro', 'propietario', 'b3');
  pedro = await P.miembro('Pedro Salas', 'propietario', 'b4');
  assert.equal((await P.pedir('POST', `c/${C}/recibos`, teso.acceso, { periodo: '2026-10-01' })).status, 200);
  vence = (await P.base.admin.query(`select vence::text v from recibos where unidad_id = $1`, [UNI('b3')])).rows[0].v;
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

const avisos = async (u: U) => (await P.base.admin.query(
  `select titulo, cuerpo, datos from notificaciones where usuario_id = $1 and tipo = 'recordatorio_pago' order by creado_en`, [u.id])).rows;

describe('recordatorio de vencimiento', () => {
  it('3 días antes: cada casa con saldo recibe un recordatorio con su monto (solo una vez ese día)', async () => {
    const r = await recordarVencimientos(P.app.ctx, dias(vence, -3));
    assert.ok(r.avisos >= 2, JSON.stringify(r));
    const a = await avisos(elena);
    assert.equal(a.length, 1, JSON.stringify(a));
    assert.match(a[0].titulo, /^Su recibo vence el \d\d\/\d\d$/);
    assert.match(a[0].cuerpo, /recibo de octubre 2026 vence el .* Pendiente: \$154,00\. Puede pagarlo desde la app/);
    assert.equal(a[0].datos.pantalla, 'pagar');
    assert.equal((await avisos(pres)).length, 0, 'la junta sin casa no recibe recordatorio');
    await recordarVencimientos(P.app.ctx, dias(vence, -3));
    assert.equal((await avisos(elena)).length, 1, 'no se repite');
    await recordarVencimientos(P.app.ctx, dias(vence, -2));
    assert.equal((await avisos(elena)).length, 1, 'los otros días no se recuerda');
  });

  it('el día después de vencer; si la casa ya reportó un pago en revisión, no se le molesta', async () => {
    const f = formulario({ unidadId: UNI('b4'), fechaPago: dias(vence, -1) > new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : dias(vence, -1),
                           metodo: 'zelle', moneda: 'USD', monto: '154', referencia: 'Z-778899' });
    assert.equal((await P.pedir('POST', `c/${C}/pagos`, pedro.acceso, f)).status, 201);
    await recordarVencimientos(P.app.ctx, dias(vence, 1));
    const a = await avisos(elena);
    assert.equal(a.length, 2);
    assert.equal(a[1].titulo, 'Su recibo venció ayer');
    assert.match(a[1].cuerpo, /Si ya pagó, repórtelo en Pagar/);
    assert.equal((await avisos(pedro)).length, 1, 'Pedro ya reportó su pago: solo tuvo el aviso previo');
  });

  it('la junta lo puede apagar (vocales y vecinos no)', async () => {
    assert.equal((await P.pedir('GET', `c/${C}/convivencia`, elena.acceso)).json.recordatorioVencimiento, true);
    assert.ok((await P.pedir('PUT', `c/${C}/recordatorio-vencimiento`, vocal.acceso, { activo: false })).status >= 400);
    assert.ok((await P.pedir('PUT', `c/${C}/recordatorio-vencimiento`, elena.acceso, { activo: false })).status >= 400);
    assert.equal((await P.pedir('PUT', `c/${C}/recordatorio-vencimiento`, teso.acceso, { activo: false })).status, 204);
    assert.equal((await P.pedir('GET', `c/${C}/convivencia`, pres.acceso)).json.recordatorioVencimiento, false);
    await P.base.admin.query(`delete from notificaciones where tipo = 'recordatorio_pago'`);
    const r = await recordarVencimientos(P.app.ctx, dias(vence, -3));
    assert.equal(r.avisos, 0);
    assert.equal((await avisos(elena)).length, 0);
  });
});
