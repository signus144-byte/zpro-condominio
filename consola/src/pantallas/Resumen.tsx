import { Link, useNavigate } from 'react-router-dom';
import { api, type Condominio, type EstadoCondominio } from '../data';
import { Barra, Cifra, Estado, Etiqueta, Tarjeta, Vacio, useCarga } from '../ui';
import { ESTADOS, TONO_ESTADO, bs, entero, mes, pct, periodoActual, r2, usd } from '../formato';

export const adopcion = (c: Condominio) => (c.unidades ? (100 * c.unidadesConApp) / c.unidades : 0);
/** Mensualidad vigente en dólares: la de su plan por tamaño o el precio especial (la calcula el servidor). */
export const mensualidad = (c: Condominio) => c.mensualidadUsd ?? 0;

export function Resumen() {
  const ir = useNavigate();
  const periodo = periodoActual();
  const d = useCarga(async () => {
    const [condos, facturas, tasa, pagos] = await Promise.all([
      api.condominios(), api.facturas(periodo), api.tasaBcv(), api.pagos('reportado'),
    ]);
    return { condos, facturas, tasa, pagos };
  });

  return (
    <>
      <div className="titulo-pagina">
        <div><h1>Resumen</h1><p>{mes(periodo)}{d.datos?.tasa && ` · Tasa BCV ${d.datos.tasa.usdVes.toLocaleString('es-VE')} Bs/$`}</p></div>
        <Link className="btn" to="/alta">+ Alta de condominio</Link>
      </div>
      <Estado cargando={d.cargando} error={d.error}>
        {d.datos && (() => {
          const { condos, facturas, tasa, pagos } = d.datos;
          const t = tasa?.usdVes ?? 0;
          const activos = condos.filter((c) => c.estado === 'activo');
          const enPrueba = condos.filter((c) => c.estado === 'prueba');
          const vivos = condos.filter((c) => c.estado !== 'baja');
          const unidades = vivos.reduce((s, c) => s + c.unidades, 0);
          const conApp = vivos.reduce((s, c) => s + c.unidadesConApp, 0);
          const mrr = r2(activos.reduce((s, c) => s + mensualidad(c), 0));
          const potencial = r2(enPrueba.reduce((s, c) => s + mensualidad(c), 0));
          const cobrado = r2(facturas.filter((f) => f.estado === 'pagada').reduce((s, f) => s + f.montoUsd, 0));
          const pendiente = r2(facturas.filter((f) => f.estado === 'emitida' || f.estado === 'vencida').reduce((s, f) => s + Math.max(0, f.montoUsd - f.abonadoUsd), 0));
          const porEstado = (['activo', 'prueba', 'suspendido', 'baja'] as EstadoCondominio[]).map((e) => [e, condos.filter((c) => c.estado === e).length] as const);
          const riesgo = condos.filter((c) => c.estado !== 'baja').map((c) => {
            const motivos: string[] = [];
            if (c.ultimaFactura === 'vencida') motivos.push('Debe a ZentaPro');
            if (c.estado === 'suspendido') motivos.push('Suspendido');
            if (c.unidades && adopcion(c) < 30 && c.estado !== 'prueba') motivos.push(`Adopción baja (${Math.round(adopcion(c))} %)`);
            if (c.estado === 'prueba' && c.pruebaHasta && c.pruebaHasta <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)) motivos.push(`Prueba vence ${c.pruebaHasta}`);
            return { c, motivos };
          }).filter((x) => x.motivos.length);

          return (
            <>
              <div className="cifras">
                <Cifra etiqueta="Ingreso mensual recurrente" valor={usd(mrr)} nota={`${bs(mrr * t)} · ${activos.length} condominios activos`} />
                <Cifra etiqueta="Cobrado este mes" valor={usd(cobrado)} tono="ok"
                       nota={`${cobrado + pendiente ? Math.round((100 * cobrado) / (cobrado + pendiente)) : 0} % de lo facturado`} />
                <Cifra etiqueta="Pendiente por cobrar" valor={usd(pendiente)} tono={pendiente ? 'alerta' : undefined}
                       nota={`${bs(pendiente * t)} a la tasa de hoy · ${pagos.length} pago(s) por confirmar`} />
                <Cifra etiqueta="Unidades con la app" valor={`${entero(conApp)} / ${entero(unidades)}`}
                       nota={`Adopción ${pct(unidades ? r2((100 * conApp) / unidades) : 0)} · potencial en prueba ${usd(potencial)}/mes`} />
              </div>

              <div className="dos">
                <Tarjeta titulo="Condominios en riesgo" accion={<Link to="/condominios" className="btn-texto">Ver todos</Link>}>
                  {riesgo.length ? (
                    <div className="tabla-envoltura">
                      <table className="tabla">
                        <tbody>
                          {riesgo.map(({ c, motivos }) => (
                            <tr key={c.id} className="clicable" onClick={() => ir(`/condominios/${c.id}`)}>
                              <td><div className="condo-nombre">{c.logoUrl && <img className="logo" src={c.logoUrl} alt="" />}<span>{c.nombre}<small>{c.ciudad}, {c.estadoGeo}</small></span></div></td>
                              <td><div className="chips">{motivos.map((m) => <Etiqueta key={m} tono={/Debe|Suspendido/.test(m) ? 'error' : 'alerta'}>{m}</Etiqueta>)}</div></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <Vacio>Ningún condominio en riesgo.</Vacio>}
                </Tarjeta>

                <Tarjeta titulo="Condominios por estado">
                  <table className="tabla">
                    <tbody>
                      {porEstado.map(([e, nE]) => (
                        <tr key={e}>
                          <td><Etiqueta tono={TONO_ESTADO[e]}>{ESTADOS[e]}</Etiqueta></td>
                          <td style={{ width: '55%' }}><Barra valor={condos.length ? (100 * nE) / condos.length : 0} tono={e === 'suspendido' ? 'alerta' : 'ok'} /></td>
                          <td className="num">{nE}</td>
                        </tr>
                      ))}
                      <tr className="fila-total"><td>Total</td><td /><td className="num">{condos.length}</td></tr>
                    </tbody>
                  </table>
                  <p className="nota">Solo los activos se facturan. Los que están en prueba no pagan hasta que termine la prueba.</p>
                </Tarjeta>
              </div>
            </>
          );
        })()}
      </Estado>
    </>
  );
}
