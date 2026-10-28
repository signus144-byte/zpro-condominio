// Arnés para probar la API completa: PostgreSQL real + servidor en memoria (sin abrir puertos).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { construirApp } from '../src/app.js';
import { leerConfig } from '../src/config.js';
import type { Correo, HubTiempoReal } from '../src/contexto.js';
import { iniciarBase, type Entorno } from './_entorno.js';

export const C = '00000000-0000-0000-0000-0000000000c1';                 // condominio demo (semilla)
export const UNI = (s: string) => `00000000-0000-0000-0000-0000000000${s}`;  // a1..a4, b1..b4

export interface Prueba {
  app: FastifyInstance; base: Entorno; correos: Correo[]; eventos: { usuarios: string[]; evento: unknown }[];
  pedir(metodo: InjectOptions['method'], url: string, token?: string | null, cuerpo?: unknown): Promise<{ status: number; json: any; body: string; headers: Record<string, unknown> }>;
  registrar(nombre: string, correo: string, clave?: string): Promise<{ id: string; acceso: string; refresco: string }>;
  /** Usuario registrado + miembro del condominio demo con un rol (y casa). */
  miembro(nombre: string, rol: string, unidad?: string | null): Promise<{ id: string; acceso: string }>;
  cerrar(): Promise<void>;
}

export async function crearPrueba(env: Record<string, string> = {}): Promise<Prueba> {
  const base = await iniciarBase({ demo: true });
  const correos: Correo[] = [];
  const eventos: Prueba['eventos'] = [];
  const hub: HubTiempoReal = { aUsuarios: (usuarios, evento) => { eventos.push({ usuarios, evento }); }, async cerrar() {} };
  const cfg = leerConfig({
    NODE_ENV: 'test', DATABASE_URL: base.apiUrl, DATABASE_ADMIN_URL: base.adminUrl, TAREAS_ACTIVAS: 'no',
    ARCHIVOS_DIR: mkdtempSync(path.join(tmpdir(), 'zpro-archivos-')), URL_PUBLICA: 'http://prueba', ...env,
  });
  const app = await construirApp(cfg, { enviarCorreo: async (c) => { correos.push(c); }, hub });
  let n = 0;

  const pedir: Prueba['pedir'] = async (metodo, url, token, cuerpo) => {
    const form = cuerpo && typeof cuerpo === 'object' && 'contentType' in cuerpo && 'payload' in cuerpo
      ? (cuerpo as { contentType: string; payload: Buffer }) : null;
    const r = await app.inject({
      method: metodo, url: url.startsWith('/') ? url : `/api/v1/${url}`,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-forwarded-for': `10.0.0.${(n++ % 250) + 1}`,
                 ...(form ? { 'content-type': form.contentType } : {}) },
      ...(form ? { payload: form.payload } : cuerpo !== undefined ? { payload: cuerpo as InjectOptions['payload'] } : {}),
    });
    let json: unknown = null;
    try { json = r.body ? JSON.parse(r.body) : null; } catch { /* binario */ }
    return { status: r.statusCode, json, body: r.body, headers: r.headers as Record<string, unknown> };
  };

  const registrar: Prueba['registrar'] = async (nombre, correo, clave = 'clave-segura-123') => {
    const r = await pedir('POST', 'auth/registro', null, { nombre, correo, clave });
    if (r.status !== 201) throw new Error(`registro ${correo}: ${r.status} ${r.body}`);
    return r.json;
  };

  const miembro: Prueba['miembro'] = async (nombre, rol, unidad = null) => {
    const u = await registrar(nombre, `${nombre.toLowerCase().replace(/[^a-z]/g, '')}${n++}@prueba.local`);
    await base.admin.query(`insert into membresias (condominio_id, usuario_id, rol, unidad_id) values ($1, $2, $3, $4)`,
      [C, u.id, rol, unidad ? UNI(unidad) : null]);
    return { id: u.id, acceso: u.acceso };
  };

  return { app, base, correos, eventos, pedir, registrar, miembro, async cerrar() { await app.close(); await base.detener(); } };
}

/** Construye un cuerpo multipart/form-data para app.inject. */
export function formulario(campos: Record<string, string>, archivos: { campo: string; nombre: string; mime: string; datos: Buffer }[] = []) {
  const limite = '----zpro' + Math.random().toString(16).slice(2);
  const partes: Buffer[] = [];
  for (const [k, v] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const a of archivos) {
    partes.push(Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${a.campo}"; filename="${a.nombre}"\r\nContent-Type: ${a.mime}\r\n\r\n`));
    partes.push(a.datos, Buffer.from('\r\n'));
  }
  partes.push(Buffer.from(`--${limite}--\r\n`));
  return { payload: Buffer.concat(partes), contentType: `multipart/form-data; boundary=${limite}` };
}

/** PNG de 1×1 píxel para pruebas de imágenes. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
