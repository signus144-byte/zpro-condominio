// Lee el QR de cobro dentro de una captura o de una foto (p. ej. la hojita impresa con el QR del banco) y lo vuelve
// a dibujar nítido con el MISMO contenido: el banco lee el contenido, no el dibujo, así que el QR limpio paga igual
// que el original (el logo del medio es solo adorno que el QR tolera).
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { nombreBanco } from './bancos';

async function cargarImagen(archivo: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(archivo, { imageOrientation: 'from-image' }); } catch { /* sigue con <img> */ }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

/** Contenido del QR que aparece en la imagen, o null si no se encontró ninguno. Prueba varios tamaños (las fotos grandes
 *  y las capturas pequeñas fallan en tamaños distintos) y también el centro recortado (la foto de una hoja). */
export async function leerQrDeImagen(archivo: Blob): Promise<string | null> {
  const img = await cargarImagen(archivo);
  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })!;
  const intentos: [number, number][] = [[1, 1400], [1, 900], [1, 600], [0.7, 1000], [0.5, 900]];  // [parte central, lado mayor]
  for (const [parte, lado] of intentos) {
    const sw = img.width * parte, sh = img.height * parte;
    const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
    const k = Math.min(1, lado / Math.max(sw, sh));
    lienzo.width = Math.max(1, Math.round(sw * k));
    lienzo.height = Math.max(1, Math.round(sh * k));
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, lienzo.width, lienzo.height);
    const px = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
    const r = jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' });
    if (r?.data) return r.data;
  }
  return null;
}

/** QR nítido (PNG) con ese contenido, listo para guardar como el QR oficial de la cuenta. */
export async function qrLimpio(contenido: string): Promise<Blob> {
  const url = await QRCode.toDataURL(contenido, { width: 720, margin: 2, errorCorrectionLevel: 'M' });
  return (await fetch(url)).blob();
}

/** Banco que generó el QR, si lo dice (los QR de cobro traen merchantId=<código del banco>). */
export function bancoDelQr(contenido: string): { codigo: string; nombre: string } | null {
  const m = contenido.match(/merchantId=(\d{4})/i);
  return m ? { codigo: m[1], nombre: nombreBanco(m[1]) } : null;
}
