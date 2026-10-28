// Arranque del servidor: migraciones pendientes, API HTTP + WebSocket y tareas programadas.
import { leerConfig } from './config.js';
import { construirApp } from './app.js';
import { migrar } from './db/migrar.js';
import { crearUsuariosDemo } from './db/usuarios_demo.js';

const cfg = leerConfig();
const demo = process.env.SEMILLA_DEMO === 'si';
if (demo && cfg.NODE_ENV === 'production') throw new Error('SEMILLA_DEMO=si no se permite en producción');
if (process.env.MIGRAR_AL_INICIAR !== 'no') {
  await migrar({ adminUrl: cfg.DATABASE_ADMIN_URL, apiUrl: cfg.DATABASE_URL, demo });
  if (demo) await crearUsuariosDemo(cfg.DATABASE_ADMIN_URL);
}
const app = await construirApp(cfg);
await app.listen({ port: cfg.PUERTO, host: '0.0.0.0' });

for (const s of ['SIGINT', 'SIGTERM'] as const) {
  process.on(s, async () => { app.log.info(`Recibido ${s}, cerrando…`); await app.close(); process.exit(0); });
}
