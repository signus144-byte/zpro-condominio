// Bandeja de notificaciones de cada persona (avisos de pagos, recordatorios a la junta, chat entre vecinos).
// Las crea la base de datos (disparadores y tarea diaria); aquí solo se leen y se marcan como leídas.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BandejaNotificaciones } from '../../../compartido/tipos.js';
import { bd, requiereSesion } from '../contexto.js';
import { aNotificacion } from '../tiempo-real/hub.js';

export default async function rutasNotificaciones(app: FastifyInstance) {
  app.get('/notificaciones', { preHandler: requiereSesion }, async (req): Promise<BandejaNotificaciones> => {
    const q = z.object({
      condominioId: z.guid().optional(),
      limite: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);
    return bd(req, async (c) => {
      const filtro = q.condominioId ? 'and (condominio_id = $2 or condominio_id is null)' : '';
      const params: unknown[] = q.condominioId ? [q.limite, q.condominioId] : [q.limite];
      const filas = (await c.query(`select * from notificaciones where usuario_id = auth.uid() ${filtro}
                                     order by creado_en desc limit $1`, params)).rows;
      const n = (await c.query(`select count(*)::int as n from notificaciones where usuario_id = auth.uid() and leida_en is null ${filtro.replace('$2', '$1')}`,
        q.condominioId ? [q.condominioId] : [])).rows[0].n as number;
      return { noLeidas: n, notificaciones: filas.map(aNotificacion) };
    });
  });

  // Marca como leídas las indicadas (o todas si no se indica ninguna).
  app.post('/notificaciones/leidas', { preHandler: requiereSesion }, async (req) => {
    const d = z.object({ ids: z.array(z.guid()).max(500).optional() }).parse(req.body ?? {});
    const r = await bd(req, (c) => c.query(`select marcar_notificaciones($1::uuid[]) as n`, [d.ids ?? null]));
    return { marcadas: Number(r.rows[0].n) };
  });
}
