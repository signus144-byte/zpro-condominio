import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ResultadoFacturacion } from '../data';
import { Campo, Cifra, Estado, Etiqueta, Tarjeta, Vacio, useAccion, useCarga } from '../ui';
import { ESTADO_FACTURA, METODOS, TONO_FACTURA, bs, fecha, mes, mesAnterior, mesSiguiente, periodoActual, r2, usd } from '../formato';

export function Facturacion() {
  const [periodo, setPeriodo] = useState(periodoActual());
  const fac = useCarga(() => api.facturas(periodo), [periodo]);
  const pag = useCarga(() => api.pagos('reportado'));
  const tasa = useCarga(() => api.tasaBcv());
  const planes = useCarga(() => api.planes());
  const nombrePlan = (id: string) => planes.datos?.find((p) => p.id === id)?.nombre ?? id;
  const [nuevaTasa, setNuevaTasa] = useState('');
  const [dias, setDias] = useState(10);
  const [resultado, setResultado] = useState<ResultadoFacturacion | null>(null);
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const accion = useAccion();
  const rol = api.sesion()?.rol;
  const finanzas = rol === 'dueno' || rol === 'finanzas';
  const recargar = () => { fac.recargar(); pag.recargar(); tasa.recargar(); };

  const fs = fac.datos ?? [];
  const total = r2(fs.reduce((s, f) => s + f.montoUsd, 0));
  const cobrado = r2(fs.reduce((s, f) => s + (f.estado === 'pagada' ? f.montoUsd : Math.min(f.abonadoUsd, f.montoUsd)), 0));
  const vencido = r2(fs.filter((f) => f.estado === 'vencida').reduce((s, f) => s + Math.max(0, f.montoUsd - f.abonadoUsd), 0));
  const saldo = (f: (typeof fs)[number]) => (f.estado === 'pagada' || f.estado === 'anulada' ? 0 : Math.max(0, r2(f.montoUsd - f.abonadoUsd)));

  return (
    <>
      <div className="titulo-pagina">
        <div><h1>Facturación ZentaPro</h1><p>La mensualidad se expresa en dólares y se cobra solo en bolívares, a la tasa BCV del día del pago.</p></div>
        <div className="acciones">
          <button className="btn-texto" onClick={() => setPeriodo(mesAnterior(periodo))} aria-label="Mes anterior">‹</button>
          <strong>{mes(periodo)}</strong>
          <button className="btn-texto" onClick={() => setPeriodo(mesSiguiente(periodo))} aria-label="Mes siguiente">›</button>
        </div>
      </div>
      <accion.Mensaje />

      <div className="cifras">
        <Cifra etiqueta="Facturado" valor={usd(total)} nota={`${fs.length} facturas`} />
        <Cifra etiqueta="Cobrado" valor={usd(cobrado)} tono="ok" nota={total ? `${Math.round((100 * cobrado) / total)} %` : undefined} />
        <Cifra etiqueta="Vencido" valor={usd(vencido)} tono={vencido ? 'error' : undefined} />
        <Cifra etiqueta="Tasa BCV" valor={tasa.datos ? tasa.datos.usdVes.toLocaleString('es-VE') : '—'} nota={tasa.datos ? `Bs por dólar · ${fecha(tasa.datos.fecha)}` : 'Sin tasa cargada'} />
      </div>

      <Tarjeta titulo={`Facturas de ${mes(periodo)}`} accion={
          <button className="btn" disabled={!finanzas || accion.ocupado}
                  onClick={() => accion.correr(async () => {
                    const r = await api.emitirFacturasMes(periodo);
                    setResultado(r); recargar();
                  }, 'Facturación del mes procesada.')}>Emitir facturas del mes</button>}>
          {resultado && (
            <div className="aviso aviso-info" data-prueba="resultado-facturacion">
              <strong>{resultado.emitidas} emitida(s)</strong>, {resultado.yaExistian} ya existían, {resultado.omitidas.length} sin facturar
              {resultado.omitidas.length > 0 && <details><summary>Ver cuáles no se facturaron</summary>
                <ul>{resultado.omitidas.map((o) => <li key={o.condominio}>{o.condominio}: {o.motivo}</li>)}</ul></details>}
            </div>
          )}
          <Estado cargando={fac.cargando} error={fac.error}>
            {fs.length ? (
              <div className="tabla-envoltura">
                <table className="tabla" data-prueba="tabla-facturas">
                  <thead><tr><th>Condominio</th><th className="num">Unidades</th><th className="num">Monto</th><th className="num">Abonado</th><th className="num">Saldo</th><th className="num">Bs (emisión)</th><th>Vence</th><th>Estado</th><th>N.º control</th></tr></thead>
                  <tbody>
                    {fs.map((f) => (
                      <tr key={f.id}>
                        <td><Link to={`/condominios/${f.condominioId}`}>{f.condominioNombre}</Link><small>Plan {nombrePlan(f.planId)}{f.precioEspecial ? ' · precio especial' : ''}</small></td>
                        <td className="num">{f.unidadesFacturadas}</td>
                        <td className="num">{usd(f.montoUsd)}</td>
                        <td className="num">{usd(f.abonadoUsd)}</td>
                        <td className="num">{saldo(f) ? <>{usd(saldo(f))}{tasa.datos && <small>hoy {bs(r2(saldo(f) * tasa.datos.usdVes))}</small>}</> : '—'}</td>
                        <td className="num">{bs(f.montoVes)}<small>tasa {f.tasaBcv.toLocaleString('es-VE')}</small></td>
                        <td className="sin-corte">{fecha(f.vence)}</td>
                        <td><Etiqueta tono={TONO_FACTURA[f.estado]}>{ESTADO_FACTURA[f.estado]}</Etiqueta></td>
                        <td>{f.numeroControl ?? <small>pendiente</small>}</td>
                      </tr>
                    ))}
                    <tr className="fila-total"><td>Total</td><td /><td className="num">{usd(total)}</td><td className="num">{usd(r2(fs.reduce((s, f) => s + f.abonadoUsd, 0)))}</td><td className="num">{usd(r2(fs.reduce((s, f) => s + saldo(f), 0)))}</td><td className="num">{bs(r2(fs.reduce((s, f) => s + f.montoVes, 0)))}</td><td colSpan={3} /></tr>
                  </tbody>
                </table>
              </div>
            ) : <Vacio>No hay facturas de este mes. Use “Emitir facturas del mes”.</Vacio>}
          </Estado>
          <div className="aviso aviso-alerta">
            El <strong>número de control</strong> lo asigna la imprenta digital autorizada por el SENIAT (Providencia de facturación digital, G.O. 43.032). Integración pendiente: hasta entonces estas facturas son de control interno.
          </div>
        </Tarjeta>

        <Tarjeta titulo={`Pagos reportados por las juntas (${pag.datos?.length ?? 0})`}>
          <Estado cargando={pag.cargando} error={pag.error}>
            {pag.datos?.length ? (
              <div className="tabla-envoltura">
                <table className="tabla" data-prueba="tabla-pagos">
                  <thead><tr><th>Condominio</th><th>Fecha del pago</th><th className="num">Bolívares</th><th className="num">Tasa BCV</th><th className="num">Equivale</th><th /></tr></thead>
                  <tbody>
                    {pag.datos.map((p) => (
                      <tr key={p.id} data-prueba="pago-reportado">
                        <td><strong>{p.condominioNombre}</strong><small>{METODOS[p.metodo]} · Ref. {p.referencia ?? '—'}{p.reportadoPor ? ` · ${p.reportadoPor}` : ''}</small></td>
                        <td className="sin-corte">{fecha(p.fechaPago)}<small>reportado {fecha(p.creadoEn)}</small></td>
                        <td className="num">{p.moneda === 'VES' ? bs(p.monto) : usd(p.monto)}</td>
                        <td className="num">{p.tasaBcv != null ? p.tasaBcv.toLocaleString('es-VE') : '—'}</td>
                        <td className="num">{p.montoUsd != null ? usd(p.montoUsd) : '—'}</td>
                        <td>
                          {rechazando === p.id ? (
                            <form className="acciones" onSubmit={(e) => {
                              e.preventDefault();
                              accion.correr(async () => { await api.rechazarPago(p.id, motivo); setRechazando(null); setMotivo(''); recargar(); },
                                `Pago de ${p.condominioNombre} rechazado.`);
                            }}>
                              <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (ej.: no aparece en el banco)"
                                     aria-label="Motivo del rechazo" maxLength={300} style={{ minWidth: 220 }} />
                              <button className="btn btn-peligro btn-chico" disabled={motivo.trim().length < 3 || accion.ocupado}>Rechazar</button>
                              <button type="button" className="btn-texto" onClick={() => { setRechazando(null); setMotivo(''); }}>Cancelar</button>
                            </form>
                          ) : (
                            <div className="acciones">
                              <button className="btn btn-chico" disabled={!finanzas || accion.ocupado}
                                      onClick={() => accion.correr(async () => { await api.confirmarPago(p.id); recargar(); }, `Pago de ${p.condominioNombre} confirmado.`)}>Confirmar</button>
                              <button className="btn btn-sec btn-chico" disabled={!finanzas || accion.ocupado}
                                      onClick={() => { setRechazando(p.id); setMotivo(''); }}>Rechazar…</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Vacio>No hay pagos por confirmar.</Vacio>}
          </Estado>
          <p className="nota">Confirme solo lo que ya ve acreditado en el banco de ZentaPro. Cada pago en bolívares se convierte a dólares con la tasa BCV del día en que se hizo; la factura queda pagada cuando los abonos cubren el monto en dólares, y si el condominio estaba suspendido se reactiva solo.</p>
        </Tarjeta>

        <div className="dos">
          <Tarjeta titulo="Tasa BCV del día">
            <div className="acciones">
              <input inputMode="decimal" placeholder={tasa.datos ? String(tasa.datos.usdVes) : '0,00'} value={nuevaTasa}
                     onChange={(e) => setNuevaTasa(e.target.value)} aria-label="Tasa BCV" style={{ maxWidth: 160 }} />
              <button className="btn btn-sec" disabled={!finanzas || !nuevaTasa || accion.ocupado}
                      onClick={() => accion.correr(async () => { await api.fijarTasaBcv(Number(nuevaTasa.replace(',', '.'))); setNuevaTasa(''); tasa.recargar(); }, 'Tasa BCV actualizada.')}>Guardar tasa</button>
            </div>
            <p className="nota">Normalmente la carga sola un proceso diario; use esto si falla.</p>
          </Tarjeta>

          <Tarjeta titulo="Suspender morosos">
            <Campo etiqueta="Días de gracia después del vencimiento">
              <input type="number" min={0} max={60} value={dias} onChange={(e) => setDias(Number(e.target.value))} style={{ maxWidth: 120 }} />
            </Campo>
            <button className="btn btn-peligro-sec" disabled={!finanzas || accion.ocupado}
                    onClick={() => accion.correr(async () => {
                      const k = await api.suspenderMorosos(dias);
                      accion.setMsg({ ok: true, t: k ? `${k} condominio(s) suspendido(s) por falta de pago.` : 'Ningún condominio para suspender.' });
                      recargar();
                    })}>Suspender morosos</button>
            <p className="nota">Un condominio suspendido queda en solo lectura para la junta; los residentes pueden seguir viendo su información y reportando pagos a su condominio.</p>
          </Tarjeta>
        </div>
    </>
  );
}
