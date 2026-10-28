// MODO DEMO de la consola: datos ficticios en memoria que imitan las reglas de
// servidor/db/migraciones/0004_plataforma.sql y 0016_planes_y_cobro_bs.sql. Se reinician al recargar la página.
import type { ApiConsola } from './api';
import type {
  AdminPlataforma, Condominio, EstadoCondominio, Factura, PagoPlataforma, Plan, SesionConsola,
  SolicitudIngreso, TipoDesarrollo, TipoUnidad, UnidadImport, UsuarioSoporte,
} from './tipos';
import {
  aleatorio, codigoActivacion, etiquetaUnidad, hoy, mesAnterior, ordenarPlanes, periodoActual, periodoDe, planPara, r2, sumarDias,
} from '../formato';

const espera = (ms = 120) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const id = (p: string) => `${p}-${++n}`;

// Planes por tamaño: precio global al mes según la cantidad de unidades. Todos incluyen todo.
const TODO = { chat: true, documentos: true, conciliacion_extracto: true, conciliacion_api: true };
let PLANES: Plan[] = [
  { id: 'pequeno', nombre: 'Pequeño', descripcion: 'Edificios y conjuntos pequeños', precioUsdMes: 40, hastaUnidades: 50, retencionAdjuntosDias: 60, incluye: TODO },
  { id: 'mediano', nombre: 'Mediano', descripcion: 'Conjuntos residenciales medianos', precioUsdMes: 70, hastaUnidades: 150, retencionAdjuntosDias: 60, incluye: TODO },
  { id: 'grande', nombre: 'Grande', descripcion: 'Urbanizaciones grandes', precioUsdMes: 110, hastaUnidades: 300, retencionAdjuntosDias: 60, incluye: TODO },
  { id: 'extra', nombre: 'Extra grande', descripcion: 'Más de 300 unidades', precioUsdMes: 150, hastaUnidades: null, retencionAdjuntosDias: 60, incluye: TODO },
];
const plan = (pid: string | null) => PLANES.find((p) => p.id === pid) ?? null;
/** Mensualidad vigente: precio especial o el del plan (igual que mensualidad_usd en la BD). */
const mensualidad = (c: { planId: string | null; precioEspecialUsd: number | null }) => c.precioEspecialUsd ?? plan(c.planId)?.precioUsdMes ?? null;

let tasa = { fecha: hoy(), usdVes: 215.5 };
const PERIODO = periodoActual();
const P1 = mesAnterior(PERIODO), P2 = mesAnterior(P1), P3 = mesAnterior(P2);
const TASAS: Record<string, number> = { [P3]: 128.4, [P2]: 156.9, [P1]: 187.2, [PERIODO]: 209.8 };

// Logo de demostración: monograma SVG con el color del condominio (no es una marca real).
function logoDemo(nombre: string, color: string) {
  const ini = nombre.replace(/^(Residencias|Conjunto Residencial|Urb\.|Torre|Edificio|Centro Comercial)\s+/i, '')
    .split(/\s+/).filter((p) => !/^(de|del|la|las|los|el)$/i.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="26" fill="${color}"/>` +
    `<text x="60" y="76" font-family="Arial,Helvetica,sans-serif" font-size="44" font-weight="700" fill="#fff" text-anchor="middle">${ini}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

interface CondoInterno extends Condominio { unidadesLista: UnidadImport[] }
const condos: CondoInterno[] = [];

function generarUnidades(tipo: TipoDesarrollo, total: number): UnidadImport[] {
  const t: TipoUnidad = tipo === 'urbanizacion' ? 'casa' : tipo === 'centro_comercial' ? 'local' : 'apartamento';
  const bloques = tipo === 'edificio' ? [null] : tipo === 'urbanizacion' ? [null] : ['A', 'B', 'C', 'D', 'E', 'F'];
  const lista: UnidadImport[] = [];
  for (let i = 0; i < total; i++) {
    const b = bloques[i % bloques.length];
    const num = tipo === 'edificio' ? `${Math.floor(i / 4) + 1}${(i % 4) + 1}` : String(Math.floor(i / bloques.length) + 1);
    lista.push({ bloque: b, numero: num, tipo: t, alicuota: r2(100 / total * 10000) / 10000, propietario: null });
  }
  return lista;
}

type Semilla = [string, TipoDesarrollo, string, string, EstadoCondominio, [number, string] | null, number, number, number, number | null, number];
// nombre, tipo, ciudad, estado, estadoCondominio, precio especial [USD, nota] o null, unidades, usuarios, conApp, morosidad%, meses desde activación (0 = este mes)
// El plan NO se elige: sale de la cantidad de unidades.
const SEMILLAS: Semilla[] = [
  ['Residencias Los Samanes', 'edificio', 'Maracay', 'Aragua', 'activo', null, 48, 61, 39, 22.9, 5],
  ['Conjunto Residencial El Bosque', 'conjunto_residencial', 'Maracay', 'Aragua', 'activo', null, 240, 287, 198, 31.3, 5],
  ['Urb. Villas del Lago', 'urbanizacion', 'Turmero', 'Aragua', 'activo', null, 186, 204, 141, 27.4, 4],
  ['Torre Mirador del Ávila', 'edificio', 'Caracas', 'Distrito Capital', 'activo', null, 96, 118, 87, 12.5, 4],
  ['Residencias Prados del Este', 'edificio', 'Baruta', 'Miranda', 'activo', null, 64, 52, 38, 35.9, 3],
  ['Urb. La Viña', 'urbanizacion', 'Valencia', 'Carabobo', 'suspendido', null, 210, 163, 120, 41.0, 5],
  ['Conjunto Res. Mañongo Country', 'conjunto_residencial', 'Naguanagua', 'Carabobo', 'activo', null, 152, 74, 58, null, 0],
  ['Edificio Las Acacias', 'edificio', 'Valencia', 'Carabobo', 'prueba', null, 32, 19, 15, 18.8, 0],
  ['Urb. San Diego Park', 'urbanizacion', 'San Diego', 'Carabobo', 'prueba', null, 128, 37, 29, null, 0],
  ['Residencias El Parral', 'edificio', 'Valencia', 'Carabobo', 'activo', [30, 'Piloto: primer condominio en Valencia'], 40, 9, 7, 45.0, 3],
  ['Centro Comercial Los Aviadores', 'centro_comercial', 'Maracay', 'Aragua', 'baja', null, 85, 0, 0, null, 6],
  ['Residencias Altamira Suites', 'edificio', 'Chacao', 'Miranda', 'activo', null, 72, 41, 33, null, 0],
];
const COLORES = ['#0f4c4a', '#1f5f8b', '#7a3e9d', '#9a5b00', '#2e7d32', '#b42318', '#00695c', '#37474f', '#5d4037', '#283593', '#455a64', '#6a1b9a'];

SEMILLAS.forEach(([nombre, tipo, ciudad, estadoGeo, estado, especial, unidades, usuarios, conApp, moros, meses], i) => {
  const activ = new Date(PERIODO + 'T12:00:00'); activ.setMonth(activ.getMonth() - meses); activ.setDate(meses === 0 ? 8 + i : 15);
  condos.push({
    id: `condo-${i + 1}`, nombre, tipo, ciudad, estadoGeo, direccion: null, telefono: null, correo: null,
    nombreAsociacion: `Junta de Condominio ${nombre}`, rif: `J-${String(40000000 + i * 731).padStart(8, '0')}-${i % 10}`,
    colorPrimario: COLORES[i], logoUrl: logoDemo(nombre, COLORES[i]), fotoEntradaUrl: null,
    estado, planId: planPara(unidades, PLANES)?.id ?? null,
    precioEspecialUsd: especial?.[0] ?? null, notaPrecio: especial?.[1] ?? null, mensualidadUsd: null,
    pruebaHasta: estado === 'prueba' ? sumarDias(hoy(), 9 + i) : null,
    activadoEn: estado === 'prueba' ? null : activ.toISOString(),
    codigoActivacion: estado === 'prueba' && i === 8 ? codigoActivacion(nombre) : null,
    creadoEn: activ.toISOString(),
    unidades, usuarios, unidadesConApp: conApp, morosidadPct: moros, ultimaFactura: null,
    unidadesLista: generarUnidades(tipo, unidades),
  });
});

// ---------- Facturas de ZentaPro ----------
const facturas: Factura[] = [];
const pagos: PagoPlataforma[] = [];

function crearFactura(c: CondoInterno, periodo: string, estado: Factura['estado'], t = TASAS[periodo] ?? tasa.usdVes): Factura {
  c.planId = planPara(c.unidades, PLANES)?.id ?? c.planId;
  const pl = plan(c.planId)!;
  const monto = mensualidad(c)!;
  const f: Factura = {
    id: id('fac'), condominioId: c.id, condominioNombre: c.nombre, periodo, planId: pl.id,
    unidadesFacturadas: c.unidades, precioEspecial: c.precioEspecialUsd != null, montoUsd: monto, tasaBcv: t, montoVes: r2(monto * t),
    abonadoUsd: 0,
    // Si se emite tarde, el vencimiento no puede quedar en el pasado.
    vence: [sumarDias(periodo, 9), periodo === PERIODO && estado === 'emitida' ? sumarDias(hoy(), 5) : ''].sort().at(-1)!,
    estado, numeroControl: estado === 'pagada' ? `00-${String(1000 + facturas.length).padStart(8, '0')}` : null,
    pagadaEn: estado === 'pagada' ? sumarDias(periodo, 6) : null,
  };
  facturas.push(f);
  return f;
}
const facturable = (c: CondoInterno, periodo: string) =>
  c.activadoEn && periodoDe(new Date(c.activadoEn)) < periodo && ['activo', 'suspendido'].includes(c.estado);

for (const c of condos) {
  for (const p of [P3, P2, P1]) {
    if (!facturable(c, p) && !(c.estado === 'baja' && p === P3)) continue;
    const vencida = c.nombre === 'Urb. La Viña' && p === P1;
    crearFactura(c, p, vencida ? 'vencida' : 'pagada');
  }
  if (!facturable(c, PERIODO)) continue;
  const estadoOct: Record<string, Factura['estado']> = {
    'Urb. Villas del Lago': 'vencida', 'Residencias Prados del Este': 'vencida', 'Urb. La Viña': 'vencida',
  };
  crearFactura(c, PERIODO, estadoOct[c.nombre] ?? 'pagada');
}
// Pagos a ZentaPro: SOLO en bolívares, convertidos a dólares con la tasa BCV del día del pago.
function nuevoPago(f: Factura, montoUsd: number, fechaPago: string, t: number, extra: Partial<PagoPlataforma>): PagoPlataforma {
  const p: PagoPlataforma = {
    id: id('pag'), facturaId: f.id, condominioId: f.condominioId, condominioNombre: f.condominioNombre,
    metodo: 'pago_movil', moneda: 'VES', monto: r2(montoUsd * t), referencia: aleatorio(8).replace(/\D/g, '7').padEnd(8, '3'),
    fechaPago, tasaBcv: t, montoUsd: r2(r2(montoUsd * t) / t), estado: 'confirmado', motivoRechazo: null,
    creadoEn: fechaPago + 'T14:00:00.000Z', reportadoPor: null, ...extra,
  };
  pagos.push(p);
  return p;
}
for (const f of facturas.filter((x) => x.estado === 'pagada')) nuevoPago(f, f.montoUsd, f.pagadaEn!, f.tasaBcv * 1.012, {});
{
  // Villas del Lago pagó tarde, hoy, a la tasa de hoy: falta confirmarlo.
  const f = facturas.find((x) => x.condominioNombre === 'Urb. Villas del Lago' && x.periodo === PERIODO)!;
  nuevoPago(f, f.montoUsd, hoy(), tasa.usdVes, { referencia: '004512887309', estado: 'reportado', creadoEn: new Date().toISOString(), reportadoPor: 'Tesorería Villas del Lago' });
  // La Viña abonó la mitad de la factura vencida (ya confirmada) y reportó otro abono ayer.
  const g = facturas.find((x) => x.condominioNombre === 'Urb. La Viña' && x.periodo === P1)!;
  nuevoPago(g, g.montoUsd / 2, sumarDias(hoy(), -20), 203.4, { metodo: 'transferencia', referencia: '77120011' });
  nuevoPago(g, g.montoUsd / 4, sumarDias(hoy(), -1), 214.9, { metodo: 'transferencia', referencia: '77120034', estado: 'reportado',
    creadoEn: new Date(Date.now() - 86400000).toISOString(), reportadoPor: 'Presidencia La Viña' });
  // Un reporte que no apareció en el banco, rechazado con su motivo.
  const h = facturas.find((x) => x.condominioNombre === 'Residencias Prados del Este' && x.periodo === PERIODO)!;
  nuevoPago(h, h.montoUsd, sumarDias(hoy(), -3), 212.1, { referencia: '55500021', estado: 'rechazado', motivoRechazo: 'No aparece en el estado de cuenta del banco',
    reportadoPor: 'Tesorería Prados del Este' });
}
const abonado = (fid: string) => r2(pagos.filter((x) => x.facturaId === fid && x.estado === 'confirmado').reduce((s, x) => s + (x.montoUsd ?? 0), 0));
const ultimaFactura = (cid: string) =>
  facturas.filter((f) => f.condominioId === cid).sort((a, b) => b.periodo.localeCompare(a.periodo))[0]?.estado ?? null;

// ---------- Soporte y equipo ----------
const USUARIOS: UsuarioSoporte[] = [
  ['María Fernández', 'maria.f@correo.com', [['Residencias Los Samanes', 'presidente', null]]],
  ['Elena Castro', 'elena.castro@correo.com', [['Residencias Los Samanes', 'propietario', 'Apto 33']]],
  ['José Blanco', 'jblanco@correo.com', [['Conjunto Residencial El Bosque', 'tesorero', null], ['Conjunto Residencial El Bosque', 'propietario', 'Apto C-12']]],
  ['Rosa Herrera', 'rosah@correo.com', [['Urb. Villas del Lago', 'propietario', 'Casa 28']]],
  ['Carlos Rivas', 'crivas@correo.com', [['Urb. Villas del Lago', 'presidente', null]]],
  ['Ana Gómez', 'ana.gomez@correo.com', [['Torre Mirador del Ávila', 'administrador', null]]],
  ['Luis Medina', 'lmedina@correo.com', [['Urb. La Viña', 'presidente', null], ['Urb. La Viña', 'propietario', 'Casa 44']]],
].map(([nombre, correo, cs], i) => ({
  usuarioId: `usr-${i + 1}`, nombre: nombre as string, correo: correo as string,
  condominios: (cs as [string, string, string | null][]).map(([c, rol, unidad]) => ({ nombre: c, rol, unidad })),
}));

const solicitudes: SolicitudIngreso[] = [
  ['Conjunto Res. Mañongo Country', 'Pedro Salas', 'Apto B-34', 'propietario', 0],
  ['Conjunto Res. Mañongo Country', 'Gabriela Rondón', 'Apto D-7', 'inquilino', 1],
  ['Urb. Villas del Lago', 'Daniel Ochoa', 'Casa 112', 'propietario', 2],
  ['Residencias El Parral', 'Yolimar Pacheco', 'Apto 31', 'propietario', 6],
  ['Residencias El Parral', 'Héctor Lugo', 'Apto 22', 'propietario', 9],
].map(([c, u, unidad, rol, dias], i) => ({
  id: `sol-${i + 1}`, condominioId: condos.find((x) => x.nombre === c)!.id, condominioNombre: c as string,
  usuarioNombre: u as string, unidad: unidad as string, rol: rol as string,
  creadoEn: new Date(Date.now() - (dias as number) * 86400000).toISOString(),
}));

const equipo: AdminPlataforma[] = [
  { usuarioId: 'zp-1', nombre: 'Leandro Romero', correo: null, rol: 'dueno', activo: true },
  { usuarioId: 'zp-2', nombre: 'Jorge Hoyos', correo: null, rol: 'dueno', activo: true },
  { usuarioId: 'zp-3', nombre: 'Soporte ZentaPro', correo: 'soporte@zentapro.com', rol: 'soporte', activo: true },
];

let sesion: SesionConsola | null = null;
const exigir = (roles?: SesionConsola['rol'][]) => {
  if (!sesion) throw new Error('Inicie sesión');
  if (roles && !roles.includes(sesion.rol)) throw new Error('Su rol no permite esta acción');
  return sesion;
};
const buscarCondo = (cid: string) => { const c = condos.find((x) => x.id === cid); if (!c) throw new Error('Condominio no existe'); return c; };
const vista = ({ unidadesLista: _u, ...c }: CondoInterno): Condominio => ({ ...c, mensualidadUsd: mensualidad(c), ultimaFactura: ultimaFactura(c.id) });
const reubicar = () => { for (const c of condos) c.planId = planPara(c.unidades, PLANES)?.id ?? c.planId; };

export const demoConsola: ApiConsola = {
  modo: 'demo',
  sesion: () => sesion,
  async restaurar() { return sesion; },
  async entrar() { await espera(); sesion = { usuarioId: 'zp-1', nombre: 'ZentaPro', rol: 'dueno' }; return sesion; },
  async salir() { sesion = null; },

  async tasaBcv() { return tasa; },
  async fijarTasaBcv(v) {
    exigir(['dueno', 'finanzas']);
    if (!(v > 0)) throw new Error('Tasa no válida');
    tasa = { fecha: hoy(), usdVes: v };
  },
  async planes() { exigir(); return ordenarPlanes(PLANES); },
  async editarPlan(pid, cambios) {
    exigir(['dueno']);
    await espera();
    const actual = plan(pid);
    if (!actual) throw new Error('Plan no existe');
    if (cambios.nombre !== undefined && cambios.nombre.trim().length < 2) throw new Error('Nombre muy corto');
    if (cambios.precioUsdMes !== undefined && !(cambios.precioUsdMes > 0)) throw new Error('El precio debe ser mayor que cero');
    if (cambios.hastaUnidades != null && !(Number.isInteger(cambios.hastaUnidades) && cambios.hastaUnidades > 0)) throw new Error('Tope de unidades no válido');
    const nuevos = PLANES.map((p) => (p.id === pid ? { ...p, ...cambios, nombre: cambios.nombre?.trim() ?? p.nombre } : p));
    if (nuevos.filter((p) => p.hastaUnidades == null).length !== 1) throw new Error('Debe quedar exactamente un plan "sin límite" de unidades (el más grande)');
    PLANES = nuevos;
    reubicar();
    return ordenarPlanes(PLANES);
  },

  async condominios() { exigir(); await espera(); return condos.map(vista); },
  async condominio(cid) { exigir(); return vista(buscarCondo(cid)); },
  async cambiarEstado(cid, estado) {
    exigir(['dueno', 'soporte']);
    const c = buscarCondo(cid);
    if (c.estado === 'baja' && estado !== 'activo') throw new Error('Un condominio de baja solo se puede reactivar');
    c.estado = estado;
    if (estado === 'activo' && !c.activadoEn) c.activadoEn = new Date().toISOString();
  },
  async fijarPrecioEspecial(cid, precio, nota) {
    exigir(['dueno', 'finanzas']);
    if (precio !== null && !(precio > 0)) throw new Error('El precio debe ser mayor que cero');
    const c = buscarCondo(cid);
    c.precioEspecialUsd = precio;
    c.notaPrecio = precio === null ? null : (nota?.trim() || null);
  },
  async regenerarCodigoActivacion(cid) {
    exigir(['dueno', 'soporte']);
    const c = buscarCondo(cid);
    c.codigoActivacion = codigoActivacion(c.nombre);
    return c.codigoActivacion;
  },
  async generarCodigosUnidades(cid) {
    exigir(['dueno', 'soporte']);
    const c = buscarCondo(cid);
    const expira = sumarDias(hoy(), 60);
    return c.unidadesLista.map((u) => ({
      unidad: etiquetaUnidad(u), propietario: u.propietario,
      codigo: `${(u.bloque ?? '') + u.numero}`.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 5) + '-' + aleatorio(4),
      expiraEn: expira,
    }));
  },
  async crearCondominio(nc) {
    exigir(['dueno', 'soporte']);
    await espera(300);
    if (!nc.nombre.trim()) throw new Error('Indique el nombre');
    if (!nc.unidades.length) throw new Error('Importe las unidades');
    const suma = nc.unidades.reduce((s, u) => s + u.alicuota, 0);
    if (Math.abs(suma - 100) > 0.01) throw new Error('Las alícuotas deben sumar 100 %');
    const codigo = codigoActivacion(nc.nombre);
    const c: CondoInterno = {
      id: id('condo'), nombre: nc.nombre.trim(), tipo: nc.tipo, ciudad: nc.ciudad || null, estadoGeo: nc.estadoGeo || null,
      direccion: nc.direccion || null, telefono: nc.telefono || null, correo: nc.correo || null,
      nombreAsociacion: nc.nombreAsociacion || null, rif: nc.rif || null, colorPrimario: nc.colorPrimario,
      logoUrl: nc.logo ? URL.createObjectURL(nc.logo) : logoDemo(nc.nombre, nc.colorPrimario),
      fotoEntradaUrl: nc.fotoEntrada ? URL.createObjectURL(nc.fotoEntrada) : null,
      estado: 'prueba', planId: planPara(nc.unidades.length, PLANES)?.id ?? null,
      precioEspecialUsd: null, notaPrecio: null, mensualidadUsd: null, pruebaHasta: sumarDias(hoy(), nc.diasPrueba), activadoEn: null,
      codigoActivacion: codigo, creadoEn: new Date().toISOString(),
      unidades: nc.unidades.length, usuarios: 0, unidadesConApp: 0, morosidadPct: null, ultimaFactura: null,
      unidadesLista: nc.unidades,
    };
    condos.unshift(c);
    return { id: c.id, codigoActivacion: codigo };
  },

  async facturas(periodo) {
    exigir(); await espera();
    return facturas.filter((f) => !periodo || f.periodo === periodo).map((f) => ({ ...f, abonadoUsd: abonado(f.id) })).sort((a, b) => a.condominioNombre.localeCompare(b.condominioNombre));
  },
  async emitirFacturasMes(periodo) {
    exigir(['dueno', 'finanzas']);
    await espera(300);
    let emitidas = 0, yaExistian = 0;
    const omitidas: { condominio: string; motivo: string }[] = [];
    for (const c of condos) {
      if (c.estado !== 'activo') {
        omitidas.push({ condominio: c.nombre, motivo: c.estado === 'prueba' ? `en prueba hasta ${c.pruebaHasta}` : c.estado === 'baja' ? 'de baja' : 'suspendido (se cobra la deuda pendiente)' });
        continue;
      }
      if (facturas.some((f) => f.condominioId === c.id && f.periodo === periodo)) { yaExistian++; continue; }
      crearFactura(c, periodo, 'emitida', tasa.usdVes);
      emitidas++;
    }
    return { emitidas, yaExistian, omitidas };
  },
  async pagos(filtro) {
    exigir();
    return pagos.filter((p) => filtro === 'todos' || p.estado === filtro).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  },
  async confirmarPago(pid) {
    exigir(['dueno', 'finanzas']);
    const p = pagos.find((x) => x.id === pid)!;
    if (p.estado !== 'reportado') throw new Error('Pago ya revisado');
    p.estado = 'confirmado';
    const f = facturas.find((x) => x.id === p.facturaId)!;
    // La factura queda pagada cuando los abonos (en dólares, a la tasa del día de cada pago) cubren el monto.
    if (abonado(f.id) >= f.montoUsd - 0.01) {
      f.estado = 'pagada'; f.pagadaEn = new Date().toISOString();
      const c = buscarCondo(f.condominioId);
      // Igual que en el servidor: si ya no debe nada, se reactiva solo.
      if (c.estado === 'suspendido' && !facturas.some((x) => x.condominioId === c.id && x.estado === 'vencida')) c.estado = 'activo';
    }
  },
  async rechazarPago(pid, motivo) {
    exigir(['dueno', 'finanzas']);
    if (motivo.trim().length < 3) throw new Error('Indique el motivo del rechazo');
    const p = pagos.find((x) => x.id === pid);
    if (!p || p.estado !== 'reportado') throw new Error('Pago no existe o ya fue revisado');
    p.estado = 'rechazado'; p.motivoRechazo = motivo.trim();
  },
  async suspenderMorosos(dias) {
    exigir(['dueno', 'finanzas']);
    const limite = sumarDias(hoy(), -dias);
    facturas.filter((f) => f.estado === 'emitida' && f.vence < hoy()).forEach((f) => { f.estado = 'vencida'; });
    let k = 0;
    for (const c of condos.filter((x) => x.estado === 'activo')) {
      if (facturas.some((f) => f.condominioId === c.id && f.estado === 'vencida' && f.vence < limite)) { c.estado = 'suspendido'; k++; }
    }
    return k;
  },

  async buscarUsuarios(texto) {
    exigir();
    const q = texto.trim().toLowerCase();
    if (q.length < 2) return [];
    return USUARIOS.filter((u) => u.nombre.toLowerCase().includes(q) || (u.correo ?? '').includes(q)
      || u.condominios.some((c) => c.nombre.toLowerCase().includes(q)));
  },
  async solicitudesPendientes() { exigir(); return solicitudes; },

  async equipo() { exigir(); return equipo; },
  async agregarAdmin(correo, rol) {
    exigir(['dueno']);
    if (!/^\S+@\S+\.\S+$/.test(correo)) throw new Error('Correo no válido');
    if (equipo.some((a) => a.correo === correo)) throw new Error('Ya es parte del equipo');
    equipo.push({ usuarioId: id('zp'), nombre: correo.split('@')[0], correo, rol, activo: true });
  },
  async cambiarAdmin(uid, cambios) {
    const s = exigir(['dueno']);
    const a = equipo.find((x) => x.usuarioId === uid)!;
    if (uid === s.usuarioId && (cambios.activo === false || (cambios.rol && cambios.rol !== 'dueno'))) throw new Error('No puede quitarse su propio acceso de dueño');
    Object.assign(a, cambios);
  },
};
