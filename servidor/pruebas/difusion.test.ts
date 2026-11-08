// Cuotas especiales con alcance (solo algunas casas las ven, votan y pagan) y difusión masiva por grupos.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, UNI, crearPrueba, type Prueba } from './_api.js';

let P: Prueba;
type U = { id: string; acceso: string };
let pres: U, teso: U, b33: U, b33inq: U, b34: U, b31: U, a11: U;
const url = (r: string) => `c/${C}/${r}`;
const notifs = async (u: U) => ((await P.pedir('GET', 'notificaciones', u.acceso)).json as
  { notificaciones: { tipo: string; titulo: string; cuerpo: string; datos: { partidaId?: string; pantalla?: string } }[] }).notificaciones;
const partidas = async (u: U) => (await P.pedir('GET', url('partidas'), u.acceso)).json as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
let alic: Record<string, number> = {};
let partidaId = '';

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  teso = await P.miembro('Jorge Tesorero', 'tesorero');
  b33 = await P.miembro('Elena Castro', 'propietario', 'b3');
  b33inq = await P.miembro('Raul Inquilino', 'inquilino', 'b3');
  b34 = await P.miembro('Pedro Salas', 'propietario', 'b4');
  b31 = await P.miembro('Rosa Herrera', 'propietario', 'b1');
  a11 = await P.miembro('Luis Perez', 'propietario', 'a1');
  alic = Object.fromEntries((await P.base.admin.query(`select id, alicuota from unidades where condominio_id = $1`, [C])).rows
    .map((r) => [r.id, Number(r.alicuota)]));
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

describe('cuota especial solo para algunas casas', () => {
  it('la junta la crea para dos casas ("Piso 3 · llave propia") y avisa solo a esas casas', async () => {
    const r = await P.pedir('POST', url('partidas'), pres.acceso, {
      titulo: 'Cerradura eléctrica del piso 3', descripcion: 'Cambio de la cerradura dañada', presupuestoUsd: 200, numeroCuotas: 2,
      primeraCuota: '2026-12-01', reparto: 'alicuota', someterAVotacion: true, umbralPct: 50.01, cierraEn: null,
      alcance: { tipo: 'unidades', unidadIds: [UNI('b3'), UNI('b4')], nombre: 'Piso 3 · llave propia' },
    });
    assert.equal(r.status, 201, r.body);
    partidaId = r.json.id;
    assert.equal(r.json.difusion.unidades, 2);
    assert.equal(r.json.difusion.personas, 3, 'Elena, su inquilino y Pedro');
    const n = (await notifs(b33inq)).find((x) => x.tipo === 'difusion')!;
    assert.equal(n.titulo, 'Votación: Cerradura eléctrica del piso 3');
    assert.match(n.cuerpo, /por \$200 en 2 cuotas, para Piso 3 · llave propia/);
    assert.equal(n.datos.partidaId, partidaId);
    assert.ok(!(await notifs(a11)).some((x) => x.tipo === 'difusion'), 'otra casa no recibe nada');
  });

  it('solo las casas incluidas (y la junta) la ven; las demás ni se enteran', async () => {
    assert.ok(!(await partidas(a11)).some((p) => p.id === partidaId));
    assert.ok(!(await partidas(b31)).some((p) => p.id === partidaId), 'ni siquiera el vecino del mismo piso no incluido');
    const vista = (await partidas(b33)).find((p) => p.id === partidaId);
    assert.deepEqual(vista.alcance, { tipo: 'unidades', nombre: 'Piso 3 · llave propia', unidades: 2 });
    assert.equal(vista.meAfecta, true);
    assert.equal(vista.unidadIds, undefined, 'los vecinos no reciben la lista de casas');
    const base = alic[UNI('b3')] + alic[UNI('b4')];
    assert.equal(vista.cuotaMiUnidadUsd, Math.round((100 * alic[UNI('b3')] / base) * 100) / 100, 'repartida solo entre las casas incluidas');
    const deJunta = (await partidas(pres)).find((p) => p.id === partidaId);
    assert.deepEqual(deJunta.unidadIds.sort(), [UNI('b3'), UNI('b4')].sort());
    assert.equal(deJunta.votacion.sinVotar, 2);
  });

  it('solo votan las casas incluidas y el resultado se mide sobre ellas', async () => {
    const p = (await partidas(b33)).find((x) => x.id === partidaId);
    const vid = p.votacion.id; const aprobar = p.votacion.opciones[0].id;
    assert.equal((await P.pedir('POST', url(`votaciones/${vid}/votar`), a11.acceso, { opcionId: aprobar })).status, 404, 'ni la ve');
    assert.equal((await P.pedir('POST', url(`votaciones/${vid}/votar`), b33.acceso, { opcionId: aprobar })).status, 204);
    const v = (await partidas(b33)).find((x) => x.id === partidaId).votacion;
    const esperado = Math.round((100 * alic[UNI('b3')] / (alic[UNI('b3')] + alic[UNI('b4')])) * 100) / 100;
    assert.equal(v.opciones[0].pesoPct, esperado, '50 % del piso, no 14 % del condominio');
    const acta = (await P.pedir('GET', url(`votaciones/${vid}/acta`), pres.acceso)).json as { unidad: string }[];
    assert.deepEqual(acta.map((f) => f.unidad), ['Apto B-33', 'Apto B-34']);
  });

  it('mensaje masivo solo a las casas que aún no han votado', async () => {
    const prev = await P.pedir('POST', url('difusiones/previa'), pres.acceso, { alcance: { tipo: 'sin_votar', partidaId } });
    assert.deepEqual(prev.json, { unidades: 1, personas: 1 });
    const r = await P.pedir('POST', url('difusiones'), pres.acceso, {
      titulo: 'Falta su voto', cuerpo: 'Pedro, la votación de la cerradura cierra el viernes.', alcance: { tipo: 'sin_votar', partidaId } });
    assert.equal(r.status, 201, r.body);
    assert.ok((await notifs(b34)).some((x) => x.titulo === 'Falta su voto'));
    assert.ok(!(await notifs(b33)).some((x) => x.titulo === 'Falta su voto'), 'Elena ya votó');
  });

  it('aprobada, el recibo cobra la cuota solo a esas casas, repartida entre ellas', async () => {
    const p = (await partidas(b34)).find((x) => x.id === partidaId);
    assert.equal((await P.pedir('POST', url(`votaciones/${p.votacion.id}/votar`), b34.acceso, { opcionId: p.votacion.opciones[0].id })).status, 204);
    assert.equal((await P.pedir('POST', url(`votaciones/${p.votacion.id}/cerrar`), pres.acceso)).json.aprobada, true);
    assert.equal((await P.pedir('POST', url('recibos'), teso.acceso, { periodo: '2026-12-01' })).status, 200);
    const cargos = (await P.base.admin.query(`select unidad_id, monto_usd from cargos where partida_id = $1`, [partidaId])).rows;
    assert.equal(cargos.length, 2);
    const total = cargos.reduce((s, c) => s + Number(c.monto_usd), 0);
    assert.ok(Math.abs(total - 100) < 0.02, `las dos casas pagan la cuota completa: ${total}`);
  });
});

describe('grupos de casas y difusión', () => {
  let grupo = '';
  it('la junta guarda un grupo ("Calle A · portón") eligiendo casas; un vecino no puede', async () => {
    const casas = [UNI('a1'), UNI('a2'), UNI('a3'), UNI('a4')];
    assert.equal((await P.pedir('POST', url('grupos'), b33.acceso, { nombre: 'Intruso', unidadIds: casas })).status, 403);
    const r = await P.pedir('POST', url('grupos'), pres.acceso, { nombre: 'Calle A · portón', descripcion: 'Casas detrás del portón', unidadIds: casas });
    assert.equal(r.status, 201, r.body);
    grupo = r.json.id;
    assert.equal(r.json.unidadIds.length, 4);
    assert.equal((await P.pedir('POST', url('grupos'), pres.acceso, { nombre: 'calle a · PORTÓN', unidadIds: casas })).status, 409);
    const editado = await P.pedir('PUT', url(`grupos/${grupo}`), pres.acceso, { nombre: 'Calle A · portón', unidadIds: casas.slice(0, 3) });
    assert.equal(editado.json.unidadIds.length, 3);
  });

  it('mensaje masivo al grupo: vista previa y envío; solo propietarios si se pide', async () => {
    const prev = await P.pedir('POST', url('difusiones/previa'), pres.acceso, { alcance: { tipo: 'grupo', grupoId: grupo } });
    assert.deepEqual(prev.json, { unidades: 3, personas: 1 }, 'solo Luis (A-11) tiene cuenta en esas casas');
    const r = await P.pedir('POST', url('difusiones'), pres.acceso, {
      titulo: 'Portón dañado', cuerpo: 'Mañana viene el técnico del portón de la calle A.', alcance: { tipo: 'grupo', grupoId: grupo } });
    assert.equal(r.status, 201, r.body);
    assert.ok((await notifs(a11)).some((x) => x.titulo === 'Portón dañado'));
    assert.ok(!(await notifs(b33)).some((x) => x.titulo === 'Portón dañado'));
    const soloProp = await P.pedir('POST', url('difusiones/previa'), pres.acceso,
      { alcance: { tipo: 'unidades', unidadIds: [UNI('b3')] }, soloPropietarios: true });
    assert.deepEqual(soloProp.json, { unidades: 1, personas: 1 }, 'sin el inquilino');
  });

  it('a todo el condominio, y el historial de mensajes para la junta', async () => {
    const r = await P.pedir('POST', url('difusiones'), teso.acceso, {
      titulo: 'Corte de agua', cuerpo: 'El sábado no habrá agua de 8 a 12.', alcance: { tipo: 'todos' } });
    assert.equal(r.status, 201);
    assert.equal(r.json.unidades, 8);
    for (const u of [a11, b31, b33inq]) assert.ok((await notifs(u)).some((x) => x.titulo === 'Corte de agua'));
    const h = (await P.pedir('GET', url('difusiones'), pres.acceso)).json as { titulo: string; alcanceNombre: string }[];
    assert.deepEqual(h.map((x) => x.titulo).slice(0, 3), ['Corte de agua', 'Portón dañado', 'Falta su voto']);
    assert.equal(h[0].alcanceNombre, 'Todo el condominio');
    assert.equal(h[1].alcanceNombre, 'Calle A · portón');
    assert.equal((await P.pedir('GET', url('difusiones'), a11.acceso)).status, 403);
    assert.equal((await P.pedir('POST', url('difusiones'), a11.acceso, { titulo: 'Spam', cuerpo: 'hola a todos', alcance: { tipo: 'todos' } })).status, 403);
  });

  it('cuota especial para un grupo guardado; casas de otro condominio se rechazan', async () => {
    const r = await P.pedir('POST', url('partidas'), pres.acceso, {
      titulo: 'Motor del portón', descripcion: '', presupuestoUsd: 300, numeroCuotas: 1, primeraCuota: '2027-01-01',
      reparto: 'unidad', someterAVotacion: false, umbralPct: 50.01, cierraEn: null, alcance: { tipo: 'grupo', grupoId: grupo }, difundir: false });
    assert.equal(r.status, 201, r.body);
    assert.equal(r.json.difusion, null);
    const p = (await partidas(a11)).find((x) => x.id === r.json.id);
    assert.equal(p.alcance.nombre, 'Calle A · portón');
    assert.equal(p.cuotaMiUnidadUsd, 100, '300 entre 3 casas, partes iguales');
    assert.ok(!(await partidas(b33)).some((x) => x.id === r.json.id));
    const mala = await P.pedir('POST', url('partidas'), pres.acceso, {
      titulo: 'Truco', descripcion: '', presupuestoUsd: 10, numeroCuotas: 1, primeraCuota: '2027-01-01', reparto: 'unidad',
      someterAVotacion: false, umbralPct: 50, cierraEn: null, alcance: { tipo: 'unidades', unidadIds: ['00000000-0000-0000-0000-0000000000ff'] } });
    assert.equal(mala.status, 400);
  });

  it('piso: se deduce del número y la junta lo puede corregir', async () => {
    const us = (await P.pedir('GET', url('unidades-alcance'), pres.acceso)).json as { etiqueta: string; piso: string | null; sector: string }[];
    assert.equal(us.find((u) => u.etiqueta === 'Apto B-33')!.piso, '3');
    assert.equal(us.find((u) => u.etiqueta === 'Apto B-33')!.sector, 'B');
    assert.equal((await P.pedir('PUT', url('alerta/cercania'), pres.acceso,
      [{ unidadId: UNI('b3'), sector: 'B', posicion: 33, piso: 'PH' }])).status, 200);
    const us2 = (await P.pedir('GET', url('unidades-alcance'), pres.acceso)).json as { etiqueta: string; piso: string | null }[];
    assert.equal(us2.find((u) => u.etiqueta === 'Apto B-33')!.piso, 'PH');
    assert.equal((await P.pedir('GET', url('unidades-alcance'), b33.acceso)).status, 403);
  });
});
