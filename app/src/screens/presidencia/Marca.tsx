import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Marca as TMarca } from '../../data';
import { Campo, Estado, Tarjeta } from '../../components/ui';
import '../chat/chat.css';

// La marca del condominio aparece en todas las plantillas (estados de cuenta, solvencias, actas…)
// y en el encabezado de la app.
export function Marca() {
  const s = api.sesion()!;
  const puedeEditar = ['presidente', 'administrador'].includes(s.rol);
  const [m, setM] = useState<TMarca | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [logo, setLogo] = useState<File | null>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [vistaLogo, setVistaLogo] = useState<string | null>(null);
  const [vistaFoto, setVistaFoto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    api.marca().then(setM).catch((e: Error) => setError(e.message)).finally(() => setCargando(false));
  }, []);

  const cambiar = <K extends keyof TMarca>(k: K, v: TMarca[K]) => { setOk(false); setM((x) => (x ? { ...x, [k]: v } : x)); };
  const elegir = (f: File | null, tipo: 'logo' | 'foto') => {
    setOk(false);
    if (tipo === 'logo') { setLogo(f); setVistaLogo(f ? URL.createObjectURL(f) : null); }
    else { setFoto(f); setVistaFoto(f ? URL.createObjectURL(f) : null); }
  };

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!m) return;
    setGuardando(true); setError(null);
    try {
      const { logoUrl: _l, fotoEntradaUrl: _f, ...campos } = m;
      await api.guardarMarca({ ...campos, logo: logo ?? undefined, fotoEntrada: foto ?? undefined });
      setM(await api.marca()); setLogo(null); setFoto(null); setVistaLogo(null); setVistaFoto(null); setOk(true);
    } catch (e) { setError((e as Error).message); } finally { setGuardando(false); }
  }

  const fotoUrl = vistaFoto ?? m?.fotoEntradaUrl;
  const logoUrl = vistaLogo ?? m?.logoUrl;

  return (
    <Estado cargando={cargando} error={!m ? error : null}>
      {m && (
        <form className="formulario" onSubmit={guardar}>
          <div className="vista-marca" aria-label="Vista previa del encabezado de los documentos">
            <div className="vista-marca-foto" style={fotoUrl ? { backgroundImage: `url("${fotoUrl}")` } : undefined} />
            <div className="vista-marca-cuerpo">
              <div className="vista-marca-logo" style={logoUrl ? { backgroundImage: `url("${logoUrl}")` } : undefined} />
              <div className="vista-marca-txt">
                <strong>{m.nombreAsociacion || m.nombre}</strong>
                <small>{[m.rif && `RIF ${m.rif}`, m.ciudad].filter(Boolean).join(' · ')}</small>
                <small>{[m.direccion, m.telefono, m.correo].filter(Boolean).join(' · ')}</small>
              </div>
            </div>
            <div className="vista-marca-franja" style={{ background: m.colorPrimario }} />
          </div>
          <p className="nota">Así se verá el encabezado de estados de cuenta, recibos, solvencias y actas. <Link to="/p/documentos">Ver documentos</Link></p>

          <Tarjeta titulo="Imagen">
            <Campo etiqueta="Logo de la asociación" ayuda="PNG o JPG, idealmente cuadrado y con fondo blanco o transparente">
              <input type="file" accept="image/*" disabled={!puedeEditar} onChange={(e) => elegir(e.target.files?.[0] ?? null, 'logo')} />
            </Campo>
            <Campo etiqueta="Foto de la fachada o entrada de la urbanización" ayuda="Tómela con el teléfono en horizontal; se usa como portada">
              <input type="file" accept="image/*" capture="environment" disabled={!puedeEditar} onChange={(e) => elegir(e.target.files?.[0] ?? null, 'foto')} />
            </Campo>
            <Campo etiqueta="Color principal">
              <div className="color-campo">
                <input type="color" value={m.colorPrimario} disabled={!puedeEditar} onChange={(e) => cambiar('colorPrimario', e.target.value)} aria-label="Color principal" />
                <span className="nota">{m.colorPrimario}</span>
              </div>
            </Campo>
          </Tarjeta>

          <Tarjeta titulo="Datos de la asociación">
            <Campo etiqueta="Nombre de la asociación (como aparece en el documento de condominio)">
              <input value={m.nombreAsociacion ?? ''} disabled={!puedeEditar} onChange={(e) => cambiar('nombreAsociacion', e.target.value)}
                     placeholder="Asociación Civil de Propietarios Res. …" />
            </Campo>
            <Campo etiqueta="Nombre corto del conjunto"><input value={m.nombre} disabled={!puedeEditar} required onChange={(e) => cambiar('nombre', e.target.value)} /></Campo>
            <div className="dos-col">
              <Campo etiqueta="RIF"><input value={m.rif ?? ''} disabled={!puedeEditar} onChange={(e) => cambiar('rif', e.target.value)} placeholder="J-00000000-0" /></Campo>
              <Campo etiqueta="Ciudad y estado"><input value={m.ciudad ?? ''} disabled={!puedeEditar} onChange={(e) => cambiar('ciudad', e.target.value)} /></Campo>
            </div>
            <Campo etiqueta="Dirección"><input value={m.direccion ?? ''} disabled={!puedeEditar} onChange={(e) => cambiar('direccion', e.target.value)} /></Campo>
            <div className="dos-col">
              <Campo etiqueta="Teléfono"><input type="tel" value={m.telefono ?? ''} disabled={!puedeEditar} onChange={(e) => cambiar('telefono', e.target.value)} /></Campo>
              <Campo etiqueta="Correo"><input type="email" value={m.correo ?? ''} disabled={!puedeEditar} onChange={(e) => cambiar('correo', e.target.value)} /></Campo>
            </div>
          </Tarjeta>
          {error && <div className="aviso aviso-error">{error}</div>}
          {ok && <div className="aviso aviso-ok">Marca guardada. Los próximos documentos ya la usan.</div>}
          {puedeEditar
            ? <button className="btn btn-ancho" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar marca'}</button>
            : <p className="nota">Solo la presidencia o el administrador pueden editar la marca.</p>}
        </form>
      )}
    </Estado>
  );
}
