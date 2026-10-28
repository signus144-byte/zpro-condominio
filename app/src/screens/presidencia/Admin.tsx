// Administración de la junta: accesos (códigos, solicitudes, miembros), conciliación bancaria,
// factura de ZentaPro, avisos y tasa BCV.
import { useEffect, useMemo, useState } from 'react';
import { api, type CodigoAcceso, type Rol } from '../../data';
import { Campo, Cifra, Estado, Etiqueta, Tarjeta, Vacio, useCarga } from '../../components/ui';
import { bs, fecha, hoyLocal, mes, usd, METODOS } from '../../formato';
import { adivinarColumnas, aMovimientos, leerArchivo, type Columnas, type TablaCruda } from '../../conciliacion/leerExtracto';
import './admin.css';

const ROLES: { v: Rol; t: string }[] = [
  { v: 'presidente', t: 'Presidente' }, { v: 'tesorero', t: 'Tesorero' }, { v: 'vocal', t: 'Vocal' },
  { v: 'administrador', t: 'Administrador' }, { v: 'propietario', t: 'Propietario' }, { v: 'inquilino', t: 'Inquilino' },
];
const nombreRol = (r: Rol) => ROLES.find((x) => x.v === r)?.t ?? r;
/** "21.550,50" o "21550.50" → 21550.5 */
function leerMontoVe(t: string) {
  const x = t.trim().replace(/\s|Bs/gi, '');
  return Number(x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x);
}

function useAccion(alTerminar?: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function hacer(fn: () => Promise<unknown>, mensajeOk?: string) {
    setError(null); setOk(null); setOcupado(true);
    try { await fn(); if (mensajeOk) setOk(mensajeOk); alTerminar?.(); }
    catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  return { error, ok, ocupado, hacer, setError };
}

// ============================ Accesos ============================
export function Accesos() {
  const [pestana, setPestana] = useState<'solicitudes' | 'codigos' | 'miembros'>('solicitudes');
  const sol = useCarga(() => api.solicitudes());
  const recargarSol = sol.recargar;
  // Las solicitudes llegan mientras la pantalla está abierta: se refrescan al volver a la pestaña, al volver a la app y cada 30 s.
  useEffect(() => {
    if (pestana === 'solicitudes') recargarSol();
    const alVolver = () => { if (document.visibilityState === 'visible') recargarSol(); };
    document.addEventListener('visibilitychange', alVolver);
    const t = setInterval(recargarSol, 30_000);
    return () => { document.removeEventListener('visibilitychange', alVolver); clearInterval(t); };
  }, [pestana, recargarSol]);
  return (
    <>
      <div className="chips">
        <button className={`chip ${pestana === 'solicitudes' ? 'chip-activo' : ''}`} onClick={() => setPestana('solicitudes')}>
          Solicitudes{sol.datos?.length ? ` (${sol.datos.length})` : ''}
        </button>
        <button className={`chip ${pestana === 'codigos' ? 'chip-activo' : ''}`} onClick={() => setPestana('codigos')}>Códigos por casa</button>
        <button className={`chip ${pestana === 'miembros' ? 'chip-activo' : ''}`} onClick={() => setPestana('miembros')}>Miembros y roles</button>
      </div>
      {pestana === 'solicitudes' && <Solicitudes datos={sol} />}
      {pestana === 'codigos' && <Codigos />}
      {pestana === 'miembros' && <Miembros />}
    </>
  );
}

function Solicitudes({ datos }: { datos: ReturnType<typeof useCarga<Awaited<ReturnType<typeof api.solicitudes>>>> }) {
  const a = useAccion(datos.recargar);
  return (
    <Tarjeta titulo="Por aprobar">
      <p className="nota">Personas que usaron un código y esperan su aprobación. Verifique que de verdad viven en esa casa antes de aprobar.</p>
      <Estado cargando={datos.cargando} error={datos.error}>
        {datos.datos?.length ? (
          <ul className="lista lista-admin">
            {datos.datos.map((s) => (
              <li key={s.id}>
                <div><strong>{s.usuarioNombre}</strong><small>{s.unidad ?? 'Junta'} · {nombreRol(s.rol)} · {fecha(s.creadoEn)}</small></div>
                <div className="fila-botones">
                  <button className="btn" disabled={a.ocupado} onClick={() => void a.hacer(() => api.resolverSolicitud(s.id, true), `${s.usuarioNombre} ya es miembro.`)}>Aprobar</button>
                  <button className="btn-texto" disabled={a.ocupado} onClick={() => void a.hacer(() => api.resolverSolicitud(s.id, false), 'Solicitud rechazada.')}>Rechazar</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <Vacio>No hay solicitudes pendientes.</Vacio>}
      </Estado>
      {a.ok && <div className="aviso aviso-ok">{a.ok}</div>}
      {a.error && <div className="aviso aviso-error">{a.error}</div>}
    </Tarjeta>
  );
}

function mensajeCodigo(k: CodigoAcceso, condominio: string) {
  return `Hola. Este es el código para entrar a la app ZPro Condominio de ${condominio}` +
    `${k.unidad ? ` (${k.unidad})` : ''}: *${k.codigo}*\n\n1. Descargue la app y cree su cuenta.\n2. Toque "Unirme a mi condominio" y escriba el código.\n` +
    `Vence el ${fecha(k.expiraEn)}.`;
}

function Codigos() {
  const s = api.sesion()!;
  const codigos = useCarga(() => api.codigosAcceso());
  const unidades = useCarga(() => api.unidadesConSaldo());
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [rol, setRol] = useState<Rol>('propietario');
  const [nuevos, setNuevos] = useState<CodigoAcceso[]>([]);
  const a = useAccion(codigos.recargar);
  const condominio = s.condominio ?? 'su condominio';
  const vigentes = (codigos.datos ?? []).filter((k) => k.usos < k.usosMax && k.expiraEn > new Date().toISOString());

  async function generar(todas: boolean) {
    await a.hacer(async () => {
      const r = await api.generarCodigos(todas ? { todas: true, rol } : { unidadIds: [...elegidas], rol });
      setNuevos(r); setElegidas(new Set());
    }, undefined);
  }
  function copiar(k: CodigoAcceso) { void navigator.clipboard?.writeText(mensajeCodigo(k, condominio)).catch(() => {}); }
  function descargarCsv(lista: CodigoAcceso[]) {
    const filas = [['Casa', 'Código', 'Rol', 'Vence'], ...lista.map((k) => [k.unidad ?? '', k.codigo, nombreRol(k.rol), fecha(k.expiraEn)])];
    const csv = '﻿' + filas.map((f) => f.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a2 = document.createElement('a'); a2.href = url; a2.download = 'codigos-de-acceso.csv'; a2.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <>
      <Tarjeta titulo="Generar códigos">
        <p className="nota">Cada código sirve para una casa (hasta 3 personas) y vence en 60 días. Quien lo use queda pendiente hasta que usted lo apruebe.</p>
        <Campo etiqueta="Rol de quien lo use">
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
            <option value="propietario">Propietario (puede votar)</option>
            <option value="inquilino">Inquilino (no vota)</option>
          </select>
        </Campo>
        <Estado cargando={unidades.cargando} error={unidades.error}>
          <div className="casas-grilla">
            {unidades.datos?.map((u) => (
              <label key={u.id} className={`casa-chk ${elegidas.has(u.id) ? 'activa' : ''}`}>
                <input type="checkbox" checked={elegidas.has(u.id)} onChange={(e) => {
                  const n = new Set(elegidas); if (e.target.checked) n.add(u.id); else n.delete(u.id); setElegidas(n);
                }} />
                {u.bloque ? `${u.bloque}-` : ''}{u.numero}
              </label>
            ))}
          </div>
        </Estado>
        <div className="fila-botones">
          <button className="btn" disabled={a.ocupado || !elegidas.size} onClick={() => void generar(false)}>Generar para {elegidas.size || '…'} casa{elegidas.size === 1 ? '' : 's'}</button>
          <button className="btn btn-sec" disabled={a.ocupado} onClick={() => void generar(true)}>Para todas las casas</button>
        </div>
        {a.error && <div className="aviso aviso-error">{a.error}</div>}
      </Tarjeta>

      {nuevos.length > 0 && (
        <Tarjeta titulo={`Códigos nuevos (${nuevos.length})`} className="imprimible">
          <ListaCodigos lista={nuevos} condominio={condominio} copiar={copiar} />
          <div className="fila-botones no-imprimir">
            <button className="btn btn-sec" onClick={() => window.print()}>Imprimir</button>
            <button className="btn btn-sec" onClick={() => descargarCsv(nuevos)}>Descargar lista (Excel/CSV)</button>
          </div>
        </Tarjeta>
      )}

      <Tarjeta titulo="Códigos vigentes">
        <Estado cargando={codigos.cargando} error={codigos.error}>
          {vigentes.length ? <ListaCodigos lista={vigentes} condominio={condominio} copiar={copiar} /> : <Vacio>No hay códigos vigentes.</Vacio>}
        </Estado>
      </Tarjeta>
    </>
  );
}

function ListaCodigos({ lista, condominio, copiar }: { lista: CodigoAcceso[]; condominio: string; copiar: (k: CodigoAcceso) => void }) {
  return (
    <ul className="lista lista-admin codigos">
      {lista.map((k) => (
        <li key={k.codigo}>
          <div>
            <strong>{k.unidad ?? 'Junta'}</strong>
            <code className="codigo-grande">{k.codigo}</code>
            <small>{nombreRol(k.rol)} · usado {k.usos}/{k.usosMax} · vence {fecha(k.expiraEn)}{k.requiereAprobacion ? '' : ' · entra sin aprobación'}</small>
          </div>
          <div className="fila-botones no-imprimir">
            <a className="btn btn-sec" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(mensajeCodigo(k, condominio))}`}>WhatsApp</a>
            <button className="btn-texto" onClick={() => copiar(k)}>Copiar</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Miembros() {
  const s = api.sesion()!;
  const m = useCarga(() => api.miembros());
  const a = useAccion(m.recargar);
  const puedeEditar = ['presidente', 'administrador'].includes(s.rol);
  const [filtro, setFiltro] = useState<'junta' | 'residentes'>('junta');
  const lista = (m.datos ?? []).filter((x) => (filtro === 'junta') === ['presidente', 'tesorero', 'vocal', 'administrador'].includes(x.rol));
  return (
    <Tarjeta titulo="Miembros">
      <div className="chips">
        <button className={`chip ${filtro === 'junta' ? 'chip-activo' : ''}`} onClick={() => setFiltro('junta')}>Junta</button>
        <button className={`chip ${filtro === 'residentes' ? 'chip-activo' : ''}`} onClick={() => setFiltro('residentes')}>Residentes</button>
      </div>
      <Estado cargando={m.cargando} error={m.error}>
        {lista.length ? (
          <ul className="lista lista-admin">
            {lista.map((x) => (
              <li key={`${x.usuarioId}-${x.rol}-${x.unidadId}`} className={x.activo ? '' : 'inactivo'}>
                <div>
                  <strong>{x.nombre}{x.usuarioId === s.usuarioId ? ' (usted)' : ''}</strong>
                  <small>{x.unidad ?? 'Sin casa asignada'} · desde {fecha(x.altaEn)}</small>
                </div>
                {puedeEditar && x.usuarioId !== s.usuarioId ? (
                  <div className="fila-botones">
                    <select value={x.rol} disabled={a.ocupado} onChange={(e) => void a.hacer(() => api.cambiarMiembro(x.usuarioId, { rol: e.target.value as Rol }), 'Rol actualizado.')}>
                      {ROLES.filter((r) => x.unidadId ? true : !['propietario', 'inquilino'].includes(r.v)).map((r) => <option key={r.v} value={r.v}>{r.t}</option>)}
                    </select>
                    <button className="btn-texto" disabled={a.ocupado} onClick={() => void a.hacer(() => api.cambiarMiembro(x.usuarioId, { activo: !x.activo }), x.activo ? 'Acceso retirado.' : 'Acceso devuelto.')}>
                      {x.activo ? 'Quitar acceso' : 'Devolver acceso'}
                    </button>
                  </div>
                ) : <Etiqueta tono={x.activo ? 'info' : 'neutro'}>{x.activo ? nombreRol(x.rol) : 'Sin acceso'}</Etiqueta>}
              </li>
            ))}
          </ul>
        ) : <Vacio>Nadie en esta lista.</Vacio>}
      </Estado>
      {a.ok && <div className="aviso aviso-ok">{a.ok}</div>}
      {a.error && <div className="aviso aviso-error">{a.error}</div>}
    </Tarjeta>
  );
}

// ============================ Conciliación bancaria ============================
export function Conciliacion() {
  const cuentas = useCarga(() => api.cuentasFinancieras());
  const pendientes = useCarga(() => api.movimientosBancarios(true));
  const unidades = useCarga(() => api.unidadesConSaldo());
  const [cuentaId, setCuentaId] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [tabla, setTabla] = useState<TablaCruda | null>(null);
  const [col, setCol] = useState<Columnas | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [asignar, setAsignar] = useState<Record<string, string>>({});
  const a = useAccion();
  const cuentasBanco = (cuentas.datos ?? []).filter((c) => c.tipo !== 'caja' && c.tipo !== 'fondo_reserva');
  const cuenta = cuentasBanco.find((c) => c.id === (cuentaId || cuentasBanco[0]?.id));
  const vista = useMemo(() => (tabla && col ? aMovimientos(tabla, col) : null), [tabla, col]);
  const creditos = vista?.movimientos.filter((m) => m.monto > 0) ?? [];
  const encabezados = tabla && col ? (tabla.filas[col.encabezado] ?? []).map((c, i) => `${String.fromCharCode(65 + i)} · ${c ?? ''}`) : [];

  async function elegirArchivo(f: File | null) {
    setArchivo(f); setTabla(null); setCol(null); setResultado(null);
    if (!f) return;
    await a.hacer(async () => {
      const t = await leerArchivo(f);
      if (t.filas.length < 2) throw new Error('El archivo no tiene movimientos.');
      setTabla(t); setCol(adivinarColumnas(t));
    });
  }
  async function subir() {
    if (!cuenta || !archivo || !vista) return;
    await a.hacer(async () => {
      const r = await api.cargarExtracto(cuenta.id, archivo.name, vista.movimientos);
      setResultado(`${r.cargados} movimientos cargados · ${r.conciliados} pagos confirmados automáticamente · ${r.duplicados} ya estaban cargados`);
      setTabla(null); setCol(null); setArchivo(null);
      pendientes.recargar();
    });
  }
  const sel = (k: keyof Columnas, permitirNinguna = false) => col && (
    <select value={col[k] ?? -1} onChange={(e) => setCol({ ...col, [k]: Number(e.target.value) < 0 ? null : Number(e.target.value) })}>
      {permitirNinguna && <option value={-1}>(ninguna)</option>}
      {encabezados.map((h, i) => <option key={i} value={i}>{h}</option>)}
    </select>
  );

  return (
    <>
      <Tarjeta titulo="1 · Subir el movimiento del banco">
        <p className="nota">Descargue de su banca en línea el movimiento de la cuenta (Excel .xlsx o CSV). La app cruza cada crédito con los pagos reportados
          por referencia, monto y fecha, y confirma solos los que coinciden.</p>
        <Estado cargando={cuentas.cargando} error={cuentas.error}>
          <Campo etiqueta="Cuenta del condominio">
            <select value={cuenta?.id ?? ''} onChange={(e) => setCuentaId(e.target.value)}>
              {cuentasBanco.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.moneda === 'VES' ? 'Bs' : '$'})</option>)}
            </select>
          </Campo>
        </Estado>
        <Campo etiqueta="Archivo del banco">
          <input type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                 onChange={(e) => void elegirArchivo(e.target.files?.[0] ?? null)} />
        </Campo>
      </Tarjeta>

      {tabla && col && vista && (
        <Tarjeta titulo="2 · Confirmar columnas">
          <p className="nota">Revisamos el archivo y adivinamos las columnas. Corrija si alguna no es la correcta.</p>
          <div className="dos-col">
            <Campo etiqueta="Fila de títulos">
              <select value={col.encabezado} onChange={(e) => setCol({ ...adivinarColumnas({ filas: tabla.filas.slice(Number(e.target.value)) }), encabezado: Number(e.target.value) })}>
                {tabla.filas.slice(0, 15).map((f, i) => <option key={i} value={i}>Fila {i + 1}: {f.filter(Boolean).slice(0, 3).join(' · ').slice(0, 40)}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Fecha">{sel('fecha')}</Campo>
            <Campo etiqueta="Referencia">{sel('referencia')}</Campo>
            <Campo etiqueta="Monto (crédito)">{sel('monto')}</Campo>
            <Campo etiqueta="Descripción">{sel('descripcion', true)}</Campo>
          </div>
          <div className="cifras">
            <Cifra etiqueta="Créditos (entradas)" valor={String(creditos.length)} nota={cuenta?.moneda === 'VES' ? bs(creditos.reduce((s, m) => s + m.monto, 0)) : usd(creditos.reduce((s, m) => s + m.monto, 0))} />
            <Cifra etiqueta="Filas descartadas" valor={String(vista.descartadas)} nota="sin fecha o sin monto" />
          </div>
          {creditos.length > 0 && (
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Referencia</th><th className="num">Monto</th></tr></thead>
              <tbody>
                {creditos.slice(0, 6).map((m, i) => (
                  <tr key={i}><td>{fecha(m.fecha)}<small>{m.descripcion}</small></td><td>{m.referencia || '—'}</td>
                    <td className="num">{cuenta?.moneda === 'VES' ? bs(m.monto) : usd(m.monto)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {creditos.length > 6 && <p className="nota">… y {creditos.length - 6} más.</p>}
          <button className="btn btn-ancho" disabled={a.ocupado || !vista.movimientos.length} onClick={() => void subir()}>
            {a.ocupado ? 'Conciliando…' : `Subir ${vista.movimientos.length} movimientos y conciliar`}
          </button>
        </Tarjeta>
      )}
      {resultado && <div className="aviso aviso-ok">{resultado}</div>}
      {a.error && <div className="aviso aviso-error">{a.error}</div>}

      <Tarjeta titulo="Dinero que entró sin aviso">
        <p className="nota">Créditos del banco que no coinciden con ningún pago reportado. Asígnelos a la casa que pagó.</p>
        <Estado cargando={pendientes.cargando} error={pendientes.error}>
          {pendientes.datos?.length ? (
            <ul className="lista lista-admin">
              {pendientes.datos.map((m) => (
                <li key={m.id}>
                  <div>
                    <strong>{m.moneda === 'VES' ? bs(m.monto) : usd(m.monto)}</strong>
                    <small>{fecha(m.fecha)} · Ref. {m.referencia ?? '—'} · {m.cuenta}</small>
                    {m.descripcion && <small>{m.descripcion}</small>}
                  </div>
                  <div className="fila-botones">
                    <select value={asignar[m.id] ?? ''} onChange={(e) => setAsignar({ ...asignar, [m.id]: e.target.value })}>
                      <option value="">Casa…</option>
                      {unidades.datos?.map((u) => <option key={u.id} value={u.id}>{u.bloque ? `${u.bloque}-` : ''}{u.numero} · {u.propietario}</option>)}
                    </select>
                    <button className="btn" disabled={!asignar[m.id] || a.ocupado}
                            onClick={() => void a.hacer(async () => { await api.asignarMovimiento(m.id, asignar[m.id]); pendientes.recargar(); }, 'Pago asignado y confirmado.')}>
                      Asignar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Vacio>Todo el dinero recibido está conciliado.</Vacio>}
        </Estado>
        {a.ok && <div className="aviso aviso-ok">{a.ok}</div>}
      </Tarjeta>
    </>
  );
}

// ============================ Factura de ZentaPro ============================
export function FacturaZentaPro() {
  const facturas = useCarga(() => api.facturasZentaPro());
  const datos = useCarga(() => api.datosPagoZentaPro());
  const abierta = facturas.datos?.find((f) => f.estado === 'emitida' || f.estado === 'vencida');
  const [metodo, setMetodo] = useState<'pago_movil' | 'transferencia'>('pago_movil');
  const [monto, setMonto] = useState('');
  const [referencia, setReferencia] = useState('');
  const [fechaPago, setFechaPago] = useState(hoyLocal());
  const [enviado, setEnviado] = useState(false);
  const a = useAccion();
  const sugerido = abierta ? (abierta.saldoVesHoy ?? abierta.montoVes) : 0;

  async function reportar() {
    if (!abierta) return;
    const m = monto.trim() ? leerMontoVe(monto) : sugerido;
    if (!(m > 0)) { a.setError('Indique el monto en bolívares'); return; }
    await a.hacer(async () => {
      await api.reportarPagoZentaPro(abierta.id, { metodo, montoVes: m, referencia: referencia.trim(), fechaPago });
      setEnviado(true); setReferencia(''); setMonto('');
      facturas.recargar();
    });
  }

  const parcial = abierta && abierta.abonadoUsd > 0.009;
  return (
    <>
      <Estado cargando={facturas.cargando} error={facturas.error}>
        {abierta ? (
          <Tarjeta titulo={`Mensualidad de ${mes(abierta.periodo)}`} className={abierta.estado === 'vencida' ? 'tarjeta-deuda' : ''}>
            <div className="saldo">
              <span>Mensualidad {usd(abierta.montoUsd)}{abierta.plan ? ` (plan ${abierta.plan})` : ''}</span>
              <strong>{bs(sugerido)}</strong>
              <span>
                A pagar hoy{parcial ? ` (saldo ${usd(abierta.saldoUsd)})` : ''}
                {abierta.tasaHoy ? ` a la tasa BCV de hoy (${abierta.tasaHoy.toLocaleString('es-VE')})` : ''}
              </span>
              <span>Vence el {fecha(abierta.vence)}{abierta.estado === 'vencida' && ' · VENCIDA'}</span>
            </div>
            {parcial && (
              <div className="cifras">
                <Cifra etiqueta="Abonado" valor={usd(abierta.abonadoUsd)} tono="ok" />
                <Cifra etiqueta="Saldo" valor={usd(abierta.saldoUsd)} tono="alerta" />
              </div>
            )}
            <p className="nota">ZentaPro cobra solo en bolívares, a la tasa BCV del día del pago. La factura se expresa en dólares
              (referencia en Bs al emitirla: {bs(abierta.montoVes)} a {abierta.tasaBcv.toLocaleString('es-VE')}).</p>
            {abierta.pagoPorConfirmar && <div className="aviso aviso-ok">Pago reportado. ZentaPro lo confirmará al verlo en el banco.</div>}
            {abierta.estado === 'vencida' && !abierta.pagoPorConfirmar && <div className="aviso aviso-error">Si pasan 10 días de vencida, la app queda en solo lectura para la junta hasta que se pague. Los residentes pueden seguir reportando sus pagos.</div>}
          </Tarjeta>
        ) : <div className="aviso aviso-ok">Está al día con ZentaPro. ¡Gracias!</div>}
      </Estado>

      {abierta && (
        <Tarjeta titulo="Pagar en bolívares">
          <Estado cargando={datos.cargando} error={datos.error}>
            {datos.datos && (
              <div className="datos-pago">
                <strong>{datos.datos.titular}</strong>
                <span>{datos.datos.banco} · RIF {datos.datos.rif}</span>
                <span>Pago Móvil: {datos.datos.telefonoPagoMovil}</span>
                <span>Cuenta: {datos.datos.cuenta}</span>
              </div>
            )}
          </Estado>
          {enviado ? (
            <>
              <div className="aviso aviso-ok">Pago reportado. ZentaPro lo confirmará al verlo en el banco.</div>
              <button className="btn-texto" onClick={() => setEnviado(false)}>Reportar otro abono</button>
            </>
          ) : (
            <div className="formulario">
              <div className="chips">
                {(['pago_movil', 'transferencia'] as const).map((m) => (
                  <button key={m} type="button" className={`chip ${metodo === m ? 'chip-activo' : ''}`} onClick={() => setMetodo(m)}>{METODOS[m]}</button>
                ))}
              </div>
              <div className="dos-col">
                <Campo etiqueta="Monto en Bs" ayuda={`Hoy: ${bs(sugerido)}`}>
                  <input inputMode="decimal" value={monto} placeholder={sugerido.toLocaleString('es-VE', { minimumFractionDigits: 2 })} onChange={(e) => setMonto(e.target.value)} />
                </Campo>
                <Campo etiqueta="Referencia"><input inputMode="numeric" value={referencia} onChange={(e) => setReferencia(e.target.value)} required /></Campo>
              </div>
              <Campo etiqueta="Fecha del pago" ayuda="Se convierte a dólares con la tasa BCV de ese día">
                <input type="date" value={fechaPago} max={hoyLocal()} onChange={(e) => setFechaPago(e.target.value)} />
              </Campo>
              <button className="btn btn-ancho" disabled={a.ocupado || referencia.trim().length < 3} onClick={() => void reportar()}>Reportar pago a ZentaPro</button>
              <p className="nota">Solo bolívares (Pago Móvil o transferencia). Puede pagar en varios abonos.</p>
            </div>
          )}
          {a.error && <div className="aviso aviso-error">{a.error}</div>}
        </Tarjeta>
      )}

      <Tarjeta titulo="Historial">
        <Estado cargando={facturas.cargando} error={facturas.error}>
          <table className="tabla">
            <tbody>
              {facturas.datos?.map((f) => (
                <tr key={f.id}>
                  <td>{mes(f.periodo)}<small>{f.numeroControl ? `N.º de control ${f.numeroControl}` : 'Número de control pendiente'}</small></td>
                  <td className="num">{usd(f.montoUsd)}<small>{f.estado === 'pagada' ? `ref. ${bs(f.montoVes)}` : f.abonadoUsd > 0.009 ? `abonado ${usd(f.abonadoUsd)}` : `ref. ${bs(f.montoVes)}`}</small></td>
                  <td className="num"><Etiqueta tono={f.estado === 'pagada' ? 'ok' : f.estado === 'vencida' ? 'error' : f.estado === 'anulada' ? 'neutro' : 'alerta'}>{f.estado}</Etiqueta></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Tarjeta>
    </>
  );
}

// ============================ Avisos ============================
export function AdminAvisos() {
  const avisos = useCarga(() => api.avisos());
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [fijado, setFijado] = useState(false);
  const a = useAccion(avisos.recargar);
  return (
    <>
      <Tarjeta titulo="Nuevo aviso">
        <form className="formulario" onSubmit={(e) => {
          e.preventDefault();
          void a.hacer(async () => { await api.crearAviso({ titulo, cuerpo, fijado }); setTitulo(''); setCuerpo(''); setFijado(false); }, 'Aviso publicado. Lo ven todos los residentes en Inicio.');
        }}>
          <Campo etiqueta="Título"><input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={120} placeholder="Ej.: Corte de agua el sábado" /></Campo>
          <Campo etiqueta="Texto"><textarea rows={4} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} required /></Campo>
          <label className="interruptor">
            <input type="checkbox" checked={fijado} onChange={(e) => setFijado(e.target.checked)} />
            <span><strong>Fijar arriba</strong><small>Queda de primero hasta que lo borre.</small></span>
          </label>
          <button className="btn" disabled={a.ocupado}>Publicar aviso</button>
        </form>
        {a.ok && <div className="aviso aviso-ok">{a.ok}</div>}
        {a.error && <div className="aviso aviso-error">{a.error}</div>}
      </Tarjeta>
      <Tarjeta titulo="Publicados">
        <Estado cargando={avisos.cargando} error={avisos.error}>
          {avisos.datos?.length ? avisos.datos.map((x) => (
            <article key={x.id} className="aviso-item">
              <h3>{x.fijado && <Etiqueta tono="alerta">Fijado</Etiqueta>} {x.titulo}</h3>
              <p>{x.cuerpo}</p>
              <div className="fila-botones">
                <small className="meta">{fecha(x.creadoEn)}</small>
                <button className="btn-texto" disabled={a.ocupado} onClick={() => void a.hacer(() => api.borrarAviso(x.id), 'Aviso borrado.')}>Borrar</button>
              </div>
            </article>
          )) : <Vacio>No hay avisos.</Vacio>}
        </Estado>
      </Tarjeta>
    </>
  );
}

// ============================ Tasa BCV ============================
export function TasaBcv() {
  const s = api.sesion()!;
  const tasa = useCarga(() => api.tasaBcv());
  const [valor, setValor] = useState('');
  const a = useAccion(tasa.recargar);
  return (
    <>
      <Estado cargando={tasa.cargando} error={tasa.error}>
        <div className="cifras">
          <Cifra etiqueta="Tasa BCV vigente" valor={tasa.datos ? `${tasa.datos.usdVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs/$` : 'Sin cargar'}
                 nota={tasa.datos ? `del ${fecha(tasa.datos.fecha)}` : undefined} />
        </div>
      </Estado>
      <Tarjeta titulo="Cargar la tasa a mano">
        <p className="nota">El servidor toma la tasa oficial del BCV dos veces al día. Úselo solo si la página del BCV no respondió.</p>
        {s.manejaFinanzas ? (
          <form className="formulario" onSubmit={(e) => {
            e.preventDefault();
            const n = Number(valor.replace(/\./g, '').replace(',', '.'));
            void a.hacer(async () => { if (!(n > 0)) throw new Error('Escriba una tasa válida, p. ej. 215,50'); await api.fijarTasaBcv(n); setValor(''); }, 'Tasa guardada.');
          }}>
            <Campo etiqueta="Bolívares por dólar (BCV de hoy)"><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="215,50" required /></Campo>
            <button className="btn" disabled={a.ocupado}>Guardar tasa</button>
          </form>
        ) : <p className="nota">Solo presidencia, tesorería o la administración pueden cargarla.</p>}
        {a.ok && <div className="aviso aviso-ok">{a.ok}</div>}
        {a.error && <div className="aviso aviso-error">{a.error}</div>}
      </Tarjeta>
    </>
  );
}

// ============================ Chat entre vecinos ============================
/** La junta decide si las casas pueden escribirse entre sí (presidencia o administración). */
export function ChatVecinos() {
  const s = api.sesion()!;
  const condo = useCarga(() => api.condominio());
  const puede = ['presidente', 'administrador'].includes(s.rol);
  const a = useAccion(() => condo.recargar());
  const activo = !!condo.datos?.chatVecinos;
  return (
    <Estado cargando={condo.cargando} error={condo.error}>
      <Tarjeta titulo="Chat entre vecinos">
        <label className="interruptor">
          <input type="checkbox" checked={activo} disabled={!puede || a.ocupado}
                 onChange={(e) => void a.hacer(() => api.fijarChatVecinos(e.target.checked),
                   e.target.checked ? 'Chat entre vecinos activado. Se avisó a todos los residentes.' : 'Chat entre vecinos desactivado. Se avisó a todos los residentes.')} />
          <span><strong>Permitir chat entre vecinos</strong>
            <small>{activo ? 'Encendido: cada casa puede escribirle a otra desde el directorio (con su nombre y su casa, no es anónimo).'
                           : 'Apagado: las casas no pueden escribirse entre sí.'}</small></span>
        </label>
        {!puede && <p className="nota">Solo la presidencia o la administración pueden cambiar esta opción.</p>}
        {a.ok && <div className="aviso aviso-ok">{a.ok}</div>}
        {a.error && <div className="aviso aviso-error">{a.error}</div>}
      </Tarjeta>
      <Tarjeta titulo="Qué cambia">
        <ul className="lista-simple">
          <li><strong>Apagado:</strong> nadie abre chats nuevos entre casas y los que existían quedan de solo lectura (no se borra nada).</li>
          <li>El chat de cada casa con la junta, los grupos y el canal de avisos siguen funcionando igual.</li>
          <li>Las quejas anónimas siguen por <em>Reportes</em>.</li>
          <li>Cada cambio queda registrado en la bitácora y se avisa a todos los miembros.</li>
        </ul>
      </Tarjeta>
    </Estado>
  );
}
