import { useState } from 'react';
import { api, type Plan } from '../data';
import { Campo, Estado, Tarjeta, useAccion, useCarga } from '../ui';
import { bs, entero, ordenarPlanes, rangoPlan, usd } from '../formato';

interface Borrador { nombre: string; hasta: string; precio: string }

export function Planes() {
  const d = useCarga(async () => {
    const [planes, condos, tasa] = await Promise.all([api.planes(), api.condominios(), api.tasaBcv()]);
    return { planes: ordenarPlanes(planes), condos, tasa };
  });
  const accion = useAccion();
  const [editando, setEditando] = useState<string | null>(null);
  const [b, setB] = useState<Borrador>({ nombre: '', hasta: '', precio: '' });
  const esDueno = api.sesion()?.rol === 'dueno';

  function editar(p: Plan) {
    setEditando(p.id);
    setB({ nombre: p.nombre, hasta: p.hastaUnidades == null ? '' : String(p.hastaUnidades), precio: String(p.precioUsdMes) });
    accion.setMsg(null);
  }

  async function guardar(p: Plan) {
    const precio = Number(b.precio.replace(',', '.'));
    const hasta = p.hastaUnidades == null ? null : Number(b.hasta);
    if (!(precio > 0)) { accion.setMsg({ ok: false, t: 'El precio debe ser mayor que cero.' }); return; }
    if (hasta !== null && !(Number.isInteger(hasta) && hasta > 0)) { accion.setMsg({ ok: false, t: 'El tope de unidades debe ser un número entero mayor que cero.' }); return; }
    const ok = await accion.correr(() => api.editarPlan(p.id, {
      nombre: b.nombre.trim(), precioUsdMes: precio, ...(p.hastaUnidades == null ? {} : { hastaUnidades: hasta }),
    }), `Plan ${b.nombre.trim()} actualizado. Los condominios se reubicaron según sus unidades; el precio nuevo aplica desde la próxima factura.`);
    if (ok) { setEditando(null); d.recargar(); }
  }

  return (
    <>
      <div className="titulo-pagina">
        <div><h1>Planes y precios</h1><p>Precio global al mes según la cantidad de unidades del condominio.</p></div>
      </div>
      <accion.Mensaje />
      <div className="aviso aviso-info">
        Todos los planes incluyen todo: cuenta de la junta, todas sus casas en la app, chat, documentos con su marca y conciliación de pagos.
        El plan se asigna solo según la cantidad de unidades. Se cobra <strong>solo en bolívares</strong>, a la tasa BCV del día del pago.
      </div>
      <Estado cargando={d.cargando && !d.datos} error={d.error}>
        {d.datos && (() => {
          const { planes, condos, tasa } = d.datos;
          const vivos = condos.filter((c) => c.estado !== 'baja');
          return (
            <Tarjeta titulo="Planes por tamaño">
              <div className="tabla-envoltura">
                <table className="tabla" data-prueba="tabla-planes">
                  <thead><tr><th>Plan</th><th>Unidades</th><th className="num">Precio al mes</th><th className="num">Hoy en Bs</th><th className="num">Condominios</th><th className="num">Con precio especial</th><th /></tr></thead>
                  <tbody>
                    {planes.map((p) => {
                      const enPlan = vivos.filter((c) => c.planId === p.id);
                      const especiales = enPlan.filter((c) => c.precioEspecialUsd != null).length;
                      if (editando === p.id) {
                        return (
                          <tr key={p.id}>
                            <td><Campo etiqueta="Nombre"><input value={b.nombre} maxLength={60} onChange={(e) => setB({ ...b, nombre: e.target.value })} /></Campo></td>
                            <td>{p.hastaUnidades == null
                              ? <small>Sin límite (el plan más grande)</small>
                              : <Campo etiqueta="Hasta (unidades)"><input type="number" min={1} value={b.hasta} onChange={(e) => setB({ ...b, hasta: e.target.value })} style={{ maxWidth: 110 }} /></Campo>}</td>
                            <td className="num"><Campo etiqueta="USD al mes"><input inputMode="decimal" value={b.precio} onChange={(e) => setB({ ...b, precio: e.target.value })} style={{ maxWidth: 110 }} /></Campo></td>
                            <td /><td className="num">{entero(enPlan.length)}</td><td className="num">{especiales || '—'}</td>
                            <td><div className="acciones">
                              <button className="btn btn-chico" disabled={accion.ocupado} onClick={() => guardar(p)}>Guardar</button>
                              <button className="btn-texto" onClick={() => setEditando(null)}>Cancelar</button>
                            </div></td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={p.id} data-prueba={`plan-${p.id}`}>
                          <td><strong>{p.nombre}</strong>{p.descripcion && <small>{p.descripcion}</small>}</td>
                          <td>{rangoPlan(p, planes)}</td>
                          <td className="num"><strong>{usd(p.precioUsdMes)}</strong></td>
                          <td className="num">{tasa ? bs(p.precioUsdMes * tasa.usdVes) : '—'}</td>
                          <td className="num">{entero(enPlan.length)}</td>
                          <td className="num">{especiales || '—'}</td>
                          <td>{esDueno && <button className="btn btn-sec btn-chico" disabled={!!editando} onClick={() => editar(p)}>Editar</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="nota">
                {esDueno
                  ? 'Al cambiar un tope, cada condominio pasa solo al plan que le corresponde. El cambio de precio aplica desde la próxima factura; las ya emitidas no cambian. El último plan no tiene límite de unidades.'
                  : 'Solo el dueño de la plataforma puede cambiar los planes. Los precios especiales por condominio se fijan desde la ficha de cada condominio (dueño o finanzas).'}
              </p>
            </Tarjeta>
          );
        })()}
      </Estado>
    </>
  );
}
