// Notificaciones: aviso a la casa cuando su pago se aprueba o se rechaza, aviso y recordatorio diario a la junta
// mientras haya pagos sin revisar, y aviso a todos cuando la junta enciende o apaga el chat entre vecinos.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, PNG, UNI, crearPrueba, formulario, type Prueba } from './_api.js';
import { recordarPagosPendientes } from '../src/tareas/index.js';

let P: Prueba;
type U = { id: string; acceso: string };
let pres: U, teso: U, b33: U, b33b: U, b34: U;
const hoy = () => new Date().toISOString().slice(0, 10);
const bandeja = async (u: U, q = '') => (await P.pedir('GET', `notificaciones${q}`, u.acceso)).json as {
  noLeidas: number; notificaciones: { id: string; tipo: string; titulo: string; cuerpo: string; datos: Record<string, unknown>; leida: boolean }[] };

async function reportar(u: U, unidad: string, monto: string, referencia: string, moneda = 'VES') {
  const f = formulario({ unidadId: UNI(unidad), fechaPago: hoy(), metodo: moneda === 'VES' ? 'pago_movil' : 'zelle', moneda, monto, referencia },
    [{ campo: 'comprobante', nombre: 'captura.png', mime: 'image/png', datos: PNG }]);
  const r = await P.pedir('POST', `c/${C}/pagos`, u.acceso, f);
  assert.equal(r.status, 201, r.body);
  return r.json.id as string;
}

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  teso = await P.miembro('Jorge Tesorero', 'tesorero');
  b33 = await P.miembro('Elena Castro', 'propietario', 'b3');
  b33b = await P.miembro('Raul Castro', 'inquilino', 'b3');
  b34 = await P.miembro('Pedro Salas', 'propietario', 'b4');
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

describe('pagos de las casas', () => {
  let pago1 = '', pago2 = '';

  it('al reportar, la junta (finanzas) recibe "Pago por revisar"; los vecinos no', async () => {
    pago1 = await reportar(b33, 'b3', '21550', '00112233');
    for (const u of [pres, teso]) {
      const b = await bandeja(u);
      const n = b.notificaciones.find((x) => x.datos.pagoId === pago1)!;
      assert.equal(n.tipo, 'pago_reportado');
      assert.equal(n.titulo, 'Pago por revisar: Apto B-33');
      assert.match(n.cuerpo, /reportó Bs 21\.550,00 \(ref\. 00112233\)/);
      assert.equal(n.datos.pantalla, 'pagos');
    }
    assert.equal((await bandeja(b34)).notificaciones.length, 0);
  });

  it('al aprobar, TODAS las personas de la casa reciben "Pago aprobado" con su saldo', async () => {
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${pago1}/confirmar`, teso.acceso, {})).status, 204);
    for (const u of [b33, b33b]) {
      const n = (await bandeja(u)).notificaciones.find((x) => x.datos.pagoId === pago1)!;
      assert.equal(n.tipo, 'pago_confirmado');
      assert.equal(n.titulo, 'Pago aprobado');
      assert.match(n.cuerpo, /aprobó su pago de Bs 21\.550,00 \(ref\. 00112233\)/);
      assert.match(n.cuerpo, /Saldo pendiente: \$|Está al día/);
      assert.equal(n.leida, false);
    }
    assert.ok(!(await bandeja(b34)).notificaciones.some((x) => x.datos.pagoId === pago1), 'otra casa no se entera');
  });

  it('al rechazar, la casa recibe "Pago rechazado" con el motivo', async () => {
    pago2 = await reportar(b34, 'b4', '50', 'ZL-77', 'USD');
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${pago2}/rechazar`, teso.acceso, { motivo: 'No aparece en Zelle' })).status, 204);
    const n = (await bandeja(b34)).notificaciones.find((x) => x.datos.pagoId === pago2)!;
    assert.equal(n.tipo, 'pago_rechazado');
    assert.match(n.cuerpo, /rechazó su pago de \$50,00 \(ref\. ZL-77\)\. Motivo: No aparece en Zelle/);
  });

  it('marcar como leídas: una, y luego todas; nadie marca las de otro', async () => {
    let b = await bandeja(b33);
    assert.ok(b.noLeidas >= 1);
    const una = b.notificaciones[0].id;
    assert.equal((await P.pedir('POST', 'notificaciones/leidas', b34.acceso, { ids: [una] })).json.marcadas, 0);
    assert.equal((await P.pedir('POST', 'notificaciones/leidas', b33.acceso, { ids: [una] })).json.marcadas, 1);
    b = await bandeja(b33);
    assert.equal(b.notificaciones.find((x) => x.id === una)!.leida, true);
    await P.pedir('POST', 'notificaciones/leidas', b33.acceso, {});
    assert.equal((await bandeja(b33)).noLeidas, 0);
    assert.equal((await P.pedir('GET', 'notificaciones', null)).status, 401);
  });

  it('nadie puede crear ni modificar notificaciones directamente', async () => {
    const r = await P.base.api.query(`select 1`);   // conexión del API
    assert.ok(r);
    const c = await P.base.api.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.uid', $1, true)`, [b34.id]);
      await c.query('set local role authenticated');
      await assert.rejects(c.query(`insert into notificaciones (usuario_id, tipo, titulo, cuerpo) values ($1, 'general', 'x', 'y')`, [b34.id]));
    } finally { await c.query('rollback'); c.release(); }
    const c2 = await P.base.api.connect();
    try {
      await c2.query('begin');
      await c2.query(`select set_config('app.uid', $1, true)`, [b34.id]);
      await c2.query('set local role authenticated');
      await assert.rejects(c2.query(`select notificar(array[$1::uuid], null, 'general', 'x', 'y')`, [b34.id]));
      const upd = await c2.query(`update notificaciones set titulo = 'hack'`).catch(() => ({ rowCount: 0 }));
      assert.equal(upd.rowCount, 0);
    } finally { await c2.query('rollback'); c2.release(); }
  });
});

describe('recordatorio diario a la junta', () => {
  it('mientras haya pagos sin revisar, la junta recibe un recordatorio (uno por día, con correo)', async () => {
    await reportar(b33, 'b3', '1000', 'REC-1');
    await reportar(b34, 'b4', '20', 'REC-2', 'USD');
    // El más antiguo, de hace 3 días.
    await P.base.admin.query(`update pagos set creado_en = now() - interval '3 days' where referencia = 'REC-1'`);
    const r = await recordarPagosPendientes(P.app.ctx);
    assert.equal(r.condominios, 1);
    assert.equal(r.pagosPendientes, 2);
    assert.ok(r.personasAvisadas >= 2, 'presidenta y tesorero');
    const n = (await bandeja(teso)).notificaciones.find((x) => x.tipo === 'pagos_pendientes')!;
    assert.equal(n.titulo, '2 pagos por aprobar o rechazar');
    assert.match(n.cuerpo, /hace 3 días/);
    assert.match(n.cuerpo, /Bs 1\.000,00 \+ \$20,00/);
    assert.equal(n.datos.pendientes, 2);
    assert.ok(!(await bandeja(b33)).notificaciones.some((x) => x.tipo === 'pagos_pendientes'), 'los residentes no lo reciben');
    // Repetirla el mismo día no duplica.
    assert.equal((await recordarPagosPendientes(P.app.ctx)).personasAvisadas, 0);
  });

  it('cuando ya no quedan pagos por revisar, no hay recordatorio', async () => {
    const pend = (await P.pedir('GET', `c/${C}/pagos?estado=reportado`, teso.acceso)).json as { id: string }[];
    for (const p of pend) assert.equal((await P.pedir('POST', `c/${C}/pagos/${p.id}/confirmar`, teso.acceso, {})).status, 204);
    assert.equal((await recordarPagosPendientes(P.app.ctx)).condominios, 0);
  });
});

describe('chat entre vecinos', () => {
  it('cuando la junta lo apaga o lo enciende, todos los miembros reciben el aviso', async () => {
    assert.equal((await P.pedir('PUT', `c/${C}/chat-vecinos`, pres.acceso, { activo: false })).status, 204);
    for (const u of [b33, b34, teso]) {
      const n = (await bandeja(u)).notificaciones.find((x) => x.tipo === 'chat_vecinos')!;
      assert.equal(n.titulo, 'Chat entre vecinos desactivado');
    }
    // Repetir el mismo valor no avisa de nuevo.
    await P.pedir('PUT', `c/${C}/chat-vecinos`, pres.acceso, { activo: false });
    assert.equal((await bandeja(b34)).notificaciones.filter((x) => x.tipo === 'chat_vecinos').length, 1);
  });
});

describe('preferencia de correo', () => {
  it('cada persona puede apagar los avisos por correo', async () => {
    assert.equal((await P.pedir('GET', 'auth/yo', b33.acceso)).json.usuario.avisosPorCorreo, true);
    assert.equal((await P.pedir('PATCH', 'auth/yo', b33.acceso, { avisosPorCorreo: false })).status, 204);
    assert.equal((await P.pedir('GET', 'auth/yo', b33.acceso)).json.usuario.avisosPorCorreo, false);
  });
});

describe('CORS', () => {
  it('la app desde otro origen puede usar PUT, PATCH y DELETE', async () => {
    const r = await P.app.inject({ method: 'OPTIONS', url: `/api/v1/c/${C}/chat-vecinos`,
      headers: { origin: 'http://localhost:8080', 'access-control-request-method': 'PUT' } });
    assert.equal(r.statusCode, 204);
    for (const m of ['PUT', 'PATCH', 'DELETE']) assert.match(String(r.headers['access-control-allow-methods']), new RegExp(m));
  });
});
