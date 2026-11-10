// v0.10 · Captura del comprobante: el vecino la sube (galería, cámara o pegándola) y la app lee en el teléfono
// referencia, monto, fecha y banco, y revisa que el pago haya ido a la cuenta del condominio.
import { useEffect, useRef, useState } from 'react';
import type { CuentaFinanciera } from '../data';
import { bs, fecha, usd } from '../formato';
import { formatoCuenta, formatoDocumento, formatoTelefono, nombreBanco } from '../bancos';
import { comprobarDestino, type LecturaComprobante } from '../comprobante/interpretar';
import { cerrarLector, leerComprobante } from '../comprobante/leer';

export function CapturaComprobante({ archivo, alElegir, alLeer, moneda }: {
  archivo: File | null; alElegir: (f: File | null) => void; alLeer: (l: LecturaComprobante | null) => void; moneda: 'VES' | 'USD';
}) {
  const galeria = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const ultimo = useRef(0);

  async function elegir(f: File | null | undefined) {
    if (!f) return;
    alElegir(f); setError(null); alLeer(null);
    setVista((v) => { if (v) URL.revokeObjectURL(v); return f.type.startsWith('image/') ? URL.createObjectURL(f) : null; });
    if (!f.type.startsWith('image/')) return;
    const yo = ++ultimo.current;
    setLeyendo(0);
    try {
      const l = await leerComprobante(f, (p) => { if (yo === ultimo.current) setLeyendo(p); });
      if (yo !== ultimo.current) return;
      if (!l.referencia && l.monto == null) setError('No pudimos leer los datos de esta imagen. Escríbalos abajo (o pruebe con la captura de pantalla en vez de una foto).');
      alLeer(l);
    } catch (e) {
      if (yo === ultimo.current) setError((e as Error).message || 'No se pudo leer la imagen. Escriba los datos abajo.');
    } finally { if (yo === ultimo.current) setLeyendo(null); }
  }

  // Pegar la captura (Ctrl+V o "Pegar" del teclado del teléfono, si lo permite).
  useEffect(() => {
    const alPegar = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); void elegir(f); }
    };
    window.addEventListener('paste', alPegar);
    return () => { window.removeEventListener('paste', alPegar); void cerrarLector(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista); }, [vista]);

  return (
    <div className="captura-comprobante">
      <strong>1. Suba la captura del pago</strong>
      <p className="nota">La app lee la referencia, el monto, la fecha y el banco, y llena los datos por usted. La imagen se lee en su teléfono.</p>
      <div className="fila-botones">
        <button type="button" className="btn btn-sec" onClick={() => galeria.current?.click()}>{archivo ? 'Cambiar captura' : 'Elegir captura'}</button>
        <button type="button" className="btn btn-sec" onClick={() => camara.current?.click()}>Tomar foto</button>
      </div>
      <input ref={galeria} type="file" accept="image/*,application/pdf" hidden aria-label="Elegir captura del comprobante"
             onChange={(e) => { void elegir(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={camara} type="file" accept="image/*" capture="environment" hidden aria-label="Tomar foto del comprobante"
             onChange={(e) => { void elegir(e.target.files?.[0]); e.target.value = ''; }} />
      {archivo && (
        <div className="captura-fila">
          {vista ? <img src={vista} alt="Captura del comprobante" /> : <span className="captura-pdf">PDF</span>}
          <span>{archivo.name || 'captura'}{leyendo != null && <small>Leyendo el comprobante… {Math.round(leyendo * 100)} %</small>}</span>
          <button type="button" className="btn-texto" onClick={() => { ultimo.current++; alElegir(null); alLeer(null); setVista(null); setError(null); setLeyendo(null); }}>Quitar</button>
        </div>
      )}
      {error && <div className="aviso aviso-alerta">{error}</div>}
      {moneda === 'USD' && !archivo && <p className="nota">Con Zelle o efectivo también puede subir la captura o la foto del recibo.</p>}
    </div>
  );
}

const lista = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

/** Resumen de lo leído y si el pago fue a la cuenta del condominio. */
export function ResumenLectura({ l, cuenta, moneda }: { l: LecturaComprobante; cuenta: CuentaFinanciera | undefined; moneda: 'VES' | 'USD' }) {
  const d = cuenta ? comprobarDestino(l, cuenta) : { coincide: [], distinto: [] };
  const datos = [
    l.referencia && `Referencia ${l.referencia}`,
    l.monto != null && `Monto ${moneda === 'USD' ? usd(l.monto) : bs(l.monto)}`,
    l.fecha && `Fecha ${fecha(l.fecha)}`,
    l.bancoOrigen && `Desde ${nombreBanco(l.bancoOrigen)}`,
  ].filter(Boolean) as string[];
  if (!datos.length) return null;
  const vio = (que: string) => que === 'teléfono' ? l.telefonos.map(formatoTelefono).join(', ')
    : que === 'número de cuenta' ? l.cuentas.map(formatoCuenta).join(', ')
    : que === 'banco' ? nombreBanco(l.bancoDestino)
    : l.documentos.map(formatoDocumento).join(', ');
  const delCondominio = (que: string) => !cuenta ? '' : que === 'teléfono' ? formatoTelefono(cuenta.telefono ?? '')
    : que === 'número de cuenta' ? formatoCuenta(cuenta.numeroCuenta ?? '') : que === 'banco' ? nombreBanco(cuenta.bancoCodigo)
    : formatoDocumento(cuenta.documento ?? '');
  return (
    <div className="lectura">
      <div className="aviso aviso-ok">Leímos su comprobante: {datos.join(' · ')}. <strong>Revise los datos antes de enviar.</strong></div>
      {d.distinto.length > 0 ? (
        <div className="aviso aviso-error">
          Ojo: el comprobante muestra {lista(d.distinto.map((x) => `otro ${x}`))} ({d.distinto.map(vio).join(' · ')}).
          El del condominio es {d.distinto.map(delCondominio).join(' · ')}. Si pagó a otra cuenta, la junta no lo va a encontrar.
        </div>
      ) : d.coincide.length > 0 && (
        <small className="txt-ok">✓ El pago fue a la cuenta del condominio ({d.coincide.join(', ')} coinciden).</small>
      )}
    </div>
  );
}

/**
 * Junta: lee el comprobante que subió el vecino (en el teléfono de la junta) y lo compara con lo que reportó y con
 * las cuentas del condominio. Es una ayuda para revisar más rápido: lo que manda es lo que dice el banco.
 */
export function RevisarComprobante({ url, referencia, monto, moneda, fechaPago, cuentas }: {
  url: string; referencia: string | null; monto: number; moneda: 'VES' | 'USD'; fechaPago: string; cuentas: CuentaFinanciera[];
}) {
  const [estado, setEstado] = useState<'nada' | 'leyendo' | 'listo' | 'error'>('nada');
  const [l, setL] = useState<LecturaComprobante | null>(null);
  async function leer() {
    setEstado('leyendo');
    try {
      const r = await fetch(url);
      const b = await r.blob();
      if (!b.type.startsWith('image/')) { setEstado('error'); return; }
      setL(await leerComprobante(b)); setEstado('listo');
    } catch { setEstado('error'); }
  }
  if (estado === 'nada') return <button type="button" className="btn-texto" onClick={() => void leer()}>Revisar el comprobante</button>;
  if (estado === 'leyendo') return <small className="meta">Leyendo el comprobante…</small>;
  if (estado === 'error' || !l) return <small className="meta">No se pudo leer el comprobante; revíselo a mano.</small>;
  const dig = (s: string | null) => (s ?? '').replace(/\D/g, '');
  const ref = !l.referencia || !referencia ? null
    : dig(l.referencia).endsWith(dig(referencia)) || dig(referencia).endsWith(dig(l.referencia));
  const mon = l.monto == null ? null : Math.abs(l.monto - monto) < 0.01;
  const fec = l.fecha == null ? null : l.fecha === fechaPago;
  const conDestino = cuentas.map((c) => comprobarDestino(l, c));
  const fuerte = conDestino.find((d) => d.coincide.some((x) => x === 'teléfono' || x === 'número de cuenta'));
  const des = fuerte ? true : conDestino.some((d) => d.distinto.includes('teléfono') || d.distinto.includes('número de cuenta')) ? false : null;
  const fila = (ok: boolean | null, si: string, no: string) => ok == null ? null
    : <li className={ok ? 'txt-ok' : 'txt-error'}>{ok ? '✓' : '⚠'} {ok ? si : no}</li>;
  return (
    <ul className="revision-comprobante">
      {fila(ref, `Referencia ${l.referencia} coincide`, `El comprobante dice referencia ${l.referencia}; el vecino reportó ${referencia}`)}
      {fila(mon, 'El monto coincide', `El comprobante dice ${moneda === 'USD' ? usd(l.monto ?? 0) : bs(l.monto ?? 0)}; el vecino reportó ${moneda === 'USD' ? usd(monto) : bs(monto)}`)}
      {fila(fec, 'La fecha coincide', `El comprobante es del ${fecha(l.fecha ?? fechaPago)}; el vecino reportó el ${fecha(fechaPago)}`)}
      {fila(des, 'Fue a una cuenta del condominio', `El comprobante muestra otro destino (${[...l.telefonos.map(formatoTelefono), ...l.cuentas.map(formatoCuenta)].join(', ')})`)}
      {ref == null && mon == null && fec == null && des == null && <li className="meta">No se encontraron datos en la imagen; revísela a mano.</li>}
      <li className="meta">Lectura automática: confirme siempre en el banco.</li>
    </ul>
  );
}
