import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type NuevoCondominio, type TipoDesarrollo } from '../data';
import { Campo, Etiqueta, Tarjeta, useAccion, useCarga } from '../ui';
import { TIPOS, TIPOS_UNIDAD, bs, csv, descargar, entero, planPara, rangoPlan, usd } from '../formato';
import { leerArchivoUnidades, type ResultadoImport } from '../importar';

const PASOS = ['Datos', 'Marca', 'Unidades', 'Plan y prueba', 'Listo'];
const ESTADOS_VE = ['Amazonas', 'Anzoátegui', 'Apure', 'Aragua', 'Barinas', 'Bolívar', 'Carabobo', 'Cojedes', 'Delta Amacuro',
  'Distrito Capital', 'Falcón', 'Guárico', 'La Guaira', 'Lara', 'Mérida', 'Miranda', 'Monagas', 'Nueva Esparta', 'Portuguesa',
  'Sucre', 'Táchira', 'Trujillo', 'Yaracuy', 'Zulia'];

const VACIO: NuevoCondominio = {
  nombre: '', tipo: 'edificio', ciudad: '', estadoGeo: 'Aragua', direccion: '', telefono: '', correo: '',
  nombreAsociacion: '', rif: '', colorPrimario: '#0f4c4a', logo: null, fotoEntrada: null, unidades: [], diasPrueba: 30,
};

export function Alta() {
  const planes = useCarga(() => api.planes());
  const tasa = useCarga(() => api.tasaBcv());
  const [paso, setPaso] = useState(0);
  const [n, setN] = useState<NuevoCondominio>(VACIO);
  const [imp, setImp] = useState<ResultadoImport | null>(null);
  const [archivo, setArchivo] = useState('');
  const [hecho, setHecho] = useState<{ id: string; codigoActivacion: string } | null>(null);
  const accion = useAccion();
  const set = <K extends keyof NuevoCondominio>(k: K, v: NuevoCondominio[K]) => setN((x) => ({ ...x, [k]: v }));
  const vistaLogo = useMemo(() => (n.logo ? URL.createObjectURL(n.logo) : null), [n.logo]);
  const vistaFoto = useMemo(() => (n.fotoEntrada ? URL.createObjectURL(n.fotoEntrada) : null), [n.fotoEntrada]);
  useEffect(() => () => { if (vistaLogo) URL.revokeObjectURL(vistaLogo); }, [vistaLogo]);

  const validoPaso = [
    n.nombre.trim().length >= 3 && n.ciudad.trim().length > 0,
    /^#[0-9a-f]{6}$/i.test(n.colorPrimario) && (!n.rif || /^[JGVEP]-?\d{8}-?\d$/i.test(n.rif.trim())),
    !!imp && !imp.errores.length && imp.unidades.length > 0,
    n.unidades.length > 0 && n.diasPrueba >= 0,
  ];

  async function cargar(f: File | undefined) {
    if (!f) return;
    setArchivo(f.name);
    accion.setMsg(null);
    try {
      const r = await leerArchivoUnidades(f, n.tipo);
      setImp(r);
      set('unidades', r.errores.length ? [] : r.unidades);
    } catch (e) { setImp({ unidades: [], errores: [`No se pudo leer el archivo: ${(e as Error).message}`], avisos: [], sumaAlicuotas: 0 }); }
  }

  async function crear() {
    if (await accion.correr(async () => setHecho(await api.crearCondominio(n)))) setPaso(4);
  }

  const plan = planes.datos ? planPara(n.unidades.length, planes.datos) : null;

  return (
    <>
      <div className="titulo-pagina"><div><h1>Alta de condominio</h1><p>Se crea en modo prueba; el presidente lo activa con su código.</p></div></div>
      <ol className="pasos">
        {PASOS.map((p, i) => <li key={p} className={i === paso ? 'actual' : i < paso ? 'hecho' : ''}><b>{i < paso ? '✓' : i + 1}</b>{p}</li>)}
      </ol>
      <accion.Mensaje />

      {paso === 0 && (
        <Tarjeta titulo="Datos del condominio">
          <div className="rejilla">
            <Campo etiqueta="Nombre"><input value={n.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Residencias Los Samanes" autoFocus /></Campo>
            <Campo etiqueta="Tipo">
              <select value={n.tipo} onChange={(e) => { set('tipo', e.target.value as TipoDesarrollo); setImp(null); set('unidades', []); }}>
                {(Object.keys(TIPOS) as TipoDesarrollo[]).map((t) => <option key={t} value={t}>{TIPOS[t]}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Ciudad o municipio"><input value={n.ciudad} onChange={(e) => set('ciudad', e.target.value)} placeholder="Maracay" /></Campo>
            <Campo etiqueta="Estado">
              <select value={n.estadoGeo} onChange={(e) => set('estadoGeo', e.target.value)}>{ESTADOS_VE.map((e) => <option key={e}>{e}</option>)}</select>
            </Campo>
            <Campo etiqueta="Dirección"><input value={n.direccion} onChange={(e) => set('direccion', e.target.value)} /></Campo>
            <Campo etiqueta="Teléfono de la junta"><input value={n.telefono} onChange={(e) => set('telefono', e.target.value)} inputMode="tel" placeholder="0414-0000000" /></Campo>
            <Campo etiqueta="Correo de la junta"><input type="email" value={n.correo} onChange={(e) => set('correo', e.target.value)} /></Campo>
          </div>
        </Tarjeta>
      )}

      {paso === 1 && (
        <div className="dos">
          <Tarjeta titulo="Marca (va en recibos, estados de cuenta y actas)">
            <Campo etiqueta="Nombre de la asociación o junta"><input value={n.nombreAsociacion} onChange={(e) => set('nombreAsociacion', e.target.value)} placeholder="Junta de Condominio Residencias Los Samanes" /></Campo>
            <div className="rejilla">
              <Campo etiqueta="RIF" ayuda="Formato J-12345678-9"><input value={n.rif} onChange={(e) => set('rif', e.target.value.toUpperCase())} placeholder="J-12345678-9" /></Campo>
              <Campo etiqueta="Color principal"><input type="color" value={n.colorPrimario} onChange={(e) => set('colorPrimario', e.target.value)} /></Campo>
            </div>
            <Campo etiqueta="Logo (opcional)"><input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => set('logo', e.target.files?.[0] ?? null)} /></Campo>
            <Campo etiqueta="Foto de la entrada o fachada (opcional)" ayuda="La junta también puede tomarla después desde la app.">
              <input type="file" accept="image/*" onChange={(e) => set('fotoEntrada', e.target.files?.[0] ?? null)} />
            </Campo>
          </Tarjeta>
          <Tarjeta titulo="Vista previa">
            <div className="vista-marca" style={{ background: n.colorPrimario }}>
              {vistaLogo && <img src={vistaLogo} alt="" />}
              <div><strong>{n.nombreAsociacion || n.nombre || 'Nombre de la asociación'}</strong><div style={{ opacity: 0.85, fontSize: '0.85rem' }}>{n.rif || 'RIF'}</div></div>
            </div>
            {vistaFoto ? <img className="foto-entrada" src={vistaFoto} alt="Entrada" /> : <div className="foto-vacia">Sin foto de entrada</div>}
            {n.rif && !validoPaso[1] && <p className="txt-error nota">El RIF no tiene el formato J-12345678-9.</p>}
          </Tarjeta>
        </div>
      )}

      {paso === 2 && (
        <Tarjeta titulo="Unidades" accion={<button className="btn-texto" onClick={() => descargar('plantilla_unidades.csv', csv([
          ['bloque', 'numero', 'tipo', 'alicuota', 'propietario'], ['A', '11', 'apartamento', '2,5', 'Nombre del propietario'], ['A', '12', 'apartamento', '2,5', ''],
        ]))}>Descargar plantilla</button>}>
          <div className="zona-archivo">
            <strong>Suba el listado en Excel (.xlsx) o CSV</strong>
            <span className="nota">Columnas: <code>bloque</code>, <code>numero</code>, <code>tipo</code>, <code>alicuota</code>, <code>propietario</code>. Las alícuotas deben sumar 100 % (como en el documento de condominio).</span>
            <input type="file" accept=".xlsx,.csv,text/csv" aria-label="Archivo de unidades" onChange={(e) => cargar(e.target.files?.[0])} />
          </div>
          {imp && (
            <>
              <div className="acciones">
                <Etiqueta tono={imp.errores.length ? 'error' : 'ok'}>{imp.errores.length ? 'Con errores' : 'Listo para importar'}</Etiqueta>
                <span>{archivo} · {entero(imp.unidades.length)} unidades · alícuotas suman <strong className={Math.abs(imp.sumaAlicuotas - 100) > 0.01 ? 'txt-error' : 'txt-ok'}>{imp.sumaAlicuotas.toLocaleString('es-VE', { maximumFractionDigits: 4 })} %</strong></span>
              </div>
              {imp.errores.map((e) => <div key={e} className="aviso aviso-error">{e}</div>)}
              {imp.avisos.map((e) => <div key={e} className="aviso aviso-info">{e}</div>)}
              {imp.unidades.length > 0 && (
                <div className="tabla-envoltura" style={{ maxHeight: 320, overflowY: 'auto' }}>
                  <table className="tabla">
                    <thead><tr><th>Bloque</th><th>Número</th><th>Tipo</th><th className="num">Alícuota</th><th>Propietario</th></tr></thead>
                    <tbody>{imp.unidades.slice(0, 100).map((u) => (
                      <tr key={`${u.bloque}-${u.numero}`}><td>{u.bloque ?? '—'}</td><td>{u.numero}</td><td>{TIPOS_UNIDAD[u.tipo]}</td>
                        <td className="num">{u.alicuota.toLocaleString('es-VE', { maximumFractionDigits: 4 })} %</td><td>{u.propietario ?? <small>—</small>}</td></tr>
                    ))}</tbody>
                  </table>
                  {imp.unidades.length > 100 && <p className="nota">… y {imp.unidades.length - 100} más.</p>}
                </div>
              )}
            </>
          )}
        </Tarjeta>
      )}

      {paso === 3 && (
        <Tarjeta titulo="Plan y prueba">
          <p className="nota">El plan no se elige: se asigna solo según la cantidad de unidades. Todos los planes incluyen todo.</p>
          <div className="tres" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            {planes.datos?.map((p) => (
              <div key={p.id} className={`tarjeta ${plan?.id === p.id ? 'chip-activo' : ''}`} data-prueba={plan?.id === p.id ? 'plan-asignado' : undefined}>
                <strong>{p.nombre}{plan?.id === p.id && ' ✓'}</strong>
                <span>{rangoPlan(p, planes.datos!)}</span>
                <span>{usd(p.precioUsdMes)} al mes</span>
              </div>
            ))}
          </div>
          <Campo etiqueta="Días de prueba gratis"><input type="number" min={0} max={90} value={n.diasPrueba} onChange={(e) => set('diasPrueba', Number(e.target.value))} style={{ maxWidth: 140 }} /></Campo>
          {plan && <div className="aviso aviso-info">Con {entero(n.unidades.length)} unidades le corresponde el plan <strong>{plan.nombre}</strong>: <strong>{usd(plan.precioUsdMes)} al mes</strong>{tasa.datos ? ` (hoy ${bs(plan.precioUsdMes * tasa.datos.usdVes)})` : ''}, cobrado en bolívares a la tasa BCV del día del pago. Paga desde que termine la prueba.</div>}
        </Tarjeta>
      )}

      {paso === 4 && hecho && (
        <Tarjeta titulo={`${n.nombre} quedó registrado`}>
          <p>Entregue este código al presidente de la junta. Lo escribe en la app (“Activar mi condominio”) y queda como presidente.</p>
          <div className="codigo-grande" data-prueba="codigo-activacion">{hecho.codigoActivacion}</div>
          <div className="acciones">
            <a className="btn btn-sec" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Código de activación de ${n.nombre} en ZPro Condominio: ${hecho.codigoActivacion}`)}`}>Enviar por WhatsApp</a>
            <Link className="btn" to={`/condominios/${hecho.id}`}>Ver condominio</Link>
            <button className="btn-texto" onClick={() => { setN(VACIO); setImp(null); setHecho(null); setPaso(0); }}>Dar de alta otro</button>
          </div>
        </Tarjeta>
      )}

      {paso < 4 && (
        <div className="acciones">
          {paso > 0 && <button className="btn btn-sec" onClick={() => setPaso(paso - 1)}>Atrás</button>}
          {paso < 3 && <button className="btn" disabled={!validoPaso[paso]} onClick={() => setPaso(paso + 1)}>Siguiente</button>}
          {paso === 3 && <button className="btn" disabled={!validoPaso.every(Boolean) || accion.ocupado} onClick={crear}>{accion.ocupado ? 'Creando…' : 'Crear condominio'}</button>}
        </div>
      )}
    </>
  );
}
