import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Conversacion } from '../../data';
import { ajustes } from '../../data/local';
import { Vacio } from '../../components/ui';
import { Avatar, baseRol, horaCorta, Ico } from './comun';
import './chat.css';

export function Chats() {
  const s = api.sesion()!;
  const base = baseRol(s.esJunta);
  const ir = useNavigate();
  const [lista, setLista] = useState<Conversacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'no_leidos' | 'vecinos' | 'junta'>('todos');
  const [chatVecinos, setChatVecinos] = useState<boolean | null>(null);
  useEffect(() => { api.condominio().then((c) => setChatVecinos(c.chatVecinos)).catch(() => {}); }, []);

  // Recarga silenciosa (sin parpadeo) cada pocos segundos mientras la pantalla está abierta.
  const cargar = useCallback(() => {
    api.conversaciones().then((l) => { setLista(l); setError(null); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    cargar();
    // Con servidor: el WebSocket avisa al instante; la consulta periódica es solo un respaldo.
    const quitar = api.suscribirBandeja(cargar);
    const t = setInterval(cargar, api.modo === 'demo' ? 3000 : 30000);
    return () => { clearInterval(t); quitar(); };
  }, [cargar]);

  async function abrir(fn: () => Promise<string>) {
    try { ir(`${base}/chats/${await fn()}`); } catch (e) { setError((e as Error).message); }
  }

  const texto = q.trim().toLowerCase();
  const visibles = (lista ?? []).filter((c) =>
    (!texto || c.titulo.toLowerCase().includes(texto) || (c.ultimoMensaje ?? '').toLowerCase().includes(texto)) &&
    (filtro === 'todos' || (filtro === 'no_leidos' && c.noLeidos > 0)
      || (filtro === 'vecinos' && c.tipo === 'directa') || (filtro === 'junta' && c.tipo !== 'directa')));

  return (
    <>
      <div className="chats-acciones">
        {s.esJunta ? (
          <>
            <Link className="btn" to={`${base}/directorio`}>Escribir a una casa</Link>
            <Link className="btn btn-sec" to={`${base}/salas/nueva`}>Nueva sala o canal</Link>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => abrir(() => api.abrirConJunta())}>Escribir a la junta</button>
            <Link className="btn btn-sec" to={`${base}/directorio`}>Directorio de casas</Link>
          </>
        )}
      </div>
      <div className="buscador">
        <Ico n="buscar" t={18} />
        <input type="search" placeholder="Buscar chat, casa o mensaje" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
      </div>
      <div className="chips">
        {([['todos', 'Todos'], ['no_leidos', 'No leídos'], ['vecinos', 'Vecinos'], ['junta', s.esJunta ? 'Casas, grupos y canales' : 'Junta y grupos']] as const).map(([k, t]) => (
          <button key={k} className={`chip ${filtro === k ? 'chip-activo' : ''}`} onClick={() => setFiltro(k)}>{t}</button>
        ))}
      </div>
      {error && <div className="aviso aviso-error">{error}</div>}
      {lista === null && !error && <div className="cargando">Cargando…</div>}
      {lista && (visibles.length ? (
        <ul className="lista-chats">
          {visibles.map((c) => (
            <li key={c.id}>
              <Link className="item-chat" to={`${base}/chats/${c.id}`}>
                <Avatar titulo={c.titulo} tipo={c.tipo} esJuntaTitulo={!s.esJunta && c.tipo === 'junta'} />
                <div className="item-chat-cuerpo">
                  <div className="item-chat-fila">
                    <span className="item-chat-titulo">{c.titulo}</span>
                    <span className={`item-chat-hora ${c.noLeidos ? 'con-nuevos' : ''}`}>{horaCorta(c.ultimoMensajeEn)}</span>
                  </div>
                  <div className="item-chat-fila">
                    <span className="item-chat-ultimo">
                      {ajustes.silenciada(c.id) && '🔇 '}{c.ultimoMensaje ?? c.subtitulo}
                    </span>
                    {c.noLeidos > 0 && <span className="burbuja-contador" aria-label={`${c.noLeidos} sin leer`}>{c.noLeidos}</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : <Vacio>{lista.length ? 'Ningún chat coincide con la búsqueda.' : 'Aún no tiene conversaciones.'}</Vacio>)}
      <p className="nota">
        {s.esJunta
          ? 'La junta ve las conversaciones con cada casa, los grupos y los canales. Las conversaciones privadas entre vecinos no son visibles para la junta (salvo un mensaje que se le denuncie).'
          : chatVecinos === false
            ? 'Puede escribir a la junta. La junta no ha habilitado el chat entre vecinos: las conversaciones con otras casas quedan de solo lectura. Para quejas anónimas use Reportes.'
            : 'Puede escribir a la junta y a cualquier casa del condominio. Los mensajes llevan su nombre y su casa; para quejas anónimas use Reportes.'}
      </p>
    </>
  );
}
