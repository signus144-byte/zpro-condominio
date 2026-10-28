// Piezas compartidas que reciben todas las rutas (inyectadas al construir la app).
import type pg from 'pg';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Almacen } from './archivos/almacen.js';
import type { Firmador } from './auth/tokens.js';
import { comoAnonimo, comoServicio, comoUsuario, comoSistema, type Tx } from './db/conexion.js';
import { ErrorApi } from './util/errores.js';

export interface Correo { para: string; asunto: string; texto: string; html?: string }
export type EnviarCorreo = (c: Correo) => Promise<void>;

/** Avisos en tiempo real hacia los WebSocket conectados (lo implementa src/tiempo-real). */
export interface HubTiempoReal {
  /** Envía un evento a todas las conexiones de esos usuarios. */
  aUsuarios(usuarios: string[], evento: { tipo: string; [k: string]: unknown }): void;
  cerrar(): Promise<void>;
}

export interface Contexto {
  cfg: Config;
  pool: pg.Pool;
  almacen: Almacen;
  firmador: Firmador;
  enviarCorreo: EnviarCorreo;
  hub: HubTiempoReal;
}

declare module 'fastify' {
  interface FastifyInstance { ctx: Contexto }
  interface FastifyRequest { usuarioId: string | null }
}

/** Ejecuta con RLS como el usuario de la petición (exige sesión). */
export function bd<T>(req: FastifyRequest, fn: (c: Tx) => Promise<T>): Promise<T> {
  if (!req.usuarioId) throw new ErrorApi(401, 'Inicie sesión', 'sin_sesion');
  return comoUsuario(req.server.ctx.pool, req.usuarioId, fn);
}
export const bdAnonimo = <T>(req: FastifyRequest, fn: (c: Tx) => Promise<T>) => comoAnonimo(req.server.ctx.pool, fn);
export const bdServicio = <T>(ctx: Contexto, fn: (c: Tx) => Promise<T>) => comoServicio(ctx.pool, fn);
export const bdSistema = <T>(ctx: Contexto, fn: (c: Tx) => Promise<T>) => comoSistema(ctx.pool, fn);

/** preHandler: exige un token de acceso válido. */
export async function requiereSesion(req: FastifyRequest, _rep: FastifyReply) {
  if (!req.usuarioId) throw new ErrorApi(401, 'Inicie sesión', 'sin_sesion');
}

/** Primera fila o 404. */
export function una<T>(filas: T[], que = 'Recurso'): T {
  if (!filas.length) throw new ErrorApi(404, `${que} no existe`, 'no_encontrado');
  return filas[0];
}
