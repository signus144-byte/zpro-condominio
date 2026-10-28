// Notificaciones push con Firebase Cloud Messaging (API HTTP v1). Gratis; Android e iOS.
// Solo se activa si FCM_CUENTA_SERVICIO tiene el JSON de la cuenta de servicio de Firebase.
import type pg from 'pg';
import { SignJWT, importPKCS8 } from 'jose';
import { comoServicio } from './db/conexion.js';

export interface Push {
  mensaje(mensajeId: string): Promise<number>;
  /** Envía una notificación ya armada (avisos de pagos, recordatorios…) a los teléfonos indicados. */
  enviarA(tokens: string[], titulo: string, cuerpo: string, datos: Record<string, string>, alarma?: boolean): Promise<number>;
}

/** Alerta vecinal: canal "alarma_vecinal" de la app (sonido de alarma, máxima prioridad, visible en pantalla bloqueada). */
const ANDROID_ALARMA = {
  priority: 'high', ttl: '600s',
  notification: { channel_id: 'alarma_vecinal', sound: 'alarma', notification_priority: 'PRIORITY_MAX', visibility: 'PUBLIC',
                  default_vibrate_timings: true },
};

interface CuentaServicio { client_email: string; private_key: string; project_id: string }
type Log = { warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

export function crearPush(jsonCuenta: string | undefined, pool: pg.Pool, log: Log,
                          fetchFn: typeof fetch = fetch): Push | null {
  if (!jsonCuenta) return null;
  let sa: CuentaServicio;
  try { sa = JSON.parse(jsonCuenta); } catch { log.error({}, 'FCM_CUENTA_SERVICIO no es JSON válido: push desactivado'); return null; }
  let cache: { token: string; vence: number } | null = null;

  async function tokenGoogle() {
    if (cache && cache.vence > Date.now() + 60_000) return cache.token;
    const clave = await importPKCS8(sa.private_key, 'RS256');
    const ahora = Math.floor(Date.now() / 1000);
    const afirmacion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(sa.client_email)
      .setAudience('https://oauth2.googleapis.com/token').setIssuedAt(ahora).setExpirationTime(ahora + 3600).sign(clave);
    const r = await fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: afirmacion }).toString(),
    });
    if (!r.ok) throw new Error(`Google OAuth respondió ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    cache = { token: j.access_token, vence: Date.now() + j.expires_in * 1000 };
    return cache.token;
  }

  async function enviar(tokens: string[], titulo: string, cuerpo: string, datos: Record<string, string>, alarma = false) {
    if (!tokens.length) return 0;
    const acceso = await tokenGoogle();
    let ok = 0;
    for (const t of tokens) {
      const r = await fetchFn(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST', headers: { authorization: `Bearer ${acceso}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: { token: t, notification: { title: titulo, body: cuerpo }, data: datos,
                                          android: alarma ? ANDROID_ALARMA : { priority: 'high' } } }),
      });
      if (r.ok) ok++;
      else if (r.status === 404 || r.status === 400) {
        // Token viejo o desinstalado: se borra para no volver a intentarlo.
        await comoServicio(pool, (c) => c.query(`delete from dispositivos where token = $1`, [t])).catch(() => {});
      } else log.warn({ status: r.status }, 'FCM rechazó una notificación');
    }
    return ok;
  }

  return {
    async mensaje(id) {
      const { tokens, m } = await comoServicio(pool, async (c) => ({
        tokens: (await c.query(`select token from destinatarios_push($1)`, [id])).rows.map((r) => r.token as string),
        m: (await c.query(`select m.texto, m.tipo, m.como_junta, m.conversacion_id, p.nombre,
                                   case when u.id is null then null else etiqueta_unidad(u) end as casa
                              from mensajes m left join perfiles p on p.id = m.autor_id
                              left join unidades u on u.id = m.autor_unidad_id where m.id = $1`, [id])).rows[0],
      }));
      if (!m) return 0;
      const quien = m.como_junta ? 'Junta de condominio' : [m.casa, m.nombre].filter(Boolean).join(' · ');
      const texto = m.texto ? String(m.texto).slice(0, 140) : m.tipo === 'imagen' ? '📷 Foto' : '📎 Archivo';
      return enviar(tokens, quien || 'Nuevo mensaje', texto, { tipo: 'mensaje', conversacionId: m.conversacion_id });
    },
    enviarA: (tokens, titulo, cuerpo, datos, alarma) => enviar(tokens, titulo, cuerpo, datos, alarma),
  };
}
