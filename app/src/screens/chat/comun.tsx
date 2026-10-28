import type { TipoConversacion } from '../../data';

export const baseRol = (esJunta: boolean) => (esJunta ? '/p' : '/r');

export function horaCorta(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === ayer.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
}
export const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
export function dia(iso: string) {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return 'Hoy';
  if (d.toDateString() === ayer.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });
}
export function tamano(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Iniciales del avatar: "Casa 12 · Carlos" → "C12", "Apto B-33" → "B33", "Junta…" → "J", "Bloque B" → "BB".
export function iniciales(titulo: string, tipo: TipoConversacion | 'casa') {
  const base = titulo.split('·')[0].trim();
  const casa = base.match(/^(Casa|Apto|TH|Local|Ofic\.)\s+(.+)$/i);
  if (casa) return ((casa[1][0].toUpperCase() === 'A' ? '' : casa[1][0].toUpperCase()) + casa[2].replace(/[^0-9A-Za-z]/g, '')).slice(0, 4);
  if (/^Junta/i.test(base)) return 'J';
  return base.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || (tipo === 'canal' ? 'AV' : '?');
}

export function Avatar({ titulo, tipo, esJuntaTitulo }: { titulo: string; tipo: TipoConversacion | 'casa'; esJuntaTitulo?: boolean }) {
  const clase = esJuntaTitulo || /^Junta/.test(titulo) ? 'avatar-junta' : tipo === 'canal' ? 'avatar-canal' : tipo === 'grupo' ? 'avatar-grupo' : 'avatar-casa';
  return <span className={`avatar ${clase}`} aria-hidden>{iniciales(titulo, tipo)}</span>;
}

// Iconos de línea propios (sin dependencias).
const P: Record<string, string> = {
  atras: 'M15 5l-7 7 7 7',
  menu: 'M12 5h.01M12 12h.01M12 19h.01',
  clip: 'M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7',
  camara: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z',
  enviar: 'M4 12l16-8-6 16-2.5-6.5z',
  buscar: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  cerrar: 'M6 6l12 12M18 6L6 18',
  descargar: 'M12 4v11M7 10l5 5 5-5M5 20h14',
};
export function Ico({ n, t = 22 }: { n: keyof typeof P | string; t?: number }) {
  return (
    <svg width={t} height={t} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={n === 'menu' ? 3 : 1.9}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={P[n]} /></svg>
  );
}
