// v0.7: el vecino elige qué paga; al aprobar se descuenta de esa deuda; avance de cuotas especiales;
// reporte y cierre del mes; un pago en Bs solo con tasa BCV verificada.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C, UNI, crearPrueba, formulario, type Prueba } from './_api.js';
import { sqlComo } from './_entorno.js';

let P: Prueba;
let teso: { id: string; acceso: string }, pres: { id: string; acceso: string };
let b33: { id: string; acceso: string }, b34: { id: string; acceso: string }, b31: { id: string; acceso: string };
let partida = '';
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
const ESTE_MES = hoy().slice(0, 8) + '01';

type CargoJ = { id: string; tipo: string; periodo: string; concepto: string; montoUsd: number; pagadoUsd: number; pendienteUsd: number; estado: string; partidaId: string | null };
const cuenta = async (u: string, quien: { acceso: string }) =>
  (await P.pedir('GET', `c/${C}/unidades/${UNI(u)}/estado-cuenta`, quien.acceso)).json as { saldoUsd: number; cargos: CargoJ[]; pagos: any[] };
async function pagar(quien: { acceso: string }, u: string, campos: Record<string, string>) {
  const r = await P.pedir('POST', `c/${C}/pagos`, quien.acceso,
    formulario({ unidadId: UNI(u), fechaPago: hoy(), metodo: 'zelle', moneda: 'USD', referencia: `Z${Math.random().toString().slice(2, 10)}`, ...campos }));
  return r;
}

before(async () => {
  P = await crearPrueba();
  pres = await P.miembro('Maria Presidenta', 'presidente');
  teso = await P.miembro('Jorge Tesorero', 'tesorero');
  b33 = await P.miembro('Elena Castro', 'propietario', 'b3');
  b34 = await P.miembro('Pedro Salas', 'propietario', 'b4');
  b31 = await P.miembro('Rosa Herrera', 'propietario', 'b1');
  // Octubre: gastos de la semilla ($1.000). Este mes: $200 de gastos y una cuota especial de $500 en 2 cuotas.
  assert.equal((await P.pedir('POST', `c/${C}/recibos`, teso.acceso, { periodo: '2026-10-01' })).status, 200);
  await P.base.admin.query(`insert into gastos (condominio_id, periodo, tipo, categoria, descripcion, moneda, monto, monto_usd)
                            values ($1, $2, 'comun', 'Vigilancia', 'Vigilancia del mes', 'USD', 200, 200)`, [C, ESTE_MES]);
  partida = (await P.base.admin.query(`insert into partidas_especiales (condominio_id, titulo, presupuesto_usd, numero_cuotas, primera_cuota, estado)
                            values ($1, 'Bomba de agua', 500, 2, $2, 'aprobada') returning id`, [C, ESTE_MES])).rows[0].id;
  assert.equal((await P.pedir('POST', `c/${C}/recibos`, teso.acceso, { periodo: ESTE_MES })).status, 200);
}, { timeout: 120_000 });
after(async () => { await P?.cerrar(); });

describe('el vecino elige qué paga', () => {
  it('ve cada deuda con lo que falta: octubre $154 y este mes ordinaria $28 + fondo $2,80 + cuota especial $35', async () => {
    const e = await cuenta('b3', b33);
    assert.equal(e.saldoUsd, 219.8);
    const pend = e.cargos.filter((c) => c.estado === 'pendiente').map((c) => [c.tipo, c.pendienteUsd]);
    assert.deepEqual(pend.sort(), [['extraordinaria', 35], ['fondo_reserva', 14], ['fondo_reserva', 2.8], ['ordinaria', 140], ['ordinaria', 28]].sort());
    assert.equal(e.cargos.find((c) => c.tipo === 'extraordinaria')!.partidaId, partida);
  });

  it('paga solo la cuota especial urgente: al aprobar se descuenta de ESA cuota, aunque haya deuda más vieja', async () => {
    const e = await cuenta('b3', b33);
    const especial = e.cargos.find((c) => c.tipo === 'extraordinaria')!;
    const r = await pagar(b33, 'b3', { monto: '35', cargoIds: JSON.stringify([especial.id]) });
    assert.equal(r.status, 201, r.body);
    // La junta ve a qué va el pago antes de aprobarlo.
    const lista = (await P.pedir('GET', `c/${C}/pagos?estado=reportado`, teso.acceso)).json as any[];
    const p = lista.find((x) => x.id === r.json.id);
    assert.deepEqual(p.destinos.map((d: any) => [d.concepto, d.montoUsd]), [['Bomba de agua (cuota 1/2)', 35]]);
    assert.deepEqual(p.aplicaciones, []);
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${r.json.id}/confirmar`, teso.acceso, {})).status, 204);
    const d = await cuenta('b3', b33);
    assert.equal(d.cargos.find((c) => c.id === especial.id)!.estado, 'pagado');
    assert.equal(d.cargos.find((c) => c.tipo === 'ordinaria' && c.periodo === '2026-10-01')!.estado, 'pendiente', 'octubre sigue pendiente');
    assert.equal(d.saldoUsd, 184.8);
    const pago = d.pagos.find((x) => x.id === r.json.id);
    assert.deepEqual(pago.aplicaciones.map((a: any) => [a.concepto, a.montoUsd]), [['Bomba de agua (cuota 1/2)', 35]]);
    // El aviso al vecino dice de qué se descontó.
    const n = (await P.base.admin.query(`select cuerpo from notificaciones where usuario_id = $1 and tipo = 'pago_confirmado' order by creado_en desc limit 1`, [b33.id])).rows[0];
    assert.match(n.cuerpo, /Se descontó de: Bomba de agua \(cuota 1\/2\) \(\$35,00\)/);
  });

  it('lo que sobra va a la deuda más antigua y el resto queda a favor; un cargo nuevo se cubre solo con el saldo a favor', async () => {
    const e = await cuenta('b3', b33);
    const oct = e.cargos.find((c) => c.tipo === 'ordinaria' && c.periodo === '2026-10-01')!;
    const r = await pagar(b33, 'b3', { monto: '200', cargoIds: oct.id });
    assert.equal(r.status, 201, r.body);
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${r.json.id}/confirmar`, pres.acceso, {})).status, 204);
    const d = await cuenta('b3', b33);
    assert.equal(d.saldoUsd, -15.2);
    assert.ok(d.cargos.every((c) => c.estado === 'pagado'), 'todo pagado');
    const ap = d.pagos.find((x) => x.id === r.json.id).aplicaciones.map((a: any) => [a.concepto, a.montoUsd]);
    assert.deepEqual(ap[0], ['Gastos comunes 10/2026', 140], 'primero lo elegido');
    assert.equal(ap.reduce((s: number, a: any) => s + a[1], 0), 184.8);
    const n = (await P.base.admin.query(`select cuerpo from notificaciones where usuario_id = $1 and tipo = 'pago_confirmado' order by creado_en desc limit 1`, [b33.id])).rows[0];
    assert.match(n.cuerpo, /Le quedan \$15,20 a favor/);
    // Multa de $10: se cubre sola con lo que tenía a favor.
    await P.base.admin.query(`insert into cargos (condominio_id, unidad_id, periodo, tipo, concepto, monto_usd) values ($1, $2, $3, 'multa', 'Multa por ruido', 10)`, [C, UNI('b3'), ESTE_MES]);
    const m = await cuenta('b3', b33);
    assert.equal(m.cargos.find((c) => c.tipo === 'multa')!.estado, 'pagado');
    assert.equal(m.saldoUsd, -5.2);
  });

  it('la junta puede cambiar a qué va el pago al aprobarlo; nadie elige deudas de otra casa', async () => {
    const e34 = await cuenta('b4', b34);
    const especial = e34.cargos.find((c) => c.tipo === 'extraordinaria')!;
    const ajena = (await cuenta('b3', b33)).cargos[0];
    assert.equal((await pagar(b34, 'b4', { monto: '20', cargoIds: ajena.id })).status, 400, 'deuda de otra casa');
    const r = await pagar(b34, 'b4', { monto: '20' });
    assert.equal(r.status, 201, r.body);
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${r.json.id}/confirmar`, teso.acceso, { cargoIds: [ajena.id] })).status, 400);
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${r.json.id}/confirmar`, b34.acceso, { cargoIds: [especial.id] })).status, 403);
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${r.json.id}/confirmar`, teso.acceso, { cargoIds: [especial.id] })).status, 204);
    const d = await cuenta('b4', b34);
    const c = d.cargos.find((x) => x.id === especial.id)!;
    assert.equal(c.estado, 'parcial');
    assert.equal(c.pagadoUsd, 20);
    assert.equal(c.pendienteUsd, 15);
  });

  it('un pago rechazado no descuenta nada', async () => {
    const e = await cuenta('b4', b34);
    const oct = e.cargos.find((c) => c.tipo === 'ordinaria' && c.periodo === '2026-10-01')!;
    const r = await pagar(b34, 'b4', { monto: '50', cargoIds: oct.id });
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${r.json.id}/rechazar`, teso.acceso, { motivo: 'No aparece en Zelle' })).status, 204);
    const d = await cuenta('b4', b34);
    assert.equal(d.cargos.find((c) => c.id === oct.id)!.estado, 'pendiente');
    assert.deepEqual(d.pagos.find((x) => x.id === r.json.id).aplicaciones, []);
  });

  it('pago en Bs: se rechaza si la tasa BCV de ese día no está verificada', async () => {
    const r = await P.pedir('POST', `c/${C}/pagos`, b34.acceso, formulario({
      unidadId: UNI('b4'), fechaPago: '2026-09-15', metodo: 'pago_movil', moneda: 'VES', monto: '1000', referencia: '55443322' }));
    assert.equal(r.status, 400);
    assert.match(r.json.error, /tasa BCV del 15\/09\/2026 todavía no está verificada/);
  });
});

describe('avance de las cuotas especiales', () => {
  it('si el condominio publica sus números, todos ven cuánto se ha recaudado; solo la junta ve quién pagó y quién no', async () => {
    assert.equal(((await P.pedir('GET', `c/${C}/partidas`, b31.acceso)).json as any[]).find((x) => x.id === partida).avance, null,
                 'por defecto (0028) los vecinos no ven el avance');
    assert.equal((await P.pedir('PUT', `c/${C}/finanzas-publicas`, pres.acceso, { modo: 'totales' })).status, 204);
    const lista = (await P.pedir('GET', `c/${C}/partidas`, b31.acceso)).json as any[];
    const p = lista.find((x) => x.id === partida);
    assert.deepEqual(p.avance, { emitidoUsd: 250, cobradoUsd: 55, pendienteUsd: 195, casas: 8, casasAlDia: 1, cuotasEmitidas: 1 });
    assert.equal((await P.pedir('GET', `c/${C}/partidas/${partida}/cobro`, b31.acceso)).status, 403);
    const cobro = (await P.pedir('GET', `c/${C}/partidas/${partida}/cobro`, pres.acceso)).json as any[];
    assert.equal(cobro.length, 8);
    const b3 = cobro.find((x) => x.etiqueta === 'Apto B-33'), b4 = cobro.find((x) => x.etiqueta === 'Apto B-34');
    assert.deepEqual([b3.pagadoUsd, b3.pendienteUsd], [35, 0]);
    assert.deepEqual([b4.pagadoUsd, b4.pendienteUsd], [20, 15]);
    assert.equal(cobro[cobro.length - 1].etiqueta, 'Apto B-33', 'los que deben, primero');
  });
});

describe('reporte y cierre del mes', () => {
  it('un pago de octubre aprobado aparece en el reporte de octubre; los pagos se filtran por mes', async () => {
    const r = await pagar(b31, 'b1', { monto: '60', fechaPago: '2026-10-20' });
    assert.equal(r.status, 201, r.body);
    assert.equal((await P.pedir('POST', `c/${C}/pagos/${r.json.id}/confirmar`, teso.acceso, {})).status, 204);
    const oct = (await P.pedir('GET', `c/${C}/pagos?mes=2026-10-01`, teso.acceso)).json as any[];
    assert.deepEqual(oct.map((x) => x.id), [r.json.id]);
  });

  it('octubre: quién pagó y quién no, ingresos, gastos, cuentas y fondo', async () => {
    assert.equal((await P.pedir('GET', `c/${C}/reportes/mensual?periodo=2026-10-01`, b33.acceso)).status, 403, 'solo la junta');
    const r = await P.pedir('GET', `c/${C}/reportes/mensual?periodo=2026-10-01`, pres.acceso);
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.cerrado, null, 'aún no se cierra: en vivo');
    const d = r.json.datos;
    assert.equal(d.resumen.facturadoUsd, 1100);
    assert.equal(d.resumen.facturadoPorTipo.ordinaria, 1000);
    assert.equal(d.resumen.cobradoUsd, 60);
    assert.equal(d.resumen.gastosUsd, 1000);
    assert.equal(d.resumen.totalCasas, 8);
    assert.equal(d.resumen.casasConDeuda, 8, 'a fin de octubre todas debían algo');
    const b1 = d.casas.find((c: any) => c.etiqueta === 'Apto B-31');
    assert.deepEqual([b1.saldoAnteriorUsd, b1.facturadoUsd, b1.pagadoUsd, b1.saldoFinalUsd, b1.estado], [0, 132, 60, 72, 'debe']);
    const b3 = d.casas.find((c: any) => c.etiqueta === 'Apto B-33');
    assert.equal(b3.recibo, 'pagado', 'el recibo de octubre ya está pagado (con un pago de este mes)');
    assert.equal(d.pagos.length, 1);
    assert.deepEqual(d.pagos[0].aplicadoA.map((a: any) => a.concepto), ['Gastos comunes 10/2026']);
    assert.equal(d.gastos.length, 4);
    assert.ok(d.cuentas.length >= 1);
    assert.equal(d.fondoReserva.facturadoAcumUsd, 100);
  });

  it('este mes: aprobados, rechazados y en revisión; avance de la cuota especial', async () => {
    await pagar(b34, 'b4', { monto: '5' });   // queda en revisión
    const d = (await P.pedir('GET', `c/${C}/reportes/mensual?periodo=${ESTE_MES}`, teso.acceso)).json.datos;
    assert.equal(d.resumen.pagosAprobados, 3);
    assert.equal(d.resumen.pagosRechazados, 1);
    assert.equal(d.resumen.pagosEnRevision, 1);
    assert.equal(d.resumen.cobradoUsd, 255);
    const rech = d.pagos.find((p: any) => p.estado === 'rechazado');
    assert.equal(rech.motivoRechazo, 'No aparece en Zelle');
    assert.deepEqual(d.partidas.map((p: any) => [p.titulo, p.emitidoUsd, p.cobradoUsd]), [['Bomba de agua', 250, 55]]);
    const b3 = d.casas.find((c: any) => c.etiqueta === 'Apto B-33');
    assert.deepEqual([b3.estado, b3.saldoFinalUsd], ['a_favor', -5.2]);
  });

  it('cerrar: solo un mes terminado, solo finanzas; el cierre queda guardado tal cual', async () => {
    assert.equal((await P.pedir('POST', `c/${C}/reportes/mensual/cerrar`, teso.acceso, { periodo: ESTE_MES })).status, 400);
    assert.equal((await P.pedir('POST', `c/${C}/reportes/mensual/cerrar`, b33.acceso, { periodo: '2026-10-01' })).status, 403);
    assert.equal((await P.pedir('POST', `c/${C}/reportes/mensual/cerrar`, teso.acceso, { periodo: '2026-10-01' })).status, 200);
    let r = (await P.pedir('GET', `c/${C}/reportes/mensual?periodo=2026-10-01`, pres.acceso)).json;
    assert.equal(r.cerrado.por, 'Jorge Tesorero');
    assert.equal(r.cerrado.automatico, false);
    // Llega tarde un pago de octubre: el cierre guardado no cambia hasta volver a cerrarlo.
    const p = await pagar(b34, 'b4', { monto: '10', fechaPago: '2026-10-30' });
    await P.pedir('POST', `c/${C}/pagos/${p.json.id}/confirmar`, teso.acceso, {});
    r = (await P.pedir('GET', `c/${C}/reportes/mensual?periodo=2026-10-01`, pres.acceso)).json;
    assert.equal(r.datos.resumen.cobradoUsd, 60);
    await P.pedir('POST', `c/${C}/reportes/mensual/cerrar`, teso.acceso, { periodo: '2026-10-01' });
    r = (await P.pedir('GET', `c/${C}/reportes/mensual?periodo=2026-10-01`, pres.acceso)).json;
    assert.equal(r.datos.resumen.cobradoUsd, 70);
    const cierres = (await P.pedir('GET', `c/${C}/cierres`, pres.acceso)).json;
    assert.deepEqual(cierres.map((k: any) => k.periodo), ['2026-10-01']);
  });

  it('cierre automático del día 1 (rol servicio) y aviso a la junta', async () => {
    const anterior = (await P.base.admin.query(`select (date_trunc('month', hoy_caracas()) - interval '1 month')::date::text p`)).rows[0].p;
    await P.base.admin.query(`delete from cierres_mensuales where periodo = $1`, [anterior]);
    const filas = await sqlComo(P.base.api, 'servicio', `select * from cierre_automatico()`);
    assert.equal(filas.length, 1);
    const k = (await P.base.admin.query(`select automatico, cerrado_por from cierres_mensuales where periodo = $1`, [anterior])).rows[0];
    assert.deepEqual([k.automatico, k.cerrado_por], [true, null]);
    const n = (await P.base.admin.query(`select count(*)::int n from notificaciones where tipo = 'cierre_mes' and usuario_id = $1`, [teso.id])).rows[0].n;
    assert.equal(n, 1);
    assert.equal((await sqlComo(P.base.api, 'servicio', `select * from cierre_automatico()`)).length, 0, 'no repite');
    await assert.rejects(sqlComo(P.base.api, pres.id, `select * from cierre_automatico()`));
  });

  it('aviso de tasa sin confirmar: no avisa si la de hoy está verificada', async () => {
    assert.equal((await sqlComo(P.base.api, 'servicio', `select avisar_tasa_sin_verificar() n`))[0].n, 0);
  });
});
