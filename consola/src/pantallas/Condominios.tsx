import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type CodigoUnidad, type EstadoCondominio } from '../data';
import { Barra, Campo, Estado, Etiqueta, Tarjeta, Vacio, useAccion, useCarga } from '../ui';
import {
  ESTADOS, ESTADO_FACTURA, TIPOS, TONO_ESTADO, TONO_FACTURA, bs, csv, descargar, entero, fecha, mes, pct, rangoPlan, usd,
} from '../formato';
import { adopcion, mensualidad } from './Resumen';

export function Condominios() {
  const ir = useNavigate();
  const { datos, cargando, error } = useCarga(async () => ({ condos: await api.condominios(), planes: await api.planes() }));
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<'' | EstadoCondominio>('');
  const [plan, setPlan] = useState('');
  const lista = (datos?.condos ?? []).filter((c) =>
    (!estado || c.estado === estado) && (!plan || c.planId === plan) &&
    (!q || `${c.nombre} ${c.ciudad} ${c.estadoGeo} ${c.rif}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <>
      <div className="titulo-pagina">
        <div><h1>Condominios</h1><p>{datos ? `${datos.condos.length} registrados` : ''}</p></div>
        <Link className="btn" to="/alta">+ Alta de condominio</Link>
      </div>
      <div className="filtros">
        <input type="search" placeholder="Buscar por nombre, ciudad o RIF" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoCondominio | '')} aria-label="Estado">
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADOS) as EstadoCondominio[]).map((e) => <option key={e} value={e}>{ESTADOS[e]}</option>)}
        </select>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan">
          <option value="">Todos los planes</option>
          {datos?.planes.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <Estado cargando={cargando} error={error}>
        <Tarjeta>
          {lista.length ? (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead>
                  <tr><th>Condominio</th><th>Estado</th><th>Plan</th><th className="num">Unidades</th><th>Adopción app</th><th className="num">Morosidad</th><th className="num">Mensualidad</th><th>Últ. factura</th></tr>
                </thead>
                <tbody>
                  {lista.map((c) => (
                    <tr key={c.id} className="clicable" onClick={() => ir(`/condominios/${c.id}`)}>
                      <td><div className="condo-nombre">{c.logoUrl && <img className="logo" src={c.logoUrl} alt="" />}<span><strong>{c.nombre}</strong><small>{TIPOS[c.tipo]} · {c.ciudad}, {c.estadoGeo}</small></span></div></td>
                      <td><Etiqueta tono={TONO_ESTADO[c.estado]}>{ESTADOS[c.estado]}</Etiqueta></td>
                      <td>{datos!.planes.find((p) => p.id === c.planId)?.nombre ?? '—'}{c.precioEspecialUsd != null && <small>precio especial</small>}</td>
                      <td className="num">{entero(c.unidades)}</td>
                      <td><div className="celda-barra"><Barra valor={adopcion(c)} tono={adopcion(c) < 30 ? 'alerta' : 'ok'} /><span>{Math.round(adopcion(c))} %</span></div></td>
                      <td className="num">{pct(c.morosidadPct)}</td>
                      <td className="num">{c.estado === 'baja' ? '—' : usd(mensualidad(c))}</td>
                      <td>{c.ultimaFactura ? <Etiqueta tono={TONO_FACTURA[c.ultimaFactura]}>{ESTADO_FACTURA[c.ultimaFactura]}</Etiqueta> : <small>—</small>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Vacio>No hay condominios con esos filtros.</Vacio>}
        </Tarjeta>
      </Estado>
    </>
  );
}

export function DetalleCondominio() {
  const { id = '' } = useParams();
  const d = useCarga(async () => {
    const [c, planes, facturas, tasa] = await Promise.all([api.condominio(id), api.planes(), api.facturas(), api.tasaBcv()]);
    return { c, planes, facturas: facturas.filter((f) => f.condominioId === id).sort((a, b) => b.periodo.localeCompare(a.periodo)), tasa };
  }, [id]);
  const accion = useAccion();
  const [codigo, setCodigo] = useState<string | null>(null);
  const [codigos, setCodigos] = useState<CodigoUnidad[] | null>(null);
  const [confirmarBaja, setConfirmarBaja] = useState('');
  const [precio, setPrecio] = useState('');
  const [nota, setNota] = useState('');
  const rol = api.sesion()?.rol;
  const puedeGestionar = rol === 'dueno' || rol === 'soporte';
  const puedePrecio = rol === 'dueno' || rol === 'finanzas';

  async function fijarPrecio(valor: number | null) {
    if (valor !== null && !(valor > 0)) { accion.setMsg({ ok: false, t: 'Escriba un precio mayor que cero.' }); return; }
    if (await accion.correr(() => api.fijarPrecioEspecial(id, valor, nota || null),
      valor === null ? 'Precio especial quitado: vuelve al precio de su plan.' : 'Precio especial guardado. Aplica desde la próxima factura.')) {
      setPrecio(''); setNota(''); d.recargar();
    }
  }

  async function estado(e: EstadoCondominio, texto: string) {
    if (await accion.correr(() => api.cambiarEstado(id, e), texto)) d.recargar();
  }

  return (
    <Estado cargando={d.cargando && !d.datos} error={d.error}>
      {d.datos && (() => {
        const { c, planes, facturas, tasa } = d.datos;
        const deuda = facturas.filter((f) => f.estado === 'vencida' || f.estado === 'emitida');
        const mensual = mensualidad(c);
        const plan = planes.find((p) => p.id === c.planId) ?? null;
        return (
          <>
            <div className="titulo-pagina">
              <div className="condo-nombre">
                {c.logoUrl && <img className="logo logo-grande" src={c.logoUrl} alt={`Logo de ${c.nombre}`} />}
                <div>
                  <Link to="/condominios" className="btn-texto">‹ Condominios</Link>
                  <h1>{c.nombre}</h1>
                  <p>{TIPOS[c.tipo]} · {c.ciudad}, {c.estadoGeo} · <Etiqueta tono={TONO_ESTADO[c.estado]}>{ESTADOS[c.estado]}</Etiqueta></p>
                </div>
              </div>
            </div>
            <accion.Mensaje />

            <div className="cifras">
              <div className="cifra"><span className="cifra-etq">Unidades</span><strong className="cifra-valor">{entero(c.unidades)}</strong><span className="cifra-nota">{entero(c.usuarios)} usuarios registrados</span></div>
              <div className="cifra"><span className="cifra-etq">Adopción de la app</span><strong className="cifra-valor">{Math.round(adopcion(c))} %</strong><span className="cifra-nota">{entero(c.unidadesConApp)} unidades con al menos un usuario</span></div>
              <div className="cifra"><span className="cifra-etq">Morosidad interna</span><strong className="cifra-valor">{pct(c.morosidadPct)}</strong><span className="cifra-nota">% de unidades con saldo (dato agregado)</span></div>
              <div className={`cifra ${deuda.length ? 'cifra-error' : ''}`}><span className="cifra-etq">Mensualidad ZentaPro</span><strong className="cifra-valor">{c.estado === 'baja' ? '—' : usd(mensual)}</strong><span className="cifra-nota">{tasa ? `${bs(mensual * tasa.usdVes)} a la tasa de hoy` : ''}{c.precioEspecialUsd != null ? ' · precio especial' : ''}{deuda.length ? ` · ${deuda.length} factura(s) sin pagar` : ''}</span></div>
            </div>

            <div className="dos">
              <div className="formulario">
                <Tarjeta titulo="Acciones">
                  <div className="acciones">
                    {c.estado === 'prueba' && <button className="btn" disabled={!puedeGestionar || accion.ocupado} onClick={() => estado('activo', 'Condominio activado: se facturará desde el próximo mes.')}>Activar (fin de prueba)</button>}
                    {c.estado === 'activo' && <button className="btn btn-sec" disabled={!puedeGestionar || accion.ocupado} onClick={() => estado('suspendido', 'Condominio suspendido: queda en solo lectura.')}>Suspender</button>}
                    {(c.estado === 'suspendido' || c.estado === 'baja') && <button className="btn" disabled={!puedeGestionar || accion.ocupado} onClick={() => estado('activo', 'Condominio reactivado.')}>Reactivar</button>}
                    <button className="btn btn-sec" disabled={!puedeGestionar || accion.ocupado}
                            onClick={() => accion.correr(async () => setCodigo(await api.regenerarCodigoActivacion(id)), 'Código de activación nuevo generado. El anterior ya no sirve.')}>
                      {(codigo ?? c.codigoActivacion) ? 'Regenerar código de activación' : 'Generar código de activación'}
                    </button>
                    <button className="btn btn-sec" disabled={!puedeGestionar || accion.ocupado}
                            onClick={() => accion.correr(async () => setCodigos(await api.generarCodigosUnidades(id)))}>Códigos por unidad</button>
                  </div>
                  {c.estado !== 'baja' && (
                    <details>
                      <summary className="txt-error" style={{ cursor: 'pointer' }}>Dar de baja…</summary>
                      <div className="formulario" style={{ marginTop: 8 }}>
                        <p className="nota">El condominio queda en solo lectura y deja de facturarse. Los datos se conservan; se puede reactivar.</p>
                        <Campo etiqueta={`Escriba "${c.nombre}" para confirmar`}>
                          <input value={confirmarBaja} onChange={(e) => setConfirmarBaja(e.target.value)} />
                        </Campo>
                        <div><button className="btn btn-peligro" disabled={!puedeGestionar || confirmarBaja.trim() !== c.nombre || accion.ocupado}
                                     onClick={() => { setConfirmarBaja(''); estado('baja', 'Condominio dado de baja.'); }}>Dar de baja</button></div>
                      </div>
                    </details>
                  )}
                </Tarjeta>

                {(codigo ?? c.codigoActivacion) && (
                  <Tarjeta titulo="Código de activación para el presidente">
                    <div className="codigo-grande" data-prueba="codigo-activacion">{codigo ?? c.codigoActivacion}</div>
                    <p className="nota">El presidente se registra en la app, toca “Activar mi condominio” y escribe este código. Sirve una sola vez.</p>
                    <div className="acciones">
                      <a className="btn btn-sec btn-chico" target="_blank" rel="noreferrer"
                         href={`https://wa.me/?text=${encodeURIComponent(`Código de activación de ${c.nombre} en ZPro Condominio: ${codigo ?? c.codigoActivacion}`)}`}>Enviar por WhatsApp</a>
                      <button className="btn btn-sec btn-chico" onClick={() => navigator.clipboard?.writeText(codigo ?? c.codigoActivacion ?? '')}>Copiar</button>
                    </div>
                  </Tarjeta>
                )}

                {codigos && (
                  <Tarjeta titulo={`Códigos por unidad (${codigos.length})`} accion={
                    <button className="btn btn-chico" onClick={() => descargar(`codigos_${c.nombre.replace(/\W+/g, '_')}.csv`,
                      csv([['Unidad', 'Propietario', 'Código', 'Vence'], ...codigos.map((k) => [k.unidad, k.propietario, k.codigo, k.expiraEn])]))}>Descargar CSV</button>}>
                    <p className="nota">Para imprimir y entregar a cada casa. Vencen el {fecha(codigos[0]?.expiraEn ?? null)}; la junta aprueba cada ingreso.</p>
                    <div className="tabla-envoltura" style={{ maxHeight: 260, overflowY: 'auto' }}>
                      <table className="tabla"><tbody>
                        {codigos.slice(0, 200).map((k) => <tr key={k.codigo}><td>{k.unidad}</td><td><code>{k.codigo}</code></td></tr>)}
                      </tbody></table>
                    </div>
                  </Tarjeta>
                )}

                <Tarjeta titulo="Plan y precio" accion={<Link to="/planes" className="btn-texto">Ver planes</Link>}>
                  <dl className="ficha">
                    <dt>Plan</dt>
                    <dd data-prueba="plan-condominio">{plan ? <><strong>{plan.nombre}</strong> · {rangoPlan(plan, planes)} · {usd(plan.precioUsdMes)} al mes</> : '—'}</dd>
                    <dt>Mensualidad</dt>
                    <dd>{usd(mensual)}{c.precioEspecialUsd != null && <> <Etiqueta tono="info">Precio especial</Etiqueta>{c.notaPrecio && <small>{c.notaPrecio}</small>}</>}</dd>
                  </dl>
                  <p className="nota">El plan se asigna solo según las {entero(c.unidades)} unidades cargadas. Se cobra solo en bolívares, a la tasa BCV del día del pago.</p>
                  {puedePrecio && (
                    <details open={c.precioEspecialUsd != null}>
                      <summary style={{ cursor: 'pointer' }}>Precio especial negociado…</summary>
                      <div className="formulario" style={{ marginTop: 8 }}>
                        <div className="acciones">
                          <Campo etiqueta="Precio especial (USD al mes)">
                            <input inputMode="decimal" value={precio} placeholder={c.precioEspecialUsd != null ? String(c.precioEspecialUsd) : plan ? String(plan.precioUsdMes) : ''}
                                   onChange={(e) => setPrecio(e.target.value)} style={{ maxWidth: 140 }} aria-label="Precio especial en dólares" />
                          </Campo>
                          <Campo etiqueta="Nota (motivo del acuerdo)">
                            <input value={nota} maxLength={200} placeholder={c.notaPrecio ?? 'Ej.: piloto, primer año'} onChange={(e) => setNota(e.target.value)} />
                          </Campo>
                        </div>
                        <div className="acciones">
                          <button className="btn btn-chico" disabled={!precio || accion.ocupado}
                                  onClick={() => fijarPrecio(Number(precio.replace(',', '.')))}>Guardar precio especial</button>
                          {c.precioEspecialUsd != null && <button className="btn btn-sec btn-chico" disabled={accion.ocupado} onClick={() => fijarPrecio(null)}>Quitar (usar precio del plan)</button>}
                        </div>
                      </div>
                    </details>
                  )}
                </Tarjeta>

                <Tarjeta titulo="Facturas de ZentaPro">
                  {facturas.length ? (
                    <div className="tabla-envoltura">
                      <table className="tabla">
                        <thead><tr><th>Mes</th><th className="num">Monto</th><th className="num">Abonado</th><th className="num">Bs (emisión)</th><th>Estado</th></tr></thead>
                        <tbody>{facturas.map((f) => (
                          <tr key={f.id}><td>{mes(f.periodo)}<small>Vence {fecha(f.vence)}</small></td><td className="num">{usd(f.montoUsd)}</td>
                            <td className="num">{usd(f.abonadoUsd)}</td>
                            <td className="num">{bs(f.montoVes)}<small>tasa {f.tasaBcv.toLocaleString('es-VE')}</small></td>
                            <td><Etiqueta tono={TONO_FACTURA[f.estado]}>{ESTADO_FACTURA[f.estado]}</Etiqueta></td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : <Vacio>Sin facturas todavía.</Vacio>}
                </Tarjeta>
              </div>

              <div className="formulario">
                <Tarjeta titulo="Marca">
                  <div className="vista-marca" style={{ background: c.colorPrimario }}>
                    {c.logoUrl && <img src={c.logoUrl} alt="" />}
                    <div><strong>{c.nombreAsociacion ?? c.nombre}</strong><div style={{ opacity: 0.85, fontSize: '0.85rem' }}>{c.rif}</div></div>
                  </div>
                  {c.fotoEntradaUrl ? <img className="foto-entrada" src={c.fotoEntradaUrl} alt={`Entrada de ${c.nombre}`} />
                    : <div className="foto-vacia">Sin foto de la entrada. La junta puede subirla desde la app.</div>}
                </Tarjeta>
                <Tarjeta titulo="Datos">
                  <dl className="ficha">
                    <dt>Asociación</dt><dd>{c.nombreAsociacion ?? '—'}</dd>
                    <dt>RIF</dt><dd>{c.rif ?? '—'}</dd>
                    <dt>Dirección</dt><dd>{c.direccion ?? '—'}</dd>
                    <dt>Contacto</dt><dd>{[c.telefono, c.correo].filter(Boolean).join(' · ') || '—'}</dd>
                    <dt>Alta</dt><dd>{fecha(c.creadoEn)}</dd>
                    <dt>Activado</dt><dd>{fecha(c.activadoEn)}</dd>
                    {c.estado === 'prueba' && <><dt>Prueba hasta</dt><dd>{fecha(c.pruebaHasta)}</dd></>}
                  </dl>
                </Tarjeta>
                <Tarjeta className="privacidad">
                  <p className="nota"><strong>Privacidad:</strong> desde la consola no se ven chats, pagos de residentes, saldos por unidad ni quién envió un reporte anónimo. Solo datos comerciales y métricas agregadas.</p>
                </Tarjeta>
              </div>
            </div>
          </>
        );
      })()}
    </Estado>
  );
}
