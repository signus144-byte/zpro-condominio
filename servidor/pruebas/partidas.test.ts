// Partidas especiales y votaciones ponderadas por alícuota.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, crearPrueba, type Prueba } from './_api.js';

let P: Prueba;
let pres: { acceso: string }, b33: { acceso: string }, b34: { acceso: string }, inq: { acceso: string };

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  b33 = await P.miembro('Elena Castro', 'propietario', 'b3');
  b34 = await P.miembro('Pedro Salas', 'propietario', 'b4');
  inq = await P.miembro('Inquilino Ana', 'inquilino', 'a2');
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

describe('partidas y votaciones', () => {
  let partida: any;
  it('solo la junta crea partidas; se abre la votación con opciones Aprobar/Rechazar', async () => {
    const nueva = { titulo: 'Pintura fachada Bloque B', descripcion: '3 presupuestos', presupuestoUsd: 3000, numeroCuotas: 3,
                    primeraCuota: '2026-11-01', reparto: 'alicuota', someterAVotacion: true, umbralPct: 25, cierraEn: null };
    assert.equal((await P.pedir('POST', `c/${C}/partidas`, b33.acceso, nueva)).status, 403);
    assert.equal((await P.pedir('POST', `c/${C}/partidas`, pres.acceso, nueva)).status, 201);
    partida = (await P.pedir('GET', `c/${C}/partidas`, b33.acceso)).json[0];
    assert.equal(partida.estado, 'en_votacion');
    assert.equal(partida.votacion.estado, 'abierta');
    assert.equal(partida.cuotaMiUnidadUsd, 140, '3000 / 3 cuotas × 14 %');
    assert.deepEqual(partida.votacion.opciones.map((o: { texto: string }) => o.texto), ['Aprobar', 'Rechazar']);
  });

  it('cada propietario vota una vez por su unidad; el inquilino no vota', async () => {
    const vid = partida.votacion.id;
    const aprobar = partida.votacion.opciones[0].id;
    assert.equal((await P.pedir('POST', `c/${C}/votaciones/${vid}/votar`, b33.acceso, { opcionId: aprobar })).status, 204);
    assert.equal((await P.pedir('POST', `c/${C}/votaciones/${vid}/votar`, b33.acceso, { opcionId: aprobar })).status, 409);
    assert.equal((await P.pedir('POST', `c/${C}/votaciones/${vid}/votar`, b34.acceso, { opcionId: aprobar })).status, 204);
    assert.equal((await P.pedir('POST', `c/${C}/votaciones/${vid}/votar`, inq.acceso, { opcionId: aprobar })).status, 403);
    const v = (await P.pedir('GET', `c/${C}/partidas`, b33.acceso)).json[0].votacion;
    assert.equal(v.opciones[0].pesoPct, 28, '14 % + 14 %');
    assert.equal(v.opciones[0].unidades, 2);
    assert.equal(v.miVotoOpcionId, aprobar);
  });

  it('el acta (quién votó qué) es solo de la junta', async () => {
    const vid = partida.votacion.id;
    assert.equal((await P.pedir('GET', `c/${C}/votaciones/${vid}/acta`, b33.acceso)).status, 403);
    const acta = (await P.pedir('GET', `c/${C}/votaciones/${vid}/acta`, pres.acceso)).json;
    assert.equal(acta.length, 8);
    const f = acta.find((x: { unidad: string }) => x.unidad === 'Apto B-33');
    assert.equal(f.opcion, 'Aprobar');
    assert.equal(f.votante, 'Elena Castro');
  });

  it('la junta cierra: 28 % ≥ umbral 25 % → aprobada; ya no se vota', async () => {
    const vid = partida.votacion.id;
    assert.equal((await P.pedir('POST', `c/${C}/votaciones/${vid}/cerrar`, b33.acceso)).status, 403);
    const r = await P.pedir('POST', `c/${C}/votaciones/${vid}/cerrar`, pres.acceso);
    assert.equal(r.json.aprobada, true);
    assert.equal((await P.pedir('GET', `c/${C}/partidas`, b33.acceso)).json[0].estado, 'aprobada');
    assert.equal((await P.pedir('POST', `c/${C}/votaciones/${vid}/votar`, pres.acceso, { opcionId: partida.votacion.opciones[1].id })).status, 403);
  });

  it('partida sin votación queda aprobada de una vez; votación de otro condominio → 404', async () => {
    const r = await P.pedir('POST', `c/${C}/partidas`, pres.acceso, { titulo: 'Bomba de agua', presupuestoUsd: 800, numeroCuotas: 1,
      primeraCuota: '2026-12-01', reparto: 'unidad', someterAVotacion: false, umbralPct: 50.01, cierraEn: null });
    assert.equal(r.status, 201);
    const p = (await P.pedir('GET', `c/${C}/partidas`, b34.acceso)).json.find((x: { titulo: string }) => x.titulo === 'Bomba de agua');
    assert.equal(p.estado, 'aprobada');
    assert.equal(p.votacion, null);
    assert.equal(p.cuotaMiUnidadUsd, 100, '800 / 8 casas');
    assert.equal((await P.pedir('POST', `c/00000000-0000-0000-0000-000000000099/votaciones/${partida.votacion.id}/cerrar`, pres.acceso)).status, 404);
  });
});
