// v0.9 · Datos para pagar: la junta (presidencia, tesorería o administración) carga a qué cuentas pagan los vecinos.
// Cada dato va por separado (para que el vecino lo copie campo por campo) y el QR de cobro del banco se sube desde una
// captura o una foto: la app lo lee y lo guarda nítido. Cada cambio se avisa a toda la junta (contra el fraude).
import { useRef, useState } from 'react';
import { api, type CuentaFinanciera, type MetodoPago, type TipoCuenta } from '../../data';
import { Campo, Estado, Tarjeta, useCarga, Vacio } from '../../components/ui';
import { DatosParaPagar, sirvePara } from '../../components/DatosParaPagar';
import { BANCOS, formatoCuenta, formatoDocumento, formatoTelefono, nombreBanco } from '../../bancos';
import { bancoDelQr, leerQrDeImagen, qrLimpio } from '../../qrFoto';
import { METODOS } from '../../formato';

const TIPOS: Record<Exclude<TipoCuenta, 'fondo_reserva'>, string> = {
  banco_bs: 'Banco en bolívares (Pago Móvil y transferencia)', banco_usd: 'Banco en dólares', zelle: 'Zelle', usdt: 'USDT', caja: 'Efectivo (caja)',
};
const METODOS_DE: Record<TipoCuenta, MetodoPago[]> = {
  banco_bs: ['pago_movil', 'transferencia'], banco_usd: ['transferencia'], zelle: ['zelle'], usdt: ['usdt'], caja: ['efectivo_usd', 'efectivo_bs'], fondo_reserva: [],
};

export function DatosPago() {
  const cuentas = useCarga(() => api.cuentasFinancieras());
  const puede = !!api.sesion()?.manejaFinanzas;
  const lista = cuentas.datos?.filter((c) => c.tipo !== 'fondo_reserva') ?? [];
  return (
    <>
      <p className="nota">Estos son los datos que ven los vecinos en <strong>Pagar</strong>: cada uno con su botón «Copiar» y, si lo sube, el QR de cobro de su banco.
        Cada cambio se avisa a toda la junta con el nombre de quien lo hizo.</p>
      {!puede && <div className="aviso aviso-info">Solo presidencia, tesorería o administración pueden cambiarlos. Usted puede revisarlos.</div>}
      <Estado cargando={cuentas.cargando} error={cuentas.error}>
        {lista.length ? lista.map((c) => <CuentaEditable key={c.id} c={c} puede={puede} alGuardar={cuentas.recargar} />)
          : <Vacio>Aún no hay cuentas para cobrar.</Vacio>}
      </Estado>
      {puede && <NuevaCuenta alCrear={cuentas.recargar} />}
    </>
  );
}

function CuentaEditable({ c, puede, alGuardar }: { c: CuentaFinanciera; puede: boolean; alGuardar: () => void }) {
  const [editando, setEditando] = useState(false);
  const metodos = METODOS_DE[c.tipo];
  const [ver, setVer] = useState<MetodoPago>(metodos[0] ?? 'pago_movil');
  const vacia = !c.datosPago && !c.qrUrl;
  return (
    <Tarjeta titulo={c.nombre} accion={puede && !editando ? <button type="button" className="btn-texto" onClick={() => setEditando(true)}>{vacia ? 'Cargar datos' : 'Editar'}</button> : undefined}>
      {editando ? (
        <FormCuenta c={c} alTerminar={(cambio) => { setEditando(false); if (cambio) alGuardar(); }} />
      ) : vacia ? (
        <p className="nota">Sin datos todavía: los vecinos no verán esta cuenta al pagar.</p>
      ) : (
        <>
          {metodos.length > 1 && (
            <div className="chips">
              {metodos.map((m) => <button key={m} type="button" className={`chip ${ver === m ? 'chip-activo' : ''}`} onClick={() => setVer(m)}>{METODOS[m]}</button>)}
            </div>
          )}
          {sirvePara(c, ver) ? <DatosParaPagar cuenta={c} metodo={ver} monto={null} />
            : <p className="nota">Faltan datos para {METODOS[ver]}: {ver === 'pago_movil' ? 'banco, teléfono y cédula o RIF' : ver === 'transferencia' ? 'número de cuenta' : 'datos'}.</p>}
        </>
      )}
      {puede && c.tipo === 'banco_bs' && !editando && <QrDelBanco c={c} alCambiar={alGuardar} />}
    </Tarjeta>
  );
}

function FormCuenta({ c, alTerminar }: { c: CuentaFinanciera; alTerminar: (cambio: boolean) => void }) {
  const esBanco = c.tipo === 'banco_bs' || c.tipo === 'banco_usd';
  const [nombre, setNombre] = useState(c.nombre);
  const [banco, setBanco] = useState(c.bancoCodigo ?? '');
  const [titular, setTitular] = useState(c.titular ?? '');
  const [documento, setDocumento] = useState(c.documento ? formatoDocumento(c.documento) : '');
  const [telefono, setTelefono] = useState(c.telefono ? formatoTelefono(c.telefono) : '');
  const [cuenta, setCuenta] = useState(c.numeroCuenta ? formatoCuenta(c.numeroCuenta) : '');
  const [correo, setCorreo] = useState(c.correo ?? '');
  const [nota, setNota] = useState(c.nota ?? '');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [quitar, setQuitar] = useState(false);

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null); setOcupado(true);
    try {
      await api.guardarCuenta(c.id, {
        nombre: nombre.trim() || c.nombre, titular, nota,
        ...(esBanco ? { bancoCodigo: banco, documento, numeroCuenta: cuenta } : {}),
        ...(c.tipo === 'banco_bs' ? { telefono } : {}),
        ...(c.tipo === 'zelle' ? { correo } : {}),
      });
      alTerminar(true);
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  async function quitarCuenta() {
    setError(null); setOcupado(true);
    try { await api.quitarCuenta(c.id); alTerminar(true); } catch (e) { setError((e as Error).message); setOcupado(false); }
  }

  return (
    <form className="formulario" onSubmit={guardar}>
      <Campo etiqueta="Nombre de la cuenta" ayuda="Así la verán los vecinos"><input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} /></Campo>
      {esBanco && (
        <Campo etiqueta="Banco">
          <select value={banco} onChange={(e) => setBanco(e.target.value)}>
            <option value="">Elija el banco…</option>
            {BANCOS.map((b) => <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>)}
          </select>
        </Campo>
      )}
      {c.tipo === 'banco_bs' && (
        <Campo etiqueta="Teléfono de Pago Móvil" ayuda="El celular afiliado al Pago Móvil del condominio">
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" placeholder="0414-1234567" />
        </Campo>
      )}
      {esBanco && (
        <>
          <Campo etiqueta="Cédula o RIF del titular" ayuda="Con la letra: V, E, J, G o P">
            <input value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="J-30123456-7" autoCapitalize="characters" />
          </Campo>
          <Campo etiqueta="Número de cuenta (para transferencias)" ayuda="20 dígitos. Opcional si solo cobran por Pago Móvil.">
            <input value={cuenta} onChange={(e) => setCuenta(e.target.value)} inputMode="numeric" placeholder={`${banco || '0000'}-0000-00-0000000000`} />
          </Campo>
        </>
      )}
      {c.tipo === 'zelle' && (
        <Campo etiqueta="Correo de Zelle"><input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} inputMode="email" /></Campo>
      )}
      {c.tipo !== 'caja' && c.tipo !== 'usdt' && (
        <Campo etiqueta="Titular"><input value={titular} onChange={(e) => setTitular(e.target.value)} placeholder="Asociación Civil Residencias…" maxLength={120} /></Campo>
      )}
      <Campo etiqueta={c.tipo === 'usdt' ? 'Dirección de la billetera y red' : c.tipo === 'caja' ? 'Cómo entregar el efectivo' : 'Nota para el vecino (opcional)'}
             ayuda={c.tipo === 'usdt' ? 'Ejemplo: TRC20 · T…' : undefined}>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} maxLength={300} />
      </Campo>
      {error && <div className="aviso aviso-error">{error}</div>}
      <div className="fila-botones">
        <button className="btn" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="btn btn-sec" disabled={ocupado} onClick={() => alTerminar(false)}>Cancelar</button>
      </div>
      {quitar ? (
        <div className="aviso aviso-error">
          ¿Quitar «{c.nombre}»? Los vecinos ya no la verán al pagar. Los pagos que ya entraron se conservan.
          <div className="fila-botones" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-peligro" disabled={ocupado} onClick={() => void quitarCuenta()}>Sí, quitarla</button>
            <button type="button" className="btn btn-sec" onClick={() => setQuitar(false)}>No</button>
          </div>
        </div>
      ) : <button type="button" className="btn-texto" onClick={() => setQuitar(true)}>Quitar esta cuenta</button>}
    </form>
  );
}

/** QR de cobro del banco: desde una captura, una foto de la galería o la cámara (p. ej. la hojita impresa). */
function QrDelBanco({ c, alCambiar }: { c: CuentaFinanciera; alCambiar: () => void }) {
  const galeria = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [listo, setListo] = useState<{ blob: Blob; url: string; banco: ReturnType<typeof bancoDelQr>; original: boolean } | null>(null);
  const [foto, setFoto] = useState<File | null>(null);   // no se pudo leer: se puede guardar tal cual
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function elegido(f: File | undefined) {
    if (!f) return;
    setError(null); setListo(null); setFoto(null); setLeyendo(true);
    try {
      const contenido = await leerQrDeImagen(f);
      if (!contenido) { setFoto(f); setError('No se encontró un QR en la imagen. Tome la foto más cerca, de frente y con buena luz, o suba la captura de la app del banco.'); return; }
      const blob = await qrLimpio(contenido);
      setListo({ blob, url: URL.createObjectURL(blob), banco: bancoDelQr(contenido), original: false });
    } catch { setFoto(f); setError('No se pudo leer la imagen.'); } finally { setLeyendo(false); }
  }
  async function guardar(blob: Blob) {
    setError(null); setOcupado(true);
    try { await api.subirQrCuenta(c.id, blob); setListo(null); setFoto(null); alCambiar(); }
    catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  async function quitar() {
    setOcupado(true);
    try { await api.quitarQrCuenta(c.id); alCambiar(); } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  const otroBanco = listo?.banco && c.bancoCodigo && listo.banco.codigo !== c.bancoCodigo;

  return (
    <div className="qr-banco">
      <strong>QR de cobro del banco</strong>
      <p className="nota">Opcional. Suba la captura del QR que genera la app de su banco («Mi QR», «Cobrar con QR»), o tómele una foto a la hoja impresa.
        La app lo lee y lo guarda nítido para que el vecino lo abra desde su banco.</p>
      {c.qrUrl && !listo && (
        <div className="qr-pago">
          <img src={c.qrUrl} alt="QR de cobro guardado" />
          <button type="button" className="btn-texto" disabled={ocupado} onClick={() => void quitar()}>Quitar el QR</button>
        </div>
      )}
      {listo ? (
        <div className="qr-pago">
          <img src={listo.url} alt="QR leído" />
          <div className="aviso aviso-ok">QR leído{listo.banco ? `: es de ${listo.banco.codigo} · ${listo.banco.nombre}` : ''}. Así lo verán los vecinos.</div>
          {otroBanco && <div className="aviso aviso-error">Ojo: la cuenta es de {nombreBanco(c.bancoCodigo)} y este QR es de {listo.banco!.nombre}. Revise que sea el QR correcto.</div>}
          <div className="fila-botones">
            <button type="button" className="btn" disabled={ocupado} onClick={() => void guardar(listo.blob)}>{ocupado ? 'Guardando…' : 'Usar este QR'}</button>
            <button type="button" className="btn btn-sec" disabled={ocupado} onClick={() => setListo(null)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="fila-botones">
          <button type="button" className="btn btn-sec" disabled={leyendo || ocupado} onClick={() => galeria.current?.click()}>{leyendo ? 'Leyendo…' : 'Subir captura o foto'}</button>
          <button type="button" className="btn btn-sec" disabled={leyendo || ocupado} onClick={() => camara.current?.click()}>Tomar foto con la cámara</button>
        </div>
      )}
      <input ref={galeria} type="file" accept="image/*" hidden onChange={(e) => { void elegido(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void elegido(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <div className="aviso aviso-error">{error}</div>}
      {foto && !listo && (
        <button type="button" className="btn-texto" disabled={ocupado} onClick={() => void guardar(foto)}>Guardar la imagen así (sin leer el QR)</button>
      )}
    </div>
  );
}

function NuevaCuenta({ alCrear }: { alCrear: () => void }) {
  const [abierta, setAbierta] = useState(false);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<Exclude<TipoCuenta, 'fondo_reserva'>>('banco_bs');
  const [error, setError] = useState<string | null>(null);
  async function crear(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    try { await api.crearCuenta(nombre.trim(), tipo); setAbierta(false); setNombre(''); alCrear(); } catch (e) { setError((e as Error).message); }
  }
  if (!abierta) return <button type="button" className="btn btn-sec btn-ancho" onClick={() => setAbierta(true)}>Agregar otra cuenta</button>;
  return (
    <Tarjeta titulo="Nueva cuenta">
      <form className="formulario" onSubmit={crear}>
        <Campo etiqueta="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Nombre" ayuda="Ejemplo: Mercantil corriente, Pago Móvil Banesco">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} minLength={2} maxLength={80} required />
        </Campo>
        {error && <div className="aviso aviso-error">{error}</div>}
        <div className="fila-botones">
          <button className="btn">Crear</button>
          <button type="button" className="btn btn-sec" onClick={() => setAbierta(false)}>Cancelar</button>
        </div>
      </form>
    </Tarjeta>
  );
}
