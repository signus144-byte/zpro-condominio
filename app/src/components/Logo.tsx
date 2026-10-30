// Símbolo de la marca Vecinos ZPro ("Casa que conversa"): casa con forma de globo de chat y un ✓.
// Vecinos ZPro: burbuja blanca sobre verde · Vecinos ZPro Junta: burbuja ámbar sobre noche.
import { SABOR } from '../sabor';

export function SimboloMarca({ tam = 40 }: { tam?: number }) {
  const junta = SABOR === 'admin';
  const burbuja = junta ? '#E8A33D' : '#ffffff';
  const check = junta ? '#10201F' : '#0F4C4A';
  return (
    <svg width={tam} height={tam} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 4 L44 19 V36 H17 L8 44 V36 H4 V19 Z" fill={burbuja} stroke={burbuja} strokeWidth={2} strokeLinejoin="round" />
      <path d="M15 25 L21 31 L33 19" fill="none" stroke={check} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Fondo del cuadro del logo según la app. */
export const FONDO_LOGO = SABOR === 'admin' ? '#10201F' : '#0F4C4A';
