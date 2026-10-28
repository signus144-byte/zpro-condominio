import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../data';
import { Icono } from './iconos';
import { Campana } from './notificaciones';
import { NOMBRE_APP } from '../sabor';

// Carga datos asíncronos con estado de error y recarga.
export function useCarga<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hayDatos = useRef(false);
  const cargar = useCallback(() => {
    if (!hayDatos.current) setCargando(true);          // al recargar se mantienen los datos visibles (sin parpadeo)
    fn().then((d) => { hayDatos.current = true; setDatos(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
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

export function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <label className="campo">
      <span className="campo-etq">{etiqueta}</span>
      {children}
      {ayuda && <span className="campo-ayuda">{ayuda}</span>}
    </label>
  );
}

export interface ItemNav { a: string; texto: string; icono: string; fin?: boolean }

export function Marco({ titulo, nav, children }: { titulo: string; nav: ItemNav[]; children: ReactNode }) {
  const ir = useNavigate();
  const s = api.sesion();
  return (
    <div className="marco">
      <header className="barra">
        <div>
          <div className="barra-marca">{NOMBRE_APP}{api.modo === 'demo' && <span className="barra-demo">DEMO</span>}</div>
          <h1>{titulo}</h1>
          {s?.condominio && <div className="barra-condominio">{s.condominio}{s.unidad ? ` · ${s.unidad}` : ''}</div>}
        </div>
        <div className="barra-acciones">
          {s && <Campana />}
          <button className="btn-texto" onClick={() => ir('/cuenta')} title="Mi cuenta">
            {s?.nombre.split(' ')[0]} ▾
          </button>
        </div>
      </header>
      <main className="contenido">{children}</main>
      <nav className="nav-inferior" style={{ gridTemplateColumns: `repeat(${nav.length}, 1fr)` }}>
        {nav.map((n) => (
          <NavLink key={n.a} to={n.a} end={n.fin} className={({ isActive }) => (isActive ? 'activo' : '')}>
            <span className="nav-icono"><Icono nombre={n.icono} /></span>
            <span>{n.texto}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="vacio">{children}</p>;
}
