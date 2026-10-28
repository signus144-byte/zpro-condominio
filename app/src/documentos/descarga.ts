// Huella SHA-256 y descarga/compartir del archivo generado (web y Android/iOS con Capacitor).
import { Capacitor } from '@capacitor/core';
import { aBase64 } from './comun';

export const MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

/** SHA-256 en hexadecimal (Web Crypto: navegador, Capacitor y Node 18+). */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Nombre de archivo seguro: "Estado de cuenta B-33 2026-10.pdf" → "Estado_de_cuenta_B-33_2026-10.pdf". */
export const nombreArchivo = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_');

/**
 * Entrega el archivo al usuario.
 *  - Web: descarga directa del navegador.
 *  - Android/iOS: lo guarda en Documentos/ZPro Condominio/ (constancia en el teléfono) y abre "Compartir"
 *    para enviarlo por WhatsApp, correo o abrirlo en Drive/Sheets.
 * Devuelve la ruta/URI donde quedó guardado (en web, el nombre).
 */
export async function descargar(bytes: Uint8Array, nombre: string, mime: string): Promise<string> {
  const archivo = nombreArchivo(nombre);
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'), import('@capacitor/share'),
    ]);
    const res = await Filesystem.writeFile({
      path: `ZPro Condominio/${archivo}`, data: aBase64(bytes), directory: Directory.Documents, recursive: true,
    });
    await Share.share({ title: archivo, url: res.uri, dialogTitle: 'Compartir documento' }).catch(() => undefined);
    return res.uri;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = archivo; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return archivo;
}
