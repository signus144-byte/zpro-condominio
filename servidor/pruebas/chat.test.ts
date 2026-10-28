// Chat por casa a través de la API: permisos, adjuntos, estados ✓/✓✓, bloqueo, denuncia y bandeja.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, PNG, UNI, crearPrueba, formulario, type Prueba } from './_api.js';

let P: Prueba;
type U = { id: string; acceso: string };
let pres: U, b33: U, b34: U, a11: U, extrano: U;
let directa: string, conJunta: string;

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  b33 = await P.miembro('Elena Castro', 'propietario', 'b3');
  b34 = await P.miembro('Pedro Salas', 'propietario', 'b4');
  a11 = await P.miembro('Luis Perez', 'propietario', 'a1');
  const e = await P.registrar('Extrano Total', 'extrano.chat@correo.com');
  extrano = { id: e.id, acceso: e.acceso };
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

const url = (r: string) => `c/${C}/${r}`;
const enviar = (u: U, conv: string, texto: string, extra: Record<string, unknown> = {}) =>
  P.pedir('POST', url(`conversaciones/${conv}/mensajes`), u.acceso, { texto, ...extra });
const mensajes = (u: U, conv: string) => P.pedir('GET', url(`conversaciones/${conv}/mensajes`), u.acceso);

describe('casa ↔ casa', () => {
  it('abrir no duplica la conversación', async () => {
    const r1 = await P.pedir('POST', url('conversaciones/casa'), b33.acceso, { unidadId: UNI('a1') });
    const r2 = await P.pedir('POST', url('conversaciones/casa'), a11.acceso, { unidadId: UNI('b3') });
    assert.equal(r1.status, 200);
    assert.equal(r1.json.id, r2.json.id);
    directa = r1.json.id;
  });

  it('el vecino recibe el mensaje con casa y nombre (no es anónimo)', async () => {
    const r = await enviar(b33, directa, 'Hola vecino, ¿su carro es el gris?');
    assert.equal(r.status, 201);
    assert.equal(r.json.esMio, true);
    assert.equal(r.json.estado, 1);
    const m = (await mensajes(a11, directa)).json;
    assert.equal(m.length, 1);
    assert.equal(m[0].autorEtiqueta, 'Apto B-33');
    assert.equal(m[0].autorNombre, 'Elena Castro');
    assert.equal(m[0].esMio, false);
    assert.equal(m[0].estado, null);
  });

  it('nadie más lee ni escribe: ni otra casa, ni la junta, ni un extraño', async () => {
    assert.equal((await mensajes(b34, directa)).status, 404);
    assert.equal((await mensajes(pres, directa)).status, 404, 'la junta no lee chats entre vecinos');
    assert.equal((await mensajes(extrano, directa)).status, 404);
    assert.equal((await enviar(b34, directa, 'me meto')).status, 404);
  });

  it('✓✓ leído cuando la otra casa abre la conversación', async () => {
    assert.equal((await P.pedir('POST', url(`conversaciones/${directa}/leido`), a11.acceso)).status, 204);
    const m = (await mensajes(b33, directa)).json;
    assert.equal(m[0].estado, 3);
  });

  it('editar y eliminar solo el propio mensaje', async () => {
    const r = await enviar(b33, directa, 'Mensaje con erorr');
    assert.equal(r.status, 201, r.body);
    assert.equal((await P.pedir('PATCH', url(`mensajes/${r.json.id}`), a11.acceso, { texto: 'hackeado' })).status, 403);
    assert.equal((await P.pedir('PATCH', url(`mensajes/${r.json.id}`), b33.acceso, { texto: 'Mensaje con error' })).status, 204);
    let m = (await mensajes(a11, directa)).json.at(-1);
    assert.equal(m.texto, 'Mensaje con error');
    assert.equal(m.editado, true);
    assert.equal((await P.pedir('PATCH', url(`mensajes/${r.json.id}`), b33.acceso, { eliminar: true })).status, 204);
    m = (await mensajes(a11, directa)).json.at(-1);
    assert.equal(m.eliminado, true);
    assert.equal(m.texto, null);
  });
});

describe('junta ↔ casa', () => {
  it('la junta escribe a B-34 como "Junta de condominio" y él responde en la misma conversación', async () => {
    const r = await P.pedir('POST', url('conversaciones/casa'), pres.acceso, { unidadId: UNI('b4') });
    conJunta = r.json.id;
    assert.equal((await P.pedir('POST', url('conversaciones/junta'), b34.acceso)).json.id, conJunta);
    assert.equal((await enviar(pres, conJunta, 'Sr. Salas, le recordamos el saldo pendiente.')).status, 201);
    const m = (await mensajes(b34, conJunta)).json;
    assert.equal(m[0].autorEtiqueta, 'Junta de condominio');
    assert.equal(m[0].comoJunta, true);
    assert.equal(m[0].autorNombre, 'Maria Presidenta');
    assert.equal((await enviar(b34, conJunta, 'Pago el viernes, gracias.')).status, 201);
    assert.equal((await mensajes(pres, conJunta)).json.length, 2);
  });

  it('una casa sin relación no ve la conversación de la junta con B-34', async () => {
    assert.equal((await mensajes(b33, conJunta)).status, 404);
  });
});

describe('salas', () => {
  it('canal de avisos: todos lo ven, solo la junta escribe', async () => {
    const c = await P.pedir('POST', url('salas'), pres.acceso, { tipo: 'canal', titulo: 'Avisos oficiales' });
    assert.equal(c.status, 201);
    assert.equal((await enviar(pres, c.json.id, 'Corte de agua el sábado')).status, 201);
    const bandeja = (await P.pedir('GET', url('conversaciones'), b33.acceso)).json;
    const canal = bandeja.find((x: { id: string }) => x.id === c.json.id);
    assert.equal(canal.puedoEscribir, false);
    assert.equal(canal.noLeidos, 1);
    assert.equal((await enviar(b33, c.json.id, 'respondo')).status, 403);
    assert.equal((await P.pedir('POST', url('salas'), b33.acceso, { tipo: 'canal', titulo: 'Mi canal' })).status, 403);
  });

  it('grupo: solo las casas invitadas', async () => {
    const g = await P.pedir('POST', url('salas'), pres.acceso, { tipo: 'grupo', titulo: 'Bloque B', unidades: [UNI('b3'), UNI('b4')] });
    assert.equal((await enviar(b33, g.json.id, 'Hola Bloque B')).status, 201);
    assert.equal((await mensajes(b34, g.json.id)).json.length, 1);
    assert.equal((await mensajes(a11, g.json.id)).status, 404);
  });
});

describe('bloqueo, denuncia, silencio y bandeja', () => {
  it('Casa 11 bloquea a B-33: ya no le puede escribir; al desbloquear, sí', async () => {
    assert.equal((await P.pedir('POST', url('bloqueos'), a11.acceso, { unidadId: UNI('b3') })).status, 204);
    assert.deepEqual((await P.pedir('GET', url('chat/estado'), a11.acceso)).json.bloqueadas, [UNI('b3')]);
    assert.equal((await enviar(b33, directa, '¿hola?')).status, 403);
    assert.equal((await P.pedir('DELETE', url(`bloqueos/${UNI('b3')}`), a11.acceso)).status, 204);
    assert.equal((await enviar(b33, directa, '¿hola?')).status, 201);
  });

  it('denuncia: la junta ve ese mensaje (y solo ese)', async () => {
    const m = (await mensajes(a11, directa)).json.at(-1);
    assert.equal((await P.pedir('POST', url(`mensajes/${m.id}/denunciar`), a11.acceso, { motivo: 'Mensajes insistentes' })).status, 204);
    const d = (await P.pedir('GET', url('denuncias'), pres.acceso)).json;
    assert.equal(d.length, 1);
    assert.equal(d[0].mensaje.texto, '¿hola?');
    assert.equal(d[0].mensaje.casa, 'Apto B-33');
    assert.equal((await P.pedir('GET', url('denuncias'), b33.acceso)).json.length, 0);
  });

  it('silenciar queda guardado en el servidor', async () => {
    assert.equal((await P.pedir('POST', url(`conversaciones/${directa}/silenciar`), b33.acceso, { silenciar: true })).status, 204);
    assert.deepEqual((await P.pedir('GET', url('chat/estado'), b33.acceso)).json.silenciadas, [directa]);
  });

  it('bandeja: títulos según quién mira y no leídos', async () => {
    const b = (await P.pedir('GET', url('conversaciones'), a11.acceso)).json;
    const conB33 = b.find((x: { id: string }) => x.id === directa);
    assert.match(conB33.titulo, /^Apto B-33 · Elena Castro/);
    assert.ok(conB33.noLeidos >= 1);
    const bj = (await P.pedir('GET', url('conversaciones'), pres.acceso)).json;
    assert.ok(bj.some((x: { titulo: string }) => x.titulo.startsWith('Apto B-34')));
    assert.ok(!bj.some((x: { id: string }) => x.id === directa), 'la junta no ve el chat entre vecinos en su bandeja');
    const bb = (await P.pedir('GET', url('conversaciones'), b34.acceso)).json;
    assert.ok(bb.some((x: { titulo: string }) => x.titulo === 'Junta de condominio'));
  });
});

describe('adjuntos', () => {
  it('foto en el chat: URL firmada que abre la otra casa; un extraño no puede pedirla', async () => {
    const f = formulario({ texto: 'Foto del carro' }, [{ campo: 'archivo', nombre: 'carro.png', mime: 'image/png', datos: PNG }]);
    const r = await P.pedir('POST', url(`conversaciones/${directa}/mensajes`), b33.acceso, f);
    assert.equal(r.status, 201);
    assert.equal(r.json.tipo, 'imagen');
    assert.equal(r.json.adjunto.nombre, 'carro.png');
    assert.equal(r.json.adjunto.vencido, false);
    const m = (await mensajes(a11, directa)).json.at(-1);
    const img = await P.pedir('GET', m.adjunto.url.replace('http://prueba', ''));
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    const ruta = (await P.base.admin.query(`select path from adjuntos where id = $1`, [m.adjunto.id])).rows[0].path;
    assert.ok(ruta.startsWith(`${C}/${directa}/`));
    assert.equal((await P.pedir('POST', 'archivos/firmar', extrano.acceso, { bucket: 'chat', nombre: ruta })).status, 404);
    assert.equal((await P.pedir('POST', 'archivos/firmar', b34.acceso, { bucket: 'chat', nombre: ruta })).status, 404);
  });

  it('adjunto vencido: el mensaje queda, el archivo no', async () => {
    const m = (await mensajes(a11, directa)).json.at(-1);
    await P.base.admin.query(`update adjuntos set expira_en = now() - interval '1 minute' where id = $1`, [m.adjunto.id]);
    const v = (await mensajes(a11, directa)).json.at(-1);
    assert.equal(v.adjunto.vencido, true);
    assert.equal(v.adjunto.url, null);
    assert.equal(v.texto, 'Foto del carro');
  });

  it('un mensaje vacío se rechaza', async () => {
    assert.equal((await enviar(b33, directa, '   ')).status, 400);
  });
});

describe('chat entre vecinos opcional (lo decide la junta)', () => {
  it('la junta lo apaga: nadie abre nuevas conversaciones casa ↔ casa y las viejas quedan de solo lectura', async () => {
    assert.equal((await P.pedir('GET', `c/${C}`, b33.acceso)).json.chatVecinos, true, 'en la demo viene encendido');
    assert.equal((await P.pedir('PUT', url('chat-vecinos'), b33.acceso, { activo: false })).status, 403, 'un vecino no decide');
    assert.equal((await P.pedir('PUT', url('chat-vecinos'), pres.acceso, { activo: false })).status, 204);
    assert.equal((await P.pedir('GET', `c/${C}`, b33.acceso)).json.chatVecinos, false);
    const nueva = await P.pedir('POST', url('conversaciones/casa'), b34.acceso, { unidadId: UNI('a1') });
    assert.equal(nueva.status, 400);
    assert.match(nueva.json.error, /no ha habilitado el chat entre vecinos/);
    assert.equal((await enviar(b33, directa, '¿sigue ahí?')).status, 403, 'solo lectura');
    assert.ok((await mensajes(a11, directa)).json.length > 0, 'los mensajes anteriores no se borran');
    const bandeja = (await P.pedir('GET', url('conversaciones'), b33.acceso)).json as { id: string; puedoEscribir: boolean }[];
    assert.equal(bandeja.find((c) => c.id === directa)!.puedoEscribir, false);
    // Casa ↔ junta sigue funcionando.
    const j = await P.pedir('POST', url('conversaciones/junta'), b33.acceso);
    assert.equal((await enviar(b33, j.json.id, 'Consulta a la junta')).status, 201);
    const bit = (await P.base.admin.query(`select accion, despues from bitacora where condominio_id = $1 and accion = 'chat_vecinos'`, [C])).rows;
    assert.equal(bit.length, 1);
    assert.equal(bit[0].despues.chat_vecinos, false);
  });

  it('al encenderlo de nuevo, las casas vuelven a escribirse', async () => {
    assert.equal((await P.pedir('PUT', url('chat-vecinos'), pres.acceso, { activo: true })).status, 204);
    assert.equal((await enviar(b33, directa, 'Ya volvió el chat')).status, 201);
  });
});
