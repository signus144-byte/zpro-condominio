// Aplica las migraciones pendientes (db/migraciones/*.sql) en orden, cada una en su transacción.
// Crea además el usuario de la API (zpro_api) con la clave de DATABASE_URL.
// Uso: npm run migrar          (producción: sin datos demo)
//      npm run migrar:demo     (carga además db/semilla_demo.sql)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db');

export async function migrar(opts: { adminUrl: string; apiUrl: string; demo?: boolean; log?: (m: string) => void }) {
  const log = opts.log ?? console.log;
  const admin = new pg.Client({ connectionString: opts.adminUrl });
  await admin.connect();
  try {
    await admin.query(`create table if not exists public.schema_migraciones (
      archivo text primary key, aplicada_en timestamptz not null default now())`);
    await admin.query('revoke all on public.schema_migraciones from public');
    const hechas = new Set((await admin.query('select archivo from public.schema_migraciones')).rows.map((r) => r.archivo));
    const archivos = readdirSync(path.join(DIR, 'migraciones')).filter((f) => f.endsWith('.sql')).sort();
    for (const f of archivos) {
      if (hechas.has(f)) continue;
      const sql = readFileSync(path.join(DIR, 'migraciones', f), 'utf8');
      await admin.query('begin');
      try {
        await admin.query(sql);
        await admin.query('insert into public.schema_migraciones (archivo) values ($1)', [f]);
        await admin.query('commit');
        log(`✔ ${f}`);
      } catch (e) {
        await admin.query('rollback');
        throw new Error(`Falló ${f}: ${(e as Error).message}`);
      }
    }
    await crearUsuarioApi(admin, opts.apiUrl);
    if (opts.demo && !hechas.has('semilla_demo')) {
      await admin.query(readFileSync(path.join(DIR, 'semilla_demo.sql'), 'utf8'));
      await admin.query(`insert into public.schema_migraciones (archivo) values ('semilla_demo') on conflict do nothing`);
      log('✔ semilla_demo.sql (datos ficticios)');
    }
  } finally {
    await admin.end();
  }
}

/** Usuario con el que se conecta la API: sin superusuario, miembro de anon/authenticated/servicio. */
async function crearUsuarioApi(admin: pg.Client, apiUrl: string) {
  const u = new URL(apiUrl);
  const usuario = decodeURIComponent(u.username);
  const clave = decodeURIComponent(u.password);
  if (!/^[a-z_][a-z0-9_]*$/.test(usuario)) throw new Error('Nombre de usuario de la API inválido');
  const existe = (await admin.query('select 1 from pg_roles where rolname = $1', [usuario])).rowCount;
  const claveSql = `'${clave.replace(/'/g, "''")}'`;
  await admin.query(existe
    ? `alter role ${usuario} with login password ${claveSql}`
    : `create role ${usuario} with login noinherit password ${claveSql}`);
  await admin.query(`grant anon, authenticated, servicio to ${usuario}`);
  // Tablas de autenticación: solo el servidor (fuera de los roles de la app).
  await admin.query(`grant usage on schema auth, storage, public to ${usuario}`);
  await admin.query(`grant select, insert, update, delete on all tables in schema auth to ${usuario}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { leerConfig } = await import('../config.js');
  const c = leerConfig();
  await migrar({ adminUrl: c.DATABASE_ADMIN_URL, apiUrl: c.DATABASE_URL, demo: process.argv.includes('--demo') });
}
