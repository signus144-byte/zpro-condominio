// Configuración del servidor desde variables de entorno (ver .env.example).
import { z } from 'zod';

const Esquema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PUERTO: z.coerce.number().default(3000),
  // Conexión de la API (usuario zpro_api, sin privilegios de dueño).
  DATABASE_URL: z.string().default('postgres://zpro_api:zpro_api_local@localhost:5432/zpro'),
  // Conexión de administración (solo para migraciones).
  DATABASE_ADMIN_URL: z.string().default('postgres://postgres:postgres@localhost:5432/zpro'),
  // Clave para firmar los tokens de sesión y las URLs de archivos. En producción: 64+ caracteres aleatorios.
  JWT_SECRETO: z.string().min(32).default('desarrollo-local-cambiar-en-produccion-0123456789abcdef'),
  ACCESO_MINUTOS: z.coerce.number().default(15),      // vida del token de acceso
  REFRESCO_DIAS: z.coerce.number().default(60),       // vida de la sesión en el teléfono
  // Archivos: carpeta local (piloto) o Spaces/S3 (más adelante).
  ARCHIVOS_DIR: z.string().default('./datos/archivos'),
  URL_PUBLICA: z.string().default('http://localhost:3000'),      // dirección pública de esta API
  URL_APP: z.string().default('http://localhost:5173'),          // para enlaces en correos
  CORS_ORIGENES: z.string().default('http://localhost:5173,http://localhost:5174,capacitor://localhost,https://localhost'),
  // Correo saliente (en local: Mailpit en el puerto 1025, se ve en http://localhost:8025)
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PUERTO: z.coerce.number().default(1025),
  SMTP_USUARIO: z.string().optional(),
  SMTP_CLAVE: z.string().optional(),
  CORREO_REMITENTE: z.string().default('ZPro Condominio <no-responder@zentapro.com>'),
  // Notificaciones push (opcional): JSON de la cuenta de servicio de Firebase en una línea.
  FCM_CUENTA_SERVICIO: z.string().optional(),
  // Tareas programadas: desactivables en pruebas.
  TAREAS_ACTIVAS: z.enum(['si', 'no']).default('si'),
  // Secretos bancarios: JSON {"nombre_secreto": "valor"} referenciados por conexiones_bancarias.secreto_vault.
  SECRETOS_BANCOS: z.string().default('{}'),
  // Datos de la cuenta de ZentaPro donde las juntas pagan su mensualidad (JSON con DatosPagoZentaPro).
  DATOS_PAGO_ZENTAPRO: z.string().default(JSON.stringify({
    banco: 'BANCO DE DEMOSTRACIÓN (ficticio)', titular: 'TECHNICAL DIGITAL TD, C.A. (DEMO)', rif: 'J-00000000-0',
    telefonoPagoMovil: '0000-0000000', cuenta: '0000-0000-00-0000000000',
  })),
});

export type Config = z.infer<typeof Esquema>;

export function leerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Variables vacías (p. ej. "FCM_CUENTA_SERVICIO=" en docker compose) cuentan como no definidas.
  const c = Esquema.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (c.NODE_ENV === 'production' && c.JWT_SECRETO.startsWith('desarrollo-local')) {
    throw new Error('JWT_SECRETO de desarrollo en producción: configure uno propio');
  }
  return c;
}
