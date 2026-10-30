// Invitar vecinos: la junta comparte UN enlace (WhatsApp, QR en la cartelera) para que cada vecino
// descargue Vecinos ZPro y pida entrar eligiendo su casa. La junta aprueba en Accesos → Solicitudes.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Capacitor } from '@capacitor/core';
import { api, type EnlaceInvitacion } from '../../data';
import { Estado, Tarjeta, useCarga } from '../../components/ui';
import { URL_DESCARGA_MIEMBROS } from '../../sabor';
import '../alerta/alerta.css';

export function mensajeInvitacion(e: EnlaceInvitacion, condominio: string) {
  return `Únase a ${condominio} en Vecinos ZPro:\n`
    + `1) Descargue la app${URL_DESCARGA_MIEMBROS ? `: ${URL_DESCARGA_MIEMBROS}` : ' Vecinos ZPro'}\n`
    + `2) Abra este enlace o escriba el código ${e.codigo}: ${e.url}\n`
    + 'La junta aprobará su ingreso.';
}

export function Invitar() {
  const { datos: e, cargando, error, recargar } = useCarga(() => api.enlaceInvitacion());
  const [qr, setQr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const condominio = api.sesion()?.condominio ?? 'su condominio';

  useEffect(() => {
    if (!e) return;
    QRCode.toDataURL(e.url, { width: 560, margin: 1, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(null));
  }, [e]);

  async function compartir() {
    if (!e) return;
    const texto = mensajeInvitacion(e, condominio);
    setErr(null);
    try {
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: `Invitación a ${condominio}`, text: texto, dialogTitle: 'Invitar vecinos' });
      } else if (navigator.share) {
        await navigator.share({ title: `Invitación a ${condominio}`, text: texto });
      } else {
        await copiar();
      }
    } catch { /* la persona canceló */ }
  }
  async function copiar() {
    if (!e) return;
    try { await navigator.clipboard.writeText(mensajeInvitacion(e, condominio)); setAviso('Mensaje copiado. Péguelo en WhatsApp o donde quiera.'); }
    catch { setErr('No se pudo copiar. Mantenga presionado el enlace para copiarlo.'); }
  }
  async function regenerar() {
    setErr(null); setAviso(null);
    try { await api.enlaceInvitacion(true); setConfirmar(false); recargar(); setAviso('Enlace nuevo creado. El anterior ya no sirve.'); }
    catch (x) { setErr((x as Error).message); }
  }

  return (
    <Estado cargando={cargando} error={error}>
      {e && (
        <>
          <Tarjeta titulo="Enlace de invitación">
            <p className="nota">Compártalo en el grupo de WhatsApp del condominio o imprima el código QR para la cartelera.
              Cada vecino elige su casa y usted aprueba su ingreso en <Link to="/p/accesos">Accesos → Solicitudes</Link>.</p>
            {qr && <div className="qr-caja"><img src={qr} alt={`Código QR de la invitación ${e.codigo}`} /></div>}
            <p className="codigo-grande">{e.codigo}</p>
            <p className="enlace-texto">{e.url}</p>
            <div className="botones-grid">
              <button className="btn" onClick={() => void compartir()}>Compartir</button>
              <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(mensajeInvitacion(e, condominio))}`} target="_blank" rel="noreferrer">WhatsApp</a>
              <button className="btn btn-sec" onClick={() => void copiar()}>Copiar mensaje</button>
              <button className="btn btn-sec" onClick={() => setConfirmar(true)}>Regenerar</button>
            </div>
            <small className="meta">Usado {e.usos} {e.usos === 1 ? 'vez' : 'veces'} · vence el {new Date(e.expiraEn).toLocaleDateString('es-VE')}</small>
            {confirmar && (
              <div className="aviso aviso-error">
                <p>¿Crear un enlace nuevo? <strong>El anterior deja de servir</strong> (úselo si se compartió donde no debía).</p>
                <div className="fila-botones">
                  <button className="btn btn-peligro" onClick={() => void regenerar()}>Sí, crear otro</button>
                  <button className="btn-texto" onClick={() => setConfirmar(false)}>Cancelar</button>
                </div>
              </div>
            )}
            {aviso && <div className="aviso aviso-ok">{aviso}</div>}
            {err && <div className="aviso aviso-error">{err}</div>}
          </Tarjeta>
          <Tarjeta titulo="Mensaje que reciben">
            <p style={{ whiteSpace: 'pre-line' }} className="nota">{mensajeInvitacion(e, condominio)}</p>
          </Tarjeta>
        </>
      )}
    </Estado>
  );
}
