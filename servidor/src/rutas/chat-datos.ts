// Lectura y armado de mensajes del chat (lo usan las rutas y el hub de tiempo real).
import type { Adjunto, Mensaje } from '../../../compartido/tipos.js';
import type { Tx } from '../db/conexion.js';

/** Columnas de un mensaje con su autor, casa y adjunto. `estado` solo se calcula para mensajes propios. */
export const SELECT_MENSAJE = `
  select m.id, m.conversacion_id, m.autor_id, m.como_junta, m.tipo, m.texto, m.creado_en, m.editado_en, m.eliminado_en,
         nombre_visible(m.autor_id) as autor_nombre,
         case when u.id is null then null else etiqueta_unidad(u) end as autor_casa,
         a.id as a_id, a.nombre as a_nombre, a.mime as a_mime, a.bytes as a_bytes, a.path as a_path,
         a.expira_en as a_expira, a.eliminado_en as a_eliminado,
         case when m.autor_id = auth.uid() then estado_mensaje(m.id) end as estado
    from mensajes m
    left join unidades u on u.id = m.autor_unidad_id
    left join adjuntos a on a.id = m.adjunto_id`;

export type FilaMensaje = Record<string, any>;

export async function mapMensaje(f: FilaMensaje, yo: string | null,
                                 firmar: (path: string) => Promise<string | null>): Promise<Mensaje> {
  const eliminado = Boolean(f.eliminado_en);
  let adjunto: Adjunto | null = null;
  if (f.a_id && !eliminado) {
    const vencido = Boolean(f.a_eliminado) || new Date(f.a_expira) < new Date();
    adjunto = {
      id: f.a_id, nombre: f.a_nombre, mime: f.a_mime, bytes: f.a_bytes,
      url: vencido ? null : await firmar(f.a_path),
      expiraEn: new Date(f.a_expira).toISOString(), vencido, guardadoLocal: false,
    };
  }
  const esMio = yo !== null && f.autor_id === yo;
  return {
    id: f.id, conversacionId: f.conversacion_id,
    autorNombre: f.autor_nombre ?? null,
    autorEtiqueta: f.como_junta ? 'Junta de condominio' : (f.autor_casa ?? 'Sistema'),
    esMio, comoJunta: f.como_junta, tipo: f.tipo,
    texto: eliminado ? null : f.texto, adjunto,
    creadoEn: new Date(f.creado_en).toISOString(), editado: Boolean(f.editado_en), eliminado,
    estado: esMio ? ((f.estado ?? 1) as 1 | 2 | 3) : null,
  };
}

export async function leerMensaje(c: Tx, id: string) {
  return (await c.query(`${SELECT_MENSAJE} where m.id = $1`, [id])).rows[0] as FilaMensaje | undefined;
}
