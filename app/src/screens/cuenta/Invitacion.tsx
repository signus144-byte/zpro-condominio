// Abrir el enlace de invitación del condominio (#/invitacion/INV-XXXXXX): elegir la casa, entrar o crear la cuenta
// y pedir el ingreso. La junta lo aprueba. El código se recuerda mientras la persona se registra.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type InfoInvitacion } from '../../data';
import { Campo } from '../../components/ui';
import { destino, guardarInvitacion as guardar, invitacionPendiente } from '../../navegacion';
import { NOMBRE_APP } from '../../sabor';
import './cuenta.css';
import { FONDO_LOGO, SimboloMarca } from '../../components/Logo';

export function Invitacion() {
  const ir = useNavigate();
  const { codigo = '' } = useParams();
  const previa = invitacionPendiente();
  const [info, setInfo] = useState<InfoInvitacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unidadId, setUnidadId] = useState(previa?.codigo === codigo.toUpperCase() ? previa.unidadId : '');
  const [rol, setRol] = useState<'propietario' | 'inquilino'>(previa?.codigo === codigo.toUpperCase() ? previa.rol : 'propietario');
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const conCuenta = !!api.cuenta();

  useEffect(() => {
    api.infoInvitacion(codigo).then(setInfo).catch((e: Error) => { setError(e.message); guardar(null); });
  }, [codigo]);

  function recordar() { guardar({ codigo: codigo.toUpperCase(), unidadId, rol }); }
  async function enviar() {
    if (!unidadId) return setError('Elija su casa o apartamento.');
    setError(null); setEnviando(true);
    try {
      const r = await api.unirseConEnlace(codigo, unidadId, rol);
      guardar(null);
      if (r === 'aprobada') ir(destino(), { replace: true }); else setListo(true);
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  }

  return (
    <div className="entrar">
      <div className="entrar-marca">
        <div className="logo" aria-hidden style={{ background: FONDO_LOGO }}><SimboloMarca tam={40} /></div>
        <h1>Invitación</h1>
        <p>{info ? info.condominio : 'Cargando…'}{info?.ciudad ? ` · ${info.ciudad}` : ''}</p>
        {api.modo === 'demo' && <span className="etiqueta etiqueta-alerta">Demostración · datos ficticios</span>}
      </div>
      {listo ? (
        <div className="entrar-caja">
          <div className="aviso aviso-ok"><strong>Solicitud enviada.</strong> La junta de {info?.condominio} la aprobará. Le avisaremos cuando pueda entrar.</div>
          <Link className="btn btn-ancho" to="/unirme">Ver el estado de mi solicitud</Link>
        </div>
      ) : info && (
        <div className="entrar-caja formulario">
          <p className="nota">Su junta de condominio lo invitó a <strong>{NOMBRE_APP}</strong>: estados de cuenta, pagos, avisos y alerta vecinal.</p>
          <Campo etiqueta="¿En qué casa o apartamento vive?">
            <select value={unidadId} onChange={(e) => setUnidadId(e.target.value)} required>
              <option value="">Elija…</option>
              {info.unidades.map((u) => <option key={u.id} value={u.id}>{u.etiqueta}</option>)}
            </select>
          </Campo>
          <div className="chips" role="radiogroup" aria-label="Usted es">
            <button type="button" className={`chip ${rol === 'propietario' ? 'chip-activo' : ''}`} onClick={() => setRol('propietario')}>Propietario</button>
            <button type="button" className={`chip ${rol === 'inquilino' ? 'chip-activo' : ''}`} onClick={() => setRol('inquilino')}>Inquilino o familiar</button>
          </div>
          {conCuenta ? (
            <button className="btn btn-ancho" disabled={enviando || !unidadId} onClick={() => void enviar()}>{enviando ? 'Enviando…' : 'Pedir ingreso'}</button>
          ) : (
            <>
              <p className="nota">Para continuar, cree su cuenta o entre con la que ya tiene. Después le pediremos confirmar.</p>
              <button className="btn btn-ancho" disabled={!unidadId} onClick={() => { recordar(); ir('/registro'); }}>Crear mi cuenta</button>
              <button className="btn btn-sec btn-ancho" disabled={!unidadId} onClick={() => { recordar(); ir('/entrar'); }}>Ya tengo cuenta</button>
            </>
          )}
          <p className="nota">La junta verificará que usted vive en esa casa antes de aprobar.</p>
          {conCuenta && <button className="btn-texto" onClick={() => { guardar(null); ir(destino(), { replace: true }); }}>Ahora no</button>}
        </div>
      )}
      {error && <div className="aviso aviso-error">{error}</div>}
      {error && !info && <Link className="btn btn-sec btn-ancho" to={destino()}>Continuar</Link>}
      <p className="pie">Technical Digital TD, C.A. · soporte@zentapro.com</p>
    </div>
  );
}
