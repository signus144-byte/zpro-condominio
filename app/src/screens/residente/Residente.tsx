import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type MetodoPago, type Moneda } from '../../data';
import { Campo, Cifra, Estado, Etiqueta, Tarjeta, Vacio, useCarga } from '../../components/ui';
import { ESTADO_PAGO, METODOS, TIPO_CARGO, bs, fecha, hoyLocal, mes, usd } from '../../formato';
import { BotonSOS } from '../alerta/Alerta';

const unidadId = () => api.sesion()!.unidadId!;

// ---------------- Inicio ----------------
export function InicioResidente() {
  const cuenta = useCarga(() => api.estadoCuenta(unidadId()));
  const recargarCuenta = cuenta.recargar;
  // Cuando la junta aprueba o rechaza un pago, el saldo se actualiza solo.
  useEffect(() => api.suscribirNotificaciones((n) => {
    if (n.tipo === 'pago_confirmado' || n.tipo === 'pago_rechazado') recargarCuenta();
  }), [recargarCuenta]);
  const avisos = useCarga(() => api.avisos());
  const tasa = useCarga(() => api.tasaBcv());
  const e = cuenta.datos;

  return (
    <>
      <BotonSOS />
      <Estado cargando={cuenta.cargando} error={cuenta.error}>
        {e && (
          <Tarjeta className={e.saldoUsd > 0.009 ? 'tarjeta-deuda' : 'tarjeta-aldia'}>
            <div className="saldo">
              <span>Apartamento {e.unidad.bloque}-{e.unidad.numero} · alícuota {e.unidad.alicuota} %</span>
              <strong>{e.saldoUsd > 0.009 ? usd(e.saldoUsd) : '¡Al día!'}</strong>
              {e.saldoUsd > 0.009 && tasa.datos && (
                <span>≈ {bs(e.saldoUsd * tasa.datos.usdVes)} a tasa BCV {tasa.datos.usdVes.toLocaleString('es-VE')}</span>
              )}
              {e.pagos.some((p) => p.estado === 'reportado') && (
                <Etiqueta tono="info">Tiene pagos en revisión</Etiqueta>
              )}
            </div>
            <div className="fila-botones">
              <Link className="btn" to="/r/pagar">Reportar pago</Link>
              <Link className="btn btn-sec" to="/r/cuenta">Estado de cuenta</Link>
            </div>
          </Tarjeta>
        )}
      </Estado>

      <div className="fila-botones">
        <Link className="btn btn-sec" to="/r/reportes/nuevo">Reportar una irregularidad</Link>
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
            <Cifra etiqueta="A favor" valor={usd(Math.max(0, -e.saldoUsd))} />
          </div>
          <Tarjeta titulo="Recibos">
            {[...porPeriodo.entries()].map(([periodo, cs]) => (
              <details key={periodo} className="recibo">
                <summary>
                  <span>{mes(periodo)}</span>
                  <strong>{usd(cs.reduce((s, c) => s + c.montoUsd, 0))}</strong>
                </summary>
                <table className="tabla">
                  <tbody>
                    {cs.map((c) => (
                      <tr key={c.id}><td>{c.concepto}<small>{TIPO_CARGO[c.tipo]}</small></td><td className="num">{usd(c.montoUsd)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
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

// ---------------- Reportar pago ----------------
export function ReportarPago() {
  const ir = useNavigate();
  const cuentas = useCarga(() => api.cuentasDePago());
  const tasa = useCarga(() => api.tasaBcv());
  const [metodo, setMetodo] = useState<MetodoPago>('pago_movil');
  const moneda: Moneda = ['pago_movil', 'transferencia', 'efectivo_bs'].includes(metodo) ? 'VES' : 'USD';
  const [monto, setMonto] = useState('');
  const [referencia, setReferencia] = useState('');
  const [banco, setBanco] = useState('');
  const [fechaPago, setFechaPago] = useState(hoyLocal());
  const [cuentaDestino, setCuentaDestino] = useState('');
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const necesitaRef = !['efectivo_usd', 'efectivo_bs'].includes(metodo);
  const cuentasMoneda = cuentas.datos?.filter((c) => c.moneda === moneda) ?? [];
  const montoN = Number(monto.replace(',', '.'));

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!(montoN > 0)) return setError('Indique un monto válido.');
    if (necesitaRef && !referencia.trim()) return setError('Indique el número de referencia.');
    setEnviando(true);
    try {
      await api.reportarPago({
        unidadId: unidadId(), fechaPago, metodo, moneda, monto: montoN, referencia: referencia.trim() || undefined,
        bancoOrigen: banco || undefined, cuentaDestinoId: cuentaDestino || cuentasMoneda[0]?.id, comprobante,
      });
      ir('/r/cuenta');
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  }

  return (
    <form className="formulario" onSubmit={enviar}>
      <Tarjeta titulo="¿Cómo pagó?">
        <div className="chips">
          {(['pago_movil', 'transferencia', 'zelle', 'efectivo_usd', 'efectivo_bs', 'usdt'] as MetodoPago[]).map((m) => (
            <button type="button" key={m} className={`chip ${metodo === m ? 'chip-activo' : ''}`} onClick={() => setMetodo(m)}>{METODOS[m]}</button>
          ))}
        </div>
        {cuentasMoneda.map((c) => (
          <div key={c.id} className="datos-pago"><strong>{c.nombre}</strong><span>{c.datosPago}</span></div>
        ))}
      </Tarjeta>

      <Tarjeta titulo="Datos del pago">
        <Campo etiqueta={`Monto en ${moneda === 'USD' ? 'dólares' : 'bolívares'}`}
               ayuda={moneda === 'VES' && tasa.datos && montoN > 0 ? `Equivale a ${usd(montoN / tasa.datos.usdVes)} a tasa BCV ${tasa.datos.usdVes} (la confirma Presidencia con la tasa del día del pago)` : undefined}>
          <input inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0,00" required />
        </Campo>
        <Campo etiqueta="Fecha del pago">
          <input type="date" value={fechaPago} max={hoyLocal()} onChange={(e) => setFechaPago(e.target.value)} />
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
      {error && <div className="aviso aviso-error">{error}</div>}
      <button className="btn btn-ancho" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar a la junta'}</button>
      <p className="nota">Su pago queda <strong>en revisión</strong> hasta que la junta lo verifique en el banco y lo apruebe o lo rechace. Le avisaremos en ambos casos.</p>
    </form>
  );
}
