// Cuentas, sesiones, archivos y datos generales del condominio a través de la API.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, PNG, crearPrueba, formulario, type Prueba } from './_api.js';

let P: Prueba;
before(async () => { P = await crearPrueba(); }, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

describe('cuentas y sesiones', () => {
  it('registro: crea la cuenta, el perfil y envía el correo de verificación', async () => {
    const r = await P.pedir('POST', 'auth/registro', null, { nombre: 'Elena Castro', correo: 'Elena@Correo.com', clave: 'clave-segura-123' });
    assert.equal(r.status, 201);
    assert.ok(r.json.acceso && r.json.refresco.includes('.'));
    const yo = await P.pedir('GET', 'auth/yo', r.json.acceso);
    assert.equal(yo.json.usuario.nombre, 'Elena Castro');
    assert.equal(yo.json.usuario.correo, 'elena@correo.com');
    assert.equal(yo.json.usuario.correoVerificado, false);
    assert.equal(P.correos.at(-1)?.para, 'elena@correo.com');
    const token = P.correos.at(-1)!.texto.match(/t=([\w-]+)/)![1];
    assert.equal((await P.pedir('POST', 'auth/verificar-correo', null, { token })).status, 204);
    assert.equal((await P.pedir('GET', 'auth/yo', r.json.acceso)).json.usuario.correoVerificado, true);
  });

  it('no permite dos cuentas con el mismo correo ni claves cortas', async () => {
    assert.equal((await P.pedir('POST', 'auth/registro', null, { nombre: 'Otra', correo: 'elena@correo.com', clave: 'clave-segura-123' })).status, 409);
    const corta = await P.pedir('POST', 'auth/registro', null, { nombre: 'X Y', correo: 'x@y.com', clave: '123' });
    assert.equal(corta.status, 400);
    assert.match(corta.json.error, /8 caracteres/);
  });

  it('entrar: clave correcta da sesión; incorrecta no dice si el correo existe', async () => {
    const ok = await P.pedir('POST', 'auth/entrar', null, { correo: 'elena@correo.com', clave: 'clave-segura-123' });
    assert.equal(ok.status, 200);
    const mal = await P.pedir('POST', 'auth/entrar', null, { correo: 'elena@correo.com', clave: 'otra-clave-999' });
    const noExiste = await P.pedir('POST', 'auth/entrar', null, { correo: 'nadie@correo.com', clave: 'otra-clave-999' });
    assert.equal(mal.status, 401);
    assert.equal(mal.json.error, noExiste.json.error);
  });

  it('bloquea 15 minutos tras 5 intentos fallidos', async () => {
    await P.registrar('Bloqueo Prueba', 'bloqueo@correo.com');
    for (let i = 0; i < 5; i++) await P.pedir('POST', 'auth/entrar', null, { correo: 'bloqueo@correo.com', clave: 'mala-clave-000' });
    const r = await P.pedir('POST', 'auth/entrar', null, { correo: 'bloqueo@correo.com', clave: 'clave-segura-123' });
    assert.equal(r.status, 429);
  });

  it('refrescar rota el token; reusar uno viejo cierra todas las sesiones (posible robo)', async () => {
    const s = await P.registrar('Rota Token', 'rota@correo.com');
    const r1 = await P.pedir('POST', 'auth/refrescar', null, { refresco: s.refresco });
    assert.equal(r1.status, 200);
    assert.notEqual(r1.json.refresco, s.refresco);
    const robo = await P.pedir('POST', 'auth/refrescar', null, { refresco: s.refresco });
    assert.equal(robo.status, 401);
    assert.equal((await P.pedir('POST', 'auth/refrescar', null, { refresco: r1.json.refresco })).status, 401, 'la sesión legítima también se cerró');
  });

  it('salir revoca la sesión', async () => {
    const s = await P.registrar('Sale Sesion', 'sale@correo.com');
    assert.equal((await P.pedir('POST', 'auth/salir', null, { refresco: s.refresco })).status, 204);
    assert.equal((await P.pedir('POST', 'auth/refrescar', null, { refresco: s.refresco })).status, 401);
  });

  it('olvidé mi clave: misma respuesta exista o no; el enlace cambia la clave y cierra sesiones', async () => {
    const s = await P.registrar('Olvida Clave', 'olvida@correo.com');
    const antes = P.correos.length;
    assert.equal((await P.pedir('POST', 'auth/olvide', null, { correo: 'noexiste@correo.com' })).status, 202);
    assert.equal(P.correos.length, antes, 'no se envía correo a cuentas inexistentes');
    assert.equal((await P.pedir('POST', 'auth/olvide', null, { correo: 'olvida@correo.com' })).status, 202);
    const token = P.correos.at(-1)!.texto.match(/t=([\w-]+)/)![1];
    assert.equal((await P.pedir('POST', 'auth/restablecer', null, { token, clave: 'nueva-clave-456' })).status, 204);
    assert.equal((await P.pedir('POST', 'auth/restablecer', null, { token, clave: 'otra-clave-789' })).status, 400, 'el enlace es de un solo uso');
    assert.equal((await P.pedir('POST', 'auth/refrescar', null, { refresco: s.refresco })).status, 401);
    assert.equal((await P.pedir('POST', 'auth/entrar', null, { correo: 'olvida@correo.com', clave: 'nueva-clave-456' })).status, 200);
  });

  it('sin token o con token falso: 401', async () => {
    assert.equal((await P.pedir('GET', 'auth/yo')).status, 401);
    assert.equal((await P.pedir('GET', 'auth/yo', 'eyJ.falso.token')).status, 401);
  });
});

describe('unirse y activar', () => {
  it('el presidente activa el condominio con el código de ZentaPro y luego un vecino se une con el código de su casa', async () => {
    await P.base.admin.query(`update condominios set codigo_activacion = 'SAMANES-2026' where id = $1`, [C]);
    const pres = await P.registrar('María Presidenta', 'maria@correo.com');
    const act = await P.pedir('POST', 'auth/activar-condominio', pres.acceso, { codigo: 'samanes-2026' });
    assert.equal(act.status, 200);
    assert.equal(act.json.condominioId, C);
    const yo = await P.pedir('GET', 'auth/yo', pres.acceso);
    assert.equal(yo.json.membresias[0].rol, 'presidente');

    await P.base.admin.query(`insert into codigos_acceso (codigo, condominio_id, unidad_id) values ('B33-ABCD', $1, '00000000-0000-0000-0000-0000000000b3')`, [C]);
    const vecino = await P.registrar('Vecino Nuevo', 'vecino@correo.com');
    const u = await P.pedir('POST', 'auth/unirse', vecino.acceso, { codigo: 'b33-abcd' });
    assert.equal(u.json.estado, 'pendiente');
    const yoV = await P.pedir('GET', 'auth/yo', vecino.acceso);
    assert.equal(yoV.json.solicitudesPendientes.length, 1);
    assert.equal(yoV.json.membresias.length, 0);
  });
});

describe('condominio y archivos', () => {
  it('residente ve la ficha, cuentas, tasa y avisos; un extraño no', async () => {
    const r = await P.miembro('Ana Residente', 'propietario', 'a3');
    const extrano = await P.registrar('Extrano Total', 'extrano@correo.com');
    assert.equal((await P.pedir('GET', `c/${C}`, r.acceso)).json.nombre, 'Residencias Los Samanes (demo)');
    assert.equal((await P.pedir('GET', `c/${C}`, extrano.acceso)).status, 404);
    assert.ok((await P.pedir('GET', `c/${C}/cuentas`, r.acceso)).json.length >= 3);
    assert.equal((await P.pedir('GET', 'tasa-bcv', r.acceso)).json.usdVes, 215.5);
    assert.equal((await P.pedir('GET', `c/${C}/cuentas`, extrano.acceso)).json.length, 0);
  });

  it('la junta publica avisos; un residente no puede', async () => {
    const pres = await P.miembro('Pres Avisos', 'presidente');
    const res = await P.miembro('Res Avisos', 'propietario', 'a4');
    assert.equal((await P.pedir('POST', `c/${C}/avisos`, pres.acceso, { titulo: 'Corte de agua', cuerpo: 'Sábado de 8 a 12' })).status, 201);
    assert.equal((await P.pedir('POST', `c/${C}/avisos`, res.acceso, { titulo: 'Hola', cuerpo: 'Intento' })).status, 403);
    assert.ok((await P.pedir('GET', `c/${C}/avisos`, res.acceso)).json.some((a: { titulo: string }) => a.titulo === 'Corte de agua'));
  });

  it('marca: la presidenta sube logo y foto; todos los miembros los ven por URL firmada; un residente no puede cambiarla', async () => {
    const pres = await P.miembro('Pres Marca', 'presidente');
    const res = await P.miembro('Res Marca', 'propietario', 'b1');
    const f = formulario({ nombreAsociacion: 'Asociación Civil Los Samanes', colorPrimario: '#123456' },
      [{ campo: 'logo', nombre: 'logo.png', mime: 'image/png', datos: PNG }, { campo: 'fotoEntrada', nombre: 'entrada.png', mime: 'image/png', datos: PNG }]);
    assert.equal((await P.pedir('PATCH', `c/${C}/marca`, pres.acceso, f)).status, 204);
    const m = (await P.pedir('GET', `c/${C}/marca`, res.acceso)).json;
    assert.equal(m.nombreAsociacion, 'Asociación Civil Los Samanes');
    assert.equal(m.colorPrimario, '#123456');
    const img = await P.pedir('GET', m.logoUrl.replace('http://prueba', ''));
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    const f2 = formulario({ colorPrimario: '#000000' });
    assert.equal((await P.pedir('PATCH', `c/${C}/marca`, res.acceso, f2)).status, 403);
    assert.equal((await P.pedir('GET', '/api/v1/archivos/f/token-falso')).status, 403);
  });

  it('firmar: no se puede pedir la URL de un archivo que no se tiene permiso de ver', async () => {
    const extrano = await P.registrar('Extrano Archivo', 'extrano2@correo.com');
    const r = await P.pedir('POST', 'archivos/firmar', extrano.acceso, { bucket: 'marca', nombre: `${C}/logo-1.png` });
    assert.equal(r.status, 404);
    const malo = await P.pedir('POST', 'archivos/firmar', extrano.acceso, { bucket: 'marca', nombre: '../../etc/passwd' });
    assert.equal(malo.status, 400, 'rutas con .. se rechazan');
  });
});
