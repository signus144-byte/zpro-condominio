// MODO DEMO: datos ficticios en memoria que imitan las reglas del servidor
// (0002_funciones_y_seguridad.sql). Se reinician al recargar la app.
import type { Api } from './api';
import { hoyLocal, mesAnterior, mesSiguiente, periodoActual } from '../formato';
import type {
  Aviso, Cargo, CategoriaReporte, Condominio, CuentaFinanciera, EstadoReporte, Gasto, Marca, Pago,
  Partida, Reporte, Sesion, TipoDocumento, Unidad, Visibilidad,
  CodigoAcceso, ComentarioReporte, FacturaZentaPro, MovimientoBancario, Rol, SolicitudIngresoJunta, Yo,
  Notificacion, TipoNotificacion,
  AlcanceCasas, AlcanceDifusion, Difusion, GrupoUnidades,
} from './tipos';
import type { DifusionEnviada } from './api';
import { crearChatDemo, etiquetaChat } from './demoChat';
import { crearAlertaDemo } from './demoAlerta';
import { aplicarUnidad, cargoConEstado, pagoConDestinos, reporteMensual as armarReporte, type PagoDemo } from './demoFinanzas';
import { confirmarManual, consultarFuentes, lecturasActuales, sinInternet, tasaPara } from './tasaEnVivo';
import type { ReporteDelMes, TasaBcv } from './tipos';

let n = 0;
const id = () => `demo-${++n}`;
const r2 = (x: number) => Math.round(x * 100) / 100;
const hoy = () => hoyLocal();
const espera = () => new Promise((r) => setTimeout(r, 120));

const PERIODO = periodoActual();
const ANTERIOR = mesAnterior(PERIODO);

// ---------- Datos semilla ----------
const condominio: Condominio = {
  id: 'demo-condo', nombre: 'Residencias Los Samanes (demo)', rif: 'J-00000000-0',
  direccion: 'Maracay, Aragua', fondoReservaPct: 10, diaVencimiento: 5,
  chatVecinos: true,                 // en la demostración viene encendido; en un condominio real lo enciende la junta
};

const unidades: Unidad[] = [
  ['A', '11', 11, 'Familia Pérez'], ['A', '12', 11, 'Carlos Rivas'], ['A', '13', 13, 'Ana Gómez'],
  ['A', '14', 13, 'Luis Medina'], ['B', '31', 12, 'Rosa Herrera'], ['B', '32', 12, 'José Blanco'],
  ['B', '33', 14, 'Elena Castro'], ['B', '34', 14, 'Pedro Salas'],
].map(([bloque, numero, alicuota, propietario]) => ({
  id: `u-${bloque}${numero}`, bloque: bloque as string, numero: numero as string,
  alicuota: alicuota as number, propietario: propietario as string,
}));
export const etiqueta = (u: Pick<Unidad, 'bloque' | 'numero'>) => `${u.bloque ? u.bloque + '-' : ''}${u.numero}`;
const unidad = (uid: string) => unidades.find((u) => u.id === uid)!;

// saldoInicial: saldo con el que se migró cada cuenta al empezar a usar la app.
const saldoInicial: Record<string, number> = { 'c-bs': 60000, 'c-zelle': 2500, 'c-caja': 300, 'c-fondo': 1800 };
const cuentas: CuentaFinanciera[] = [
  { id: 'c-bs', nombre: 'Banco (Bs) · Pago Móvil', tipo: 'banco_bs', moneda: 'VES', datosPago: 'Pago Móvil · Banco 0102 · 0414-0000000 · J-00000000-0' },
  { id: 'c-zelle', nombre: 'Zelle', tipo: 'zelle', moneda: 'USD', datosPago: 'condominio.demo@correo.com · Residencias Los Samanes' },
  { id: 'c-caja', nombre: 'Caja en divisas', tipo: 'caja', moneda: 'USD', datosPago: 'Entregar al tesorero contra recibo firmado' },
  { id: 'c-fondo', nombre: 'Fondo de reserva', tipo: 'fondo_reserva', moneda: 'USD', datosPago: null },
];

// Tasas FICTICIAS solo para los datos de ejemplo de meses pasados (gastos y pagos ya hechos). La tasa de HOY es la
// real: el teléfono la consulta al BCV y a DolarApi (tasaEnVivo.ts) y sin dos fuentes no deja pagar en bolívares.
const TASA_EJEMPLO = 850, TASA_EJEMPLO_ANTERIOR = 812.4;

const gastos: Gasto[] = [];
const cargos: Cargo[] = [];
const pagos: PagoDemo[] = [];
const recibosEmitidos = new Set<string>();
const partidas: Partida[] = [];
/** Casas a las que aplica cada cuota especial (sin entrada = todo el condominio). Igual que partida_unidades. */
const incluidas = new Map<string, string[]>();
const casasDe = (p: Pick<Partida, 'id'>) => incluidas.get(p.id) ?? unidades.map((u) => u.id);
const meIncluye = (p: Pick<Partida, 'id'>, uid: string | null | undefined) => !!uid && casasDe(p).includes(uid);
const votos: { votacionId: string; unidadId: string; opcionId: string }[] = [];
const reportes: (Reporte & { autorId: string | null; autorPrivado: string })[] = [];
const avisos: Aviso[] = [
  { id: id(), titulo: 'Corte de agua programado', cuerpo: 'El sábado de 8:00 a 12:00 se hará mantenimiento al tanque. Guarden agua.', fijado: true, creadoEn: hoy() },
  { id: id(), titulo: 'Asamblea ordinaria', cuerpo: 'Se convocará la asamblea anual. La agenda se publicará en esta sección.', fijado: false, creadoEn: hoy() },
];

function gastoBase(periodo: string, categoria: string, descripcion: string, moneda: 'USD' | 'VES', monto: number) {
  const t = moneda === 'VES' ? (periodo === ANTERIOR ? TASA_EJEMPLO_ANTERIOR : TASA_EJEMPLO) : null;
  gastos.push({
    id: id(), periodo, tipo: 'comun', categoria, descripcion, moneda, monto, tasaBcv: t,
    montoUsd: t ? r2(monto / t) : monto, fechaGasto: periodo, facturaUrl: null, unidadId: null, partidaId: null,
    cuentaId: moneda === 'VES' ? 'c-bs' : 'c-zelle',
  });
}
for (const p of [ANTERIOR, PERIODO]) {
  gastoBase(p, 'Vigilancia', 'Servicio de vigilancia', 'USD', 600);
  gastoBase(p, 'Conserjería', 'Conserje (sueldo y bono)', 'USD', 250);
  gastoBase(p, 'Electricidad', 'Corpoelec áreas comunes', 'VES', r2(100 * (p === ANTERIOR ? TASA_EJEMPLO_ANTERIOR : TASA_EJEMPLO)));
  gastoBase(p, 'Mantenimiento', 'Mantenimiento bomba de agua', 'USD', 50);
}

// Misma lógica que generar_recibos() en SQL.
function emitirRecibos(periodo: string): number {
  if (recibosEmitidos.has(periodo)) throw new Error(`Los recibos de ${periodo.slice(5, 7)}/${periodo.slice(0, 4)} ya fueron emitidos`);
  const comun = r2(gastos.filter((g) => g.periodo === periodo && g.tipo === 'comun').reduce((s, g) => s + g.montoUsd, 0));
  const fondo = r2(comun * condominio.fondoReservaPct / 100);
  const mmYYYY = `${periodo.slice(5, 7)}/${periodo.slice(0, 4)}`;
  for (const u of unidades) {
    if (comun > 0) cargos.push({ id: id(), unidadId: u.id, periodo, tipo: 'ordinaria', concepto: `Gastos comunes ${mmYYYY}`, montoUsd: r2(comun * u.alicuota / 100) });
    if (fondo > 0) cargos.push({ id: id(), unidadId: u.id, periodo, tipo: 'fondo_reserva', concepto: `Fondo de reserva ${condominio.fondoReservaPct}%`, montoUsd: r2(fondo * u.alicuota / 100) });
    for (const p of partidas) {
      if (!['aprobada', 'en_ejecucion'].includes(p.estado) || !p.primeraCuota) continue;
      if (!meIncluye(p, u.id)) continue;                      // la cuota se cobra solo a las casas incluidas
      const idx = mesesEntre(p.primeraCuota, periodo);
      if (idx < 0 || idx >= p.numeroCuotas) continue;
      cargos.push({ id: id(), unidadId: u.id, periodo, tipo: 'extraordinaria', concepto: `${p.titulo} (cuota ${idx + 1}/${p.numeroCuotas})`, montoUsd: cuotaDe(p, u), partidaId: p.id });
    }
    for (const g of gastos.filter((x) => x.periodo === periodo && x.tipo === 'no_comun' && x.unidadId === u.id)) {
      cargos.push({ id: id(), unidadId: u.id, periodo, tipo: 'no_comun', concepto: g.descripcion, montoUsd: g.montoUsd });
    }
  }
  recibosEmitidos.add(periodo);
  return unidades.length;
}
function mesesEntre(desde: string, hasta: string) {
  return (Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4))) * 12 + Number(hasta.slice(5, 7)) - Number(desde.slice(5, 7));
}
/** Cuota de una casa: repartida solo entre las casas incluidas (por alícuota relativa o en partes iguales). */
function cuotaDe(p: Pick<Partida, 'id' | 'presupuestoUsd' | 'numeroCuotas' | 'reparto'>, u: Unidad) {
  const casas = casasDe(p).map(unidad);
  const base = incluidas.has(p.id) ? casas.reduce((s, x) => s + x.alicuota, 0) : 100;
  return p.reparto === 'alicuota' ? r2(p.presupuestoUsd / p.numeroCuotas * u.alicuota / base) : r2(p.presupuestoUsd / p.numeroCuotas / casas.length);
}
const TODOS: Partida['alcance'] = { tipo: 'todos', nombre: null, unidades: 8 };

// Partida aprobada (ya cobrándose) + partida en votación.
partidas.push({
  id: id(), titulo: 'Impermeabilización techo Bloque A', descripcion: 'Filtraciones en apartamentos del último piso.',
  presupuestoUsd: 2400, numeroCuotas: 4, primeraCuota: ANTERIOR, reparto: 'alicuota', estado: 'en_ejecucion',
  creadoEn: ANTERIOR, votacion: null, cuotaMiUnidadUsd: null, alcance: TODOS, meAfecta: false,
});
const votPintura = { id: id(), opA: id(), opR: id() };
partidas.push({
  id: id(), titulo: 'Pintura de fachada Bloque B', descripcion: 'Pintura exterior y reparación de grietas. 3 presupuestos recibidos; el más bajo es de $3.000.',
  presupuestoUsd: 3000, numeroCuotas: 3, primeraCuota: mesSiguiente(PERIODO), reparto: 'alicuota', estado: 'en_votacion',
  creadoEn: hoy(), cuotaMiUnidadUsd: null, alcance: TODOS, meAfecta: false,
  votacion: {
    id: votPintura.id, titulo: '¿Aprueba la pintura de la fachada del Bloque B?', ponderacion: 'alicuota', umbralPct: 50.01,
    estado: 'abierta', cierraEn: null, miVotoOpcionId: null,
    opciones: [
      { id: votPintura.opA, texto: 'Aprobar', orden: 0, unidades: 0, pesoPct: 0 },
      { id: votPintura.opR, texto: 'Rechazar', orden: 1, unidades: 0, pesoPct: 0 },
    ],
  },
});
// Cuota solo para la calle A (portón eléctrico propio): las casas del bloque B ni la ven.
const votPorton = { id: id(), opA: id(), opR: id(), partida: id() };
partidas.push({
  id: votPorton.partida, titulo: 'Motor del portón de la calle A', descripcion: 'El motor del portón eléctrico de la calle A se quemó. Presupuesto más bajo: $480.',
  presupuestoUsd: 480, numeroCuotas: 2, primeraCuota: mesSiguiente(PERIODO), reparto: 'unidad', estado: 'en_votacion',
  creadoEn: new Date(Date.now() - 86_400_000).toISOString(), cuotaMiUnidadUsd: null,
  alcance: { tipo: 'unidades', nombre: 'Calle A · portón', unidades: 4 }, meAfecta: false,
  votacion: {
    id: votPorton.id, titulo: '¿Aprueba: Motor del portón de la calle A?', ponderacion: 'unidad', umbralPct: 50.01,
    estado: 'abierta', cierraEn: null, miVotoOpcionId: null,
    opciones: [
      { id: votPorton.opA, texto: 'Aprobar', orden: 0, unidades: 0, pesoPct: 0 },
      { id: votPorton.opR, texto: 'Rechazar', orden: 1, unidades: 0, pesoPct: 0 },
    ],
  },
});
incluidas.set(votPorton.partida, ['u-A11', 'u-A12', 'u-A13', 'u-A14']);
votos.push({ votacionId: votPorton.id, unidadId: 'u-A11', opcionId: votPorton.opA });
votos.push({ votacionId: votPintura.id, unidadId: 'u-B31', opcionId: votPintura.opA },
           { votacionId: votPintura.id, unidadId: 'u-A11', opcionId: votPintura.opA },
           { votacionId: votPintura.id, unidadId: 'u-A12', opcionId: votPintura.opR });

emitirRecibos(ANTERIOR);
emitirRecibos(PERIODO);

function pagoDemo(uid: string, fecha: string, metodo: Pago['metodo'], moneda: 'USD' | 'VES', monto: number, ref: string | null, estado: Pago['estado']) {
  const t = moneda === 'VES' ? TASA_EJEMPLO_ANTERIOR : null;
  const pid = id();
  pagos.push({
    id: pid, unidadId: uid, unidadEtiqueta: etiqueta(unidad(uid)), fechaPago: fecha, metodo, moneda, monto, tasaBcv: t,
    montoUsd: t ? r2(monto / t) : monto, referencia: ref, bancoOrigen: moneda === 'VES' ? 'Banesco' : null,
    comprobanteUrl: null, nota: null, estado, motivoRechazo: null, creadoEn: fecha, revisadoEn: estado === 'confirmado' ? fecha : null,
    cuentaDestinoId: moneda === 'VES' ? 'c-bs' : metodo === 'zelle' ? 'c-zelle' : 'c-caja', destinoIds: [],
  });
  return pid;
}
// Al día: A-11, A-13, B-31. Parcial: A-14, B-33. Morosos: A-12, B-32, B-34.
for (const uid of ['u-A11', 'u-A13', 'u-B31']) {
  const deuda = cargos.filter((c) => c.unidadId === uid).reduce((s, c) => s + c.montoUsd, 0);
  pagoDemo(uid, ANTERIOR.slice(0, 8) + '04', 'zelle', 'USD', r2(deuda), `ZL${uid.slice(-3)}88`, 'confirmado');
}
for (const uid of ['u-A14', 'u-B33']) {
  const deuda = cargos.filter((c) => c.unidadId === uid && c.periodo === ANTERIOR).reduce((s, c) => s + c.montoUsd, 0);
  pagoDemo(uid, ANTERIOR.slice(0, 8) + '06', 'pago_movil', 'VES', r2(deuda * TASA_EJEMPLO_ANTERIOR), `0001${uid.slice(-2)}77`, 'confirmado');
}
// Pagos por revisar: B-32 pagó la cuota de este mes por Zelle (eligió qué pagar); A-12 trajo efectivo sin indicar.
{
  const delMes = cargos.filter((c) => c.unidadId === 'u-B32' && c.periodo === PERIODO && c.tipo !== 'extraordinaria');
  const pid = pagoDemo('u-B32', hoy(), 'zelle', 'USD', r2(delMes.reduce((s, c) => s + c.montoUsd, 0)), 'ZL55B32', 'reportado');
  pagos.find((x) => x.id === pid)!.destinoIds = delMes.map((c) => c.id);
}
pagoDemo('u-A12', hoy(), 'efectivo_usd', 'USD', 80, null, 'reportado');

function reporteDemo(categoria: CategoriaReporte, titulo: string, descripcion: string, ubicacion: string,
                     anonimo: boolean, autor: string, visibilidad: Visibilidad, estado: EstadoReporte) {
  reportes.push({
    id: id(), categoria, titulo, descripcion, ubicacion, anonimo, autorId: anonimo ? null : autor,
    autorNombre: anonimo ? null : autor, autorPrivado: autor, visibilidad, estado, fotos: [], creadoEn: hoy(), esMio: false,
  });
}
reporteDemo('ruido', 'Música muy alta en la noche', 'Todas las noches después de las 11 pm hay música a volumen muy alto. Por favor, tomar cartas en el asunto.',
  'Bloque B, apto 34', true, 'usr-otro', 'presidencia', 'nuevo');
reporteDemo('dano_area_comun', 'Lámpara dañada en el pasillo', 'La lámpara del pasillo del piso 3 está fundida desde hace una semana.',
  'Bloque A, piso 3', false, 'Ana Gómez', 'comunidad', 'en_proceso');
reporteDemo('estacionamiento', 'Carro en puesto de visitantes', 'Un vehículo gris lleva 4 días ocupando el puesto de visitantes.',
  'Estacionamiento, puesto V2', false, 'Rosa Herrera', 'comunidad', 'resuelto');

// ---------- Sesión demo ----------
const CONDO = 'demo-condo';
const SESIONES: Record<'residente' | 'presidencia', Sesion> = {
  residente: { usuarioId: 'usr-elena', nombre: 'Elena Castro', rol: 'propietario', unidadId: 'u-B33', esJunta: false, manejaFinanzas: false,
               condominioId: CONDO, condominio: 'Residencias Los Samanes (demo)', unidad: 'Apto B-33' },
  presidencia: { usuarioId: 'usr-maria', nombre: 'María Fernández', rol: 'presidente', unidadId: null, esJunta: true, manejaFinanzas: true,
                 condominioId: CONDO, condominio: 'Residencias Los Samanes (demo)', unidad: null },
};
let sesion: Sesion | null = null;
const exigir = () => { if (!sesion) throw new Error('Inicie sesión'); return sesion; };
const exigirFinanzas = () => { const s = exigir(); if (!s.manejaFinanzas) throw new Error('Sin permiso'); return s; };

/** ¿Puede la sesión ver esta cuota especial? La junta siempre; los demás solo si es de todos o incluye una de sus casas. */
function puedeVerPartida(p: Partida, s: Sesion) {
  return s.esJunta || (p.estado !== 'borrador' && (!incluidas.has(p.id) || meIncluye(p, s.unidadId)));
}
/** Cuánto se ha emitido y cobrado de una cuota especial (igual que avance_partidas). */
function avanceDe(pid: string): Partida['avance'] {
  const cs = cargos.filter((c) => c.partidaId === pid && c.montoUsd > 0);
  if (!cs.length) return null;
  const casas = [...new Set(cs.map((c) => c.unidadId))];
  const aps = new Map(casas.map((u) => [u, aplicarUnidad(cargos, pagos, u)]));
  const pag = (c: Cargo) => aps.get(c.unidadId)!.porCargo.get(c.id) ?? 0;
  const emitido = r2(cs.reduce((s, c) => s + c.montoUsd, 0)), cobrado = r2(cs.reduce((s, c) => s + pag(c), 0));
  return {
    emitidoUsd: emitido, cobradoUsd: cobrado, pendienteUsd: r2(cs.reduce((s, c) => s + Math.max(c.montoUsd - pag(c), 0), 0)),
    casas: casas.length,
    casasAlDia: casas.filter((u) => cs.filter((c) => c.unidadId === u).every((c) => pag(c) >= c.montoUsd - 0.005)).length,
    cuotasEmitidas: new Set(cs.map((c) => c.periodo)).size,
  };
}

// ---------- Cierres del mes ----------
const cierresDemo = new Map<string, { en: string; automatico: boolean; por: string | null; datos: ReporteDelMes['datos'] }>();
function reporteDe(periodo: string) {
  const t: TasaBcv = tasaPara(periodo < PERIODO ? mesSiguiente(periodo) : undefined);
  return armarReporte(periodo, {
    unidades, cargos, pagos, gastos, cuentas, saldoInicial, partidas,
    tasa: t.usdVes ? { fecha: t.fecha, usdVes: t.usdVes } : { fecha: null, usdVes: periodo === ANTERIOR ? TASA_EJEMPLO_ANTERIOR : null },
    etiqueta: (u) => `Apto ${etiqueta(u)}`,
  });
}

// El mes anterior ya se cerró solo el día 1 (como lo hace el servidor).
cierresDemo.set(ANTERIOR, { en: `${PERIODO}T11:30:00.000Z`, automatico: true, por: null, datos: reporteDe(ANTERIOR) });

function vistaPartida(p: Partida): Partida {
  const s = sesion;
  const v = p.votacion;
  const u = s?.unidadId && meIncluye(p, s.unidadId) ? unidad(s.unidadId) : null;
  const casas = casasDe(p);
  const totalAlic = casas.reduce((x, c) => x + unidad(c).alicuota, 0) || 100;
  return {
    ...p,
    alcance: { tipo: incluidas.has(p.id) ? 'unidades' : 'todos', nombre: incluidas.has(p.id) ? p.alcance.nombre : null, unidades: casas.length },
    meAfecta: !!u,
    cuotaMiUnidadUsd: u ? cuotaDe(p, u) : null,
    avance: avanceDe(p.id),
    ...(s?.esJunta ? { unidadIds: [...casas] } : {}),
    votacion: v && {
      ...v,
      miVotoOpcionId: u ? votos.find((x) => x.votacionId === v.id && x.unidadId === u.id)?.opcionId ?? null : null,
      sinVotar: s?.esJunta ? casas.filter((c) => !votos.some((x) => x.votacionId === v.id && x.unidadId === c)).length : null,
      opciones: v.opciones.map((o) => {
        const vs = votos.filter((x) => x.votacionId === v.id && x.opcionId === o.id && casas.includes(x.unidadId));
        const peso = v.ponderacion === 'alicuota'
          ? 100 * vs.reduce((s2, x) => s2 + unidad(x.unidadId).alicuota, 0) / totalAlic
          : 100 * vs.length / casas.length;
        return { ...o, unidades: vs.length, pesoPct: r2(peso) };
      }),
    },
  };
}

function saldoDe(uid: string) {
  const c = cargos.filter((x) => x.unidadId === uid).reduce((s, x) => s + x.montoUsd, 0);
  const p = pagos.filter((x) => x.unidadId === uid && x.estado === 'confirmado').reduce((s, x) => s + x.montoUsd, 0);
  return { cargosUsd: r2(c), pagadoUsd: r2(p), saldoUsd: r2(c - p) };
}

// ---------- Marca y documentos (0004 / 0006) ----------
const marca: Marca = {
  nombre: 'Residencias Los Samanes',
  nombreAsociacion: 'Asociación Civil de Propietarios Residencias Los Samanes',
  rif: 'J-00000000-0', direccion: 'Av. Las Delicias, sector Los Samanes', ciudad: 'Maracay, Aragua',
  telefono: '0243-000-0000', correo: 'junta@lossamanes.demo', colorPrimario: '#0f4c4a',
  logoUrl: './demo/logo.png', fotoEntradaUrl: './demo/entrada.jpg',
};
const documentos: { codigo: string; tipo: TipoDocumento; unidadId: string | null; vigenteHasta: string | null; emitidoEn: string }[] = [];
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function nuevoCodigo() {
  let c = '';
  for (let i = 0; i < 10; i++) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return c;
}
function finDeMes() {
  const d = new Date(); d.setMonth(d.getMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}


// ---------- v0.3: cuentas, accesos de la junta, conciliación y factura de ZentaPro ----------
const JUNTA_ROLES: Rol[] = ['presidente', 'tesorero', 'vocal', 'administrador'];
const FINANZAS_ROLES: Rol[] = ['presidente', 'tesorero', 'administrador'];
const enDias = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const etqU = (uid: string | null) => (uid ? etiquetaChat(unidad(uid)) : null);

interface MiembroDemo { usuarioId: string; nombre: string; rol: Rol; unidadId: string | null; activo: boolean; altaEn: string }
const miembrosDemo: MiembroDemo[] = [
  { usuarioId: 'usr-maria', nombre: 'María Fernández', rol: 'presidente', unidadId: null, activo: true, altaEn: enDias(-200) },
  { usuarioId: 'usr-jorge', nombre: 'Jorge Rondón', rol: 'tesorero', unidadId: null, activo: true, altaEn: enDias(-200) },
  { usuarioId: 'usr-elena', nombre: 'Elena Castro', rol: 'propietario', unidadId: 'u-B33', activo: true, altaEn: enDias(-120) },
  { usuarioId: 'usr-pedro', nombre: 'Pedro Salas', rol: 'propietario', unidadId: 'u-B34', activo: true, altaEn: enDias(-90) },
  { usuarioId: 'usr-ana', nombre: 'Ana Gómez', rol: 'propietario', unidadId: 'u-A13', activo: true, altaEn: enDias(-60) },
  { usuarioId: 'usr-rosa', nombre: 'Rosa Herrera', rol: 'inquilino', unidadId: 'u-B31', activo: true, altaEn: enDias(-30) },
];
const codigosDemo: CodigoAcceso[] = [
  { codigo: 'A12-DEMO', unidadId: 'u-A12', unidad: etqU('u-A12'), rol: 'propietario', usos: 0, usosMax: 3, expiraEn: enDias(60), requiereAprobacion: false },
  { codigo: 'B32-K7PQ', unidadId: 'u-B32', unidad: etqU('u-B32'), rol: 'propietario', usos: 1, usosMax: 3, expiraEn: enDias(45), requiereAprobacion: true },
];
const CODIGO_ACTIVACION = 'SAMANES-DEMO';
const solicitudesDemo: (SolicitudIngresoJunta & { usuarioId: string })[] = [
  { id: id(), usuarioId: 'usr-jose', usuarioNombre: 'José Blanco', unidadId: 'u-B32', unidad: etqU('u-B32'), rol: 'propietario', creadoEn: enDias(-1) },
];
const movimientosDemo: (MovimientoBancario & { huella: string })[] = [
  { id: id(), cuentaId: 'c-bs', cuenta: 'Banco (Bs) · Pago Móvil', fecha: hoy(), referencia: '55550000', descripcion: 'PAGO MOVIL RECIBIDO 0412-555',
    monto: 10000, moneda: 'VES', origen: 'extracto', pagoId: null, unidad: null, huella: 'semilla-1' },
];
// Mensualidad de ZentaPro: plan por tamaño (8 unidades → Pequeño, $40 al mes), se paga SOLO en Bs a la tasa del día del pago.
const montoZP = 40;
type FacturaZPDemo = Pick<FacturaZentaPro, 'id' | 'periodo' | 'plan' | 'montoUsd' | 'tasaBcv' | 'montoVes' | 'vence' | 'estado' | 'numeroControl' | 'pagadaEn'>;
const facturasZP: FacturaZPDemo[] = [
  { id: id(), periodo: PERIODO, plan: 'Pequeño', montoUsd: montoZP, tasaBcv: TASA_EJEMPLO, montoVes: r2(montoZP * TASA_EJEMPLO), vence: PERIODO.slice(0, 8) + '10',
    estado: 'emitida', numeroControl: null, pagadaEn: null },
  { id: id(), periodo: ANTERIOR, plan: 'Pequeño', montoUsd: montoZP, tasaBcv: TASA_EJEMPLO_ANTERIOR, montoVes: r2(montoZP * TASA_EJEMPLO_ANTERIOR), vence: ANTERIOR.slice(0, 8) + '10',
    estado: 'pagada', numeroControl: '00-000123', pagadaEn: ANTERIOR.slice(0, 8) + '08T15:00:00.000Z' },
];
interface PagoZPDemo { facturaId: string; referencia: string; montoVes: number; tasa: number; montoUsd: number; estado: 'reportado' | 'confirmado' }
const pagosZP: PagoZPDemo[] = [
  { facturaId: facturasZP[1].id, referencia: '00445566', montoVes: r2(montoZP * TASA_EJEMPLO_ANTERIOR), tasa: TASA_EJEMPLO_ANTERIOR, montoUsd: montoZP, estado: 'confirmado' },
];
const comentariosDemo = new Map<string, (ComentarioReporte & { autorId: string })[]>();

/** Cuenta creada en la demostración con "Crear cuenta" (las de los botones residente/presidencia se derivan de su sesión). */
let cuentaDemo: Yo | null = null;

function sesionDeCuenta(y: Yo): Sesion | null {
  const ms = y.membresias.filter((m) => m.condominioId === CONDO);
  if (!ms.length) return null;
  const roles = ms.map((m) => m.rol);
  const conUnidad = ms.find((m) => m.unidadId);
  return {
    usuarioId: y.usuario.id, nombre: y.usuario.nombre, rol: roles.find((r) => JUNTA_ROLES.includes(r)) ?? roles[0],
    unidadId: conUnidad?.unidadId ?? null, unidad: conUnidad?.unidad ?? null,
    esJunta: roles.some((r) => JUNTA_ROLES.includes(r)), manejaFinanzas: roles.some((r) => FINANZAS_ROLES.includes(r)),
    condominioId: CONDO, condominio: condominio.nombre,
  };
}
function agregarMembresia(usuarioId: string, nombre: string, rol: Rol, unidadId: string | null) {
  miembrosDemo.push({ usuarioId, nombre, rol, unidadId, activo: true, altaEn: new Date().toISOString() });
  if (cuentaDemo && cuentaDemo.usuario.id === usuarioId) {
    cuentaDemo.membresias.push({ condominioId: CONDO, condominio: condominio.nombre, estadoCondominio: 'activo', rol, unidadId, unidad: etqU(unidadId) });
    cuentaDemo.solicitudesPendientes = cuentaDemo.solicitudesPendientes.filter((s) => !(s.rol === rol && s.unidad === etqU(unidadId)));
  }
}
const refCorta = (r: string | null | undefined) => (r ?? '').replace(/\D/g, '').slice(-6);
const diasEntre = (a: string, b: string) => Math.abs(new Date(a + 'T12:00:00').getTime() - new Date(b + 'T12:00:00').getTime()) / 86_400_000;
function exigirPresidencia() {
  const s = exigir();
  if (!['presidente', 'administrador'].includes(s.rol)) throw new Error('Solo la presidencia o el administrador');
  return s;
}

const chat = crearChatDemo({ unidades, sesion: () => sesion, condominio: () => marca.nombre, chatVecinos: () => condominio.chatVecinos });

// ---------- Notificaciones (mismas reglas que 0018_notificaciones.sql) ----------
const notifs: (Notificacion & { usuarioId: string })[] = [];
const oyentes = new Set<(n: Notificacion) => void>();
const avisosPorCorreo = new Map<string, boolean>();
const veF = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const textoMonto = (p: Pick<Pago, 'moneda' | 'monto'>) => (p.moneda === 'VES' ? `Bs ${veF.format(p.monto)}` : `$${veF.format(p.monto)}`);
const conRef = (r: string | null) => (r ? ` (ref. ${r})` : '');
const usuariosFinanzas = () => [...new Set(miembrosDemo.filter((m) => m.activo && FINANZAS_ROLES.includes(m.rol)).map((m) => m.usuarioId))];
const usuariosDeUnidad = (uid: string) => [...new Set(miembrosDemo.filter((m) => m.activo && m.unidadId === uid).map((m) => m.usuarioId))];
const todosLosMiembros = () => [...new Set(miembrosDemo.filter((m) => m.activo).map((m) => m.usuarioId))];
const sinUsuario = ({ usuarioId: _u, ...n }: Notificacion & { usuarioId: string }): Notificacion => n;

function notificar(usuarios: string[], tipo: TipoNotificacion, titulo: string, cuerpo: string,
                   datos: Notificacion['datos'] = {}, creadoEn = new Date().toISOString(), leida = false) {
  for (const usuarioId of new Set(usuarios)) {
    const n = { id: id(), usuarioId, tipo, condominioId: CONDO, titulo, cuerpo, datos, leida, creadoEn };
    notifs.push(n);
    if (sesion?.usuarioId === usuarioId) for (const f of oyentes) f(sinUsuario(n));
  }
}
function avisarPagoReportado(p: Pago, creadoEn?: string) {
  const casa = etqU(p.unidadId)!;
  notificar(usuariosFinanzas(), 'pago_reportado', `Pago por revisar: ${casa}`,
    `${casa} reportó ${textoMonto(p)}${conRef(p.referencia)}. Concílielo en el banco y apruébelo o recháselo.`,
    { pagoId: p.id, pantalla: 'pagos' }, creadoEn);
}
function avisarPagoRevisado(p: Pago) {
  if (p.estado === 'confirmado') {
    const saldo = saldoDe(p.unidadId).saldoUsd;
    const ap = aplicarUnidad(cargos, pagos, p.unidadId).porPago.get(p.id) ?? [];
    notificar(usuariosDeUnidad(p.unidadId), 'pago_confirmado', 'Pago aprobado',
      `La junta aprobó su pago de ${textoMonto(p)}${conRef(p.referencia)} del ${p.fechaPago.split('-').reverse().join('/')}. `
        + (ap.length ? `Se descontó de: ${ap.map((a) => `${a.concepto} ($${veF.format(a.montoUsd)})`).join(', ')}. ` : '')
        + (saldo > 0.009 ? `Saldo pendiente: $${veF.format(saldo)}.` : saldo < -0.009 ? `Le quedan $${veF.format(-saldo)} a favor para el próximo recibo.` : 'Está al día.'),
      { pagoId: p.id, pantalla: 'estado-cuenta' });
  } else if (p.estado === 'rechazado') {
    notificar(usuariosDeUnidad(p.unidadId), 'pago_rechazado', 'Pago rechazado',
      `La junta rechazó su pago de ${textoMonto(p)}${conRef(p.referencia)}. Motivo: ${p.motivoRechazo?.trim() || 'sin indicar'}. `
        + 'Revise los datos y vuelva a reportarlo.',
      { pagoId: p.id, pantalla: 'estado-cuenta' });
  }
}
// Semilla: los dos pagos reportados avisaron a la junta, y esta mañana llegó el recordatorio diario.
for (const p of pagos.filter((x) => x.estado === 'reportado')) avisarPagoReportado(p, new Date(Date.now() - 5 * 3600_000).toISOString());
{
  const pend = pagos.filter((x) => x.estado === 'reportado');
  const bsT = pend.filter((x) => x.moneda === 'VES').reduce((s, x) => s + x.monto, 0);
  const usdT = pend.filter((x) => x.moneda === 'USD').reduce((s, x) => s + x.monto, 0);
  notificar(usuariosFinanzas(), 'pagos_pendientes', `${pend.length} pagos por aprobar o rechazar`,
    `Tiene ${pend.length} pagos reportados esperando revisión. Total: ${[bsT ? `Bs ${veF.format(bsT)}` : '', usdT ? `$${veF.format(usdT)}` : ''].filter(Boolean).join(' + ')}. `
      + 'Los residentes ven su pago "en revisión" hasta que usted lo apruebe o lo rechace.',
    { pantalla: 'pagos', pendientes: pend.length }, new Date(Date.now() - 2 * 3600_000).toISOString());
}
// Elena: su pago del mes anterior ya fue aprobado (leída).
{
  const p = pagos.find((x) => x.unidadId === 'u-B33' && x.estado === 'confirmado');
  if (p) notificar(['usr-elena'], 'pago_confirmado', 'Pago aprobado',
    `La junta aprobó su pago de ${textoMonto(p)}${conRef(p.referencia)} del ${p.fechaPago.split('-').reverse().join('/')}.`,
    { pagoId: p.id, pantalla: 'estado-cuenta' }, new Date(p.fechaPago + 'T15:00:00').toISOString(), true);
}

// ---------- Alerta vecinal y enlace de invitación (0019 / 0020) ----------
const alerta = crearAlertaDemo({
  unidades, miembros: () => miembrosDemo, sesion: () => sesion, condominio: () => condominio.nombre,
  telefonoDe: () => null, notificar, etiquetaUnidad: etqU, nuevoId: id,
  usuarioActual: () => (cuentaDemo ? { id: cuentaDemo.usuario.id, nombre: cuentaDemo.usuario.nombre }
    : sesion ? { id: sesion.usuarioId, nombre: sesion.nombre } : null),
  nuevaSolicitud(usuarioId, nombre, unidadId, rol) {
    solicitudesDemo.push({ id: id(), usuarioId, usuarioNombre: nombre, unidadId, unidad: etqU(unidadId), rol, creadoEn: new Date().toISOString() });
    if (cuentaDemo && cuentaDemo.usuario.id === usuarioId) {
      cuentaDemo.solicitudesPendientes.push({ condominioId: CONDO, condominio: condominio.nombre, unidad: etqU(unidadId), rol, creadoEn: new Date().toISOString() });
    }
  },
});

// ---------- Grupos de casas y mensajes masivos ----------
const gruposDemo: GrupoUnidades[] = [
  { id: id(), nombre: 'Calle A · portón', descripcion: 'Casas detrás del portón eléctrico de la calle A', unidadIds: ['u-A11', 'u-A12', 'u-A13', 'u-A14'] },
  { id: id(), nombre: 'Torre B · piso 3', descripcion: 'Apartamentos con la llave del piso 3', unidadIds: ['u-B31', 'u-B32', 'u-B33', 'u-B34'] },
];
const difusionesDemo: Difusion[] = [];
const normal = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
function validarGrupo(g: { nombre: string; unidadIds: string[] }) {
  if (g.nombre.trim().length < 2) throw new Error('Escriba el nombre del grupo');
  if (!g.unidadIds.length) throw new Error('Elija al menos una casa');
  if (g.unidadIds.some((u) => !unidades.some((x) => x.id === u))) throw new Error('Alguna casa no pertenece a este condominio');
}
/** Igual que resolverAlcance() del servidor: lista de casas y nombre legible; todas las casas = todo el condominio. */
function resolverAlcance(a: AlcanceCasas): { tipo: 'todos' | 'unidades'; nombre: string | null; unidadIds: string[] } {
  if (a.tipo === 'todos') return { tipo: 'todos', nombre: null, unidadIds: [] };
  if (a.tipo === 'grupo') {
    const g = gruposDemo.find((x) => x.id === a.grupoId);
    if (!g) throw new Error('Ese grupo no existe');
    if (!g.unidadIds.length) throw new Error('Ese grupo no tiene casas');
    return { tipo: 'unidades', nombre: g.nombre, unidadIds: [...g.unidadIds] };
  }
  const ids = [...new Set(a.unidadIds)];
  if (!ids.length) throw new Error('Elija al menos una casa');
  if (ids.some((u) => !unidades.some((x) => x.id === u))) throw new Error('Alguna casa no pertenece a este condominio');
  if (ids.length === unidades.length) return { tipo: 'todos', nombre: null, unidadIds: [] };
  const et = unidades.filter((u) => ids.includes(u.id)).map((u) => etqU(u.id)!);
  const nombre = a.nombre?.trim() || (ids.length <= 3 ? et.join(', ') : `${et.slice(0, 2).join(', ')} y ${ids.length - 2} casas más`);
  return { tipo: 'unidades', nombre, unidadIds: ids };
}
function unidadesDifusion(a: AlcanceDifusion): string[] {
  switch (a.tipo) {
    case 'todos': return unidades.map((u) => u.id);
    case 'grupo': { const g = gruposDemo.find((x) => x.id === a.grupoId); if (!g) throw new Error('Ese grupo no existe'); return [...g.unidadIds]; }
    case 'unidades': return [...new Set(a.unidadIds)].filter((u) => unidades.some((x) => x.id === u));
    case 'partida':
    case 'sin_votar': {
      const p = partidas.find((x) => x.id === a.partidaId);
      if (!p) throw new Error('Esa cuota especial no existe');
      if (a.tipo === 'partida') return casasDe(p);
      const v = p.votacion;
      if (!v || v.estado !== 'abierta') throw new Error('Esa cuota especial no tiene una votación abierta');
      return casasDe(p).filter((c) => !votos.some((x) => x.votacionId === v.id && x.unidadId === c));
    }
  }
}
function personasDe(casas: string[], soloPropietarios: boolean, excepto: string) {
  return [...new Set(miembrosDemo.filter((m) => m.activo && m.unidadId && casas.includes(m.unidadId) && m.usuarioId !== excepto
    && (!soloPropietarios || m.rol === 'propietario')).map((m) => m.usuarioId))];
}
function enviarDifusion(s: Sesion, d: { titulo: string; cuerpo: string; alcance: AlcanceDifusion; soloPropietarios?: boolean; partidaId?: string }): DifusionEnviada {
  if (difusionesDemo.filter((x) => Date.now() - new Date(x.creadoEn).getTime() < 86_400_000).length >= 20) {
    throw new Error('Límite de 20 mensajes masivos por día alcanzado');
  }
  const casas = unidadesDifusion(d.alcance);
  if (!casas.length) throw new Error('No hay casas en ese alcance');
  const personas = personasDe(casas, !!d.soloPropietarios, s.usuarioId);
  const partidaId = d.alcance.tipo === 'partida' || d.alcance.tipo === 'sin_votar' ? d.alcance.partidaId : d.partidaId ?? null;
  const p = partidaId ? partidas.find((x) => x.id === partidaId) : null;
  const alcanceNombre = d.alcance.tipo === 'todos' ? 'Todo el condominio'
    : d.alcance.tipo === 'grupo' ? gruposDemo.find((g) => g.id === (d.alcance as { grupoId: string }).grupoId)?.nombre ?? 'Grupo'
    : d.alcance.tipo === 'unidades' ? `${casas.length} ${casas.length === 1 ? 'casa elegida' : 'casas elegidas'}`
    : d.alcance.tipo === 'partida' ? (p && incluidas.has(p.id) ? p.alcance.nombre ?? 'Casas de la cuota especial' : 'Todo el condominio')
    : 'Casas que aún no han votado';
  const dif: Difusion = {
    id: id(), titulo: d.titulo.trim(), cuerpo: d.cuerpo.trim(), alcance: d.alcance.tipo, alcanceNombre, partidaId,
    soloPropietarios: !!d.soloPropietarios, unidades: casas.length, personas: personas.length,
    creadoEn: new Date().toISOString(), creadoPor: s.nombre,
  };
  difusionesDemo.push(dif);
  notificar(personas, 'difusion', dif.titulo, dif.cuerpo,
    { difusionId: dif.id, pantalla: partidaId ? 'partidas' : 'avisos', ...(partidaId ? { partidaId } : {}) });
  return { id: dif.id, unidades: casas.length, personas: personas.length };
}

export const demoApi: Api = {
  modo: 'demo',
  sesion: () => sesion,
  cuenta() {
    if (cuentaDemo) return cuentaDemo;
    if (!sesion) return null;
    return {
      usuario: { id: sesion.usuarioId, nombre: sesion.nombre, telefono: null, correo: `${sesion.usuarioId.slice(4)}@demo.zentapro.com`, correoVerificado: true,
                 avisosPorCorreo: avisosPorCorreo.get(sesion.usuarioId) ?? true },
      membresias: [{ condominioId: CONDO, condominio: condominio.nombre, estadoCondominio: 'activo', rol: sesion.rol, unidadId: sesion.unidadId, unidad: sesion.unidad ?? null }],
      solicitudesPendientes: [], rolPlataforma: null,
    };
  },
  async restaurar() { return sesion; },
  async entrar(datos) {
    await espera();
    if ('demoComo' in datos) { cuentaDemo = null; sesion = SESIONES[datos.demoComo]; return sesion; }
    if (cuentaDemo && cuentaDemo.usuario.correo === datos.correo.trim().toLowerCase()) { sesion = sesionDeCuenta(cuentaDemo); return sesion; }
    throw new Error('En la demostración entre con los botones "Soy residente" o "Soy Presidencia", o cree una cuenta nueva.');
  },
  async salir() { sesion = null; alerta.cancelarSimulaciones(); },

  // ---- Cuenta (en la demostración no se envían correos) ----
  async registrar(d) {
    await espera();
    if (d.clave.length < 8) throw new Error('La clave debe tener al menos 8 caracteres');
    cuentaDemo = {
      usuario: { id: `usr-${id()}`, nombre: d.nombre.trim(), telefono: d.telefono ?? null, correo: d.correo.trim().toLowerCase(), correoVerificado: false,
                 avisosPorCorreo: true },
      membresias: [], solicitudesPendientes: [], rolPlataforma: null,
    };
    sesion = null;
  },
  async olvideClave() { await espera(); },
  async restablecerClave(_t, clave) { await espera(); if (clave.length < 8) throw new Error('La clave debe tener al menos 8 caracteres'); },
  async verificarCorreo() { await espera(); if (cuentaDemo) cuentaDemo.usuario.correoVerificado = true; },
  async cambiarClave(_a, nueva) { await espera(); if (nueva.length < 8) throw new Error('La clave debe tener al menos 8 caracteres'); },
  async yo() { const y = demoApi.cuenta(); if (!y) throw new Error('Inicie sesión'); return y; },
  async elegirCondominio(cid) {
    if (cid !== CONDO) throw new Error('No pertenece a ese condominio');
    const s = cuentaDemo ? sesionDeCuenta(cuentaDemo) : sesion;
    if (!s) throw new Error('Aún no pertenece a este condominio');
    sesion = s;
    return s;
  },
  async unirse(codigo) {
    await espera();
    const y = demoApi.cuenta();
    if (!y) throw new Error('Inicie sesión');
    const k = codigosDemo.find((x) => x.codigo === codigo.trim().toUpperCase());
    if (!k || k.usos >= k.usosMax || k.expiraEn < new Date().toISOString()) throw new Error('Código inválido o vencido');
    k.usos++;
    if (k.requiereAprobacion) {
      solicitudesDemo.push({ id: id(), usuarioId: y.usuario.id, usuarioNombre: y.usuario.nombre, unidadId: k.unidadId, unidad: k.unidad, rol: k.rol, creadoEn: new Date().toISOString() });
      if (cuentaDemo) cuentaDemo.solicitudesPendientes.push({ condominioId: CONDO, condominio: condominio.nombre, unidad: k.unidad, rol: k.rol, creadoEn: new Date().toISOString() });
      return 'pendiente';
    }
    agregarMembresia(y.usuario.id, y.usuario.nombre, k.rol, k.unidadId);
    if (cuentaDemo) sesion = sesionDeCuenta(cuentaDemo);
    return 'aprobada';
  },
  async fijarAvisosPorCorreo(activo) {
    const y = demoApi.cuenta();
    if (!y) throw new Error('Inicie sesión');
    avisosPorCorreo.set(y.usuario.id, activo);
    if (cuentaDemo) cuentaDemo.usuario.avisosPorCorreo = activo;
  },

  async notificaciones() {
    const s = exigir();
    const mias = notifs.filter((x) => x.usuarioId === s.usuarioId).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
    return { noLeidas: mias.filter((x) => !x.leida).length, notificaciones: mias.slice(0, 60).map(sinUsuario) };
  },
  async marcarNotificaciones(ids) {
    const s = exigir();
    for (const x of notifs) if (x.usuarioId === s.usuarioId && (!ids || ids.includes(x.id))) x.leida = true;
  },
  suscribirNotificaciones(alRecibir) {
    oyentes.add(alRecibir);
    return () => { oyentes.delete(alRecibir); };
  },

  async activarCondominio(codigo) {
    await espera();
    const y = demoApi.cuenta();
    if (!y) throw new Error('Inicie sesión');
    if (codigo.trim().toUpperCase() !== CODIGO_ACTIVACION) throw new Error('Código de activación inválido');
    agregarMembresia(y.usuario.id, y.usuario.nombre, 'presidente', null);
    if (cuentaDemo) sesion = sesionDeCuenta(cuentaDemo);
    return CONDO;
  },

  async condominio() { return { ...condominio }; },
  async fijarChatVecinos(activo) {
    exigirPresidencia();
    if (condominio.chatVecinos === activo) return;
    condominio.chatVecinos = activo;
    notificar(todosLosMiembros(), 'chat_vecinos',
      activo ? 'Chat entre vecinos activado' : 'Chat entre vecinos desactivado',
      activo ? 'La junta habilitó el chat entre casas. Puede escribirle a otra casa desde el directorio.'
             : 'La junta desactivó el chat entre casas. Sus conversaciones quedan guardadas, pero ya no se pueden enviar mensajes. El chat con la junta sigue igual.',
      { pantalla: 'chat' });
  },
  async cuentasDePago() { return cuentas.filter((c) => c.datosPago); },
  async cuentasFinancieras() { return cuentas; },
  async tasaBcv(fecha) {
    await consultarFuentes();
    const t = tasaPara(fecha);
    // Igual que con servidor: sin internet es un error de red (la app pide conectarse), no una tasa vieja.
    if (!t.usdVes && sinInternet()) throw Object.assign(new Error('Sin conexión a internet. Conéctese para actualizar la tasa BCV de hoy.'), { codigo: 'red' });
    return t;
  },
  async fijarTasaBcv(usdVes, fecha) {
    exigirFinanzas();
    if (!(usdVes > 0) || usdVes > 1e7) throw new Error('Tasa no válida');
    await consultarFuentes(true);
    const resultado = confirmarManual(usdVes, fecha);
    return { resultado, tasa: tasaPara(fecha) };
  },
  async lecturasTasa() { exigir(); await consultarFuentes(); return lecturasActuales(); },
  async avisos() { return [...avisos].sort((a, b) => Number(b.fijado) - Number(a.fijado) || b.creadoEn.localeCompare(a.creadoEn)); },
  async crearAviso(a) {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    if (a.titulo.trim().length < 3 || a.cuerpo.trim().length < 3) throw new Error('Escriba un título y un texto');
    avisos.push({ id: id(), titulo: a.titulo.trim(), cuerpo: a.cuerpo.trim(), fijado: a.fijado, creadoEn: new Date().toISOString() });
  },
  async borrarAviso(aid) {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    const i = avisos.findIndex((a) => a.id === aid);
    if (i >= 0) avisos.splice(i, 1);
  },

  async estadoCuenta(uid) {
    const s = exigir();
    if (!s.esJunta && s.unidadId !== uid) throw new Error('Sin permiso');
    await espera();
    const ap = aplicarUnidad(cargos, pagos, uid);
    return {
      unidad: unidad(uid),
      cargos: cargos.filter((c) => c.unidadId === uid).sort((a, b) => b.periodo.localeCompare(a.periodo)).map((c) => cargoConEstado(c, ap.porCargo)),
      pagos: pagos.filter((p) => p.unidadId === uid).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)).map((p) => pagoConDestinos(p, cargos, ap)),
      saldoUsd: saldoDe(uid).saldoUsd,
    };
  },
  async reportarPago(p) {
    const s = exigir();
    if (!s.manejaFinanzas && s.unidadId !== p.unidadId) throw new Error('Solo puede reportar pagos de su unidad');
    if (p.referencia && pagos.some((x) => x.referencia === p.referencia && x.metodo === p.metodo && x.estado !== 'rechazado'))
      throw new Error('Esa referencia ya fue reportada');
    let t: number | null = null;
    if (p.moneda === 'VES') {
      await consultarFuentes();
      t = tasaPara(p.fechaPago).usdVes;
      if (!t) throw new Error(`La tasa BCV del ${p.fechaPago.split('-').reverse().join('/')} todavía no está verificada. Intente de nuevo en unos minutos.`);
    }
    const ajenas = (p.cargoIds ?? []).filter((cid) => !cargos.some((c) => c.id === cid && c.unidadId === p.unidadId && c.montoUsd > 0));
    if (ajenas.length) throw new Error('Alguna de las deudas elegidas no es de esta casa');
    const nuevoId = id();
    pagos.push({
      id: nuevoId, unidadId: p.unidadId, unidadEtiqueta: etiqueta(unidad(p.unidadId)), fechaPago: p.fechaPago, metodo: p.metodo,
      moneda: p.moneda, monto: p.monto, tasaBcv: t, montoUsd: t ? r2(p.monto / t) : p.monto, referencia: p.referencia || null,
      bancoOrigen: p.bancoOrigen || null, comprobanteUrl: p.comprobante ? URL.createObjectURL(p.comprobante) : null,
      nota: p.nota || null, estado: 'reportado', motivoRechazo: null, creadoEn: new Date().toISOString(),
      cuentaDestinoId: p.cuentaDestinoId ?? null, destinoIds: [...new Set(p.cargoIds ?? [])], revisadoEn: null,
    });
    avisarPagoReportado(pagos.find((x) => x.id === nuevoId)!);
    await espera();
  },

  async panel() {
    exigirFinanzas();
    const saldos = unidades.map((u) => saldoDe(u.id));
    // Saldo por cuenta = saldo inicial + pagos confirmados que entraron − gastos pagados desde ella (en la moneda de la cuenta).
    const cuentasSaldo = cuentas.map((c) => {
      const entra = pagos.filter((p) => p.estado === 'confirmado' && p.cuentaDestinoId === c.id).reduce((s, p) => s + p.monto, 0);
      const sale = gastos.filter((g) => g.cuentaId === c.id).reduce((s, g) => s + g.monto, 0);
      return { nombre: c.nombre, moneda: c.moneda, saldo: r2((saldoInicial[c.id] ?? 0) + entra - sale) };
    });
    return {
      periodo: PERIODO,
      recaudadoMesUsd: r2(pagos.filter((p) => p.estado === 'confirmado' && p.fechaPago >= PERIODO).reduce((s, p) => s + p.montoUsd, 0)),
      facturadoMesUsd: r2(cargos.filter((c) => c.periodo === PERIODO).reduce((s, c) => s + c.montoUsd, 0)),
      gastosMesUsd: r2(gastos.filter((g) => g.periodo === PERIODO).reduce((s, g) => s + g.montoUsd, 0)),
      pagosPorConfirmar: pagos.filter((p) => p.estado === 'reportado').length,
      unidadesMorosas: saldos.filter((s) => s.saldoUsd > 0.009).length,
      totalUnidades: unidades.length,
      deudaTotalUsd: r2(saldos.reduce((s, x) => s + Math.max(0, x.saldoUsd), 0)),
      reportesAbiertos: reportes.filter((r) => !['resuelto', 'descartado'].includes(r.estado)).length,
      saldosCuentas: cuentasSaldo,
    };
  },
  async pagos(filtro, mes) {
    exigirFinanzas(); await espera();
    const fin = mes ? mesSiguiente(mes) : null;
    const aps = new Map(unidades.map((u) => [u.id, aplicarUnidad(cargos, pagos, u.id)]));
    return pagos.filter((p) => (filtro === 'todos' || p.estado === filtro) && (!mes || (p.fechaPago >= mes && p.fechaPago < fin!)))
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)).map((p) => pagoConDestinos(p, cargos, aps.get(p.unidadId)!));
  },
  async confirmarPago(pid, cargoIds) {
    exigirFinanzas();
    const p = pagos.find((x) => x.id === pid)!;
    if (p.estado !== 'reportado') throw new Error('El pago ya fue revisado');
    if (cargoIds) {
      if (cargoIds.some((cid) => !cargos.some((c) => c.id === cid && c.unidadId === p.unidadId && c.montoUsd > 0)))
        throw new Error('Alguna de las deudas elegidas no es de esta casa');
      p.destinoIds = [...new Set(cargoIds)];
    }
    p.estado = 'confirmado'; p.revisadoEn = new Date().toISOString();
    avisarPagoRevisado(p);
  },
  async rechazarPago(pid, motivo) {
    exigirFinanzas();
    if (!motivo.trim()) throw new Error('Indique el motivo del rechazo');
    const p = pagos.find((x) => x.id === pid)!;
    if (p.estado !== 'reportado') throw new Error('El pago ya fue revisado');
    p.estado = 'rechazado'; p.motivoRechazo = motivo;
    avisarPagoRevisado(p);
  },
  async gastos(periodo) { exigir(); return gastos.filter((g) => g.periodo === periodo); },
  async registrarGasto(g) {
    exigirFinanzas();
    if (g.moneda === 'VES' && !g.tasaBcv) throw new Error('Indique la tasa BCV');
    gastos.push({
      id: id(), periodo: g.periodo, tipo: g.tipo, categoria: g.categoria, descripcion: g.descripcion, moneda: g.moneda,
      monto: g.monto, tasaBcv: g.moneda === 'VES' ? g.tasaBcv! : null,
      montoUsd: g.moneda === 'VES' ? r2(g.monto / g.tasaBcv!) : g.monto, fechaGasto: hoy(),
      facturaUrl: g.factura ? URL.createObjectURL(g.factura) : null, unidadId: g.unidadId ?? null, partidaId: g.partidaId ?? null,
      cuentaId: g.cuentaId ?? null,
    });
  },
  async generarRecibos(periodo) { exigirFinanzas(); await espera(); return emitirRecibos(periodo); },
  async unidadesConSaldo() {
    exigir();
    return unidades.map((u) => ({ ...u, ...saldoDe(u.id) }));
  },

  // ---- Reporte y cierre del mes (igual que reporte_mensual / cerrar_mes) ----
  async reporteMensual(periodo) {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    await espera();
    const k = cierresDemo.get(periodo);
    if (k) return { periodo, cerrado: { en: k.en, automatico: k.automatico, por: k.por }, datos: k.datos };
    return { periodo, cerrado: null, datos: reporteDe(periodo) };
  },
  async cerrarMes(periodo) {
    const s = exigirFinanzas();
    if (periodo >= PERIODO) throw new Error('Ese mes todavía no ha terminado: se cierra desde el día 1 del mes siguiente');
    cierresDemo.set(periodo, { en: new Date().toISOString(), automatico: false, por: s.nombre, datos: reporteDe(periodo) });
  },
  async cierres() {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    return [...cierresDemo.entries()].sort((a, b) => b[0].localeCompare(a[0]))
      .map(([periodo, k]) => ({ periodo, cerradoEn: k.en, automatico: k.automatico, por: k.por }));
  },

  // ---- Conciliación bancaria (misma regla que conciliar_movimiento() en SQL) ----
  async movimientosBancarios(soloPendientes) {
    exigirFinanzas(); await espera();
    return movimientosDemo.filter((m) => !soloPendientes || (!m.pagoId && m.monto > 0))
      .map(({ huella: _h, ...m }) => m).sort((a, b) => b.fecha.localeCompare(a.fecha));
  },
  async cargarExtracto(cuentaId, _archivo, movs) {
    exigirFinanzas(); await espera();
    const cuenta = cuentas.find((c) => c.id === cuentaId);
    if (!cuenta) throw new Error('Cuenta no existe');
    let cargados = 0, duplicados = 0, conciliados = 0;
    for (const m of movs) {
      const huella = [cuentaId, m.fecha, m.referencia, m.monto, m.descripcion].join('|');
      if (movimientosDemo.some((x) => x.huella === huella)) { duplicados++; continue; }
      const mov = { id: id(), cuentaId, cuenta: cuenta.nombre, fecha: m.fecha, referencia: m.referencia || null, descripcion: m.descripcion || null,
                    monto: m.monto, moneda: cuenta.moneda, origen: 'extracto' as const, pagoId: null as string | null, unidad: null as string | null, huella };
      movimientosDemo.push(mov); cargados++;
      if (m.monto <= 0 || !refCorta(m.referencia)) continue;
      const candidatos = pagos.filter((p) => p.estado === 'reportado' && (p.cuentaDestinoId === cuentaId || !p.cuentaDestinoId)
        && p.moneda === cuenta.moneda && Math.abs(p.monto - m.monto) <= 0.01
        && refCorta(p.referencia) === refCorta(m.referencia) && diasEntre(p.fechaPago, m.fecha) <= 3);
      if (candidatos.length !== 1) continue;
      const p = candidatos[0];
      p.estado = 'confirmado'; p.cuentaDestinoId = cuentaId; p.revisadoEn = new Date().toISOString();
      avisarPagoRevisado(p);
      mov.pagoId = p.id; mov.unidad = etqU(p.unidadId);
      conciliados++;
    }
    return { cargados, duplicados, conciliados };
  },
  async asignarMovimiento(mid, uid) {
    exigirFinanzas();
    const m = movimientosDemo.find((x) => x.id === mid);
    if (!m) throw new Error('Movimiento no existe');
    if (m.pagoId) throw new Error('Ese movimiento ya está conciliado');
    if (m.monto <= 0) throw new Error('Solo se asignan créditos');
    const t = m.moneda === 'VES' ? tasaPara(m.fecha).usdVes : null;
    if (m.moneda === 'VES' && !t) throw new Error(`La tasa BCV del ${m.fecha.split('-').reverse().join('/')} todavía no está verificada`);
    const pid = id();
    pagos.push({
      id: pid, unidadId: uid, unidadEtiqueta: etiqueta(unidad(uid)), fechaPago: m.fecha, metodo: m.moneda === 'VES' ? 'pago_movil' : 'zelle',
      moneda: m.moneda, monto: m.monto, tasaBcv: t, montoUsd: t ? r2(m.monto / t) : m.monto, referencia: m.referencia, bancoOrigen: null,
      comprobanteUrl: null, nota: 'Asignado desde movimiento bancario', estado: 'confirmado', motivoRechazo: null,
      creadoEn: new Date().toISOString(), cuentaDestinoId: m.cuentaId, revisadoEn: new Date().toISOString(), destinoIds: [],
    });
    m.pagoId = pid; m.unidad = etqU(uid);
    avisarPagoRevisado(pagos.find((x) => x.id === pid)!);
  },

  // ---- Factura de ZentaPro ----
  async facturasZentaPro() {
    exigirFinanzas();
    await consultarFuentes();
    return facturasZP.map((f): FacturaZentaPro => {
      const abonadoUsd = r2(pagosZP.filter((p) => p.facturaId === f.id && p.estado === 'confirmado').reduce((s, p) => s + p.montoUsd, 0));
      const saldoUsd = ['pagada', 'anulada'].includes(f.estado) ? 0 : Math.max(0, r2(f.montoUsd - abonadoUsd));
      const hoyT = tasaPara().usdVes;
      return { ...f, abonadoUsd, saldoUsd, tasaHoy: hoyT, saldoVesHoy: hoyT ? r2(saldoUsd * hoyT) : null,
               pagoPorConfirmar: pagosZP.some((p) => p.facturaId === f.id && p.estado === 'reportado') };
    }).sort((a, b) => b.periodo.localeCompare(a.periodo));
  },
  async datosPagoZentaPro() {
    return { banco: 'Banco de demostración (ficticio)', titular: 'Technical Digital TD, C.A. (demo)', rif: 'J-00000000-0',
             telefonoPagoMovil: '0000-0000000', cuenta: '0000-0000-00-0000000000' };
  },
  async reportarPagoZentaPro(fid, p) {
    exigirFinanzas();
    const f = facturasZP.find((x) => x.id === fid);
    if (!f) throw new Error('Factura no existe');
    if (f.estado === 'pagada') throw new Error('Esa factura ya está pagada');
    if (!['pago_movil', 'transferencia'].includes(p.metodo)) throw new Error('ZentaPro solo recibe pagos en bolívares (Pago Móvil o transferencia)');
    if (!(p.montoVes > 0) || p.referencia.trim().length < 3) throw new Error('Indique el monto en bolívares y la referencia');
    if (p.fechaPago && p.fechaPago > hoy()) throw new Error('La fecha del pago no puede ser futura');
    await consultarFuentes();
    const tz = tasaPara(p.fechaPago ?? hoy()).usdVes;
    if (!tz) throw new Error('La tasa BCV de esa fecha todavía no está verificada. Intente de nuevo en unos minutos.');
    pagosZP.push({ facturaId: fid, referencia: p.referencia.trim(), montoVes: p.montoVes, tasa: tz,
                   montoUsd: r2(p.montoVes / tz), estado: 'reportado' });
    await espera();
  },

  // ---- Accesos de la junta ----
  async miembros() {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    return miembrosDemo.map((m) => ({ ...m, unidad: etqU(m.unidadId) }));
  },
  async cambiarMiembro(uid, c) {
    exigirPresidencia();
    const m = miembrosDemo.find((x) => x.usuarioId === uid);
    if (!m) throw new Error('Miembro no existe');
    const quedaPresidente = miembrosDemo.some((x) => x !== m && x.rol === 'presidente' && x.activo);
    if (m.rol === 'presidente' && ((c.rol && c.rol !== 'presidente') || c.activo === false) && !quedaPresidente) {
      throw new Error('El condominio debe tener al menos un presidente activo');
    }
    if (c.rol) m.rol = c.rol;
    if (c.activo !== undefined) m.activo = c.activo;
  },
  async codigosAcceso() { exigirPresidencia(); return [...codigosDemo]; },
  async generarCodigos(d) {
    exigirPresidencia(); await espera();
    const objetivo = d.todas ? unidades.map((u) => u.id) : d.unidadIds ?? [];
    if (!objetivo.length) throw new Error('Elija al menos una casa');
    const nuevos = objetivo.map((uid) => {
      const u = unidad(uid);
      const sufijo = Array.from({ length: 4 }, () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]).join('');
      const k: CodigoAcceso = { codigo: `${u.bloque ?? ''}${u.numero}-${sufijo}`, unidadId: uid, unidad: etqU(uid), rol: d.rol ?? 'propietario',
                                usos: 0, usosMax: 3, expiraEn: enDias(60), requiereAprobacion: true };
      codigosDemo.push(k);
      return k;
    });
    return nuevos;
  },
  async solicitudes() {
    exigirPresidencia();
    return solicitudesDemo.map(({ usuarioId: _u, ...x }) => x);
  },
  async resolverSolicitud(sid, aprobar) {
    exigirPresidencia();
    const i = solicitudesDemo.findIndex((x) => x.id === sid);
    if (i < 0) throw new Error('Solicitud no disponible');
    const [sol] = solicitudesDemo.splice(i, 1);
    if (aprobar) agregarMembresia(sol.usuarioId, sol.usuarioNombre, sol.rol, sol.unidadId);
    else if (cuentaDemo && cuentaDemo.usuario.id === sol.usuarioId) {
      cuentaDemo.solicitudesPendientes = cuentaDemo.solicitudesPendientes.filter((p) => p.unidad !== sol.unidad);
    }
  },

  async cobroPartida(pid) {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    const aps = new Map(unidades.map((u) => [u.id, aplicarUnidad(cargos, pagos, u.id)]));
    return unidades.flatMap((u) => {
      const cs = cargos.filter((c) => c.partidaId === pid && c.unidadId === u.id && c.montoUsd > 0);
      if (!cs.length) return [];
      const cargado = r2(cs.reduce((x, c) => x + c.montoUsd, 0));
      const pagado = r2(cs.reduce((x, c) => x + (aps.get(u.id)!.porCargo.get(c.id) ?? 0), 0));
      return [{ unidadId: u.id, etiqueta: `Apto ${etiqueta(u)}`, propietario: u.propietario, cargadoUsd: cargado, pagadoUsd: pagado,
                pendienteUsd: r2(Math.max(cargado - pagado, 0)) }];
    }).sort((a, b) => b.pendienteUsd - a.pendienteUsd || a.etiqueta.localeCompare(b.etiqueta));
  },
  async partidas() {
    const s = exigir();
    return partidas.filter((p) => puedeVerPartida(p, s)).map(vistaPartida)
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  },
  async crearPartida(np) {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    await espera();
    const al = resolverAlcance(np.alcance ?? { tipo: 'todos' });
    const pid = id();
    if (al.tipo === 'unidades') incluidas.set(pid, al.unidadIds);
    partidas.push({
      id: pid, titulo: np.titulo, descripcion: np.descripcion, presupuestoUsd: np.presupuestoUsd,
      numeroCuotas: np.numeroCuotas, primeraCuota: np.primeraCuota, reparto: np.reparto,
      estado: np.someterAVotacion ? 'en_votacion' : 'aprobada', creadoEn: new Date().toISOString(), cuotaMiUnidadUsd: null,
      alcance: { tipo: al.tipo, nombre: al.nombre, unidades: al.tipo === 'todos' ? unidades.length : al.unidadIds.length }, meAfecta: false,
      votacion: np.someterAVotacion ? {
        id: id(), titulo: `¿Aprueba: ${np.titulo}?`, ponderacion: np.reparto, umbralPct: np.umbralPct, estado: 'abierta',
        cierraEn: np.cierraEn, miVotoOpcionId: null,
        opciones: [{ id: id(), texto: 'Aprobar', orden: 0, unidades: 0, pesoPct: 0 }, { id: id(), texto: 'Rechazar', orden: 1, unidades: 0, pesoPct: 0 }],
      } : null,
    });
    let difusion: DifusionEnviada | null = null;
    if (np.difundir !== false) {
      const quien = al.tipo === 'todos' ? 'todo el condominio' : (al.nombre ?? 'algunas casas');
      const cuotas = `${np.numeroCuotas} ${np.numeroCuotas === 1 ? 'cuota' : 'cuotas'}`;
      const monto = `$${np.presupuestoUsd.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`;
      const cuerpo = (np.someterAVotacion
        ? `La junta propone la cuota especial "${np.titulo}" por ${monto} en ${cuotas}, para ${quien}. Los propietarios pueden votar desde la app.`
        : `La junta aprobó la cuota especial "${np.titulo}" por ${monto} en ${cuotas}, para ${quien}.`)
        + (np.descripcion ? ` ${np.descripcion.slice(0, 600)}` : '');
      difusion = enviarDifusion(s, {
        titulo: (np.someterAVotacion ? `Votación: ${np.titulo}` : `Cuota especial: ${np.titulo}`).slice(0, 120),
        cuerpo: cuerpo.slice(0, 2000), alcance: { tipo: 'partida', partidaId: pid },
      });
    }
    return { id: pid, difusion };
  },
  async votar(vid, oid) {
    const s = exigir();
    if (s.rol !== 'propietario' || !s.unidadId) throw new Error('Solo el propietario de la unidad puede votar');
    const p = partidas.find((x) => x.votacion?.id === vid);
    if (!p || !puedeVerPartida(p, s)) throw new Error('Votación no existe');
    if (!meIncluye(p, s.unidadId)) throw new Error(`Esta votación es solo para ${p.alcance.nombre ?? 'las casas incluidas'}`);
    if (p.votacion!.estado !== 'abierta') throw new Error('La votación no está abierta');
    if (votos.some((x) => x.votacionId === vid && x.unidadId === s.unidadId)) throw new Error('Su unidad ya votó');
    votos.push({ votacionId: vid, unidadId: s.unidadId, opcionId: oid });
  },
  async cerrarVotacion(vid) {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    const p = partidas.find((x) => x.votacion?.id === vid)!;
    const v = vistaPartida(p).votacion!;
    const aprobada = (v.opciones.find((o) => o.orden === 0)?.pesoPct ?? 0) >= v.umbralPct;
    p.votacion!.estado = 'cerrada';
    p.estado = aprobada ? 'aprobada' : 'rechazada';
    return aprobada;
  },

  async reportes() {
    const s = exigir();
    return reportes
      .filter((r) => s.esJunta || r.visibilidad === 'comunidad' || r.autorPrivado === s.usuarioId)
      .map(({ autorId: _a, autorPrivado, ...r }) => ({ ...r, esMio: autorPrivado === s.usuarioId }))
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  },
  async crearReporte(nr) {
    const s = exigir();
    const hoyN = reportes.filter((r) => r.autorPrivado === s.usuarioId && r.creadoEn.slice(0, 10) === hoy()).length;
    if (hoyN >= 5) throw new Error('Límite de 5 reportes por día alcanzado');
    reportes.push({
      id: id(), categoria: nr.categoria, titulo: nr.titulo, descripcion: nr.descripcion, ubicacion: nr.ubicacion || null,
      anonimo: nr.anonimo, autorId: nr.anonimo ? null : s.usuarioId, autorNombre: nr.anonimo ? null : s.nombre,
      autorPrivado: s.usuarioId, visibilidad: nr.visibilidad, estado: 'nuevo',
      fotos: nr.fotos.map((f) => URL.createObjectURL(f)), creadoEn: new Date().toISOString(), esMio: true,
    });
    await espera();
  },
  async cambiarEstadoReporte(rid, estado, respuesta) {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    reportes.find((r) => r.id === rid)!.estado = estado;
    if (respuesta?.trim()) await demoApi.comentarReporte(rid, respuesta.trim());
  },
  async comentariosReporte(rid) {
    const s = exigir();
    const r = reportes.find((x) => x.id === rid);
    if (!r || !(s.esJunta || r.visibilidad === 'comunidad' || r.autorPrivado === s.usuarioId)) throw new Error('Reporte no existe');
    return (comentariosDemo.get(rid) ?? []).map(({ autorId: _a, ...c }) => c);
  },
  async comentarReporte(rid, texto) {
    const s = exigir();
    const r = reportes.find((x) => x.id === rid);
    if (!r || !(s.esJunta || r.visibilidad === 'comunidad' || r.autorPrivado === s.usuarioId)) throw new Error('Reporte no existe');
    if (!texto.trim()) throw new Error('Escriba un comentario');
    const lista = comentariosDemo.get(rid) ?? [];
    // Si quien comenta es el autor de un reporte anónimo, su nombre tampoco aparece en el comentario.
    const anonimo = r.anonimo && r.autorPrivado === s.usuarioId && !s.esJunta;
    lista.push({ id: id(), autorId: s.usuarioId, autor: s.esJunta ? `Junta · ${s.nombre}` : anonimo ? null : s.nombre,
                 esOficial: s.esJunta, texto: texto.trim(), creadoEn: new Date().toISOString() });
    comentariosDemo.set(rid, lista);
  },

  // ---------------- v0.2 ----------------
  async marca() { exigir(); return { ...marca }; },
  async guardarMarca(c) {
    const s = exigir();
    if (!s.esJunta || !['presidente', 'administrador'].includes(s.rol)) throw new Error('Solo la presidencia o el administrador editan la marca');
    const { logo, fotoEntrada, ...campos } = c;
    if (campos.colorPrimario && !/^#[0-9a-fA-F]{6}$/.test(campos.colorPrimario)) throw new Error('Color inválido');
    Object.assign(marca, campos);
    if (logo) marca.logoUrl = URL.createObjectURL(logo);
    if (fotoEntrada) marca.fotoEntradaUrl = URL.createObjectURL(fotoEntrada);
    await espera();
  },
  async registrarDocumento(d) {
    const s = exigir();
    if (d.tipo === 'solvencia') throw new Error('Use emitirSolvencia()');
    if (!s.esJunta && (!d.unidadId || d.unidadId !== s.unidadId || !['estado_cuenta', 'recibo'].includes(d.tipo)))
      throw new Error('Sin permiso para emitir este documento');
    const codigo = nuevoCodigo();
    documentos.push({ codigo, tipo: d.tipo, unidadId: d.unidadId ?? null, vigenteHasta: null, emitidoEn: new Date().toISOString() });
    return codigo;
  },
  async emitirSolvencia(uid) {
    const s = exigir();
    if (!s.esJunta && s.unidadId !== uid) throw new Error('Sin permiso');
    const saldo = saldoDe(uid).saldoUsd;
    if (saldo > 0.009) throw new Error(`La unidad tiene un saldo pendiente de $${saldo.toFixed(2)}: no se puede emitir la solvencia`);
    const codigo = nuevoCodigo();
    documentos.push({ codigo, tipo: 'solvencia', unidadId: uid, vigenteHasta: finDeMes(), emitidoEn: new Date().toISOString() });
    return codigo;
  },
  async datosActa(vid) {
    const s = exigir();
    if (!s.esJunta) throw new Error('Sin permiso');
    const p = partidas.find((x) => x.votacion?.id === vid);
    if (!p) throw new Error('Votación no existe');
    return unidades.filter((u) => meIncluye(p, u.id)).map((u) => {
      const v = votos.find((x) => x.votacionId === vid && x.unidadId === u.id);
      const op = v ? p.votacion!.opciones.find((o) => o.id === v.opcionId) : null;
      return {
        unidad: etiquetaChat(u), propietario: u.propietario, alicuota: u.alicuota,
        opcion: op?.texto ?? null, emitidoEn: v ? hoy() : null, votante: v ? u.propietario : null,
      };
    });
  },
  directorio: chat.directorio,
  mostrarEnDirectorio: chat.mostrarEnDirectorio,
  conversaciones: chat.conversaciones,
  abrirConCasa: chat.abrirConCasa,
  abrirConJunta: chat.abrirConJunta,
  crearSala: chat.crearSala,
  mensajes: chat.mensajes,
  enviarMensaje: chat.enviarMensaje,
  marcarLeido: chat.marcarLeido,
  suscribirConversacion: chat.suscribirConversacion,
  suscribirBandeja: () => () => {},   // en la demostración la lista de chats se refresca sola cada 3 s
  descargarAdjunto: chat.descargarAdjunto,
  bloquearCasa: chat.bloquearCasa,
  denunciarMensaje: chat.denunciarMensaje,

  configAlerta: alerta.configAlerta,
  fijarParticipacion: alerta.fijarParticipacion,
  configurarRedAlerta: alerta.configurarRedAlerta,
  participantesAlerta: alerta.participantesAlerta,
  suspenderDeAlerta: alerta.suspenderDeAlerta,
  cercania: alerta.cercania,
  fijarCercania: alerta.fijarCercania,

  // ---- Grupos de casas y mensajes masivos (mismas reglas que 0021_alcance_y_difusion.sql) ----
  async unidadesAlcance() {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    return unidades.map((u) => ({ id: u.id, etiqueta: etqU(u.id)!, bloque: u.bloque, ...alerta.ubicacion(u.id), alicuota: u.alicuota }));
  },
  async grupos() {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    return gruposDemo.map((g) => ({ ...g, unidadIds: [...g.unidadIds] })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  },
  async crearGrupo(g) {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    validarGrupo(g);
    if (gruposDemo.some((x) => normal(x.nombre) === normal(g.nombre))) throw new Error('Ya existe un grupo con ese nombre');
    const nuevo: GrupoUnidades = { id: id(), nombre: g.nombre.trim(), descripcion: g.descripcion?.trim() || null, unidadIds: [...new Set(g.unidadIds)] };
    gruposDemo.push(nuevo);
    return { ...nuevo };
  },
  async editarGrupo(gid, g) {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    validarGrupo(g);
    const x = gruposDemo.find((y) => y.id === gid);
    if (!x) throw new Error('Grupo no existe');
    if (gruposDemo.some((y) => y.id !== gid && normal(y.nombre) === normal(g.nombre))) throw new Error('Ya existe un grupo con ese nombre');
    Object.assign(x, { nombre: g.nombre.trim(), descripcion: g.descripcion?.trim() || null, unidadIds: [...new Set(g.unidadIds)] });
    return { ...x };
  },
  async borrarGrupo(gid) {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    const i = gruposDemo.findIndex((y) => y.id === gid);
    if (i < 0) throw new Error('Grupo no existe');
    gruposDemo.splice(i, 1);
  },
  async previaDifusion(alcance, soloPropietarios) {
    const s = exigir(); if (!s.esJunta) throw new Error('Solo la junta envía mensajes masivos');
    const casas = unidadesDifusion(alcance);
    return { unidades: casas.length, personas: personasDe(casas, soloPropietarios, s.usuarioId).length };
  },
  async difundir(d) {
    const s = exigir(); if (!s.esJunta) throw new Error('Solo la junta envía mensajes masivos');
    await espera();
    if (d.titulo.trim().length < 3) throw new Error('Escriba un título');
    if (d.cuerpo.trim().length < 3) throw new Error('Escriba el mensaje');
    return enviarDifusion(s, d);
  },
  async difusiones() {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    return [...difusionesDemo].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  },
  emitirAlerta: alerta.emitirAlerta,
  alertas: alerta.alertas,
  alerta: alerta.alerta,
  marcarAlertaVista: alerta.marcarAlertaVista,
  responderAlerta: alerta.responderAlerta,
  cerrarAlerta: alerta.cerrarAlerta,
  ampliarAlerta: alerta.ampliarAlerta,
  suscribirAlertas: alerta.suscribirAlertas,
  simularAlertaVecino: alerta.simularAlertaVecino,
  async registrarDispositivo() { /* en la demostración no hay notificaciones push */ },
  enlaceInvitacion: alerta.enlaceInvitacion,
  infoInvitacion: alerta.infoInvitacion,
  unirseConEnlace: (c, u, r) => alerta.unirseConEnlace(c, u, r),
};
