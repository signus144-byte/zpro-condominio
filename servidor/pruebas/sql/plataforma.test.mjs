// Pruebas v0.2 sobre PostgreSQL 18 real: plataforma multi-condominio, chat, documentos, conciliación y cobro de ZentaPro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBase, sqlComo, crearUsuario } from '../_entorno.ts';

test('plataforma, chat, documentos, conciliación y cobro', { timeout: 180_000 }, async () => {
const E = await iniciarBase({ demo: true });
let fallas = 0;
const ok = (m) => console.log('  ✔', m);
const fail = (m) => { console.log('  ✘', m); fallas++; };
const igual = (a, b, m) => (a === b ? ok(m) : fail(`${m} (esperado ${b}, obtenido ${a})`));

const C = '00000000-0000-0000-0000-0000000000c1';
const U = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const P = {
  zp: '20000000-0000-0000-0000-000000000001',   // ZentaPro (dueño)
  pres: '20000000-0000-0000-0000-000000000002',
  b33: '20000000-0000-0000-0000-000000000033', b34: '20000000-0000-0000-0000-000000000034',
  a11: '20000000-0000-0000-0000-000000000011', nuevo: '20000000-0000-0000-0000-000000000099',
};
const nombres = { zp: 'Soporte ZentaPro', pres: 'María Fernández', b33: 'Elena Castro', b34: 'Pedro Salas', a11: 'Luis Pérez', nuevo: 'Nuevo Vecino' };
for (const [k, id] of Object.entries(P)) await crearUsuario(E.admin, id, nombres[k]);
await E.admin.query(`insert into plataforma_admins values ('${P.zp}','dueno',true)`);
await E.admin.query(`update condominios set codigo_activacion = 'SAMANES-2026', plan_id = 'completo' where id = '${C}'`);

const como = (uid, sql, params = []) => sqlComo(E.api, uid, sql, params);
const admin = async (sql) => (await E.admin.query(sql)).rows;
async function debeFallar(uid, sql, m) {
  try { await como(uid, sql); fail(m + ' (debió fallar)'); } catch (e) { ok(`${m} → ${e.message}`); }
}

console.log('\nActivación y alta de residentes');
const act = await como(P.pres, `select activar_condominio('samanes-2026') id`);
igual(act[0].id, C, 'el presidente activa el condominio con el código de ZentaPro');
await debeFallar(P.b34, `select activar_condominio('SAMANES-2026')`, 'el código no se puede reutilizar');
await debeFallar(P.pres, `update condominios set estado = 'activo' where id = '${C}'`, 'la junta no cambia su estado comercial');
await como(P.pres, `insert into codigos_acceso (codigo, condominio_id, unidad_id) values
   ('B33-XK7P','${C}','${U('b3')}'),('B34-QW2M','${C}','${U('b4')}'),('A11-RT5N','${C}','${U('a1')}')`);
igual((await como(P.b33, `select unirse_con_codigo('b33-xk7p') r`))[0].r, 'pendiente', 'Elena usa el código de B-33: queda pendiente');
const sol = await como(P.pres, `select id from solicitudes_ingreso where estado = 'pendiente'`);
await como(P.pres, `select resolver_solicitud('${sol[0].id}', true)`);
await admin(`update codigos_acceso set requiere_aprobacion = false`);
await como(P.b34, `select unirse_con_codigo('B34-QW2M')`);
await como(P.a11, `select unirse_con_codigo('A11-RT5N')`);
igual((await como(P.b33, `select count(*)::int n from membresias where usuario_id = auth.uid()`))[0].n, 1, 'aprobada por la presidenta, Elena ya es miembro');
await como(P.b34, `select mostrar_en_directorio('${C}', false)`);

const dirVecino = await como(P.b33, `select etiqueta, nombres from directorio('${C}') where numero = '34'`);
igual(dirVecino[0].nombres.length, 0, 'directorio: Pedro (B-34) eligió ocultar su nombre a los vecinos');
const dirJunta = await como(P.pres, `select etiqueta, nombres from directorio('${C}') where numero = '34'`);
igual(dirJunta[0].nombres[0], 'Pedro Salas', `la junta sí ve a nombre de quién está ${dirJunta[0].etiqueta}`);
await admin(`update unidades set tipo = 'casa', bloque = null where numero = '11'`);
igual((await como(P.pres, `select etiqueta from directorio('${C}') where numero = '11'`))[0].etiqueta, 'Casa 11', 'seudónimo para urbanizaciones: "Casa 11"');

console.log('\nChat');
const dir = (await como(P.b33, `select abrir_directa('${U('b3')}','${U('a1')}') id`))[0].id;
igual((await como(P.a11, `select abrir_directa('${U('a1')}','${U('b3')}') id`))[0].id, dir, 'casa ↔ casa: no se duplica la conversación');
await como(P.b33, `insert into mensajes (conversacion_id, autor_unidad_id, texto) values ('${dir}','${U('b3')}','Hola vecino, ¿su carro es el gris?')`);
igual((await como(P.a11, `select texto from mensajes where conversacion_id = '${dir}'`)).length, 1, 'Casa 11 recibe el mensaje de B-33');
igual((await como(P.b34, `select count(*)::int n from mensajes where conversacion_id = '${dir}'`))[0].n, 0, 'B-34 no puede leer una conversación ajena');
igual((await como(P.pres, `select count(*)::int n from mensajes where conversacion_id = '${dir}'`))[0].n, 0, 'la junta tampoco lee chats privados entre vecinos');
await debeFallar(P.b34, `insert into mensajes (conversacion_id, autor_unidad_id, texto) values ('${dir}','${U('b4')}','me meto')`, 'no puede escribir en una conversación ajena');
await debeFallar(P.b33, `insert into mensajes (conversacion_id, autor_unidad_id, texto) values ('${dir}','${U('a1')}','suplanto')`, 'no puede escribir como otra casa');

const jun = (await como(P.pres, `select abrir_con_junta('${U('b4')}') id`))[0].id;
await como(P.pres, `insert into mensajes (conversacion_id, como_junta, texto) values ('${jun}', true, 'Sr. Salas, le recordamos el saldo pendiente.')`);
igual((await como(P.b34, `select texto from mensajes where conversacion_id = '${jun}'`)).length, 1, 'la junta escribe directo a B-34 y él lo recibe');
await como(P.b34, `insert into mensajes (conversacion_id, autor_unidad_id, texto) values ('${jun}','${U('b4')}','Pago el viernes, gracias.')`);
igual((await como(P.b34, `select autor_id from mensajes where conversacion_id = '${jun}' and autor_unidad_id is not null`))[0].autor_id, P.b34, 'el chat no es anónimo: queda el autor');

const canal = (await como(P.pres, `select crear_sala('${C}','canal','Avisos oficiales', null) id`))[0].id;
await como(P.pres, `insert into mensajes (conversacion_id, como_junta, texto) values ('${canal}', true, 'Corte de agua el sábado')`);
igual((await como(P.a11, `select count(*)::int n from mensajes where conversacion_id = '${canal}'`))[0].n, 1, 'canal de avisos: lo ven todas las casas');
await debeFallar(P.a11, `insert into mensajes (conversacion_id, autor_unidad_id, texto) values ('${canal}','${U('a1')}','respondo')`, 'en el canal solo escribe la junta');

await como(P.a11, `insert into bloqueos_chat values ('${U('a1')}','${U('b3')}')`);
await debeFallar(P.b33, `insert into mensajes (conversacion_id, autor_unidad_id, texto) values ('${dir}','${U('b3')}','¿hola?')`, 'Casa 11 bloqueó a B-33: no le puede escribir');

const m1 = (await como(P.pres, `select id from mensajes where conversacion_id = '${jun}' and como_junta`))[0].id;
igual((await como(P.pres, `select estado_mensaje('${m1}') e`))[0].e, 1, 'mensaje de la junta: ✓ enviado');
await como(P.b34, `select marcar_leido('${jun}')`);
igual((await como(P.pres, `select estado_mensaje('${m1}') e`))[0].e, 3, 'B-34 lo abrió: ✓✓ leído (constancia de lectura)');

await como(P.b33, `select registrar_adjunto('${jun}', '${C}/${jun}/x.jpg', 'foto.jpg', 'image/jpeg', 1000, null)`)
  .then(() => fail('B-33 no debió adjuntar en conversación ajena')).catch(() => ok('no se adjuntan archivos en conversaciones ajenas'));
const adj = (await como(P.b34, `select registrar_adjunto('${jun}', '${C}/${jun}/comp.jpg', 'comprobante.jpg', 'image/jpeg', 250000, 'abc') id`))[0].id;
const dias = (await admin(`select round(extract(epoch from expira_en - creado_en) / 86400) d from adjuntos where id = '${adj}'`))[0].d;
igual(Number(dias), 60, 'adjunto vence a los 60 días (retención del plan Completo)');
await admin(`update adjuntos set expira_en = now() - interval '1 minute' where id = '${adj}'`);
const purg = await admin(`select * from purgar_adjuntos_vencidos()`);
igual(purg[0]?.path, `${C}/${jun}/comp.jpg`, 'la purga nocturna devuelve el archivo vencido para borrarlo del servidor');
await debeFallar(P.pres, `select * from purgar_adjuntos_vencidos()`, 'la purga no se puede llamar desde la app');

const msgDen = (await como(P.a11, `select id from mensajes where conversacion_id = '${dir}' limit 1`))[0].id;
await como(P.a11, `insert into denuncias_mensaje (mensaje_id, condominio_id, denunciado_por, motivo) values ('${msgDen}','${C}','${P.a11}','Acoso')`);
const den = (await como(P.pres, `select id from denuncias_mensaje`))[0].id;
igual((await como(P.pres, `select casa from mensaje_denunciado('${den}')`))[0].casa, 'Apto B-33', 'al denunciarlo, la junta ve ese mensaje (y solo ese)');

await admin(`insert into dispositivos values ('tok-b34','${P.b34}','android', now()), ('tok-pres','${P.pres}','android', now())`);
const push = (await admin(`select token from destinatarios_push('${m1}')`)).map((r) => r.token);
igual(push.join(','), 'tok-b34', 'push del mensaje de la junta: solo al teléfono de B-34 (no a quien lo escribió)');
await como(P.b34, `update conversacion_lecturas set silenciada = true where conversacion_id = '${jun}'`);
igual((await admin(`select count(*)::int n from destinatarios_push('${m1}')`))[0].n, 0, 'si B-34 silencia la conversación, no recibe push');

const bjB33 = await como(P.b33, `select titulo, no_leidos from bandeja('${C}') order by titulo`);
igual(bjB33.map((b) => b.titulo).join(' | '), 'Avisos oficiales | Casa 11', 'bandeja de B-33 en una consulta: su chat con Casa 11 y el canal');
const bjJunta = await como(P.pres, `select titulo from bandeja('${C}') where tipo = 'junta'`);
igual(bjJunta[0]?.titulo, 'Apto B-34', 'la junta ve el chat titulado con la casa ("Apto B-34")');
const bjB34 = await como(P.b34, `select titulo, no_leidos from bandeja('${C}') where tipo = 'junta'`);
igual(bjB34[0]?.titulo, 'Junta de condominio', 'B-34 lo ve como "Junta de condominio"');
await como(P.b33, `select silenciar_conversacion('${canal}', true)`);
igual((await como(P.b33, `select array_length(silenciadas, 1) n, array_length(bloqueadas, 1) b from mi_estado_chat('${C}')`))[0].n, 1, 'silenciar se guarda en el servidor (mi_estado_chat)');

console.log('\nConsola master');
igual((await como(P.pres, `select count(*)::int n from soporte_solicitudes_pendientes()`))[0].n, 0, 'la junta no ve las solicitudes de soporte de ZentaPro');
await debeFallar(P.pres, `select * from soporte_buscar_usuarios('maria')`, 'la junta no usa la búsqueda de soporte');
await admin(`update auth.users set email = 'maria@correo.com' where id = '${P.pres}'`);
const busq = await como(P.zp, `select nombre, condominios from soporte_buscar_usuarios('maria')`);
igual(busq[0]?.nombre, 'María Fernández', 'soporte encuentra a la presidenta por correo y ve su condominio y rol');

console.log('\nDocumentos y solvencia');
await como(P.pres, `select generar_recibos('${C}', '2026-10-01')`);
await debeFallar(P.b33, `select emitir_solvencia('${U('b3')}')`, 'B-33 debe dinero: no hay solvencia');
const codEC = (await como(P.b33, `select registrar_documento('${C}','estado_cuenta','pdf','${U('b3')}') c`))[0].c;
igual(codEC.length, 10, `estado de cuenta registrado con código ${codEC}`);
await debeFallar(P.b33, `select registrar_documento('${C}','acta_votacion','pdf')`, 'un residente no emite actas');
const pid = (await como(P.b33, `insert into pagos (condominio_id, unidad_id, fecha_pago, metodo, moneda, monto, referencia) values ('${C}','${U('b3')}','2026-10-27','zelle','USD',154,'ZL998877') returning id`))[0].id;
await como(P.pres, `select confirmar_pago('${pid}')`);
const codSol = (await como(P.b33, `select emitir_solvencia('${U('b3')}') c`))[0].c;
const ver = await como(null, `select * from verificar_documento('${codSol.toLowerCase()}')`);
igual(ver[0]?.vigente, true, `cualquiera (sin cuenta) verifica la solvencia escaneando el QR: ${ver[0]?.unidad}`);
igual((await como(null, `select * from verificar_documento('NOEXISTE00')`)).length, 0, 'un código falso no verifica');

console.log('\nConciliación bancaria');
const cuentaBs = (await admin(`select id from cuentas_financieras where tipo = 'banco_bs'`))[0].id;
await como(P.b34, `insert into pagos (condominio_id, unidad_id, fecha_pago, metodo, moneda, monto, referencia, cuenta_destino_id) values
  ('${C}','${U('b4')}','2026-10-26','pago_movil','VES',33187,'000123456789','${cuentaBs}')`);
const extracto = JSON.stringify([
  { fecha: '2026-10-27', referencia: '123456789', descripcion: 'PAGO MOVIL RECIBIDO 0414', monto: 33187.0 },
  { fecha: '2026-10-27', referencia: '55550000', descripcion: 'PAGO MOVIL RECIBIDO 0412', monto: 10000.0 },
  { fecha: '2026-10-27', referencia: '', descripcion: 'COMISION', monto: -14.0 },
]);
const r1 = (await como(P.pres, `select * from cargar_extracto('${cuentaBs}', 'banesco_oct.xlsx', '${extracto}'::jsonb)`))[0];
igual(r1.conciliados, 1, 'extracto: el Pago Móvil de B-34 se confirma solo (referencia + monto + fecha)');
const via = (await admin(`select estado, confirmado_por_via from pagos where referencia = '000123456789'`))[0];
igual(`${via.estado}/${via.confirmado_por_via}`, 'confirmado/extracto', 'queda constancia de que lo confirmó el extracto');
igual((await como(P.pres, `select * from cargar_extracto('${cuentaBs}', 'banesco_oct.xlsx', '${extracto}'::jsonb)`))[0].duplicados, 3, 'subir el mismo extracto dos veces no duplica');
const sinAviso = (await como(P.pres, `select id from movimientos_bancarios where pago_id is null and monto > 0`))[0].id;
await como(P.pres, `select asignar_movimiento('${sinAviso}', '${U('a1')}')`);
igual((await admin(`select count(*)::int n from pagos where unidad_id = '${U('a1')}' and estado = 'confirmado'`))[0].n, 1, 'dinero que entró sin aviso: la junta lo asigna a Casa 11');
await debeFallar(P.b33, `select * from cargar_extracto('${cuentaBs}', 'x', '[]'::jsonb)`, 'un residente no carga extractos');

console.log('\nCobro de ZentaPro y suspensión');
await debeFallar(P.pres, `select facturar_condominio('${C}', '2026-11-01')`, 'la junta no se factura a sí misma');
const fac = (await como(P.zp, `select facturar_condominio('${C}', '2026-11-01') id`))[0].id;
const f = (await como(P.pres, `select monto_usd, monto_ves from facturas_plataforma where id = '${fac}'`))[0];
igual(Number(f.monto_usd), 40, 'factura: 8 unidades × $0,45 = $3,60 → se aplica el mínimo del plan ($40)');
igual(Number(f.monto_ves), 8620, '…y se cobra en bolívares a tasa BCV ($40 × 215,50 = Bs 8.620)');
await admin(`update facturas_plataforma set vence = current_date - 15 where id = '${fac}'`);
await admin(`update condominios set estado = 'activo' where id = '${C}'`);
igual((await admin(`select suspender_morosos_plataforma(10) n`))[0].n, 1, 'factura vencida + 10 días de gracia → condominio suspendido');
await debeFallar(P.pres, `insert into gastos (condominio_id, periodo, categoria, descripcion, moneda, monto) values ('${C}','2026-11-01','x','x','USD',1)`, 'suspendido: la junta no registra gastos (solo lectura)');
await como(P.b33, `insert into pagos (condominio_id, unidad_id, fecha_pago, metodo, moneda, monto, referencia) values ('${C}','${U('b3')}','2026-10-27','zelle','USD',10,'ZL111')`)
  .then(() => ok('suspendido: los residentes siguen pudiendo reportar sus pagos')).catch((e) => fail('residente bloqueado: ' + e.message));
await como(P.pres, `insert into pagos_plataforma (factura_id, condominio_id, metodo, moneda, monto, referencia, reportado_por) values
  ('${fac}','${C}','pago_movil','VES',8620,'778899','${P.pres}')`);
const pp = (await como(P.zp, `select id from pagos_plataforma`))[0].id;
await como(P.zp, `select confirmar_pago_plataforma('${pp}')`);
igual((await admin(`select estado from condominios where id = '${C}'`))[0].estado, 'activo', 'ZentaPro confirma el pago → se reactiva solo');

console.log('\nPrivacidad frente a ZentaPro');
igual((await como(P.zp, `select count(*)::int n from mensajes`))[0].n, 0, 'el personal de ZentaPro NO lee chats');
igual((await como(P.zp, `select count(*)::int n from pagos`))[0].n, 0, 'ni los pagos de los residentes');
const met = await como(P.zp, `select * from metricas_plataforma()`);
igual(Number(met[0].unidades), 8, `pero sí ve métricas agregadas (${met[0].unidades} unidades, ${met[0].unidades_con_app} con app, morosidad ${met[0].morosidad_pct} %)`);
await debeFallar(P.pres, `select * from metricas_plataforma()`, 'la junta no ve métricas de otros condominios');

console.log('\nTasa BCV desde la consola');
await como(P.zp, `select plataforma_fijar_tasa_bcv(220.10)`);
igual(Number((await admin(`select usd_ves from tasas_bcv where fecha = current_date`))[0].usd_ves), 220.1, 'ZentaPro carga la tasa BCV del día desde la consola');

console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo OK');

await E.detener();
assert.equal(fallas, 0);
});
