// Consola en producción: servidor propio de ZPro (servidor/, rutas /api/v1/plataforma/*, CONTRATO_API.md §9).
// Sesión: token de acceso (15 min) + token de refresco (rota en cada uso). Ante un 401 se refresca una vez y se reintenta.
import type { ApiConsola } from './api';
import type { SesionConsola } from './tipos';

const CLAVE_SESION = 'zpro-consola-sesion';

interface Tokens { acceso: string; refresco: string }
interface Guardado { tokens: Tokens; sesion: SesionConsola }

const leer = (): Guardado | null => {
  try { const t = localStorage.getItem(CLAVE_SESION); return t ? (JSON.parse(t) as Guardado) : null; } catch { return null; }
};
const guardar = (g: Guardado | null) => {
  try { if (g) localStorage.setItem(CLAVE_SESION, JSON.stringify(g)); else localStorage.removeItem(CLAVE_SESION); } catch { /* sin almacenamiento */ }
};

export function crearConsolaServidor(urlBase: string): ApiConsola {
  const base = urlBase.replace(/\/+$/, '') + '/api/v1';
  let g: Guardado | null = leer();
  let refrescando: Promise<boolean> | null = null;

  async function refrescar(): Promise<boolean> {
    if (!g) return false;
    refrescando ??= (async () => {
      try {
        const r = await fetch(`${base}/auth/refrescar`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresco: g!.tokens.refresco }),
        });
        if (!r.ok) { g = null; guardar(null); return false; }
        const t = await r.json();
        g = { ...g!, tokens: { acceso: t.acceso, refresco: t.refresco } };
        guardar(g);
        return true;
      } catch { return false; }
      finally { setTimeout(() => { refrescando = null; }, 0); }
    })();
    return refrescando;
  }

  async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, reintento = true): Promise<T> {
    const esForm = cuerpo instanceof FormData;
    const r = await fetch(`${base}/${ruta}`, {
      method: metodo,
      headers: {
        ...(g ? { authorization: `Bearer ${g.tokens.acceso}` } : {}),
        ...(cuerpo !== undefined && !esForm ? { 'content-type': 'application/json' } : {}),
      },
      body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
    }).catch(() => { throw new Error('No hay conexión con el servidor'); });
    if (r.status === 401 && reintento && g && (await refrescar())) return pedir<T>(metodo, ruta, cuerpo, false);
    if (r.status === 401 && g) { g = null; guardar(null); }
    if (!r.ok) {
      let msg = `Error ${r.status}`;
      try { msg = (await r.json()).error ?? msg; } catch { /* sin cuerpo */ }
      throw new Error(msg);
    }
    if (r.status === 204) return undefined as T;
    const texto = await r.text();
    return (texto ? JSON.parse(texto) : undefined) as T;
  }

  async function cargarSesion(): Promise<SesionConsola> {
    const yo = await pedir<{ usuario: { id: string; nombre: string }; rolPlataforma: SesionConsola['rol'] | null }>('GET', 'auth/yo');
    if (!yo.rolPlataforma) throw new Error('Este usuario no pertenece al equipo de ZentaPro. Pida acceso al dueño de la plataforma.');
    return { usuarioId: yo.usuario.id, nombre: yo.usuario.nombre, rol: yo.rolPlataforma };
  }

  return {
    modo: 'servidor',
    sesion: () => g?.sesion ?? null,
    async restaurar() {
      if (!g) return null;
      try { g = { ...g, sesion: await cargarSesion() }; guardar(g); return g.sesion; }
      catch { g = null; guardar(null); return null; }
    },
    async entrar(d) {
      if (!('correo' in d)) throw new Error('El modo demo no está disponible con servidor configurado');
      const t = await pedir<{ acceso: string; refresco: string }>('POST', 'auth/entrar', { correo: d.correo, clave: d.clave }, false);
      g = { tokens: { acceso: t.acceso, refresco: t.refresco }, sesion: { usuarioId: '', nombre: '', rol: 'soporte' } };
      try {
        g.sesion = await cargarSesion();
      } catch (e) {
        await pedir('POST', 'auth/salir', { refresco: t.refresco }, false).catch(() => {});
        g = null; guardar(null);
        throw e;
      }
      guardar(g);
      return g.sesion;
    },
    async salir() {
      if (g) await pedir('POST', 'auth/salir', { refresco: g.tokens.refresco }, false).catch(() => {});
      g = null; guardar(null);
    },

    tasaBcv: () => pedir('GET', 'tasa-bcv'),
    fijarTasaBcv: (usdVes) => pedir('POST', 'plataforma/tasa-bcv', { usdVes }),
    planes: () => pedir('GET', 'plataforma/planes'),
    editarPlan: (id, c) => pedir('PATCH', `plataforma/planes/${id}`, c),

    condominios: () => pedir('GET', 'plataforma/condominios'),
    condominio: (id) => pedir('GET', `plataforma/condominios/${id}`),
    cambiarEstado: (id, estado) => pedir('POST', `plataforma/condominios/${id}/estado`, { estado }),
    fijarPrecioEspecial: (id, precioEspecialUsd, nota) => pedir('POST', `plataforma/condominios/${id}/precio`, { precioEspecialUsd, nota: nota ?? null }),
    regenerarCodigoActivacion: async (id) => (await pedir<{ codigo: string }>('POST', `plataforma/condominios/${id}/codigo-activacion`)).codigo,
    generarCodigosUnidades: (id) => pedir('POST', `plataforma/condominios/${id}/codigos-unidades`),
    crearCondominio(n) {
      const f = new FormData();
      const campos: Record<string, string> = {
        nombre: n.nombre, tipo: n.tipo, ciudad: n.ciudad, estadoGeo: n.estadoGeo, direccion: n.direccion, telefono: n.telefono,
        correo: n.correo, nombreAsociacion: n.nombreAsociacion, rif: n.rif, colorPrimario: n.colorPrimario,
        diasPrueba: String(n.diasPrueba), unidades: JSON.stringify(n.unidades),
      };
      for (const [k, v] of Object.entries(campos)) f.append(k, v);
      if (n.logo) f.append('logo', n.logo, n.logo.name);
      if (n.fotoEntrada) f.append('fotoEntrada', n.fotoEntrada, n.fotoEntrada.name);
      return pedir('POST', 'plataforma/condominios', f);
    },

    facturas: (periodo) => pedir('GET', `plataforma/facturas${periodo ? `?periodo=${periodo}` : ''}`),
    emitirFacturasMes: (periodo) => pedir('POST', 'plataforma/facturas/emitir', { periodo }),
    pagos: (filtro) => pedir('GET', `plataforma/pagos?estado=${filtro}`),
    confirmarPago: (id) => pedir('POST', `plataforma/pagos/${id}/confirmar`),
    rechazarPago: (id, motivo) => pedir('POST', `plataforma/pagos/${id}/rechazar`, { motivo }),
    suspenderMorosos: async (diasGracia) => (await pedir<{ suspendidos: number }>('POST', 'plataforma/suspender-morosos', { diasGracia })).suspendidos,

    buscarUsuarios: (texto) => pedir('GET', `plataforma/soporte/usuarios?q=${encodeURIComponent(texto)}`),
    solicitudesPendientes: () => pedir('GET', 'plataforma/soporte/solicitudes'),

    equipo: () => pedir('GET', 'plataforma/equipo'),
    agregarAdmin: (correo, rol) => pedir('POST', 'plataforma/equipo', { correo, rol }),
    cambiarAdmin: (usuarioId, cambios) => pedir('PATCH', `plataforma/equipo/${usuarioId}`, cambios),
  };
}
