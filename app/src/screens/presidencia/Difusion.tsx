// Alcance (¿para quién es?), mensajes masivos y grupos de casas (v0.6).
// Una cuota especial o un mensaje puede ir a todo el condominio o solo a algunas casas: una calle cerrada con
// portón propio, un piso con su llave, casas elegidas… Las reglas viven en el servidor (0021_alcance_y_difusion.sql).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  api, type AlcanceDifusion, type Difusion, type GrupoUnidades, type Notificacion, type Partida, type PreviaDifusion, type UnidadAlcance,
} from '../../data';
import type { DifusionEnviada } from '../../data/api';
import { Campo, Estado, Etiqueta, Tarjeta, Vacio, useCarga } from '../../components/ui';
import { avisarCambioNotificaciones, usePrefijo } from '../../components/notificaciones';
import { fecha, hace, usd } from '../../formato';
import { NOMBRE_APP } from '../../sabor';
import './difusion.css';

// ---------------- Estado del selector ----------------
export type ModoAlcance = 'todos' | 'grupo' | 'unidades' | 'partida' | 'sin_votar';
export interface EstadoAlcance {
  modo: ModoAlcance; grupoId: string; unidadIds: string[]; nombre: string; guardarGrupo: boolean; partidaId: string;
}
export const alcanceInicial = (modo: ModoAlcance = 'todos', partidaId = ''): EstadoAlcance =>
  ({ modo, grupoId: '', unidadIds: [], nombre: '', guardarGrupo: false, partidaId });

/** Convierte lo elegido en el alcance que entiende el servidor (null si todavía falta elegir algo). */
export function alcanceDe(e: EstadoAlcance): AlcanceDifusion | null {
  switch (e.modo) {
    case 'todos': return { tipo: 'todos' };
    case 'grupo': return e.grupoId ? { tipo: 'grupo', grupoId: e.grupoId } : null;
    case 'unidades': return e.unidadIds.length ? { tipo: 'unidades', unidadIds: e.unidadIds, ...(e.nombre.trim() ? { nombre: e.nombre.trim() } : {}) } : null;
    case 'partida': return e.partidaId ? { tipo: 'partida', partidaId: e.partidaId } : null;
    case 'sin_votar': return e.partidaId ? { tipo: 'sin_votar', partidaId: e.partidaId } : null;
  }
}

/** Si pidió "Guardar como grupo", crea el grupo y devuelve el alcance apuntando a él. */
export async function guardarGrupoSiHaceFalta(e: EstadoAlcance): Promise<EstadoAlcance> {
  if (e.modo !== 'unidades' || !e.guardarGrupo || !e.unidadIds.length) return e;
  if (!e.nombre.trim()) throw new Error('Para guardar el grupo escriba su nombre (por ejemplo, "Calle 3 · portón").');
  const g = await api.crearGrupo({ nombre: e.nombre.trim(), unidadIds: e.unidadIds });
  return { ...e, modo: 'grupo', grupoId: g.id, guardarGrupo: false };
}

const DESCRIPCION: Record<ModoAlcance, { t: string; d: string }> = {
  todos: { t: 'Todo el condominio', d: 'Todas las casas y apartamentos' },
  grupo: { t: 'Un grupo guardado', d: 'Por ejemplo, una calle con portón propio o un piso' },
  unidades: { t: 'Elegir casas', d: 'Por calle, bloque, piso o una por una' },
  partida: { t: 'Las casas de una cuota especial', d: 'Solo las incluidas en esa cuota' },
  sin_votar: { t: 'Las que aún no han votado', d: 'Recordatorio para una votación abierta' },
};

export function SelectorAlcance({ valor, cambiar, modos, partidas = [], permitirGuardar = true }: {
  valor: EstadoAlcance; cambiar: (e: EstadoAlcance) => void; modos: ModoAlcance[];
  partidas?: Partida[]; permitirGuardar?: boolean;
}) {
  const grupos = useCarga(() => (modos.includes('grupo') ? api.grupos() : Promise.resolve([] as GrupoUnidades[])));
  const set = (c: Partial<EstadoAlcance>) => cambiar({ ...valor, ...c });
  const conVotacion = partidas.filter((p) => p.votacion?.estado === 'abierta');
  const lista = valor.modo === 'sin_votar' ? conVotacion : partidas;

  return (
    <fieldset className="alcance-modos" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="campo-etq" style={{ marginBottom: 6 }}>¿Para quién es?</legend>
      {modos.map((m) => (
        <label key={m} className={`alcance-modo ${valor.modo === m ? 'activo' : ''}`}>
          <input type="radio" name="alcance-modo" checked={valor.modo === m} onChange={() => set({ modo: m })} />
          <span><strong>{DESCRIPCION[m].t}</strong><small>{DESCRIPCION[m].d}</small></span>
        </label>
      ))}

      {valor.modo === 'grupo' && (
        <div className="alcance-detalle">
          <Estado cargando={grupos.cargando} error={grupos.error}>
            {grupos.datos?.length ? (
              <div className="alcance-modos">
                {grupos.datos.map((g) => (
                  <label key={g.id} className={`alcance-modo ${valor.grupoId === g.id ? 'activo' : ''}`}>
                    <input type="radio" name="alcance-grupo" checked={valor.grupoId === g.id} onChange={() => set({ grupoId: g.id })} />
                    <span><strong>{g.nombre}</strong><small>{g.unidadIds.length} casa{g.unidadIds.length === 1 ? '' : 's'}{g.descripcion ? ` · ${g.descripcion}` : ''}</small></span>
                  </label>
                ))}
              </div>
            ) : <p className="nota">Todavía no hay grupos guardados. Use “Elegir casas” y marque “Guardar como grupo”, o créelos en <Link to="/p/grupos">Grupos de casas</Link>.</p>}
          </Estado>
        </div>
      )}

      {valor.modo === 'unidades' && (
        <div className="alcance-detalle">
          <ElegirCasas seleccion={valor.unidadIds} cambiar={(ids) => set({ unidadIds: ids })} />
          <Campo etiqueta="Nombre para este grupo de casas (opcional)" ayuda="Lo verán los vecinos incluidos, por ejemplo “Calle 3 · portón” o “Piso 4”.">
            <input value={valor.nombre} maxLength={80} onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej.: Calle 3 · portón" />
          </Campo>
          {permitirGuardar && (
            <label className="interruptor">
              <input type="checkbox" checked={valor.guardarGrupo} onChange={(e) => set({ guardarGrupo: e.target.checked })} />
              <span><strong>Guardar como grupo</strong><small>Para usarlo de nuevo sin elegir las casas otra vez.</small></span>
            </label>
          )}
        </div>
      )}

      {(valor.modo === 'partida' || valor.modo === 'sin_votar') && (
        <div className="alcance-detalle">
          {lista.length ? (
            <Campo etiqueta="Cuota especial">
              <select value={valor.partidaId} onChange={(e) => set({ partidaId: e.target.value })}>
                <option value="">Elija una…</option>
                {lista.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.titulo} · {p.alcance.tipo === 'todos' ? 'todo el condominio' : p.alcance.nombre}
                    {valor.modo === 'sin_votar' && p.votacion?.sinVotar != null ? ` · faltan ${p.votacion.sinVotar}` : ''}
                  </option>
                ))}
              </select>
            </Campo>
          ) : <p className="nota">{valor.modo === 'sin_votar' ? 'No hay votaciones abiertas.' : 'No hay cuotas especiales.'}</p>}
        </div>
      )}
    </fieldset>
  );
}

/** Lista de casas con filtros rápidos (calle/bloque y piso), búsqueda y "marcar las visibles". */
export function ElegirCasas({ seleccion, cambiar }: { seleccion: string[]; cambiar: (ids: string[]) => void }) {
  const { datos, cargando, error } = useCarga(() => api.unidadesAlcance());
  const [sector, setSector] = useState<string | null>(null);
  const [piso, setPiso] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');
  const sectores = useMemo(() => [...new Set((datos ?? []).map((u) => u.sector).filter(Boolean))].sort(), [datos]);
  const pisos = useMemo(() => [...new Set((datos ?? []).map((u) => u.piso).filter((p): p is string => !!p))]
    .sort((a, b) => (Number(a) || 1e9) - (Number(b) || 1e9) || a.localeCompare(b)), [datos]);
  const visibles = (datos ?? []).filter((u) => (!sector || u.sector === sector) && (!piso || u.piso === piso)
    && (!buscar.trim() || u.etiqueta.toLowerCase().includes(buscar.trim().toLowerCase())));
  const sel = new Set(seleccion);
  const todasVisiblesMarcadas = visibles.length > 0 && visibles.every((u) => sel.has(u.id));
  const alternar = (id: string) => cambiar(sel.has(id) ? seleccion.filter((x) => x !== id) : [...seleccion, id]);
  function marcarVisibles() {
    if (todasVisiblesMarcadas) cambiar(seleccion.filter((x) => !visibles.some((u) => u.id === x)));
    else cambiar([...new Set([...seleccion, ...visibles.map((u) => u.id)])]);
  }
  const nombreSector = (s: string) => (s.length <= 3 ? `Bloque/calle ${s}` : s);

  return (
    <Estado cargando={cargando} error={error}>
      <div className="casas-filtros">
        {sectores.length > 1 && (
          <>
            <span className="etq">Calle o bloque</span>
            <div className="chips">
              <button type="button" className={`chip ${!sector ? 'chip-activo' : ''}`} onClick={() => setSector(null)}>Todos</button>
              {sectores.map((s) => <button type="button" key={s} className={`chip ${sector === s ? 'chip-activo' : ''}`} onClick={() => setSector(s)}>{nombreSector(s)}</button>)}
            </div>
          </>
        )}
        {pisos.length > 1 && (
          <>
            <span className="etq">Piso</span>
            <div className="chips">
              <button type="button" className={`chip ${!piso ? 'chip-activo' : ''}`} onClick={() => setPiso(null)}>Todos</button>
              {pisos.map((p) => <button type="button" key={p} className={`chip ${piso === p ? 'chip-activo' : ''}`} onClick={() => setPiso(p)}>Piso {p}</button>)}
            </div>
          </>
        )}
        <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar casa (ej.: 28, B-34)" aria-label="Buscar casa" />
      </div>
      <div className="casas-cuenta">
        <span><strong>{seleccion.length}</strong> casa{seleccion.length === 1 ? '' : 's'} seleccionada{seleccion.length === 1 ? '' : 's'}</span>
        <span className="fila-botones">
          <button type="button" className="btn btn-sec" onClick={marcarVisibles} disabled={!visibles.length}>
            {todasVisiblesMarcadas ? `Quitar las ${visibles.length} visibles` : `Marcar las ${visibles.length} visibles`}
          </button>
          {seleccion.length > 0 && <button type="button" className="btn-texto" onClick={() => cambiar([])}>Limpiar</button>}
        </span>
      </div>
      <div className="casas-lista" role="group" aria-label="Casas">
        {visibles.map((u) => (
          <label key={u.id} className={`casa-check ${sel.has(u.id) ? 'marcada' : ''}`}>
            <input type="checkbox" checked={sel.has(u.id)} onChange={() => alternar(u.id)} />
            <span>{u.etiqueta}<small>{[u.sector && `Sector ${u.sector}`, u.piso && `piso ${u.piso}`].filter(Boolean).join(' · ')}</small></span>
          </label>
        ))}
        {!visibles.length && <p className="nota">Ninguna casa coincide con el filtro.</p>}
      </div>
    </Estado>
  );
}

// ---------------- WhatsApp ----------------
/** Enlace a la app web (solo si la app corre en una dirección pública; en el teléfono no hay una). */
export function enlaceApp(ruta: string) {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return '';
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return '';
  return `${location.origin}${location.pathname}#${ruta}`;
}
export const urlWhatsApp = (texto: string) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

export function textoWhatsAppPartida(p: Pick<Partida, 'titulo' | 'descripcion' | 'presupuestoUsd' | 'numeroCuotas' | 'alcance' | 'votacion' | 'estado'>) {
  const quien = p.alcance.tipo === 'todos' ? 'todo el condominio' : `${p.alcance.nombre} (${p.alcance.unidades} casas)`;
  const enlace = enlaceApp('/r/partidas');
  return [
    `*${p.votacion?.estado === 'abierta' ? 'Votación' : 'Cuota especial'}: ${p.titulo}*`,
    `${usd(p.presupuestoUsd)} en ${p.numeroCuotas} ${p.numeroCuotas === 1 ? 'cuota' : 'cuotas'}, para ${quien}.`,
    p.descripcion ? p.descripcion : '',
    p.votacion?.estado === 'abierta' ? `Los propietarios votan desde la app ${NOMBRE_APP.replace(' Junta', '')} → Votos.` : '',
    enlace,
  ].filter(Boolean).join('\n');
}

export function BotonWhatsApp({ texto, children = 'Compartir por WhatsApp' }: { texto: string; children?: React.ReactNode }) {
  return <a className="btn btn-whatsapp" href={urlWhatsApp(texto)} target="_blank" rel="noopener noreferrer">{children}</a>;
}

// ---------------- Mensajes masivos ----------------
export function MensajesMasivos() {
  const [params, setParams] = useSearchParams();
  const partidaParam = params.get('partida') ?? '';
  const grupoParam = params.get('grupo') ?? '';
  const modoParam = (params.get('modo') === 'sin_votar' ? 'sin_votar' : partidaParam ? 'partida' : grupoParam ? 'grupo' : 'todos') as ModoAlcance;
  const partidas = useCarga(() => api.partidas());
  const historial = useCarga(() => api.difusiones());
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [alcance, setAlcance] = useState<EstadoAlcance>({ ...alcanceInicial(modoParam, partidaParam), grupoId: grupoParam });
  const [soloProp, setSoloProp] = useState(false);
  const [previa, setPrevia] = useState<PreviaDifusion | null>(null);
  const [errPrevia, setErrPrevia] = useState<string | null>(null);
  const [paso, setPaso] = useState<'editar' | 'confirmar' | 'enviado'>('editar');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<DifusionEnviada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prellenado = useRef(false);

  // Si viene desde una cuota especial, el texto llega listo para editar.
  useEffect(() => {
    if (prellenado.current || !partidaParam || !partidas.datos) return;
    const p = partidas.datos.find((x) => x.id === partidaParam);
    if (!p) return;
    prellenado.current = true;
    if (modoParam === 'sin_votar') {
      setTitulo(`Falta su voto: ${p.titulo}`.slice(0, 120));
      setCuerpo(`Recuerde votar la cuota especial "${p.titulo}" (${usd(p.presupuestoUsd)} en ${p.numeroCuotas} ${p.numeroCuotas === 1 ? 'cuota' : 'cuotas'}). `
        + 'Solo el propietario de cada casa vota, desde la app en la sección Votos.');
      setSoloProp(true);
    } else {
      setTitulo(`${p.votacion?.estado === 'abierta' ? 'Votación' : 'Cuota especial'}: ${p.titulo}`.slice(0, 120));
      setCuerpo(`${p.descripcion ? p.descripcion + '\n' : ''}${usd(p.presupuestoUsd)} en ${p.numeroCuotas} ${p.numeroCuotas === 1 ? 'cuota' : 'cuotas'}`
        + `${p.alcance.tipo === 'todos' ? '' : `, para ${p.alcance.nombre}`}.`
        + (p.votacion?.estado === 'abierta' ? ' Los propietarios pueden votar desde la app.' : ''));
    }
  }, [partidas.datos, partidaParam, modoParam]);

  // Vista previa: a cuántas casas y personas llegará (se recalcula al cambiar el alcance).
  const clave = JSON.stringify([alcanceDe(alcance), soloProp]);
  useEffect(() => {
    const a = alcanceDe(alcance);
    setErrPrevia(null);
    if (!a) { setPrevia(null); return; }
    let vigente = true;
    const t = setTimeout(() => {
      api.previaDifusion(a, soloProp).then((r) => { if (vigente) setPrevia(r); })
        .catch((e: Error) => { if (vigente) { setPrevia(null); setErrPrevia(e.message); } });
    }, 350);
    return () => { vigente = false; clearTimeout(t); };
  }, [clave]); // eslint-disable-line react-hooks/exhaustive-deps

  const listo = titulo.trim().length >= 3 && cuerpo.trim().length >= 3 && !!alcanceDe(alcance) && (previa?.unidades ?? 0) > 0;
  const nombreAlcance = (() => {
    const p = partidas.datos?.find((x) => x.id === alcance.partidaId);
    switch (alcance.modo) {
      case 'todos': return 'todo el condominio';
      case 'grupo': return 'el grupo elegido';
      case 'unidades': return alcance.nombre.trim() || 'las casas elegidas';
      case 'partida': return p ? (p.alcance.tipo === 'todos' ? 'todo el condominio' : p.alcance.nombre ?? 'las casas de la cuota') : 'las casas de la cuota';
      case 'sin_votar': return 'las casas que aún no han votado';
    }
  })();

  async function enviar() {
    setError(null); setEnviando(true);
    try {
      const final = await guardarGrupoSiHaceFalta(alcance);
      if (final !== alcance) setAlcance(final);
      const a = alcanceDe(final);
      if (!a) throw new Error('Elija a quién va el mensaje.');
      const r = await api.difundir({ titulo: titulo.trim(), cuerpo: cuerpo.trim(), alcance: a, soloPropietarios: soloProp,
        ...(partidaParam && a.tipo !== 'partida' && a.tipo !== 'sin_votar' ? { partidaId: partidaParam } : {}) });
      setResultado(r); setPaso('enviado'); historial.recargar();
    } catch (e) { setError((e as Error).message); setPaso('editar'); }
    finally { setEnviando(false); }
  }
  function nuevo() {
    setParams({}, { replace: true });   // el mensaje nuevo ya no va enlazado a la cuota de la que se vino
    setTitulo(''); setCuerpo(''); setAlcance(alcanceInicial()); setSoloProp(false); setResultado(null); setPaso('editar');
  }
  const textoWa = `*${titulo.trim()}*\n${cuerpo.trim()}`;

  return (
    <>
      {paso === 'enviado' && resultado ? (
        <Tarjeta titulo="Mensaje enviado">
          <div className="aviso aviso-ok">Llegó a <strong>{resultado.unidades} casa{resultado.unidades === 1 ? '' : 's'}</strong> · {resultado.personas} persona{resultado.personas === 1 ? '' : 's'} con la app. Lo verán en sus notificaciones.</div>
          <p className="nota">Quien todavía no usa la app no lo recibe: compártalo también en el grupo de WhatsApp del condominio.</p>
          <div className="fila-botones">
            <BotonWhatsApp texto={textoWa} />
            <button className="btn btn-sec" onClick={nuevo}>Nuevo mensaje</button>
          </div>
        </Tarjeta>
      ) : (
        <form className="formulario" onSubmit={(e) => { e.preventDefault(); if (listo) setPaso('confirmar'); }}>
          <Tarjeta titulo="Mensaje masivo">
            <p className="nota">Llega como notificación al teléfono de cada persona incluida (y por correo si lo tiene activado).</p>
            <Campo etiqueta="Título"><input value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej.: Corte de agua el sábado" required /></Campo>
            <Campo etiqueta="Mensaje"><textarea rows={4} value={cuerpo} maxLength={2000} onChange={(e) => setCuerpo(e.target.value)} placeholder="Escriba el mensaje para los vecinos" required /></Campo>
            <Estado cargando={partidas.cargando} error={partidas.error}>
              <SelectorAlcance valor={alcance} cambiar={(e) => { setAlcance(e); setPaso('editar'); }}
                               modos={['todos', 'grupo', 'unidades', 'partida', 'sin_votar']} partidas={partidas.datos ?? []} />
            </Estado>
            <label className="interruptor">
              <input type="checkbox" checked={soloProp} onChange={(e) => setSoloProp(e.target.checked)} />
              <span><strong>Solo propietarios</strong><small>Sin inquilinos ni otros residentes (útil para votaciones).</small></span>
            </label>
            {previa && (
              <div className="previa" aria-live="polite">
                <span>Llegará a {previa.unidades} casa{previa.unidades === 1 ? '' : 's'} · {previa.personas} persona{previa.personas === 1 ? '' : 's'}
                  <small>{previa.personas < previa.unidades ? 'Algunas casas aún no tienen a nadie registrado en la app.' : 'Todas las casas tienen a alguien en la app.'}</small></span>
              </div>
            )}
            {errPrevia && <div className="aviso aviso-error">{errPrevia}</div>}
          </Tarjeta>
          {paso === 'confirmar' ? (
            <Tarjeta className="confirmar-envio" titulo="¿Enviar ahora?">
              <p>Se enviará «<strong>{titulo.trim()}</strong>» a <strong>{nombreAlcance}</strong>: {previa?.unidades} casa{previa?.unidades === 1 ? '' : 's'} · {previa?.personas} persona{previa?.personas === 1 ? '' : 's'}{soloProp ? ' (solo propietarios)' : ''}.</p>
              <div className="fila-botones">
                <button type="button" className="btn" disabled={enviando} onClick={() => void enviar()}>{enviando ? 'Enviando…' : 'Sí, enviar'}</button>
                <button type="button" className="btn btn-sec" onClick={() => setPaso('editar')}>Volver</button>
              </div>
            </Tarjeta>
          ) : (
            <div className="fila-botones">
              <button className="btn" disabled={!listo}>Revisar y enviar</button>
              {titulo.trim() && cuerpo.trim() && <BotonWhatsApp texto={textoWa}>WhatsApp</BotonWhatsApp>}
            </div>
          )}
          {error && <div className="aviso aviso-error">{error}</div>}
        </form>
      )}

      <Tarjeta titulo="Mensajes enviados">
        <Estado cargando={historial.cargando} error={historial.error}>
          {historial.datos?.length ? (
            <ul className="lista difusiones">
              {historial.datos.map((d: Difusion) => (
                <li key={d.id}>
                  <strong>{d.titulo}</strong>
                  <p>{d.cuerpo}</p>
                  <small className="meta">
                    {d.alcanceNombre ?? 'Todo el condominio'} · {d.unidades} casa{d.unidades === 1 ? '' : 's'} · {d.personas} persona{d.personas === 1 ? '' : 's'}
                    {d.soloPropietarios ? ' · solo propietarios' : ''} · {fecha(d.creadoEn)}{d.creadoPor ? ` · ${d.creadoPor}` : ''}
                  </small>
                </li>
              ))}
            </ul>
          ) : <Vacio>Todavía no se ha enviado ningún mensaje masivo.</Vacio>}
        </Estado>
      </Tarjeta>
    </>
  );
}

// ---------------- Grupos de casas ----------------
export function GruposCasas() {
  const grupos = useCarga(() => api.grupos());
  const casas = useCarga(() => api.unidadesAlcance());
  const [editando, setEditando] = useState<GrupoUnidades | 'nuevo' | null>(null);
  const [borrar, setBorrar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const etq = (ids: string[]) => {
    const m = new Map((casas.datos ?? []).map((u: UnidadAlcance) => [u.id, u.etiqueta]));
    const e = ids.map((i) => m.get(i) ?? '').filter(Boolean);
    return e.length > 8 ? `${e.slice(0, 8).join(', ')} y ${e.length - 8} más` : e.join(', ');
  };
  async function eliminar(id: string) {
    setError(null);
    try { await api.borrarGrupo(id); setBorrar(null); grupos.recargar(); } catch (e) { setError((e as Error).message); }
  }

  if (editando) {
    return <FormGrupo grupo={editando === 'nuevo' ? null : editando} alTerminar={() => { setEditando(null); grupos.recargar(); }} />;
  }
  return (
    <>
      <p className="nota">Guarde las casas que suelen ir juntas: una calle con portón propio, un piso con su llave, una torre. Úselos para cuotas especiales y mensajes masivos.</p>
      <button className="btn btn-ancho" onClick={() => setEditando('nuevo')}>+ Nuevo grupo</button>
      <Estado cargando={grupos.cargando} error={grupos.error}>
        {grupos.datos?.length ? grupos.datos.map((g) => (
          <Tarjeta key={g.id} titulo={g.nombre} accion={<Etiqueta tono="info">{g.unidadIds.length} casa{g.unidadIds.length === 1 ? '' : 's'}</Etiqueta>}>
            {g.descripcion && <p style={{ margin: 0 }}>{g.descripcion}</p>}
            <p className="grupo-casas" style={{ margin: 0 }}>{etq(g.unidadIds)}</p>
            {borrar === g.id ? (
              <div className="fila-botones">
                <span className="nota">¿Borrar el grupo? Las cuotas y mensajes ya enviados no cambian.</span>
                <button className="btn btn-peligro" onClick={() => void eliminar(g.id)}>Borrar</button>
                <button className="btn btn-sec" onClick={() => setBorrar(null)}>No</button>
              </div>
            ) : (
              <div className="fila-botones">
                <button className="btn btn-sec" onClick={() => setEditando(g)}>Editar</button>
                <Link className="btn btn-sec" to={`/p/mensajes?grupo=${g.id}`}>Enviar mensaje</Link>
                <button className="btn-texto" onClick={() => setBorrar(g.id)}>Borrar</button>
              </div>
            )}
          </Tarjeta>
        )) : <Vacio>No hay grupos guardados.</Vacio>}
      </Estado>
      {error && <div className="aviso aviso-error">{error}</div>}
      <Tarjeta titulo="Ubicación de las casas">
        <p className="nota" style={{ margin: 0 }}>Calle o bloque, posición y piso de cada casa. Sirve para los filtros de arriba y para la asistencia vecinal.</p>
        <Link className="btn btn-sec" to="/p/ubicacion">Editar ubicación</Link>
      </Tarjeta>
    </>
  );
}

function FormGrupo({ grupo, alTerminar }: { grupo: GrupoUnidades | null; alTerminar: () => void }) {
  const [nombre, setNombre] = useState(grupo?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(grupo?.descripcion ?? '');
  const [ids, setIds] = useState<string[]>(grupo?.unidadIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ids.length) return setError('Elija al menos una casa.');
    setGuardando(true);
    try {
      const d = { nombre: nombre.trim(), descripcion: descripcion.trim() || null, unidadIds: ids };
      if (grupo) await api.editarGrupo(grupo.id, d); else await api.crearGrupo(d);
      alTerminar();
    } catch (err) { setError((err as Error).message); }
    finally { setGuardando(false); }
  }
  return (
    <form className="formulario" onSubmit={guardar}>
      <Tarjeta titulo={grupo ? 'Editar grupo' : 'Nuevo grupo de casas'}>
        <Campo etiqueta="Nombre"><input value={nombre} onChange={(e) => setNombre(e.target.value)} required minLength={2} maxLength={80} placeholder="Ej.: Calle 3 · portón, Torre B · piso 4" /></Campo>
        <Campo etiqueta="Descripción (opcional)"><input value={descripcion} maxLength={300} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej.: Casas detrás del portón eléctrico" /></Campo>
        <div className="alcance-detalle"><ElegirCasas seleccion={ids} cambiar={setIds} /></div>
      </Tarjeta>
      {error && <div className="aviso aviso-error">{error}</div>}
      <div className="fila-botones">
        <button className="btn" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar grupo'}</button>
        <button type="button" className="btn-texto" onClick={alTerminar}>Cancelar</button>
      </div>
    </form>
  );
}

// ---------------- Una notificación a pantalla completa (mensajes de la junta sin otra pantalla) ----------------
export function NotificacionCompleta() {
  const { id } = useParams();
  const ir = useNavigate();
  const prefijo = usePrefijo();
  const [n, setN] = useState<Notificacion | null | undefined>(undefined);
  useEffect(() => {
    api.notificaciones().then((b) => {
      const x = b.notificaciones.find((y) => y.id === id) ?? null;
      setN(x);
      if (x && !x.leida) api.marcarNotificaciones([x.id]).then(avisarCambioNotificaciones).catch(() => {});
    }).catch(() => setN(null));
  }, [id]);
  if (n === undefined) return <div className="cargando">Cargando…</div>;
  if (!n) return <Vacio>Este mensaje ya no está disponible.</Vacio>;
  return (
    <>
      <Tarjeta className="notif-completa">
        <small className="meta">{n.tipo === 'difusion' ? 'Mensaje de la junta' : 'Notificación'} · {hace(n.creadoEn)}</small>
        <h2>{n.titulo}</h2>
        <p>{n.cuerpo}</p>
      </Tarjeta>
      <button className="btn btn-sec" onClick={() => ir(`${prefijo}/notificaciones`)}>Volver a notificaciones</button>
    </>
  );
}
