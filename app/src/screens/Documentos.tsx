// Descarga de documentos con la marca del condominio (PDF y Excel).
// Las plantillas (src/documentos) se cargan solo al usarlas, para no engordar el arranque de la app.
import { useState } from 'react';
import { api, type Marca, type TipoDocumento, type UnidadConSaldo } from '../data';
import { Campo, Estado, Etiqueta, Tarjeta, Vacio, useCarga } from '../components/ui';
import { mes, mesAnterior, mesSiguiente, periodoActual, usd } from '../formato';
import '../documentos/documentos.css';

const cargarPlantillas = () => import('../documentos');
type Plantillas = Awaited<ReturnType<typeof cargarPlantillas>>;

/** Marca del condominio; si aún no está configurada, se arma con los datos básicos. */
async function marcaDoc(p: Plantillas) {
  let m: Marca;
  try { m = await api.marca(); } catch {
    const c = await api.condominio();
    const demo = api.modo === 'demo';
    m = {
      nombre: c.nombre, nombreAsociacion: null, rif: c.rif, direccion: c.direccion, ciudad: null, telefono: null, correo: null,
      colorPrimario: '#0f4c4a', logoUrl: demo ? 'demo/logo.png' : null, fotoEntradaUrl: demo ? 'demo/entrada.jpg' : null,
    };
  }
  return p.prepararMarca(m);
}

/** Registra el documento para obtener su código QR. Si falla, se genera igual pero sin código. */
async function registrar(tipo: TipoDocumento, formato: 'pdf' | 'xlsx', extra: { unidadId?: string; periodo?: string; votacionId?: string } = {}) {
  try { return { codigo: await api.registrarDocumento({ tipo, formato, ...extra }), aviso: null }; }
  catch (e) { return { codigo: null, aviso: `Se generó sin código de verificación (${(e as Error).message}).` }; }
}

async function tasa() { try { return (await api.tasaBcv())?.usdVes ?? null; } catch { return null; } }

/** Botón que genera y descarga un documento, con su propio estado de "generando…". */
function BotonDoc({ texto, formato, hacer, deshabilitado }: {
  texto: string; formato: 'PDF' | 'Excel'; hacer: () => Promise<string | null | void>; deshabilitado?: boolean;
}) {
  const [estado, setEstado] = useState<{ ocupado: boolean; msg: string | null; error: boolean }>({ ocupado: false, msg: null, error: false });
  async function clic() {
    setEstado({ ocupado: true, msg: null, error: false });
    try {
      const aviso = await hacer();
      setEstado({ ocupado: false, msg: aviso || 'Listo. Revise sus descargas.', error: false });
    } catch (e) { setEstado({ ocupado: false, msg: (e as Error).message, error: true }); }
  }
  return (
    <div className="doc-boton">
      <button className={`btn ${formato === 'Excel' ? 'btn-sec' : ''}`} onClick={clic} disabled={estado.ocupado || deshabilitado}>
        <span className={`doc-formato doc-${formato.toLowerCase()}`}>{formato}</span>
        {estado.ocupado ? 'Generando…' : texto}
      </button>
      {estado.msg && <small className={estado.error ? 'txt-error' : 'doc-ok'}>{estado.msg}</small>}
    </div>
  );
}

// =====================================================================
// Residente
// =====================================================================
export function DocumentosResidente() {
  const unidadId = api.sesion()!.unidadId!;
  const { datos: e, cargando, error, recargar } = useCarga(() => api.estadoCuenta(unidadId));
  const periodos = [...new Set((e?.cargos ?? []).map((c) => c.periodo))].sort().reverse();
  const [periodo, setPeriodo] = useState<string | null>(null);
  const per = periodo ?? periodos[0] ?? null;
  const etq = e ? `${e.unidad.bloque ? e.unidad.bloque + '-' : ''}${e.unidad.numero}` : '';

  async function estadoCuenta(formato: 'pdf' | 'xlsx') {
    const p = await cargarPlantillas();
    const [marca, t, ec] = await Promise.all([marcaDoc(p), tasa(), api.estadoCuenta(unidadId)]);
    const { codigo, aviso } = await registrar('estado_cuenta', formato, { unidadId });
    const bytes = formato === 'pdf' ? await p.estadoCuentaPdf(marca, ec, { codigo, tasaBcv: t }) : await p.estadoCuentaXlsx(marca, ec, { codigo, tasaBcv: t });
    await p.descargar(bytes, `Estado de cuenta ${etq}.${formato}`, p.MIME[formato]);
    return aviso;
  }
  async function recibo() {
    if (!per) return;
    const p = await cargarPlantillas();
    const [marca, t, ec, cuentas] = await Promise.all([marcaDoc(p), tasa(), api.estadoCuenta(unidadId), api.cuentasDePago().catch(() => [])]);
    const { codigo, aviso } = await registrar('recibo', 'pdf', { unidadId, periodo: per });
    const bytes = await p.reciboPdf(marca, ec, per, { codigo, tasaBcv: t, cuentas });
    await p.descargar(bytes, `Recibo ${etq} ${per.slice(0, 7)}.pdf`, p.MIME.pdf);
    return aviso;
  }
  async function solvencia() {
    const p = await cargarPlantillas();
    const codigo = await api.emitirSolvencia(unidadId);   // falla con mensaje claro si hay deuda
    const [marca, ec] = await Promise.all([marcaDoc(p), api.estadoCuenta(unidadId)]);
    const hoy = new Date();
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    const bytes = await p.solvenciaPdf(marca, { unidad: ec.unidad, codigo, vigenteHasta: fin.toISOString().slice(0, 10) });
    await p.descargar(bytes, `Solvencia ${etq}.pdf`, p.MIME.pdf);
    recargar();
  }

  return (
    <Estado cargando={cargando} error={error}>
      {e && (
        <>
          <Tarjeta titulo="Estado de cuenta" accion={<Etiqueta tono={e.saldoUsd > 0.009 ? 'error' : 'ok'}>{e.saldoUsd > 0.009 ? `Debe ${usd(e.saldoUsd)}` : 'Al día'}</Etiqueta>}>
            <p className="nota">Con el nombre y la marca del condominio. El Excel se abre en Google Sheets, Excel o LibreOffice.</p>
            <div className="doc-fila">
              <BotonDoc texto="Estado de cuenta" formato="PDF" hacer={() => estadoCuenta('pdf')} />
              <BotonDoc texto="Estado de cuenta" formato="Excel" hacer={() => estadoCuenta('xlsx')} />
            </div>
          </Tarjeta>
          <Tarjeta titulo="Recibo del mes">
            {periodos.length ? (
              <>
                <Campo etiqueta="Mes">
                  <select value={per ?? ''} onChange={(ev) => setPeriodo(ev.target.value)}>
                    {periodos.map((x) => <option key={x} value={x}>{mes(x)}</option>)}
                  </select>
                </Campo>
                <BotonDoc texto={`Recibo de ${per ? mes(per) : ''}`} formato="PDF" hacer={recibo} />
              </>
            ) : <Vacio>Aún no hay recibos emitidos.</Vacio>}
          </Tarjeta>
          <Tarjeta titulo="Constancia de solvencia">
            <p className="nota">Lleva un código QR para que cualquiera (banco, notaría, comprador) verifique que es auténtica. Vence a fin de mes.</p>
            <BotonDoc texto="Solicitar solvencia" formato="PDF" hacer={solvencia} deshabilitado={e.saldoUsd > 0.009} />
            {e.saldoUsd > 0.009 && <small className="nota">Disponible cuando su saldo esté en cero.</small>}
          </Tarjeta>
        </>
      )}
    </Estado>
  );
}

// =====================================================================
// Presidencia
// =====================================================================
export function DocumentosPresidencia() {
  const [periodo, setPeriodo] = useState(periodoActual());
  const unidades = useCarga(() => api.unidadesConSaldo());
  const partidas = useCarga(() => api.partidas());
  const [unidadSel, setUnidadSel] = useState('');
  const cerradas = (partidas.datos ?? []).filter((p) => p.votacion && p.votacion.estado === 'cerrada');
  const enCurso = (partidas.datos ?? []).filter((p) => p.votacion && p.votacion.estado === 'abierta');
  const unidad: UnidadConSaldo | undefined = unidades.datos?.find((u) => u.id === unidadSel);
  const etq = (u: { bloque: string | null; numero: string }) => `${u.bloque ? u.bloque + '-' : ''}${u.numero}`;

  async function gastos(formato: 'pdf' | 'xlsx') {
    const p = await cargarPlantillas();
    const [marca, gs, c] = await Promise.all([marcaDoc(p), api.gastos(periodo), api.condominio()]);
    const { codigo, aviso } = await registrar('relacion_gastos', formato, { periodo });
    const bytes = formato === 'pdf'
      ? await p.relacionGastosPdf(marca, periodo, gs, { codigo, fondoReservaPct: c.fondoReservaPct })
      : await p.relacionGastosXlsx(marca, periodo, gs, { codigo });
    await p.descargar(bytes, `Relacion de gastos ${periodo.slice(0, 7)}.${formato}`, p.MIME[formato]);
    return aviso;
  }
  async function morosidad() {
    const p = await cargarPlantillas();
    const [marca, us, t] = await Promise.all([marcaDoc(p), api.unidadesConSaldo(), tasa()]);
    const { codigo, aviso } = await registrar('morosidad', 'xlsx');
    await p.descargar(await p.morosidadXlsx(marca, us, { codigo, tasaBcv: t }), `Morosidad ${new Date().toISOString().slice(0, 10)}.xlsx`, p.MIME.xlsx);
    return aviso;
  }
  async function acta(partidaId: string) {
    const p = await cargarPlantillas();
    const partida = (await api.partidas()).find((x) => x.id === partidaId)!;
    const [marca, filas] = await Promise.all([marcaDoc(p), api.datosActa(partida.votacion!.id)]);
    const { codigo, aviso } = await registrar('acta_votacion', 'pdf', { votacionId: partida.votacion!.id });
    await p.descargar(await p.actaVotacionPdf(marca, partida, filas, { codigo }), `Acta ${partida.titulo}.pdf`, p.MIME.pdf);
    return aviso;
  }
  async function estadoUnidad(formato: 'pdf' | 'xlsx') {
    if (!unidad) throw new Error('Seleccione una unidad');
    const p = await cargarPlantillas();
    const [marca, t, ec] = await Promise.all([marcaDoc(p), tasa(), api.estadoCuenta(unidad.id)]);
    const { codigo, aviso } = await registrar('estado_cuenta', formato, { unidadId: unidad.id });
    const bytes = formato === 'pdf' ? await p.estadoCuentaPdf(marca, ec, { codigo, tasaBcv: t }) : await p.estadoCuentaXlsx(marca, ec, { codigo, tasaBcv: t });
    await p.descargar(bytes, `Estado de cuenta ${etq(unidad)}.${formato}`, p.MIME[formato]);
    return aviso;
  }
  async function solvenciaUnidad() {
    if (!unidad) throw new Error('Seleccione una unidad');
    const p = await cargarPlantillas();
    const codigo = await api.emitirSolvencia(unidad.id);
    const marca = await marcaDoc(p);
    const hoy = new Date();
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().slice(0, 10);
    const s = api.sesion();
    await p.descargar(await p.solvenciaPdf(marca, { unidad, codigo, vigenteHasta: fin, firmante: s ? `${s.nombre} · Junta de Condominio` : undefined }),
      `Solvencia ${etq(unidad)}.pdf`, p.MIME.pdf);
  }

  return (
    <>
      <Tarjeta titulo="Relación de gastos">
        <div className="selector-mes">
          <button className="btn-texto" onClick={() => setPeriodo(mesAnterior(periodo))} aria-label="Mes anterior">‹</button>
          <strong>{mes(periodo)}</strong>
          <button className="btn-texto" onClick={() => setPeriodo(mesSiguiente(periodo))} aria-label="Mes siguiente">›</button>
        </div>
        <div className="doc-fila">
          <BotonDoc texto="Relación de gastos" formato="PDF" hacer={() => gastos('pdf')} />
          <BotonDoc texto="Relación de gastos" formato="Excel" hacer={() => gastos('xlsx')} />
        </div>
        <p className="nota">Para publicar en la cartelera o enviar al grupo de vecinos.</p>
      </Tarjeta>

      <Tarjeta titulo="Morosidad">
        <BotonDoc texto="Reporte de morosidad" formato="Excel" hacer={morosidad} />
      </Tarjeta>

      <Tarjeta titulo="Actas de votación" accion={enCurso.length ? <small>{enCurso.length} en curso</small> : undefined}>
        <Estado cargando={partidas.cargando} error={partidas.error}>
          {cerradas.length ? cerradas.map((p) => (
            <div key={p.id} className="doc-item">
              <div><strong>{p.titulo}</strong><small>{usd(p.presupuestoUsd)} · {p.estado === 'rechazada' ? 'Rechazada' : 'Aprobada'}</small></div>
              <BotonDoc texto="Acta para firma y sello" formato="PDF" hacer={() => acta(p.id)} />
            </div>
          )) : <Vacio>Las actas aparecen aquí cuando se cierra una votación.</Vacio>}
        </Estado>
      </Tarjeta>

      <Tarjeta titulo="Documentos de una unidad">
        <Estado cargando={unidades.cargando} error={unidades.error}>
          <Campo etiqueta="Unidad">
            <select value={unidadSel} onChange={(ev) => setUnidadSel(ev.target.value)}>
              <option value="">Seleccione…</option>
              {unidades.datos?.map((u) => (
                <option key={u.id} value={u.id}>{etq(u)} · {u.propietario ?? 'sin nombre'} · {u.saldoUsd > 0.009 ? `debe ${usd(u.saldoUsd)}` : 'al día'}</option>
              ))}
            </select>
          </Campo>
          <div className="doc-fila">
            <BotonDoc texto="Estado de cuenta" formato="PDF" hacer={() => estadoUnidad('pdf')} deshabilitado={!unidad} />
            <BotonDoc texto="Estado de cuenta" formato="Excel" hacer={() => estadoUnidad('xlsx')} deshabilitado={!unidad} />
            <BotonDoc texto="Solvencia" formato="PDF" hacer={solvenciaUnidad} deshabilitado={!unidad || unidad.saldoUsd > 0.009} />
          </div>
        </Estado>
      </Tarjeta>
    </>
  );
}
