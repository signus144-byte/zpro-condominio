import { api } from './data';
import { SABOR } from './sabor';

// ---------- Invitación pendiente (se recuerda mientras la persona entra o crea su cuenta) ----------
const CLAVE_INV = 'zpro.invitacion';
export interface InvitacionPendiente { codigo: string; unidadId: string; rol: 'propietario' | 'inquilino' }
export function invitacionPendiente(): InvitacionPendiente | null {
  try { const v = sessionStorage.getItem(CLAVE_INV) ?? localStorage.getItem(CLAVE_INV); return v ? JSON.parse(v) as InvitacionPendiente : null; }
  catch { return null; }
}
export function guardarInvitacion(p: InvitacionPendiente | null) {
  try {
    if (p) { sessionStorage.setItem(CLAVE_INV, JSON.stringify(p)); localStorage.setItem(CLAVE_INV, JSON.stringify(p)); }
    else { sessionStorage.removeItem(CLAVE_INV); localStorage.removeItem(CLAVE_INV); }
  } catch { /* nada */ }
}

/** Inicio según el sabor: ZPro Admin → panel de la junta; ZPro Miembros → inicio del residente. */
export function inicioDe(s: { esJunta: boolean; unidadId: string | null }): string {
  if (SABOR === 'admin') return s.esJunta ? '/p' : '/solo-junta';
  if (SABOR === 'miembros') return s.unidadId ? '/r' : '/solo-miembros';
  return s.esJunta ? '/p' : '/r';
}

/** A dónde debe ir el usuario según su estado: sin sesión, sin condominio, con varios, o dentro de uno. */
export function destino(): string {
  const s = api.sesion();
  const y = api.cuenta();
  const inv = invitacionPendiente();
  if (y && inv) return `/invitacion/${inv.codigo}`;
  if (s) return inicioDe(s);
  if (!y) return '/entrar';
  const condos = new Set(y.membresias.map((m) => m.condominioId));
  return condos.size > 0 ? '/elegir' : '/unirme';
}
