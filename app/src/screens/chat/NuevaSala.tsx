import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../data';
import { Campo, Estado, Tarjeta, useCarga } from '../../components/ui';
import './chat.css';

// Solo la junta: grupo (varias casas conversan) o canal (avisos, solo la junta escribe y lo ven todas las casas).
export function NuevaSala() {
  const ir = useNavigate();
  const { datos, cargando, error } = useCarga(() => api.directorio());
  const [tipo, setTipo] = useState<'grupo' | 'canal'>('grupo');
  const [titulo, setTitulo] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const prefijos = [...new Set((datos ?? []).map((c) => c.etiqueta.replace(/\d+$/, '').trim()))];

  async function crear(ev: React.FormEvent) {
    ev.preventDefault();
    setErr(null);
    if (tipo === 'grupo' && sel.size < 2) return setErr('Elija al menos dos casas para el grupo.');
    try { ir(`/p/chats/${await api.crearSala(tipo, titulo, [...sel])}`, { replace: true }); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <form className="formulario" onSubmit={crear}>
      <Tarjeta titulo="Tipo de sala">
        <div className="chips">
          <button type="button" className={`chip ${tipo === 'grupo' ? 'chip-activo' : ''}`} onClick={() => setTipo('grupo')}>Grupo</button>
          <button type="button" className={`chip ${tipo === 'canal' ? 'chip-activo' : ''}`} onClick={() => setTipo('canal')}>Canal de avisos</button>
        </div>
        <p className="nota">{tipo === 'grupo'
          ? 'Las casas elegidas y la junta pueden escribir. Ejemplos: "Bloque B", "Comisión de pintura".'
          : 'Lo ven todas las casas del condominio, pero solo la junta escribe. Ideal para circulares y avisos oficiales.'}</p>
        <Campo etiqueta="Nombre">
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={60}
                 placeholder={tipo === 'grupo' ? 'Ej.: Comisión de pintura' : 'Ej.: Avisos de mantenimiento'} />
        </Campo>
      </Tarjeta>
      {tipo === 'grupo' && (
        <Tarjeta titulo={`Casas (${sel.size})`} accion={
          <button type="button" className="btn-texto" onClick={() => setSel(sel.size === (datos?.length ?? 0) ? new Set() : new Set(datos?.map((c) => c.unidadId)))}>
            {sel.size === (datos?.length ?? 0) ? 'Ninguna' : 'Todas'}
          </button>}>
          <Estado cargando={cargando} error={error}>
            {prefijos.length > 1 && (
              <div className="chips">
                {prefijos.map((p) => (
                  <button type="button" key={p} className="chip" onClick={() => setSel((s) => new Set([...s, ...(datos ?? []).filter((c) => c.etiqueta.startsWith(p)).map((c) => c.unidadId)]))}>
                    + {p}
                  </button>
                ))}
              </div>
            )}
            <div className="casas-sel">
              {datos?.map((c) => (
                <label key={c.unidadId} className="casa-check">
                  <input type="checkbox" checked={sel.has(c.unidadId)} onChange={() => alternar(c.unidadId)} />
                  <span><strong>{c.etiqueta}</strong><small>{c.nombres[0] ?? 'Sin usuarios en la app'}</small></span>
                </label>
              ))}
            </div>
          </Estado>
        </Tarjeta>
      )}
      {err && <div className="aviso aviso-error">{err}</div>}
      <div className="fila-botones">
        <button className="btn">{tipo === 'grupo' ? 'Crear grupo' : 'Crear canal'}</button>
        <button type="button" className="btn-texto" onClick={() => ir(-1)}>Cancelar</button>
      </div>
    </form>
  );
}
