// Cuenta del usuario: entrar, crear cuenta, olvidé/restablecer clave, verificar correo,
// unirse a un condominio con un código, elegir condominio y "Mi cuenta".
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, conectarServidor, servidorGuardado, urlServidor, volverADemo } from '../../data';
import { Campo, Etiqueta, Tarjeta } from '../../components/ui';
import { destino, inicioDe } from '../../navegacion';
import { NOMBRE_APP, SABOR, VERSION } from '../../sabor';
import { fecha } from '../../formato';
import './cuenta.css';

function Portada({ titulo, subtitulo, children }: { titulo?: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div className="entrar">
      <div className="entrar-marca">
        <div className="logo" aria-hidden>{SABOR === 'admin' ? 'ZA' : SABOR === 'miembros' ? 'ZM' : 'ZC'}</div>
        <h1>{titulo ?? NOMBRE_APP}</h1>
        <p>{subtitulo ?? (SABOR === 'admin' ? 'Administración del condominio' : 'Cuentas claras, vecinos tranquilos.')}</p>
        {api.modo === 'demo' && <span className="etiqueta etiqueta-alerta">Demostración · datos ficticios</span>}
      </div>
      {children}
      <p className="pie">Technical Digital TD, C.A. · soporte@zentapro.com</p>
    </div>
  );
}

/** Envía un formulario mostrando "cargando" y el error en español. */
function useEnvio() {
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  async function enviar(fn: () => Promise<void>) {
    setError(null); setCargando(true);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setCargando(false); }
  }
  return { error, cargando, enviar, setError };
}

// ---------------- Entrar ----------------
export function Entrar() {
  const ir = useNavigate();
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const { error, cargando, enviar } = useEnvio();

  const entrar = (datos: Parameters<typeof api.entrar>[0]) => enviar(async () => {
    await api.entrar(datos);
    ir(destino(), { replace: true });
  });

  return (
    <Portada>
      {api.modo === 'demo' && (
        <div className="entrar-caja">
          <p className="nota">Demostración: {SABOR === 'completa' ? 'elija cómo entrar' : 'entre con datos de ejemplo'} o cree una cuenta de prueba.</p>
          {SABOR !== 'admin' && (
            <button className="btn btn-ancho" disabled={cargando} onClick={() => entrar({ demoComo: 'residente' })}>
              {SABOR === 'miembros' ? 'Entrar a la demostración' : 'Soy residente'} <small>(Elena · Apto B-33)</small>
            </button>
          )}
          {SABOR !== 'miembros' && (
            <button className={`btn btn-ancho ${SABOR === 'admin' ? '' : 'btn-sec'}`} disabled={cargando} onClick={() => entrar({ demoComo: 'presidencia' })}>
              {SABOR === 'admin' ? 'Entrar a la demostración' : 'Soy Presidencia'} <small>(María · presidenta)</small>
            </button>
          )}
          <div className="separador"><span>o</span></div>
        </div>
      )}
      <form className="entrar-caja formulario" onSubmit={(e) => { e.preventDefault(); void entrar({ correo, clave }); }}>
        <Campo etiqueta="Correo"><input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required autoComplete="email" /></Campo>
        <Campo etiqueta="Clave"><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required autoComplete="current-password" /></Campo>
        <button className={`btn btn-ancho ${api.modo === 'demo' ? 'btn-sec' : ''}`} disabled={cargando}>{cargando ? 'Entrando…' : 'Entrar'}</button>
        <div className="enlaces-cuenta">
          <Link to="/olvide">¿Olvidó su clave?</Link>
          <Link to="/registro">Crear cuenta</Link>
        </div>
      </form>
      {error && <div className="aviso aviso-error">{error}</div>}
      <ConfigServidor />
    </Portada>
  );
}

/** Para las APK de prueba: conectar el teléfono a un servidor (p. ej. el Docker de la PC en la misma red) o volver a la demostración. */
function ConfigServidor() {
  const [abierto, setAbierto] = useState(false);
  const [url, setUrl] = useState(urlServidor ?? '');
  const { error, cargando, enviar } = useEnvio();
  return (
    <div className="entrar-caja">
      {servidorGuardado ? (
        <p className="nota">Conectado a <strong>{servidorGuardado}</strong>.{' '}
          <button className="btn-texto" onClick={() => void volverADemo()}>Volver a la demostración</button></p>
      ) : !abierto ? (
        <button className="btn-texto" onClick={() => setAbierto(true)}>Conectar a un servidor</button>
      ) : (
        <form className="formulario" onSubmit={(e) => { e.preventDefault(); void enviar(() => conectarServidor(url)); }}>
          <Campo etiqueta="Dirección del servidor" ayuda="Ej.: http://192.168.1.50:8080 (la PC con Docker en la misma red Wi-Fi) o https://condominio.zentapro.com">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.50:8080" inputMode="url" autoCapitalize="none" required />
          </Campo>
          <div className="fila-botones">
            <button className="btn btn-sec" disabled={cargando}>{cargando ? 'Probando…' : 'Probar y conectar'}</button>
            <button type="button" className="btn-texto" onClick={() => setAbierto(false)}>Cancelar</button>
          </div>
        </form>
      )}
      {error && <div className="aviso aviso-error">{error}</div>}
    </div>
  );
}

/** ZPro Admin abierto por alguien que no es de la junta (o ZPro Miembros por alguien sin casa). */
export function SoloOtraApp({ cual }: { cual: 'junta' | 'miembros' }) {
  const ir = useNavigate();
  const s = api.sesion();
  return (
    <Portada titulo={cual === 'junta' ? 'Esta app es para la junta' : 'Esta app es para los residentes'}>
      <div className="entrar-caja">
        <div className="aviso aviso-info">
          {cual === 'junta'
            ? <>Su cuenta en <strong>{s?.condominio}</strong> es de residente. Para ver su estado de cuenta, pagar y la alerta vecinal use la app <strong>ZPro Miembros</strong>.</>
            : <>Su cuenta en <strong>{s?.condominio}</strong> es de la junta y no tiene una casa asociada. Para administrar el condominio use la app <strong>ZPro Admin</strong>.</>}
        </div>
        <Link className="btn btn-sec btn-ancho" to="/elegir">Elegir otro condominio</Link>
        <button className="btn-texto" onClick={async () => { await api.salir(); ir('/entrar', { replace: true }); }}>Cerrar sesión</button>
      </div>
    </Portada>
  );
}

// ---------------- Crear cuenta ----------------
export function Registro() {
  const ir = useNavigate();
  const [d, setD] = useState({ nombre: '', correo: '', telefono: '', clave: '', clave2: '' });
  const { error, cargando, enviar, setError } = useEnvio();
  const cambiar = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });

  function crear(e: FormEvent) {
    e.preventDefault();
    if (d.clave.length < 8) return setError('La clave debe tener al menos 8 caracteres.');
    if (d.clave !== d.clave2) return setError('Las dos claves no coinciden.');
    void enviar(async () => {
      await api.registrar({ nombre: d.nombre.trim(), correo: d.correo.trim(), clave: d.clave, telefono: d.telefono.trim() || undefined });
      ir(destino(), { replace: true });
    });
  }

  return (
    <Portada titulo="Crear cuenta" subtitulo="Después se une a su condominio con el código de su casa.">
      <form className="entrar-caja formulario" onSubmit={crear}>
        <Campo etiqueta="Nombre y apellido"><input value={d.nombre} onChange={cambiar('nombre')} required minLength={2} autoComplete="name" /></Campo>
        <Campo etiqueta="Correo"><input type="email" value={d.correo} onChange={cambiar('correo')} required autoComplete="email" /></Campo>
        <Campo etiqueta="Teléfono (opcional)" ayuda="Solo lo ve la junta. Nunca se muestra a los vecinos.">
          <input type="tel" value={d.telefono} onChange={cambiar('telefono')} autoComplete="tel" placeholder="0414-0000000" />
        </Campo>
        <Campo etiqueta="Clave" ayuda="Mínimo 8 caracteres.">
          <input type="password" value={d.clave} onChange={cambiar('clave')} required autoComplete="new-password" />
        </Campo>
        <Campo etiqueta="Repita la clave"><input type="password" value={d.clave2} onChange={cambiar('clave2')} required autoComplete="new-password" /></Campo>
        <button className="btn btn-ancho" disabled={cargando}>{cargando ? 'Creando…' : 'Crear cuenta'}</button>
        <div className="enlaces-cuenta"><Link to="/entrar">Ya tengo cuenta</Link></div>
      </form>
      {error && <div className="aviso aviso-error">{error}</div>}
    </Portada>
  );
}

// ---------------- Olvidé mi clave ----------------
export function OlvideClave() {
  const [correo, setCorreo] = useState('');
  const [listo, setListo] = useState(false);
  const { error, cargando, enviar } = useEnvio();
  return (
    <Portada titulo="¿Olvidó su clave?" subtitulo="Le enviamos un enlace a su correo para crear una nueva.">
      {listo ? (
        <div className="entrar-caja">
          <div className="aviso aviso-ok">
            Si <strong>{correo}</strong> tiene una cuenta, le llegará un correo con un enlace. Vence en 1 hora.
            {api.modo === 'demo' && ' (En la demostración no se envían correos.)'}
          </div>
          <Link className="btn btn-sec btn-ancho" to="/entrar">Volver a entrar</Link>
        </div>
      ) : (
        <form className="entrar-caja formulario" onSubmit={(e) => { e.preventDefault(); void enviar(async () => { await api.olvideClave(correo.trim()); setListo(true); }); }}>
          <Campo etiqueta="Correo de su cuenta"><input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required autoComplete="email" /></Campo>
          <button className="btn btn-ancho" disabled={cargando}>{cargando ? 'Enviando…' : 'Enviar enlace'}</button>
          <div className="enlaces-cuenta"><Link to="/entrar">Volver</Link></div>
        </form>
      )}
      {error && <div className="aviso aviso-error">{error}</div>}
    </Portada>
  );
}

// ---------------- Restablecer clave (enlace del correo: #/restablecer?t=…) ----------------
export function RestablecerClave() {
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [listo, setListo] = useState(false);
  const { error, cargando, enviar, setError } = useEnvio();
  return (
    <Portada titulo="Nueva clave">
      {!token ? <div className="aviso aviso-error">El enlace está incompleto. Ábralo de nuevo desde su correo.</div>
        : listo ? (
          <div className="entrar-caja">
            <div className="aviso aviso-ok">Listo: su clave cambió. Por seguridad se cerró la sesión en todos sus teléfonos.</div>
            <Link className="btn btn-ancho" to="/entrar">Entrar con la nueva clave</Link>
          </div>
        ) : (
          <form className="entrar-caja formulario" onSubmit={(e) => {
            e.preventDefault();
            if (clave.length < 8) return setError('La clave debe tener al menos 8 caracteres.');
            if (clave !== clave2) return setError('Las dos claves no coinciden.');
            void enviar(async () => { await api.restablecerClave(token, clave); setListo(true); });
          }}>
            <Campo etiqueta="Nueva clave" ayuda="Mínimo 8 caracteres."><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required autoComplete="new-password" /></Campo>
            <Campo etiqueta="Repita la clave"><input type="password" value={clave2} onChange={(e) => setClave2(e.target.value)} required autoComplete="new-password" /></Campo>
            <button className="btn btn-ancho" disabled={cargando}>{cargando ? 'Guardando…' : 'Guardar clave'}</button>
          </form>
        )}
      {error && <div className="aviso aviso-error">{error}</div>}
    </Portada>
  );
}

// ---------------- Verificar correo (#/verificar-correo?t=…) ----------------
export function VerificarCorreo() {
  const [params] = useSearchParams();
  const [estado, setEstado] = useState<'verificando' | 'ok' | 'error'>('verificando');
  const [mensaje, setMensaje] = useState('');
  useEffect(() => {
    const t = params.get('t');
    if (!t) { setEstado('error'); setMensaje('El enlace está incompleto.'); return; }
    api.verificarCorreo(t).then(() => setEstado('ok')).catch((e: Error) => { setEstado('error'); setMensaje(e.message); });
  }, [params]);
  return (
    <Portada titulo="Confirmar correo">
      {estado === 'verificando' && <div className="cargando">Confirmando…</div>}
      {estado === 'ok' && <div className="aviso aviso-ok">¡Gracias! Su correo quedó confirmado.</div>}
      {estado === 'error' && <div className="aviso aviso-error">{mensaje}</div>}
      <Link className="btn btn-sec btn-ancho" to={destino()}>Continuar</Link>
    </Portada>
  );
}

// ---------------- Unirme a mi condominio ----------------
export function Unirme() {
  const ir = useNavigate();
  const [modo, setModo] = useState<'casa' | 'activar'>('casa');
  const [codigo, setCodigo] = useState('');
  const [, refrescar] = useState(0);
  const { error, cargando, enviar } = useEnvio();
  const y = api.cuenta();
  // Recarga la cuenta al abrir y, mientras haya solicitudes pendientes, cada 20 s: si la junta aprueba, entra solo.
  const membresiasAntes = useRef(api.cuenta()?.membresias.length ?? 0);
  useEffect(() => {
    if (api.modo !== 'servidor') return;
    const revisar = () => api.yo().then((y2) => {
      if (y2.membresias.length > membresiasAntes.current) ir(destino(), { replace: true }); else refrescar((n) => n + 1);
    }).catch(() => {});
    void revisar();
    const t = setInterval(() => { if (api.cuenta()?.solicitudesPendientes.length) void revisar(); }, 20_000);
    return () => clearInterval(t);
  }, [ir]);
  if (!y) return <Portada><Link className="btn btn-ancho" to="/entrar">Entrar</Link></Portada>;

  function unirme(e: FormEvent) {
    e.preventDefault();
    if (modo === 'casa' && /^INV-/i.test(codigo.trim())) { ir(`/invitacion/${codigo.trim().toUpperCase()}`); return; }
    void enviar(async () => {
      if (modo === 'activar') await api.activarCondominio(codigo);
      else {
        const r = await api.unirse(codigo);
        if (r === 'pendiente') { setCodigo(''); refrescar((n) => n + 1); return; }
      }
      ir(destino(), { replace: true });
    });
  }

  return (
    <Portada titulo={`Hola, ${y.usuario.nombre.split(' ')[0]}`} subtitulo="Únase a su condominio con el código que le dio la junta.">
      {y.solicitudesPendientes.length > 0 && (
        <Tarjeta titulo="Esperando aprobación">
          {y.solicitudesPendientes.map((s, i) => (
            <div key={i} className="fila-solicitud">
              <span><strong>{s.condominio}</strong><small>{s.unidad ?? s.rol} · enviada el {fecha(s.creadoEn)}</small></span>
              <Etiqueta tono="alerta">Pendiente</Etiqueta>
            </div>
          ))}
          <p className="nota">La presidencia de su condominio debe aprobar su ingreso. Cuando lo haga, toque “Revisar”.</p>
          <button className="btn btn-sec" onClick={() => void enviar(async () => { await api.yo(); refrescar((n) => n + 1); if (api.cuenta()?.membresias.length) ir(destino(), { replace: true }); })}>
            Revisar
          </button>
        </Tarjeta>
      )}
      <form className="entrar-caja formulario" onSubmit={unirme}>
        <div className="chips">
          <button type="button" className={`chip ${modo === 'casa' ? 'chip-activo' : ''}`} onClick={() => setModo('casa')}>Código de mi casa</button>
          <button type="button" className={`chip ${modo === 'activar' ? 'chip-activo' : ''}`} onClick={() => setModo('activar')}>Soy presidente: activar</button>
        </div>
        <Campo etiqueta={modo === 'casa' ? 'Código de su casa o apartamento' : 'Código de activación de ZentaPro'}
               ayuda={modo === 'casa' ? 'El código de su casa (ej.: B33-K7PQ) o el de la invitación del condominio (ej.: INV-K7PQ2M).' : 'Lo entrega ZentaPro al presidente al contratar el servicio.'}>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} required minLength={4} autoCapitalize="characters"
                 placeholder={modo === 'casa' ? 'B33-K7PQ' : 'SAMANES-2026'} className="codigo-input" />
        </Campo>
        <button className="btn btn-ancho" disabled={cargando}>{cargando ? 'Enviando…' : modo === 'casa' ? 'Unirme' : 'Activar condominio'}</button>
        {api.modo === 'demo' && <p className="nota">Demostración: pruebe <strong>A12-DEMO</strong> (entra directo), <strong>B32-K7PQ</strong> (requiere aprobación), <strong>INV-DEMO26</strong> (enlace de invitación) o <strong>SAMANES-DEMO</strong> (activar).</p>}
      </form>
      {error && <div className="aviso aviso-error">{error}</div>}
      <button className="btn-texto" onClick={async () => { await api.salir(); ir('/entrar', { replace: true }); }}>Salir</button>
    </Portada>
  );
}

// ---------------- Elegir condominio ----------------
export function ElegirCondominio() {
  const ir = useNavigate();
  const { error, enviar } = useEnvio();
  const y = api.cuenta();
  if (!y) return <Portada><Link className="btn btn-ancho" to="/entrar">Entrar</Link></Portada>;
  const condos = [...new Map(y.membresias.map((m) => [m.condominioId, m])).values()];
  const activo = api.sesion()?.condominioId;
  return (
    <Portada titulo="Sus condominios" subtitulo="Elija con cuál quiere trabajar ahora. La app lo recordará.">
      <div className="entrar-caja">
        {condos.map((m) => {
          const roles = y.membresias.filter((x) => x.condominioId === m.condominioId);
          return (
            <button key={m.condominioId} className={`opcion-condominio ${m.condominioId === activo ? 'activo' : ''}`}
                    onClick={() => void enviar(async () => { await api.elegirCondominio(m.condominioId); ir(destino(), { replace: true }); })}>
              <strong>{m.condominio}</strong>
              <small>{roles.map((r) => r.unidad ? `${r.unidad} · ${r.rol}` : r.rol).join(' · ')}</small>
              {m.estadoCondominio === 'suspendido' && <Etiqueta tono="error">Suspendido: solo lectura</Etiqueta>}
              {m.estadoCondominio === 'prueba' && <Etiqueta tono="info">En prueba</Etiqueta>}
            </button>
          );
        })}
        <Link className="btn btn-sec btn-ancho" to="/unirme">Unirme a otro condominio</Link>
      </div>
      {error && <div className="aviso aviso-error">{error}</div>}
    </Portada>
  );
}

// ---------------- Mi cuenta ----------------
export function MiCuenta() {
  const ir = useNavigate();
  const y = api.cuenta();
  const s = api.sesion();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const { error, cargando, enviar, setError } = useEnvio();
  const condos = new Set(y?.membresias.map((m) => m.condominioId) ?? []);
  return (
    <>
      <Tarjeta titulo="Mis datos">
        <p><strong>{y?.usuario.nombre}</strong></p>
        <p className="meta">{y?.usuario.correo} {y && !y.usuario.correoVerificado && <Etiqueta tono="alerta">Correo sin confirmar</Etiqueta>}</p>
        {s && <p className="meta">{s.condominio}{s.unidad ? ` · ${s.unidad}` : ''} · {s.rol}</p>}
        <div className="fila-botones">
          {(condos.size > 1 || (s?.esJunta && s.unidadId)) && <Link className="btn btn-sec" to="/elegir">Cambiar de condominio</Link>}
          {SABOR === 'completa' && s?.esJunta && s.unidadId && <Link className="btn btn-sec" to="/r">Ver como residente</Link>}
          {s?.unidadId && <Link className="btn btn-sec" to={`${inicioDe(s).startsWith('/p') ? '/p' : '/r'}/alerta-vecinal`}>Alerta vecinal</Link>}
          <Link className="btn btn-sec" to="/unirme">Unirme a otro condominio</Link>
        </div>
      </Tarjeta>
      {y && <AvisosPorCorreo inicial={y.usuario.avisosPorCorreo ?? true} correoVerificado={y.usuario.correoVerificado} />}
      <Tarjeta titulo="Cambiar clave">
        <form className="formulario" onSubmit={(e) => {
          e.preventDefault(); setOk(null);
          if (nueva.length < 8) return setError('La nueva clave debe tener al menos 8 caracteres.');
          void enviar(async () => { await api.cambiarClave(actual, nueva); setActual(''); setNueva(''); setOk('Clave cambiada.'); });
        }}>
          <Campo etiqueta="Clave actual"><input type="password" value={actual} onChange={(e) => setActual(e.target.value)} required autoComplete="current-password" /></Campo>
          <Campo etiqueta="Nueva clave"><input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} required autoComplete="new-password" /></Campo>
          <button className="btn" disabled={cargando}>Cambiar clave</button>
        </form>
        {ok && <div className="aviso aviso-ok">{ok}</div>}
        {error && <div className="aviso aviso-error">{error}</div>}
      </Tarjeta>
      <button className="btn btn-peligro btn-ancho" onClick={async () => { await api.salir(); ir('/entrar', { replace: true }); }}>Cerrar sesión</button>
      <p className="nota" style={{ textAlign: 'center' }}>{NOMBRE_APP} · versión {VERSION}{SABOR !== 'completa' ? ` · ${SABOR}` : ''}
        {api.modo === 'demo' ? ' · demostración' : urlServidor ? ` · ${urlServidor}` : ''}</p>
    </>
  );
}

/** Recibir también por correo los avisos de pagos (aprobado, rechazado y, para la junta, el recordatorio diario). */
function AvisosPorCorreo({ inicial, correoVerificado }: { inicial: boolean; correoVerificado: boolean }) {
  const [activo, setActivo] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  async function cambiar(v: boolean) {
    setError(null); setGuardando(true); setActivo(v);
    try { await api.fijarAvisosPorCorreo(v); } catch (e) { setActivo(!v); setError((e as Error).message); } finally { setGuardando(false); }
  }
  return (
    <Tarjeta titulo="Avisos">
      <label className="interruptor">
        <input type="checkbox" checked={activo} disabled={guardando} onChange={(e) => void cambiar(e.target.checked)} />
        <span><strong>Recibir avisos de pagos por correo</strong>
          <small>Además de la notificación en la app: cuando la junta aprueba o rechaza su pago y, si es de la junta, el recordatorio diario de pagos por revisar.
            {!correoVerificado && ' Primero confirme su correo con el enlace que le enviamos.'}</small></span>
      </label>
      {error && <div className="aviso aviso-error">{error}</div>}
    </Tarjeta>
  );
}
