// Miembros, códigos de acceso, solicitudes de ingreso y directorio.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, UNI, crearPrueba, type Prueba } from './_api.js';

let P: Prueba;
let pres: { id: string; acceso: string }, vocal: { acceso: string }, b33: { id: string; acceso: string };
let b34: { id: string; acceso: string };

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  vocal = await P.miembro('Vocal Uno', 'vocal');
  b33 = await P.miembro('Elena Castro', 'propietario', 'b3');
  b34 = await P.miembro('Pedro Salas', 'propietario', 'b4');
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

describe('códigos y solicitudes', () => {
  let codigoB1 = '';
  it('la presidenta genera un código por casa; residentes y vocales no', async () => {
    assert.equal((await P.pedir('POST', `c/${C}/codigos`, b33.acceso, { todas: true })).status, 403);
    assert.equal((await P.pedir('POST', `c/${C}/codigos`, vocal.acceso, { todas: true })).status, 403);
    const r = await P.pedir('POST', `c/${C}/codigos`, pres.acceso, { todas: true });
    assert.equal(r.status, 201);
    assert.equal(r.json.length, 8);
    const b1 = r.json.find((k: { unidadId: string }) => k.unidadId === UNI('b1'));
    assert.match(b1.codigo, /^B31-[A-Z2-9]{5}$/);
    assert.equal(b1.unidad, 'Apto B-31');
    codigoB1 = b1.codigo;
    assert.equal((await P.pedir('POST', `c/${C}/codigos`, pres.acceso, { todas: true })).json.length, 8, '"todas" no duplica casas con código vigente');
    const junta = await P.pedir('POST', `c/${C}/codigos`, pres.acceso, { rol: 'tesorero', usosMax: 1 });
    assert.ok(junta.json.some((k: { rol: string; unidadId: string | null }) => k.rol === 'tesorero' && k.unidadId === null));
  });

  it('un vecino se une con el código: queda pendiente; la junta ve su nombre y lo aprueba', async () => {
    const nuevo = await P.registrar('Rosa Herrera', 'rosa@correo.com');
    assert.equal((await P.pedir('POST', 'auth/unirse', nuevo.acceso, { codigo: codigoB1.toLowerCase() })).json.estado, 'pendiente');
    assert.equal((await P.pedir('GET', `c/${C}/solicitudes`, b33.acceso)).status, 403);
    const sol = (await P.pedir('GET', `c/${C}/solicitudes`, vocal.acceso)).json;
    assert.equal(sol.length, 1);
    assert.equal(sol[0].usuarioNombre, 'Rosa Herrera');
    assert.equal(sol[0].unidad, 'Apto B-31');
    assert.equal((await P.pedir('POST', `c/${C}/solicitudes/${sol[0].id}`, vocal.acceso, { aprobar: true })).status, 403, 'aprueba presidencia/administración');
    assert.equal((await P.pedir('POST', `c/${C}/solicitudes/${sol[0].id}`, pres.acceso, { aprobar: true })).status, 204);
    const yo = (await P.pedir('GET', 'auth/yo', nuevo.acceso)).json;
    assert.equal(yo.membresias[0].unidad, 'Apto B-31');
    assert.equal((await P.pedir('GET', `c/${C}/solicitudes`, pres.acceso)).json.length, 0);
  });

  it('borrar un código', async () => {
    const lista = (await P.pedir('GET', `c/${C}/codigos`, pres.acceso)).json;
    const k = lista.find((x: { unidadId: string }) => x.unidadId === UNI('a1')).codigo;
    assert.equal((await P.pedir('DELETE', `c/${C}/codigos/${k}`, b33.acceso)).status, 404);
    assert.equal((await P.pedir('DELETE', `c/${C}/codigos/${k}`, pres.acceso)).status, 204);
  });
});

describe('miembros', () => {
  it('la junta lista los miembros; un residente no', async () => {
    assert.equal((await P.pedir('GET', `c/${C}/miembros`, b33.acceso)).status, 403);
    const m = (await P.pedir('GET', `c/${C}/miembros`, vocal.acceso)).json;
    assert.ok(m.some((x: { nombre: string; unidad: string }) => x.nombre === 'Elena Castro' && x.unidad === 'Apto B-33'));
  });

  it('presidencia cambia el rol y desactiva; no puede desactivarse ni dejar el condominio sin presidente', async () => {
    assert.equal((await P.pedir('PATCH', `c/${C}/miembros/${b34.id}`, vocal.acceso, { rol: 'inquilino' })).status, 403);
    assert.equal((await P.pedir('PATCH', `c/${C}/miembros/${b34.id}`, pres.acceso, { rol: 'inquilino' })).status, 204);
    assert.equal((await P.pedir('PATCH', `c/${C}/miembros/${b34.id}`, pres.acceso, { activo: false })).status, 204);
    assert.equal((await P.pedir('GET', `c/${C}/unidades`, b34.acceso)).json.length, 0, 'desactivado ya no ve su casa');
    assert.equal((await P.pedir('PATCH', `c/${C}/miembros/${pres.id}`, pres.acceso, { activo: false })).status, 400);
    assert.equal((await P.pedir('PATCH', `c/${C}/miembros/${pres.id}`, pres.acceso, { rol: 'vocal' })).status, 400);
  });
});

describe('directorio', () => {
  it('cada vecino decide si muestra su nombre; la junta siempre lo ve', async () => {
    const ver = async (t: string) => (await P.pedir('GET', `c/${C}/directorio`, t)).json.find((x: { unidadId: string }) => x.unidadId === UNI('b3'));
    const vecino = await P.miembro('Vecino A12', 'propietario', 'a2');
    assert.deepEqual((await ver(vecino.acceso)).nombres, ['Elena Castro']);
    assert.equal((await P.pedir('PATCH', `c/${C}/directorio/yo`, b33.acceso, { mostrar: false })).status, 204);
    assert.deepEqual((await ver(vecino.acceso)).nombres, []);
    assert.deepEqual((await ver(pres.acceso)).nombres, ['Elena Castro']);
    assert.equal((await ver(vecino.acceso)).etiqueta, 'Apto B-33');
    const extrano = await P.registrar('Extrano Dir', 'extrano-dir@correo.com');
    assert.equal((await P.pedir('GET', `c/${C}/directorio`, extrano.acceso)).status, 403);
  });
});
