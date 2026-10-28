// Pantallas que usan residentes y Presidencia, con acciones según el rol.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type CategoriaReporte, type EstadoReporte, type Partida, type Ponderacion, type Visibilidad } from '../data';
import { Campo, Estado, Etiqueta, Tarjeta, Vacio, useCarga } from '../components/ui';
import { CATEGORIAS, ESTADO_PARTIDA, ESTADO_REPORTE, fecha, mes, mesSiguiente, pct, periodoActual, usd } from '../formato';

// ---------------- Reportes ----------------
export function Reportes() {
  const s = api.sesion()!;
  const { datos, cargando, error, recargar } = useCarga(() => api.reportes());
  const [filtro, setFiltro] = useState<'abiertos' | 'mios' | 'todos'>(s.esJunta ? 'abiertos' : 'todos');
  const lista = (datos ?? []).filter((r) =>
    filtro === 'todos' ? true : filtro === 'mios' ? r.esMio : !['resuelto', 'descartado'].includes(r.estado));

  async function cambiar(id: string, estado: EstadoReporte) {
    await api.cambiarEstadoReporte(id, estado);
    recargar();
  }

  return (
    <>
      {!s.esJunta && <Link className="btn btn-ancho" to="/r/reportes/nuevo">+ Nuevo reporte</Link>}
      <div className="chips">
        {(s.esJunta ? ['abiertos', 'todos'] as const : ['todos', 'mios'] as const).map((f) => (
          <button key={f} className={`chip ${filtro === f ? 'chip-activo' : ''}`} onClick={() => setFiltro(f)}>
            {{ abiertos: 'Abiertos', mios: 'Mis reportes', todos: 'Todos' }[f]}
          </button>
        ))}
      </div>
      <Estado cargando={cargando} error={error}>
        {lista.length ? lista.map((r) => (
          <Tarjeta key={r.id} className="reporte">
            <div className="reporte-cab">
              <Etiqueta tono="neutro">{CATEGORIAS[r.categoria]}</Etiqueta>
              <Etiqueta tono={r.estado === 'resuelto' ? 'ok' : r.estado === 'nuevo' ? 'alerta' : r.estado === 'descartado' ? 'neutro' : 'info'}>
                {ESTADO_REPORTE[r.estado]}
              </Etiqueta>
            </div>
            <h3>{r.titulo}</h3>
            <p>{r.descripcion}</p>
            {r.fotos.length > 0 && <div className="fotos">{r.fotos.map((f) => <img key={f} src={f} alt="Foto del reporte" />)}</div>}
            <small className="meta">
              {r.ubicacion && <>{r.ubicacion} · </>}
              {r.anonimo ? 'Anónimo' : r.autorNombre ?? 'Vecino'} · {fecha(r.creadoEn)}
              {r.visibilidad === 'presidencia' ? ' · Solo Presidencia' : ' · Visible a la comunidad'}
              {r.esMio && ' · Enviado por usted'}
            </small>
            {s.esJunta && !['resuelto', 'descartado'].includes(r.estado) && (
              <div className="fila-botones">
                {r.estado === 'nuevo' && <button className="btn btn-sec" onClick={() => cambiar(r.id, 'en_proceso')}>Tomar caso</button>}
                <button className="btn" onClick={() => cambiar(r.id, 'resuelto')}>Marcar resuelto</button>
                <button className="btn-texto" onClick={() => cambiar(r.id, 'descartado')}>Descartar</button>
              </div>
            )}
            <Comentarios reporteId={r.id} />
          </Tarjeta>
        )) : <Vacio>No hay reportes en esta vista.</Vacio>}
      </Estado>
    </>
  );
}

export function NuevoReporte() {
  const ir = useNavigate();
  const [categoria, setCategoria] = useState<CategoriaReporte>('ruido');
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [anonimo, setAnonimo] = useState(false);
  const [visibilidad, setVisibilidad] = useState<Visibilidad>('presidencia');
  const [fotos, setFotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // En reportes anónimos el servidor guarda las fotos sin dueño y les quita los datos ocultos (GPS, modelo del teléfono).
  const fotosPermitidas = true;

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null); setEnviando(true);
    try {
      await api.crearReporte({ categoria, titulo, descripcion, ubicacion, anonimo, visibilidad, fotos: fotosPermitidas ? fotos : [] });
      ir('/r/reportes');
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  }

  return (
    <form className="formulario" onSubmit={enviar}>
      <Tarjeta titulo="¿Qué está pasando?">
        <div className="chips">
          {(Object.keys(CATEGORIAS) as CategoriaReporte[]).map((c) => (
            <button type="button" key={c} className={`chip ${categoria === c ? 'chip-activo' : ''}`} onClick={() => setCategoria(c)}>{CATEGORIAS[c]}</button>
          ))}
        </div>
        <Campo etiqueta="Título"><input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej.: Música muy alta en la noche" required maxLength={80} /></Campo>
        <Campo etiqueta="Descripción">
          <textarea rows={4} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} required
                    placeholder="Describa lo que ocurre, desde cuándo y a qué hora." />
        </Campo>
        <Campo etiqueta="Ubicación" ayuda="Bloque, apartamento o área común">
          <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Ej.: Bloque B, apto 34" />
        </Campo>
        {fotosPermitidas ? (
          <Campo etiqueta="Fotos (opcional)">
            <input type="file" accept="image/*" multiple onChange={(e) => setFotos([...(e.target.files ?? [])].slice(0, 4))} />
          </Campo>
        ) : null}
      </Tarjeta>

      <Tarjeta titulo="Privacidad">
        <label className="interruptor">
          <input type="checkbox" checked={anonimo} onChange={(e) => setAnonimo(e.target.checked)} />
          <span><strong>Enviar como anónimo</strong><small>Presidencia y los vecinos no verán su nombre. Usted podrá seguir el caso en “Mis reportes”.</small></span>
        </label>
        <div className="chips">
          <button type="button" className={`chip ${visibilidad === 'presidencia' ? 'chip-activo' : ''}`} onClick={() => setVisibilidad('presidencia')}>Solo Presidencia</button>
          <button type="button" className={`chip ${visibilidad === 'comunidad' ? 'chip-activo' : ''}`} onClick={() => setVisibilidad('comunidad')}>Compartir con vecinos</button>
        </div>
      </Tarjeta>
      {error && <div className="aviso aviso-error">{error}</div>}
      <button className="btn btn-ancho" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar reporte'}</button>
      <p className="nota">Para evitar abusos, cada persona puede enviar hasta 5 reportes por día.</p>
    </form>
  );
}

// ---------------- Partidas especiales y votaciones ----------------
export function Partidas() {
  const s = api.sesion()!;
  const { datos, cargando, error, recargar } = useCarga(() => api.partidas());
  const [creando, setCreando] = useState(false);

  return (
    <>
      {s.esJunta && !creando && <button className="btn btn-ancho" onClick={() => setCreando(true)}>+ Nueva partida especial</button>}
      {creando && <FormPartida alTerminar={() => { setCreando(false); recargar(); }} />}
      <Estado cargando={cargando} error={error}>
        {datos?.length ? datos.map((p) => <TarjetaPartida key={p.id} p={p} alCambiar={recargar} />) : <Vacio>No hay partidas especiales.</Vacio>}
      </Estado>
    </>
  );
}

function TarjetaPartida({ p, alCambiar }: { p: Partida; alCambiar: () => void }) {
  const s = api.sesion()!;
  const [error, setError] = useState<string | null>(null);
  const v = p.votacion;
  const aprobar = v?.opciones.find((o) => o.orden === 0);

  async function accion(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); alCambiar(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <Tarjeta className="partida">
      <div className="reporte-cab">
        <Etiqueta tono={p.estado === 'rechazada' ? 'error' : p.estado === 'en_votacion' ? 'alerta' : 'ok'}>{ESTADO_PARTIDA[p.estado]}</Etiqueta>
        <strong>{usd(p.presupuestoUsd)}</strong>
      </div>
      <h3>{p.titulo}</h3>
      {p.descripcion && <p>{p.descripcion}</p>}
      <small className="meta">
        {p.numeroCuotas} cuota{p.numeroCuotas > 1 && 's'} · reparto {p.reparto === 'alicuota' ? 'por alícuota' : 'en partes iguales'}
        {p.primeraCuota && ` · desde ${mes(p.primeraCuota)}`}
      </small>
      {p.cuotaMiUnidadUsd != null && (
        <div className="datos-pago"><strong>Su aporte</strong><span>{usd(p.cuotaMiUnidadUsd)} por cuota · {usd(p.cuotaMiUnidadUsd * p.numeroCuotas)} en total</span></div>
      )}

      {v && (
        <div className="votacion">
          <h4>{v.titulo}</h4>
          {v.opciones.map((o) => (
            <div key={o.id} className="barra-voto">
              <div className="barra-voto-txt"><span>{o.texto}{v.miVotoOpcionId === o.id && ' ✓ su voto'}</span><span>{pct(o.pesoPct)} · {o.unidades} apto{o.unidades !== 1 && 's'}</span></div>
              <div className="barra-voto-fondo"><div style={{ width: `${Math.min(100, o.pesoPct)}%` }} className={o.orden === 0 ? 'si' : 'no'} /></div>
            </div>
          ))}
          <small className="meta">
            Se aprueba con {pct(v.umbralPct)} del total del condominio ({v.ponderacion === 'alicuota' ? 'votos ponderados por alícuota' : 'un voto por apartamento'}).
            {aprobar && v.estado === 'abierta' && ` Faltan ${pct(Math.max(0, v.umbralPct - aprobar.pesoPct))} para aprobar.`}
          </small>
          {v.estado === 'abierta' && !s.esJunta && s.rol === 'propietario' && !v.miVotoOpcionId && (
            <div className="fila-botones">
              {v.opciones.map((o) => (
                <button key={o.id} className={`btn ${o.orden === 0 ? '' : 'btn-sec'}`} onClick={() => accion(() => api.votar(v.id, o.id))}>{o.texto}</button>
              ))}
            </div>
          )}
          {v.estado === 'abierta' && !s.esJunta && s.rol !== 'propietario' && <p className="nota">Solo el propietario de la unidad puede votar.</p>}
          {v.estado === 'abierta' && s.esJunta && (
            <div className="fila-botones"><button className="btn btn-sec" onClick={() => accion(() => api.cerrarVotacion(v.id))}>Cerrar votación y contar</button></div>
          )}
        </div>
      )}
      {error && <div className="aviso aviso-error">{error}</div>}
    </Tarjeta>
  );
}

function FormPartida({ alTerminar }: { alTerminar: () => void }) {
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [presupuesto, setPresupuesto] = useState('');
  const [cuotas, setCuotas] = useState(1);
  const [primera, setPrimera] = useState(mesSiguiente(periodoActual()));
  const [reparto, setReparto] = useState<Ponderacion>('alicuota');
  const [votar, setVotar] = useState(true);
  const [umbral, setUmbral] = useState(50.01);
  const [error, setError] = useState<string | null>(null);

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    const monto = Number(presupuesto.replace(',', '.'));
    if (!(monto > 0)) return setError('Indique el presupuesto.');
    try {
      await api.crearPartida({ titulo, descripcion, presupuestoUsd: monto, numeroCuotas: cuotas, primeraCuota: primera,
        reparto, someterAVotacion: votar, umbralPct: umbral, cierraEn: null });
      alTerminar();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <form className="formulario" onSubmit={guardar}>
      <Tarjeta titulo="Nueva partida especial">
        <Campo etiqueta="Título"><input value={titulo} onChange={(e) => setTitulo(e.target.value)} required placeholder="Ej.: Pintura de fachada Bloque B" /></Campo>
        <Campo etiqueta="Descripción y presupuestos recibidos"><textarea rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></Campo>
        <div className="dos-col">
          <Campo etiqueta="Presupuesto (USD)"><input inputMode="decimal" value={presupuesto} onChange={(e) => setPresupuesto(e.target.value)} required /></Campo>
          <Campo etiqueta="Cuotas"><input type="number" min={1} max={24} value={cuotas} onChange={(e) => setCuotas(Number(e.target.value))} /></Campo>
        </div>
        <Campo etiqueta="Primera cuota (mes)"><input type="month" value={primera.slice(0, 7)} onChange={(e) => setPrimera(e.target.value + '-01')} /></Campo>
        <div className="chips">
          <button type="button" className={`chip ${reparto === 'alicuota' ? 'chip-activo' : ''}`} onClick={() => setReparto('alicuota')}>Por alícuota</button>
          <button type="button" className={`chip ${reparto === 'unidad' ? 'chip-activo' : ''}`} onClick={() => setReparto('unidad')}>Partes iguales</button>
        </div>
        <label className="interruptor">
          <input type="checkbox" checked={votar} onChange={(e) => setVotar(e.target.checked)} />
          <span><strong>Someter a votación</strong><small>Se cobra solo si se aprueba.</small></span>
        </label>
        {votar && (
          <Campo etiqueta="Porcentaje para aprobar" ayuda="Según el documento de condominio. Mayoría simple: 50,01 %; dos tercios: 66,67 %; 75 % para casos especiales.">
            <select value={umbral} onChange={(e) => setUmbral(Number(e.target.value))}>
              <option value={50.01}>Mayoría simple (50,01 %)</option>
              <option value={66.67}>Dos tercios (66,67 %)</option>
              <option value={75}>75 %</option>
            </select>
          </Campo>
        )}
      </Tarjeta>
      {error && <div className="aviso aviso-error">{error}</div>}
      <div className="fila-botones">
        <button className="btn">{votar ? 'Abrir votación' : 'Crear partida'}</button>
        <button type="button" className="btn-texto" onClick={alTerminar}>Cancelar</button>
      </div>
    </form>
  );
}

// ---------------- Comentarios de un reporte (respuesta oficial de la junta y seguimiento) ----------------
function Comentarios({ reporteId }: { reporteId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<import('../data').ComentarioReporte[] | null>(null);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cargar = () => api.comentariosReporte(reporteId).then(setLista).catch((e: Error) => setError(e.message));
  async function enviar() {
    if (!texto.trim()) return;
    setError(null);
    try { await api.comentarReporte(reporteId, texto); setTexto(''); await cargar(); } catch (e) { setError((e as Error).message); }
  }
  if (!abierto) return <button className="btn-texto" onClick={() => { setAbierto(true); void cargar(); }}>Ver comentarios</button>;
  return (
    <div className="comentarios">
      {lista === null ? <small className="meta">Cargando…</small> : lista.length === 0 ? <small className="meta">Sin comentarios todavía.</small> : lista.map((c) => (
        <div key={c.id} className={`comentario ${c.esOficial ? 'oficial' : ''}`}>
          <small className="meta">{c.esOficial ? 'Respuesta oficial · ' : ''}{c.autor ?? 'Anónimo'} · {fecha(c.creadoEn)}</small>
          <p>{c.texto}</p>
        </div>
      ))}
      <div className="fila-botones">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribir un comentario…" maxLength={1000}
               onKeyDown={(e) => { if (e.key === 'Enter') void enviar(); }} style={{ flex: '1 1 180px' }} />
        <button className="btn btn-sec" onClick={() => void enviar()} disabled={!texto.trim()}>Enviar</button>
      </div>
      {error && <div className="aviso aviso-error">{error}</div>}
    </div>
  );
}
