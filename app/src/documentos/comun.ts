// Utilidades compartidas por todas las plantillas (PDF y Excel).
// TypeScript puro: corre en el navegador, en Capacitor y en Node (tsx).
import type { Marca, Unidad } from '../data/tipos';

export interface ImagenDoc { bytes: Uint8Array; tipo: 'png' | 'jpg' }

/** Marca lista para imprimir: la Marca de la API + los bytes del logo y de la foto de la entrada. */
export interface MarcaDoc extends Marca {
  logo?: ImagenDoc | null;
  fotoEntrada?: ImagenDoc | null;
}

/** Datos comunes que aceptan todas las plantillas. */
export interface OpcionesDoc {
  codigo?: string | null;          // código de verificación (registrarDocumento / emitirSolvencia)
  fecha?: Date;                    // fecha de emisión (por defecto: ahora)
  tasaBcv?: number | null;         // Bs por dólar, para mostrar equivalentes
}

export const URL_VERIFICAR = 'https://zentapro.com/verificar';
export const PIE = (codigo?: string | null) =>
  `Documento generado por ZPro Condominio · Verifique en zentapro.com/verificar${codigo ? ` · código ${codigo}` : ''}`;

// ---------------- Formatos ----------------
const numF = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num2 = (x: number) => numF.format(x);
export const usd = (x: number) => `${x < 0 ? '-' : ''}$${numF.format(Math.abs(x))}`;
export const bs = (x: number) => `Bs ${numF.format(x)}`;
export const pct = (x: number) => `${numF.format(x)} %`;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const aFecha = (iso: string) => new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
export const fechaCorta = (iso: string | Date) => {
  const d = typeof iso === 'string' ? aFecha(iso) : iso;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
export const fechaLarga = (d: Date) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
export const mesLargo = (periodo: string) => {
  const d = aFecha(periodo);
  const m = MESES[d.getMonth()];
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${d.getFullYear()}`;
};
export const etiquetaUnidad = (u: Pick<Unidad, 'bloque' | 'numero'>) => `${u.bloque ? u.bloque + '-' : ''}${u.numero}`;
export const r2 = (x: number) => Math.round(x * 100) / 100;

export const METODOS: Record<string, string> = {
  pago_movil: 'Pago Móvil', transferencia: 'Transferencia', zelle: 'Zelle', efectivo_usd: 'Efectivo $',
  efectivo_bs: 'Efectivo Bs', usdt: 'USDT', otro: 'Otro',
};
export const ESTADO_PAGO: Record<string, string> = { reportado: 'Por confirmar', confirmado: 'Confirmado', rechazado: 'Rechazado' };
export const TIPO_CARGO: Record<string, string> = {
  ordinaria: 'Cuota ordinaria', fondo_reserva: 'Fondo de reserva', extraordinaria: 'Partida especial',
  no_comun: 'Gasto no común', multa: 'Multa', ajuste: 'Ajuste',
};

// ---------------- Texto seguro para las fuentes estándar del PDF (WinAnsi) ----------------
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REEMPLAZOS: Record<string, string> = {
  '−': '-', '≈': '~', '✓': 'x', '✔': 'x', '✗': 'x', '→': '->', '←': '<-', '≥': '>=', '≤': '<=',
  ' ': ' ', ' ': ' ', ' ': ' ', '•': '·',
};
export function winAnsi(s: string | null | undefined): string {
  if (!s) return '';
  let out = '';
  for (const ch of s.normalize('NFC')) {
    if (REEMPLAZOS[ch] !== undefined) { out += REEMPLAZOS[ch]; continue; }
    const c = ch.codePointAt(0)!;
    if (c === 10 || (c >= 32 && c < 127) || (c >= 160 && c <= 255) || CP1252_EXTRA.has(ch)) out += ch;
    else {
      const sinAcento = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += /^[\x20-\x7e]$/.test(sinAcento) ? sinAcento : '';
    }
  }
  return out;
}

// ---------------- Colores ----------------
export interface RGB { r: number; g: number; b: number }   // 0..1
export function hexARgb(hex: string): RGB {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? '0f4c4a';
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}
export const mezclar = (c: RGB, blanco: number): RGB => ({
  r: c.r + (1 - c.r) * blanco, g: c.g + (1 - c.g) * blanco, b: c.b + (1 - c.b) * blanco,
});
export const argb = (c: RGB) =>
  'FF' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

// ---------------- Bytes ----------------
export function aBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Detecta PNG/JPG por la firma de los bytes. */
export function tipoImagen(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  return null;
}

/** Descarga una imagen de una URL (logoUrl / fotoEntradaUrl). Devuelve null si falla o no es PNG/JPG. */
export async function cargarImagen(url: string | null | undefined): Promise<ImagenDoc | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const tipo = tipoImagen(bytes);
    return tipo ? { bytes, tipo } : null;
  } catch { return null; }
}

/** Convierte la Marca de la API en MarcaDoc (descarga logo y foto). */
export async function prepararMarca(m: Marca): Promise<MarcaDoc> {
  const [logo, fotoEntrada] = await Promise.all([cargarImagen(m.logoUrl), cargarImagen(m.fotoEntradaUrl)]);
  return { ...m, logo, fotoEntrada };
}
