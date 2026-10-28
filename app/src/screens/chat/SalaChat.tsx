import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Adjunto, type Conversacion, type Mensaje } from '../../data';
import {
  ajustes, archivoLocal, asegurarCopia, descargarEnNavegador, exportarConversacion, guardarArchivo, guardarMensajes, mensajesLocales,
} from '../../data/local';
import { Avatar, baseRol, dia, hora, Ico, tamano } from './comun';
import './chat.css';

type CopiaLocal = { url: string; sha256: string | null };

export function SalaChat() {
  const { id = '' } = useParams();
  const s = api.sesion()!;
  const base = baseRol(s.esJunta);
  const ir = useNavigate();

  const [conv, setConv] = useState<Conversacion | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [locales, setLocales] = useState<Record<string, CopiaLocal>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [menu, setMenu] = useState(false);
  const [visor, setVisor] = useState<{ url: string; nombre: string } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('Acoso u ofensa');
  const [aviso, setAviso] = useState<string | null>(null);
  const [silenciada, setSilenciada] = useState(() => ajustes.silenciada(id));
  const [autoDescarga, setAutoDescarga] = useState(() => ajustes.autoDescarga);
  const [bloqueadas, setBloqueadas] = useState(() => ajustes.bloqueadas(s.usuarioId));
  const [condominio, setCondominio] = useState('Condominio');
  const [otraCasa, setOtraCasa] = useState<string | null>(null);
  const [miEtiqueta, setMiEtiqueta] = useState<string | null>(null);
  const [chatVecinos, setChatVecinos] = useState(true);

  const scroller = useRef<HTMLDivElement>(null);
  const pegadoAbajo = useRef(true);
  const intentados = useRef(new Set<string>());
  const inputArchivo = useRef<HTMLInputElement>(null);
  const inputCamara = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // ---------- Carga inicial: servidor + copia local (lo que el servidor ya purgó sigue en el teléfono) ----------
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    (async () => {
      try {
        const [lista, servidor, local] = await Promise.all([api.conversaciones(), api.mensajes(id), mensajesLocales(id)]);
        if (!vivo) return;
        const c = lista.find((x) => x.id === id);
        if (!c) throw new Error('Conversación no disponible');
        const ids = new Set(servidor.map((m) => m.id));
        const soloLocal = local.filter((m) => !ids.has(m.id) && m.creadoEn < (servidor[0]?.creadoEn ?? '9999'));
        setConv(c);
        setMensajes([...soloLocal, ...servidor]);
        const dir = await api.directorio().catch(() => []);
        if (vivo) setMiEtiqueta(dir.find((x) => x.unidadId === s.unidadId)?.etiqueta ?? null);
        if (c.tipo === 'directa') {
          api.condominio().then((k) => { if (vivo) setChatVecinos(k.chatVecinos); }).catch(() => {});
          // La otra casa se identifica por su seudónimo (inicio del título: "Casa 12 · Carlos Rivas").
          const etq = c.titulo.split(' · ')[0];
          const casa = dir.find((x) => x.etiqueta === etq && x.unidadId !== s.unidadId);
          if (vivo) setOtraCasa(casa?.unidadId ?? null);
        }
        void guardarMensajes(servidor);
        void api.marcarLeido(id);
      } catch (e) { if (vivo) setError((e as Error).message); } finally { if (vivo) setCargando(false); }
    })();
    api.condominio().then((c) => setCondominio(c.nombre)).catch(() => null);
    return () => { vivo = false; };
  }, [id]);

  // ---------- Tiempo real: mensajes nuevos y cambios de ✓/✓✓ ----------
  useEffect(() => api.suscribirConversacion(id, (m) => {
    setMensajes((l) => {
      const i = l.findIndex((x) => x.id === m.id);
      if (i === -1) return [...l, m];
      const c = l.slice(); c[i] = m; return c;
    });
    void guardarMensajes([m]);
    if (!m.esMio) void api.marcarLeido(id);
  }), [id]);

  // ---------- Constancia local: buscar copias y descargar automáticamente lo nuevo ----------
  useEffect(() => {
    for (const m of mensajes) {
      const a = m.adjunto;
      if (!a || intentados.current.has(a.id)) continue;
      intentados.current.add(a.id);
      (async () => {
        let copia = await archivoLocal(a.id);
        if (!copia && autoDescarga && !a.vencido) copia = await asegurarCopia(a, api.descargarAdjunto, condominio);
        if (copia) {
          const c = copia;
          setLocales((x) => ({ ...x, [a.id]: { url: URL.createObjectURL(c.blob), sha256: c.sha256 } }));
        }
      })();
    }
  }, [mensajes, autoDescarga, condominio]);

  // ---------- Desplazamiento ----------
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pegadoAbajo.current) el.scrollTop = el.scrollHeight;
  }, [mensajes, cargando, locales]);
  const alDesplazar = () => {
    const el = scroller.current;
    if (el) pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // ---------- Envío ----------
  const elegir = (f: File | null) => {
    setArchivo(f);
    setPrevia(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  };
  const enviar = useCallback(async () => {
    if (enviando || (!texto.trim() && !archivo)) return;
    setEnviando(true); setError(null);
    try {
      const m = await api.enviarMensaje(id, { texto, archivo: archivo ?? undefined });
      pegadoAbajo.current = true;
      setMensajes((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
      void guardarMensajes([m]);
      if (archivo && m.adjunto) {
        // Lo que yo envío también queda en mi teléfono.
        const c = await guardarArchivo(m.adjunto, archivo, condominio);
        intentados.current.add(m.adjunto.id);
        setLocales((x) => ({ ...x, [m.adjunto!.id]: { url: URL.createObjectURL(c.blob), sha256: c.sha256 } }));
      }
      setTexto(''); elegir(null);
      if (textarea.current) textarea.current.style.height = '';
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  }, [enviando, texto, archivo, id, condominio]);

  // ---------- Acciones ----------
  const bloqueada = !!otraCasa && bloqueadas.includes(otraCasa);
  async function alternarBloqueo() {
    setMenu(false);
    if (!otraCasa) return setError('No se pudo identificar la casa.');
    try {
      await api.bloquearCasa(otraCasa, !bloqueada);
      ajustes.marcarBloqueada(s.usuarioId, otraCasa, !bloqueada);
      setBloqueadas(ajustes.bloqueadas(s.usuarioId));
      setAviso(bloqueada ? 'Casa desbloqueada: puede volver a escribirle.' : 'Casa bloqueada: ya no podrá escribirle por este chat.');
    } catch (e) { setError((e as Error).message); }
  }
  async function exportar() {
    setMenu(false);
    try {
      await exportarConversacion({ condominio, titulo: conv?.titulo ?? 'chat', mensajes });
      setAviso('Conversación exportada como archivo de texto (constancia).');
    } catch (e) { setError((e as Error).message); }
  }
  async function denunciar(mid: string) {
    try { await api.denunciarMensaje(mid, motivo); setSel(null); setAviso('Denuncia enviada a la junta. Solo verán ese mensaje.'); }
    catch (e) { setError((e as Error).message); }
  }
  function abrirAdjunto(a: Adjunto) {
    const copia = locales[a.id];
    const url = copia?.url ?? a.url;
    if (!url) return;
    if (a.mime.startsWith('image/')) setVisor({ url, nombre: a.nombre });
    else if (copia) archivoLocal(a.id).then((c) => c && descargarEnNavegador(c.blob, a.nombre));
    else window.open(url, '_blank', 'noopener');
  }

  // ---------- Render ----------
  const puedeEscribir = !!conv?.puedoEscribir;
  let diaAnterior = '';

  return (
    <div className="sala">
      <header className="sala-cab">
        <button className="icono-btn" onClick={() => (window.history.length > 1 ? ir(-1) : ir(`${base}/chats`))} aria-label="Volver"><Ico n="atras" /></button>
        {conv && <Avatar titulo={conv.titulo} tipo={conv.tipo} esJuntaTitulo={!s.esJunta && conv.tipo === 'junta'} />}
        <div className="sala-cab-txt">
          <strong>{conv?.titulo ?? 'Chat'}</strong>
          <span>{silenciada ? '🔇 ' : ''}{conv?.subtitulo}</span>
        </div>
        <button className="icono-btn" onClick={() => setMenu((v) => !v)} aria-label="Opciones" aria-expanded={menu}><Ico n="menu" /></button>
        {menu && (
          <div className="sala-menu" role="menu">
            <button role="menuitem" onClick={exportar}>Exportar conversación (.txt)</button>
            <button role="menuitem" onClick={() => { ajustes.silenciar(id, !silenciada); setSilenciada(!silenciada); setMenu(false); }}>
              {silenciada ? 'Activar notificaciones' : 'Silenciar notificaciones'}
            </button>
            <button role="menuitem" onClick={() => { ajustes.autoDescarga = !autoDescarga; setAutoDescarga(!autoDescarga); setMenu(false); }}>
              Guardar archivos automáticamente: {autoDescarga ? 'Sí' : 'No'}
            </button>
            {conv?.tipo === 'directa' && !s.esJunta && (
              <button role="menuitem" className="peligro" onClick={alternarBloqueo}>{bloqueada ? 'Desbloquear casa' : 'Bloquear casa'}</button>
            )}
            <button role="menuitem" onClick={() => setMenu(false)}>Cerrar</button>
          </div>
        )}
      </header>

      <div className="sala-mensajes" ref={scroller} onScroll={alDesplazar} onClick={() => menu && setMenu(false)}>
        {!s.esJunta && (
          <div className="sala-aviso">
            Los mensajes no son anónimos. Para quejas anónimas use <Link to="/r/reportes/nuevo">Reportes</Link>.
          </div>
        )}
        {cargando && <div className="cargando">Cargando…</div>}
        {!cargando && !mensajes.length && !error && <div className="separador-dia">Escriba el primer mensaje</div>}
        {mensajes.map((m) => {
          const d = dia(m.creadoEn);
          const sep = d !== diaAnterior; diaAnterior = d;
          const copia = m.adjunto ? locales[m.adjunto.id] : undefined;
          // "Nuestro lado" (derecha): lo mío, lo que escribió otra persona de la junta (si veo como junta)
          // o alguien de mi misma casa. Los ✓ solo aparecen en lo que escribí yo.
          const nuestro = m.esMio || (s.esJunta && !s.unidadId && m.comoJunta) || (!m.comoJunta && !!miEtiqueta && m.autorEtiqueta === miEtiqueta);
          return (
            <Fragment key={m.id}>
              {sep && <div className="separador-dia">{d}</div>}
              <div className={`fila-msg ${nuestro ? 'mia' : ''}`}>
                <div className={`burbuja ${sel === m.id ? 'seleccionada' : ''}`}
                     onClick={() => !m.esMio && !m.eliminado && setSel(sel === m.id ? null : m.id)}>
                  {!m.esMio && conv?.tipo !== 'directa' && (
                    <div className={`burbuja-autor ${m.comoJunta ? 'junta' : ''}`}>
                      {m.autorEtiqueta} {m.autorNombre && <small>· {m.autorNombre}</small>}
                    </div>
                  )}
                  {m.adjunto && <VistaAdjunto a={m.adjunto} copia={copia} alAbrir={() => abrirAdjunto(m.adjunto!)} />}
                  {m.eliminado ? <div className="burbuja-texto eliminado">Se eliminó este mensaje</div>
                    : m.texto && <div className="burbuja-texto">{m.texto}</div>}
                  <div className="burbuja-pie">
                    {m.editado && <span>editado ·</span>}
                    <span>{hora(m.creadoEn)}</span>
                    {m.esMio && m.estado && (
                      <span className={`ticks ${m.estado === 3 ? 'leido' : ''}`} title={['', 'Enviado', 'Entregado', 'Leído'][m.estado]}
                            aria-label={['', 'Enviado', 'Entregado', 'Leído'][m.estado]}>{m.estado === 1 ? '✓' : '✓✓'}</span>
                    )}
                  </div>
                  {sel === m.id && (
                    <div className="acciones-msg" onClick={(e) => e.stopPropagation()}>
                      <select value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo de la denuncia">
                        <option>Acoso u ofensa</option><option>Amenaza</option><option>Publicidad o spam</option><option>Otro</option>
                      </select>
                      <button className="btn btn-peligro" onClick={() => denunciar(m.id)}>Denunciar a la junta</button>
                      <button className="btn-texto" onClick={() => setSel(null)}>Cancelar</button>
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      <div className="sala-pie">
        {aviso && <div className="archivo-elegido" role="status"><span>{aviso}</span><button className="icono-btn" onClick={() => setAviso(null)} aria-label="Cerrar"><Ico n="cerrar" t={16} /></button></div>}
        {error && <div className="sala-error" role="alert">{error}</div>}
        {!conv && !cargando ? null : puedeEscribir ? (
          <>
            {archivo && (
              <div className="archivo-elegido">
                {previa ? <img src={previa} alt="" /> : <Ico n="clip" />}
                <span>{archivo.name} · {tamano(archivo.size)}</span>
                <button className="icono-btn" onClick={() => elegir(null)} aria-label="Quitar archivo"><Ico n="cerrar" t={16} /></button>
              </div>
            )}
            <div className="redactor">
              <div className="redactor-caja">
                <textarea ref={textarea} rows={1} value={texto} placeholder={archivo ? 'Agregue un comentario (opcional)' : 'Mensaje'}
                  aria-label="Escribir mensaje" maxLength={4000}
                  onChange={(e) => { setTexto(e.target.value); e.target.style.height = ''; e.target.style.height = `${e.target.scrollHeight}px`; }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); void enviar(); } }} />
                <button className="icono-btn" onClick={() => inputArchivo.current?.click()} aria-label="Adjuntar archivo"><Ico n="clip" /></button>
                <button className="icono-btn" onClick={() => inputCamara.current?.click()} aria-label="Tomar foto"><Ico n="camara" /></button>
              </div>
              <button className="btn-enviar" onClick={() => void enviar()} disabled={enviando || (!texto.trim() && !archivo)} aria-label="Enviar"><Ico n="enviar" /></button>
            </div>
            <input ref={inputArchivo} type="file" hidden onChange={(e) => { elegir(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            <input ref={inputCamara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { elegir(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          </>
        ) : conv ? (
          <div className="solo-lectura">
            {conv.tipo === 'canal' ? 'Solo la junta escribe en este canal.'
              : conv.tipo === 'directa' && !chatVecinos ? 'La junta desactivó el chat entre vecinos. La conversación queda guardada, pero ya no se pueden enviar mensajes.'
              : bloqueada ? 'Usted bloqueó a esta casa.' : 'No puede escribir en esta conversación.'}
          </div>
        ) : null}
      </div>

      {visor && (
        <div className="visor" role="dialog" aria-label={visor.nombre}>
          <header>
            <span>{visor.nombre}</span>
            <button className="icono-btn" onClick={() => setVisor(null)} aria-label="Cerrar"><Ico n="cerrar" /></button>
          </header>
          <img src={visor.url} alt={visor.nombre} />
        </div>
      )}
    </div>
  );
}

function VistaAdjunto({ a, copia, alAbrir }: { a: Adjunto; copia?: CopiaLocal; alAbrir: () => void }) {
  const url = copia?.url ?? a.url;
  const [rota, setRota] = useState(false);
  const estado = copia ? <small className="adjunto-local">✓ Guardado en este teléfono</small>
    : a.vencido ? <small className="adjunto-vencido">Archivo vencido en el servidor (sin copia en este teléfono)</small>
    : <small>Disponible en el servidor hasta el {new Date(a.expiraEn).toLocaleDateString('es-VE')}</small>;
  if (a.mime.startsWith('image/') && url && !rota) {
    return (
      <>
        <img className="burbuja-img" src={url} alt={a.nombre} onError={() => setRota(true)} onClick={(e) => { e.stopPropagation(); alAbrir(); }} />
        <div style={{ marginBottom: 2 }}>{estado}</div>
      </>
    );
  }
  const ext = a.nombre.includes('.') ? a.nombre.split('.').pop()! : a.mime.split('/')[1] ?? 'arch';
  return (
    <button className="adjunto-caja" disabled={!url} onClick={(e) => { e.stopPropagation(); alAbrir(); }}>
      <span className={`ext ${a.mime.startsWith('image/') ? 'img' : ''}`}>{ext.slice(0, 4)}</span>
      <span style={{ minWidth: 0 }}>
        <strong>{a.nombre}</strong>
        <small>{tamano(a.bytes)}</small>
        {estado}
      </span>
    </button>
  );
}
