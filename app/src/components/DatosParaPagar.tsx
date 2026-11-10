// Datos para pagar a una cuenta: cada dato con su botón "Copiar" (para pegarlo campo por campo en la app del banco),
// "Copiar todo", el QR oficial del banco si la junta lo subió y un QR armado por la app con los mismos datos.
// Se usa en "Pagar" del vecino y en la mensualidad de ZentaPro (junta).
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { CuentaFinanciera, MetodoPago } from '../data';
import { bs, fecha, hace, usd } from '../formato';
import { digitos, formatoCuenta, formatoDocumento, formatoTelefono, lineaPagoMovil, montoParaBanco, nombreBanco } from '../bancos';
import { descargar, nombreArchivo } from '../documentos/descarga';

/** Copia al portapapeles (API moderna y, si falla, el método antiguo que sí funciona en algunos WebView). */
export async function copiarTexto(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* sigue con el método antiguo */ }
  try {
    const t = document.createElement('textarea');
    t.value = texto; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}

interface Fila { clave: string; etiqueta: string; mostrar: string; copiar: string; ayuda?: string }

/** Qué datos necesita cada forma de pago, en el orden en que los piden las apps de los bancos. */
export function filasDePago(c: CuentaFinanciera, metodo: MetodoPago, monto: number | null): Fila[] {
  const f: Fila[] = [];
  const banco = c.bancoCodigo ? { clave: 'banco', etiqueta: 'Banco', mostrar: `${c.bancoCodigo} · ${nombreBanco(c.bancoCodigo)}`, copiar: c.bancoCodigo } : null;
  const doc = c.documento ? {
    clave: 'documento', etiqueta: 'JGP'.includes(c.documento[0]) ? 'RIF' : 'Cédula', mostrar: formatoDocumento(c.documento), copiar: digitos(c.documento),
    ayuda: `Se copian solo los números. En su banco elija «${c.documento[0]}».`,
  } : null;
  const titular = c.titular ? { clave: 'titular', etiqueta: 'Titular', mostrar: c.titular, copiar: c.titular } : null;
  const enBs = metodo === 'pago_movil' || metodo === 'transferencia' || metodo === 'efectivo_bs';
  const m = monto && monto > 0 ? {
    clave: 'monto', etiqueta: 'Monto', mostrar: enBs ? bs(monto) : usd(monto),
    copiar: enBs ? montoParaBanco(monto) : monto.toFixed(2), ayuda: enBs ? 'Se copia sin puntos y con coma, como lo piden los bancos.' : undefined,
  } : null;
  if (metodo === 'pago_movil') {
    if (banco) f.push(banco);
    if (c.telefono) f.push({ clave: 'telefono', etiqueta: 'Teléfono', mostrar: formatoTelefono(c.telefono), copiar: c.telefono });
    if (doc) f.push(doc);
  } else if (metodo === 'transferencia') {
    if (banco) f.push(banco);
    if (c.numeroCuenta) f.push({ clave: 'cuenta', etiqueta: 'Número de cuenta', mostrar: formatoCuenta(c.numeroCuenta), copiar: c.numeroCuenta });
    if (titular) f.push(titular);
    if (doc) f.push(doc);
  } else if (metodo === 'zelle') {
    if (c.correo) f.push({ clave: 'correo', etiqueta: 'Correo', mostrar: c.correo, copiar: c.correo });
    if (titular) f.push(titular);
  } else if (c.correo) {
    f.push({ clave: 'correo', etiqueta: 'Correo o dirección', mostrar: c.correo, copiar: c.correo });
  }
  if (f.length && m) f.push(m);
  return f;
}

/** ¿Esta cuenta sirve para esa forma de pago? (tiene los datos mínimos). */
export function sirvePara(c: CuentaFinanciera, metodo: MetodoPago) {
  if (metodo === 'pago_movil') return !!(c.telefono && c.bancoCodigo && c.documento) || (c.moneda === 'VES' && !!c.qrUrl);
  if (metodo === 'transferencia') return !!c.numeroCuenta;
  if (metodo === 'zelle') return c.tipo === 'zelle' || (!!c.correo && c.moneda === 'USD');
  if (metodo === 'usdt') return c.tipo === 'usdt';
  if (metodo === 'efectivo_usd') return c.tipo === 'caja' && c.moneda === 'USD';
  return c.tipo === 'caja' && c.moneda === 'VES';
}

/** Lo que va dentro del QR que arma la app (texto plano; lo lee cualquier lector de QR). */
function textoQr(c: CuentaFinanciera, metodo: MetodoPago, monto: number | null) {
  if (metodo === 'pago_movil' && c.bancoCodigo && c.telefono && c.documento)
    return lineaPagoMovil({ bancoCodigo: c.bancoCodigo, telefono: c.telefono, documento: c.documento }, monto);
  if (metodo === 'transferencia' && c.numeroCuenta)
    return [c.numeroCuenta, c.documento, monto && monto > 0 ? montoParaBanco(monto) : null].filter(Boolean).join(' ');
  return null;
}

function BotonCopiar({ texto, etiqueta, copiado, alCopiar }: { texto: string; etiqueta: string; copiado: boolean; alCopiar: () => void }) {
  return (
    <button type="button" className={`btn-copiar ${copiado ? 'copiado' : ''}`} aria-label={`Copiar ${etiqueta}`}
            onClick={async () => { if (await copiarTexto(texto)) alCopiar(); }}>
      {copiado ? 'Copiado' : 'Copiar'}
    </button>
  );
}

async function guardarImagen(url: string, nombre: string) {
  const r = await fetch(url);
  const bytes = new Uint8Array(await r.arrayBuffer());
  await descargar(bytes, nombre, r.headers.get('content-type') || 'image/png');
}

export function DatosParaPagar({ cuenta: c, metodo, monto, titulo }: {
  cuenta: CuentaFinanciera; metodo: MetodoPago; monto: number | null; titulo?: string;
}) {
  const filas = filasDePago(c, metodo, monto);
  const [copiado, setCopiado] = useState<string | null>(null);
  const reloj = useRef<number | undefined>(undefined);
  const marcar = (k: string) => {
    setCopiado(k);
    window.clearTimeout(reloj.current);
    reloj.current = window.setTimeout(() => setCopiado(null), 2200);
  };
  useEffect(() => () => window.clearTimeout(reloj.current), []);

  const qrTexto = textoQr(c, metodo, monto);
  const [qrApp, setQrApp] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    if (!qrTexto) { setQrApp(null); return; }
    QRCode.toDataURL(qrTexto, { width: 480, margin: 1, errorCorrectionLevel: 'M' }).then((u) => vivo && setQrApp(u)).catch(() => vivo && setQrApp(null));
    return () => { vivo = false; };
  }, [qrTexto]);
  const [verQrApp, setVerQrApp] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const qrBanco = metodo === 'pago_movil' && c.qrUrl ? c.qrUrl : null;

  const todo = [titulo ?? c.nombre, ...filas.map((f) => `${f.etiqueta}: ${f.clave === 'documento' ? c.documento : f.clave === 'banco' ? `${f.copiar} ${nombreBanco(f.copiar)}` : f.copiar}`)].join('\n');
  const reciente = c.actualizadoEn && Date.now() - new Date(c.actualizadoEn).getTime() < 7 * 86400_000;

  if (!filas.length && !qrBanco) {
    return c.datosPago ? <div className="datos-pago"><strong>{titulo ?? c.nombre}</strong><span>{c.datosPago}</span></div> : null;
  }
  return (
    <div className="pagar-a">
      <div className="pagar-a-cab">
        <strong>{titulo ?? c.nombre}</strong>
        {filas.length > 1 && <BotonCopiar texto={todo} etiqueta="todos los datos" copiado={copiado === '*'} alCopiar={() => marcar('*')} />}
      </div>
      {filas.length > 0 && (
        <ul className="filas-copiar">
          {filas.map((f) => (
            <li key={f.clave}>
              <span className="fc-dato">
                <small>{f.etiqueta}</small>
                <b>{f.mostrar}</b>
                {f.ayuda && copiado === f.clave && <em>{f.ayuda}</em>}
              </span>
              <BotonCopiar texto={f.copiar} etiqueta={f.etiqueta} copiado={copiado === f.clave} alCopiar={() => marcar(f.clave)} />
            </li>
          ))}
        </ul>
      )}
      {c.nota && <p className="nota">{c.nota}</p>}

      {qrBanco && (
        <div className="qr-pago">
          <img src={qrBanco} alt="QR de cobro del condominio" />
          <p className="nota">QR de cobro del condominio. Guárdelo y ábralo desde la opción «Pagar con QR» de la app de su banco.</p>
          <button type="button" className="btn btn-sec" onClick={() => guardarImagen(qrBanco, nombreArchivo(`QR ${c.nombre}.png`)).catch(() => setErrorGuardar('No se pudo guardar la imagen.'))}>Guardar QR</button>
        </div>
      )}
      {qrApp && (qrBanco ? (
        <button type="button" className="btn-texto" onClick={() => setVerQrApp((v) => !v)}>{verQrApp ? 'Ocultar el QR con los datos' : 'Ver QR con los datos'}</button>
      ) : null)}
      {qrApp && (!qrBanco || verQrApp) && (
        <div className="qr-pago">
          <img src={qrApp} alt="QR con los datos del pago" />
          <p className="nota">QR con los datos: <code>{qrTexto}</code>. Lo lee cualquier lector de QR; si la app de su banco no lo abre, use los botones «Copiar».</p>
          <button type="button" className="btn btn-sec" onClick={() => guardarImagen(qrApp, nombreArchivo(`Datos de pago ${c.nombre}.png`)).catch(() => setErrorGuardar('No se pudo guardar la imagen.'))}>Guardar QR</button>
        </div>
      )}
      {errorGuardar && <div className="aviso aviso-error">{errorGuardar}</div>}
      {c.actualizadoEn && (
        <p className={`nota ${reciente ? 'nota-alerta' : ''}`}>
          {reciente ? 'Estos datos cambiaron ' + (hace(c.actualizadoEn) === 'ahora' ? 'hace un momento' : hace(c.actualizadoEn)) : 'Datos actualizados el ' + fecha(c.actualizadoEn)}
          {c.actualizadoPor ? ` por ${c.actualizadoPor}` : ''}.{reciente ? ' Si tiene dudas, confírmelos con la junta antes de pagar.' : ''}
        </p>
      )}
    </div>
  );
}
