// MODO DEMO: datos ficticios en memoria que imitan las reglas del servidor
// (0002_funciones_y_seguridad.sql). Se reinician al recargar la app.
import type { Api } from './api';
import { hoyLocal, mesAnterior, mesSiguiente, periodoActual } from '../formato';
import type {
  Aviso, Cargo, CategoriaReporte, Condominio, CuentaFinanciera, EstadoReporte, Gasto, Marca, Pago,
  Partida, Reporte, Sesion, TipoDocumento, Unidad, Visibilidad,
  CodigoAcceso, ComentarioReporte, FacturaZentaPro, MovimientoBancario, Rol, SolicitudIngresoJunta, Yo,
  Notificacion, TipoNotificacion,
} from './tipos';
import { crearChatDemo, etiquetaChat } from './demoChat';
import { crearAlertaDemo } from './demoAlerta';

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

const tasa = { fecha: hoy(), usdVes: 215.5 };

const gastos: Gasto[] = [];
const cargos: Cargo[] = [];
const pagos: (Pago & { cuentaDestinoId: string | null })[] = [];
const recibosEmitidos = new Set<string>();
const partidas: Partida[] = [];
const votos: { votacionId: string; unidadId: string; opcionId: string }[] = [];
const reportes: (Reporte & { autorId: string | null; autorPrivado: string })[] = [];
const avisos: Aviso[] = [
  { id: id(), titulo: 'Corte de agua programado', cuerpo: 'El sábado de 8:00 a 12:00 se hará mantenimiento al tanque. Guarden agua.', fijado: true, creadoEn: hoy() },
  { id: id(), titulo: 'Asamblea ordinaria', cuerpo: 'Se convocará la asamblea anual. La agenda se publicará en esta sección.', fijado: false, creadoEn: hoy() },
];

function gastoBase(periodo: string, categoria: string, descripcion: string, moneda: 'USD' | 'VES', monto: number) {
  const t = moneda === 'VES' ? tasa.usdVes : null;
  gastos.push({
    id: id(), periodo, tipo: 'comun', categoria, descripcion, moneda, monto, tasaBcv: t,
    montoUsd: t ? r2(monto / t) : monto, fechaGasto: periodo, facturaUrl: null, unidadId: null, partidaId: null,
    cuentaId: moneda === 'VES' ? 'c-bs' : 'c-zelle',
  });
}
for (const p of [ANTERIOR, PERIODO]) {
  gastoBase(p, 'Vigilancia', 'Servicio de vigilancia', 'USD', 600);
  gastoBase(p, 'Conserjería', 'Conserje (sueldo y bono)', 'USD', 250);
  gastoBase(p, 'Electricidad', 'Corpoelec áreas comunes', 'VES', 21550);
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
      const idx = mesesEntre(p.primeraCuota, periodo);
      if (idx < 0 || idx >= p.numeroCuotas) continue;
      cargos.push({ id: id(), unidadId: u.id, periodo, tipo: 'extraordinaria', concepto: `${p.titulo} (cuota ${idx + 1}/${p.numeroCuotas})`, montoUsd: cuotaDe(p, u) });
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
function cuotaDe(p: Pick<Partida, 'presupuestoUsd' | 'numeroCuotas' | 'reparto'>, u: Unidad) {
  return p.reparto === 'alicuota' ? r2(p.presupuestoUsd / p.numeroCuotas * u.alicuota / 100) : r2(p.presupuestoUsd / p.numeroCuotas / unidades.length);
}

// Partida aprobada (ya cobrándose) + partida en votación.
partidas.push({
  id: id(), titulo: 'Impermeabilización techo Bloque A', descripcion: 'Filtraciones en apartamentos del último piso.',
  presupuestoUsd: 2400, numeroCuotas: 4, primeraCuota: ANTERIOR, reparto: 'alicuota', estado: 'en_ejecucion',
  creadoEn: ANTERIOR, votacion: null, cuotaMiUnidadUsd: null,
});
const votPintura = { id: id(), opA: id(), opR: id() };
partidas.push({
  id: id(), titulo: 'Pintura de fachada Bloque B', descripcion: 'Pintura exterior y reparación de grietas. 3 presupuestos recibidos; el más bajo es de $3.000.',
  presupuestoUsd: 3000, numeroCuotas: 3, primeraCuota: mesSiguiente(PERIODO), reparto: 'alicuota', estado: 'en_votacion',
  creadoEn: hoy(), cuotaMiUnidadUsd: null,
  votacion: {
    id: votPintura.id, titulo: '¿Aprueba la pintura de la fachada del Bloque B?', ponderacion: 'alicuota', umbralPct: 50.01,
    estado: 'abierta', cierraEn: null, miVotoOpcionId: null,
    opciones: [
      { id: votPintura.opA, texto: 'Aprobar', orden: 0, unidades: 0, pesoPct: 0 },
      { id: votPintura.opR, texto: 'Rechazar', orden: 1, unidades: 0, pesoPct: 0 },
    ],
  },
});
votos.push({ votacionId: votPintura.id, unidadId: 'u-B31', opcionId: votPintura.opA },
           { votacionId: votPintura.id, unidadId: 'u-A11', opcionId: votPintura.opA },
           { votacionId: votPintura.id, unidadId: 'u-A12', opcionId: votPintura.opR });

emitirRecibos(ANTERIOR);
emitirRecibos(PERIODO);

function pagoDemo(uid: string, fecha: string, metodo: Pago['metodo'], moneda: 'USD' | 'VES', monto: number, ref: string | null, estado: Pago['estado']) {
  const t = moneda === 'VES' ? tasa.usdVes : null;
  pagos.push({
    id: id(), unidadId: uid, unidadEtiqueta: etiqueta(unidad(uid)), fechaPago: fecha, metodo, moneda, monto, tasaBcv: t,
    montoUsd: t ? r2(monto / t) : monto, referencia: ref, bancoOrigen: moneda === 'VES' ? 'Banesco' : null,
    comprobanteUrl: null, nota: null, estado, motivoRechazo: null, creadoEn: fecha,
    cuentaDestinoId: moneda === 'VES' ? 'c-bs' : metodo === 'zelle' ? 'c-zelle' : 'c-caja',
  });
}
// Al día: A-11, A-13, B-31. Parcial: A-14, B-33. Morosos: A-12, B-32, B-34.
for (const uid of ['u-A11', 'u-A13', 'u-B31']) {
  const deuda = cargos.filter((c) => c.unidadId === uid).reduce((s, c) => s + c.montoUsd, 0);
  pagoDemo(uid, ANTERIOR.slice(0, 8) + '04', 'zelle', 'USD', r2(deuda), `ZL${uid.slice(-3)}88`, 'confirmado');
}
for (const uid of ['u-A14', 'u-B33']) {
  const deuda = cargos.filter((c) => c.unidadId === uid && c.periodo === ANTERIOR).reduce((s, c) => s + c.montoUsd, 0);
  pagoDemo(uid, ANTERIOR.slice(0, 8) + '06', 'pago_movil', 'VES', r2(deuda * tasa.usdVes), `0001${uid.slice(-2)}77`, 'confirmado');
}
pagoDemo('u-B32', hoy(), 'pago_movil', 'VES', 21550, '00987654', 'reportado');
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

function vistaPartida(p: Partida): Partida {
  const s = sesion;
  const v = p.votacion;
  const u = s?.unidadId ? unidad(s.unidadId) : null;
  return {
    ...p,
    cuotaMiUnidadUsd: u ? cuotaDe(p, u) : null,
    votacion: v && {
      ...v,
      miVotoOpcionId: u ? votos.find((x) => x.votacionId === v.id && x.unidadId === u.id)?.opcionId ?? null : null,
      opciones: v.opciones.map((o) => {
        const vs = votos.filter((x) => x.votacionId === v.id && x.opcionId === o.id);
        const peso = v.ponderacion === 'alicuota'
          ? vs.reduce((s2, x) => s2 + unidad(x.unidadId).alicuota, 0)
          : 100 * vs.length / unidades.length;
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
  { id: id(), periodo: PERIODO, plan: 'Pequeño', montoUsd: montoZP, tasaBcv: 215.5, montoVes: r2(montoZP * 215.5), vence: PERIODO.slice(0, 8) + '10',
    estado: 'emitida', numeroControl: null, pagadaEn: null },
  { id: id(), periodo: ANTERIOR, plan: 'Pequeño', montoUsd: montoZP, tasaBcv: 205.1, montoVes: r2(montoZP * 205.1), vence: ANTERIOR.slice(0, 8) + '10',
    estado: 'pagada', numeroControl: '00-000123', pagadaEn: ANTERIOR.slice(0, 8) + '08T15:00:00.000Z' },
];
interface PagoZPDemo { facturaId: string; referencia: string; montoVes: number; tasa: number; montoUsd: number; estado: 'reportado' | 'confirmado' }
const pagosZP: PagoZPDemo[] = [
  { facturaId: facturasZP[1].id, referencia: '00445566', montoVes: r2(montoZP * 205.1), tasa: 205.1, montoUsd: montoZP, estado: 'confirmado' },
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
    notificar(usuariosDeUnidad(p.unidadId), 'pago_confirmado', 'Pago aprobado',
      `La junta aprobó su pago de ${textoMonto(p)}${conRef(p.referencia)} del ${p.fechaPago.split('-').reverse().join('/')}. `
        + (saldo > 0.009 ? `Saldo pendiente: $${veF.format(saldo)}.` : 'Está al día.'),
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
  async tasaBcv() { return tasa; },
  async fijarTasaBcv(usdVes) {
    exigirFinanzas();
    if (!(usdVes > 0)) throw new Error('Tasa inválida');
    tasa.usdVes = usdVes; tasa.fecha = hoy();
  },
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
    return {
      unidad: unidad(uid),
      cargos: cargos.filter((c) => c.unidadId === uid).sort((a, b) => b.periodo.localeCompare(a.periodo)),
      pagos: pagos.filter((p) => p.unidadId === uid).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)),
      saldoUsd: saldoDe(uid).saldoUsd,
    };
  },
  async reportarPago(p) {
    const s = exigir();
    if (!s.manejaFinanzas && s.unidadId !== p.unidadId) throw new Error('Solo puede reportar pagos de su unidad');
    if (p.referencia && pagos.some((x) => x.referencia === p.referencia && x.metodo === p.metodo && x.estado !== 'rechazado'))
      throw new Error('Esa referencia ya fue reportada');
    const t = p.moneda === 'VES' ? tasa.usdVes : null;
    const nuevoId = id();
    pagos.push({
      id: nuevoId, unidadId: p.unidadId, unidadEtiqueta: etiqueta(unidad(p.unidadId)), fechaPago: p.fechaPago, metodo: p.metodo,
      moneda: p.moneda, monto: p.monto, tasaBcv: t, montoUsd: t ? r2(p.monto / t) : p.monto, referencia: p.referencia || null,
      bancoOrigen: p.bancoOrigen || null, comprobanteUrl: p.comprobante ? URL.createObjectURL(p.comprobante) : null,
      nota: p.nota || null, estado: 'reportado', motivoRechazo: null, creadoEn: new Date().toISOString(),
      cuentaDestinoId: p.cuentaDestinoId ?? null,
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
  async pagos(filtro) {
    exigirFinanzas(); await espera();
    return pagos.filter((p) => filtro === 'todos' || p.estado === filtro).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  },
  async confirmarPago(pid) {
    exigirFinanzas();
    const p = pagos.find((x) => x.id === pid)!;
    if (p.estado !== 'reportado') throw new Error('El pago ya fue revisado');
    p.estado = 'confirmado';
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
      p.estado = 'confirmado'; p.cuentaDestinoId = cuentaId;
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
    const t = m.moneda === 'VES' ? tasa.usdVes : null;
    const pid = id();
    pagos.push({
      id: pid, unidadId: uid, unidadEtiqueta: etiqueta(unidad(uid)), fechaPago: m.fecha, metodo: m.moneda === 'VES' ? 'pago_movil' : 'zelle',
      moneda: m.moneda, monto: m.monto, tasaBcv: t, montoUsd: t ? r2(m.monto / t) : m.monto, referencia: m.referencia, bancoOrigen: null,
      comprobanteUrl: null, nota: 'Asignado desde movimiento bancario', estado: 'confirmado', motivoRechazo: null,
      creadoEn: new Date().toISOString(), cuentaDestinoId: m.cuentaId,
    });
    m.pagoId = pid; m.unidad = etqU(uid);
    avisarPagoRevisado(pagos.find((x) => x.id === pid)!);
  },

  // ---- Factura de ZentaPro ----
  async facturasZentaPro() {
    exigirFinanzas();
    return facturasZP.map((f): FacturaZentaPro => {
      const abonadoUsd = r2(pagosZP.filter((p) => p.facturaId === f.id && p.estado === 'confirmado').reduce((s, p) => s + p.montoUsd, 0));
      const saldoUsd = ['pagada', 'anulada'].includes(f.estado) ? 0 : Math.max(0, r2(f.montoUsd - abonadoUsd));
      return { ...f, abonadoUsd, saldoUsd, tasaHoy: tasa.usdVes, saldoVesHoy: r2(saldoUsd * tasa.usdVes),
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
    pagosZP.push({ facturaId: fid, referencia: p.referencia.trim(), montoVes: p.montoVes, tasa: tasa.usdVes,
                   montoUsd: r2(p.montoVes / tasa.usdVes), estado: 'reportado' });
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

  async partidas() {
    const s = exigir();
    return partidas.filter((p) => s.esJunta || p.estado !== 'borrador').map(vistaPartida)
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  },
  async crearPartida(np) {
    const s = exigir(); if (!s.esJunta) throw new Error('Sin permiso');
    partidas.push({
      id: id(), titulo: np.titulo, descripcion: np.descripcion, presupuestoUsd: np.presupuestoUsd,
      numeroCuotas: np.numeroCuotas, primeraCuota: np.primeraCuota, reparto: np.reparto,
      estado: np.someterAVotacion ? 'en_votacion' : 'aprobada', creadoEn: new Date().toISOString(), cuotaMiUnidadUsd: null,
      votacion: np.someterAVotacion ? {
        id: id(), titulo: `¿Aprueba: ${np.titulo}?`, ponderacion: np.reparto, umbralPct: np.umbralPct, estado: 'abierta',
        cierraEn: np.cierraEn, miVotoOpcionId: null,
        opciones: [{ id: id(), texto: 'Aprobar', orden: 0, unidades: 0, pesoPct: 0 }, { id: id(), texto: 'Rechazar', orden: 1, unidades: 0, pesoPct: 0 }],
      } : null,
    });
  },
  async votar(vid, oid) {
    const s = exigir();
    if (s.rol !== 'propietario' || !s.unidadId) throw new Error('Solo el propietario de la unidad puede votar');
    const p = partidas.find((x) => x.votacion?.id === vid);
    if (!p || p.votacion!.estado !== 'abierta') throw new Error('La votación no está abierta');
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
    return unidades.map((u) => {
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
