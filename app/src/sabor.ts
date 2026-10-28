// Sabor de la app (se fija al compilar con VITE_SABOR):
//  · 'admin'    → ZPro Admin: para la junta (finanzas, accesos, invitar vecinos…).
//  · 'miembros' → ZPro Miembros: para los residentes.
//  · sin valor  → la versión web completa (junta y residentes en la misma app).
export type Sabor = 'admin' | 'miembros' | 'completa';
const v = import.meta.env.VITE_SABOR as string | undefined;
export const SABOR: Sabor = v === 'admin' || v === 'miembros' ? v : 'completa';
export const NOMBRE_APP = SABOR === 'admin' ? 'ZPro Admin' : SABOR === 'miembros' ? 'ZPro Miembros' : 'ZPro Condominio';
export const VERSION = (import.meta.env.VITE_VERSION as string | undefined) ?? '0.5';
export const URL_DESCARGA_MIEMBROS = (import.meta.env.VITE_URL_DESCARGA_MIEMBROS as string | undefined) || null;
export const PUSH_ACTIVO = import.meta.env.VITE_PUSH === 'si';
