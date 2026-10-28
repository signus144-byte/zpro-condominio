// Usuarios de demostración para desarrollo local (SEMILLA_DEMO=si). NUNCA en producción.
// Todos con la clave: demo-1234
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const C = '00000000-0000-0000-0000-0000000000c1';
export const USUARIOS_DEMO = [
  { correo: 'presidenta@demo.zpro', nombre: 'María Fernández', rol: 'presidente', unidad: null },
  { correo: 'tesorero@demo.zpro', nombre: 'Jorge Rondón', rol: 'tesorero', unidad: null },
  { correo: 'elena@demo.zpro', nombre: 'Elena Castro', rol: 'propietario', unidad: '00000000-0000-0000-0000-0000000000b3' },
  { correo: 'pedro@demo.zpro', nombre: 'Pedro Salas', rol: 'propietario', unidad: '00000000-0000-0000-0000-0000000000b4' },
  { correo: 'ana@demo.zpro', nombre: 'Ana Gómez', rol: 'propietario', unidad: '00000000-0000-0000-0000-0000000000a3' },
  { correo: 'soporte@demo.zpro', nombre: 'Soporte ZentaPro', rol: null, unidad: null, plataforma: 'dueno' },
] as const;

export async function crearUsuariosDemo(adminUrl: string, log: (m: string) => void = console.log) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    const claveHash = await hash('demo-1234');
    for (const u of USUARIOS_DEMO) {
      const r = await c.query(`insert into auth.users (email, clave_hash, correo_verificado_en) values ($1, $2, now())
                               on conflict (email) do nothing returning id`, [u.correo, claveHash]);
      if (!r.rows[0]) continue;                       // ya existía
      const id = r.rows[0].id;
      await c.query(`insert into perfiles (id, nombre) values ($1, $2)`, [id, u.nombre]);
      if (u.rol) await c.query(`insert into membresias (condominio_id, usuario_id, rol, unidad_id) values ($1, $2, $3, $4)`, [C, id, u.rol, u.unidad]);
      if ('plataforma' in u) await c.query(`insert into plataforma_admins (usuario_id, rol) values ($1, $2)`, [id, u.plataforma]);
    }
    await c.query(`update condominios set estado = 'activo' where id = $1`, [C]);
    // Recibos del mes de los gastos de ejemplo, para que los residentes demo vean saldos (una sola vez).
    const hay = await c.query(`select 1 from recibos where condominio_id = $1 limit 1`, [C]);
    if (!hay.rowCount) {
      const pres = (await c.query(`select id from auth.users where email = 'presidenta@demo.zpro'`)).rows[0]?.id;
      await c.query('begin');
      await c.query(`select set_config('app.uid', $1, true)`, [pres]);
      await c.query(`select generar_recibos($1, '2026-10-01')`, [C]);
      await c.query('commit');
    }
    log('✔ usuarios demo (clave: demo-1234): ' + USUARIOS_DEMO.map((u) => u.correo).join(', '));
  } finally {
    await c.end();
  }
}
