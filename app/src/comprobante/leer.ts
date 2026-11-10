// Lee el texto de la captura del comprobante EN EL TELÉFONO (Tesseract, sin enviar la imagen a ningún lado).
// Los archivos del lector van dentro de la app (carpeta ocr/): funciona sin depender de otros servidores.
import type { Worker } from 'tesseract.js';
import { interpretarComprobante, type LecturaComprobante } from './interpretar';

let trabajador: Promise<Worker> | null = null;

async function soportaSimd() {
  // Módulo WebAssembly mínimo con una instrucción SIMD (misma prueba que wasm-feature-detect).
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch { return false; }
}

function obtenerTrabajador(alAvanzar?: (p: number) => void) {
  if (!trabajador) {
    trabajador = (async () => {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      const base = new URL('ocr/', document.baseURI).href;
      const w = await createWorker('spa', OEM.LSTM_ONLY, {
        workerPath: base + 'worker.min.js',
        corePath: base + ((await soportaSimd()) ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'),
        langPath: base, gzip: true, cacheMethod: 'none',
        logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') alAvanzar?.(m.progress); },
      });
      await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' });
      return w;
    })();
    trabajador.catch(() => { trabajador = null; });
  }
  return trabajador;
}

/** Prepara la imagen: gris, con buen contraste y a un tamaño que el lector maneja bien (capturas de 1080 px o fotos grandes). */
async function preparar(archivo: Blob): Promise<HTMLCanvasElement> {
  const img = await createImageBitmap(archivo, { imageOrientation: 'from-image' }).catch(async () => {
    const url = URL.createObjectURL(archivo);
    try { const i = new Image(); i.src = url; await i.decode(); return i; } finally { URL.revokeObjectURL(url); }
  });
  const ancho = img.width, alto = img.height;
  const k = ancho < 900 ? 2 : ancho > 1600 ? 1600 / ancho : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(ancho * k); c.height = Math.round(alto * k);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height);
  const d = px.data;
  // Gris + estirar el contraste; si el fondo es oscuro (modo oscuro de la app del banco), se invierte.
  let suma = 0;
  for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = g; suma += g; }
  const oscuro = suma / (d.length / 4) < 110;
  for (let i = 0; i < d.length; i += 4) {
    let g = d[i];
    if (oscuro) g = 255 - g;
    g = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128));
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(px, 0, 0);
  return c;
}

interface Palabra { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface Renglon { words: Palabra[]; baseline?: { x0: number; y0: number; x1: number; y1: number } }

/**
 * Rearma los renglones como se ven en la pantalla: en los comprobantes la etiqueta va a la izquierda y el valor a la
 * derecha ("Referencia ......... 004512345678"), y el lector a veces los separa en dos columnas. Se agrupan las palabras
 * por altura, corrigiendo la inclinación (fotos torcidas) con la pendiente media de los renglones.
 */
export function rearmarRenglones(renglones: Renglon[]): string {
  const pendientes = renglones.map((r) => r.baseline).filter((b): b is NonNullable<typeof b> => !!b && b.x1 - b.x0 > 60)
    .map((b) => (b.y1 - b.y0) / (b.x1 - b.x0)).sort((a, b) => a - b);
  const m = pendientes.length ? pendientes[Math.floor(pendientes.length / 2)] : 0;
  const palabras = renglones.flatMap((r) => r.words).filter((w) => w.text.trim())
    .map((w) => ({ t: w.text.trim(), x: w.bbox.x0, x1: w.bbox.x1, alto: w.bbox.y1 - w.bbox.y0,
                   y: (w.bbox.y0 + w.bbox.y1) / 2 - ((w.bbox.x0 + w.bbox.x1) / 2) * m }));
  if (!palabras.length) return '';
  const altos = palabras.map((p) => p.alto).sort((a, b) => a - b);
  const tol = Math.max(6, altos[Math.floor(altos.length / 2)] * 0.55);
  palabras.sort((a, b) => a.y - b.y);
  const filas: (typeof palabras)[] = [];
  for (const p of palabras) {
    const f = filas[filas.length - 1];
    if (f && Math.abs(p.y - f.reduce((s, q) => s + q.y, 0) / f.length) <= tol) f.push(p); else filas.push([p]);
  }
  return filas.map((f) => f.sort((a, b) => a.x - b.x)
    .map((p, i, arr) => (i && p.x - arr[i - 1].x1 > p.alto * 1.5 ? '   ' : i ? ' ' : '') + p.t).join('')).join('\n');
}

/** Lee la captura (imagen) y devuelve los datos del pago. Lanza error si no es una imagen. */
export async function leerComprobante(archivo: Blob, alAvanzar?: (p: number) => void): Promise<LecturaComprobante> {
  if (!archivo.type.startsWith('image/')) throw new Error('Para leer los datos, adjunte una imagen (captura o foto) del comprobante.');
  const [w, lienzo] = await Promise.all([obtenerTrabajador(alAvanzar), preparar(archivo)]);
  const r = await w.recognize(lienzo, {}, { text: true, blocks: true });
  const renglones = (r.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) as unknown as Renglon[];
  const texto = renglones.length ? rearmarRenglones(renglones) : r.data.text;
  const l = interpretarComprobante(texto);
  // Si con los renglones rearmados faltó algo, se completa con el texto tal como lo dio el lector.
  if (!l.referencia || l.monto == null) {
    const b = interpretarComprobante(r.data.text);
    return { ...l, referencia: l.referencia ?? b.referencia, monto: l.monto ?? b.monto, fecha: l.fecha ?? b.fecha,
             bancoOrigen: l.bancoOrigen ?? b.bancoOrigen, bancoDestino: l.bancoDestino ?? b.bancoDestino };
  }
  return l;
}

/** Libera el lector (unos 30 MB de memoria) cuando ya no hace falta. */
export async function cerrarLector() {
  const t = trabajador; trabajador = null;
  if (t) await (await t).terminate().catch(() => undefined);
}
