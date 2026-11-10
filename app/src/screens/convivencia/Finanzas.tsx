// v0.9 · Cuentas del condominio para los vecinos (0028). Mostrarlas es DECISIÓN de cada condominio: por defecto
// los vecinos no ven nada del condominio, solo lo suyo. Presidencia o la administración elige "totales" o "detalle".
import { useEffect, useState } from 'react';
import { api, type FinanzasPublicas, type ModoFinanzasPublicas } from '../../data';
import { Cifra, Estado, Tarjeta, Vacio, useCarga } from '../../components/ui';
import { ESTADO_PARTIDA, bs, fecha, mes, mesAnterior, mesSiguiente, periodoActual, usd } from '../../formato';

export const MODOS_FINANZAS: Record<ModoFinanzasPublicas, { t: string; d: string }> = {
  no: { t: 'No mostrar', d: 'Los vecinos no ven las finanzas del condominio. Cada casa ve solo lo suyo: su estado de cuenta, sus pagos y su cuota en cada cuota especial.' },
  totales: { t: 'Mostrar los totales', d: 'Cada mes: cuánto se cobró, cuánto se gastó por categoría, el fondo de reserva y el avance de las cuotas especiales.' },
  detalle: { t: 'Mostrar todo el detalle', d: 'Además, cada gasto con su factura y los saldos de las cuentas del condominio.' },
};

/** Lo que ve el vecino de un mes. Nunca dice quién pagó y quién no. */
export function ResumenFinanzas({ d, conGastos }: { d: FinanzasPublicas; conGastos: boolean }) {
  const gastos = useCarga(() => (conGastos ? api.gastos(d.periodo) : Promise.resolve([])), [d.periodo, conGastos]);
  return (
    <>
      <Tarjeta titulo={`${mes(d.periodo)}${d.cerrado ? ' · cerrado' : ' · en curso'}`}>
        <div className="cifras">
          <Cifra etiqueta="Cobrado" valor={usd(d.cobradoUsd)} tono="ok" />
          <Cifra etiqueta="Gastado" valor={usd(d.gastosUsd)} />
          <Cifra etiqueta="Aportes al fondo de reserva" valor={usd(d.fondoReservaUsd)} nota="cobrados hasta este mes" />
        </div>
        {d.gastosPorCategoria.length ? (
          <ul className="lista">
            {d.gastosPorCategoria.map((g) => <li key={g.categoria}><span>{g.categoria}</span><strong>{usd(g.montoUsd)}</strong></li>)}
            <li className="total"><span>Total de gastos</span><strong>{usd(d.gastosUsd)}</strong></li>
          </ul>
        ) : <p className="nota">Sin gastos registrados este mes.</p>}
      </Tarjeta>

      {d.partidas.length > 0 && (
        <Tarjeta titulo="Cuotas especiales">
          <ul className="lista">
            {d.partidas.map((p) => (
              <li key={p.titulo}><span>{p.titulo}<small>{ESTADO_PARTIDA[p.estado]} · presupuesto {usd(p.presupuestoUsd)}</small></span>
                <strong>{usd(p.cobradoUsd)}<small> de {usd(p.emitidoUsd)}</small></strong></li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {d.cuentas && (
        <Tarjeta titulo="Saldos de las cuentas al cierre del mes">
          <ul className="lista">
            {d.cuentas.map((c) => <li key={c.nombre}><span>{c.nombre}</span><strong>{c.moneda === 'VES' ? bs(c.saldoFinal) : usd(c.saldoFinal)}</strong></li>)}
          </ul>
        </Tarjeta>
      )}

      {conGastos && (
        <Tarjeta titulo="Cada gasto">
          <Estado cargando={gastos.cargando} error={gastos.error}>
            {gastos.datos?.length ? (
              <ul className="lista">
                {gastos.datos.map((g) => (
                  <li key={g.id}>
                    <span>{g.descripcion}<small>{g.categoria} · {fecha(g.fechaGasto)}
                      {g.facturaUrl && <> · <a href={g.facturaUrl} target="_blank" rel="noreferrer">ver factura</a></>}</small></span>
                    <strong>{usd(g.montoUsd)}</strong>
                  </li>
                ))}
              </ul>
            ) : <Vacio>Sin gastos este mes.</Vacio>}
          </Estado>
        </Tarjeta>
      )}
    </>
  );
}

/** Vecino: /r/finanzas */
export function CuentasCondominio() {
  const [periodo, setPeriodo] = useState(mesAnterior(periodoActual()));
  const d = useCarga(() => api.finanzasPublicas(periodo), [periodo]);
  return (
    <>
      <div className="selector-mes">
        <button className="btn-texto" onClick={() => setPeriodo(mesAnterior(periodo))} aria-label="Mes anterior">‹</button>
        <strong>{mes(periodo)}</strong>
        <button className="btn-texto" onClick={() => setPeriodo(mesSiguiente(periodo))} aria-label="Mes siguiente" disabled={periodo >= periodoActual()}>›</button>
      </div>
      <Estado cargando={d.cargando} error={d.error}>
        {d.datos ? <ResumenFinanzas d={d.datos} conGastos={d.datos.modo === 'detalle'} />
          : <Vacio>La junta de su condominio no publica las cuentas del condominio en la app. Su estado de cuenta y sus pagos siempre están en «Mi cuenta».</Vacio>}
      </Estado>
      <p className="nota">Publicado por la junta. No se muestra qué casas pagaron ni cuáles deben.</p>
    </>
  );
}

/** Junta (Transparencia y convivencia): qué números ven los vecinos, con la vista previa del último mes. */
export function OpcionFinanzas({ puede }: { puede: boolean }) {
  const cfg = useCarga(() => api.convivencia());
  const [modo, setModo] = useState<ModoFinanzasPublicas>('no');
  useEffect(() => { if (cfg.datos) setModo(cfg.datos.finanzasPublicas ?? 'no'); }, [cfg.datos]);
  const periodo = mesAnterior(periodoActual());
  const previa = useCarga(() => api.finanzasPublicas(periodo));
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [verPrevia, setVerPrevia] = useState(false);
  const actual = cfg.datos?.finanzasPublicas ?? 'no';

  async function guardar() {
    setMsg(null); setGuardando(true);
    try {
      await api.fijarFinanzasPublicas(modo);
      setMsg({ ok: true, t: modo === 'no' ? 'Guardado. Los vecinos no ven las finanzas del condominio.' : 'Guardado. Se les avisó a los vecinos; lo ven en «Cuentas del condominio».' });
      cfg.recargar();
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }); } finally { setGuardando(false); }
  }

  const vista = previa.datos ? {
    ...previa.datos, modo,
    cuentas: modo === 'detalle' ? previa.datos.cuentas : null,
    partidas: modo === 'no' ? [] : previa.datos.partidas,
  } : null;
  return (
    <Tarjeta titulo="Cuentas del condominio para los vecinos">
      <p className="nota">Ustedes deciden si los vecinos ven los números del condominio. Nunca se muestra qué casas pagaron ni cuáles deben (eso se decide abajo, en la lista de cuotas vencidas).</p>
      {(['no', 'totales', 'detalle'] as ModoFinanzasPublicas[]).map((m) => (
        <label key={m} className="opcion-radio">
          <input type="radio" name="finanzas" checked={modo === m} disabled={!puede} onChange={() => setModo(m)} />
          <span><strong>{MODOS_FINANZAS[m].t}{m === 'no' ? ' (así viene)' : ''}</strong><small>{MODOS_FINANZAS[m].d}</small></span>
        </label>
      ))}
      {puede && <button className="btn btn-ancho" disabled={modo === actual || guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</button>}
      {msg && <div className={`aviso ${msg.ok ? 'aviso-ok' : 'aviso-error'}`}>{msg.t}</div>}
      {modo !== 'no' && (
        <button type="button" className="btn-texto" onClick={() => setVerPrevia((v) => !v)}>{verPrevia ? 'Ocultar la vista previa' : `Ver lo que verían los vecinos (${mes(periodo)})`}</button>
      )}
      {modo !== 'no' && verPrevia && vista && <div className="previa-finanzas"><ResumenFinanzas d={vista} conGastos={modo === 'detalle'} /></div>}
    </Tarjeta>
  );
}

/** Junta: recordatorio amable a cada casa (3 días antes de vencer su recibo y el día después). */
export function OpcionRecordatorio() {
  const s = api.sesion()!;
  const puede = ['presidente', 'administrador', 'tesorero'].includes(s.rol);
  const cfg = useCarga(() => api.convivencia());
  const [activo, setActivo] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => { if (cfg.datos) setActivo(cfg.datos.recordatorioVencimiento ?? true); }, [cfg.datos]);
  async function cambiar(v: boolean) {
    setActivo(v); setMsg(null);
    try { await api.fijarRecordatorioVencimiento(v); setMsg({ ok: true, t: v ? 'Encendido.' : 'Apagado: no se enviarán recordatorios.' }); }
    catch (e) { setActivo(!v); setMsg({ ok: false, t: (e as Error).message }); }
  }
  if (activo == null) return null;
  return (
    <Tarjeta titulo="Recordatorio de pago">
      <label className="interruptor">
        <input type="checkbox" checked={activo} disabled={!puede} onChange={(e) => void cambiar(e.target.checked)} />
        <span><strong>Recordarle a cada casa su recibo</strong>
          <small>3 días antes de que venza y el día después, solo si tiene saldo pendiente. Le llega solo a esa casa, con su monto y un acceso directo a Pagar. Si ya reportó el pago, no se le molesta.</small></span>
      </label>
      {!puede && <p className="nota">Solo presidencia, tesorería o la administración cambia esta opción.</p>}
      {msg && <div className={`aviso ${msg.ok ? 'aviso-ok' : 'aviso-error'}`}>{msg.t}</div>}
    </Tarjeta>
  );
}
