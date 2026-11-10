// Servidor nuevo (piloto): crear el administrador dueño de la plataforma desde la línea de comandos.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearPrueba, type Prueba } from './_api.js';
import { crearAdmin } from '../src/db/crear_admin.js';

let P: Prueba;
before(async () => { P = await crearPrueba(); }, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

describe('crear el administrador de la plataforma', () => {
  it('crea la cuenta con una clave aleatoria que sirve para entrar, y la hace dueña', async () => {
    const r = await crearAdmin(P.base.adminUrl, '  Direccion@Empresa.Prueba ', 'Dirección');
    assert.ok(r.clave && r.clave.length === 14);
    const e = await P.pedir('POST', 'auth/entrar', undefined, { correo: 'direccion@empresa.prueba', clave: r.clave });
    assert.equal(e.status, 200, e.body);
    const rol = (await P.base.admin.query(`select rol, activo from plataforma_admins where usuario_id = $1`, [r.id])).rows[0];
    assert.deepEqual(rol, { rol: 'dueno', activo: true });
  });
  it('si la cuenta ya existe, no cambia la clave: solo la hace dueña', async () => {
    const u = await P.registrar('Ya Registrada', 'ya@empresa.prueba');
    const r = await crearAdmin(P.base.adminUrl, 'ya@empresa.prueba', 'X');
    assert.equal(r.clave, null);
    assert.equal(r.id, u.id);
    assert.equal((await P.base.admin.query(`select rol from plataforma_admins where usuario_id = $1`, [u.id])).rows[0].rol, 'dueno');
  });
  it('rechaza un correo inválido', async () => {
    await assert.rejects(crearAdmin(P.base.adminUrl, 'no-es-correo', 'X'), /Correo inválido/);
  });
});
