// Alerta vecinal: botón SOS, emitir (4 botones grandes + huella/patrón o clave), alarma a pantalla completa,
// detalle con las respuestas de los vecinos, participación voluntaria y configuración de la junta.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, type AlertaVecinal, type ConfigAlerta, type EstadoAlerta, type RespuestaAlerta, type TipoAlerta } from '../../data';
import { Campo, Estado, Etiqueta, Tarjeta, Vacio, useCarga } from '../../components/ui';
import { usePrefijo } from '../../components/notificaciones';
import { hace } from '../../formato';
import { confirmarIdentidad, esNativo, notificarAlarmaLocal, reenviarTokenPush, vibrarAlarma } from '../../nativo';
import './alerta.css';

export const TIPOS: Record<TipoAlerta, { titulo: string; detalle: string; icono: string }> = {
  seguridad: { titulo: 'Seguridad', detalle: 'Robo, intruso, violencia', icono: '🚓' },
  medica: { titulo: 'Emergencia médica', detalle: 'Desmayo, caída, dolor fuerte', icono: '🚑' },
  incendio: { titulo: 'Incendio', detalle: 'Fuego o humo. Avisa a todo el condominio', icono: '🔥' },
  otra: { titulo: 'Otra emergencia', detalle: 'Fuga de gas, inundación, accidente', icono: '⚠️' },
};
const TITULO_ALERTA: Record<TipoAlerta, string> = {
  seguridad: 'Emergencia de seguridad', medica: 'Emergencia médica', incendio: 'Incendio', otra: 'Emergencia',
};
export const RESPUESTAS: Record<RespuestaAlerta, string> = {
  voy: 'Voy en camino', vehiculo: 'Tengo vehículo disponible', llamo_autoridades: 'Llamé a las autoridades', no_puedo: 'No puedo ayudar',
};
const ESTADOS: Record<EstadoAlerta, string> = {
  activa: 'Activa', atendida: 'Atendida', falsa_alarma: 'Falsa alarma', cancelada: 'Cancelada', vencida: 'Cerrada sola (3 h)',
};
const telefono = (t: string) => `tel:${t.replace(/[^\d+]/g, '')}`;
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' });

// ---------------- Botón SOS (inicio del residente y panel de la junta) ----------------
export function BotonSOS() {
  const prefijo = usePrefijo();
  const ir = useNavigate();
  const { datos, recargar } = useCarga(() => api.configAlerta());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => api.suscribirAlertas(() => recargar()), [recargar]);
  if (!datos?.redActiva) return null;
  const tieneCasa = !!api.sesion()?.unidadId;
  return (
    <section className="tarjeta" style={{ gap: 10 }}>
      {tieneCasa ? (
        <Link to={`${prefijo}/sos`} className="sos-boton" aria-label="SOS: pedir ayuda a los vecinos">
          <span className="sos-circulo" aria-hidden>SOS</span>
          <span><strong>Alerta vecinal</strong><small>Pedir ayuda a sus vecinos y a la junta ante una emergencia</small></span>
        </Link>
      ) : (
        <div className="sos-junta">
          <span className="sos-circulo" aria-hidden>SOS</span>
          <span><strong>Alerta vecinal activa</strong><small>La junta recibe todas las alertas de emergencia del condominio.</small></span>
        </div>
      )}
      {datos.alertasActivas > 0 && (
        <Link to={`${prefijo}/alertas`} className="sos-activas">
          <span>🚨 {datos.alertasActivas === 1 ? '1 alerta activa' : `${datos.alertasActivas} alertas activas`}</span><span aria-hidden>›</span>
        </Link>
      )}
      <div className="sos-pie">
        <Link to={tieneCasa ? `${prefijo}/alerta-vecinal` : `${prefijo}/alertas`} className="btn-texto">
          {tieneCasa ? (datos.participacion?.activo ? 'Participa en la alerta vecinal ✓' : 'Inscribirme para avisar y recibir alertas') : 'Ver alertas'}
        </Link>
        {api.simularAlertaVecino && (
          <button className="btn-texto" onClick={() => { setError(null); api.simularAlertaVecino!().catch((e: Error) => setError(e.message)); }}>
            Simular alerta de un vecino
          </button>
        )}
      </div>
      {error && <div className="aviso aviso-error">{error} {error.includes('Inscríbase') && <button className="btn-texto" onClick={() => ir(`${prefijo}/alerta-vecinal`)}>Inscribirme</button>}</div>}
    </section>
  );
}

// ---------------- Emitir una alerta ----------------
export function Sos() {
  const ir = useNavigate();
  const prefijo = usePrefijo();
  const { datos: cfg, cargando, error: errCfg } = useCarga(() => api.configAlerta());
  const [tipo, setTipo] = useState<TipoAlerta | null>(null);
  const [nota, setNota] = useState('');
  const [pideClave, setPideClave] = useState(!esNativo());
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (!tipo) return;
    setError(null); setEnviando(true);
    try {
      let verificacion: 'biometria' | 'clave' = 'clave';
      if (!pideClave) {
        const r = await confirmarIdentidad(`Enviar alerta: ${TIPOS[tipo].titulo}`);
        if (r === 'no_disponible') { setPideClave(true); setEnviando(false); setError('Este teléfono no tiene huella ni patrón: escriba la clave de su cuenta para confirmar.'); return; }
        verificacion = 'biometria';
      } else if (!clave) { setEnviando(false); return setError('Escriba su clave para confirmar que es usted.'); }
      const a = await api.emitirAlerta({ tipo, nota: nota.trim() || undefined, verificacion, clave: verificacion === 'clave' ? clave : undefined });
      ir(`${prefijo}/alertas/${a.id}`, { replace: true });
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  }

  return (
    <Estado cargando={cargando} error={errCfg}>
      {cfg && !cfg.puedoEmitir ? (
        <Tarjeta titulo="No puede enviar una alerta ahora">
          <p>{cfg.motivoNoPuede}</p>
          <div className="fila-botones">
            {!cfg.participacion?.activo && <Link className="btn" to={`${prefijo}/alerta-vecinal`}>Inscribirme en la alerta vecinal</Link>}
            <Link className="btn btn-sec" to={`${prefijo}/alertas`}>Ver alertas</Link>
          </div>
          <Llamar911 />
        </Tarjeta>
      ) : (
        <>
          <p className="subtitulo">¿Qué está pasando? Toque una opción.</p>
          <div className="sos-grid" role="radiogroup" aria-label="Tipo de emergencia">
            {(Object.keys(TIPOS) as TipoAlerta[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={tipo === t}
                      className={`sos-tipo t-${t} ${tipo === t ? 'elegido' : ''}`} onClick={() => setTipo(t)}>
                <span className="sos-icono" aria-hidden>{TIPOS[t].icono}</span>
                <strong>{TIPOS[t].titulo}</strong>
                <small>{TIPOS[t].detalle}</small>
              </button>
            ))}
          </div>
          {tipo && (
            <Tarjeta>
              <Campo etiqueta="Detalle (opcional)" ayuda="Corto y claro: qué pasa y dónde.">
                <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300}
                       placeholder={tipo === 'medica' ? 'Ej.: Mi papá se desmayó' : tipo === 'seguridad' ? 'Ej.: Hay alguien extraño en el estacionamiento' : 'Ej.: Sale humo de la cocina'} />
              </Campo>
              <div className="sos-responsable">
                La alerta sale con <strong>su nombre y su casa ({api.sesion()?.unidad})</strong>. Usted responde por que sea verdad.
                {tipo === 'incendio' ? ' Sonará en todo el condominio' : ` Sonará en las casas cercanas (${cfg?.radio === 0 ? 'todo el condominio' : `${cfg?.radio} a cada lado`})`}, en su familia y en la junta.
              </div>
              {pideClave && (
                <Campo etiqueta="Su clave" ayuda={api.modo === 'demo' ? 'En la demostración cualquier clave sirve.' : 'Para confirmar que es usted quien pide ayuda.'}>
                  <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" />
                </Campo>
              )}
              {error && <div className="aviso aviso-error">{error}</div>}
              <button className="btn btn-ancho sos-enviar" disabled={enviando} onClick={() => void enviar()}>
                {enviando ? 'Enviando…' : pideClave ? '🚨 Enviar alerta' : '🚨 Confirmar con huella o patrón y enviar'}
              </button>
            </Tarjeta>
          )}
          <Llamar911 />
        </>
      )}
    </Estado>
  );
}

function Llamar911() {
  return (
    <div className="aviso aviso-error sos-911">
      <span>Si hay peligro de vida, llame también al <strong>911</strong>.</span>
      <a className="btn-llamar" href="tel:911">Llamar 911</a>
    </div>
  );
}

// ---------------- Alarma a pantalla completa (en toda la app) ----------------
const atendidasGlobal = new Set<string>();     // ya respondidas, vistas en detalle o cerradas en este teléfono
export function CapaAlarma() {
  useLocation();                                 // se vuelve a evaluar al navegar (p. ej. al iniciar sesión)
  const conSesion = !!api.sesion();
  const ir = useNavigate();
  const prefijo = usePrefijo();
  const [alerta, setAlerta] = useState<AlertaVecinal | null>(null);
  const [silenciada, setSilenciada] = useState(false);
  const [necesitaToque, setNecesitaToque] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const atendidas = useRef(atendidasGlobal);
  const actual = useRef<string | null>(null);

  const sonar = useCallback((activo: boolean) => {
    if (!activo) {
      audio.current?.pause();
      vibrarAlarma(false);
      return;
    }
    if (!audio.current) { audio.current = new Audio('./sonidos/alarma.wav'); audio.current.loop = true; }
    audio.current.currentTime = 0;
    audio.current.volume = 1;
    audio.current.play().then(() => setNecesitaToque(false)).catch(() => setNecesitaToque(true));
    vibrarAlarma(true);
  }, []);

  const cerrar = useCallback(() => {
    sonar(false);
    if (actual.current) atendidas.current.add(actual.current);
    actual.current = null;
    setAlerta(null); setSilenciada(false); setError(null);
  }, [sonar]);

  const abrir = useCallback(async (id: string) => {
    if (atendidas.current.has(id) || actual.current === id) return;
    let a: AlertaVecinal;
    try { a = await api.alerta(id); } catch { return; }
    if (a.estado !== 'activa' || a.soyEmisor || !a.puedoResponder || a.miRespuesta) return;
    actual.current = id;
    setAlerta(a); setSilenciada(false);
    sonar(true);
    void api.marcarAlertaVista(id).catch(() => undefined);
    if (document.visibilityState === 'hidden') {
      void notificarAlarmaLocal(`🚨 ${TITULO_ALERTA[a.tipo]} en ${a.emisor.unidad}`, `${a.emisor.nombre} pide ayuda.${a.nota ? ` «${a.nota}»` : ''}`, a.id);
    }
  }, [sonar]);

  const revisarActivas = useCallback(async () => {
    if (!api.sesion() || actual.current) return;
    try {
      const activas = await api.alertas(true);
      const pendiente = activas.find((a) => a.puedoResponder && !a.miRespuesta && !a.soyEmisor && !atendidas.current.has(a.id));
      if (pendiente) await abrir(pendiente.id);
    } catch { /* sin conexión */ }
  }, [abrir]);

  useEffect(() => {
    if (!conSesion) return;
    reenviarTokenPush();
    const q1 = api.suscribirNotificaciones((n) => { if (n.tipo === 'alerta' && n.datos.alertaId) void abrir(n.datos.alertaId); });
    const q2 = api.suscribirAlertas((e) => {
      if (e.evento === 'nueva' || e.evento === 'ampliada') void abrir(e.alertaId);
      if (e.evento === 'cerrada' && actual.current === e.alertaId) cerrar();
    });
    void revisarActivas();
    const alVolver = () => { if (document.visibilityState === 'visible') void revisarActivas(); };
    document.addEventListener('visibilitychange', alVolver);
    let quitarResume: (() => void) | null = null;
    if (esNativo()) {
      void import('@capacitor/app').then(({ App }) => App.addListener('resume', () => void revisarActivas()))
        .then((h) => { quitarResume = () => void h.remove(); }).catch(() => undefined);
    }
    return () => { q1(); q2(); document.removeEventListener('visibilitychange', alVolver); quitarResume?.(); };
  }, [abrir, cerrar, revisarActivas, conSesion]);

  useEffect(() => () => sonar(false), [sonar]);

  if (!alerta) return null;
  async function responder(r: RespuestaAlerta) {
    setError(null);
    try {
      await api.responderAlerta(alerta!.id, r);
      const id = alerta!.id;
      cerrar();
      ir(`${prefijo}/alertas/${id}`);
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <div className={`alarma-capa ${silenciada ? 'silenciada' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="alarma-titulo">
      <div className="alarma-caja">
        <div className="alarma-cab">
          <span className="sos-icono" aria-hidden>{TIPOS[alerta.tipo].icono}</span>
          <div>
            <h2 id="alarma-titulo">{TITULO_ALERTA[alerta.tipo]}</h2>
            <small>{alerta.emisor.unidad} · {hora(alerta.creadoEn)} ({hace(alerta.creadoEn)})</small>
          </div>
        </div>
        <div className="alarma-quien">
          <strong>{alerta.emisor.nombre} · {alerta.emisor.unidad}</strong>
          <small>pide ayuda{alerta.alcance === 'todos' ? ' a todo el condominio' : ' a sus vecinos cercanos'}</small>
          {alerta.nota && <p className="alarma-nota">«{alerta.nota}»</p>}
        </div>
        {necesitaToque && !silenciada && (
          <button className="alarma-tocar" onClick={() => sonar(true)}>🔊 Tocar para escuchar la alarma</button>
        )}
        <div className="alarma-respuestas">
          <button onClick={() => void responder('voy')}>🏃 {RESPUESTAS.voy}</button>
          <button onClick={() => void responder('vehiculo')}>🚗 {RESPUESTAS.vehiculo}</button>
          <button onClick={() => void responder('llamo_autoridades')}>📞 {RESPUESTAS.llamo_autoridades}</button>
          <button className="no" onClick={() => void responder('no_puedo')}>{RESPUESTAS.no_puedo}</button>
        </div>
        {error && <div className="aviso aviso-error">{error}</div>}
        <div className="alarma-acciones">
          {alerta.emisor.telefono
            ? <a className="llamar" href={telefono(alerta.emisor.telefono)}>📞 Llamar a {alerta.emisor.nombre.split(' ')[0]}</a>
            : <a className="llamar" href="tel:911">📞 Llamar 911</a>}
          {!silenciada
            ? <button onClick={() => { setSilenciada(true); sonar(false); }}>🔇 Silenciar</button>
            : <button onClick={() => { const id = alerta.id; cerrar(); ir(`${prefijo}/alertas/${id}`); }}>Ver detalle</button>}
        </div>
        <small>La junta ya fue avisada. Responda para que {alerta.emisor.nombre.split(' ')[0]} sepa quién va.</small>
      </div>
    </div>
  );
}

// ---------------- Detalle de una alerta ----------------
export function DetalleAlerta() {
  const { id = '' } = useParams();
  const { datos: a, cargando, error, recargar } = useCarga(() => api.alerta(id), [id]);
  const [nota, setNota] = useState('');
  const [errAccion, setErrAccion] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => api.suscribirAlertas((e) => { if (e.alertaId === id) recargar(); }), [id, recargar]);
  useEffect(() => { if (a?.puedoResponder) void api.marcarAlertaVista(id).catch(() => undefined); }, [a?.puedoResponder, id]);
  const s = api.sesion();

  async function accion(fn: () => Promise<unknown>) {
    setErrAccion(null); setOcupado(true);
    try { await fn(); recargar(); } catch (e) { setErrAccion((e as Error).message); } finally { setOcupado(false); }
  }

  return (
    <Estado cargando={cargando} error={error}>
      {a && (
        <>
          <div className={`alerta-cab t-${a.tipo} ${a.estado !== 'activa' ? 'cerrada' : ''}`}>
            <Etiqueta tono={a.estado === 'activa' ? 'error' : a.estado === 'atendida' ? 'ok' : 'neutro'}>{ESTADOS[a.estado]}</Etiqueta>
            <h2>{TIPOS[a.tipo].icono} {TITULO_ALERTA[a.tipo]} en {a.emisor.unidad}</h2>
            <small>{a.soyEmisor ? 'Usted pidió ayuda' : `${a.emisor.nombre} pidió ayuda`} · {hora(a.creadoEn)} ({hace(a.creadoEn)})
              {' · '}{a.alcance === 'todos' ? 'aviso a todo el condominio' : 'aviso a las casas cercanas'}</small>
            {a.nota && <p className="alarma-nota">«{a.nota}»</p>}
            {a.notaCierre && <small>Cierre: {a.notaCierre}</small>}
          </div>

          <div className="cifras">
            <div className="cifra"><span className="cifra-etq">Avisados</span><strong className="cifra-valor">{a.destinatarios}</strong></div>
            <div className="cifra"><span className="cifra-etq">Ya la vieron</span><strong className="cifra-valor">{a.vistos}</strong></div>
            <div className="cifra cifra-ok"><span className="cifra-etq">Van a ayudar</span>
              <strong className="cifra-valor">{a.respuestas.filter((r) => r.respuesta !== 'no_puedo').length}</strong></div>
          </div>

          {!a.soyEmisor && a.emisor.telefono && a.estado === 'activa' && (
            <a className="btn btn-ancho" href={telefono(a.emisor.telefono)}>📞 Llamar a {a.emisor.nombre} ({a.emisor.telefono})</a>
          )}

          {a.puedoResponder && (
            <Tarjeta titulo={a.miRespuesta ? `Su respuesta: ${RESPUESTAS[a.miRespuesta]}` : '¿Puede ayudar?'}>
              <div className="respuesta-botones">
                {(Object.keys(RESPUESTAS) as RespuestaAlerta[]).map((r) => (
                  <button key={r} className={`btn ${a.miRespuesta === r ? '' : 'btn-sec'}`} disabled={ocupado}
                          onClick={() => void accion(() => api.responderAlerta(a.id, r))}>{RESPUESTAS[r]}</button>
                ))}
              </div>
            </Tarjeta>
          )}

          <Tarjeta titulo="Quiénes respondieron">
            {a.respuestas.length ? (
              <ul className="lista">
                {a.respuestas.map((r) => (
                  <li key={r.usuarioId} className="respuesta-fila">
                    <div>
                      <strong>{r.nombre}</strong>
                      <small>{r.unidad ?? ''} · {RESPUESTAS[r.respuesta]} · {hace(r.creadoEn)}</small>
                      {(r.tieneVehiculo || r.personalSalud) && (
                        <span className="banderas">{r.tieneVehiculo && '🚗 Tiene vehículo '}{r.personalSalud && '⚕ Personal de salud'}</span>
                      )}
                    </div>
                    {r.telefono && r.usuarioId !== s?.usuarioId && <a className="btn-llamar" href={telefono(r.telefono)}>Llamar</a>}
                  </li>
                ))}
              </ul>
            ) : <Vacio>{a.estado === 'activa' ? 'Esperando respuestas de los vecinos…' : 'Nadie respondió.'}</Vacio>}
          </Tarjeta>

          {a.puedoCerrar && (
            <Tarjeta titulo={a.soyEmisor ? '¿Cómo va la emergencia?' : 'Acciones de la junta'}>
              <Campo etiqueta="Nota (opcional)"><input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Ej.: Ya llegó la ambulancia" /></Campo>
              <div className="fila-botones">
                <button className="btn" disabled={ocupado} onClick={() => void accion(() => api.cerrarAlerta(a.id, 'atendida', nota))}>✅ Ya fue atendida</button>
                {a.alcance === 'cercanos' && (
                  <button className="btn btn-sec" disabled={ocupado} onClick={() => void accion(() => api.ampliarAlerta(a.id))}>Avisar a todo el condominio</button>
                )}
                {a.soyEmisor
                  ? <button className="btn-texto" disabled={ocupado} onClick={() => void accion(() => api.cerrarAlerta(a.id, 'cancelada', nota))}>Cancelar alerta</button>
                  : <button className="btn-texto" disabled={ocupado} onClick={() => void accion(() => api.cerrarAlerta(a.id, 'falsa_alarma', nota))}>Marcar falsa alarma</button>}
              </div>
            </Tarjeta>
          )}
          {errAccion && <div className="aviso aviso-error">{errAccion}</div>}
          <p className="nota">Verificada con {a.verificacion === 'clave' ? 'la clave de la cuenta' : 'huella o patrón del teléfono'}.</p>
        </>
      )}
    </Estado>
  );
}

// ---------------- Historial ----------------
export function HistorialAlertas() {
  const prefijo = usePrefijo();
  const { datos, cargando, error, recargar } = useCarga(() => api.alertas());
  useEffect(() => api.suscribirAlertas(() => recargar()), [recargar]);
  return (
    <>
      {api.sesion()?.unidadId && <Link className="sos-boton" to={`${prefijo}/sos`}><span className="sos-circulo">SOS</span><span><strong>Pedir ayuda</strong><small>Enviar una alerta a sus vecinos</small></span></Link>}
      <Estado cargando={cargando} error={error}>
        {datos?.length ? (
          <ul className="lista tarjeta">
            {datos.map((a) => (
              <li key={a.id}>
                <Link to={`${prefijo}/alertas/${a.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', color: 'inherit', textDecoration: 'none' }}>
                  <span><strong>{TIPOS[a.tipo].icono} {TITULO_ALERTA[a.tipo]} · {a.emisor.unidad}</strong>
                    <small>{a.emisor.nombre} · {hace(a.creadoEn)} · {a.respuestas.filter((r) => r.respuesta !== 'no_puedo').length} respondieron</small></span>
                  <Etiqueta tono={a.estado === 'activa' ? 'error' : a.estado === 'atendida' ? 'ok' : 'neutro'}>{ESTADOS[a.estado]}</Etiqueta>
                </Link>
              </li>
            ))}
          </ul>
        ) : <Vacio>No hay alertas. Ojalá siga así.</Vacio>}
      </Estado>
    </>
  );
}

// ---------------- Participación voluntaria ----------------
export function Participacion() {
  const prefijo = usePrefijo();
  const { datos: cfg, cargando, error, recargar } = useCarga(() => api.configAlerta());
  const [d, setD] = useState({ activo: false, tieneVehiculo: false, personalSalud: false, telefono: '' });
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    const p = cfg?.participacion;
    if (p) setD({ activo: p.activo, tieneVehiculo: p.tieneVehiculo, personalSalud: p.personalSalud, telefono: p.telefono ?? '' });
  }, [cfg]);

  async function guardar() {
    setOk(null); setErr(null); setGuardando(true);
    try {
      await api.fijarParticipacion({ ...d, telefono: d.telefono.trim() || null });
      setOk(d.activo ? 'Listo: participa en la alerta vecinal.' : 'Ya no participa en la alerta vecinal.');
      recargar();
    } catch (e) { setErr((e as Error).message); } finally { setGuardando(false); }
  }

  return (
    <Estado cargando={cargando} error={error}>
      {cfg && (
        <>
          {!cfg.redActiva && <div className="aviso aviso-error">La junta todavía no activó la alerta vecinal en el condominio.</div>}
          {cfg.participacion?.suspendidoHasta && cfg.participacion.suspendidoHasta > new Date().toISOString() && (
            <div className="aviso aviso-error">La junta suspendió su participación hasta el {new Date(cfg.participacion.suspendidoHasta).toLocaleDateString('es-VE')}
              {cfg.participacion.motivoSuspension ? `: ${cfg.participacion.motivoSuspension}` : ''}.</div>
          )}
          <Tarjeta titulo="¿Cómo funciona?">
            <ul className="nota" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Es <strong>voluntario</strong>. Si participa, puede pedir ayuda y recibir los avisos de emergencia de sus vecinos cercanos.</li>
              <li>La alerta suena como una <strong>alarma</strong> en los teléfonos de las casas cercanas y llega a la junta.</li>
              <li>Para enviarla se confirma con <strong>huella o patrón</strong>; sale con su nombre y su casa. Nada es anónimo.</li>
              <li>Su teléfono solo se muestra <strong>dentro de una alerta</strong>, a quienes la atienden.</li>
              <li>El mal uso (falsas alarmas) puede hacer que la junta lo suspenda.</li>
            </ul>
          </Tarjeta>
          <Tarjeta titulo="Mi participación">
            <label className="interruptor">
              <input type="checkbox" checked={d.activo} onChange={(e) => setD({ ...d, activo: e.target.checked })} />
              <span><strong>Participar en la alerta vecinal</strong><small>Avisar y recibir avisos de emergencia.</small></span>
            </label>
            {d.activo && (
              <>
                <label className="interruptor">
                  <input type="checkbox" checked={d.tieneVehiculo} onChange={(e) => setD({ ...d, tieneVehiculo: e.target.checked })} />
                  <span><strong>Tengo vehículo</strong><small>Para llevar a un vecino a la clínica si hace falta.</small></span>
                </label>
                <label className="interruptor">
                  <input type="checkbox" checked={d.personalSalud} onChange={(e) => setD({ ...d, personalSalud: e.target.checked })} />
                  <span><strong>Soy personal de salud</strong><small>Médico, enfermera, paramédico…</small></span>
                </label>
                <Campo etiqueta="Teléfono para emergencias" ayuda="Solo se muestra dentro de una alerta.">
                  <input type="tel" value={d.telefono} onChange={(e) => setD({ ...d, telefono: e.target.value })} placeholder="0414-000 00 00" maxLength={30} />
                </Campo>
              </>
            )}
            {err && <div className="aviso aviso-error">{err}</div>}
            {ok && <div className="aviso aviso-ok">{ok}</div>}
            <button className="btn" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </Tarjeta>
          <div className="fila-botones">
            <Link className="btn btn-sec" to={`${prefijo}/alertas`}>Ver alertas</Link>
            {cfg.puedoConfigurar && <Link className="btn btn-sec" to="/p/alerta">Configurar la red (junta)</Link>}
          </div>
        </>
      )}
    </Estado>
  );
}

// ---------------- Configuración de la junta ----------------
export function ConfigAlertaJunta() {
  const cfg = useCarga(() => api.configAlerta());
  return (
    <Estado cargando={cfg.cargando} error={cfg.error}>
      {cfg.datos && (
        <>
          <Red cfg={cfg.datos} alGuardar={cfg.recargar} />
          <Participantes puede={cfg.datos.puedoConfigurar} />
          <Cercania puede={cfg.datos.puedoConfigurar} />
          <div className="fila-botones"><Link className="btn btn-sec" to="/p/alertas">Historial de alertas</Link></div>
        </>
      )}
    </Estado>
  );
}

function Red({ cfg, alGuardar }: { cfg: ConfigAlerta; alGuardar: () => void }) {
  const [activa, setActiva] = useState(cfg.redActiva);
  const [radio, setRadio] = useState(cfg.radio);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function guardar() {
    setOk(null); setErr(null);
    try { await api.configurarRedAlerta(activa, radio); setOk('Guardado.'); alGuardar(); } catch (e) { setErr((e as Error).message); }
  }
  const ej = 28;
  return (
    <Tarjeta titulo="Alerta vecinal en el condominio">
      <label className="interruptor">
        <input type="checkbox" checked={activa} disabled={!cfg.puedoConfigurar} onChange={(e) => setActiva(e.target.checked)} />
        <span><strong>Activar la alerta vecinal</strong><small>Los residentes que se inscriban podrán pedir ayuda con el botón SOS. Al cambiarlo se avisa a todos.</small></span>
      </label>
      <Campo etiqueta="Casas a cada lado que reciben la alerta" ayuda={radio === 0 ? 'Con 0, cada alerta suena en todo el condominio.'
        : `Con ${radio}: si avisa la casa ${ej}, suenan de la ${ej - radio} a la ${ej + radio} (del mismo bloque o calle). Incendio siempre avisa a todos.`}>
        <div className="radio-control">
          <input type="range" min={0} max={10} value={radio} disabled={!cfg.puedoConfigurar} onChange={(e) => setRadio(Number(e.target.value))} aria-label="Casas a cada lado" />
          <output>{radio}</output>
        </div>
      </Campo>
      {cfg.puedoConfigurar ? <button className="btn" onClick={() => void guardar()}>Guardar</button>
        : <p className="nota">Solo presidencia o la administración cambia esta configuración.</p>}
      {ok && <div className="aviso aviso-ok">{ok}</div>}
      {err && <div className="aviso aviso-error">{err}</div>}
    </Tarjeta>
  );
}

function Participantes({ puede }: { puede: boolean }) {
  const { datos, cargando, error, recargar } = useCarga(() => api.participantesAlerta());
  const [err, setErr] = useState<string | null>(null);
  async function suspender(uid: string, dias: number) {
    setErr(null);
    try { await api.suspenderDeAlerta(uid, dias, dias ? 'Uso indebido de la alerta vecinal' : undefined); recargar(); } catch (e) { setErr((e as Error).message); }
  }
  const ahora = new Date().toISOString();
  return (
    <Tarjeta titulo={`Vecinos inscritos${datos ? ` (${datos.filter((p) => p.activo).length})` : ''}`}>
      <Estado cargando={cargando} error={error}>
        {datos?.length ? (
          <ul className="lista">
            {datos.map((p) => {
              const suspendido = !!p.suspendidoHasta && p.suspendidoHasta > ahora;
              return (
                <li key={p.usuarioId}>
                  <div>
                    <strong>{p.nombre}</strong>
                    <small>{p.unidad ?? '—'}{!p.activo && ' · no participa'}{p.tieneVehiculo && ' · 🚗'}{p.personalSalud && ' · ⚕'}
                      {' · '}{p.alertasEmitidas} alerta{p.alertasEmitidas === 1 ? '' : 's'}{p.falsasAlarmas ? ` · ${p.falsasAlarmas} falsa${p.falsasAlarmas === 1 ? '' : 's'} alarma${p.falsasAlarmas === 1 ? '' : 's'}` : ''}</small>
                    {suspendido && <small className="txt-error">Suspendido hasta {new Date(p.suspendidoHasta!).toLocaleDateString('es-VE')}</small>}
                  </div>
                  {puede && (suspendido
                    ? <button className="btn-texto" onClick={() => void suspender(p.usuarioId, 0)}>Reactivar</button>
                    : <span className="fila-botones" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn-texto" onClick={() => void suspender(p.usuarioId, 7)}>Suspender 7 d</button>
                        <button className="btn-texto" onClick={() => void suspender(p.usuarioId, 30)}>30 d</button>
                      </span>)}
                </li>
              );
            })}
          </ul>
        ) : <Vacio>Aún nadie se inscribió.</Vacio>}
      </Estado>
      {err && <div className="aviso aviso-error">{err}</div>}
    </Tarjeta>
  );
}

function Cercania({ puede }: { puede: boolean }) {
  const { datos, cargando, error, recargar } = useCarga(() => api.cercania());
  const [cambios, setCambios] = useState<Record<string, { sector: string; posicion: string }>>({});
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const valor = (uid: string, campo: 'sector' | 'posicion', original: string) => cambios[uid]?.[campo] ?? original;
  function cambiar(uid: string, campo: 'sector' | 'posicion', v: string, fila: { sector: string; posicion: number | null }) {
    setCambios((c) => ({ ...c, [uid]: { sector: c[uid]?.sector ?? fila.sector, posicion: c[uid]?.posicion ?? (fila.posicion?.toString() ?? ''), [campo]: v } }));
  }
  async function guardar() {
    setOk(null); setErr(null);
    const lista = Object.entries(cambios).map(([unidadId, c]) => ({
      unidadId, sector: c.sector.trim() || null, posicion: c.posicion.trim() === '' ? null : Number(c.posicion),
    }));
    if (lista.some((x) => x.posicion !== null && !Number.isFinite(x.posicion))) return setErr('La posición debe ser un número.');
    try { const n = await api.fijarCercania(lista); setCambios({}); setOk(`${n} casa${n === 1 ? '' : 's'} actualizada${n === 1 ? '' : 's'}.`); recargar(); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <Tarjeta titulo="Cercanía de las casas">
      <p className="nota">Dos casas son vecinas si están en el mismo <strong>sector</strong> (calle, bloque o torre) y su <strong>posición</strong> está cerca.
        Por defecto se usa el bloque y el número de la casa. Corríjalo si la numeración no sigue el orden real de la calle.</p>
      <Estado cargando={cargando} error={error}>
        <table className="tabla cercania-tabla">
          <thead><tr><th>Casa</th><th>Sector</th><th>Posición</th></tr></thead>
          <tbody>
            {datos?.map((u) => (
              <tr key={u.unidadId}>
                <td>{u.etiqueta}{u.personalizada && <small>ajustada</small>}</td>
                <td><input value={valor(u.unidadId, 'sector', u.sector)} disabled={!puede} aria-label={`Sector de ${u.etiqueta}`}
                           onChange={(e) => cambiar(u.unidadId, 'sector', e.target.value, u)} /></td>
                <td><input value={valor(u.unidadId, 'posicion', u.posicion?.toString() ?? '')} disabled={!puede} inputMode="numeric" aria-label={`Posición de ${u.etiqueta}`}
                           onChange={(e) => cambiar(u.unidadId, 'posicion', e.target.value, u)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Estado>
      {puede && <button className="btn" disabled={!Object.keys(cambios).length} onClick={() => void guardar()}>Guardar cambios</button>}
      {ok && <div className="aviso aviso-ok">{ok}</div>}
      {err && <div className="aviso aviso-error">{err}</div>}
    </Tarjeta>
  );
}
