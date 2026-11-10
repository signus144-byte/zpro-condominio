// Crea (o confirma) el administrador DUEÑO de la plataforma (Technical Digital TD) en un servidor nuevo.
// Uso, dentro del contenedor del servidor:
//   node dist/servidor/src/db/crear_admin.js <correo> "<nombre>"
// Si la cuenta no existe, la crea con una clave aleatoria que se muestra UNA sola vez (línea "CLAVE_ADMIN: …").
// Si ya existe, solo le da el rol de dueño (la clave no cambia y no se muestra).
import { randomInt } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export const claveAleatoria = (n = 14) => Array.from({ length: n }, () => LETRAS[randomInt(LETRAS.length)]).join('');

export async function crearAdmin(adminUrl: string, correo: string, nombre: string) {
  const email = correo.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo inválido');
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query('begin');
    let clave: string | null = null;
    let id = (await c.query(`select id from auth.users where email = $1`, [email])).rows[0]?.id as string | undefined;
    if (!id) {
      clave = claveAleatoria();
      id = (await c.query(`insert into auth.users (email, clave_hash, correo_verificado_en) values ($1, $2, now()) returning id`,
        [email, await hash(clave)])).rows[0].id as string;
      await c.query(`insert into perfiles (id, nombre) values ($1, $2)`, [id, nombre.trim() || 'Administración']);
    }
    await c.query(`insert into plataforma_admins (usuario_id, rol) values ($1, 'dueno')
                   on conflict (usuario_id) do update set rol = 'dueno', activo = true`, [id]);
    await c.query('commit');
    return { id, clave };
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.endsWith('crear_admin.js') || process.argv[1]?.endsWith('crear_admin.ts')) {
  const [correo, nombre = 'Administración'] = process.argv.slice(2);
  if (!correo) { console.error('Uso: node crear_admin.js <correo> "<nombre>"'); process.exit(2); }
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) { console.error('Falta DATABASE_ADMIN_URL'); process.exit(2); }
  const r = await crearAdmin(url, correo, nombre);
  console.log(r.clave ? `CLAVE_ADMIN: ${r.clave}` : 'ADMIN_EXISTENTE: la cuenta ya existía; ahora es dueña de la plataforma.');
}
