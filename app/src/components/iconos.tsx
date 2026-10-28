// Iconos de línea propios (sin dependencias, funcionan sin conexión).
const P: Record<string, string> = {
  inicio: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  cuenta: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  pagar: 'M3 7h18v10H3zM3 11h18M7 15h3',
  reportes: 'M5 21V4M5 4h11l-2 4 2 4H5',
  partidas: 'M4 12l5 5L20 6',
  panel: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  pagos: 'M12 3v18M17 7H9.5a3 3 0 000 6h5a3 3 0 010 6H6',
  gastos: 'M4 6h16M4 12h16M4 18h10',
  unidades: 'M4 21V5l8-3 8 3v16M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4',
  chat: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  mas: 'M4 7h16M4 12h16M4 17h16',
  campana: 'M6 16v-5a6 6 0 0112 0v5l2 2H4zM10 20.5a2 2 0 004 0',
};
export function Icono({ nombre }: { nombre: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[nombre] ?? P.inicio} />
    </svg>
  );
}
