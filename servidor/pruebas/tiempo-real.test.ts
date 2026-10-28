// Tiempo real con sockets reales: LISTEN/NOTIFY de PostgreSQL → WebSocket.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { construirApp } from '../src/app.js';
import { leerConfig } from '../src/config.js';
import { iniciarBase, type Entorno } from './_entorno.js';
import { C, UNI, formulario } from './_api.js';

let base: Entorno;
let app: FastifyInstance;
let puerto: number;
type U = { id: string; acceso: string };
let b33: U, a11: U, b34: U, pres: U;
const abiertos: WebSocket[] = [];
const correos: { para: string; asunto: string; texto: string }[] = [];

async function pedir(metodo: 'GET' | 'POST', url: string, token: string | null, cuerpo?: unknown) {
  const r = await app.inject({ method: metodo, url: `/api/v1/${url}`, headers: token ? { authorization: `Bearer ${token}` } : {},
                               ...(cuerpo !== undefined ? { payload: cuerpo as object } : {}) });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null };
}
let n = 0;
async function miembro(nombre: string, rol: string, unidad: string | null): Promise<U> {
  const r = await pedir('POST', 'auth/registro', null, { nombre, correo: `tr${n++}@prueba.local`, clave: 'clave-segura-123' });
  await base.admin.query(`insert into membresias (condominio_id, usuario_id, rol, unidad_id) values ($1, $2, $3, $4)`,
    [C, r.json.id, rol, unidad ? UNI(unidad) : null]);
  return { id: r.json.id, acceso: r.json.acceso };
}

/** Cliente WS que acumula eventos y permite esperar uno. */
function conectar(token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${puerto}/api/v1/tiempo-real?token=${encodeURIComponent(token)}`);
  abiertos.push(ws);
  const eventos: any[] = [];
  const esperas: { pred: (e: any) => boolean; ok: (e: any) => void }[] = [];
  ws.on('message', (d) => {
    const e = JSON.parse(String(d));
    eventos.push(e);
    for (const w of [...esperas]) if (w.pred(e)) { esperas.splice(esperas.indexOf(w), 1); w.ok(e); }
  });
  const cerrado = new Promise<{ codigo: number }>((ok) => ws.on('close', (codigo) => ok({ codigo })));
  return {
    ws, eventos, cerrado,
    abierto: new Promise<void>((ok, mal) => { ws.once('open', () => ok()); ws.once('error', mal); }),
    enviar: (o: unknown) => ws.send(JSON.stringify(o)),
    esperar(pred: (e: any) => boolean, ms = 4000) {
      const ya = eventos.find(pred);
      if (ya) return Promise.resolve(ya);
      return new Promise<any>((ok, mal) => {
        const t = setTimeout(() => mal(new Error('No llegó el evento esperado')), ms);
        esperas.push({ pred, ok: (e) => { clearTimeout(t); ok(e); } });
      });
    },
  };
}

before(async () => {
  base = await iniciarBase({ demo: true });
  const cfg = leerConfig({ NODE_ENV: 'test', DATABASE_URL: base.apiUrl, DATABASE_ADMIN_URL: base.adminUrl, TAREAS_ACTIVAS: 'no',
                           ARCHIVOS_DIR: mkdtempSync(path.join(tmpdir(), 'zpro-tr-')), URL_PUBLICA: 'http://prueba' });
  app = await construirApp(cfg, { enviarCorreo: async (c) => { correos.push(c); } });   // SIN hub inyectado: usa el real
  await app.listen({ port: 0, host: '127.0.0.1' });
  puerto = (app.server.address() as { port: number }).port;
  pres = await miembro('Maria Pres', 'presidente', null);
  b33 = await miembro('Elena Castro', 'propietario', 'b3');
  a11 = await miembro('Luis Perez', 'propietario', 'a1');
  b34 = await miembro('Pedro Salas', 'propietario', 'b4');
}, { timeout: 120_000 });

after(async () => {
  for (const w of abiertos) w.terminate();
  await app?.close();
  await base?.detener();
});

describe('WebSocket /api/v1/tiempo-real', () => {
  it('sin token válido se cierra con 4401', async () => {
    const c = conectar('token-falso');
    assert.equal((await c.cerrado).codigo, 4401);
  });

  it('ping → pong', async () => {
    const c = conectar(b33.acceso);
    await c.abierto;
    c.enviar({ tipo: 'ping' });
    assert.equal((await c.esperar((e) => e.tipo === 'pong')).tipo, 'pong');
  });

  it('el vecino suscrito recibe el mensaje al instante; un extraño no se puede suscribir', async () => {
    const conv = (await pedir('POST', `c/${C}/conversaciones/casa`, b33.acceso, { unidadId: UNI('a1') })).json.id;
    const vecino = conectar(a11.acceso);
    const autor = conectar(b33.acceso);
    const intruso = conectar(b34.acceso);
    await Promise.all([vecino.abierto, autor.abierto, intruso.abierto]);
    vecino.enviar({ tipo: 'suscribir', conversacionId: conv });
    autor.enviar({ tipo: 'suscribir', conversacionId: conv });
    intruso.enviar({ tipo: 'suscribir', conversacionId: conv });
    await vecino.esperar((e) => e.tipo === 'suscrito');
    await autor.esperar((e) => e.tipo === 'suscrito');
    const neg = await intruso.esperar((e) => e.conversacionId === conv);
    assert.equal(neg.tipo, 'error');

    const t0 = Date.now();
    await pedir('POST', `c/${C}/conversaciones/${conv}/mensajes`, b33.acceso, { texto: '¿Su carro es el gris?' });
    const ev = await vecino.esperar((e) => e.tipo === 'mensaje');
    assert.ok(Date.now() - t0 < 2000, 'llega en menos de 2 s');
    assert.equal(ev.mensaje.texto, '¿Su carro es el gris?');
    assert.equal(ev.mensaje.autorEtiqueta, 'Apto B-33');
    assert.equal(ev.mensaje.autorNombre, 'Elena Castro');
    assert.equal(ev.mensaje.esMio, false);
    const propio = await autor.esperar((e) => e.tipo === 'mensaje');
    assert.equal(propio.mensaje.esMio, true);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!intruso.eventos.some((e) => e.tipo === 'mensaje' || e.tipo === 'bandeja'), 'el intruso no recibe nada');
  });

  it('quien no tiene la sala abierta recibe un aviso de "bandeja"', async () => {
    const conv = (await pedir('POST', `c/${C}/conversaciones/casa`, pres.acceso, { unidadId: UNI('b4') })).json.id;
    const pedro = conectar(b34.acceso);
    await pedro.abierto;
    await new Promise((r) => setTimeout(r, 100));
    await pedir('POST', `c/${C}/conversaciones/${conv}/mensajes`, pres.acceso, { texto: 'Recordatorio de saldo' });
    const ev = await pedro.esperar((e) => e.tipo === 'bandeja');
    assert.equal(ev.conversacionId, conv);
  });

  it('editar un mensaje avisa "mensaje_actualizado"', async () => {
    const conv = (await pedir('POST', `c/${C}/conversaciones/casa`, b33.acceso, { unidadId: UNI('a1') })).json.id;
    const vecino = conectar(a11.acceso);
    await vecino.abierto;
    vecino.enviar({ tipo: 'suscribir', conversacionId: conv });
    await vecino.esperar((e) => e.tipo === 'suscrito');
    const m = (await pedir('POST', `c/${C}/conversaciones/${conv}/mensajes`, b33.acceso, { texto: 'con erorr' })).json;
    await app.inject({ method: 'PATCH', url: `/api/v1/c/${C}/mensajes/${m.id}`, headers: { authorization: `Bearer ${b33.acceso}` }, payload: { texto: 'sin error' } });
    const ev = await vecino.esperar((e) => e.tipo === 'mensaje_actualizado' && e.mensaje.id === m.id);
    assert.equal(ev.mensaje.texto, 'sin error');
    assert.equal(ev.mensaje.editado, true);
  });

  it('cuando Tesorería confirma un pago, la casa recibe el evento "pago"', async () => {
    const elena = conectar(b33.acceso);
    await elena.abierto;
    await new Promise((r) => setTimeout(r, 100));
    const { rows } = await base.admin.query(
      `insert into pagos (condominio_id, unidad_id, fecha_pago, metodo, moneda, monto, monto_usd, referencia)
       values ($1, $2, current_date, 'zelle', 'USD', 50, 50, 'ZL-TR-1') returning id`, [C, UNI('b3')]);
    await pedir('POST', `c/${C}/pagos/${rows[0].id}/confirmar`, pres.acceso, {}).catch(() => null);
    // Si la ruta de pagos aún no existe (la hace otro módulo), se confirma directo en la BD: el aviso es el mismo.
    await base.admin.query(`update pagos set estado = 'confirmado' where id = $1 and estado = 'reportado'`, [rows[0].id]);
    const ev = await elena.esperar((e) => e.tipo === 'pago');
    assert.equal(ev.pagoId, rows[0].id);
    assert.equal(ev.estado, 'confirmado');
  });

  it('la casa recibe la notificación "Pago aprobado" al instante y por correo; la junta, "Pago por revisar"', async () => {
    await base.admin.query(`update auth.users set correo_verificado_en = now() where id = $1`, [b33.id]);
    const elena = conectar(b33.acceso);
    const maria = conectar(pres.acceso);
    await Promise.all([elena.abierto, maria.abierto]);
    await new Promise((r) => setTimeout(r, 100));
    const f = formulario({ unidadId: UNI('b3'), fechaPago: new Date().toISOString().slice(0, 10), metodo: 'pago_movil', moneda: 'VES', monto: '21550', referencia: '55667788' });
    const r = await app.inject({ method: 'POST', url: `/api/v1/c/${C}/pagos`,
      headers: { authorization: `Bearer ${b33.acceso}`, 'content-type': f.contentType }, payload: f.payload });
    assert.equal(r.statusCode, 201, r.body);
    const id = JSON.parse(r.body).id;
    const aviso = await maria.esperar((e) => e.tipo === 'notificacion' && e.notificacion.tipo === 'pago_reportado');
    assert.match(aviso.notificacion.cuerpo, /Apto B-33 reportó Bs 21\.550,00 \(ref\. 55667788\)/);
    assert.equal((await pedir('POST', `c/${C}/pagos/${id}/confirmar`, pres.acceso, {})).status, 204);
    const ev = await elena.esperar((e) => e.tipo === 'notificacion' && e.notificacion.tipo === 'pago_confirmado');
    assert.equal(ev.notificacion.titulo, 'Pago aprobado');
    assert.equal(ev.notificacion.datos.pagoId, id);
    await new Promise((r2) => setTimeout(r2, 200));
    const correo = correos.find((c) => c.asunto.startsWith('Pago aprobado'));
    assert.ok(correo, 'se envió el correo');
    assert.match(correo!.para, /@prueba\.local$/);
    assert.ok(!correos.some((c) => c.asunto.startsWith('Pago por revisar')), 'el aviso inmediato a la junta no va por correo');
  });

  it('alerta vecinal: la junta recibe la notificación y el evento "alerta" al instante; al responder, quien pidió ayuda se entera', async () => {
        for (const u of [b34, a11]) {
      const r = await app.inject({ method: 'PUT', url: `/api/v1/c/${C}/alerta/participacion`, headers: { authorization: `Bearer ${u.acceso}` },
                                   payload: { activo: true } });
      assert.equal(r.statusCode, 204, r.body);
    }
    const maria = conectar(pres.acceso);
    const pedro = conectar(b34.acceso);
    await Promise.all([maria.abierto, pedro.abierto]);
    await new Promise((r) => setTimeout(r, 100));
    const r = await pedir('POST', `c/${C}/alertas`, b34.acceso, { tipo: 'seguridad', nota: 'Intentan abrir mi carro', verificacion: 'biometria' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const n = await maria.esperar((e) => e.tipo === 'notificacion' && e.notificacion.tipo === 'alerta');
    assert.equal(n.notificacion.titulo, '🚨 Emergencia de seguridad en Apto B-34');
    assert.equal((await maria.esperar((e) => e.tipo === 'alerta' && e.evento === 'nueva')).alertaId, r.json.id);
    assert.equal((await pedir('POST', `c/${C}/alertas/${r.json.id}/cerrar`, pres.acceso, { estado: 'atendida' })).status, 200);
    assert.equal((await pedro.esperar((e) => e.tipo === 'alerta' && e.evento === 'cerrada')).alertaId, r.json.id);
  });
});
