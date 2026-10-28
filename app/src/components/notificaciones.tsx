// Notificaciones: contador de no leídas (campana de la barra), aviso emergente al llegar una nueva
// y la pantalla con la lista. Llegan en vivo (WebSocket en servidor; local en la demostración).
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type Notificacion } from '../data';
import { hace } from '../formato';
import { Estado, Vacio } from './ui';
import { Icono } from './iconos';
import { SABOR } from '../sabor';

const EVENTO_CAMBIO = 'zpro:notificaciones';
/** Avisa a la campana que cambió el estado de leídas (para recontar). */
export const avisarCambioNotificaciones = () => window.dispatchEvent(new Event(EVENTO_CAMBIO));

/** Prefijo de rutas del rol que se está viendo ('/r' residente, '/p' junta). */
export function usePrefijo() {
  const { pathname } = useLocation();
  const s = api.sesion();
  if (SABOR === 'admin') return '/p';
  if (SABOR === 'miembros') return '/r';
  if (pathname.startsWith('/r')) return '/r';
  if (pathname.startsWith('/p')) return '/p';
  return s?.esJunta ? '/p' : '/r';
}

/** A qué pantalla lleva una notificación. */
export function destinoNotificacion(n: Notificacion, prefijo: string): string {
  const s = api.sesion();
  switch (n.datos.pantalla) {
    case 'pagos': return s?.manejaFinanzas ? '/p/pagos' : `${prefijo}`;
    case 'estado-cuenta': return s?.unidadId ? '/r/cuenta' : prefijo;
    case 'chat': return `${prefijo}/chats`;
    case 'alerta': return n.datos.alertaId ? `${prefijo}/alertas/${n.datos.alertaId}` : `${prefijo}/alerta-vecinal`;
    case 'accesos': return s?.esJunta && SABOR !== 'miembros' ? '/p/accesos' : prefijo;
    default: return prefijo;
  }
}

export function Campana() {
  const ir = useNavigate();
  const prefijo = usePrefijo();
  const [noLeidas, setNoLeidas] = useState(0);
  const [emergente, setEmergente] = useState<Notificacion | null>(null);

  const contar = useCallback(() => {
    if (!api.sesion()) return;
    api.notificaciones().then((b) => setNoLeidas(b.noLeidas)).catch(() => {});
  }, []);

  useEffect(() => {
    contar();
    let t: ReturnType<typeof setTimeout> | null = null;
    const quitar = api.suscribirNotificaciones((n) => {
      setNoLeidas((x) => x + 1);
      if (n.tipo === 'alerta') return;            // la alerta vecinal ya se muestra a pantalla completa
      setEmergente(n);
      if (t) clearTimeout(t);
      t = setTimeout(() => setEmergente(null), 6000);
    });
    window.addEventListener(EVENTO_CAMBIO, contar);
    const alVolver = () => { if (document.visibilityState === 'visible') contar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      quitar(); if (t) clearTimeout(t);
      window.removeEventListener(EVENTO_CAMBIO, contar);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [contar]);

  async function abrirEmergente(n: Notificacion) {
    setEmergente(null);
    await api.marcarNotificaciones([n.id]).catch(() => {});
    avisarCambioNotificaciones();
    ir(destinoNotificacion(n, prefijo));
  }

  return (
    <>
      <button className="campana" onClick={() => ir(`${prefijo}/notificaciones`)}
              aria-label={noLeidas ? `Notificaciones: ${noLeidas} sin leer` : 'Notificaciones'} title="Notificaciones">
        <Icono nombre="campana" />
        {noLeidas > 0 && <span className="campana-globo" aria-hidden>{noLeidas > 99 ? '99+' : noLeidas}</span>}
      </button>
      {emergente && (
        <div className="emergente" role="status">
          <button className="emergente-cuerpo" onClick={() => void abrirEmergente(emergente)}>
            <strong>{emergente.titulo}</strong>
            <span>{emergente.cuerpo}</span>
          </button>
          <button className="emergente-cerrar" aria-label="Cerrar" onClick={() => setEmergente(null)}>×</button>
        </div>
      )}
    </>
  );
}

const TONO: Record<Notificacion['tipo'], string> = {
  pago_confirmado: 'ok', pago_rechazado: 'error', pago_reportado: 'info', pagos_pendientes: 'alerta', chat_vecinos: 'info', general: 'info',
  alerta: 'error', alerta_cerrada: 'ok', solicitud_ingreso: 'alerta',
};

export function Notificaciones() {
  const ir = useNavigate();
  const prefijo = usePrefijo();
  const [lista, setLista] = useState<Notificacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    api.notificaciones().then((b) => { setLista(b.notificaciones); setError(null); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    cargar();
    return api.suscribirNotificaciones((n) => setLista((l) => (l && !l.some((x) => x.id === n.id) ? [n, ...l] : l)));
  }, [cargar]);

  async function abrir(n: Notificacion) {
    if (!n.leida) {
      setLista((l) => l?.map((x) => (x.id === n.id ? { ...x, leida: true } : x)) ?? l);
      await api.marcarNotificaciones([n.id]).catch(() => {});
      avisarCambioNotificaciones();
    }
    ir(destinoNotificacion(n, prefijo));
  }
  async function todas() {
    await api.marcarNotificaciones().catch(() => {});
    setLista((l) => l?.map((x) => ({ ...x, leida: true })) ?? l);
    avisarCambioNotificaciones();
  }

  const hayNoLeidas = lista?.some((n) => !n.leida);
  return (
    <Estado cargando={!lista && !error} error={error}>
      {hayNoLeidas && <button className="btn-texto" style={{ alignSelf: 'flex-end' }} onClick={() => void todas()}>Marcar todas como leídas</button>}
      {lista?.length ? (
        <ul className="notif-lista tarjeta">
          {lista.map((n) => (
            <li key={n.id}>
              <button className={`notif ${n.leida ? '' : 'notif-nueva'}`} onClick={() => void abrir(n)}>
                <span className={`notif-punto notif-${TONO[n.tipo]}`} aria-hidden />
                <span className="notif-texto">
                  <strong>{n.titulo}</strong>
                  <span>{n.cuerpo}</span>
                  <small>{hace(n.creadoEn)}{!n.leida && ' · nueva'}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <Vacio>No tiene notificaciones. Aquí le avisaremos cuando la junta apruebe o rechace un pago.</Vacio>}
    </Estado>
  );
}
