// Tareas programadas y notificaciones push: tasa BCV, purga del chat, facturación de ZentaPro, suspensión.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { C, PNG, UNI, crearPrueba, formulario, type Prueba } from './_api.js';
import { actualizarTasaBcv, extraerTasaBcv, facturarMes, purgarChat, suspenderMorosos } from '../src/tareas/index.js';
import { crearPush } from '../src/push.js';

let P: Prueba;
before(async () => { P = await crearPrueba(); }, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

const HTML_BCV = `
<div id="euro" class="col-sm-12 col-xs-12"><strong> 251,10000000 </strong></div>
<div id="dolar" class="col-sm-12 col-xs-12 "><div class="field-content"><div class="row recuadrotsmc">
  <div class="col-sm-6 col-xs-6"><img src="/sites/all/themes/bcv/images/usd.png"> <span> USD</span></div>
  <div class="col-sm-6 col-xs-6 centrado"><strong> 220,45670000 </strong></div></div></div></div>
<div class="pull-right dinpro center"> Fecha Valor:  <span class="date-display-single" property="dc:date"
  datatype="xsd:dateTime" content="2026-10-28T00:00:00-04:00">Miércoles, 28 Octubre  2026</span></div>`;

describe('tasa BCV', () => {
  it('extrae el dólar (no el euro) y la fecha valor', () => {
    assert.deepEqual(extraerTasaBcv(HTML_BCV), { usdVes: 220.4567, fecha: '2026-10-28' });
  });
  it('entiende separador de miles y falla en voz alta si cambia el formato', () => {
    assert.equal(extraerTasaBcv('<div id="dolar"><strong>1.234,56</strong></div>').usdVes, 1234.56);
    assert.throws(() => extraerTasaBcv('<html>sin tasa</html>'), /cambió su formato/);
    assert.throws(() => extraerTasaBcv('<div id="dolar"><strong>0,00</strong></div>'), /inválida/);
  });
  it('actualizarTasaBcv guarda la tasa con su fecha valor', async () => {
    const falso = (async () => new Response(HTML_BCV, { status: 200 })) as typeof fetch;
    const r = await actualizarTasaBcv(P.app.ctx, falso);
    assert.equal(r.fecha, '2026-10-28');
    const fila = (await P.base.admin.query(`select usd_ves, fuente from tasas_bcv where fecha = '2026-10-28'`)).rows[0];
    assert.equal(Number(fila.usd_ves), 220.4567);
    assert.equal(fila.fuente, 'BCV');
    const caido = (async () => new Response('', { status: 503 })) as typeof fetch;
    await assert.rejects(actualizarTasaBcv(P.app.ctx, caido), /503/);
  });
});

describe('purga del chat', () => {
  it('borra del servidor el archivo vencido (bytes y registro) y deja el mensaje', async () => {
    const b33 = await P.miembro('Elena Purga', 'propietario', 'b3');
    await P.miembro('Luis Purga', 'propietario', 'a1');
    const conv = (await P.pedir('POST', `c/${C}/conversaciones/casa`, b33.acceso, { unidadId: UNI('a1') })).json.id;
    const f = formulario({ texto: 'comprobante' }, [{ campo: 'archivo', nombre: 'c.png', mime: 'image/png', datos: PNG }]);
    const m = (await P.pedir('POST', `c/${C}/conversaciones/${conv}/mensajes`, b33.acceso, f)).json;
    const ruta = (await P.base.admin.query(`select path from adjuntos where id = $1`, [m.adjunto.id])).rows[0].path;
    await P.app.ctx.almacen.leer('chat', ruta);   // existe
    const url = m.adjunto.url.replace('http://prueba', '');
    assert.equal((await P.pedir('GET', url)).status, 200);

    assert.deepEqual(await purgarChat(P.app.ctx), { archivos: 0, mensajes: 0 }, 'nada vencido todavía');
    await P.base.admin.query(`update adjuntos set expira_en = now() - interval '1 minute' where id = $1`, [m.adjunto.id]);
    const r = await purgarChat(P.app.ctx);
    assert.equal(r.archivos, 1);
    await assert.rejects(P.app.ctx.almacen.leer('chat', ruta));
    assert.equal((await P.base.admin.query(`select count(*)::int n from storage.objects where name = $1`, [ruta])).rows[0].n, 0);
    assert.equal((await P.pedir('GET', url)).status, 410, 'la URL firmada vieja dice "ya no está en el servidor"');
    const msgs = (await P.pedir('GET', `c/${C}/conversaciones/${conv}/mensajes`, b33.acceso)).json;
    assert.equal(msgs.at(-1).texto, 'comprobante');
    assert.equal(msgs.at(-1).adjunto.vencido, true);
  });

  it('borra mensajes más viejos que la retención del condominio', async () => {
    // Simula un mensaje viejo (sin disparadores: la regla de 15 minutos de edición no aplica al ajuste de prueba).
    await P.base.admin.query(`set session_replication_role = replica; update mensajes set creado_en = now() - interval '30 months' where texto = 'comprobante'; set session_replication_role = origin;`);
    assert.equal((await purgarChat(P.app.ctx)).mensajes, 1);
  });
});

describe('cobro de ZentaPro', () => {
  it('facturación del mes: emite a los activos y no duplica', async () => {
    await P.base.admin.query(`update condominios set estado = 'activo' where id = $1`, [C]);
    const r = await facturarMes(P.app.ctx, '2026-11-01');
    assert.deepEqual(r.emitidas, ['Residencias Los Samanes (demo)']);
    assert.equal(r.fallidas.length, 0);
    assert.equal((await facturarMes(P.app.ctx, '2026-11-01')).emitidas.length, 0);
    const f = (await P.base.admin.query(`select monto_usd from facturas_plataforma where condominio_id = $1`, [C])).rows[0];
    assert.equal(Number(f.monto_usd), 40, 'plan Pequeño (hasta 50 unidades): precio global de $40');
  });

  it('suspensión: factura vencida + 10 días → solo lectura', async () => {
    assert.equal(await suspenderMorosos(P.app.ctx, 10), 0);
    await P.base.admin.query(`update facturas_plataforma set vence = current_date - 15 where condominio_id = $1`, [C]);
    assert.equal(await suspenderMorosos(P.app.ctx, 10), 1);
    assert.equal((await P.base.admin.query(`select estado from condominios where id = $1`, [C])).rows[0].estado, 'suspendido');
    await P.base.admin.query(`update condominios set estado = 'activo' where id = $1`, [C]);
  });
});

describe('notificaciones push (Firebase)', () => {
  it('envía al teléfono de la casa destinataria y borra tokens dados de baja', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const cuenta = JSON.stringify({ client_email: 'push@zpro.iam.gserviceaccount.com', project_id: 'zpro-prueba',
                                    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
    const llamadas: { url: string; cuerpo: string }[] = [];
    const falso = (async (url: string | URL, init?: RequestInit) => {
      llamadas.push({ url: String(url), cuerpo: String(init?.body ?? '') });
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok-google', expires_in: 3600 }));
      return new Response('{}', { status: String(init?.body).includes('tok-viejo') ? 404 : 200 });
    }) as typeof fetch;
    const log = { warn() {}, error() {} };
    assert.equal(crearPush(undefined, P.base.api, log), null, 'sin credenciales no hay push');
    const push = crearPush(cuenta, P.base.api, log, falso)!;

    const pres = await P.miembro('Pres Push', 'presidente');
    const b34 = await P.miembro('Pedro Push', 'propietario', 'b4');
    await P.base.admin.query(`insert into dispositivos (token, usuario_id, plataforma) values ('tok-b34', $1, 'android'), ('tok-viejo', $1, 'android'), ('tok-pres', $2, 'android')`, [b34.id, pres.id]);
    const conv = (await P.pedir('POST', `c/${C}/conversaciones/casa`, pres.acceso, { unidadId: UNI('b4') })).json.id;
    const m = (await P.pedir('POST', `c/${C}/conversaciones/${conv}/mensajes`, pres.acceso, { texto: 'Le recordamos su saldo' })).json;

    assert.equal(await push.mensaje(m.id), 1);
    const envios = llamadas.filter((l) => l.url.includes('fcm.googleapis.com'));
    assert.equal(envios.length, 2, 'a los 2 teléfonos de B-34, no al de quien escribió');
    assert.ok(envios.every((l) => !l.cuerpo.includes('tok-pres')));
    assert.match(envios[0].cuerpo, /Junta de condominio/);
    assert.equal(llamadas.filter((l) => l.url.includes('oauth2')).length, 1);
    assert.equal((await P.base.admin.query(`select count(*)::int n from dispositivos where token = 'tok-viejo'`)).rows[0].n, 0);
    await push.mensaje(m.id);
    assert.equal(llamadas.filter((l) => l.url.includes('oauth2')).length, 1, 'el token de Google se reutiliza');
    // Alerta vecinal: canal de alarma de Android, máxima prioridad.
    await push.enviarA(['tok-b34'], '🚨 Emergencia médica en Apto B-33', 'Elena pide ayuda', { tipo: 'alerta', alertaId: 'x' }, true);
    const alarma = JSON.parse(llamadas.at(-1)!.cuerpo).message;
    assert.equal(alarma.android.notification.channel_id, 'alarma_vecinal');
    assert.equal(alarma.android.notification.sound, 'alarma');
    assert.equal(alarma.android.priority, 'high');
    assert.equal(alarma.data.tipo, 'alerta');
  });
});

describe('archivos huérfanos', () => {
  it('borra bytes sin registro en storage.objects y respeta los registrados y los recientes', async () => {
    const { purgarHuerfanos } = await import('../src/tareas/purga.js');
    const { utimes } = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const ctx = P.app.ctx;
    await ctx.almacen.guardar('comprobantes', 'huerfano/viejo.jpg', Buffer.from('x'));
    await ctx.almacen.guardar('comprobantes', 'huerfano/nuevo.jpg', Buffer.from('y'));
    const viejo = pathMod.resolve(ctx.cfg.ARCHIVOS_DIR, 'comprobantes', 'huerfano/viejo.jpg');
    const haceDosDias = new Date(Date.now() - 48 * 3600_000);
    await utimes(viejo, haceDosDias, haceDosDias);
    const r = await purgarHuerfanos(ctx, 24);
    assert.ok(r.huerfanos >= 1);
    await assert.rejects(ctx.almacen.leer('comprobantes', 'huerfano/viejo.jpg'));
    assert.ok(await ctx.almacen.leer('comprobantes', 'huerfano/nuevo.jpg'), 'el reciente se respeta');
  });
});
