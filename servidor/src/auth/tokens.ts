// Tokens: acceso (JWT corto, 15 min) + refresco (aleatorio, guardado solo como hash, rota en cada uso).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const tokenAleatorio = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function iguales(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function crearFirmador(secreto: string) {
  const clave = new TextEncoder().encode(secreto);
  return {
    async acceso(usuarioId: string, minutos: number) {
      return new SignJWT({ typ: 'acceso' }).setProtectedHeader({ alg: 'HS256' })
        .setSubject(usuarioId).setIssuedAt().setExpirationTime(`${minutos}m`).sign(clave);
    },
    async verificarAcceso(token: string): Promise<string> {
      const { payload } = await jwtVerify(token, clave, { algorithms: ['HS256'] });
      if (payload.typ !== 'acceso' || !payload.sub) throw new Error('Token inválido');
      return payload.sub;
    },
    /** Firma corta para descargar un archivo sin cabeceras (p. ej. <img src>). */
    async archivo(bucket: string, nombre: string, segundos = 3600) {
      return new SignJWT({ typ: 'archivo', b: bucket, n: nombre }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime(`${segundos}s`).sign(clave);
    },
    async verificarArchivo(token: string): Promise<{ bucket: string; nombre: string }> {
      const { payload } = await jwtVerify(token, clave, { algorithms: ['HS256'] });
      if (payload.typ !== 'archivo') throw new Error('Token inválido');
      return { bucket: String(payload.b), nombre: String(payload.n) };
    },
    /** Token para el WebSocket (mismo de acceso). */
  };
}
export type Firmador = ReturnType<typeof crearFirmador>;
