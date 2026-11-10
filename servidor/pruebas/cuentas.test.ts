// v0.9: datos para pagar por campos (banco, teléfono, cédula o RIF, cuenta, correo), QR del banco y aviso a la junta.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, PNG, crearPrueba, formulario, type Prueba } from './_api.js';

let P: Prueba;
type U = { id: string; acceso: string };
let pres: U, teso: U, vocal: U, elena: U;
let bs = '';

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  teso = await P.miembro('Jorge Tesorero', 'tesorero');
  vocal = await P.miembro('Rosa Vocal', 'vocal');
  elena = await P.miembro('Elena Castro', 'propietario', 'b3');
  const l = (await P.pedir('GET', `c/${C}/cuentas`, elena.acceso)).json;
  bs = l.find((c: any) => c.tipo === 'banco_bs').id;
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

const notifs = async (u: U) =>
  (await P.base.admin.query(`select titulo, cuerpo, datos from notificaciones where usuario_id = $1 and tipo = 'datos_pago' order by creado_en`, [u.id])).rows;
const cuenta = async (u: U, id = bs) => (await P.pedir('GET', `c/${C}/cuentas`, u.acceso)).json.find((c: any) => c.id === id);

describe('datos para pagar', () => {
  it('un vecino ve las cuentas pero no puede cambiarlas', async () => {
    assert.ok(await cuenta(elena));
    const r = await P.pedir('PUT', `c/${C}/cuentas/${bs}`, elena.acceso, { telefono: '04140000000' });
    assert.equal(r.status, 403);
  });

  it('tesorería los guarda por campos, normalizados (sin guiones ni puntos)', async () => {
    const r = await P.pedir('PUT', `c/${C}/cuentas/${bs}`, teso.acceso, {
      bancoCodigo: '0134', titular: 'Asociación Residencias Los Samanes', documento: 'j-30123456-7',
      telefono: '0414-123.45.67', numeroCuenta: '0134-0001-23-4567890123',
    });
    assert.equal(r.status, 204, r.body);
    const c = await cuenta(elena);
    assert.equal(c.bancoCodigo, '0134');
    assert.equal(c.telefono, '04141234567');
    assert.equal(c.documento, 'J301234567');
    assert.equal(c.numeroCuenta, '01340001234567890123');
    assert.match(c.datosPago, /Pago Móvil 0134 Banesco · 0414-1234567/);
    assert.match(c.datosPago, /J-30123456-7/);
    assert.equal(c.actualizadoPor, 'Jorge Tesorero');
    assert.ok(c.actualizadoEn);
  });

  it('acepta +58 en el teléfono y V con puntos en la cédula', async () => {
    assert.equal((await P.pedir('PUT', `c/${C}/cuentas/${bs}`, teso.acceso, { telefono: '+58 424 555 1234', documento: 'V-12.345.678' })).status, 204);
    const c = await cuenta(elena);
    assert.equal(c.telefono, '04245551234');
    assert.equal(c.documento, 'V12345678');
  });

  it('rechaza datos que harían fallar el pago', async () => {
    const malo = async (cuerpo: object, patron: RegExp) => {
      const r = await P.pedir('PUT', `c/${C}/cuentas/${bs}`, teso.acceso, cuerpo);
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
      assert.match(r.json.error, patron);
    };
    await malo({ telefono: '0212-1234567' }, /celular de 11 dígitos/);
    await malo({ documento: '12345678' }, /V, E, J, G o P/);
    await malo({ bancoCodigo: '9999' }, /banco de la lista/);
    await malo({ numeroCuenta: '0134123' }, /20 dígitos/);
    await malo({ bancoCodigo: '0102', numeroCuenta: '01340001234567890123' }, /empezar por 0102/);
    await malo({ correo: 'no-es-correo' }, /correo/);
    // Nada de eso cambió lo guardado
    assert.equal((await cuenta(elena)).telefono, '04245551234');
  });

  it('cada cambio avisa a toda la junta (menos a quien lo hizo), con quién y qué cambió', async () => {
    const aPres = await notifs(pres);
    assert.ok(aPres.length >= 2);
    const ultimo = aPres[aPres.length - 1];
    assert.equal(ultimo.titulo, 'Cambiaron los datos para pagar');
    assert.match(ultimo.cuerpo, /Jorge Tesorero cambió "Banco \(Bs\) · Pago Móvil": cédula o RIF, teléfono de Pago Móvil/);
    assert.equal(ultimo.datos.cuentaId, bs);
    assert.ok((await notifs(vocal)).length >= 2, 'el vocal también se entera');
    assert.equal((await notifs(teso)).length, 0, 'quien lo cambió no se avisa a sí mismo');
    assert.equal((await notifs(elena)).length, 0, 'los vecinos no reciben este aviso');
  });

  it('borrar un dato (null o vacío) lo quita', async () => {
    assert.equal((await P.pedir('PUT', `c/${C}/cuentas/${bs}`, pres.acceso, { numeroCuenta: '' })).status, 204);
    assert.equal((await cuenta(elena)).numeroCuenta, null);
  });

  it('QR del banco: lo sube la junta, se guarda en PNG y el vecino lo ve', async () => {
    const f = () => formulario({}, [{ campo: 'qr', nombre: 'mi-qr.png', mime: 'image/png', datos: PNG }]);
    assert.equal((await P.pedir('PUT', `c/${C}/cuentas/${bs}/qr`, elena.acceso, f())).status, 403);
    const r = await P.pedir('PUT', `c/${C}/cuentas/${bs}/qr`, teso.acceso, f());
    assert.equal(r.status, 204, r.body);
    const c = await cuenta(elena);
    assert.ok(c.qrUrl);
    const img = await P.pedir('GET', c.qrUrl.replace('http://prueba', ''));
    assert.equal(img.status, 200);
    assert.match(String(img.headers['content-type']), /image\/png/);
    assert.match((await notifs(pres)).at(-1).cuerpo, /QR del banco/);
    const malo = await P.pedir('PUT', `c/${C}/cuentas/${bs}/qr`, teso.acceso,
      formulario({}, [{ campo: 'qr', nombre: 'qr.png', mime: 'image/png', datos: Buffer.from('no soy una imagen') }]));
    assert.equal(malo.status, 400);
    assert.equal((await P.pedir('DELETE', `c/${C}/cuentas/${bs}/qr`, teso.acceso)).status, 204);
    assert.equal((await cuenta(elena)).qrUrl, null);
  });

  it('crear y quitar cuentas; el fondo de reserva no se quita', async () => {
    const n = await P.pedir('POST', `c/${C}/cuentas`, teso.acceso, { nombre: 'Mercantil corriente', tipo: 'banco_bs' });
    assert.equal(n.status, 201);
    assert.equal((await P.pedir('POST', `c/${C}/cuentas`, elena.acceso, { nombre: 'Mía', tipo: 'banco_bs' })).status, 403);
    assert.equal((await P.pedir('PUT', `c/${C}/cuentas/${n.json.id}`, teso.acceso, { bancoCodigo: '0105', telefono: '04120000001', documento: 'J301234567', titular: 'Asociación' })).status, 204);
    assert.equal((await cuenta(elena, n.json.id)).moneda, 'VES');
    assert.equal((await P.pedir('DELETE', `c/${C}/cuentas/${n.json.id}`, teso.acceso)).status, 204);
    assert.equal(await cuenta(elena, n.json.id), undefined);
    const fondo = (await P.pedir('GET', `c/${C}/cuentas`, teso.acceso)).json.find((c: any) => c.tipo === 'fondo_reserva');
    assert.equal((await P.pedir('DELETE', `c/${C}/cuentas/${fondo.id}`, teso.acceso)).status, 400);
  });
});
