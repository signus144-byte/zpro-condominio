// WebSocket /api/v1/tiempo-real?token=<acceso> (CONTRATO_API.md §8).
// Cliente → servidor: {tipo:'suscribir'|'desuscribir', conversacionId} · {tipo:'ping'}
// Servidor → cliente: EventoTiempoReal (+ {tipo:'suscrito'|'error'} como respuesta a suscribir).
// El socket se cierra (código 4001) cuando vence el token de acceso: la app reconecta con uno nuevo.
import type { FastifyInstance } from 'fastify';
import { decodeJwt } from 'jose';
import { z } from 'zod';
import { esHubReal } from './hub.js';

const Entrada = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('suscribir'), conversacionId: z.guid() }),
  z.object({ tipo: z.literal('desuscribir'), conversacionId: z.guid() }),
  z.object({ tipo: z.literal('ping') }),
]);

export default async function rutasTiempoReal(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get('/tiempo-real', { websocket: true }, (socket, req) => {
    const hub = ctx.hub;
    const token = (req.query as { token?: string }).token ?? '';
    // Los mensajes que llegan antes de validar el token esperan a que la conexión quede lista.
    let vence: NodeJS.Timeout | null = null;
    const listo = (async () => {
      let usuarioId: string;
      try { usuarioId = await ctx.firmador.verificarAcceso(token); }
      catch { socket.close(4401, 'Sesión inválida o vencida'); return null; }
      if (!esHubReal(hub)) { socket.close(1011, 'Tiempo real no disponible'); return null; }
      const exp = decodeJwt(token).exp;
      if (exp) { vence = setTimeout(() => socket.close(4001, 'Token vencido: reconecte'), Math.max(0, exp * 1000 - Date.now())); vence.unref(); }
      return hub.conectar(usuarioId, socket);
    })();

    socket.on('message', async (bruto) => {
      const con = await listo;
      if (!con || !esHubReal(hub)) return;
      let m: z.infer<typeof Entrada>;
      try { m = Entrada.parse(JSON.parse(String(bruto))); }
      catch { socket.send(JSON.stringify({ tipo: 'error', mensaje: 'Mensaje inválido' })); return; }
      if (m.tipo === 'ping') { socket.send(JSON.stringify({ tipo: 'pong' })); return; }
      if (m.tipo === 'desuscribir') { con.suscritas.delete(m.conversacionId); return; }
      try {
        const ok = await hub.suscribir(con, m.conversacionId);
        socket.send(JSON.stringify(ok ? { tipo: 'suscrito', conversacionId: m.conversacionId }
                                      : { tipo: 'error', conversacionId: m.conversacionId, mensaje: 'Sin permiso para esa conversación' }));
      } catch {
        socket.send(JSON.stringify({ tipo: 'error', conversacionId: m.conversacionId, mensaje: 'No se pudo suscribir' }));
      }
    });
    socket.on('close', async () => {
      if (vence) clearTimeout(vence);
      const con = await listo;
      if (con && esHubReal(hub)) hub.desconectar(con);
    });
  });
}
