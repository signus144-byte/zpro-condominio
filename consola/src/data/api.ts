import type {
  AdminPlataforma, CambiosPlan, CodigoUnidad, Condominio, EstadoCondominio, Factura, NuevoCondominio, PagoPlataforma, Plan,
  ResultadoFacturacion, RolPlataforma, SesionConsola, SolicitudIngreso, UsuarioSoporte,
} from './tipos';

// Contrato de datos de la consola. Implementaciones: demo.ts (memoria) y servidor.ts (servidor propio ZPro).
// La consola solo ve datos COMERCIALES y métricas agregadas: nunca chats, pagos de residentes
// ni la autoría de reportes anónimos (lo impide la seguridad por filas del servidor).
export interface ApiConsola {
  readonly modo: 'demo' | 'servidor';

  sesion(): SesionConsola | null;
  restaurar(): Promise<SesionConsola | null>;
  entrar(d: { correo: string; clave: string } | { demo: true }): Promise<SesionConsola>;
  salir(): Promise<void>;

  tasaBcv(): Promise<{ fecha: string; usdVes: number } | null>;
  fijarTasaBcv(usdVes: number): Promise<void>;
  planes(): Promise<Plan[]>;                                  // por tamaño, de menor a mayor
  editarPlan(id: string, c: CambiosPlan): Promise<Plan[]>;    // solo dueño; reubica a todos los condominios

  condominios(): Promise<Condominio[]>;
  condominio(id: string): Promise<Condominio>;
  cambiarEstado(id: string, estado: EstadoCondominio): Promise<void>;
  /** Precio especial negociado (null = vuelve al precio de su plan). Solo dueño y finanzas. */
  fijarPrecioEspecial(id: string, precioUsd: number | null, nota?: string | null): Promise<void>;
  regenerarCodigoActivacion(id: string): Promise<string>;
  generarCodigosUnidades(id: string): Promise<CodigoUnidad[]>;
  crearCondominio(n: NuevoCondominio): Promise<{ id: string; codigoActivacion: string }>;

  facturas(periodo?: string): Promise<Factura[]>;            // sin periodo: todas
  emitirFacturasMes(periodo: string): Promise<ResultadoFacturacion>;
  pagos(filtro: 'reportado' | 'todos'): Promise<PagoPlataforma[]>;
  confirmarPago(id: string): Promise<void>;
  rechazarPago(id: string, motivo: string): Promise<void>;
  suspenderMorosos(diasGracia: number): Promise<number>;

  buscarUsuarios(texto: string): Promise<UsuarioSoporte[]>;
  solicitudesPendientes(): Promise<SolicitudIngreso[]>;

  equipo(): Promise<AdminPlataforma[]>;
  agregarAdmin(correo: string, rol: RolPlataforma): Promise<void>;
  cambiarAdmin(usuarioId: string, cambios: { rol?: RolPlataforma; activo?: boolean }): Promise<void>;
}
