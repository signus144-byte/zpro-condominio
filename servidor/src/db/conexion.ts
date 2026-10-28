// Acceso a la base de datos con la identidad del usuario en cada petición.
//
// Regla de oro: las rutas NUNCA consultan "a pelo". Usan:
//   comoUsuario(uid, fn)  → RLS con el usuario en sesión (role authenticated, app.uid = uid)
//   comoAnonimo(fn)       → sin sesión (role anon): solo verificación pública de documentos
//   comoServicio(fn)      → procesos internos (role servicio, salta RLS): tareas, webhooks, fotos anónimas
// Todo dentro de una transacción: si algo falla, no queda nada a medias.
import pg from 'pg';

// numeric → number y date → 'YYYY-MM-DD' (sin zona horaria), como lo espera la app.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));   // numeric
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));     // bigint (conteos)
pg.types.setTypeParser(1082, (v) => v);                                  // date

export type Tx = pg.PoolClient;

export function crearPool(url: string, max = 10, alError: (e: Error) => void = () => {}) {
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30_000 });
  // Una conexión inactiva que se cae (reinicio de la base de datos) no debe tumbar el servidor.
  pool.on('error', alError);
  return pool;
}

async function enTransaccion<T>(pool: pg.Pool, preparar: (c: Tx) => Promise<void>, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await preparar(c);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export function comoUsuario<T>(pool: pg.Pool, uid: string, fn: (c: Tx) => Promise<T>) {
  return enTransaccion(pool, async (c) => {
    await c.query(`select set_config('app.uid', $1, true), set_config('app.servicio', '', true)`, [uid]);
    await c.query('set local role authenticated');
  }, fn);
}

export function comoAnonimo<T>(pool: pg.Pool, fn: (c: Tx) => Promise<T>) {
  return enTransaccion(pool, async (c) => {
    await c.query(`select set_config('app.uid', '', true), set_config('app.servicio', '', true)`);
    await c.query('set local role anon');
  }, fn);
}

export function comoServicio<T>(pool: pg.Pool, fn: (c: Tx) => Promise<T>) {
  return enTransaccion(pool, async (c) => {
    await c.query(`select set_config('app.uid', '', true), set_config('app.servicio', 'on', true)`);
    await c.query('set local role servicio');
  }, fn);
}

/** Tablas de autenticación: las maneja el servidor con su propio usuario (zpro_api), sin rol de app. */
export function comoSistema<T>(pool: pg.Pool, fn: (c: Tx) => Promise<T>) {
  return enTransaccion(pool, async () => {}, fn);
}
