// v0.8: lista pública de cuotas vencidas (opcional), mensajes anónimos a otra casa y reportes sobre una casa.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, PNG, UNI, crearPrueba, formulario, type Prueba } from './_api.js';
import { sqlComo } from './_entorno.js';

let P: Prueba;
type U = { id: string; acceso: string };
let pres: U, teso: U, elena: U, pedro: U, luis: U, carlos: U, ana: U;
let mensaje = '';

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  teso = await P.miembro('Jorge Tesorero', 'tesorero');
  elena = await P.miembro('Elena Castro', 'propietario', 'b3');
  pedro = await P.miembro('Pedro Salas', 'propietario', 'b4');
  luis = await P.miembro('Luis Perez', 'propietario', 'a1');
  carlos = await P.miembro('Carlos Rivas', 'propietario', 'a2');
  ana = await P.miembro('Ana Gomez', 'propietario', 'a3');
  // Recibos de octubre (vencen el 05/10): todas las casas quedan con cuota vencida.
  assert.equal((await P.pedir('POST', `c/${C}/recibos`, teso.acceso, { periodo: '2026-10-01' })).status, 200);
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

const notifs = async (u: U, tipo: string) =>
  (await P.base.admin.query(`select titulo, cuerpo from notificaciones where usuario_id = $1 and tipo = $2 order by creado_en`, [u.id, tipo])).rows;

describe('lista pública de cuotas vencidas', () => {
  it('apagada por defecto: los vecinos no la ven; la junta sí, como vista previa', async () => {
    const r = await P.pedir('GET', `c/${C}/morosos`, elena.acceso);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no ha publicado/);
    const v = (await P.pedir('GET', `c/${C}/morosos?vistaPrevia=1`, pres.acceso)).json;
    assert.equal(v.length, 8);
    assert.equal(v.find((x: any) => x.etiqueta === 'Apto B-33').montoVencidoUsd, 154);
    assert.equal((await P.pedir('GET', `c/${C}/convivencia`, elena.acceso)).json.morososPublicos, 'no');
  });

  it('solo presidencia o la administración la enciende; al encenderla se avisa a todos', async () => {
    const cuerpo = { morososPublicos: 'casas', morososMesesMin: 1, mensajesAnonimos: true };
    assert.equal((await P.pedir('PUT', `c/${C}/convivencia`, teso.acceso, cuerpo)).status, 403);
    assert.equal((await P.pedir('PUT', `c/${C}/convivencia`, elena.acceso, cuerpo)).status, 403);
    assert.equal((await P.pedir('PUT', `c/${C}/convivencia`, pres.acceso, cuerpo)).status, 204);
    const n = await notifs(pedro, 'general');
    assert.ok(n.some((x) => x.titulo === 'Lista de cuotas vencidas' && /No se muestran nombres/.test(x.cuerpo)));
  });

  it('modo "casas": casa y meses, SIN montos ni nombres', async () => {
    const r = await P.pedir('GET', `c/${C}/morosos`, elena.acceso);
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 8);
    assert.ok(r.json.every((x: any) => x.montoVencidoUsd === null && x.mesesVencidos === 1));
    assert.ok(!/Elena|Castro|Pedro|Salas|propietario/i.test(r.body), 'sin nombres de personas');
  });

  it('modo "casas_y_montos" y mínimo de meses; quien paga sale de la lista', async () => {
    await P.pedir('PUT', `c/${C}/convivencia`, pres.acceso, { morososPublicos: 'casas_y_montos', morososMesesMin: 1, mensajesAnonimos: true });
    let l = (await P.pedir('GET', `c/${C}/morosos`, pedro.acceso)).json as any[];
    assert.equal(l.find((x) => x.etiqueta === 'Apto B-33').montoVencidoUsd, 154);
    // B-33 paga lo vencido
    const p = await P.pedir('POST', `c/${C}/pagos`, elena.acceso, formulario({
      unidadId: UNI('b3'), fechaPago: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }), metodo: 'zelle', moneda: 'USD', monto: '154', referencia: 'ZB33OK' }));
    await P.pedir('POST', `c/${C}/pagos/${p.json.id}/confirmar`, teso.acceso, {});
    l = (await P.pedir('GET', `c/${C}/morosos`, pedro.acceso)).json;
    assert.equal(l.length, 7);
    assert.ok(!l.some((x) => x.etiqueta === 'Apto B-33'));
    await P.pedir('PUT', `c/${C}/convivencia`, pres.acceso, { morososPublicos: 'casas_y_montos', morososMesesMin: 2, mensajesAnonimos: true });
    assert.equal((await P.pedir('GET', `c/${C}/morosos`, pedro.acceso)).json.length, 0, 'nadie tiene 2 meses vencidos');
  });
});

describe('mensajes anónimos a otra casa', () => {
  it('Elena le escribe a B-34 con foto y copia a la junta: nadie ve que fue ella', async () => {
    const f = formulario({ unidadId: UNI('b4'), categoria: 'mascotas', texto: 'Cada vez que bajan al perro hace sus necesidades en la entrada. Por favor recójanlo.', tambienJunta: 'true' },
      [{ campo: 'fotos', nombre: 'entrada.png', mime: 'image/png', datos: PNG }]);
    const r = await P.pedir('POST', `c/${C}/anonimos`, elena.acceso, f);
    assert.equal(r.status, 201, r.body);
    mensaje = r.json.id;
    assert.ok(r.json.reporteId);

    // B-34 lo recibe, sin remitente
    const b = await P.pedir('GET', `c/${C}/anonimos`, pedro.acceso);
    const m = b.json.find((x: any) => x.id === mensaje);
    assert.equal(m.direccion, 'recibido');
    assert.equal(m.aUnidad, 'Apto B-34');
    assert.equal(m.tambienJunta, true);
    assert.equal(m.fotos.length, 1);
    assert.ok(!b.body.includes(elena.id) && !/Elena|B-33/.test(b.body), 'la respuesta no delata a quien lo envió');
    assert.equal((await P.pedir('GET', m.fotos[0].replace('http://prueba', ''))).status, 200, 'B-34 ve la foto');
    assert.equal((await notifs(pedro, 'mensaje_anonimo')).length, 1);
    // La junta ve el reporte (con la casa) pero no el mensaje ni el autor
    const reps = await P.pedir('GET', `c/${C}/reportes`, pres.acceso);
    const rp = reps.json.find((x: any) => x.id === r.json.reporteId);
    assert.equal(rp.unidad, 'Apto B-34');
    assert.equal(rp.anonimo, true);
    assert.equal(rp.autorNombre, null);
    assert.ok(!reps.body.includes(elena.id));
    assert.ok(!(await P.pedir('GET', `c/${C}/anonimos`, pres.acceso)).json.some((x: any) => x.id === mensaje), 'la junta no lee mensajes entre casas');
    // Otra casa no puede ver el mensaje ni su foto
    assert.ok(!(await P.pedir('GET', `c/${C}/anonimos`, luis.acceso)).json.length);
    const ruta = (await P.base.admin.query(`select fotos[1] f from mensajes_anonimos where id = $1`, [mensaje])).rows[0].f;
    assert.notEqual((await P.pedir('POST', 'archivos/firmar', luis.acceso, { bucket: 'anonimos', nombre: ruta })).status, 200);
    // En la base de datos: fotos sin dueño y la autoría no se puede leer desde la app
    const owners = (await P.base.admin.query(`select owner from storage.objects where bucket_id in ('anonimos', 'reportes') and name like $1`, [`${C}/%`])).rows;
    assert.ok(owners.length >= 2 && owners.every((o) => o.owner === null));
    await assert.rejects(sqlComo(P.base.api, pres.id, `select * from mensajes_anonimos_autoria`));
    await assert.rejects(sqlComo(P.base.api, pedro.id, `select * from bloqueos_anonimos`));
    // Elena lo ve en "enviados"
    assert.equal((await P.pedir('GET', `c/${C}/anonimos`, elena.acceso)).json.find((x: any) => x.id === mensaje).direccion, 'enviado');
  });

  it('límites contra el acoso: una vez al día a la misma casa, no a su propia casa, 3 al día', async () => {
    const enviar = (u: U, casa: string) => P.pedir('POST', `c/${C}/anonimos`, u.acceso, formulario({ unidadId: UNI(casa), texto: 'Por favor bajen el volumen después de las 10 pm.' }));
    let r = await enviar(elena, 'b4');
    assert.equal(r.status, 400); assert.match(r.json.error, /Ya le envió/);
    r = await enviar(elena, 'b3');
    assert.equal(r.status, 400); assert.match(r.json.error, /propia casa/);
    r = await enviar(elena, 'b2');
    assert.equal(r.status, 400); assert.match(r.json.error, /todavía no usa la app/);
    assert.equal((await enviar(elena, 'a1')).status, 201);
    assert.equal((await enviar(elena, 'a2')).status, 201);
    r = await enviar(elena, 'a3');
    assert.equal(r.status, 400); assert.match(r.json.error, /Límite de 3/);
  });

  it('la casa responde sin saber a quién; el remitente responde y sigue anónimo', async () => {
    assert.equal((await P.pedir('POST', `c/${C}/anonimos/${mensaje}/responder`, pedro.acceso, { texto: 'Disculpe, no volverá a pasar.' })).status, 204);
    assert.equal((await notifs(elena, 'mensaje_anonimo')).filter((n) => /respondió/.test(n.cuerpo)).length, 1);
    assert.equal((await P.pedir('POST', `c/${C}/anonimos/${mensaje}/responder`, elena.acceso, { texto: 'Gracias por su comprensión.' })).status, 204);
    const m = (await P.pedir('GET', `c/${C}/anonimos`, pedro.acceso)).json.find((x: any) => x.id === mensaje);
    assert.deepEqual(m.respuestas.map((r: any) => r.de), ['casa', 'remitente']);
    assert.equal((await P.pedir('POST', `c/${C}/anonimos/${mensaje}/responder`, luis.acceso, { texto: 'hola' })).status, 404);
  });

  it('denuncia: la junta ve el contenido (no el remitente) y lo suspende sin saber quién es', async () => {
    assert.equal((await P.pedir('POST', `c/${C}/anonimos/${mensaje}/denunciar`, elena.acceso, { motivo: 'x x x' })).status, 403, 'solo quien lo recibió');
    assert.equal((await P.pedir('POST', `c/${C}/anonimos/${mensaje}/denunciar`, pedro.acceso, { motivo: 'Es falso y ofensivo' })).status, 204);
    assert.equal((await notifs(pres, 'denuncia_anonima')).length, 1);
    assert.equal((await P.pedir('GET', `c/${C}/anonimos/denuncias`, pedro.acceso)).status, 403);
    const d = await P.pedir('GET', `c/${C}/anonimos/denuncias`, pres.acceso);
    assert.equal(d.json.length, 1);
    assert.equal(d.json[0].motivo, 'Es falso y ofensivo');
    assert.equal(d.json[0].aUnidad, 'Apto B-34');
    assert.equal(d.json[0].fotos.length, 1, 'la junta ve la foto del mensaje denunciado');
    assert.ok(!d.body.includes(elena.id) && !/Elena|B-33/.test(d.body));
    assert.equal((await P.pedir('POST', `c/${C}/anonimos/${mensaje}/revisar`, pres.acceso, { accion: 'bloquear', dias: 15 })).status, 204);
    assert.ok((await notifs(elena, 'general')).some((n) => /suspendió sus mensajes anónimos por 15 días/.test(n.cuerpo)));
    const r = await P.pedir('POST', `c/${C}/anonimos`, elena.acceso, formulario({ unidadId: UNI('a3'), texto: 'Otro mensaje' }));
    assert.equal(r.status, 400); assert.match(r.json.error, /suspendió/);
    assert.equal((await P.pedir('POST', `c/${C}/anonimos/${mensaje}/responder`, pedro.acceso, { texto: '¿?' })).status, 400, 'conversación cerrada');
  });

  it('la junta puede desactivar los mensajes anónimos', async () => {
    await P.pedir('PUT', `c/${C}/convivencia`, pres.acceso, { morososPublicos: 'no', morososMesesMin: 1, mensajesAnonimos: false });
    const r = await P.pedir('POST', `c/${C}/anonimos`, carlos.acceso, formulario({ unidadId: UNI('a3'), texto: 'Buenas noches vecino' }));
    assert.equal(r.status, 400); assert.match(r.json.error, /desactivó/);
    assert.equal((await P.pedir('GET', `c/${C}/morosos`, ana.acceso)).status, 400, 'lista apagada otra vez');
  });
});

describe('reporte a la junta sobre una casa', () => {
  it('va solo a la junta (no a la comunidad) y la junta ve qué casa', async () => {
    const pub = await P.pedir('POST', `c/${C}/reportes`, ana.acceso, formulario({ categoria: 'mascotas', titulo: 'Perro en la entrada', descripcion: 'Otra vez', visibilidad: 'comunidad', anonimo: 'true', unidadId: UNI('b4') }));
    assert.equal(pub.status, 400);
    const r = await P.pedir('POST', `c/${C}/reportes`, ana.acceso, formulario({ categoria: 'mascotas', titulo: 'Perro en la entrada', descripcion: 'Otra vez', visibilidad: 'presidencia', anonimo: 'true', unidadId: UNI('b4') }));
    assert.equal(r.status, 201, r.body);
    const mio = (await P.pedir('GET', `c/${C}/reportes`, ana.acceso)).json.find((x: any) => x.id === r.json.id);
    assert.equal(mio.unidad, 'Apto B-34');
    assert.ok(!(await P.pedir('GET', `c/${C}/reportes`, pedro.acceso)).json.some((x: any) => x.id === r.json.id), 'B-34 no lo ve');
  });
});
