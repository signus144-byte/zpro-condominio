import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../data';
import { Estado, Tarjeta, Vacio, useCarga } from '../../components/ui';
import { Avatar, baseRol, Ico } from './comun';
import './chat.css';

export function Directorio() {
  const s = api.sesion()!;
  const base = baseRol(s.esJunta);
  const ir = useNavigate();
  const { datos, cargando, error, recargar } = useCarga(() => api.directorio());
  const condo = useCarga(() => api.condominio());
  // La junta sin casa escribe "como Junta" (siempre permitido); casa ↔ casa depende de lo que decida la junta.
  const comoJunta = s.esJunta && !s.unidadId;
  const vecinosApagado = !comoJunta && condo.datos?.chatVecinos === false;
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const miCasa = datos?.find((c) => c.unidadId === s.unidadId);
  const muestroMiNombre = !!miCasa?.nombres.includes(s.nombre);

  async function escribir(unidadId: string) {
    setErr(null);
    try { ir(`${base}/chats/${await api.abrirConCasa(unidadId)}`); } catch (e) { setErr((e as Error).message); }
  }
  async function cambiarVisibilidad(v: boolean) {
    try { await api.mostrarEnDirectorio(v); recargar(); } catch (e) { setErr((e as Error).message); }
  }

  const t = q.trim().toLowerCase();
  const lista = (datos ?? []).filter((c) => !t || c.etiqueta.toLowerCase().includes(t) || c.nombres.some((n) => n.toLowerCase().includes(t)));

  return (
    <>
      <div className="buscador">
        <Ico n="buscar" t={18} />
        <input type="search" placeholder="Buscar casa o nombre (ej. 28, Pérez)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar casa" />
      </div>
      {!s.esJunta && miCasa && (
        <Tarjeta>
          <label className="interruptor">
            <input type="checkbox" checked={muestroMiNombre} onChange={(e) => cambiarVisibilidad(e.target.checked)} />
            <span><strong>Mostrar mi nombre a los vecinos</strong>
              <small>Si lo desactiva, los vecinos verán solo "{miCasa.etiqueta}". La junta siempre ve a nombre de quién está cada casa. Nunca se muestran teléfonos ni correos.</small></span>
          </label>
        </Tarjeta>
      )}
      {vecinosApagado && (
        <div className="aviso aviso-info">
          <strong>La junta no ha habilitado el chat entre vecinos.</strong> Puede ver el directorio, pero no escribirle a otra casa.
          Para cualquier asunto, escríbale a la junta desde Chat.
        </div>
      )}
      {err && <div className="aviso aviso-error">{err}</div>}
      <Estado cargando={cargando && !datos} error={error}>
        <div className="lista-chats">
          {lista.map((c) => {
            const propia = c.unidadId === s.unidadId;
            return (
              <div className="dir-fila" key={c.unidadId}>
                <Avatar titulo={c.etiqueta} tipo="casa" />
                <div className="item-chat-cuerpo">
                  <strong>{c.etiqueta}</strong>
                  <small>{c.nombres.length ? c.nombres.join(', ') : s.esJunta ? 'Sin usuarios en la app' : 'Nombre no visible'}</small>
                </div>
                {comoJunta ? (
                  <button className="btn" onClick={() => escribir(c.unidadId)}>Escribir como Junta</button>
                ) : propia ? (
                  <span className="nota">Su casa</span>
                ) : vecinosApagado ? null : (
                  <button className="btn btn-sec" onClick={() => escribir(c.unidadId)}>Escribir</button>
                )}
              </div>
            );
          })}
          {!lista.length && <Vacio>Ninguna casa coincide.</Vacio>}
        </div>
      </Estado>
    </>
  );
}
