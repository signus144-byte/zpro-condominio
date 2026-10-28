import type { Api } from './api';
import { demoApi } from './demo';
import { crearApiServidor } from './servidor';

// Dirección del servidor propio, en este orden:
//  1. La que se configuró en el teléfono ("Conectar a un servidor", se guarda en el dispositivo).
//  2. VITE_API_URL al compilar (p. ej. https://condominio.zentapro.com en producción).
//  3. Ninguna → MODO DEMO (datos ficticios en memoria).
const CLAVE_SERVIDOR = 'zpro.servidor';
function leerGuardado(): string | null {
  try { return localStorage.getItem(CLAVE_SERVIDOR); } catch { return null; }
}
export const servidorGuardado = leerGuardado();
const url = servidorGuardado || (import.meta.env.VITE_API_URL as string | undefined);
export const urlServidor = url ?? null;

export const api: Api = url ? crearApiServidor(url) : demoApi;

/** Normaliza lo que escribe la persona: agrega http:// y quita la barra final. */
export function normalizarServidor(texto: string) {
  let u = texto.trim();
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '');
}

/** Prueba un servidor (GET /salud) y, si responde, lo guarda y recarga la app. */
export async function conectarServidor(texto: string) {
  const u = normalizarServidor(texto);
  let ok = false;
  try {
    const r = await fetch(`${u}/salud`, { signal: AbortSignal.timeout(8000) });
    ok = r.ok && Boolean(((await r.json()) as { ok?: boolean }).ok);
  } catch { ok = false; }
  if (!ok) throw new Error(`No se pudo conectar con ${u}. Revise la dirección y que el teléfono esté en la misma red.`);
  try { localStorage.setItem(CLAVE_SERVIDOR, u); } catch { throw new Error('Este dispositivo no permite guardar la configuración'); }
  try { await api.salir(); } catch { /* nada */ }
  location.hash = '#/entrar';
  location.reload();
}

/** Vuelve al modo demostración (olvida el servidor configurado en el teléfono). */
export async function volverADemo() {
  try { await api.salir(); } catch { /* nada */ }
  try { localStorage.removeItem(CLAVE_SERVIDOR); } catch { /* nada */ }
  location.hash = '#/entrar';
  location.reload();
}
export * from './tipos';
