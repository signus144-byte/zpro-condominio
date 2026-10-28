// Tipos de la consola master (plataforma ZentaPro), compartidos con el servidor.

export type EstadoCondominio = 'prueba' | 'activo' | 'suspendido' | 'baja';
export type TipoDesarrollo = 'edificio' | 'conjunto_residencial' | 'urbanizacion' | 'centro_comercial';
export type TipoUnidad = 'apartamento' | 'casa' | 'local' | 'oficina' | 'townhouse';
export type RolPlataforma = 'dueno' | 'soporte' | 'finanzas';
export type EstadoFactura = 'emitida' | 'pagada' | 'vencida' | 'anulada';
export type MetodoPago = 'pago_movil' | 'transferencia' | 'zelle' | 'efectivo_usd' | 'efectivo_bs' | 'usdt' | 'otro';

export interface SesionConsola { usuarioId: string; nombre: string; rol: RolPlataforma }

/** Plan por tamaño: precio global al mes según la cantidad de unidades (todos incluyen todo). */
export interface Plan {
  id: string; nombre: string; descripcion: string | null;
  precioUsdMes: number;
  hastaUnidades: number | null;      // tope de unidades; null = sin límite
  retencionAdjuntosDias: number; incluye: Record<string, boolean>;
}
export interface CambiosPlan { nombre?: string; descripcion?: string | null; precioUsdMes?: number; hastaUnidades?: number | null }

export interface Condominio {
  id: string; nombre: string; tipo: TipoDesarrollo;
  ciudad: string | null; estadoGeo: string | null; direccion: string | null;
  telefono: string | null; correo: string | null;
  nombreAsociacion: string | null; rif: string | null; colorPrimario: string;
  logoUrl: string | null; fotoEntradaUrl: string | null;
  estado: EstadoCondominio; planId: string | null;
  precioEspecialUsd: number | null; notaPrecio: string | null;
  mensualidadUsd: number | null;     // la del plan, o el precio especial si lo hay
  pruebaHasta: string | null; activadoEn: string | null; codigoActivacion: string | null;
  creadoEn: string;
  // Métricas agregadas (metricas_plataforma): nunca datos personales
  unidades: number; usuarios: number; unidadesConApp: number;
  morosidadPct: number | null;       // % de unidades con saldo pendiente en su condominio
  ultimaFactura: EstadoFactura | null;
}

export interface Factura {
  id: string; condominioId: string; condominioNombre: string; periodo: string; planId: string;
  unidadesFacturadas: number; precioEspecial: boolean;
  montoUsd: number;
  tasaBcv: number; montoVes: number;  // referencia en Bs a la tasa del día de emisión
  abonadoUsd: number;                // pagos confirmados, convertidos a la tasa del día de cada pago
  vence: string; estado: EstadoFactura; numeroControl: string | null; pagadaEn: string | null;
}

export interface PagoPlataforma {
  id: string; facturaId: string; condominioId: string; condominioNombre: string;
  metodo: MetodoPago; moneda: 'USD' | 'VES'; monto: number; referencia: string | null;
  fechaPago: string; tasaBcv: number | null; montoUsd: number | null;   // equivalente a la tasa BCV del día del pago
  estado: 'reportado' | 'confirmado' | 'rechazado'; motivoRechazo: string | null;
  creadoEn: string; reportadoPor: string | null;
}

export interface SolicitudIngreso {
  id: string; condominioId: string; condominioNombre: string; usuarioNombre: string;
  unidad: string | null; rol: string; creadoEn: string;
}

export interface UsuarioSoporte {
  usuarioId: string; nombre: string; correo: string | null;
  condominios: { nombre: string; rol: string; unidad: string | null }[];
}

export interface AdminPlataforma { usuarioId: string; nombre: string; correo: string | null; rol: RolPlataforma; activo: boolean }

export interface UnidadImport { bloque: string | null; numero: string; tipo: TipoUnidad; alicuota: number; propietario: string | null }

export interface NuevoCondominio {
  nombre: string; tipo: TipoDesarrollo; ciudad: string; estadoGeo: string; direccion: string;
  telefono: string; correo: string; nombreAsociacion: string; rif: string; colorPrimario: string;
  logo: File | null; fotoEntrada: File | null;
  unidades: UnidadImport[]; diasPrueba: number;   // el plan se asigna solo según la cantidad de unidades
}

export interface CodigoUnidad { unidad: string; propietario: string | null; codigo: string; expiraEn: string }

export interface ResultadoFacturacion { emitidas: number; yaExistian: number; omitidas: { condominio: string; motivo: string }[] }
