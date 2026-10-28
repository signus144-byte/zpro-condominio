// Consola master de ZentaPro (CONTRATO_API.md §9) sobre PostgreSQL real.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, PNG, crearPrueba, formulario, type Prueba } from './_api.js';
import { sqlComo } from './_entorno.js';

let P: Prueba;
let dueno: { id: string; acceso: string }, soporte: { id: string; acceso: string }, finanzas: { id: string; acceso: string };
let normal: { id: string; acceso: string };
let nuevoId = '', codigoActivacion = '';

const periodo = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

function unidades(n: number, total = 100) {
  const base = Math.floor((total / n) * 10000) / 10000;
  const us = Array.from({ length: n }, (_, i) => ({
    bloque: i < n / 2 ? 'A' : 'B', numero: String((i % (n / 2)) + 1), tipo: 'apartamento', alicuota: base, propietario: `Propietario ${i + 1}`,
  }));
  us[n - 1].alicuota = Math.round((total - base * (n - 1)) * 10000) / 10000;     // la última cuadra el 100 %
  return us;
}

function altaForm(nombre: string, us: unknown[], conImagenes = true) {
  return formulario({
    nombre, tipo: 'conjunto_residencial', ciudad: 'Maracay', estadoGeo: 'Aragua', direccion: 'Av. Las Delicias',
    telefono: '0243-0000000', correo: 'junta@parque.demo', nombreAsociacion: 'Asociación Civil Parque', rif: 'J-12345678-9',
    colorPrimario: '#225577', planId: 'completo', diasPrueba: '30', unidades: JSON.stringify(us),
  }, conImagenes ? [{ campo: 'logo', nombre: 'logo.png', mime: 'image/png', datos: PNG },
                    { campo: 'fotoEntrada', nombre: 'entrada.png', mime: 'image/png', datos: PNG }] : []);
}

async function equipo(nombre: string, rol: string) {
  const u = await P.registrar(nombre, `${rol}@zentapro.test`);
  await P.base.admin.query(`insert into plataforma_admins (usuario_id, rol) values ($1, $2)`, [u.id, rol]);
  return { id: u.id, acceso: u.acceso };
}

before(async () => {
  P = await crearPrueba();
  dueno = await equipo('Dueño ZentaPro', 'dueno');
  soporte = await equipo('Soporte ZentaPro', 'soporte');
  finanzas = await equipo('Finanzas ZentaPro', 'finanzas');
  normal = await P.miembro('Presidenta Normal', 'presidente');
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

describe('permisos', () => {
  it('un usuario normal (aunque sea presidente de un condominio) recibe 403 en toda la consola', async () => {
    const rutas: [string, string, unknown?][] = [
      ['GET', 'plataforma/planes'], ['GET', 'plataforma/condominios'], ['GET', `plataforma/condominios/${C}`],
      ['POST', 'plataforma/condominios', altaForm('Intruso', unidades(2))],
      ['POST', `plataforma/condominios/${C}/estado`, { estado: 'activo' }], ['POST', `plataforma/condominios/${C}/precio`, { precioEspecialUsd: 1 }],
      ['PATCH', 'plataforma/planes/pequeno', { precioUsdMes: 1 }], ['POST', `plataforma/pagos/${C}/rechazar`, { motivo: 'no llegó' }],
      ['POST', `plataforma/condominios/${C}/codigo-activacion`], ['POST', `plataforma/condominios/${C}/codigos-unidades`],
      ['GET', 'plataforma/facturas'], ['POST', 'plataforma/facturas/emitir', { periodo: periodo() }], ['GET', 'plataforma/pagos?estado=todos'],
      ['POST', `plataforma/pagos/${C}/confirmar`], ['POST', 'plataforma/suspender-morosos', { diasGracia: 10 }],
      ['POST', 'plataforma/tasa-bcv', { usdVes: 300 }], ['GET', 'plataforma/soporte/usuarios?q=mar'], ['GET', 'plataforma/soporte/solicitudes'],
      ['GET', 'plataforma/equipo'], ['POST', 'plataforma/equipo', { correo: 'x@y.com', rol: 'dueno' }],
      ['PATCH', `plataforma/equipo/${normal.id}`, { rol: 'dueno' }],
    ];
    for (const [m, url, cuerpo] of rutas) {
      const r = await P.pedir(m as 'GET', url, normal.acceso, cuerpo);
      assert.equal(r.status, 403, `${m} ${url} → ${r.status} ${r.body}`);
    }
    assert.equal((await P.pedir('GET', 'plataforma/condominios')).status, 401, 'sin sesión: 401');
  });

  it('cada rol solo hace lo suyo', async () => {
    assert.equal((await P.pedir('POST', 'plataforma/condominios', finanzas.acceso, altaForm('Por Finanzas', unidades(2)))).status, 403);
    assert.equal((await P.pedir('POST', 'plataforma/facturas/emitir', soporte.acceso, { periodo: periodo() })).status, 403);
    assert.equal((await P.pedir('POST', 'plataforma/equipo', soporte.acceso, { correo: 'x@y.com', rol: 'soporte' })).status, 403);
    assert.equal((await P.pedir('GET', 'plataforma/soporte/usuarios?q=ma', finanzas.acceso)).status, 403);
    for (const t of [dueno, soporte, finanzas]) assert.equal((await P.pedir('GET', 'plataforma/condominios', t.acceso)).status, 200);
  });
});

describe('alta de condominio', () => {
  it('alta completa con 20 unidades, marca, cuentas y código de activación (una transacción)', async () => {
    const r = await P.pedir('POST', 'plataforma/condominios', soporte.acceso, altaForm('Conjunto Residencial El Parque', unidades(20)));
    assert.equal(r.status, 201, r.body);
    nuevoId = r.json.id; codigoActivacion = r.json.codigoActivacion;
    assert.match(codigoActivacion, /^PARQUE-[A-HJ-NP-Z2-9]{4}$/);
    const c = (await P.pedir('GET', `plataforma/condominios/${nuevoId}`, dueno.acceso)).json;
    assert.equal(c.estado, 'prueba');
    assert.equal(c.planId, 'pequeno', '20 unidades → plan Pequeño (hasta 50)');
    assert.equal(c.mensualidadUsd, 40);
    assert.equal(c.unidades, 20);
    assert.equal(c.nombreAsociacion, 'Asociación Civil Parque');
    assert.equal(c.codigoActivacion, codigoActivacion);
    const img = await P.pedir('GET', c.logoUrl.replace('http://prueba', ''));
    assert.equal(img.status, 200);
    const fila = (await P.base.admin.query(`select retencion_adjuntos_dias, prueba_hasta - current_date as dias,
        (select count(*) from cuentas_financieras where condominio_id = $1) as cuentas from condominios where id = $1`, [nuevoId])).rows[0];
    assert.equal(fila.retencion_adjuntos_dias, 60, 'retención del plan');
    assert.equal(fila.dias, 30);
    assert.equal(Number(fila.cuentas), 4, 'cuentas de pago creadas vacías');
    assert.ok((await P.pedir('GET', 'plataforma/condominios', finanzas.acceso)).json.some((x: { id: string }) => x.id === nuevoId));
  });

  it('el presidente activa con el código y queda como presidente', async () => {
    const pres = await P.registrar('Presidente Parque', 'pres.parque@correo.com');
    const r = await P.pedir('POST', 'auth/activar-condominio', pres.acceso, { codigo: codigoActivacion.toLowerCase() });
    assert.equal(r.status, 200, r.body);
    const c = (await P.pedir('GET', `plataforma/condominios/${nuevoId}`, dueno.acceso)).json;
    assert.equal(c.codigoActivacion, null, 'el código se consume');
    assert.ok(c.activadoEn);
    const nuevo = (await P.pedir('POST', `plataforma/condominios/${nuevoId}/codigo-activacion`, soporte.acceso)).json.codigo;
    assert.match(nuevo, /^PARQUE-/);
  });

  it('rechaza alícuotas que no suman 100 %, unidades repetidas y tipos inválidos sin dejar nada a medias', async () => {
    const antes = Number((await P.base.admin.query(`select count(*) from condominios`)).rows[0].count);
    const mal = unidades(10, 99);
    const r1 = await P.pedir('POST', 'plataforma/condominios', dueno.acceso, altaForm('Mal Sumado', mal));
    assert.equal(r1.status, 400);
    assert.match(r1.json.error, /deben sumar 100/);
    const rep = unidades(4); rep[1].numero = rep[0].numero; rep[1].bloque = rep[0].bloque;
    const r2 = await P.pedir('POST', 'plataforma/condominios', dueno.acceso, altaForm('Repetido', rep));
    assert.equal(r2.status, 400);
    assert.match(r2.json.error, /repetida/);
    const tipo = unidades(2); (tipo[0] as { tipo: string }).tipo = 'castillo';
    assert.equal((await P.pedir('POST', 'plataforma/condominios', dueno.acceso, altaForm('Tipo Malo', tipo))).status, 400);
    assert.equal((await P.pedir('POST', 'plataforma/condominios', dueno.acceso, altaForm('Sin Unidades', []))).status, 400);
    assert.equal(Number((await P.base.admin.query(`select count(*) from condominios`)).rows[0].count), antes);
  });

  it('códigos por unidad para imprimir; un vecino se une con el suyo', async () => {
    const r = await P.pedir('POST', `plataforma/condominios/${nuevoId}/codigos-unidades`, soporte.acceso);
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.length, 20);
    assert.match(r.json[0].codigo, /^A1-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(r.json[0].unidad, 'Apto A-1');
    assert.equal(r.json[0].propietario, 'Propietario 1');
    const otra = await P.pedir('POST', `plataforma/condominios/${nuevoId}/codigos-unidades`, soporte.acceso);
    const vecino = await P.registrar('Vecino Parque', 'vecino.parque@correo.com');
    assert.equal((await P.pedir('POST', 'auth/unirse', vecino.acceso, { codigo: r.json[0].codigo })).status, 400, 'los códigos anteriores dejan de servir');
    const u = await P.pedir('POST', 'auth/unirse', vecino.acceso, { codigo: otra.json[0].codigo });
    assert.equal(u.json.estado, 'pendiente');
    const sol = (await P.pedir('GET', 'plataforma/soporte/solicitudes', soporte.acceso)).json;
    assert.ok(sol.some((s: { usuarioNombre: string; unidad: string }) => s.usuarioNombre === 'Vecino Parque' && s.unidad === 'Apto A-1'));
  });
});

describe('facturación, cobro y suspensión', () => {
  it('solo los activos se facturan; repetir no duplica', async () => {
    assert.equal((await P.pedir('POST', `plataforma/condominios/${nuevoId}/estado`, soporte.acceso, { estado: 'activo' })).status, 204);
    const r = await P.pedir('POST', 'plataforma/facturas/emitir', finanzas.acceso, { periodo: periodo() });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.emitidas, 1);
    assert.ok(r.json.omitidas.some((o: { motivo: string }) => /prueba/.test(o.motivo)), 'el condominio demo está en prueba');
    const r2 = await P.pedir('POST', 'plataforma/facturas/emitir', dueno.acceso, { periodo: periodo() });
    assert.equal(r2.json.emitidas, 0);
    assert.equal(r2.json.yaExistian, 1);
    const fs = (await P.pedir('GET', `plataforma/facturas?periodo=${periodo()}`, finanzas.acceso)).json;
    assert.equal(fs.length, 1);
    assert.equal(fs[0].condominioNombre, 'Conjunto Residencial El Parque');
    assert.equal(fs[0].montoUsd, 40, 'plan Pequeño: $40 al mes');
    assert.equal(fs[0].montoVes, 8620);
  });

  it('vencida + gracia → suspendido; la junta paga, ZentaPro confirma y se reactiva', async () => {
    const f = (await P.pedir('GET', `plataforma/facturas?periodo=${periodo()}`, finanzas.acceso)).json[0];
    await P.base.admin.query(`update facturas_plataforma set vence = current_date - 15 where id = $1`, [f.id]);
    const s = await P.pedir('POST', 'plataforma/suspender-morosos', finanzas.acceso, { diasGracia: 10 });
    assert.equal(s.json.suspendidos, 1);
    assert.equal((await P.pedir('GET', `plataforma/condominios/${nuevoId}`, dueno.acceso)).json.estado, 'suspendido');
    // La presidenta del condominio reporta el pago (desde la app; aquí directo en la BD con su identidad).
    const pres = (await P.base.admin.query(`select usuario_id from membresias where condominio_id = $1 and rol = 'presidente'`, [nuevoId])).rows[0].usuario_id;
    await sqlComo(P.base.api, pres, `insert into pagos_plataforma (factura_id, condominio_id, metodo, moneda, monto, referencia, reportado_por)
                                     values ($1, $2, 'pago_movil', 'VES', 8620, '778899', auth.uid())`, [f.id, nuevoId]);
    const pagos = (await P.pedir('GET', 'plataforma/pagos', finanzas.acceso)).json;
    assert.equal(pagos.length, 1);
    assert.equal(pagos[0].reportadoPor, 'Presidente Parque');
    assert.equal(pagos[0].condominioNombre, 'Conjunto Residencial El Parque');
    assert.equal((await P.pedir('POST', `plataforma/pagos/${pagos[0].id}/confirmar`, soporte.acceso)).status, 403, 'soporte no confirma pagos');
    assert.equal((await P.pedir('POST', `plataforma/pagos/${pagos[0].id}/confirmar`, finanzas.acceso)).status, 204);
    assert.equal((await P.pedir('GET', `plataforma/condominios/${nuevoId}`, dueno.acceso)).json.estado, 'activo');
    assert.equal((await P.pedir('GET', 'plataforma/pagos', finanzas.acceso)).json.length, 0);
    assert.equal((await P.pedir('GET', 'plataforma/pagos?estado=todos', finanzas.acceso)).json[0].estado, 'confirmado');
  });

  it('cobro solo en bolívares a la tasa del día del pago: abonos parciales y rechazo con motivo', async () => {
    const pres = (await P.base.admin.query(`select usuario_id from membresias where condominio_id = $1 and rol = 'presidente'`, [nuevoId])).rows[0].usuario_id;
    const f = (await P.base.admin.query(`insert into facturas_plataforma (condominio_id, periodo, plan_id, unidades_facturadas, monto_usd, tasa_bcv, monto_ves, vence)
        values ($1, '2026-01-01', 'pequeno', 20, 40, 200, 8000, current_date + 5) returning id`, [nuevoId])).rows[0].id;
    // Pagar en dólares está prohibido por la propia base de datos.
    await assert.rejects(sqlComo(P.base.api, pres, `insert into pagos_plataforma (factura_id, condominio_id, metodo, moneda, monto, referencia, reportado_por)
        values ($1, $2, 'zelle', 'USD', 40, 'ZL', auth.uid())`, [f, nuevoId]), /solo_bs/);
    const tasa = Number((await P.base.admin.query(`select usd_ves from tasas_bcv where fecha <= current_date order by fecha desc limit 1`)).rows[0].usd_ves);
    // Primer abono: 20 $ a la tasa de hoy. La factura sigue abierta.
    await sqlComo(P.base.api, pres, `insert into pagos_plataforma (factura_id, condominio_id, metodo, moneda, monto, referencia, reportado_por)
        values ($1, $2, 'pago_movil', 'VES', $3, 'AB1', auth.uid())`, [f, nuevoId, Math.round(20 * tasa * 100) / 100]);
    // Un reporte falso: ZentaPro lo rechaza con motivo.
    await sqlComo(P.base.api, pres, `insert into pagos_plataforma (factura_id, condominio_id, metodo, moneda, monto, referencia, reportado_por)
        values ($1, $2, 'pago_movil', 'VES', 999999, 'FALSO', auth.uid())`, [f, nuevoId]);
    const pend = (await P.pedir('GET', 'plataforma/pagos', finanzas.acceso)).json as { id: string; referencia: string; montoUsd: number; tasaBcv: number }[];
    const ab1 = pend.find((p) => p.referencia === 'AB1')!, falso = pend.find((p) => p.referencia === 'FALSO')!;
    assert.equal(ab1.montoUsd, 20);
    assert.equal(ab1.tasaBcv, tasa);
    assert.equal((await P.pedir('POST', `plataforma/pagos/${falso.id}/rechazar`, finanzas.acceso, {})).status, 400, 'motivo obligatorio');
    assert.equal((await P.pedir('POST', `plataforma/pagos/${falso.id}/rechazar`, finanzas.acceso, { motivo: 'No aparece en el banco' })).status, 204);
    assert.equal((await P.pedir('POST', `plataforma/pagos/${ab1.id}/confirmar`, finanzas.acceso)).status, 204);
    let fac = (await P.pedir('GET', 'plataforma/facturas?periodo=2026-01-01', finanzas.acceso)).json[0];
    assert.equal(fac.estado, 'emitida');
    assert.equal(fac.abonadoUsd, 20);
    // Segundo abono otro día con otra tasa: lo que cuenta es el equivalente en dólares.
    await P.base.admin.query(`insert into tasas_bcv (fecha, usd_ves, fuente) values (current_date - 1, $1, 'manual') on conflict (fecha) do nothing`, [tasa - 10]);
    const ayer = Number((await P.base.admin.query(`select usd_ves from tasas_bcv where fecha <= current_date - 1 order by fecha desc limit 1`)).rows[0].usd_ves);
    await sqlComo(P.base.api, pres, `insert into pagos_plataforma (factura_id, condominio_id, metodo, moneda, monto, referencia, reportado_por, fecha_pago)
        values ($1, $2, 'transferencia', 'VES', $3, 'AB2', auth.uid(), current_date - 1)`, [f, nuevoId, Math.round(20 * ayer * 100) / 100]);
    const ab2 = (await P.pedir('GET', 'plataforma/pagos', finanzas.acceso)).json.find((p: { referencia: string }) => p.referencia === 'AB2');
    assert.equal(ab2.tasaBcv, ayer, 'tasa del día del pago, no la de hoy');
    assert.equal((await P.pedir('POST', `plataforma/pagos/${ab2.id}/confirmar`, finanzas.acceso)).status, 204);
    fac = (await P.pedir('GET', 'plataforma/facturas?periodo=2026-01-01', finanzas.acceso)).json[0];
    assert.equal(fac.estado, 'pagada');
    assert.equal((await P.pedir('GET', 'plataforma/pagos?estado=todos', finanzas.acceso)).json
      .find((p: { referencia: string }) => p.referencia === 'FALSO').motivoRechazo, 'No aparece en el banco');
  });

  it('planes por tamaño: precio especial, cambio de topes y reubicación automática', async () => {
    const planes = (await P.pedir('GET', 'plataforma/planes', soporte.acceso)).json as { id: string; hastaUnidades: number | null; precioUsdMes: number }[];
    assert.deepEqual(planes.map((p) => [p.id, p.hastaUnidades, p.precioUsdMes]),
      [['pequeno', 50, 40], ['mediano', 150, 70], ['grande', 300, 110], ['extra', null, 150]]);
    // Precio especial negociado: solo dueño o finanzas.
    assert.equal((await P.pedir('POST', `plataforma/condominios/${nuevoId}/precio`, soporte.acceso, { precioEspecialUsd: 30 })).status, 403);
    assert.equal((await P.pedir('POST', `plataforma/condominios/${nuevoId}/precio`, finanzas.acceso, { precioEspecialUsd: 30, nota: 'Piloto' })).status, 204);
    let c = (await P.pedir('GET', `plataforma/condominios/${nuevoId}`, dueno.acceso)).json;
    assert.equal(c.mensualidadUsd, 30);
    assert.equal(c.notaPrecio, 'Piloto');
    // La junta NO puede cambiarse el precio (campo comercial protegido en la BD).
    const pres = (await P.base.admin.query(`select usuario_id from membresias where condominio_id = $1 and rol = 'presidente'`, [nuevoId])).rows[0].usuario_id;
    await assert.rejects(sqlComo(P.base.api, pres, `update condominios set precio_especial_usd = 1 where id = $1`, [nuevoId]), /Solo ZentaPro/);
    assert.equal((await P.pedir('POST', `plataforma/condominios/${nuevoId}/precio`, dueno.acceso, { precioEspecialUsd: null })).status, 204);
    assert.equal((await P.pedir('GET', `plataforma/condominios/${nuevoId}`, dueno.acceso)).json.mensualidadUsd, 40);
    // Bajar el tope del plan Pequeño a 10: el condominio de 20 unidades pasa solo a Mediano.
    assert.equal((await P.pedir('PATCH', 'plataforma/planes/pequeno', soporte.acceso, { hastaUnidades: 10 })).status, 403);
    const r = await P.pedir('PATCH', 'plataforma/planes/pequeno', dueno.acceso, { hastaUnidades: 10, precioUsdMes: 35 });
    assert.equal(r.status, 200, r.body);
    c = (await P.pedir('GET', `plataforma/condominios/${nuevoId}`, dueno.acceso)).json;
    assert.equal(c.planId, 'mediano');
    assert.equal(c.mensualidadUsd, 70);
    // Debe quedar un plan sin límite.
    assert.equal((await P.pedir('PATCH', 'plataforma/planes/extra', dueno.acceso, { hastaUnidades: 1000 })).status, 400);
    assert.equal((await P.pedir('PATCH', 'plataforma/planes/pequeno', dueno.acceso, { hastaUnidades: 50, precioUsdMes: 40 })).status, 200);
    assert.equal((await P.pedir('GET', `plataforma/condominios/${nuevoId}`, dueno.acceso)).json.planId, 'pequeno');
  });

  it('estado; tasa BCV desde la consola', async () => {
    assert.equal((await P.pedir('POST', `plataforma/condominios/${nuevoId}/estado`, dueno.acceso, { estado: 'feliz' })).status, 400);
    assert.equal((await P.pedir('POST', 'plataforma/tasa-bcv', finanzas.acceso, { usdVes: 230.75 })).status, 204);
    assert.equal((await P.pedir('GET', 'tasa-bcv', finanzas.acceso)).json.usdVes, 230.75);
    assert.equal((await P.pedir('GET', 'plataforma/planes', soporte.acceso)).json.length, 4);
  });
});

describe('soporte y equipo', () => {
  it('soporte busca usuarios por nombre o correo y ve condominio y rol', async () => {
    const r = (await P.pedir('GET', 'plataforma/soporte/usuarios?q=pres.parque', soporte.acceso)).json;
    assert.equal(r.length, 1);
    assert.equal(r[0].condominios[0].rol, 'presidente');
    assert.equal(r[0].condominios[0].nombre, 'Conjunto Residencial El Parque');
  });

  it('el dueño agrega y cambia gente del equipo; no puede quitarse a sí mismo', async () => {
    await P.registrar('Nueva Persona', 'nueva@zentapro.test');
    assert.equal((await P.pedir('POST', 'plataforma/equipo', dueno.acceso, { correo: 'nueva@zentapro.test', rol: 'soporte' })).status, 204);
    assert.equal((await P.pedir('POST', 'plataforma/equipo', dueno.acceso, { correo: 'noexiste@zentapro.test', rol: 'soporte' })).status, 400);
    const eq = (await P.pedir('GET', 'plataforma/equipo', finanzas.acceso)).json;
    const nueva = eq.find((a: { correo: string }) => a.correo === 'nueva@zentapro.test');
    assert.equal(nueva.rol, 'soporte');
    assert.equal((await P.pedir('PATCH', `plataforma/equipo/${nueva.usuarioId}`, dueno.acceso, { activo: false })).status, 204);
    assert.equal((await P.pedir('PATCH', `plataforma/equipo/${dueno.id}`, dueno.acceso, { activo: false })).status, 400);
  });
});

describe('privacidad', () => {
  it('el personal de ZentaPro no lee mensajes, pagos de residentes, saldos ni autoría de reportes', async () => {
    const res = await P.miembro('Residente Privado', 'propietario', 'b2');
    await sqlComo(P.base.api, res.id, `insert into pagos (condominio_id, unidad_id, fecha_pago, metodo, moneda, monto, referencia)
                                       values ($1, '00000000-0000-0000-0000-0000000000b2', current_date, 'zelle', 'USD', 50, 'ZL-PRIV')`, [C]);
    await sqlComo(P.base.api, res.id, `select crear_reporte($1, 'ruido', 'Ruido', 'Música', 'B-34', true, 'presidencia')`, [C]);
    const conv = (await sqlComo(P.base.api, res.id, `select abrir_con_junta('00000000-0000-0000-0000-0000000000b2') as id`))[0].id;
    await sqlComo(P.base.api, res.id, `insert into mensajes (conversacion_id, autor_unidad_id, texto) values ($1, '00000000-0000-0000-0000-0000000000b2', 'privado')`, [conv]);
    for (const t of [dueno, soporte, finanzas]) {
      for (const tabla of ['mensajes', 'pagos', 'reportes', 'reportes_autoria_privada', 'cargos', 'recibos', 'conversaciones']) {
        const n = (await sqlComo(P.base.api, t.id, `select count(*)::int as n from ${tabla}`).catch(() => [{ n: 0 }]))[0].n;
        assert.equal(n, 0, `${tabla} visible para el equipo`);
      }
    }
    // La única vista de morosidad que tiene la consola es el porcentaje agregado.
    const c = (await P.pedir('GET', `plataforma/condominios/${C}`, dueno.acceso)).json;
    assert.equal(typeof c.morosidadPct, 'number');
    assert.equal(JSON.stringify(c).includes('ZL-PRIV'), false);
  });
});
