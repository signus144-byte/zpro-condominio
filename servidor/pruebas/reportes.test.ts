// Reportes de irregularidades: anónimos (sin rastro del autor), con nombre, comentarios y estados.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { C, PNG, crearPrueba, formulario, type Prueba } from './_api.js';

let P: Prueba;
let pres: { id: string; acceso: string }, b33: { id: string; acceso: string }, b34: { id: string; acceso: string };
let a11: { acceso: string }, extrano: { acceso: string };
let FOTO_CON_EXIF: Buffer;

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  b33 = await P.miembro('Elena Castro', 'propietario', 'b3');
  b34 = await P.miembro('Pedro Salas', 'propietario', 'b4');
  a11 = await P.miembro('Luis Perez', 'propietario', 'a1');
  extrano = await P.registrar('Extrano Total', 'extrano-rep@correo.com');
  FOTO_CON_EXIF = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#884422' } })
    .jpeg().withMetadata({ exif: { IFD0: { Make: 'TelefonoDeElena', Model: 'Modelo-X' } } }).toBuffer();
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

const nuevo = (campos: Record<string, string>, fotos: Buffer[] = []) => formulario(
  { categoria: 'ruido', titulo: 'Música muy alta', descripcion: 'Todas las noches después de las 11 pm', ubicacion: 'Bloque B, apto 34',
    visibilidad: 'presidencia', anonimo: 'false', ...campos },
  fotos.map((d, i) => ({ campo: 'fotos', nombre: `f${i}.jpg`, mime: 'image/jpeg', datos: d })));

describe('reporte anónimo', () => {
  let id = '';
  it('la foto anónima pierde sus metadatos y se guarda sin dueño', async () => {
    assert.ok((await sharp(FOTO_CON_EXIF).metadata()).exif, 'la foto de prueba sí trae EXIF');
    const r = await P.pedir('POST', `c/${C}/reportes`, b33.acceso, nuevo({ anonimo: 'true' }, [FOTO_CON_EXIF]));
    assert.equal(r.status, 201, r.body);
    id = r.json.id;
    const obj = (await P.base.admin.query(`select o.owner, o.name from storage.objects o join reporte_fotos f on f.path = o.name
                                            where f.reporte_id = $1 and o.bucket_id = 'reportes'`, [id])).rows;
    assert.equal(obj.length, 1);
    assert.equal(obj[0].owner, null, 'sin dueño en storage.objects');
    const { flujo } = await P.app.ctx.almacen.leer('reportes', obj[0].name);
    const bytes = Buffer.concat(await flujo.toArray());
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.exif, undefined, 'sin EXIF');
    assert.ok(!bytes.includes(Buffer.from('TelefonoDeElena')));
  });

  it('la junta lo recibe sin autor; el denunciado (B-34) no lo ve; la autora lo ve como suyo con su foto', async () => {
    const j = (await P.pedir('GET', `c/${C}/reportes`, pres.acceso)).json.find((r: { id: string }) => r.id === id);
    assert.equal(j.anonimo, true);
    assert.equal(j.autorNombre, null);
    assert.equal(j.esMio, false);
    assert.equal(j.fotos.length, 1);
    assert.ok(!JSON.stringify(j).includes(b33.id), 'ningún dato del autor en la respuesta');
    assert.equal((await P.pedir('GET', `c/${C}/reportes`, b34.acceso)).json.length, 0);
    const mio = (await P.pedir('GET', `c/${C}/reportes`, b33.acceso)).json.find((r: { id: string }) => r.id === id);
    assert.equal(mio.esMio, true);
    assert.equal(mio.fotos.length, 1);
    assert.equal((await P.pedir('GET', mio.fotos[0].replace('http://prueba', ''))).status, 200);
  });

  it('respuesta oficial y comentario de la autora: el suyo sale sin nombre', async () => {
    assert.equal((await P.pedir('PATCH', `c/${C}/reportes/${id}`, b33.acceso, { estado: 'resuelto' })).status, 403);
    assert.equal((await P.pedir('PATCH', `c/${C}/reportes/${id}`, pres.acceso, { estado: 'en_proceso', respuesta: 'Hablaremos con el apto 34.' })).status, 204);
    assert.equal((await P.pedir('POST', `c/${C}/reportes/${id}/comentarios`, b33.acceso, { texto: 'Gracias, anoche siguió.' })).status, 201);
    const cs = (await P.pedir('GET', `c/${C}/reportes/${id}/comentarios`, pres.acceso)).json;
    assert.equal(cs.length, 2);
    assert.equal(cs[0].esOficial, true);
    assert.equal(cs[0].autor, 'Maria Presidenta');
    assert.equal(cs[1].autor, 'Autor del reporte');
    assert.equal((await P.pedir('GET', `c/${C}/reportes/${id}/comentarios`, b34.acceso)).status, 403);
    assert.equal((await P.pedir('POST', `c/${C}/reportes/${id}/comentarios`, b33.acceso, { texto: 'oficial falso', oficial: true })).status, 403);
  });
});

describe('reporte con nombre y límites', () => {
  it('visible a la comunidad con el nombre del autor y su foto', async () => {
    const r = await P.pedir('POST', `c/${C}/reportes`, a11.acceso,
      formulario({ categoria: 'dano_area_comun', titulo: 'Lámpara dañada', descripcion: 'Pasillo piso 3', visibilidad: 'comunidad', anonimo: 'false' },
        [{ campo: 'fotos', nombre: 'l.png', mime: 'image/png', datos: PNG }]));
    assert.equal(r.status, 201);
    const visto = (await P.pedir('GET', `c/${C}/reportes`, b34.acceso)).json.find((x: { titulo: string }) => x.titulo === 'Lámpara dañada');
    assert.equal(visto.autorNombre, 'Luis Perez');
    assert.equal(visto.fotos.length, 1);
  });

  it('extraño no puede reportar; un archivo que no es imagen se rechaza; máximo 5 por día', async () => {
    assert.equal((await P.pedir('POST', `c/${C}/reportes`, extrano.acceso, nuevo({}))).status, 403);
    const malo = formulario({ categoria: 'otro', titulo: 'Prueba', descripcion: 'Archivo raro', anonimo: 'true' },
      [{ campo: 'fotos', nombre: 'x.jpg', mime: 'image/jpeg', datos: Buffer.from('no soy una imagen') }]);
    assert.equal((await P.pedir('POST', `c/${C}/reportes`, b34.acceso, malo)).status, 400);
    for (let i = 0; i < 5; i++) assert.equal((await P.pedir('POST', `c/${C}/reportes`, b34.acceso, nuevo({ titulo: `Reporte ${i}` }))).status, 201);
    const sexto = await P.pedir('POST', `c/${C}/reportes`, b34.acceso, nuevo({ anonimo: 'true' }, [FOTO_CON_EXIF]));
    assert.equal(sexto.status, 400);
    assert.match(sexto.json.error, /5 reportes/);
    const huerfanas = (await P.base.admin.query(`select count(*)::int n from storage.objects o where o.bucket_id = 'reportes'
                                                 and not exists (select 1 from reporte_fotos f where f.path = o.name)`)).rows[0].n;
    assert.equal(huerfanas, 0, 'si el reporte falla, las fotos anónimas ya guardadas se eliminan');
  });
});
