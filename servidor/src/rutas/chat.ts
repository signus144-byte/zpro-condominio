// Chat por casa (CONTRATO_API.md §8). Los permisos los deciden las funciones y políticas de 0005_chat.sql:
// la junta no lee chats entre vecinos, nadie escribe como otra casa, en el canal solo escribe la junta, etc.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversacion, Mensaje } from '../../../compartido/tipos.js';
import { bd, una } from '../contexto.js';
import type { Tx } from '../db/conexion.js';
import { guardarArchivo, leerFormulario, nombreUnico, urlFirmada, type ArchivoSubido } from '../archivos/archivos.js';
import { ErrorApi } from '../util/errores.js';
import { ParamsC, Uuid } from './condominio.js';
import { SELECT_MENSAJE, leerMensaje, mapMensaje, type FilaMensaje } from './chat-datos.js';

const ParamsConv = ParamsC.extend({ id: Uuid });

const SUBTITULO: Record<string, (junta: boolean) => string> = {
  directa: () => 'Vecino',
  junta: (junta) => (junta ? 'Conversación con la junta' : 'Presidencia, tesorería y vocales'),
  grupo: () => 'Grupo',
  canal: () => 'Canal · solo la junta escribe',
};

/** La conversación existe, la puedo ver (RLS) y es de este condominio. */
async function exigirConversacion(c: Tx, cid: string, id: string) {
  const r = await c.query(`select id, tipo, condominio_id from conversaciones where id = $1`, [id]);
  if (!r.rows[0] || r.rows[0].condominio_id !== cid) throw new ErrorApi(404, 'Conversación no existe', 'no_encontrado');
  return r.rows[0] as { id: string; tipo: string };
}

/** Mi casa en este condominio (la primera si tuviera varias). */
async function miUnidad(c: Tx, cid: string): Promise<string | null> {
  const r = await c.query(`select unidad_id from membresias
                            where usuario_id = auth.uid() and condominio_id = $1 and activo and unidad_id is not null
                            order by alta_en limit 1`, [cid]);
  return r.rows[0]?.unidad_id ?? null;
}

const tipoPorMime = (mime: string) => (mime.startsWith('image/') ? 'imagen' : mime.startsWith('audio/') ? 'audio' : 'archivo');

export default async function rutasChat(app: FastifyInstance) {
  const ctx = app.ctx;
  const firmar = (path: string) => urlFirmada(ctx, 'chat', path);
  const armar = (f: FilaMensaje, req: FastifyRequest) => mapMensaje(f, req.usuarioId, firmar);

  // Bandeja: todas las conversaciones que puedo ver, con título según quién mira, último mensaje y no leídos.
  app.get('/c/:cid/conversaciones', async (req): Promise<Conversacion[]> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      const junta = (await c.query(`select es_junta($1) as j`, [cid])).rows[0].j as boolean;
      const unidad = await miUnidad(c, cid);
      const filas = (await c.query(`
        select b.*, (puedo_escribir(b.id, $2, false) or puedo_escribir(b.id, null, true)) as puedo_escribir
          from bandeja($1) b`, [cid, unidad])).rows;
      // Nombres del directorio para titular las conversaciones con casas ("Casa 28 · Familia Pérez").
      const dir = new Map<string, string[]>(
        (await c.query(`select etiqueta, nombres from directorio($1)`, [cid])).rows.map((d) => [d.etiqueta, d.nombres]));
      return filas.map((b) => {
        const nombres = (b.tipo === 'directa' || (b.tipo === 'junta' && junta)) ? dir.get(b.titulo) ?? [] : [];
        return {
          id: b.id, tipo: b.tipo,
          titulo: nombres.length ? `${b.titulo} · ${nombres.join(', ')}` : (b.titulo ?? ''),
          subtitulo: SUBTITULO[b.tipo]?.(junta) ?? null,
          ultimoMensaje: b.ultimo_texto ? `${b.ultimo_autor_soy_yo ? 'Usted: ' : ''}${b.ultimo_texto}` : null,
          ultimoMensajeEn: b.ultimo_en ? new Date(b.ultimo_en).toISOString() : null,
          noLeidos: b.no_leidos, puedoEscribir: b.puedo_escribir,
        };
      });
    });
  });

  // Abrir conversación con una casa. Residente: casa ↔ casa. Junta (sin casa, o con comoJunta): junta ↔ casa.
  app.post('/c/:cid/conversaciones/casa', async (req) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({ unidadId: Uuid, comoJunta: z.boolean().optional() }).parse(req.body);
    return bd(req, async (c) => {
      const unidad = await miUnidad(c, cid);
      const junta = (await c.query(`select es_junta($1) as j`, [cid])).rows[0].j as boolean;
      const usarJunta = junta && (d.comoJunta === true || !unidad);
      if (!usarJunta && !unidad) throw new ErrorApi(403, 'Su usuario no tiene casa asignada en este condominio', 'sin_permiso');
      const r = usarJunta
        ? await c.query(`select abrir_con_junta($1) as id`, [d.unidadId])
        : await c.query(`select abrir_directa($1, $2) as id`, [unidad, d.unidadId]);
      return { id: r.rows[0].id as string };
    });
  });

  // Residente → junta.
  app.post('/c/:cid/conversaciones/junta', async (req) => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      const unidad = await miUnidad(c, cid);
      if (!unidad) throw new ErrorApi(403, 'Su usuario no tiene casa asignada en este condominio', 'sin_permiso');
      return { id: (await c.query(`select abrir_con_junta($1) as id`, [unidad])).rows[0].id as string };
    });
  });

  // Grupo o canal (solo junta: lo valida crear_sala).
  app.post('/c/:cid/salas', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({
      tipo: z.enum(['grupo', 'canal']), titulo: z.string().trim().min(2).max(80),
      unidades: z.array(Uuid).max(1000).default([]), soloJuntaEscribe: z.boolean().default(false),
    }).parse(req.body);
    const r = await bd(req, (c) => c.query(`select crear_sala($1, $2::tipo_conversacion, $3, $4::uuid[], $5) as id`,
      [cid, d.tipo, d.titulo, d.unidades, d.soloJuntaEscribe]));
    return rep.status(201).send({ id: r.rows[0].id });
  });

  // Mensajes en orden cronológico; paginación hacia atrás con ?antes=<ISO>.
  app.get('/c/:cid/conversaciones/:id/mensajes', async (req): Promise<Mensaje[]> => {
    const p = ParamsConv.parse(req.params);
    const q = z.object({ antes: z.iso.datetime({ offset: true }).optional(), limite: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const filas = await bd(req, async (c) => {
      await exigirConversacion(c, p.cid, p.id);
      return (await c.query(`${SELECT_MENSAJE}
         where m.conversacion_id = $1 and ($2::timestamptz is null or m.creado_en < $2)
         order by m.creado_en desc limit $3`, [p.id, q.antes ?? null, q.limite])).rows;
    });
    return Promise.all(filas.reverse().map((f) => armar(f, req)));
  });

  // Enviar: JSON {texto, comoJunta?} o multipart (texto?, comoJunta?, archivo?).
  app.post('/c/:cid/conversaciones/:id/mensajes', async (req, rep) => {
    const p = ParamsConv.parse(req.params);
    let campos: Record<string, unknown> = {};
    let archivo: ArchivoSubido | undefined;
    if (req.isMultipart()) {
      const f = await leerFormulario(req);
      campos = { ...f.campos, comoJunta: f.campos.comoJunta === 'true' || f.campos.comoJunta === '1' };
      archivo = f.archivos.archivo?.[0];
    } else campos = (req.body ?? {}) as Record<string, unknown>;
    const d = z.object({ texto: z.string().trim().max(4000).optional(), comoJunta: z.boolean().optional(),
                         respondeA: Uuid.optional() }).parse(campos);
    const texto = d.texto || null;
    if (!texto && !archivo) throw new ErrorApi(400, 'Escriba un mensaje o adjunte un archivo', 'invalido');

    const fila = await bd(req, async (c) => {
      await exigirConversacion(c, p.cid, p.id);
      // ¿Desde qué casa escribo? La mía que sea parte de la conversación. Si no tengo y soy junta, como junta.
      const parte = (await c.query(`select unidad_id from conversacion_partes
                                     where conversacion_id = $1 and unidad_id in (select mis_unidades()) limit 1`, [p.id])).rows[0];
      let comoJunta = d.comoJunta === true;
      if (!comoJunta && !parte) {
        const j = (await c.query(`select es_junta($1) and exists (select 1 from conversacion_partes where conversacion_id = $2 and es_junta)
                                    or (es_junta($1) and (select tipo from conversaciones where id = $2) = 'canal') as j`, [p.cid, p.id])).rows[0].j;
        if (j) comoJunta = true;
      }
      let adjuntoId: string | null = null;
      if (archivo) {
        const ruta = nombreUnico(`${p.cid}/${p.id}`, archivo);
        await guardarArchivo(ctx, c, 'chat', ruta, archivo);
        adjuntoId = (await c.query(`select registrar_adjunto($1, $2, $3, $4, $5, $6) as id`,
          [p.id, ruta, archivo.nombreOriginal.slice(0, 200) || 'archivo', archivo.mime, archivo.datos.length, archivo.sha256])).rows[0].id;
      }
      const ins = await c.query(`insert into mensajes (conversacion_id, autor_unidad_id, como_junta, tipo, texto, adjunto_id, responde_a)
                                 values ($1, $2, $3, $4::tipo_mensaje, $5, $6, $7) returning id`,
        [p.id, comoJunta ? null : parte?.unidad_id ?? null, comoJunta,
         archivo ? tipoPorMime(archivo.mime) : 'texto', texto, adjuntoId, d.respondeA ?? null]);
      return una([await leerMensaje(c, ins.rows[0].id)].filter(Boolean) as FilaMensaje[], 'Mensaje');
    });
    return rep.status(201).send(await armar(fila, req));
  });

  // Editar (15 min) o eliminar un mensaje propio (lo controla el disparador mensajes_antes_de_actualizar).
  app.patch('/c/:cid/mensajes/:id', async (req, rep) => {
    const p = ParamsConv.parse(req.params);
    const d = z.union([
      z.object({ eliminar: z.literal(true) }),
      z.object({ texto: z.string().trim().min(1).max(4000) }),
    ]).parse(req.body);
    const r = await bd(req, (c) => ('eliminar' in d
      ? c.query(`update mensajes set eliminado_en = now() where id = $1 and condominio_id = $2 and autor_id = auth.uid()`, [p.id, p.cid])
      : c.query(`update mensajes set texto = $3 where id = $1 and condominio_id = $2 and autor_id = auth.uid()`, [p.id, p.cid, d.texto])));
    if (!r.rowCount) throw new ErrorApi(403, 'Solo el autor modifica su mensaje', 'sin_permiso');
    return rep.status(204).send();
  });

  app.post('/c/:cid/conversaciones/:id/leido', async (req, rep) => {
    const p = ParamsConv.parse(req.params);
    await bd(req, async (c) => { await exigirConversacion(c, p.cid, p.id); await c.query(`select marcar_leido($1)`, [p.id]); });
    return rep.status(204).send();
  });

  app.post('/c/:cid/conversaciones/:id/silenciar', async (req, rep) => {
    const p = ParamsConv.parse(req.params);
    const d = z.object({ silenciar: z.boolean() }).parse(req.body);
    await bd(req, async (c) => { await exigirConversacion(c, p.cid, p.id); await c.query(`select silenciar_conversacion($1, $2)`, [p.id, d.silenciar]); });
    return rep.status(204).send();
  });

  app.get('/c/:cid/chat/estado', async (req) => {
    const { cid } = ParamsC.parse(req.params);
    const r = await bd(req, (c) => c.query(`select bloqueadas, silenciadas from mi_estado_chat($1)`, [cid]));
    return { bloqueadas: r.rows[0]?.bloqueadas ?? [], silenciadas: r.rows[0]?.silenciadas ?? [] };
  });

  app.post('/c/:cid/bloqueos', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({ unidadId: Uuid }).parse(req.body);
    await bd(req, async (c) => {
      const unidad = await miUnidad(c, cid);
      if (!unidad) throw new ErrorApi(403, 'Solo una casa puede bloquear a otra', 'sin_permiso');
      if (unidad === d.unidadId) throw new ErrorApi(400, 'No puede bloquear su propia casa', 'invalido');
      await c.query(`insert into bloqueos_chat (unidad_id, bloqueada_id) values ($1, $2) on conflict do nothing`, [unidad, d.unidadId]);
    });
    return rep.status(204).send();
  });

  app.delete('/c/:cid/bloqueos/:unidadId', async (req, rep) => {
    const p = ParamsC.extend({ unidadId: Uuid }).parse(req.params);
    await bd(req, (c) => c.query(`delete from bloqueos_chat where unidad_id in (select mis_unidades()) and bloqueada_id = $1`, [p.unidadId]));
    return rep.status(204).send();
  });

  app.post('/c/:cid/mensajes/:id/denunciar', async (req, rep) => {
    const p = ParamsConv.parse(req.params);
    const d = z.object({ motivo: z.string().trim().min(3).max(500) }).parse(req.body);
    await bd(req, (c) => c.query(`insert into denuncias_mensaje (mensaje_id, condominio_id, denunciado_por, motivo)
                                  values ($1, $2, auth.uid(), $3) on conflict (mensaje_id, denunciado_por) do nothing`, [p.id, p.cid, d.motivo]));
    return rep.status(204).send();
  });

  // Extra (junta): denuncias recibidas con el mensaje denunciado (y solo ese).
  app.get('/c/:cid/denuncias', async (req) => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      const ds = (await c.query(`select d.id, d.motivo, d.estado, d.creado_en, m.* from denuncias_mensaje d
                                  cross join lateral mensaje_denunciado(d.id) m
                                  where d.condominio_id = $1 order by d.creado_en desc limit 100`, [cid])).rows;
      return ds.map((x) => ({ id: x.id, motivo: x.motivo, estado: x.estado, creadoEn: new Date(x.creado_en).toISOString(),
                              mensaje: { texto: x.texto, autor: x.autor, casa: x.casa, creadoEn: x.creado_en ? new Date(x.creado_en).toISOString() : null } }));
    });
  });
}
