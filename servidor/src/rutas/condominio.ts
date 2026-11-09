// Datos generales del condominio: ficha, marca (logo y foto de la entrada), cuentas de pago, tasa BCV y avisos.
// CONVENCIÓN para todos los módulos de rutas:
//   · Rutas de un condominio: /c/:cid/...  (el permiso real lo decide la base de datos con RLS)
//   · Siempre bd(req, c => …): transacción con la identidad del usuario
//   · Validar el cuerpo con zod; responder en camelCase con los tipos de /compartido/tipos.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Aviso, Condominio, CuentaFinanciera, LecturaTasa, Marca, TasaBcv } from '../../../compartido/tipos.js';
import { bd, una } from '../contexto.js';
import { guardarArchivo, leerFormulario, urlFirmada } from '../archivos/archivos.js';
import { ErrorApi } from '../util/errores.js';
import { exigirFinanzas, exigirJunta, iso, num } from './_comun.js';

export const ParamsC = z.object({ cid: z.guid() });
export const Uuid = z.guid();
export const Periodo = z.string().regex(/^\d{4}-\d{2}-01$/, 'debe ser AAAA-MM-01');

export default async function rutasCondominio(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get('/c/:cid', async (req): Promise<Condominio> => {
    const { cid } = ParamsC.parse(req.params);
    const c = una(await bd(req, async (t) => (await t.query(`select * from condominios where id = $1`, [cid])).rows), 'Condominio');
    return { id: c.id, nombre: c.nombre, rif: c.rif, direccion: c.direccion, fondoReservaPct: c.fondo_reserva_pct,
             diaVencimiento: c.dia_vencimiento, chatVecinos: Boolean(c.chat_vecinos) };
  });

  // La junta decide si los vecinos pueden escribirse casa ↔ casa (presidencia o administración).
  app.put('/c/:cid/chat-vecinos', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({ activo: z.boolean() }).parse(req.body);
    await bd(req, (t) => t.query(`select fijar_chat_vecinos($1, $2)`, [cid, d.activo]));
    return rep.status(204).send();
  });

  app.get('/c/:cid/marca', async (req): Promise<Marca> => {
    const { cid } = ParamsC.parse(req.params);
    const c = una(await bd(req, async (t) => (await t.query(`select * from condominios where id = $1`, [cid])).rows), 'Condominio');
    return {
      nombre: c.nombre, nombreAsociacion: c.nombre_asociacion, rif: c.rif, direccion: c.direccion, ciudad: c.ciudad,
      telefono: c.telefono, correo: c.correo, colorPrimario: c.color_primario,
      logoUrl: await urlFirmada(ctx, 'marca', c.logo_path), fotoEntradaUrl: await urlFirmada(ctx, 'marca', c.foto_entrada_path),
    };
  });

  // multipart: campos de texto (nombre, nombreAsociacion, rif, direccion, ciudad, telefono, correo, colorPrimario)
  // + archivos opcionales "logo" y "fotoEntrada". Solo presidente/administrador (lo decide la política de condominios).
  app.patch('/c/:cid/marca', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const { campos, archivos } = await leerFormulario(req);
    const d = z.object({
      nombre: z.string().trim().min(2).max(150).optional(), nombreAsociacion: z.string().trim().max(200).optional(),
      rif: z.string().trim().max(20).optional(), direccion: z.string().trim().max(300).optional(),
      ciudad: z.string().trim().max(100).optional(), telefono: z.string().trim().max(40).optional(),
      correo: z.string().trim().max(200).optional(), colorPrimario: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }).parse(campos);
    const logo = archivos.logo?.[0], foto = archivos.fotoEntrada?.[0];
    for (const a of [logo, foto]) if (a && !a.mime.startsWith('image/')) throw new ErrorApi(400, 'El logo y la foto deben ser imágenes', 'invalido');
    await bd(req, async (t) => {
      const logoPath = logo ? await guardarArchivo(ctx, t, 'marca', `${cid}/logo-${Date.now()}.${logo.mime === 'image/png' ? 'png' : 'jpg'}`, logo) : null;
      const fotoPath = foto ? await guardarArchivo(ctx, t, 'marca', `${cid}/entrada-${Date.now()}.jpg`, foto) : null;
      const r = await t.query(`update condominios set
          nombre = coalesce($2, nombre), nombre_asociacion = coalesce($3, nombre_asociacion), rif = coalesce($4, rif),
          direccion = coalesce($5, direccion), ciudad = coalesce($6, ciudad), telefono = coalesce($7, telefono),
          correo = coalesce($8, correo), color_primario = coalesce($9, color_primario),
          logo_path = coalesce($10, logo_path), foto_entrada_path = coalesce($11, foto_entrada_path)
        where id = $1`,
        [cid, d.nombre, d.nombreAsociacion, d.rif, d.direccion, d.ciudad, d.telefono, d.correo, d.colorPrimario, logoPath, fotoPath]);
      if (!r.rowCount) throw new ErrorApi(403, 'Solo presidencia o la administración cambia la marca', 'sin_permiso');
    });
    return rep.status(204).send();
  });

  app.get('/c/:cid/cuentas', async (req): Promise<CuentaFinanciera[]> => {
    const { cid } = ParamsC.parse(req.params);
    const filas = await bd(req, async (t) => (await t.query(
      `select * from cuentas_financieras where condominio_id = $1 and activa order by tipo, nombre`, [cid])).rows);
    return filas.map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, moneda: c.moneda, datosPago: c.datos_pago }));
  });

  // Tasa BCV que rige un día (por defecto hoy, hora de Caracas). Solo se entrega si DOS fuentes coinciden
  // (0022_tasa_verificada.sql); si no, usdVes = null y "motivo" dice por qué. La app no deja pagar en Bs sin ella.
  app.get('/tasa-bcv', async (req): Promise<TasaBcv> => {
    const { fecha } = z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    const t = await bd(req, async (c) => (await c.query(`select * from estado_tasa($1::date)`, [fecha ?? null])).rows[0]);
    return mapTasa(t);
  });

  // La junta (finanzas) confirma la tasa como una fuente más: con otra fuente que coincida, queda verificada.
  app.post('/c/:cid/tasa-bcv', async (req) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({ usdVes: z.number().positive().max(1e7), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body);
    return bd(req, async (c) => {
      await exigirFinanzas(c, cid);
      const r = (await c.query(`select * from confirmar_tasa_manual($1, $2::date)`, [d.usdVes, d.fecha ?? null])).rows[0];
      const t = (await c.query(`select * from estado_tasa($1::date)`, [d.fecha ?? null])).rows[0];
      return { resultado: r.estado as 'verificada' | 'una_fuente' | 'no_coinciden' | 'sin_datos', tasa: mapTasa(t) };
    });
  });

  // Lo que dijo cada fuente en las últimas 24 horas (para que la junta vea de dónde sale el número).
  app.get('/c/:cid/tasa-bcv/lecturas', async (req): Promise<LecturaTasa[]> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      await exigirJunta(c, cid);
      return (await c.query(`select * from lecturas_tasa_recientes() order by leida_en desc`)).rows.map((l) => ({
        fuente: l.fuente, automatica: l.automatica, fechaValor: l.fecha_valor, usdVes: l.usd_ves == null ? null : num(l.usd_ves),
        error: l.error, leidaEn: iso(l.leida_en)!,
      }));
    });
  });

  app.get('/c/:cid/avisos', async (req): Promise<Aviso[]> => {
    const { cid } = ParamsC.parse(req.params);
    const filas = await bd(req, async (t) => (await t.query(
      `select * from avisos where condominio_id = $1 order by fijado desc, creado_en desc limit 50`, [cid])).rows);
    return filas.map((a) => ({ id: a.id, titulo: a.titulo, cuerpo: a.cuerpo, fijado: a.fijado, creadoEn: a.creado_en.toISOString() }));
  });

  app.post('/c/:cid/avisos', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({ titulo: z.string().trim().min(3).max(120), cuerpo: z.string().trim().min(3).max(4000), fijado: z.boolean().default(false) }).parse(req.body);
    const r = await bd(req, (t) => t.query(`insert into avisos (condominio_id, titulo, cuerpo, fijado, creado_por) values ($1, $2, $3, $4, auth.uid()) returning id`,
      [cid, d.titulo, d.cuerpo, d.fijado]));
    return rep.status(201).send({ id: r.rows[0].id });
  });

  app.delete('/c/:cid/avisos/:id', async (req, rep) => {
    const p = ParamsC.extend({ id: Uuid }).parse(req.params);
    const r = await bd(req, (t) => t.query(`delete from avisos where id = $1 and condominio_id = $2`, [p.id, p.cid]));
    if (!r.rowCount) throw new ErrorApi(403, 'Sin permiso', 'sin_permiso');
    return rep.status(204).send();
  });
}

export function mapTasa(t: Record<string, any>): TasaBcv {
  return {
    hoy: t.hoy, fecha: t.fecha, usdVes: t.usd_ves == null ? null : num(t.usd_ves), verificada: Boolean(t.verificada),
    fuentes: (t.fuentes ?? []).map((f: string) => f.startsWith('junta:') ? 'Junta' : f.startsWith('consola:') ? 'Technical Digital TD' : f),
    verificadaEn: iso(t.verificada_en), ultimaConsulta: iso(t.ultima_consulta), motivo: t.motivo ?? null,
  };
}
