import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RolPlataforma } from '../data';
import { Campo, Estado, Etiqueta, Tarjeta, Vacio, useAccion, useCarga } from '../ui';
import { ROLES, fecha } from '../formato';

export function Soporte() {
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const res = useCarga(() => api.buscarUsuarios(busqueda), [busqueda]);
  const condos = useCarga(() => api.condominios());
  const sol = useCarga(() => api.solicitudesPendientes());
  const qc = busqueda.toLowerCase();
  const condosEncontrados = busqueda.length >= 2 ? (condos.datos ?? []).filter((c) => `${c.nombre} ${c.rif} ${c.ciudad}`.toLowerCase().includes(qc)) : [];

  return (
    <>
      <div className="titulo-pagina"><div><h1>Soporte</h1><p>Ayudar a juntas y residentes sin ver su información privada.</p></div></div>
      <Tarjeta className="privacidad" titulo="Lo que la consola NO puede ver (privacidad por diseño)">
        <ul>
          <li>Conversaciones del chat (ni entre vecinos ni con la junta).</li>
          <li>Pagos, saldos o estados de cuenta de los residentes.</li>
          <li>Quién envió un reporte anónimo.</li>
        </ul>
        <p className="nota">Lo bloquea la base de datos (seguridad por filas), no solo esta pantalla. Si un caso lo requiere, la junta debe mostrarlo desde su propia cuenta.</p>
      </Tarjeta>

      <form className="filtros" onSubmit={(e) => { e.preventDefault(); setBusqueda(q.trim()); }}>
        <input type="search" placeholder="Nombre, correo o condominio" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar usuario o condominio" />
        <button className="btn">Buscar</button>
      </form>

      {busqueda.length >= 2 && (
        <div className="dos">
          <Tarjeta titulo="Usuarios">
            <Estado cargando={res.cargando} error={res.error}>
              {res.datos?.length ? (
                <div className="tabla-envoltura"><table className="tabla"><tbody>
                  {res.datos.map((u) => (
                    <tr key={u.usuarioId}>
                      <td><strong>{u.nombre}</strong><small>{u.correo}</small></td>
                      <td>{u.condominios.map((c, i) => <div key={i}><small>{c.nombre} · {c.rol}{c.unidad ? ` · ${c.unidad}` : ''}</small></div>)}</td>
                    </tr>
                  ))}
                </tbody></table></div>
              ) : <Vacio>Sin usuarios que coincidan.</Vacio>}
            </Estado>
          </Tarjeta>
          <Tarjeta titulo="Condominios">
            {condosEncontrados.length ? (
              <div className="tabla-envoltura"><table className="tabla"><tbody>
                {condosEncontrados.map((c) => <tr key={c.id}><td><Link to={`/condominios/${c.id}`}>{c.nombre}</Link><small>{c.ciudad} · {c.rif}</small></td></tr>)}
              </tbody></table></div>
            ) : <Vacio>Sin condominios que coincidan.</Vacio>}
          </Tarjeta>
        </div>
      )}

      <Tarjeta titulo={`Solicitudes de ingreso pendientes (${sol.datos?.length ?? 0})`}>
        <Estado cargando={sol.cargando} error={sol.error}>
          {sol.datos?.length ? (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead><tr><th>Condominio</th><th>Persona</th><th>Unidad</th><th>Rol</th><th>Esperando desde</th></tr></thead>
                <tbody>{sol.datos.map((s) => {
                  const dias = Math.floor((Date.now() - new Date(s.creadoEn).getTime()) / 86400000);
                  return (
                    <tr key={s.id}>
                      <td><Link to={`/condominios/${s.condominioId}`}>{s.condominioNombre}</Link></td>
                      <td>{s.usuarioNombre}</td><td>{s.unidad ?? '—'}</td><td>{s.rol}</td>
                      <td>{fecha(s.creadoEn)} {dias >= 5 && <Etiqueta tono="alerta">{dias} días</Etiqueta>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          ) : <Vacio>No hay solicitudes pendientes.</Vacio>}
        </Estado>
        <p className="nota">Las aprueba la junta de cada condominio desde la app. Si alguna lleva varios días esperando, avise al presidente.</p>
      </Tarjeta>
    </>
  );
}

export function Equipo() {
  const eq = useCarga(() => api.equipo());
  const [correo, setCorreo] = useState('');
  const [rol, setRol] = useState<RolPlataforma>('soporte');
  const accion = useAccion();
  const dueno = api.sesion()?.rol === 'dueno';

  return (
    <>
      <div className="titulo-pagina"><div><h1>Equipo ZentaPro</h1><p>Quién entra a esta consola y con qué permisos.</p></div></div>
      <accion.Mensaje />
      <div className="dos">
        <Tarjeta titulo="Administradores de la plataforma">
          <Estado cargando={eq.cargando} error={eq.error}>
            <div className="tabla-envoltura"><table className="tabla">
              <thead><tr><th>Persona</th><th>Rol</th><th>Estado</th></tr></thead>
              <tbody>{eq.datos?.map((a) => (
                <tr key={a.usuarioId}>
                  <td><strong>{a.nombre}</strong><small>{a.correo ?? '—'}</small></td>
                  <td>
                    <select value={a.rol} disabled={!dueno} aria-label={`Rol de ${a.nombre}`}
                            onChange={(e) => accion.correr(async () => { await api.cambiarAdmin(a.usuarioId, { rol: e.target.value as RolPlataforma }); eq.recargar(); }, 'Rol actualizado.')}>
                      {(Object.keys(ROLES) as RolPlataforma[]).map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
                    </select>
                  </td>
                  <td>
                    <button className={`btn btn-chico ${a.activo ? 'btn-sec' : ''}`} disabled={!dueno}
                            onClick={() => accion.correr(async () => { await api.cambiarAdmin(a.usuarioId, { activo: !a.activo }); eq.recargar(); })}>
                      {a.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          </Estado>
        </Tarjeta>
        <div className="formulario">
          <Tarjeta titulo="Agregar persona">
            <Campo etiqueta="Correo" ayuda="Debe haberse registrado antes en la app con ese correo.">
              <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
            </Campo>
            <Campo etiqueta="Rol">
              <select value={rol} onChange={(e) => setRol(e.target.value as RolPlataforma)}>
                {(Object.keys(ROLES) as RolPlataforma[]).map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
              </select>
            </Campo>
            <div><button className="btn" disabled={!dueno || !correo || accion.ocupado}
                         onClick={() => accion.correr(async () => { await api.agregarAdmin(correo, rol); setCorreo(''); eq.recargar(); }, 'Persona agregada al equipo.')}>Agregar</button></div>
          </Tarjeta>
          <Tarjeta titulo="Qué puede hacer cada rol">
            <dl className="ficha">
              <dt>Dueño</dt><dd>Todo, incluido el equipo y los planes.</dd>
              <dt>Soporte</dt><dd>Alta de condominios, estados, códigos y soporte. No toca cobros.</dd>
              <dt>Finanzas</dt><dd>Facturación, pagos, tasa BCV y suspensiones. No da de alta condominios.</dd>
            </dl>
          </Tarjeta>
        </div>
      </div>
    </>
  );
}
