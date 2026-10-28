import { useEffect, useState, type ReactNode } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './data';
import { Campo } from './ui';
import { ROLES } from './formato';
import { Resumen } from './pantallas/Resumen';
import { Condominios, DetalleCondominio } from './pantallas/Condominios';
import { Alta } from './pantallas/Alta';
import { Facturacion } from './pantallas/Facturacion';
import { Planes } from './pantallas/Planes';
import { Equipo, Soporte } from './pantallas/Soporte';

const MENU = [
  { a: '/', texto: 'Resumen', fin: true },
  { a: '/condominios', texto: 'Condominios' },
  { a: '/alta', texto: 'Alta de condominio' },
  { a: '/facturacion', texto: 'Facturación' },
  { a: '/planes', texto: 'Planes y precios' },
  { a: '/soporte', texto: 'Soporte' },
  { a: '/equipo', texto: 'Equipo' },
];

function Marco({ children }: { children: ReactNode }) {
  const ir = useNavigate();
  const s = api.sesion();
  if (!s) return <Navigate to="/entrar" replace />;
  return (
    <div className="marco">
      <aside className="lateral">
        <div className="lateral-marca">
          <span>ZentaPro</span>
          <strong>Consola condominios {api.modo === 'demo' && <span className="demo">DEMO</span>}</strong>
        </div>
        <nav aria-label="Menú principal">
          {MENU.map((m) => <NavLink key={m.a} to={m.a} end={m.fin} className={({ isActive }) => (isActive ? 'activo' : '')}>{m.texto}</NavLink>)}
        </nav>
        <div className="lateral-pie">
          <span className="quien">{s.nombre} · {ROLES[s.rol]}</span>
          <button onClick={async () => { await api.salir(); ir('/entrar'); }}>Salir</button>
        </div>
      </aside>
      <main className="principal">{children}</main>
    </div>
  );
}

function Entrar() {
  const ir = useNavigate();
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  async function entrar(d: Parameters<typeof api.entrar>[0]) {
    setError(null); setCargando(true);
    try { await api.entrar(d); ir('/', { replace: true }); } catch (e) { setError((e as Error).message); } finally { setCargando(false); }
  }
  return (
    <div className="entrar">
      <div className="entrar-caja">
        <div className="marca-zp" aria-hidden>ZP</div>
        <div><h1>Consola ZentaPro</h1><p className="txt-2">Administración de todos los condominios de ZPro Condominio.</p></div>
        {api.modo === 'demo' ? (
          <>
            <p className="nota">Modo demostración con datos ficticios.</p>
            <button className="btn" disabled={cargando} onClick={() => entrar({ demo: true })}>Entrar como ZentaPro (dueño)</button>
          </>
        ) : (
          <form className="formulario" onSubmit={(e) => { e.preventDefault(); entrar({ correo, clave }); }}>
            <Campo etiqueta="Correo"><input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required autoComplete="email" /></Campo>
            <Campo etiqueta="Clave"><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required autoComplete="current-password" /></Campo>
            <button className="btn" disabled={cargando}>{cargando ? 'Entrando…' : 'Entrar'}</button>
          </form>
        )}
        {error && <div className="aviso aviso-error">{error}</div>}
        <p className="nota">Solo personal de Technical Digital TD, C.A.</p>
      </div>
    </div>
  );
}

export default function App() {
  const [listo, setListo] = useState(false);
  useEffect(() => { api.restaurar().catch(() => null).finally(() => setListo(true)); }, []);
  if (!listo) return <div className="cargando">Cargando…</div>;
  return (
    <HashRouter>
      <Routes>
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/" element={<Marco><Resumen /></Marco>} />
        <Route path="/condominios" element={<Marco><Condominios /></Marco>} />
        <Route path="/condominios/:id" element={<Marco><DetalleCondominio /></Marco>} />
        <Route path="/alta" element={<Marco><Alta /></Marco>} />
        <Route path="/facturacion" element={<Marco><Facturacion /></Marco>} />
        <Route path="/planes" element={<Marco><Planes /></Marco>} />
        <Route path="/soporte" element={<Marco><Soporte /></Marco>} />
        <Route path="/equipo" element={<Marco><Equipo /></Marco>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
