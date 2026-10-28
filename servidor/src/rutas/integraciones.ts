// Integraciones externas (CONTRATO_API.md §10).
// POST /api/v1/webhooks/banco?t=<webhook_token>: el banco o agregador avisa un crédito recibido.
// Cada proveedor firma distinto: un "adaptador" por proveedor valida la firma y normaliza el movimiento.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { bdServicio } from '../contexto.js';
import { ErrorApi } from '../util/errores.js';

interface Movimiento { fecha: string; referencia: string; monto: number; descripcion: string | null }
type Adaptador = (req: FastifyRequest, cuerpo: string, secreto: string) => Movimiento;

const MovGenerico = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), referencia: z.coerce.string().trim().min(1).max(60),
  monto: z.coerce.number().positive(), descripcion: z.string().max(300).nullish(),
});

const ADAPTADORES: Record<string, Adaptador> = {
  // Genérico: JSON {fecha, referencia, monto, descripcion} y HMAC-SHA256 (hex) del cuerpo en la cabecera x-firma.
  generico(req, cuerpo, secreto) {
    const esperada = createHmac('sha256', secreto).update(cuerpo).digest();
    const recibida = Buffer.from(String(req.headers['x-firma'] ?? ''), 'hex');
    if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) throw new ErrorApi(401, 'Firma inválida', 'firma');
    let datos: unknown;
    try { datos = JSON.parse(cuerpo); } catch { throw new ErrorApi(400, 'JSON inválido', 'invalido'); }
    const m = MovGenerico.parse(datos);
    return { fecha: m.fecha, referencia: m.referencia, monto: m.monto, descripcion: m.descripcion ?? null };
  },
  // pabilo, mercantil, banco_venezuela, activo: se agregan al firmar contrato con cada uno (formato y firma propios).
};

export default async function rutasIntegraciones(app: FastifyInstance) {
  const ctx = app.ctx;
  // En este módulo el cuerpo se recibe como texto: la firma se calcula sobre los bytes exactos que envió el banco.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, cuerpo, listo) => listo(null, cuerpo));

  app.post('/webhooks/banco', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const token = z.object({ t: z.string().min(16).max(80) }).parse(req.query).t;
    const cx = (await bdServicio(ctx, (c) => c.query(
      `select x.*, cf.moneda from conexiones_bancarias x join cuentas_financieras cf on cf.id = x.cuenta_id
        where x.webhook_token = $1 and x.activa`, [token]))).rows[0];
    if (!cx) throw new ErrorApi(404, 'Conexión desconocida', 'no_encontrado');

    let secretos: Record<string, string> = {};
    try { secretos = JSON.parse(ctx.cfg.SECRETOS_BANCOS); } catch { /* configuración inválida → sin secreto */ }
    const secreto = secretos[cx.secreto_vault];
    if (!secreto) {
      req.log.error({ conexion: cx.id }, 'webhook banco: falta el secreto en SECRETOS_BANCOS');
      throw new ErrorApi(503, 'Conexión bancaria sin configurar', 'no_configurado');
    }
    const adaptador = ADAPTADORES[cx.proveedor] ?? ADAPTADORES.generico;
    const mov = adaptador(req, typeof req.body === 'string' ? req.body : '', secreto);

    // Idempotente: el banco puede reintentar el mismo aviso; la huella evita duplicarlo.
    const huella = `api|${mov.fecha}|${mov.referencia}|${mov.monto.toFixed(2)}`;
    return bdServicio(ctx, async (c) => {
      const ins = await c.query(
        `insert into movimientos_bancarios (condominio_id, cuenta_id, origen, fecha, referencia, descripcion, monto, moneda, huella)
         values ($1, $2, 'api', $3, $4, $5, $6, $7, $8) on conflict (cuenta_id, huella) do nothing returning id`,
        [cx.condominio_id, cx.cuenta_id, mov.fecha, mov.referencia, mov.descripcion, mov.monto, cx.moneda, huella]);
      if (!ins.rows[0]) return { ok: true, duplicado: true, conciliado: false };
      const pago = (await c.query(`select conciliar_movimiento($1) as p`, [ins.rows[0].id])).rows[0].p;
      return { ok: true, duplicado: false, conciliado: Boolean(pago) };
    });
  });
}
