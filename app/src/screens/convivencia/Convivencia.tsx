// Transparencia y convivencia (v0.8):
//   · Vecinos: mensajes anónimos recibidos y enviados (responder, denunciar) y la lista de cuotas vencidas (si la junta la publica).
//   · Junta: decidir si se publica la lista (con o sin montos), si se permiten mensajes anónimos, y revisar denuncias.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type ConfigConvivencia, type MensajeAnonimo, type ModoMorosos, type MorosoPublico, type RespuestaAnonima } from '../../data';
import { Campo, Estado, Etiqueta, Tarjeta, Vacio, useCarga } from '../../components/ui';
import { CATEGORIAS, hace, mes, usd } from '../../formato';
import { BotonDoc, documentoMorosos } from '../Documentos';

const MESES = (n: number) => `${n} ${n === 1 ? 'mes' : 'meses'}`;

function Hilo({ respuestas, yoSoy }: { respuestas: RespuestaAnonima[]; yoSoy: 'casa' | 'remitente' }) {
  if (!respuestas.length) return null;
  return (
    <div className="hilo-anonimo">
      {respuestas.map((r) => (
        <div key={r.id} className={`burbuja-anonima ${r.de === yoSoy ? 'mia' : ''}`}>
          <small>{r.de === yoSoy ? 'Usted' : r.de === 'casa' ? 'La casa' : 'Vecino anónimo'} · {hace(r.creadoEn)}</small>
          <p>{r.texto}</p>
        </div>
      ))}
    </div>
  );
}

// ================= Vecino: mensajes anónimos =================
export function MensajesAnonimos() {
  const [params] = useSearchParams();
  const { datos, cargando, error, recargar } = useCarga(() => api.mensajesAnonimos());
  const [vista, setVista] = useState<'recibido' | 'enviado'>('recibido');
  useEffect(() => api.suscribirNotificaciones((n) => { if (n.tipo === 'mensaje_anonimo') recargar(); }), [recargar]);
  const resaltar = params.get('m');
  useEffect(() => {
    const m = datos?.find((x) => x.id === resaltar);
    if (m) setVista(m.direccion);
  }, [datos, resaltar]);
  const lista = (datos ?? []).filter((m) => m.direccion === vista);
  const sinLeer = (datos ?? []).filter((m) => m.direccion === 'recibido' && !m.leidoEn).length;

  return (
    <>
      <div className="aviso aviso-info privacidad-anonima">
        <strong>🔒 Su identidad está protegida</strong>
        <p>Ni la casa que lo recibe ni la junta pueden saber quién envió un mensaje anónimo. Úselo con respeto: la casa puede denunciar un mensaje ofensivo y la junta puede suspender a quien lo envió, sin saber quién es.</p>
      </div>
      <Link className="btn btn-ancho" to="/r/reportes/nuevo?a=casa">+ Escribir a una casa sin mi nombre</Link>
      <div className="chips">
        <button className={`chip ${vista === 'recibido' ? 'chip-activo' : ''}`} onClick={() => setVista('recibido')}>Recibidos{sinLeer ? ` (${sinLeer})` : ''}</button>
        <button className={`chip ${vista === 'enviado' ? 'chip-activo' : ''}`} onClick={() => setVista('enviado')}>Enviados</button>
      </div>
      <Estado cargando={cargando} error={error}>
        {lista.length ? lista.map((m) => <TarjetaAnonimo key={m.id} m={m} resaltada={m.id === resaltar} alCambiar={recargar} />)
          : <Vacio>{vista === 'recibido' ? 'Su casa no ha recibido mensajes anónimos.' : 'No ha enviado mensajes anónimos.'}</Vacio>}
      </Estado>
    </>
  );
}

function TarjetaAnonimo({ m, resaltada, alCambiar }: { m: MensajeAnonimo; resaltada: boolean; alCambiar: () => void }) {
  const recibido = m.direccion === 'recibido';
  const [modo, setModo] = useState<'nada' | 'responder' | 'denunciar'>('nada');
  const [texto, setTexto] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (recibido && !m.leidoEn) void api.marcarAnonimoLeido(m.id).catch(() => {}); }, [m.id, recibido, m.leidoEn]);

  async function hacer(fn: () => Promise<void>) {
    setErr(null); setOcupado(true);
    try { await fn(); setTexto(''); setModo('nada'); alCambiar(); } catch (e) { setErr((e as Error).message); } finally { setOcupado(false); }
  }
  const cerrada = m.revision === 'bloqueado';
  return (
    <Tarjeta className={`anonimo ${resaltada ? 'resaltada' : ''} ${recibido && !m.leidoEn ? 'no-leido' : ''}`}>
      <div className="reporte-cab">
        <Etiqueta tono="neutro">{CATEGORIAS[m.categoria]}</Etiqueta>
        <small className="meta">{hace(m.creadoEn)}</small>
      </div>
      <strong>{recibido ? 'De: un vecino (anónimo)' : `Para: ${m.aUnidad}`}</strong>
      <p className="texto-anonimo">{m.texto}</p>
      {m.fotos.length > 0 && <div className="fotos">{m.fotos.map((f) => <img key={f} src={f} alt="Foto adjunta" />)}</div>}
      <div className="partida-alcance">
        {m.tambienJunta && <Etiqueta tono="info">También lo recibió la junta</Etiqueta>}
        {!recibido && <Etiqueta tono="ok">Enviado sin su nombre</Etiqueta>}
        {m.denunciadoEn && <Etiqueta tono="alerta">{recibido ? 'Usted lo denunció a la junta' : 'La casa lo denunció a la junta'}</Etiqueta>}
        {cerrada && <Etiqueta tono="error">Conversación cerrada por la junta</Etiqueta>}
      </div>
      <Hilo respuestas={m.respuestas} yoSoy={recibido ? 'casa' : 'remitente'} />
      {err && <div className="aviso aviso-error">{err}</div>}
      {!cerrada && modo === 'responder' && (
        <div className="formulario">
          <Campo etiqueta="Su respuesta" ayuda={recibido ? 'Le llega al vecino que le escribió. Usted no sabrá quién es.' : 'Su respuesta sigue siendo anónima.'}>
            <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={1000} autoFocus />
          </Campo>
          <div className="fila-botones">
            <button className="btn" disabled={ocupado || !texto.trim()} onClick={() => void hacer(() => api.responderAnonimo(m.id, texto))}>Enviar respuesta</button>
            <button className="btn-texto" onClick={() => setModo('nada')}>Cancelar</button>
          </div>
        </div>
      )}
      {recibido && modo === 'denunciar' && (
        <div className="formulario">
          <Campo etiqueta="¿Por qué lo denuncia?" ayuda="La junta verá este mensaje y su motivo, pero tampoco sabrá quién lo envió. Puede suspender a esa persona.">
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: es ofensivo / es falso" autoFocus />
          </Campo>
          <div className="fila-botones">
            <button className="btn btn-peligro" disabled={ocupado || texto.trim().length < 3} onClick={() => void hacer(() => api.denunciarAnonimo(m.id, texto))}>Denunciar a la junta</button>
            <button className="btn-texto" onClick={() => setModo('nada')}>Cancelar</button>
          </div>
        </div>
      )}
      {!cerrada && modo === 'nada' && (
        <div className="fila-botones">
          <button className="btn btn-sec" onClick={() => setModo('responder')}>Responder</button>
          {recibido && !m.denunciadoEn && <button className="btn-texto" onClick={() => setModo('denunciar')}>Denunciar como ofensivo</button>}
        </div>
      )}
    </Tarjeta>
  );
}

// ================= Vecino: cuotas vencidas =================
export function CuotasVencidas() {
  const condo = useCarga(() => api.condominio());
  const lista = useCarga(() => api.morosos());
  const modo = condo.datos?.morososPublicos ?? 'no';
  return (
    <Estado cargando={lista.cargando && !lista.error} error={null}>
      {lista.error ? <Vacio>{lista.error}</Vacio> : (
        <Tarjeta titulo="Casas con cuotas vencidas" accion={<small>{lista.datos?.length ?? 0}</small>}>
          <p className="nota">Publicada por la junta para la transparencia del condominio. Incluye las casas con {MESES(condo.datos?.morososMesesMin ?? 1)} o más de recibos vencidos sin pagar. No se muestran nombres.</p>
          <ListaMorosos lista={lista.datos ?? []} conMonto={modo === 'casas_y_montos'} />
          <Link className="btn btn-sec btn-ancho" to="/r/pagar">¿Su casa está en la lista? Pagar ahora</Link>
        </Tarjeta>
      )}
    </Estado>
  );
}

function ListaMorosos({ lista, conMonto }: { lista: MorosoPublico[]; conMonto: boolean }) {
  if (!lista.length) return <Vacio>Ninguna casa tiene cuotas vencidas. 🎉</Vacio>;
  return (
    <table className="tabla">
      <thead><tr><th>Casa</th><th className="num">Vencido</th>{conMonto && <th className="num">Debe</th>}</tr></thead>
      <tbody>
        {lista.map((m) => (
          <tr key={m.unidadId}>
            <td><strong>{m.etiqueta}</strong><small>desde {mes(m.desde).toLowerCase()}</small></td>
            <td className="num">{MESES(m.mesesVencidos)}</td>
            {conMonto && <td className="num txt-error">{m.montoVencidoUsd != null ? usd(m.montoVencidoUsd) : '—'}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ================= Junta: opciones y denuncias =================
export function ConvivenciaJunta() {
  const s = api.sesion()!;
  const puede = ['presidente', 'administrador'].includes(s.rol);
  const cfg = useCarga(() => api.convivencia());
  const [k, setK] = useState<ConfigConvivencia | null>(null);
  useEffect(() => { if (cfg.datos) setK(cfg.datos); }, [cfg.datos]);
  const previa = useCarga(() => api.morosos(true));
  const denuncias = useCarga(() => api.denunciasAnonimas());
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (location.hash.includes('#denuncias')) document.getElementById('denuncias')?.scrollIntoView(); }, [denuncias.datos]);

  const cambiado = k && cfg.datos && JSON.stringify(k) !== JSON.stringify(cfg.datos);
  const filtrada = (previa.datos ?? []).filter((m) => k && m.mesesVencidos >= k.morososMesesMin);

  async function guardar() {
    if (!k) return;
    setMsg(null); setGuardando(true);
    try {
      await api.fijarConvivencia(k);
      setMsg({ ok: true, t: k.morososPublicos === 'no' ? 'Guardado. La lista de cuotas vencidas no se publica.' : 'Guardado. Los vecinos ya ven la lista (se les avisó al encenderla).' });
      cfg.recargar(); previa.recargar();
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }); } finally { setGuardando(false); }
  }

  return (
    <>
      <Estado cargando={cfg.cargando} error={cfg.error}>
        {k && (
          <>
            <Tarjeta titulo="Lista de cuotas vencidas">
              <p className="nota">Publicar en la app las casas que tienen recibos vencidos sin pagar. <strong>Nunca se muestran nombres</strong>, solo la casa. Al encenderla se avisa a todos los vecinos.</p>
              {(['no', 'casas', 'casas_y_montos'] as ModoMorosos[]).map((m) => (
                <label key={m} className="opcion-radio">
                  <input type="radio" name="morosos" checked={k.morososPublicos === m} disabled={!puede} onChange={() => setK({ ...k, morososPublicos: m })} />
                  <span><strong>{{ no: 'No publicar', casas: 'Publicar solo las casas', casas_y_montos: 'Publicar casas y montos' }[m]}</strong>
                    <small>{{ no: 'Solo la junta ve la morosidad.', casas: 'Los vecinos ven qué casas deben y cuántos meses, sin el monto.', casas_y_montos: 'Los vecinos ven qué casas deben, cuántos meses y cuánto.' }[m]}</small></span>
                </label>
              ))}
              {k.morososPublicos !== 'no' && (
                <Campo etiqueta="Mostrar las casas con al menos">
                  <select value={k.morososMesesMin} disabled={!puede} onChange={(e) => setK({ ...k, morososMesesMin: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 6, 12].map((n) => <option key={n} value={n}>{MESES(n)} vencido{n > 1 ? 's' : ''}</option>)}
                  </select>
                </Campo>
              )}
            </Tarjeta>

            <Tarjeta titulo="Mensajes anónimos entre casas">
              <label className="interruptor">
                <input type="checkbox" checked={k.mensajesAnonimos} disabled={!puede} onChange={(e) => setK({ ...k, mensajesAnonimos: e.target.checked })} />
                <span><strong>Permitir que un vecino le escriba a otra casa sin su nombre</strong>
                  <small>Para quejarse o avisar sin roces ni represalias. Máximo 3 por día y 1 por día a la misma casa. La casa puede responder o denunciar; la junta puede suspender al remitente sin saber quién es.</small></span>
              </label>
            </Tarjeta>
            {puede ? (
              <button className="btn btn-ancho" disabled={!cambiado || guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
            ) : <p className="nota">Solo presidencia o la administración cambia estas opciones.</p>}
            {msg && <div className={`aviso ${msg.ok ? 'aviso-ok' : 'aviso-error'}`}>{msg.t}</div>}

            <Tarjeta titulo={k.morososPublicos === 'no' ? 'Vista previa (solo la junta la ve)' : 'Lo que ven los vecinos'} accion={<small>{filtrada.length} casas</small>}>
              <Estado cargando={previa.cargando} error={previa.error}>
                <ListaMorosos lista={filtrada} conMonto={k.morososPublicos !== 'casas'} />
                <div className="doc-fila">
                  <BotonDoc texto="Lista para la cartelera" formato="PDF" deshabilitado={!filtrada.length}
                            hacer={() => documentoMorosos(filtrada, k.morososPublicos === 'casas' ? false : true, k.morososMesesMin)} />
                </div>
              </Estado>
            </Tarjeta>
          </>
        )}
      </Estado>

      <Tarjeta id="denuncias" titulo="Mensajes anónimos denunciados" accion={<small>{(denuncias.datos ?? []).filter((d) => !d.revision).length} por revisar</small>}>
        <p className="nota">Solo llegan aquí los mensajes que la casa que los recibió denunció. Usted ve el mensaje, la casa y el motivo; <strong>nunca quién lo envió</strong>.</p>
        <Estado cargando={denuncias.cargando} error={denuncias.error}>
          {denuncias.datos?.length ? denuncias.datos.map((d) => <TarjetaDenuncia key={d.id} d={d} alCambiar={denuncias.recargar} />)
            : <Vacio>No hay denuncias.</Vacio>}
        </Estado>
      </Tarjeta>
    </>
  );
}

function TarjetaDenuncia({ d, alCambiar }: { d: import('../../data').DenunciaAnonima; alCambiar: () => void }) {
  const [dias, setDias] = useState(30);
  const [err, setErr] = useState<string | null>(null);
  async function revisar(accion: 'bloquear' | 'descartar') {
    setErr(null);
    try { await api.revisarDenuncia(d.id, accion, dias); alCambiar(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="denuncia">
      <div className="reporte-cab">
        <span><Etiqueta tono="neutro">{CATEGORIAS[d.categoria]}</Etiqueta> Para {d.aUnidad}</span>
        {d.revision ? <Etiqueta tono={d.revision === 'bloqueado' ? 'error' : 'neutro'}>{d.revision === 'bloqueado' ? 'Remitente suspendido' : 'Descartada'}</Etiqueta>
                    : <Etiqueta tono="alerta">Por revisar</Etiqueta>}
      </div>
      <p className="texto-anonimo">“{d.texto}”</p>
      {d.fotos.length > 0 && <div className="fotos">{d.fotos.map((f) => <img key={f} src={f} alt="Foto adjunta" />)}</div>}
      <small className="meta">Motivo de la denuncia: {d.motivo} · {hace(d.denunciadoEn)}</small>
      {d.reincidente && <small className="txt-error">El mismo remitente ya tuvo otro mensaje denunciado.</small>}
      <Hilo respuestas={d.respuestas} yoSoy="casa" />
      {err && <div className="aviso aviso-error">{err}</div>}
      {!d.revision && (
        <div className="fila-botones">
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Días de suspensión">
            {[7, 15, 30, 90, 365].map((n) => <option key={n} value={n}>{n} días</option>)}
          </select>
          <button className="btn btn-peligro" onClick={() => void revisar('bloquear')}>Suspender al remitente</button>
          <button className="btn-texto" onClick={() => void revisar('descartar')}>Descartar denuncia</button>
        </div>
      )}
    </div>
  );
}
