// Tasa BCV del día en pantalla. Regla de oro: SIEMPRE se consulta al abrir la pantalla y al volver a la app.
// Nunca se cobra con una tasa guardada de otro día: sin conexión o sin dos fuentes que coincidan, no hay monto en Bs.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type TasaBcv } from '../data';
import { fecha as fechaTxt } from '../formato';

export interface EstadoTasa {
  tasa: TasaBcv | null;           // respuesta (verificada o con motivo)
  usdVes: number | null;          // solo si está verificada para ese día
  cargando: boolean;
  sinConexion: boolean;
  recargar: () => void;
}

const esRed = (e: unknown) => (e as { codigo?: string }).codigo === 'red' || /conexi[oó]n|internet|fetch/i.test(String((e as Error)?.message));

export function useTasaDelDia(fecha?: string): EstadoTasa {
  const [tasa, setTasa] = useState<TasaBcv | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sinConexion, setSinConexion] = useState(false);
  const pedido = useRef(0);
  const cargar = useCallback(() => {
    const n = ++pedido.current;
    setCargando(true);
    api.tasaBcv(fecha)
      .then((t) => { if (n === pedido.current) { setTasa(t); setSinConexion(false); } })
      .catch((e) => { if (n === pedido.current) { setTasa(null); setSinConexion(esRed(e)); } })
      .finally(() => { if (n === pedido.current) setCargando(false); });
  }, [fecha]);
  useEffect(() => { cargar(); }, [cargar]);
  // Al volver a la app (o al día siguiente con la app abierta), se vuelve a consultar.
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('online', cargar);
    return () => { document.removeEventListener('visibilitychange', alVolver); window.removeEventListener('online', cargar); };
  }, [cargar]);
  return { tasa, usdVes: tasa?.verificada ? tasa.usdVes : null, cargando, sinConexion, recargar: cargar };
}

const tasaTxt = (x: number) => x.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' }) : '');
const fuentesTxt = (f: string[]) => (f.length <= 1 ? f.join('') : `${f.slice(0, -1).join(', ')} y ${f[f.length - 1]}`);

/** Línea corta con la tasa verificada (o el aviso de que no hay). */
export function LineaTasa({ t }: { t: EstadoTasa }) {
  if (t.cargando && !t.tasa) return <p className="tasa-linea">Consultando la tasa BCV de hoy…</p>;
  if (t.usdVes && t.tasa) {
    return (
      <p className="tasa-linea tasa-ok">
        <strong>Tasa BCV {tasaTxt(t.usdVes)} Bs/$</strong>
        <span>Fecha valor {fechaTxt(t.tasa.fecha!)} · comprobada con {fuentesTxt(t.tasa.fuentes)}{t.tasa.verificadaEn ? ` a las ${hora(t.tasa.verificadaEn)}` : ''}</span>
      </p>
    );
  }
  return <p className="tasa-linea tasa-falta">{t.sinConexion ? 'Sin conexión: no se puede mostrar el monto en bolívares de hoy.' : t.tasa?.motivo ?? 'Tasa BCV no disponible.'}</p>;
}

/** Aviso que BLOQUEA el pago en bolívares cuando no hay tasa verificada para ese día. */
export function BloqueoTasa({ t, accion = 'pagar en bolívares' }: { t: EstadoTasa; accion?: string }) {
  if (t.usdVes || (t.cargando && !t.tasa && !t.sinConexion)) return null;
  return (
    <div className="aviso aviso-error bloqueo-tasa" role="alert">
      <strong>{t.sinConexion ? 'Conéctese a internet' : 'Tasa BCV sin confirmar'}</strong>
      <p>{t.sinConexion
        ? `Para ${accion} hace falta la tasa BCV de hoy, y se consulta en el momento. Conéctese a internet (datos o Wi-Fi) y toque “Actualizar”.`
        : `${t.tasa?.motivo ?? 'No hay tasa verificada.'} Para no cobrarle un monto equivocado, no se puede ${accion} hasta que la tasa esté confirmada.`}</p>
      <button type="button" className="btn btn-sec" onClick={t.recargar} disabled={t.cargando}>{t.cargando ? 'Consultando…' : 'Actualizar'}</button>
    </div>
  );
}
