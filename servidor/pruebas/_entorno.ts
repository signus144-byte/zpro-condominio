// Entorno de pruebas: PostgreSQL 18 REAL (binarios de npm, sin Docker), migraciones y servidor en memoria.
// Cada archivo de prueba levanta su propia base de datos temporal y la destruye al final.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { migrar } from '../src/db/migrar.js';
import { comoAnonimo, comoServicio, comoUsuario, crearPool } from '../src/db/conexion.js';

export interface Entorno {
  adminUrl: string; apiUrl: string;
  admin: pg.Pool;          // superusuario: preparar datos de prueba
  api: pg.Pool;            // usuario zpro_api: el mismo con el que corre el servidor
  detener(): Promise<void>;
}

export async function iniciarBase(opts: { demo?: boolean } = {}): Promise<Entorno> {
  const dir = mkdtempSync(path.join(tmpdir(), 'zpro-pg-'));
  chmodSync(dir, 0o777);
  const puerto = 55000 + Math.floor(Math.random() * 5000);
  const esRoot = process.getuid?.() === 0;
  const pgEmb = new EmbeddedPostgres({
    databaseDir: path.join(dir, 'datos'), user: 'postgres', password: 'postgres', port: puerto,
    persistent: false, createPostgresUser: esRoot, onLog: () => {}, onError: () => {},
  });
  await pgEmb.initialise();
  await pgEmb.start();
  await pgEmb.createDatabase('zpro');
  const adminUrl = `postgres://postgres:postgres@localhost:${puerto}/zpro`;
  const apiUrl = `postgres://zpro_api:clave_prueba@localhost:${puerto}/zpro`;
  await migrar({ adminUrl, apiUrl, demo: opts.demo ?? true, log: () => {} });
  const admin = crearPool(adminUrl, 3);
  const api = crearPool(apiUrl, 5);
  return {
    adminUrl, apiUrl, admin, api,
    async detener() { await admin.end(); await api.end(); await pgEmb.stop(); },
  };
}

/** Ejecuta SQL con la identidad indicada: uuid de usuario, 'anon' o 'servicio'. Devuelve las filas. */
export async function sqlComo(api: pg.Pool, quien: string | null, sql: string, params: unknown[] = []) {
  const fn = (c: pg.PoolClient) => c.query(sql, params).then((r) => r.rows);
  if (quien === null || quien === 'anon') return comoAnonimo(api, fn);
  if (quien === 'servicio') return comoServicio(api, fn);
  return comoUsuario(api, quien, fn);
}

/** Crea un usuario de autenticación de prueba (clave ficticia) y su perfil. */
export async function crearUsuario(admin: pg.Pool, id: string, nombre: string, correo = `${id.slice(-6)}@prueba.local`) {
  await admin.query(`insert into auth.users (id, email, clave_hash) values ($1, $2, 'sin-clave')`, [id, correo]);
  await admin.query(`insert into perfiles (id, nombre) values ($1, $2)`, [id, nombre]);
}
