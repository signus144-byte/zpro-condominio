// Reglas de negocio v0.1 sobre PostgreSQL 18 real: finanzas, pagos, votaciones, reportes anónimos, bitácora.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBase, sqlComo, crearUsuario } from '../_entorno.ts';

test('reglas de negocio (finanzas, votaciones, reportes)', { timeout: 120_000 }, async () => {
const E = await iniciarBase({ demo: true });
let fallas = 0;
const ok = (m) => console.log('  ✔', m);
const fail = (m) => { console.log('  ✘', m); fallas++; };
const db = { exec: (s) => E.admin.query(s), query: (s, p) => E.admin.query(s, p) };

const C = '00000000-0000-0000-0000-0000000000c1';
const U = { pres: '10000000-0000-0000-0000-000000000001', teso: '10000000-0000-0000-0000-000000000002',
            b33: '10000000-0000-0000-0000-000000000033', b34: '10000000-0000-0000-0000-000000000034' };
await crearUsuario(E.admin, U.pres, 'María (presidenta)');
await crearUsuario(E.admin, U.teso, 'Jorge (tesorero)');
await crearUsuario(E.admin, U.b33, 'Elena B-33');
await crearUsuario(E.admin, U.b34, 'Pedro B-34');
await db.exec(`
  insert into membresias (condominio_id, usuario_id, rol, unidad_id) values
   ('${C}','${U.pres}','presidente',null),('${C}','${U.teso}','tesorero',null),
   ('${C}','${U.b33}','propietario','00000000-0000-0000-0000-0000000000b3'),
   ('${C}','${U.b34}','propietario','00000000-0000-0000-0000-0000000000b4');
`);

async function as(uid, sql, params = []) { return { rows: await sqlComo(E.api, uid, sql, params) }; }
async function expectError(uid, sql, label) {
  try { await as(uid, sql); fail(label + ' (debió fallar)'); } catch (e) { ok(label + ' → ' + e.message); }
}

console.log('\nRecibos');
const r = await as(U.teso, `select generar_recibos('${C}', '2026-10-01') n`);
r.rows[0].n === 8 ? ok('8 recibos emitidos') : fail('recibos: ' + r.rows[0].n);
const b33 = await as(U.b33, `select total_usd from recibos`);
// comunes = 600+250+100+50 = 1000; fondo 10% = 100; B-33 alícuota 14% → 140 + 14 = 154
b33.rows.length === 1 && Number(b33.rows[0].total_usd) === 154 ? ok('B-33 ve solo su recibo: $154,00') : fail('B-33 recibo: ' + JSON.stringify(b33.rows));
await expectError(U.teso, `select generar_recibos('${C}', '2026-10-01')`, 'no se emite dos veces');
await expectError(U.b33, `select generar_recibos('${C}', '2026-11-01')`, 'residente no puede emitir');

console.log('\nPagos');
await as(U.b33, `insert into pagos (condominio_id, unidad_id, fecha_pago, metodo, moneda, monto, referencia, estado)
                 values ('${C}','00000000-0000-0000-0000-0000000000b3','2026-10-27','pago_movil','VES',21550,'00123456','confirmado')`);
const p = await as(U.b33, `select id, estado, monto_usd, tasa_bcv from pagos`);
p.rows[0].estado === 'reportado' && Number(p.rows[0].monto_usd) === 100
  ? ok('pago Bs 21.550 a tasa 215,50 = $100; queda "reportado" aunque intente confirmarlo') : fail(JSON.stringify(p.rows));
await expectError(U.b33, `insert into pagos (condominio_id, unidad_id, fecha_pago, metodo, moneda, monto, referencia)
                 values ('${C}','00000000-0000-0000-0000-0000000000b3','2026-10-27','pago_movil','VES',100,'00123456')`, 'referencia duplicada');
await expectError(U.b33, `insert into pagos (condominio_id, unidad_id, fecha_pago, metodo, moneda, monto)
                 values ('${C}','00000000-0000-0000-0000-0000000000b4','2026-10-27','zelle','USD',50)`, 'no puede reportar por otra unidad');
await expectError(U.b33, `select confirmar_pago('${p.rows[0].id}')`, 'residente no confirma');
const upd = await as(U.b33, `update pagos set estado='confirmado' returning id`);
upd.rows.length === 0 ? ok('UPDATE directo bloqueado por RLS') : fail('update directo pasó');
await as(U.teso, `select confirmar_pago('${p.rows[0].id}')`);
const s = await as(U.b33, `select saldo_usd from estado_cuenta_unidad where unidad_id='00000000-0000-0000-0000-0000000000b3'`);
Number(s.rows[0].saldo_usd) === 54 ? ok('tras confirmar: saldo B-33 = $54,00') : fail('saldo ' + JSON.stringify(s.rows));
const otros = await as(U.b33, `select count(*)::int n from pagos where unidad_id <> '00000000-0000-0000-0000-0000000000b3'`);
otros.rows[0].n === 0 ? ok('B-33 no ve pagos de otros') : fail('fuga de pagos');

console.log('\nPartida especial + votación');
const part = await as(U.pres, `insert into partidas_especiales (condominio_id, titulo, presupuesto_usd, numero_cuotas, primera_cuota, estado)
   values ('${C}','Pintura fachada Bloque B', 3000, 3, '2026-11-01', 'en_votacion') returning id`);
const vot = await as(U.pres, `insert into votaciones (condominio_id, titulo, partida_id, ponderacion, umbral_aprobacion_pct, estado)
   values ('${C}','¿Aprobar pintura?', '${part.rows[0].id}', 'alicuota', 25, 'abierta') returning id`);
const V = vot.rows[0].id;
const ops = await as(U.pres, `insert into votacion_opciones (votacion_id, texto, orden) values
   ('${V}','Aprobar',0),('${V}','Rechazar',1) returning id`);
await as(U.b33, `select emitir_voto('${V}','00000000-0000-0000-0000-0000000000b3','${ops.rows[0].id}')`);
await as(U.b34, `select emitir_voto('${V}','00000000-0000-0000-0000-0000000000b4','${ops.rows[0].id}')`);
await expectError(U.b33, `select emitir_voto('${V}','00000000-0000-0000-0000-0000000000b3','${ops.rows[1].id}')`, 'no vota dos veces');
await expectError(U.b33, `select emitir_voto('${V}','00000000-0000-0000-0000-0000000000a1','${ops.rows[1].id}')`, 'no vota por unidad ajena');
const res = await as(U.b33, `select texto, unidades::int, peso_pct from resultado_votacion('${V}')`);
Number(res.rows[0].peso_pct) === 28 ? ok('resultado visible al residente: Aprobar 28% (14+14)') : fail(JSON.stringify(res.rows));
const vv = await as(U.b33, `select count(*)::int n from votos`);
vv.rows[0].n === 1 ? ok('residente solo ve su propio voto') : fail('fuga de votos ' + vv.rows[0].n);
const cerr = await as(U.pres, `select cerrar_votacion('${V}') aprobada`);
cerr.rows[0].aprobada ? ok('cerrada: aprobada (28% ≥ umbral 25%)') : fail('cerrar');
const nov = await as(U.teso, `select generar_recibos('${C}', '2026-11-01')`);
const c = await as(U.b33, `select concepto, monto_usd from cargos where tipo='extraordinaria'`);
c.rows.length === 1 && Number(c.rows[0].monto_usd) === 140 ? ok('cuota partida B-33 nov: ' + c.rows[0].concepto + ' = $140,00') : fail(JSON.stringify(c.rows));

console.log('\nReportes anónimos');
const rep = await as(U.b33, `select crear_reporte('${C}','ruido','Música muy alta','Todas las noches después de las 11 pm',
   'Bloque B, apto 34', true, 'presidencia', array['${C}/x/1.jpg']) id`);
const vistaPres = await as(U.pres, `select autor_id, anonimo from reportes`);
vistaPres.rows[0].autor_id === null ? ok('Presidencia recibe el reporte sin autor') : fail('autor expuesto');
const aut = await as(U.pres, `select count(*)::int n from reportes_autoria_privada`);
aut.rows[0].n === 0 ? ok('Presidencia no puede leer la autoría privada') : fail('autoría expuesta');
const ver34 = await as(U.b34, `select count(*)::int n from reportes`);
ver34.rows[0].n === 0 ? ok('B-34 (el denunciado) no ve un reporte dirigido solo a Presidencia') : fail('B-34 lo ve');
const mis = await as(U.b33, `select count(*)::int n from mis_reportes()`);
mis.rows[0].n === 1 ? ok('el autor sigue su reporte anónimo con mis_reportes()') : fail('mis_reportes');
for (let i = 0; i < 4; i++) await as(U.b33, `select crear_reporte('${C}','otro','x','y',null,false,'comunidad')`);
await expectError(U.b33, `select crear_reporte('${C}','otro','x','y',null,false,'comunidad')`, 'límite 5 por día');
const pub = await as(U.b34, `select count(*)::int n from reportes`);
pub.rows[0].n === 4 ? ok('reportes "comunidad" visibles a vecinos (4)') : fail('comunidad: ' + pub.rows[0].n);

console.log('\nBitácora');
const bit = await as(U.teso, `select count(*)::int n from bitacora where tabla='pagos'`);
bit.rows[0].n >= 2 ? ok('pagos auditados (' + bit.rows[0].n + ' eventos)') : fail('bitácora');
const bitRes = await as(U.b33, `select count(*)::int n from bitacora`);
bitRes.rows[0].n === 0 ? ok('residente no ve la bitácora') : fail('bitácora visible');

console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo OK');

await E.detener();
assert.equal(fallas, 0);
});
