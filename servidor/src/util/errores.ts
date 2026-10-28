// Traduce errores de PostgreSQL y de validación a respuestas HTTP claras en español.
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class ErrorApi extends Error {
  constructor(public estado: number, mensaje: string, public codigo = 'error') { super(mensaje); }
}
export const noEncontrado = (que = 'Recurso') => new ErrorApi(404, `${que} no existe`, 'no_encontrado');
export const sinPermiso = (m = 'Sin permiso') => new ErrorApi(403, m, 'sin_permiso');
export const solicitudInvalida = (m: string) => new ErrorApi(400, m, 'invalido');

interface ErrorPg { code?: string; message: string; constraint?: string }

export function manejarError(e: unknown, req: FastifyRequest, rep: FastifyReply) {
  if (e instanceof ErrorApi) return rep.status(e.estado).send({ error: e.message, codigo: e.codigo });
  if (e instanceof ZodError) {
    return rep.status(400).send({
      error: 'Datos inválidos: ' + e.issues.map((i) => `${i.path.join('.') || 'cuerpo'} ${i.message}`).join('; '),
      codigo: 'invalido',
    });
  }
  const f = e as FastifyError & ErrorPg;
  if (f.statusCode && f.statusCode < 500) return rep.status(f.statusCode).send({ error: f.message, codigo: f.code ?? 'error' });
  switch (f.code) {
    case 'P0001':   // raise exception de nuestras funciones: mensaje pensado para el usuario
      return rep.status(/^(Sin permiso|Solo )/.test(f.message) ? 403 : 400).send({ error: f.message, codigo: 'regla' });
    case '42501':   // RLS o falta de privilegio
      return rep.status(403).send({ error: 'Sin permiso', codigo: 'sin_permiso' });
    case '23505':
      return rep.status(409).send({ error: mensajeUnico(f.constraint), codigo: 'duplicado' });
    case '23503': case '23514': case '22P02': case '22007': case '22003': case '23502':
      return rep.status(400).send({ error: 'Datos inválidos', codigo: 'invalido' });
  }
  req.log.error(e);
  return rep.status(500).send({ error: 'Error interno del servidor', codigo: 'interno' });
}

function mensajeUnico(c?: string) {
  if (!c) return 'Ya existe';
  if (c.includes('referencia')) return 'Esa referencia ya fue reportada';
  if (c.includes('votos')) return 'Su unidad ya votó';
  if (c.includes('email')) return 'Ese correo ya tiene una cuenta';
  if (c.includes('recibos')) return 'Los recibos de ese mes ya fueron emitidos';
  return 'Ya existe';
}
