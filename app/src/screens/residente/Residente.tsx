import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Cargo, type EstadoCuenta, type MetodoPago, type Moneda } from '../../data';
import { Campo, Cifra, Estado, Etiqueta, Tarjeta, Vacio, useCarga } from '../../components/ui';
import { BloqueoTasa, LineaTasa, useTasaDelDia } from '../../components/tasa';
import { ESTADO_PAGO, METODOS, TIPO_CARGO, bs, fecha, hoyLocal, mes, usd } from '../../formato';
import { BotonSOS } from '../alerta/Alerta';

const unidadId = () => api.sesion()!.unidadId!;
const r2 = (x: number) => Math.round(x * 100) / 100;

// ---------------- Deudas agrupadas: "Condominio de noviembre", "Impermeabilización (cuota 2/4)"… ----------------
export interface GrupoDeuda {
  clave: string; titulo: string; detalle: string; periodo: string; especial: boolean;
  cargos: Cargo[]; pendienteUsd: number; enRevision: boolean;
}

/** Lo que falta por pagar, agrupado como lo piensa el vecino. Lo más viejo primero. */
export function gruposDeuda(e: EstadoCuenta): GrupoDeuda[] {
  const enRevision = new Set(e.pagos.filter((p) => p.estado === 'reportado').flatMap((p) => (p.destinos ?? []).map((d) => d.cargoId)));
  const pend = e.cargos.filter((c) => (c.pendienteUsd ?? Math.max(c.montoUsd, 0)) > 0.009);
  const grupos = new Map<string, GrupoDeuda>();
  for (const c of pend) {
    const especial = c.tipo === 'extraordinaria';
    const clave = especial ? `p:${c.id}` : `m:${c.periodo}`;
    const g = grupos.get(clave) ?? {
      clave, periodo: c.periodo, especial, cargos: [], pendienteUsd: 0, enRevision: false,
      titulo: especial ? c.concepto : `Condominio de ${mes(c.periodo).toLowerCase()}`, detalle: '',
    };
    g.cargos.push(c);
    g.pendienteUsd = r2(g.pendienteUsd + (c.pendienteUsd ?? c.montoUsd));
    grupos.set(clave, g);
  }
  for (const g of grupos.values()) {
    g.enRevision = g.cargos.every((c) => enRevision.has(c.id));
    g.detalle = g.especial ? `Cuota especial · ${mes(g.periodo)}` : g.cargos.map((c) => TIPO_CARGO[c.tipo]).join(' + ');
  }
  return [...grupos.values()].sort((a, b) => a.periodo.localeCompare(b.periodo) || Number(a.especial) - Number(b.especial));
}

const urlPagar = (ids: string[]) => `/r/pagar?cargos=${ids.join(',')}`;

function MontoBs({ usdX, tasa }: { usdX: number; tasa: number | null }) {
  return tasa ? <small className="monto-bs">{bs(r2(usdX * tasa))}</small> : null;
}

// ---------------- Inicio ----------------
export function InicioResidente() {
  const cuenta = useCarga(() => api.estadoCuenta(unidadId()));
  const recargarCuenta = cuenta.recargar;
  // Cuando la junta aprueba o rechaza un pago, el saldo se actualiza solo.
  useEffect(() => api.suscribirNotificaciones((n) => {
    if (n.tipo === 'pago_confirmado' || n.tipo === 'pago_rechazado') recargarCuenta();
  }), [recargarCuenta]);
  const avisos = useCarga(() => api.avisos());
  const condo = useCarga(() => api.condominio());
  const anon = useCarga(() => api.mensajesAnonimos().catch(() => []));
  const recargarAnon = anon.recargar;
  useEffect(() => api.suscribirNotificaciones((n) => { if (n.tipo === 'mensaje_anonimo') recargarAnon(); }), [recargarAnon]);
  const anonSinLeer = (anon.datos ?? []).filter((m) => m.direccion === 'recibido' && !m.leidoEn).length;
  const tasa = useTasaDelDia();
  const e = cuenta.datos;
  const grupos = e ? gruposDeuda(e) : [];
  const porPagar = grupos.filter((g) => !g.enRevision);

  return (
    <>
      <BotonSOS />
      <Estado cargando={cuenta.cargando} error={cuenta.error}>
        {e && (
          <Tarjeta className={e.saldoUsd > 0.009 ? 'tarjeta-deuda' : 'tarjeta-aldia'}>
            <div className="saldo">
              <span>Apartamento {e.unidad.bloque}-{e.unidad.numero} · alícuota {e.unidad.alicuota} %</span>
              <strong>{e.saldoUsd > 0.009 ? usd(e.saldoUsd) : e.saldoUsd < -0.009 ? `${usd(-e.saldoUsd)} a favor` : '¡Al día!'}</strong>
              {e.saldoUsd > 0.009 && tasa.usdVes && <span>= {bs(r2(e.saldoUsd * tasa.usdVes))} a la tasa BCV de hoy</span>}
              {e.pagos.some((p) => p.estado === 'reportado') && <Etiqueta tono="info">Tiene pagos en revisión</Etiqueta>}
            </div>
            <div className="fila-botones">
              <Link className="btn" to={porPagar.length ? urlPagar(porPagar.flatMap((g) => g.cargos.map((c) => c.id))) : '/r/pagar'}>
                {porPagar.length > 1 ? 'Pagar todo' : 'Pagar'}
              </Link>
              <Link className="btn btn-sec" to="/r/cuenta">Estado de cuenta</Link>
            </div>
          </Tarjeta>
        )}
        {grupos.length > 0 && (
          <Tarjeta titulo="¿Qué quiere pagar?">
            <LineaTasa t={tasa} />
            <ul className="lista deudas">
              {grupos.map((g) => (
                <li key={g.clave}>
                  <div>
                    <strong>{g.titulo}</strong>
                    <small>{g.detalle}</small>
                    {g.especial && <Etiqueta tono="alerta">Cuota especial</Etiqueta>}
                  </div>
                  <div className="deuda-accion">
                    <strong>{usd(g.pendienteUsd)}</strong>
                    <MontoBs usdX={g.pendienteUsd} tasa={tasa.usdVes} />
                    {g.enRevision
                      ? <Etiqueta tono="info">Pago en revisión</Etiqueta>
                      : <Link className="btn btn-chico" to={urlPagar(g.cargos.map((c) => c.id))}>Pagar</Link>}
                  </div>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}
      </Estado>

      <Tarjeta titulo="Convivencia" className="convivencia-inicio">
        <div className="accesos">
          <Link to="/r/reportes/nuevo" className="acceso"><strong>📣</strong><span>Reportar algo a la junta o a una casa, sin su nombre si quiere</span></Link>
          <Link to="/r/anonimos" className="acceso"><strong>{anonSinLeer || '✉️'}</strong><span>{anonSinLeer ? 'mensajes anónimos sin leer' : 'Mensajes anónimos'}</span></Link>
        </div>
        {condo.datos && condo.datos.morososPublicos && condo.datos.morososPublicos !== 'no' && (
          <Link to="/r/morosos" className="btn-texto">Ver casas con cuotas vencidas (publicado por la junta) ›</Link>
        )}
      </Tarjeta>

      <div className="fila-botones">
        <Link className="btn btn-sec" to="/r/documentos">Documentos y solvencia</Link>
      </div>

      <Tarjeta titulo="Avisos de Presidencia">
        <Estado cargando={avisos.cargando} error={avisos.error}>
          {avisos.datos?.length ? avisos.datos.map((a) => (
            <article key={a.id} className="aviso-item">
              <h3>{a.fijado && <Etiqueta tono="alerta">Fijado</Etiqueta>} {a.titulo}</h3>
              <p>{a.cuerpo}</p>
            </article>
          )) : <Vacio>Sin avisos.</Vacio>}
        </Estado>
      </Tarjeta>
    </>
  );
}

const ESTADO_CARGO = { pagado: ['ok', 'Pagado'], parcial: ['alerta', 'Abonado'], pendiente: ['error', 'Pendiente'], credito: ['neutro', 'Crédito'] } as const;
export function EtiquetaCargo({ c }: { c: Cargo }) {
  if (!c.estado) return null;
  const [tono, txt] = ESTADO_CARGO[c.estado];
  return <Etiqueta tono={tono}>{txt}</Etiqueta>;
}

// ---------------- Estado de cuenta ----------------
export function EstadoCuentaResidente() {
  const { datos: e, cargando, error, recargar } = useCarga(() => api.estadoCuenta(unidadId()));
  useEffect(() => api.suscribirNotificaciones((n) => {
    if (n.tipo === 'pago_confirmado' || n.tipo === 'pago_rechazado') recargar();
  }), [recargar]);
  const porPeriodo = new Map<string, NonNullable<typeof e>['cargos']>();
  e?.cargos.forEach((c) => porPeriodo.set(c.periodo, [...(porPeriodo.get(c.periodo) ?? []), c]));

  return (
    <Estado cargando={cargando} error={error}>
      {e && (
        <>
          <div className="cifras">
            <Cifra etiqueta="Saldo pendiente" valor={usd(Math.max(0, e.saldoUsd))} tono={e.saldoUsd > 0.009 ? 'error' : 'ok'} />
            <Cifra etiqueta="A favor" valor={usd(Math.max(0, -e.saldoUsd))} nota={e.saldoUsd < -0.009 ? 'Se descuenta solo del próximo recibo' : undefined} />
          </div>
          <Tarjeta titulo="Recibos">
            {[...porPeriodo.entries()].map(([periodo, cs]) => {
              const falta = r2(cs.reduce((s, c) => s + (c.pendienteUsd ?? 0), 0));
              return (
                <details key={periodo} className="recibo" open={falta > 0.009}>
                  <summary>
                    <span>{mes(periodo)}</span>
                    <strong>{falta > 0.009 ? `Falta ${usd(falta)}` : <Etiqueta tono="ok">Pagado</Etiqueta>}</strong>
                  </summary>
                  <table className="tabla">
                    <tbody>
                      {cs.map((c) => (
                        <tr key={c.id}>
                          <td>{c.concepto}<small>{TIPO_CARGO[c.tipo]} <EtiquetaCargo c={c} /></small></td>
                          <td className="num">{usd(c.montoUsd)}{c.estado === 'parcial' && <small>falta {usd(c.pendienteUsd ?? 0)}</small>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {falta > 0.009 && (
                    <Link className="btn btn-chico" to={urlPagar(cs.filter((c) => (c.pendienteUsd ?? 0) > 0.009).map((c) => c.id))}>Pagar {mes(periodo).toLowerCase()}</Link>
                  )}
                </details>
              );
            })}
            {!porPeriodo.size && <Vacio>Aún no hay recibos emitidos.</Vacio>}
          </Tarjeta>
          <Tarjeta titulo="Pagos reportados">
            {e.pagos.length ? (
              <ul className="lista">
                {e.pagos.map((p) => (
                  <li key={p.id}>
                    <div>
                      <strong>{p.moneda === 'USD' ? usd(p.monto) : bs(p.monto)}</strong>
                      {p.moneda === 'VES' && <small> = {usd(p.montoUsd)} (tasa {p.tasaBcv})</small>}
                      <small>{METODOS[p.metodo]} · {fecha(p.fechaPago)}{p.referencia && ` · Ref. ${p.referencia}`}</small>
                      {p.estado === 'confirmado' && !!p.aplicaciones?.length && (
                        <small className="aplicado">Se descontó de: {p.aplicaciones.map((a) => `${a.concepto} (${usd(a.montoUsd)})`).join(', ')}</small>
                      )}
                      {p.estado !== 'confirmado' && !!p.destinos?.length && (
                        <small className="aplicado">Para: {p.destinos.map((a) => a.concepto).join(', ')}</small>
                      )}
                      {p.motivoRechazo && <small className="txt-error">Motivo: {p.motivoRechazo}</small>}
                    </div>
                    <Etiqueta tono={p.estado === 'confirmado' ? 'ok' : p.estado === 'rechazado' ? 'error' : 'info'}>{ESTADO_PAGO[p.estado]}</Etiqueta>
                  </li>
                ))}
              </ul>
            ) : <Vacio>No ha reportado pagos.</Vacio>}
          </Tarjeta>
        </>
      )}
    </Estado>
  );
}

// ---------------- Pagar: ¿qué va a pagar? → ¿cómo pagó? ----------------
export function ReportarPago() {
  const [params] = useSearchParams();
  const cuenta = useCarga(() => api.estadoCuenta(unidadId()));
  const pedidos = useMemo(() => (params.get('cargos') ?? '').split(',').filter(Boolean), [params]);
  const [elegidos, setElegidos] = useState<Set<string> | null>(null);
  const [paso, setPaso] = useState<'que' | 'como'>(pedidos.length ? 'como' : 'que');
  const grupos = cuenta.datos ? gruposDeuda(cuenta.datos) : [];

  // Lo que venía elegido desde "Pagar" (solo lo que aún se debe).
  useEffect(() => {
    if (!cuenta.datos || elegidos) return;
    const debe = new Set(grupos.flatMap((g) => g.cargos.map((c) => c.id)));
    setElegidos(new Set(pedidos.filter((x) => debe.has(x))));
  }, [cuenta.datos]);   // eslint-disable-line react-hooks/exhaustive-deps

  const sel = elegidos ?? new Set<string>();
  const gruposSel = grupos.filter((g) => g.cargos.some((c) => sel.has(c.id)));
  const totalUsd = r2(grupos.flatMap((g) => g.cargos).filter((c) => sel.has(c.id)).reduce((s, c) => s + (c.pendienteUsd ?? c.montoUsd), 0));
  const alternar = (g: GrupoDeuda) => {
    const n = new Set(sel);
    const todos = g.cargos.every((c) => n.has(c.id));
    for (const c of g.cargos) { if (todos) n.delete(c.id); else n.add(c.id); }
    setElegidos(n);
  };

  return (
    <Estado cargando={cuenta.cargando} error={cuenta.error}>
      {paso === 'que' || !gruposSel.length && grupos.length ? (
        <>
          <Tarjeta titulo="¿Qué va a pagar?">
            {grupos.length ? (
              <>
                <p className="nota">Elija una o varias deudas. Al aprobar su pago, la junta lo descuenta de lo que eligió.</p>
                <ul className="lista deudas">
                  {grupos.map((g) => {
                    const marcado = g.cargos.every((c) => sel.has(c.id));
                    return (
                      <li key={g.clave} className={`elegible ${marcado ? 'elegido' : ''}`}>
                        <label className="check-deuda">
                          <input type="checkbox" checked={marcado} onChange={() => alternar(g)} />
                          <span>
                            <strong>{g.titulo}</strong>
                            <small>{g.detalle}</small>
                            {g.enRevision && <Etiqueta tono="info">Ya tiene un pago en revisión</Etiqueta>}
                          </span>
                        </label>
                        <strong className="num">{usd(g.pendienteUsd)}</strong>
                      </li>
                    );
                  })}
                </ul>
                <div className="fila-botones">
                  <button type="button" className="btn-texto" onClick={() => setElegidos(new Set(grupos.filter((g) => !g.enRevision).flatMap((g) => g.cargos.map((c) => c.id))))}>Elegir todo</button>
                  {sel.size > 0 && <button type="button" className="btn-texto" onClick={() => setElegidos(new Set())}>Ninguno</button>}
                </div>
              </>
            ) : <Vacio>No tiene deudas pendientes. Si quiere adelantar un pago, quedará a favor para el próximo recibo.</Vacio>}
          </Tarjeta>
          <button className="btn btn-ancho" disabled={grupos.length > 0 && !sel.size} onClick={() => setPaso('como')}>
            {sel.size ? `Pagar ${usd(totalUsd)}` : grupos.length ? 'Elija qué va a pagar' : 'Adelantar un pago'}
          </button>
        </>
      ) : (
        <FormPago grupos={gruposSel} cargoIds={[...sel]} totalUsd={totalUsd} alCambiar={() => setPaso('que')} />
      )}
    </Estado>
  );
}

function FormPago({ grupos, cargoIds, totalUsd, alCambiar }: { grupos: GrupoDeuda[]; cargoIds: string[]; totalUsd: number; alCambiar: () => void }) {
  const ir = useNavigate();
  const cuentas = useCarga(() => api.cuentasDePago());
  const [metodo, setMetodo] = useState<MetodoPago>('pago_movil');
  const moneda: Moneda = ['pago_movil', 'transferencia', 'efectivo_bs'].includes(metodo) ? 'VES' : 'USD';
  const [fechaPago, setFechaPago] = useState(hoyLocal());
  const tasa = useTasaDelDia(fechaPago);
  const montoSugerido = moneda === 'USD' ? totalUsd : tasa.usdVes ? r2(totalUsd * tasa.usdVes) : null;
  const [monto, setMonto] = useState('');
  const [tocado, setTocado] = useState(false);
  const [referencia, setReferencia] = useState('');
  const [banco, setBanco] = useState('');
  const [cuentaDestino, setCuentaDestino] = useState('');
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const necesitaRef = !['efectivo_usd', 'efectivo_bs'].includes(metodo);
  const cuentasMoneda = cuentas.datos?.filter((c) => c.moneda === moneda) ?? [];
  // El monto se llena solo con lo elegido (en Bs, a la tasa verificada de ese día) hasta que la persona lo cambie.
  useEffect(() => {
    if (!tocado) setMonto(montoSugerido && montoSugerido > 0 ? montoSugerido.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  }, [montoSugerido, tocado]);
  const montoN = Number(monto.replace(/\./g, '').replace(',', '.'));
  const equivUsd = moneda === 'USD' ? montoN : tasa.usdVes ? r2(montoN / tasa.usdVes) : null;
  const bloqueado = moneda === 'VES' && !tasa.usdVes;

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    if (bloqueado) return setError('No hay tasa BCV verificada para esa fecha: no se puede pagar en bolívares todavía.');
    if (!(montoN > 0)) return setError('Indique un monto válido.');
    if (necesitaRef && !referencia.trim()) return setError('Indique el número de referencia.');
    setEnviando(true);
    try {
      if (moneda === 'VES') {
        // Justo antes de enviar se vuelve a comprobar la tasa: si cambió, la persona revisa el monto.
        const t = await api.tasaBcv(fechaPago);
        if (!t.verificada || !t.usdVes) { tasa.recargar(); throw new Error(t.motivo ?? 'La tasa BCV no está confirmada.'); }
        if (Math.abs(t.usdVes - tasa.usdVes!) > 0.00005) { tasa.recargar(); setTocado(false); throw new Error('La tasa BCV acaba de cambiar. Revise el monto actualizado antes de enviar.'); }
      }
      await api.reportarPago({
        unidadId: unidadId(), fechaPago, metodo, moneda, monto: montoN, referencia: referencia.trim() || undefined,
        bancoOrigen: banco || undefined, cuentaDestinoId: cuentaDestino || cuentasMoneda[0]?.id, comprobante, cargoIds,
      });
      ir('/r/cuenta');
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  }

  return (
    <form className="formulario" onSubmit={enviar}>
      <Tarjeta titulo="Va a pagar" accion={<button type="button" className="btn-texto" onClick={alCambiar}>Cambiar</button>}>
        {grupos.length ? (
          <ul className="lista">
            {grupos.map((g) => <li key={g.clave}><span>{g.titulo}<small>{g.detalle}</small></span><strong>{usd(g.pendienteUsd)}</strong></li>)}
            <li className="total"><span>Total</span><strong>{usd(totalUsd)}</strong></li>
          </ul>
        ) : <p className="nota">Pago adelantado: quedará a favor para el próximo recibo.</p>}
      </Tarjeta>

      <Tarjeta titulo="¿Cómo pagó?">
        <div className="chips">
          {(['pago_movil', 'transferencia', 'zelle', 'efectivo_usd', 'efectivo_bs', 'usdt'] as MetodoPago[]).map((m) => (
            <button type="button" key={m} className={`chip ${metodo === m ? 'chip-activo' : ''}`} onClick={() => { setMetodo(m); setTocado(false); }}>{METODOS[m]}</button>
          ))}
        </div>
        {cuentasMoneda.map((c) => (
          <div key={c.id} className="datos-pago"><strong>{c.nombre}</strong><span>{c.datosPago}</span></div>
        ))}
      </Tarjeta>

      {moneda === 'VES' && (
        <Tarjeta titulo="Monto en bolívares">
          {tasa.usdVes ? <LineaTasa t={tasa} /> : <BloqueoTasa t={tasa} />}
          {tasa.usdVes && totalUsd > 0 && (
            <div className="monto-grande">
              <span>Debe transferir</span>
              <strong>{bs(r2(totalUsd * tasa.usdVes))}</strong>
              <small>{usd(totalUsd)} × {tasa.usdVes.toLocaleString('es-VE', { maximumFractionDigits: 4 })}</small>
            </div>
          )}
        </Tarjeta>
      )}

      {!bloqueado && (
        <Tarjeta titulo="Datos del pago">
          <Campo etiqueta={`Monto que pagó en ${moneda === 'USD' ? 'dólares' : 'bolívares'}`}
                 ayuda={equivUsd != null && montoN > 0 && totalUsd > 0
                   ? (equivUsd < totalUsd - 0.009 ? `Equivale a ${usd(equivUsd)}: es un abono; quedará pendiente ${usd(r2(totalUsd - equivUsd))}.`
                      : equivUsd > totalUsd + 0.009 ? `Equivale a ${usd(equivUsd)}: lo que sobra (${usd(r2(equivUsd - totalUsd))}) se descuenta de su deuda más antigua o queda a favor.`
                      : `Equivale a ${usd(equivUsd)}: cubre exactamente lo elegido.`)
                   : undefined}>
            <input inputMode="decimal" value={monto} onChange={(e) => { setMonto(e.target.value); setTocado(true); }} placeholder="0,00" required />
          </Campo>
          <Campo etiqueta="Fecha del pago" ayuda={moneda === 'VES' ? 'Se usa la tasa BCV de esa fecha.' : undefined}>
            <input type="date" value={fechaPago} max={hoyLocal()} onChange={(e) => { setFechaPago(e.target.value); setTocado(false); }} />
          </Campo>
          {necesitaRef && (
            <Campo etiqueta="Número de referencia" ayuda="Los últimos dígitos que aparecen en su comprobante">
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} inputMode="numeric" />
            </Campo>
          )}
          {moneda === 'VES' && metodo !== 'efectivo_bs' && (
            <Campo etiqueta="Banco de origen"><input value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Banesco, Venezuela, Mercantil…" /></Campo>
          )}
          {cuentasMoneda.length > 1 && (
            <Campo etiqueta="Cuenta del condominio">
              <select value={cuentaDestino} onChange={(e) => setCuentaDestino(e.target.value)}>
                {cuentasMoneda.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
          )}
          <Campo etiqueta="Captura del comprobante (opcional)">
            <input type="file" accept="image/*" capture="environment" onChange={(e) => setComprobante(e.target.files?.[0] ?? null)} />
          </Campo>
        </Tarjeta>
      )}
      {error && <div className="aviso aviso-error">{error}</div>}
      <button className="btn btn-ancho" disabled={enviando || bloqueado}>{enviando ? 'Enviando…' : 'Enviar a la junta'}</button>
      <p className="nota">Su pago queda <strong>en revisión</strong> hasta que la junta lo verifique en el banco. Al aprobarlo se descuenta de lo que eligió y le avisamos.</p>
    </form>
  );
}
