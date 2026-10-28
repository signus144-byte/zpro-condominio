import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Moneda } from '../../data';
import { Campo, Cifra, Estado, Etiqueta, Tarjeta, Vacio, useCarga } from '../../components/ui';
import { ESTADO_PAGO, METODOS, bs, fecha, mes, mesAnterior, mesSiguiente, monto, periodoActual, usd } from '../../formato';
import { BotonSOS } from '../alerta/Alerta';

// ---------------- Panel (columna financiera) ----------------
export function Panel() {
  const { datos: d, cargando, error, recargar } = useCarga(() => api.panel());
  // Llega un pago nuevo (o se revisa uno): el panel y el recordatorio se actualizan solos.
  useEffect(() => api.suscribirNotificaciones(() => recargar()), [recargar]);
  const tasa = useCarga(() => api.tasaBcv());
  return (
    <Estado cargando={cargando} error={error}>
      {d && (
        <>
          {d.pagosPorConfirmar > 0 && (
            <div className="banner-pendientes" role="status">
              <div>
                <strong>{d.pagosPorConfirmar === 1 ? '1 pago por aprobar o rechazar' : `${d.pagosPorConfirmar} pagos por aprobar o rechazar`}</strong>
                <small>Los residentes ven su pago “en revisión” hasta que usted decida.</small>
              </div>
              <Link to="/p/pagos" className="btn">Revisar pagos</Link>
            </div>
          )}
          <BotonSOS />
          <p className="subtitulo">{mes(d.periodo)}{tasa.datos && ` · Tasa BCV ${tasa.datos.usdVes.toLocaleString('es-VE')} Bs/$`}</p>
          <div className="cifras">
            <Cifra etiqueta="Facturado del mes" valor={usd(d.facturadoMesUsd)} />
            <Cifra etiqueta="Cobrado del mes" valor={usd(d.recaudadoMesUsd)}
                   nota={d.facturadoMesUsd ? `${Math.round(100 * d.recaudadoMesUsd / d.facturadoMesUsd)} % de lo facturado` : undefined} />
            <Cifra etiqueta="Gastos del mes" valor={usd(d.gastosMesUsd)} />
            <Cifra etiqueta="Deuda total" valor={usd(d.deudaTotalUsd)} tono={d.deudaTotalUsd > 0 ? 'error' : 'ok'}
                   nota={`${d.unidadesMorosas} de ${d.totalUnidades} unidades con saldo pendiente`} />
          </div>

          <div className="accesos">
            <Link to="/p/pagos" className="acceso">
              <strong>{d.pagosPorConfirmar}</strong><span>pagos por revisar</span>
            </Link>
            <Link to="/p/reportes" className="acceso">
              <strong>{d.reportesAbiertos}</strong><span>reportes abiertos</span>
            </Link>
          </div>

          <Tarjeta titulo="Saldos por cuenta">
            <table className="tabla">
              <tbody>
                {d.saldosCuentas.map((c) => (
                  <tr key={c.nombre}><td>{c.nombre}</td><td className={`num ${c.saldo < 0 ? 'txt-error' : ''}`}>{monto(c.saldo, c.moneda)}</td></tr>
                ))}
              </tbody>
            </table>
          </Tarjeta>
        </>
      )}
    </Estado>
  );
}

// ---------------- Pagos por confirmar ----------------
export function PagosPresidencia() {
  const [filtro, setFiltro] = useState<'reportado' | 'todos'>('reportado');
  const { datos, cargando, error, recargar } = useCarga(() => api.pagos(filtro), [filtro]);
  useEffect(() => api.suscribirNotificaciones((n) => { if (n.tipo === 'pago_reportado') recargar(); }), [recargar]);
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [errAccion, setErrAccion] = useState<string | null>(null);

  async function accion(fn: () => Promise<void>) {
    setErrAccion(null);
    try { await fn(); setRechazando(null); setMotivo(''); recargar(); } catch (e) { setErrAccion((e as Error).message); }
  }

  return (
    <>
      <div className="chips">
        <button className={`chip ${filtro === 'reportado' ? 'chip-activo' : ''}`} onClick={() => setFiltro('reportado')}>Por revisar</button>
        <button className={`chip ${filtro === 'todos' ? 'chip-activo' : ''}`} onClick={() => setFiltro('todos')}>Todos</button>
      </div>
      {errAccion && <div className="aviso aviso-error">{errAccion}</div>}
      <Estado cargando={cargando} error={error}>
        {datos?.length ? datos.map((p) => (
          <Tarjeta key={p.id} className="pago">
            <div className="reporte-cab">
              <strong>Apto {p.unidadEtiqueta}</strong>
              <Etiqueta tono={p.estado === 'confirmado' ? 'ok' : p.estado === 'rechazado' ? 'error' : 'info'}>{ESTADO_PAGO[p.estado]}</Etiqueta>
            </div>
            <div className="pago-monto">
              {p.moneda === 'USD' ? usd(p.monto) : bs(p.monto)}
              {p.moneda === 'VES' && <small> = {usd(p.montoUsd)} · tasa {p.tasaBcv}</small>}
            </div>
            <small className="meta">
              {METODOS[p.metodo]} · {fecha(p.fechaPago)}{p.referencia && <> · Ref. <strong>{p.referencia}</strong></>}{p.bancoOrigen && ` · ${p.bancoOrigen}`}
            </small>
            {p.comprobanteUrl && <a className="btn-texto" href={p.comprobanteUrl} target="_blank" rel="noreferrer">Ver comprobante</a>}
            {p.motivoRechazo && <small className="txt-error">Rechazado: {p.motivoRechazo}</small>}
            {p.estado === 'reportado' && (rechazando === p.id ? (
              <div className="formulario">
                <Campo etiqueta="Motivo del rechazo" ayuda="La casa recibirá este motivo en su notificación"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: la referencia no aparece en el banco" autoFocus /></Campo>
                <div className="fila-botones">
                  <button className="btn btn-peligro" disabled={motivo.trim().length < 3} onClick={() => accion(() => api.rechazarPago(p.id, motivo.trim()))}>Rechazar pago</button>
                  <button className="btn-texto" onClick={() => setRechazando(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="fila-botones">
                <button className="btn" onClick={() => accion(() => api.confirmarPago(p.id))}>Aprobar (ya está en el banco)</button>
                <button className="btn btn-sec" onClick={() => setRechazando(p.id)}>Rechazar</button>
              </div>
            ))}
          </Tarjeta>
        )) : <Vacio>{filtro === 'reportado' ? 'No hay pagos por revisar. 🎉' : 'Sin pagos.'}</Vacio>}
      </Estado>
    </>
  );
}

// ---------------- Gastos y recibos ----------------
export function Gastos() {
  const [periodo, setPeriodo] = useState(periodoActual());
  const { datos, cargando, error, recargar } = useCarga(() => api.gastos(periodo), [periodo]);
  const tasa = useCarga(() => api.tasaBcv());
  const [nuevo, setNuevo] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const total = (datos ?? []).reduce((s, g) => s + g.montoUsd, 0);

  async function emitir() {
    setMsg(null);
    try {
      const n = await api.generarRecibos(periodo);
      setMsg({ ok: true, t: `Se emitieron ${n} recibos de ${mes(periodo)}.` });
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }); }
  }

  return (
    <>
      <div className="selector-mes">
        <button className="btn-texto" onClick={() => setPeriodo(mesAnterior(periodo))}>‹</button>
        <strong>{mes(periodo)}</strong>
        <button className="btn-texto" onClick={() => setPeriodo(mesSiguiente(periodo))}>›</button>
      </div>
      <Tarjeta titulo="Relación de gastos" accion={<strong>{usd(total)}</strong>}>
        <Estado cargando={cargando} error={error}>
          {datos?.length ? (
            <table className="tabla">
              <tbody>
                {datos.map((g) => (
                  <tr key={g.id}>
                    <td>{g.descripcion}<small>{g.categoria}{g.tipo !== 'comun' && ` · ${g.tipo === 'no_comun' ? 'no común' : 'partida'}`}</small></td>
                    <td className="num">{usd(g.montoUsd)}{g.moneda === 'VES' && <small>{bs(g.monto)}</small>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Vacio>Sin gastos registrados este mes.</Vacio>}
        </Estado>
        <p className="nota">Esta relación la ven todos los residentes (transparencia).</p>
      </Tarjeta>
      {nuevo ? <FormGasto periodo={periodo} tasaSugerida={tasa.datos?.usdVes} alTerminar={() => { setNuevo(false); recargar(); }} />
             : <button className="btn btn-sec btn-ancho" onClick={() => setNuevo(true)}>+ Registrar gasto</button>}
      <Tarjeta titulo="Recibos del mes">
        <p>Reparte los gastos comunes de {mes(periodo)} por alícuota, agrega el fondo de reserva, las cuotas de partidas especiales aprobadas y los gastos no comunes de cada apartamento.</p>
        {msg && <div className={`aviso ${msg.ok ? 'aviso-ok' : 'aviso-error'}`}>{msg.t}</div>}
        <button className="btn btn-ancho" onClick={emitir}>Emitir recibos de {mes(periodo)}</button>
      </Tarjeta>
    </>
  );
}

function FormGasto({ periodo, tasaSugerida, alTerminar }: { periodo: string; tasaSugerida?: number; alTerminar: () => void }) {
  const unidades = useCarga(() => api.unidadesConSaldo());
  const [tipo, setTipo] = useState<'comun' | 'no_comun'>('comun');
  const [categoria, setCategoria] = useState('Mantenimiento');
  const [descripcion, setDescripcion] = useState('');
  const [moneda, setMoneda] = useState<Moneda>('USD');
  const [montoTxt, setMontoTxt] = useState('');
  const [tasa, setTasa] = useState(String(tasaSugerida ?? ''));
  const [unidadId, setUnidadId] = useState('');
  const [factura, setFactura] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    const m = Number(montoTxt.replace(',', '.'));
    if (!(m > 0)) return setError('Indique el monto.');
    if (tipo === 'no_comun' && !unidadId) return setError('Seleccione el apartamento al que se le carga.');
    try {
      await api.registrarGasto({ periodo, tipo, categoria, descripcion, moneda, monto: m,
        tasaBcv: moneda === 'VES' ? Number(tasa.replace(',', '.')) : undefined, unidadId: unidadId || undefined, factura });
      alTerminar();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <form className="formulario" onSubmit={guardar}>
      <Tarjeta titulo={`Nuevo gasto · ${mes(periodo)}`}>
        <div className="chips">
          <button type="button" className={`chip ${tipo === 'comun' ? 'chip-activo' : ''}`} onClick={() => setTipo('comun')}>Común (se reparte)</button>
          <button type="button" className={`chip ${tipo === 'no_comun' ? 'chip-activo' : ''}`} onClick={() => setTipo('no_comun')}>No común (un apto)</button>
        </div>
        <Campo etiqueta="Categoría">
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {['Vigilancia', 'Conserjería', 'Electricidad', 'Agua', 'Gas', 'Ascensor', 'Mantenimiento', 'Jardinería', 'Limpieza', 'Honorarios administración', 'Bancarios', 'Otros'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Descripción"><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} required /></Campo>
        {tipo === 'no_comun' && (
          <Campo etiqueta="Apartamento">
            <select value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
              <option value="">Seleccione…</option>
              {unidades.datos?.map((u) => <option key={u.id} value={u.id}>{u.bloque}-{u.numero} · {u.propietario}</option>)}
            </select>
          </Campo>
        )}
        <div className="dos-col">
          <Campo etiqueta="Moneda">
            <select value={moneda} onChange={(e) => setMoneda(e.target.value as Moneda)}><option value="USD">Dólares</option><option value="VES">Bolívares</option></select>
          </Campo>
          <Campo etiqueta="Monto"><input inputMode="decimal" value={montoTxt} onChange={(e) => setMontoTxt(e.target.value)} required /></Campo>
        </div>
        {moneda === 'VES' && <Campo etiqueta="Tasa BCV del día"><input inputMode="decimal" value={tasa} onChange={(e) => setTasa(e.target.value)} /></Campo>}
        <Campo etiqueta="Foto de la factura"><input type="file" accept="image/*" capture="environment" onChange={(e) => setFactura(e.target.files?.[0] ?? null)} /></Campo>
      </Tarjeta>
      {error && <div className="aviso aviso-error">{error}</div>}
      <div className="fila-botones"><button className="btn">Guardar gasto</button><button type="button" className="btn-texto" onClick={alTerminar}>Cancelar</button></div>
    </form>
  );
}

// ---------------- Unidades y morosidad ----------------
export function Unidades() {
  const { datos, cargando, error } = useCarga(() => api.unidadesConSaldo());
  const [verEstado, setVerEstado] = useState<string | null>(null);
  const lista = [...(datos ?? [])].sort((a, b) => b.saldoUsd - a.saldoUsd);
  return (
    <Estado cargando={cargando} error={error}>
      <Tarjeta titulo="Apartamentos" accion={<small>{lista.filter((u) => u.saldoUsd > 0.009).length} con deuda</small>}>
        <table className="tabla">
          <thead><tr><th>Apto</th><th>Propietario</th><th className="num">Saldo</th></tr></thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id} onClick={() => setVerEstado(verEstado === u.id ? null : u.id)} className="clicable">
                <td><strong>{u.bloque}-{u.numero}</strong><small>{u.alicuota} %</small></td>
                <td>{u.propietario}</td>
                <td className={`num ${u.saldoUsd > 0.009 ? 'txt-error' : 'txt-ok'}`}>{u.saldoUsd > 0.009 ? usd(u.saldoUsd) : 'Al día'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tarjeta>
      {verEstado && <DetalleUnidad id={verEstado} />}
    </Estado>
  );
}

function DetalleUnidad({ id }: { id: string }) {
  const { datos: e, cargando, error } = useCarga(() => api.estadoCuenta(id), [id]);
  return (
    <Estado cargando={cargando} error={error}>
      {e && (
        <Tarjeta titulo={`Estado de cuenta ${e.unidad.bloque}-${e.unidad.numero}`} accion={<strong>{usd(e.saldoUsd)}</strong>}>
          <table className="tabla">
            <tbody>
              {e.cargos.map((c) => <tr key={c.id}><td>{c.concepto}<small>{mes(c.periodo)}</small></td><td className="num">{usd(c.montoUsd)}</td></tr>)}
              {e.pagos.filter((p) => p.estado === 'confirmado').map((p) => (
                <tr key={p.id}><td>Pago {METODOS[p.metodo]}<small>{fecha(p.fechaPago)}</small></td><td className="num txt-ok">−{usd(p.montoUsd)}</td></tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}
    </Estado>
  );
}
