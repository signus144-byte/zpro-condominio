// Dónde viven los bytes de los archivos. Los permisos NO se deciden aquí: los decide storage.objects (RLS).
// Piloto: disco local. Más adelante: DigitalOcean Spaces (S3) con la misma interfaz.
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { ErrorApi } from '../util/errores.js';

export interface Almacen {
  guardar(bucket: string, nombre: string, datos: Buffer): Promise<void>;
  leer(bucket: string, nombre: string): Promise<{ flujo: Readable; bytes: number }>;
  borrar(bucket: string, nombres: string[]): Promise<void>;
  /** Recorre los archivos de un bucket (para limpiar huérfanos). */
  listar?(bucket: string): AsyncIterable<{ nombre: string; modificado: Date }>;
}

const NOMBRE_SEGURO = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export function validarRuta(bucket: string, nombre: string) {
  if (!/^[a-z_]+$/.test(bucket)) throw new ErrorApi(400, 'Bucket inválido', 'invalido');
  if (!NOMBRE_SEGURO.test(nombre) || nombre.split('/').some((p) => p === '..' || p === '.')) {
    throw new ErrorApi(400, 'Ruta de archivo inválida', 'invalido');
  }
}

export function almacenLocal(raiz: string): Almacen {
  const ruta = (b: string, n: string) => {
    validarRuta(b, n);
    const r = path.resolve(raiz, b, n);
    if (!r.startsWith(path.resolve(raiz) + path.sep)) throw new Error('Ruta de archivo inválida');
    return r;
  };
  return {
    async guardar(b, n, datos) {
      const r = ruta(b, n);
      await mkdir(path.dirname(r), { recursive: true });
      await writeFile(r, datos, { flag: 'wx' });       // nunca sobrescribe
    },
    async leer(b, n) {
      const r = ruta(b, n);
      const s = await stat(r);
      return { flujo: createReadStream(r), bytes: s.size };
    },
    async borrar(b, ns) {
      for (const n of ns) await rm(ruta(b, n), { force: true });
    },
    async *listar(b) {
      validarRuta(b, 'x');
      const base = path.resolve(raiz, b);
      async function* recorrer(dir: string): AsyncGenerator<{ nombre: string; modificado: Date }> {
        let entradas;
        try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entradas) {
          const r = path.join(dir, e.name);
          if (e.isDirectory()) yield* recorrer(r);
          else if (e.isFile()) yield { nombre: path.relative(base, r).split(path.sep).join('/'), modificado: (await stat(r)).mtime };
        }
      }
      yield* recorrer(base);
    },
  };
}
