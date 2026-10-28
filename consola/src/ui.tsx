import { useCallback, useEffect, useState, type ReactNode } from 'react';

export function useCarga<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cargar = useCallback(() => {
    setCargando(true);
    fn().then((d) => { setDatos(d); setError(null); }).catch((e: Error) => setError(e.message)).finally(() => setCargando(false));
  }, deps);
  useEffect(() => { cargar(); }, [cargar]);
  return { datos, error, cargando, recargar: cargar };
}

export function Estado({ cargando, error, children }: { cargando: boolean; error: string | null; children: ReactNode }) {
  if (error) return <div className="aviso aviso-error">{error}</div>;
  if (cargando) return <div className="cargando">Cargando…</div>;
  return <>{children}</>;
}

export function Tarjeta({ titulo, accion, children, className = '' }: { titulo?: ReactNode; accion?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`tarjeta ${className}`}>
      {(titulo || accion) && <header className="tarjeta-cab"><h2>{titulo}</h2>{accion}</header>}
      {children}
    </section>
  );
}

export function Etiqueta({ tono = 'neutro', children }: { tono?: 'ok' | 'alerta' | 'error' | 'neutro' | 'info'; children: ReactNode }) {
  return <span className={`etiqueta etiqueta-${tono}`}>{children}</span>;
}

export function Cifra({ etiqueta, valor, nota, tono }: { etiqueta: string; valor: ReactNode; nota?: ReactNode; tono?: 'ok' | 'alerta' | 'error' }) {
  return (
    <div className={`cifra ${tono ? 'cifra-' + tono : ''}`}>
      <span className="cifra-etq">{etiqueta}</span>
      <strong className="cifra-valor">{valor}</strong>
      {nota && <span className="cifra-nota">{nota}</span>}
    </div>
  );
}

export function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <label className="campo">
      <span className="campo-etq">{etiqueta}</span>
      {children}
      {ayuda && <span className="campo-ayuda">{ayuda}</span>}
    </label>
  );
}

export function Barra({ valor, tono = 'ok' }: { valor: number; tono?: 'ok' | 'alerta' | 'error' }) {
  return <div className="barra-prog" aria-label={`${Math.round(valor)} %`}><div className={`barra-prog-${tono}`} style={{ width: `${Math.max(0, Math.min(100, valor))}%` }} /></div>;
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="vacio">{children}</p>;
}

/** Ejecuta una acción mostrando su error o un mensaje de éxito. */
export function useAccion() {
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function correr(fn: () => Promise<unknown>, exito?: string) {
    setMsg(null); setOcupado(true);
    try { await fn(); if (exito) setMsg({ ok: true, t: exito }); return true; }
    catch (e) { setMsg({ ok: false, t: (e as Error).message }); return false; }
    finally { setOcupado(false); }
  }
  const Mensaje = () => (msg ? <div className={`aviso ${msg.ok ? 'aviso-ok' : 'aviso-error'}`} role="status">{msg.t}</div> : null);
  return { correr, ocupado, Mensaje, setMsg };
}
