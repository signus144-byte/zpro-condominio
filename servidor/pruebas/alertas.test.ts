// Alerta vecinal: participación voluntaria, cercanía, verificación, respuestas, cierre, abuso; y enlace de invitación.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, UNI, crearPrueba, type Prueba } from './_api.js';
import { vencerAlertas } from '../src/tareas/index.js';

let P: Prueba;
type U = { id: string; acceso: string };
let pres: U, b33: U, b33fam: U, b32: U, b34: U, b31: U, a11: U, noInscrito: U;
const url = (r: string) => `c/${C}/${r}`;
const inscribir = (u: U, extra: Record<string, unknown> = {}) =>
  P.pedir('PUT', url('alerta/participacion'), u.acceso, { activo: true, ...extra });
const notifs = async (u: U) => ((await P.pedir('GET', 'notificaciones', u.acceso)).json as { notificaciones: { tipo: string; titulo: string; cuerpo: string; datos: { alertaId?: string } }[] }).notificaciones;
let alerta = '';

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  b33 = await P.miembro('Elena Castro', 'propietario', 'b3');
  b33fam = await P.miembro('Raul Castro', 'inquilino', 'b3');
  b32 = await P.miembro('Jose Blanco', 'propietario', 'b2');
  b34 = await P.miembro('Pedro Salas', 'propietario', 'b4');
  b31 = await P.miembro('Rosa Herrera', 'propietario', 'b1');
  a11 = await P.miembro('Luis Perez', 'propietario', 'a1');
  noInscrito = await P.miembro('Ana Sin Inscribir', 'propietario', 'b2');
  await P.base.admin.query(`update perfiles set telefono = '0414-1111111' where id = $1`, [b33.id]);
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

describe('configuración y participación', () => {
  it('la junta configura la red (activa y radio); un vecino no puede', async () => {
    assert.equal((await P.pedir('PUT', url('alerta/red'), b33.acceso, { activa: true, radio: 1 })).status, 403);
    assert.equal((await P.pedir('PUT', url('alerta/red'), pres.acceso, { activa: true, radio: 1 })).status, 204);
    const k = (await P.pedir('GET', url('alerta'), b33.acceso)).json;
    assert.equal(k.redActiva, true);
    assert.equal(k.radio, 1);
    assert.equal(k.participacion, null);
    assert.equal(k.puedoEmitir, false);
    assert.match(k.motivoNoPuede, /Inscríbase/);
  });

  it('participar es voluntario: quien no se inscribe no puede emitir', async () => {
    const r = await P.pedir('POST', url('alertas'), noInscrito.acceso, { tipo: 'medica', verificacion: 'biometria' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Inscríbase/);
  });

  it('cada vecino se inscribe con sus datos de ayuda (vehículo, salud, teléfono)', async () => {
    assert.equal((await inscribir(b33, { telefono: '0414-3333333' })).status, 204);
    assert.equal((await inscribir(b32, { tieneVehiculo: true, telefono: '0412-2222222' })).status, 204);
    assert.equal((await inscribir(b34, { personalSalud: true })).status, 204);
    assert.equal((await inscribir(b31)).status, 204);
    assert.equal((await inscribir(a11)).status, 204);
    assert.equal((await P.pedir('PUT', url('alerta/participacion'), pres.acceso, { activo: true })).status, 403, 'sin casa no participa');
    const k = (await P.pedir('GET', url('alerta'), b32.acceso)).json;
    assert.deepEqual([k.participacion.activo, k.participacion.tieneVehiculo, k.puedoEmitir], [true, true, true]);
  });

  it('cercanía: por defecto bloque y número; la junta puede ajustarla', async () => {
    const cer = (await P.pedir('GET', url('alerta/cercania'), pres.acceso)).json as { etiqueta: string; sector: string; posicion: number }[];
    assert.deepEqual(cer.find((u) => u.etiqueta === 'Apto B-33'), { unidadId: UNI('b3'), etiqueta: 'Apto B-33', sector: 'B', posicion: 33, personalizada: false });
    assert.equal((await P.pedir('GET', url('alerta/cercania'), b33.acceso)).status, 403);
  });
});

describe('emitir y atender una alerta', () => {
  it('en la web la identidad se confirma con la clave: clave errada → no sale', async () => {
    const r = await P.pedir('POST', url('alertas'), b33.acceso, { tipo: 'medica', verificacion: 'clave', clave: 'equivocada' });
    assert.equal(r.status, 401);
    assert.equal(Number((await P.base.admin.query(`select count(*) from alertas`)).rows[0].count), 0);
  });

  it('emergencia médica en B-33: avisa a las casas cercanas inscritas, a su familia y a la junta; a nadie más', async () => {
    const r = await P.pedir('POST', url('alertas'), b33.acceso, { tipo: 'medica', nota: 'Mi papá se desmayó', verificacion: 'clave', clave: 'clave-segura-123' });
    assert.equal(r.status, 201, r.body);
    alerta = r.json.id;
    assert.equal(r.json.alcance, 'cercanos');
    assert.equal(r.json.emisor.unidad, 'Apto B-33');
    assert.equal(r.json.emisor.nombre, 'Elena Castro');
    assert.equal(r.json.soyEmisor, true);
    const dest = (await P.base.admin.query(`select usuario_id, motivo from alerta_destinatarios where alerta_id = $1`, [alerta])).rows;
    const motivo = (u: U) => dest.find((d) => d.usuario_id === u.id)?.motivo;
    assert.equal(motivo(b32), 'cercano');
    assert.equal(motivo(b34), 'cercano');
    assert.equal(motivo(b33fam), 'misma_casa');
    assert.equal(motivo(pres), 'junta');
    assert.equal(motivo(b31), undefined, 'B-31 está a 2 casas (radio 1)');
    assert.equal(motivo(a11), undefined, 'otro bloque');
    assert.equal(motivo(noInscrito), undefined, 'no se inscribió');
    assert.equal(motivo(b33), undefined, 'quien emite no se avisa a sí misma');
    const n = (await notifs(b32)).find((x) => x.tipo === 'alerta')!;
    assert.equal(n.titulo, '🚨 Emergencia médica en Apto B-33');
    assert.match(n.cuerpo, /Elena Castro \(Apto B-33\) pide ayuda\. «Mi papá se desmayó»/);
    assert.equal(n.datos.alertaId, alerta);
    assert.ok((await notifs(pres)).some((x) => x.tipo === 'alerta'), 'la presidenta se entera');
    assert.ok(!(await notifs(a11)).some((x) => x.tipo === 'alerta'));
  });

  it('quien no fue avisado no la ve; los avisados ven el teléfono de quien pide ayuda', async () => {
    assert.equal((await P.pedir('GET', url(`alertas/${alerta}`), a11.acceso)).status, 404);
    const a = (await P.pedir('GET', url(`alertas/${alerta}`), b32.acceso)).json;
    assert.equal(a.emisor.telefono, '0414-3333333', 'el teléfono de emergencias que dio al inscribirse');
    assert.equal(a.puedoResponder, true);
    assert.equal(a.puedoCerrar, false);
    assert.equal(a.destinatarios, 4);
  });

  it('los vecinos responden: "tengo vehículo", "voy en camino"; quien pide ayuda ve quién viene y su teléfono', async () => {
    assert.equal((await P.pedir('POST', url(`alertas/${alerta}/visto`), b34.acceso)).status, 204);
    assert.equal((await P.pedir('POST', url(`alertas/${alerta}/responder`), b32.acceso, { respuesta: 'vehiculo' })).status, 200);
    assert.equal((await P.pedir('POST', url(`alertas/${alerta}/responder`), b34.acceso, { respuesta: 'voy' })).status, 200);
    assert.equal((await P.pedir('POST', url(`alertas/${alerta}/responder`), a11.acceso, { respuesta: 'voy' })).status, 404, 'no fue avisado: ni la ve');
    const a = (await P.pedir('GET', url(`alertas/${alerta}`), b33.acceso)).json;
    assert.equal(a.vistos, 2);
    const r32 = a.respuestas.find((r: { nombre: string }) => r.nombre === 'Jose Blanco');
    assert.deepEqual([r32.respuesta, r32.tieneVehiculo, r32.telefono, r32.unidad], ['vehiculo', true, '0412-2222222', 'Apto B-32']);
    const r34 = a.respuestas.find((r: { nombre: string }) => r.nombre === 'Pedro Salas');
    assert.equal(r34.personalSalud, true);
  });

  it('una alerta activa a la vez', async () => {
    const r = await P.pedir('POST', url('alertas'), b33.acceso, { tipo: 'seguridad', verificacion: 'biometria' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Ya tiene una alerta activa/);
  });

  it('ampliar a todo el condominio avisa también a los inscritos lejanos', async () => {
    assert.equal((await P.pedir('POST', url(`alertas/${alerta}/ampliar`), b32.acceso)).status, 403, 'solo quien la emitió o la junta');
    const r = await P.pedir('POST', url(`alertas/${alerta}/ampliar`), b33.acceso);
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.alcance, 'todos');
    assert.ok((await notifs(a11)).some((x) => x.tipo === 'alerta' && x.datos.alertaId === alerta));
    assert.ok((await notifs(b31)).some((x) => x.tipo === 'alerta'));
    assert.equal((await notifs(b32)).filter((x) => x.tipo === 'alerta').length, 1, 'los ya avisados no se repiten');
  });

  it('quien la emitió la marca atendida: todos reciben el cierre y ya no se puede responder', async () => {
    assert.equal((await P.pedir('POST', url(`alertas/${alerta}/cerrar`), b32.acceso, { estado: 'atendida' })).status, 403);
    const r = await P.pedir('POST', url(`alertas/${alerta}/cerrar`), b33.acceso, { estado: 'atendida', nota: 'Ya llegó la ambulancia' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.estado, 'atendida');
    const n = (await notifs(b34)).find((x) => x.tipo === 'alerta_cerrada')!;
    assert.equal(n.titulo, '✅ Emergencia atendida en Apto B-33');
    assert.match(n.cuerpo, /Ya llegó la ambulancia/);
    assert.equal((await P.pedir('POST', url(`alertas/${alerta}/responder`), b32.acceso, { respuesta: 'voy' })).status, 400);
  });

  it('incendio avisa de una vez a todo el condominio', async () => {
    const r = await P.pedir('POST', url('alertas'), b31.acceso, { tipo: 'incendio', verificacion: 'credencial' });
    assert.equal(r.status, 201, r.body);
    assert.equal(r.json.alcance, 'todos');
    assert.ok((await notifs(a11)).some((x) => x.tipo === 'alerta' && x.titulo === '🚨 Incendio en Apto B-31'));
    // La junta la marca como falsa alarma.
    assert.equal((await P.pedir('POST', url(`alertas/${r.json.id}/cerrar`), pres.acceso, { estado: 'falsa_alarma' })).status, 200);
  });
});

describe('contra el abuso', () => {
  it('máximo 3 alertas en 24 horas por persona', async () => {
    for (let i = 0; i < 2; i++) {
      const r = await P.pedir('POST', url('alertas'), b33.acceso, { tipo: 'otra', verificacion: 'biometria' });
      assert.equal(r.status, 201);
      await P.pedir('POST', url(`alertas/${r.json.id}/cerrar`), b33.acceso, { estado: 'cancelada' });
    }
    const r = await P.pedir('POST', url('alertas'), b33.acceso, { tipo: 'otra', verificacion: 'biometria' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /máximo de 3 alertas/);
  });

  it('la junta ve participantes con sus falsas alarmas y puede suspender a alguien', async () => {
    const ps = (await P.pedir('GET', url('alerta/participantes'), pres.acceso)).json as { usuarioId: string; falsasAlarmas: number; alertasEmitidas: number }[];
    assert.equal(ps.find((p) => p.usuarioId === b31.id)!.falsasAlarmas, 1);
    assert.equal(ps.find((p) => p.usuarioId === b33.id)!.alertasEmitidas, 3);
    assert.equal((await P.pedir('GET', url('alerta/participantes'), b32.acceso)).status, 403);
    assert.equal((await P.pedir('POST', url(`alerta/participantes/${b31.id}/suspender`), pres.acceso, { dias: 30, motivo: 'Falsa alarma' })).status, 204);
    const k = (await P.pedir('GET', url('alerta'), b31.acceso)).json;
    assert.equal(k.puedoEmitir, false);
    assert.match(k.motivoNoPuede, /suspendió/);
    assert.equal((await P.pedir('POST', url(`alerta/participantes/${b31.id}/suspender`), pres.acceso, { dias: 0 })).status, 204);
    assert.equal((await P.pedir('GET', url('alerta'), b31.acceso)).json.puedoEmitir, true);
  });

  it('las alertas olvidadas se cierran solas a las 3 horas', async () => {
    const r = await P.pedir('POST', url('alertas'), b32.acceso, { tipo: 'seguridad', verificacion: 'biometria' });
    await P.base.admin.query(`update alertas set creado_en = now() - interval '4 hours' where id = $1`, [r.json.id]);
    assert.equal(await vencerAlertas(P.app.ctx), 1);
    assert.equal((await P.pedir('GET', url(`alertas/${r.json.id}`), b32.acceso)).json.estado, 'vencida');
  });

  it('con la red apagada nadie emite', async () => {
    assert.equal((await P.pedir('PUT', url('alerta/red'), pres.acceso, { activa: false })).status, 204);
    const r = await P.pedir('POST', url('alertas'), b34.acceso, { tipo: 'seguridad', verificacion: 'biometria' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no ha activado/);
    await P.pedir('PUT', url('alerta/red'), pres.acceso, { activa: true });
  });
});

describe('enlace de invitación', () => {
  let codigo = '';
  it('la junta obtiene su enlace (siempre el mismo hasta regenerarlo); un vecino no', async () => {
    const r = await P.pedir('GET', url('invitacion'), pres.acceso);
    assert.equal(r.status, 200, r.body);
    codigo = r.json.codigo;
    assert.match(codigo, /^INV-[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(r.json.url, `http://localhost:5173/#/invitacion/${codigo}`);
    assert.equal((await P.pedir('GET', url('invitacion'), pres.acceso)).json.codigo, codigo);
    assert.equal((await P.pedir('GET', url('invitacion'), b33.acceso)).status, 403);
  });

  it('cualquiera con el enlace ve el condominio y sus casas (sin nombres)', async () => {
    const r = await P.pedir('GET', `invitacion/${codigo.toLowerCase()}`, null);
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.condominio, 'Residencias Los Samanes (demo)');
    assert.equal(r.json.unidades.length, 8);
    assert.deepEqual(Object.keys(r.json.unidades[0]).sort(), ['etiqueta', 'id']);
    assert.equal((await P.pedir('GET', 'invitacion/INV-NOEXISTE', null)).status, 400);
  });

  it('un vecino nuevo pide entrar eligiendo su casa; la junta recibe el aviso y aprueba', async () => {
    const nuevo = await P.registrar('Vecina Nueva', 'vecina.nueva@correo.com');
    assert.equal((await P.pedir('POST', `invitacion/${codigo}/unirse`, null, { unidadId: UNI('a2') })).status, 401);
    const r = await P.pedir('POST', `invitacion/${codigo}/unirse`, nuevo.acceso, { unidadId: UNI('a2'), rol: 'inquilino' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.estado, 'pendiente');
    const n = (await notifs(pres)).find((x) => x.tipo === 'solicitud_ingreso')!;
    assert.equal(n.titulo, 'Solicitud de ingreso: Apto A-12');
    assert.match(n.cuerpo, /Vecina Nueva pide entrar al condominio como residente de Apto A-12/);
    const sol = (await P.pedir('GET', url('solicitudes'), pres.acceso)).json as { id: string; unidad: string | null }[];
    const s = sol.find((x) => x.unidad?.includes('A-12'))!;
    assert.ok(s, JSON.stringify(sol));
    assert.equal((await P.pedir('POST', url(`solicitudes/${s.id}`), pres.acceso, { aprobar: true })).status, 204);
    const yo = (await P.pedir('GET', 'auth/yo', nuevo.acceso)).json;
    assert.equal(yo.membresias[0].rol, 'inquilino');
  });

  it('regenerar invalida el enlace anterior', async () => {
    const r = await P.pedir('POST', url('invitacion/regenerar'), pres.acceso);
    assert.notEqual(r.json.codigo, codigo);
    assert.equal((await P.pedir('GET', `invitacion/${codigo}`, null)).status, 400);
  });
});
