import type { ApiConsola } from './api';
import { demoConsola } from './demo';
import { crearConsolaServidor } from './servidor';

// Dirección del servidor propio de ZPro (p. ej. http://localhost:3000). Sin ella → MODO DEMO.
const url = import.meta.env.VITE_API_URL as string | undefined;

export const api: ApiConsola = url ? crearConsolaServidor(url) : demoConsola;
export * from './tipos';
