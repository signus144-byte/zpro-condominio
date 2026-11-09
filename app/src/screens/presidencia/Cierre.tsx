// Reporte y cierre del mes: quién pagó y quién no, pagos aprobados / rechazados / en revisión, ingresos, gastos,
// saldos de las cuentas, fondo de reserva y cuotas especiales. Mes a mes, descargable en PDF y Excel.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type CasaReporteMensual, type ReporteDelMes } from '../../data';
import { Cifra, Estado, Etiqueta, Tarjeta, Vacio, useCarga } from '../../components/ui';
import { ESTADO_PAGO, METODOS, bs, fecha, mes, mesAnterior, mesSiguiente, monto, periodoActual, usd } from '../../formato';
import { BotonDoc, documentoReporte } from '../Documentos';

type FiltroCasa = 'todas' | 'debe' | 'al_dia';
const ESTADO_CASA: Record<CasaReporteMensual['estado'], [string, 'ok' | 'error' | 'info']> = {
  al_dia: ['Al día', 'ok'], debe: ['Debe', 'error'], a_favor: ['A favor', 'info'],
};
const RECIBO: Record<CasaReporteMensual['recibo'], string> = { pagado: 'Recibo pagado', parcial: 'Recibo abonado', pendiente: 'Recibo sin pagar', sin_recibo: 'Sin recibo' };

export function CierreMes() {
  const s = api.sesion()!;
  const [params] = useSearchParams();
  const [periodo, setPeriodo] = useState(params.get('periodo') ?? mesAnterior(periodoActual()));
  const rep = useCarga(() => api.reporteMensual(periodo), [periodo]);
  const cierres = useCarga(() => api.cierres());
  const [filtro, setFiltro] = useState<FiltroCasa>('todas');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const terminado = periodo < periodoActual();

  async function cerrar() {
    setMsg(null); setCerrando(true);
    try {
      await api.cerrarMes(periodo);
      setMsg({ ok: true, t: `Cierre de ${mes(periodo).toLowerCase()} guardado. Queda en el historial tal como está hoy.` });
      rep.recargar(); cierres.recargar();
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }); } finally { setCerrando(false); }
  }

  return (
    <>
      <div className="selector-mes">
        <button className="btn-texto" onClick={() => { setPeriodo(mesAnterior(periodo)); setMsg(null); }} aria-label="Mes anterior">‹</button>
        <strong>{mes(periodo)}</strong>
        <button className="btn-texto" onClick={() => { setPeriodo(mesSiguiente(periodo)); setMsg(null); }} aria-label="Mes siguiente" disabled={periodo >= periodoActual()}>›</button>
      </div>
      <Estado cargando={rep.cargando} error={rep.error}>
        {rep.datos && <Reporte r={rep.datos} filtro={filtro} setFiltro={setFiltro} />}
      </Estado>
      {rep.datos && (
        <Tarjeta titulo="Descargar e imprimir">
          <div className="doc-fila">
            <BotonDoc texto="Reporte del mes" formato="PDF" hacer={() => documentoReporte(rep.datos!, 'pdf')} />
            <BotonDoc texto="Reporte del mes" formato="Excel" hacer={() => documentoReporte(rep.datos!, 'xlsx')} />
            <BotonDoc texto="Libro de ingresos y egresos" formato="Excel" hacer={() => documentoReporte(rep.datos!, 'libro')} />
          </div>
          {s.manejaFinanzas && (terminado ? (
            <>
              <p className="nota">{rep.datos.cerrado
                ? 'Si aprobó pagos de este mes después del cierre, vuelva a cerrarlo para actualizar el historial.'
                : 'Al cerrar, el reporte queda guardado tal como está hoy y se puede consultar siempre.'}</p>
              <button className="btn btn-ancho" onClick={() => void cerrar()} disabled={cerrando}>
                {cerrando ? 'Guardando…' : rep.datos.cerrado ? `Actualizar cierre de ${mes(periodo).toLowerCase()}` : `Cerrar ${mes(periodo).toLowerCase()}`}
              </button>
            </>
          ) : <p className="nota">Este mes todavía no termina: el reporte se ve en vivo y se cierra solo el día 1.</p>)}
          {msg && <div className={`aviso ${msg.ok ? 'aviso-ok' : 'aviso-error'}`}>{msg.t}</div>}
        </Tarjeta>
      )}
      <Tarjeta titulo="Meses cerrados">
        <Estado cargando={cierres.cargando} error={cierres.error}>
          {cierres.datos?.length ? (
            <ul className="lista">
              {cierres.datos.map((k) => (
                <li key={k.periodo} className="clicable" onClick={() => { setPeriodo(k.periodo); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                  <span><strong>{mes(k.periodo)}</strong><small>Cerrado el {fecha(k.cerradoEn)}{k.automatico ? ' · automático' : k.por ? ` · ${k.por}` : ''}</small></span>
                  <span className="btn-texto">Ver</span>
                </li>
              ))}
            </ul>
          ) : <Vacio>Aún no hay meses cerrados. El día 1 de cada mes se cierra solo el mes anterior.</Vacio>}
        </Estado>
      </Tarjeta>
    </>
  );
}

function Reporte({ r: rep, filtro, setFiltro }: { r: ReporteDelMes; filtro: FiltroCasa; setFiltro: (f: FiltroCasa) => void }) {
  const d = rep.datos, x = d.resumen;
  const casas = d.casas.filter((c) => filtro === 'todas' || (filtro === 'debe' ? c.estado === 'debe' : c.estado !== 'debe'));
  const [verPagos, setVerPagos] = useState<'todos' | 'confirmado' | 'rechazado' | 'reportado'>('todos');
  const pagos = d.pagos.filter((p) => verPagos === 'todos' || p.estado === verPagos);
  return (
    <>
      <div className="cierre-estado">
        {rep.cerrado
          ? <Etiqueta tono="ok">Cerrado el {fecha(rep.cerrado.en)}{rep.cerrado.automatico ? ' · automático' : rep.cerrado.por ? ` · ${rep.cerrado.por}` : ''}</Etiqueta>
          : <Etiqueta tono="alerta">{d.periodo >= periodoActual() ? 'Mes en curso · en vivo' : 'Sin cerrar · en vivo'}</Etiqueta>}
      </div>
      <div className="cifras">
        <Cifra etiqueta="Facturado" valor={usd(x.facturadoUsd)} />
        <Cifra etiqueta="Cobrado" valor={usd(x.cobradoUsd)} nota={x.facturadoUsd ? `${Math.round(100 * x.cobradoUsd / x.facturadoUsd)} % de lo facturado` : undefined} />
        <Cifra etiqueta="Gastos" valor={usd(x.gastosUsd)} nota={`Resultado ${usd(x.cobradoUsd - x.gastosUsd)}`} />
        <Cifra etiqueta="Deuda al cierre" valor={usd(x.deudaFinalUsd)} tono={x.deudaFinalUsd > 0.009 ? 'error' : 'ok'}
               nota={`${x.casasConDeuda} de ${x.totalCasas} casas deben`} />
      </div>
      <div className="accesos">
        <button className="acceso" onClick={() => setVerPagos('confirmado')}><strong>{x.pagosAprobados}</strong><span>pagos aprobados</span></button>
        <button className="acceso acceso-error" onClick={() => setVerPagos('rechazado')}><strong>{x.pagosRechazados}</strong><span>rechazados</span></button>
      </div>
      {x.pagosEnRevision > 0 && <p className="nota">Hay {x.pagosEnRevision} pago(s) de este mes en revisión por {usd(x.enRevisionUsd)}: no cuentan como cobrados hasta aprobarlos.</p>}

      <Tarjeta titulo="¿Quién pagó y quién no?">
        <div className="chips">
          {(['todas', 'debe', 'al_dia'] as FiltroCasa[]).map((f) => (
            <button key={f} className={`chip ${filtro === f ? 'chip-activo' : ''}`} onClick={() => setFiltro(f)}>
              {f === 'todas' ? `Todas (${d.casas.length})` : f === 'debe' ? `Deben (${x.casasConDeuda})` : `Al día (${x.casasAlDia})`}
            </button>
          ))}
        </div>
        <table className="tabla">
          <thead><tr><th>Casa</th><th className="num">Pagó en el mes</th><th className="num">Saldo al cierre</th></tr></thead>
          <tbody>
            {casas.map((c) => (
              <tr key={c.unidadId}>
                <td><strong>{c.etiqueta.replace(/^Apto /, '')}</strong><small>{c.propietario ?? ''}</small>
                  <small><Etiqueta tono={ESTADO_CASA[c.estado][1]}>{ESTADO_CASA[c.estado][0]}</Etiqueta> {c.recibo === 'pagado' && c.estado === 'debe' ? 'Recibo pagado después del cierre' : RECIBO[c.recibo]}
                    {c.pagosRechazados > 0 && ` · ${c.pagosRechazados} rechazado(s)`}{c.pagosEnRevision > 0 && ` · ${c.pagosEnRevision} en revisión`}</small></td>
                <td className="num">{usd(c.pagadoUsd)}<small>de {usd(c.facturadoUsd)} del mes</small></td>
                <td className={`num ${c.estado === 'debe' ? 'txt-error' : 'txt-ok'}`}>{usd(c.saldoFinalUsd)}<small>antes {usd(c.saldoAnteriorUsd)}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!casas.length && <Vacio>Ninguna casa en este grupo.</Vacio>}
      </Tarjeta>

      <Tarjeta titulo="Pagos del mes">
        <div className="chips">
          {(['todos', 'confirmado', 'rechazado', 'reportado'] as const).map((f) => (
            <button key={f} className={`chip ${verPagos === f ? 'chip-activo' : ''}`} onClick={() => setVerPagos(f)}>
              {f === 'todos' ? 'Todos' : ESTADO_PAGO[f]}
            </button>
          ))}
        </div>
        {pagos.length ? (
          <ul className="lista">
            {pagos.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.unidad.replace(/^Apto /, '')} · {p.moneda === 'USD' ? usd(p.monto) : bs(p.monto)}</strong>
                  <small>{METODOS[p.metodo]} · {fecha(p.fechaPago)}{p.referencia && ` · Ref. ${p.referencia}`}{p.moneda === 'VES' && ` · ${usd(p.montoUsd)}`}</small>
                  {p.estado === 'confirmado' && !!p.aplicadoA.length && <small className="aplicado">Se descontó de: {p.aplicadoA.map((a) => `${a.concepto} (${usd(a.montoUsd)})`).join(', ')}</small>}
                  {p.estado === 'rechazado' && <small className="txt-error">Motivo: {p.motivoRechazo}</small>}
                </div>
                <Etiqueta tono={p.estado === 'confirmado' ? 'ok' : p.estado === 'rechazado' ? 'error' : 'info'}>{ESTADO_PAGO[p.estado]}</Etiqueta>
              </li>
            ))}
          </ul>
        ) : <Vacio>Sin pagos.</Vacio>}
      </Tarjeta>

      <Tarjeta titulo="Gastos del mes" accion={<strong>{usd(x.gastosUsd)}</strong>}>
        {d.gastos.length ? (
          <table className="tabla">
            <tbody>
              {d.gastos.map((g, i) => (
                <tr key={i}><td>{g.descripcion}<small>{g.categoria}{g.cuenta ? ` · ${g.cuenta}` : ''}</small></td>
                  <td className="num">{usd(g.montoUsd)}{g.moneda === 'VES' && <small>{bs(g.monto)}</small>}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Vacio>Sin gastos registrados.</Vacio>}
      </Tarjeta>

      <Tarjeta titulo="Saldos de las cuentas">
        <table className="tabla">
          <thead><tr><th>Cuenta</th><th className="num">Saldo final</th></tr></thead>
          <tbody>
            {d.cuentas.map((c) => (
              <tr key={c.nombre}>
                <td>{c.nombre}<small>Inicial {monto(c.saldoInicial, c.moneda)} · entró {monto(c.entradas, c.moneda)} · salió {monto(c.salidas, c.moneda)}</small></td>
                <td className={`num ${c.saldoFinal < 0 ? 'txt-error' : ''}`}><strong>{monto(c.saldoFinal, c.moneda)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="nota">Fondo de reserva: facturado {usd(d.fondoReserva.facturadoAcumUsd)} · cobrado {usd(d.fondoReserva.cobradoAcumUsd)} (acumulado).</p>
      </Tarjeta>

      {d.partidas.length > 0 && (
        <Tarjeta titulo="Cuotas especiales">
          {d.partidas.map((p) => {
            const pctC = p.emitidoUsd ? Math.min(100, 100 * p.cobradoUsd / p.emitidoUsd) : 0;
            return (
              <div key={p.id} className="avance-partida">
                <div className="barra-voto-txt"><span><strong>{p.titulo}</strong> · {p.casas} casas</span><span>{Math.round(pctC)} %</span></div>
                <div className="barra-voto-fondo"><div style={{ width: `${pctC}%` }} className="si" /></div>
                <small className="meta">Cobrado {usd(p.cobradoUsd)} de {usd(p.emitidoUsd)} emitido · presupuesto {usd(p.presupuestoUsd)}</small>
              </div>
            );
          })}
        </Tarjeta>
      )}
    </>
  );
}
