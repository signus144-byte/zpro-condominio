import { useEffect, useState, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './data';
import { Marco, type ItemNav } from './components/ui';
import { EstadoCuentaResidente, InicioResidente, ReportarPago } from './screens/residente/Residente';
import { Gastos, PagosPresidencia, Panel, Unidades } from './screens/presidencia/Presidencia';
import { NuevoReporte, Partidas, Reportes } from './screens/Compartidas';
import { Chats } from './screens/chat/Chats';
import { SalaChat } from './screens/chat/SalaChat';
import { Directorio } from './screens/chat/Directorio';
import { NuevaSala } from './screens/chat/NuevaSala';
import { Marca } from './screens/presidencia/Marca';
import { Mas } from './screens/presidencia/Mas';
import { DocumentosPresidencia, DocumentosResidente } from './screens/Documentos';
import { ElegirCondominio, Entrar, MiCuenta, OlvideClave, Registro, RestablecerClave, Unirme, VerificarCorreo } from './screens/cuenta/Cuenta';
import { Accesos, AdminAvisos, Conciliacion, FacturaZentaPro, TasaBcv } from './screens/presidencia/Admin';
import { destino } from './navegacion';
import { Notificaciones } from './components/notificaciones';
import { ChatVecinos } from './screens/presidencia/Admin';
import { CapaAlarma, ConfigAlertaJunta, DetalleAlerta, HistorialAlertas, Participacion, Sos } from './screens/alerta/Alerta';
import { Invitar } from './screens/presidencia/Invitar';
import { Invitacion } from './screens/cuenta/Invitacion';
import { SoloOtraApp } from './screens/cuenta/Cuenta';
import { SABOR } from './sabor';
import { escucharEnlaces, iniciarNativo } from './nativo';

const NAV_RESIDENTE: ItemNav[] = [
  { a: '/r', texto: 'Inicio', icono: 'inicio', fin: true },
  { a: '/r/cuenta', texto: 'Mi cuenta', icono: 'cuenta' },
  { a: '/r/pagar', texto: 'Pagar', icono: 'pagar' },
  { a: '/r/chats', texto: 'Chat', icono: 'chat' },
  { a: '/r/reportes', texto: 'Reportes', icono: 'reportes' },
  { a: '/r/partidas', texto: 'Votos', icono: 'partidas' },
];
const NAV_PRESIDENCIA: ItemNav[] = [
  { a: '/p', texto: 'Panel', icono: 'panel', fin: true },
  { a: '/p/pagos', texto: 'Pagos', icono: 'pagos' },
  { a: '/p/gastos', texto: 'Gastos', icono: 'gastos' },
  { a: '/p/chats', texto: 'Chat', icono: 'chat' },
  { a: '/p/reportes', texto: 'Reportes', icono: 'reportes' },
  { a: '/p/mas', texto: 'Más', icono: 'mas' },
];

/** ¿Puede esta app (según su sabor) mostrar la pantalla? Si no, a dónde va. */
function redireccion(junta: boolean): string | null {
  const s = api.sesion();
  if (!s) return destino();
  if (SABOR === 'admin') return !s.esJunta ? '/solo-junta' : junta ? null : '/p';
  if (SABOR === 'miembros') return !s.unidadId ? '/solo-miembros' : junta ? '/r' : null;
  if (junta && !s.esJunta) return '/r';
  if (!junta && !s.unidadId) return '/p';
  return null;
}

function Protegida({ junta, titulo, children }: { junta: boolean; titulo: string; children: ReactNode }) {
  const a = redireccion(junta);
  if (a) return <Navigate to={a} replace />;
  return <Marco titulo={titulo} nav={junta ? NAV_PRESIDENCIA : NAV_RESIDENTE}>{children}</Marco>;
}

/** Pantallas de la alerta vecinal: en la sección del rol que se está viendo (/r residente, /p junta). */
function rutasAlerta(p: '/r' | '/p') {
  const junta = p === '/p';
  return [
    <Route key={`${p}sos`} path={`${p}/sos`} element={<Protegida junta={junta} titulo="Alerta vecinal · SOS"><Sos /></Protegida>} />,
    <Route key={`${p}al`} path={`${p}/alertas`} element={<Protegida junta={junta} titulo="Alertas vecinales"><HistorialAlertas /></Protegida>} />,
    <Route key={`${p}ad`} path={`${p}/alertas/:id`} element={<Protegida junta={junta} titulo="Alerta vecinal"><DetalleAlerta /></Protegida>} />,
    <Route key={`${p}av`} path={`${p}/alerta-vecinal`} element={<Protegida junta={junta} titulo="Alerta vecinal"><Participacion /></Protegida>} />,
  ];
}

// Pantalla completa (sin barra ni navegación), p. ej. la sala de chat.
function ProtegidaSola({ junta, children }: { junta: boolean; children: ReactNode }) {
  const a = redireccion(junta);
  if (a) return <Navigate to={a === '/r' || a === '/p' ? `${a}/chats` : a} replace />;
  return <>{children}</>;
}

/** Requiere haber iniciado sesión (aunque todavía no pertenezca a un condominio). */
function ConCuenta({ children }: { children: ReactNode }) {
  return api.cuenta() ? <>{children}</> : <Navigate to="/entrar" replace />;
}

/** "Mi cuenta": con la barra del rol si ya está dentro de un condominio; sola si no. */
function PaginaCuenta() {
  const s = api.sesion();
  if (!api.cuenta()) return <Navigate to="/entrar" replace />;
  if (!s) return <div className="contenido"><MiCuenta /></div>;
  const comoJunta = SABOR === 'admin' || (SABOR === 'completa' && s.esJunta);
  return <Marco titulo="Mi cuenta" nav={comoJunta ? NAV_PRESIDENCIA : NAV_RESIDENTE}><MiCuenta /></Marco>;
}

export default function App() {
  const [listo, setListo] = useState(false);
  useEffect(() => {
    void iniciarNativo();
    void escucharEnlaces();
    api.restaurar().catch(() => null).finally(() => setListo(true));
  }, []);
  if (!listo) return <div className="cargando">Cargando…</div>;

  return (
    <HashRouter>
      <CapaAlarma />
      <Routes>
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/registro" element={<Registro />} />
        <Route path="/olvide" element={<OlvideClave />} />
        <Route path="/restablecer" element={<RestablecerClave />} />
        <Route path="/verificar-correo" element={<VerificarCorreo />} />
        <Route path="/unirme" element={<ConCuenta><Unirme /></ConCuenta>} />
        <Route path="/elegir" element={<ConCuenta><ElegirCondominio /></ConCuenta>} />
        <Route path="/cuenta" element={<PaginaCuenta />} />
        <Route path="/invitacion/:codigo" element={<Invitacion />} />
        <Route path="/solo-junta" element={api.sesion() ? <SoloOtraApp cual="junta" /> : <Navigate to="/entrar" replace />} />
        <Route path="/solo-miembros" element={api.sesion() ? <SoloOtraApp cual="miembros" /> : <Navigate to="/entrar" replace />} />
        {rutasAlerta('/r')}
        {rutasAlerta('/p')}
        <Route path="/p/alerta" element={<Protegida junta titulo="Alerta vecinal · configuración"><ConfigAlertaJunta /></Protegida>} />
        <Route path="/p/invitar" element={<Protegida junta titulo="Invitar vecinos"><Invitar /></Protegida>} />
        <Route path="/r" element={<Protegida junta={false} titulo="Mi condominio"><InicioResidente /></Protegida>} />
        <Route path="/r/cuenta" element={<Protegida junta={false} titulo="Estado de cuenta"><EstadoCuentaResidente /></Protegida>} />
        <Route path="/r/pagar" element={<Protegida junta={false} titulo="Reportar pago"><ReportarPago /></Protegida>} />
        <Route path="/r/reportes" element={<Protegida junta={false} titulo="Reportes"><Reportes /></Protegida>} />
        <Route path="/r/reportes/nuevo" element={<Protegida junta={false} titulo="Nuevo reporte"><NuevoReporte /></Protegida>} />
        <Route path="/r/partidas" element={<Protegida junta={false} titulo="Partidas y votaciones"><Partidas /></Protegida>} />
        <Route path="/r/chats" element={<Protegida junta={false} titulo="Chat"><Chats /></Protegida>} />
        <Route path="/r/chats/:id" element={<ProtegidaSola junta={false}><SalaChat /></ProtegidaSola>} />
        <Route path="/r/directorio" element={<Protegida junta={false} titulo="Directorio de casas"><Directorio /></Protegida>} />
        <Route path="/r/notificaciones" element={<Protegida junta={false} titulo="Notificaciones"><Notificaciones /></Protegida>} />
        <Route path="/r/documentos" element={<Protegida junta={false} titulo="Documentos"><DocumentosResidente /></Protegida>} />
        <Route path="/p" element={<Protegida junta titulo="Panel financiero"><Panel /></Protegida>} />
        <Route path="/p/pagos" element={<Protegida junta titulo="Pagos"><PagosPresidencia /></Protegida>} />
        <Route path="/p/gastos" element={<Protegida junta titulo="Gastos y recibos"><Gastos /></Protegida>} />
        <Route path="/p/unidades" element={<Protegida junta titulo="Apartamentos"><Unidades /></Protegida>} />
        <Route path="/p/reportes" element={<Protegida junta titulo="Reportes recibidos"><Reportes /></Protegida>} />
        <Route path="/p/partidas" element={<Protegida junta titulo="Partidas especiales"><Partidas /></Protegida>} />
        <Route path="/p/chats" element={<Protegida junta titulo="Chat"><Chats /></Protegida>} />
        <Route path="/p/chats/:id" element={<ProtegidaSola junta><SalaChat /></ProtegidaSola>} />
        <Route path="/p/directorio" element={<Protegida junta titulo="Directorio de casas"><Directorio /></Protegida>} />
        <Route path="/p/salas/nueva" element={<Protegida junta titulo="Nueva sala"><NuevaSala /></Protegida>} />
        <Route path="/p/documentos" element={<Protegida junta titulo="Documentos"><DocumentosPresidencia /></Protegida>} />
        <Route path="/p/marca" element={<Protegida junta titulo="Marca del condominio"><Marca /></Protegida>} />
        <Route path="/p/mas" element={<Protegida junta titulo="Más opciones"><Mas /></Protegida>} />
        <Route path="/p/accesos" element={<Protegida junta titulo="Accesos de vecinos"><Accesos /></Protegida>} />
        <Route path="/p/conciliacion" element={<Protegida junta titulo="Conciliación bancaria"><Conciliacion /></Protegida>} />
        <Route path="/p/zentapro" element={<Protegida junta titulo="Mensualidad de ZentaPro"><FacturaZentaPro /></Protegida>} />
        <Route path="/p/avisos" element={<Protegida junta titulo="Avisos"><AdminAvisos /></Protegida>} />
        <Route path="/p/notificaciones" element={<Protegida junta titulo="Notificaciones"><Notificaciones /></Protegida>} />
        <Route path="/p/chat-vecinos" element={<Protegida junta titulo="Chat entre vecinos"><ChatVecinos /></Protegida>} />
        <Route path="/p/tasa" element={<Protegida junta titulo="Tasa BCV"><TasaBcv /></Protegida>} />
        <Route path="*" element={<Navigate to={destino()} replace />} />
      </Routes>
    </HashRouter>
  );
}
