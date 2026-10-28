// Consola master de ZentaPro (CONTRATO_API.md §9). Solo personal de la plataforma (plataforma_admins).
// El permiso real lo dan las políticas y funciones de la BD (es_admin_plataforma); aquí además se exige
// el rol al principio para responder 403 claro en vez de listas vacías.
// Privacidad: nada de esto expone chats, pagos de residentes ni autoría de reportes anónimos.
import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  AdminPlataforma, CambiosPlan, CodigoUnidad, Condominio, Factura, PagoPlataforma, Plan, ResultadoFacturacion, SolicitudIngreso, UsuarioSoporte,
} from '../../../compartido/plataforma.js';
import { bd, una, type Contexto } from '../contexto.js';
import type { Tx } from '../db/conexion.js';
import { guardarArchivo, leerFormulario, urlFirmada } from '../archivos/archivos.js';
import { ErrorApi } from '../util/errores.js';
import { Periodo, Uuid } from './condominio.js';

type Rol = 'dueno' | 'soporte' | 'finanzas';
const TODOS: Rol[] = ['dueno', 'soporte', 'finanzas'];

/** Exige uno de los roles de plataforma (403 si no). */
async function exigir(req: FastifyRequest, roles: Rol[] = TODOS) {
  const r = await bd(req, (c) => c.query(`select es_admin_plataforma($1::rol_plataforma[]) as ok`, [roles]));
  if (!r.rows[0].ok) throw new ErrorApi(403, 'Solo el equipo de ZentaPro (con el rol adecuado) puede hacer esto', 'sin_permiso');
}

// ---------- Códigos legibles (sin 0/O/1/I, fáciles de dictar por teléfono) ----------
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const aleatorio = (n: number) => Array.from({ length: n }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
export function codigoActivacion(nombre: string) {
  const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\b(RESIDENCIAS?|CONJUNTO|RESIDENCIAL|URBANIZACION|URB|EDIFICIO|EDF|RES|TORRES?|CENTRO|COMERCIAL|LOS|LAS|EL|LA|DE|DEL)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')[0] || 'CONDO';
  return `${base.slice(0, 8)}-${aleatorio(4)}`;
}
const prefijoUnidad = (bloque: string | null, numero: string) =>
  `${bloque ?? ''}${numero}`.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'U';

// ---------- Mapeos ----------
type Fila = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function aCondominio(ctx: Contexto, c: Fila, m: Fila = {}): Promise<Condominio> {
  return {
    id: c.id, nombre: c.nombre, tipo: c.tipo, ciudad: c.ciudad, estadoGeo: c.estado_geo, direccion: c.direccion,
    telefono: c.telefono, correo: c.correo, nombreAsociacion: c.nombre_asociacion, rif: c.rif, colorPrimario: c.color_primario,
    logoUrl: await urlFirmada(ctx, 'marca', c.logo_path), fotoEntradaUrl: await urlFirmada(ctx, 'marca', c.foto_entrada_path),
    estado: c.estado, planId: c.plan_id,
    precioEspecialUsd: c.precio_especial_usd ?? null, notaPrecio: c.nota_precio ?? null, mensualidadUsd: c.mensualidad_usd ?? null,
    pruebaHasta: c.prueba_hasta, activadoEn: c.activado_en?.toISOString?.() ?? null,
    codigoActivacion: c.codigo_activacion, creadoEn: c.creado_en.toISOString(),
    unidades: Number(m.unidades ?? 0), usuarios: Number(m.usuarios ?? 0), unidadesConApp: Number(m.unidades_con_app ?? 0),
    morosidadPct: m.morosidad_pct == null ? null : Number(m.morosidad_pct), ultimaFactura: m.ultima_factura ?? null,
  };
}

async function condominios(ctx: Contexto, c: Tx, id?: string): Promise<Condominio[]> {
  const filas = (await c.query(`select c.*, mensualidad_usd(c.id) as mensualidad_usd from condominios c
                                 ${id ? 'where c.id = $1' : ''} order by c.nombre`, id ? [id] : [])).rows;
  const met = new Map((await c.query(`select * from metricas_plataforma()`)).rows.map((m) => [m.condominio_id, m]));
  return Promise.all(filas.map((f) => aCondominio(ctx, f, met.get(f.id))));
}

const aFactura = (f: Fila): Factura => ({
  id: f.id, condominioId: f.condominio_id, condominioNombre: f.condominio ?? '', periodo: f.periodo, planId: f.plan_id,
  unidadesFacturadas: f.unidades_facturadas, precioEspecial: Boolean(f.precio_especial), montoUsd: f.monto_usd, tasaBcv: f.tasa_bcv,
  montoVes: f.monto_ves, abonadoUsd: Number(f.abonado_usd ?? 0), vence: f.vence, estado: f.estado, numeroControl: f.numero_control, pagadaEn: f.pagada_en?.toISOString?.() ?? null,
});

const aPlan = (p: Fila): Plan => ({
  id: p.id, nombre: p.nombre, descripcion: p.descripcion ?? null, precioUsdMes: p.precio_usd_mes,
  hastaUnidades: p.hasta_unidades ?? null, retencionAdjuntosDias: p.retencion_adjuntos_dias, incluye: p.incluye ?? {},
});

// ---------- Validación del alta ----------
const TiposUnidad = z.enum(['apartamento', 'casa', 'local', 'oficina', 'townhouse']);
const UnidadImport = z.object({
  bloque: z.string().trim().max(20).nullable().transform((b) => (b ? b : null)),
  numero: z.string().trim().min(1).max(20),
  tipo: TiposUnidad,
  alicuota: z.number().positive().max(100),
  propietario: z.string().trim().max(150).nullable().transform((p) => (p ? p : null)),
});
const NuevoCondominio = z.object({
  nombre: z.string().trim().min(3).max(150),
  tipo: z.enum(['edificio', 'conjunto_residencial', 'urbanizacion', 'centro_comercial']),
  ciudad: z.string().trim().max(100).default(''), estadoGeo: z.string().trim().max(100).default(''),
  direccion: z.string().trim().max(300).default(''), telefono: z.string().trim().max(40).default(''),
  correo: z.string().trim().max(200).default(''), nombreAsociacion: z.string().trim().max(200).default(''),
  rif: z.string().trim().max(20).default(''), colorPrimario: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0f4c4a'),
  planId: z.string().max(40).optional(),   // ignorado desde v0.4: el plan sale de la cantidad de unidades
  diasPrueba: z.coerce.number().int().min(0).max(180).default(30),
  unidades: z.array(UnidadImport).min(1, 'cargue al menos una unidad').max(5000),
});

export function validarUnidades(us: z.infer<typeof UnidadImport>[]) {
  const vistos = new Set<string>();
  for (const u of us) {
    const k = `${(u.bloque ?? '').toUpperCase()}|${u.numero.toUpperCase()}`;
    if (vistos.has(k)) throw new ErrorApi(400, `Unidad repetida: ${u.bloque ? u.bloque + '-' : ''}${u.numero}`, 'invalido');
    vistos.add(k);
  }
  const suma = us.reduce((s, u) => s + u.alicuota, 0);
  if (Math.abs(suma - 100) > 0.01) {
    throw new ErrorApi(400, `Las alícuotas suman ${suma.toFixed(4)} %; deben sumar 100 % (tolerancia 0,01)`, 'invalido');
  }
}

const opcional = (s: string) => (s ? s : null);

export default async function rutasPlataforma(app: FastifyInstance) {
  const ctx = app.ctx;

  // Planes por tamaño (precio global al mes según la cantidad de unidades).
  app.get('/plataforma/planes', async (req): Promise<Plan[]> => {
    await exigir(req);
    const filas = await bd(req, async (c) => (await c.query(`select * from planes where activo and precio_usd_mes is not null
                                                              order by coalesce(hasta_unidades, 2147483647)`)).rows);
    return filas.map(aPlan);
  });

  // Cambiar precio, tope o nombre de un plan. Después todos los condominios se reubican según sus unidades.
  app.patch('/plataforma/planes/:id', async (req): Promise<Plan[]> => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const d: CambiosPlan = z.object({
      nombre: z.string().trim().min(2).max(60).optional(),
      descripcion: z.string().trim().max(200).nullable().optional(),
      precioUsdMes: z.number().positive().max(100000).optional(),
      hastaUnidades: z.number().int().positive().max(100000).nullable().optional(),
    }).parse(req.body);
    await exigir(req, ['dueno']);
    return bd(req, async (c) => {
      const r = await c.query(`update planes set nombre = coalesce($2, nombre),
            descripcion = case when $3::boolean then $4 else descripcion end,
            precio_usd_mes = coalesce($5, precio_usd_mes),
            hasta_unidades = case when $6::boolean then $7::int else hasta_unidades end
          where id = $1 and activo`,
        [id, d.nombre ?? null, d.descripcion !== undefined, d.descripcion ?? null, d.precioUsdMes ?? null,
         d.hastaUnidades !== undefined, d.hastaUnidades ?? null]);
      if (!r.rowCount) throw new ErrorApi(404, 'Plan no existe', 'no_encontrado');
      const sinTope = (await c.query(`select count(*)::int as n from planes where activo and precio_usd_mes is not null and hasta_unidades is null`)).rows[0].n;
      if (sinTope !== 1) throw new ErrorApi(400, 'Debe quedar exactamente un plan "sin límite" de unidades (el más grande)', 'invalido');
      await c.query(`select recalcular_planes()`);
      return (await c.query(`select * from planes where activo and precio_usd_mes is not null
                              order by coalesce(hasta_unidades, 2147483647)`)).rows.map(aPlan);
    });
  });

  // ---------- Condominios ----------
  app.get('/plataforma/condominios', async (req): Promise<Condominio[]> => {
    await exigir(req);
    return bd(req, (c) => condominios(ctx, c));
  });

  app.get('/plataforma/condominios/:id', async (req): Promise<Condominio> => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    await exigir(req);
    return una(await bd(req, (c) => condominios(ctx, c, id)), 'Condominio');
  });

  // Alta completa en UNA transacción: condominio + marca + unidades + cuentas de pago + código de activación.
  // multipart: campos de NuevoCondominio (unidades = JSON) + archivos "logo" y "fotoEntrada".
  app.post('/plataforma/condominios', async (req, rep) => {
    await exigir(req, ['dueno', 'soporte']);
    const { campos, archivos } = await leerFormulario(req);
    let unidades: unknown;
    try { unidades = JSON.parse(campos.unidades ?? '[]'); } catch { throw new ErrorApi(400, 'La lista de unidades no es JSON válido', 'invalido'); }
    const d = NuevoCondominio.parse({ ...campos, unidades });
    validarUnidades(d.unidades);
    const logo = archivos.logo?.[0], foto = archivos.fotoEntrada?.[0];
    for (const a of [logo, foto]) if (a && !a.mime.startsWith('image/')) throw new ErrorApi(400, 'El logo y la foto deben ser imágenes', 'invalido');

    const r = await bd(req, async (c) => {
      const plan = (await c.query(`select * from planes where id = plan_para_unidades($1)`, [d.unidades.length])).rows[0];
      if (!plan) throw new ErrorApi(400, 'No hay planes configurados', 'invalido');
      let fila: Fila | undefined;
      for (let intento = 0; !fila; intento++) {
        const codigo = codigoActivacion(d.nombre);
        await c.query('savepoint codigo');
        try {
          fila = (await c.query(`insert into condominios (nombre, tipo, ciudad, estado_geo, direccion, telefono, correo, nombre_asociacion,
                rif, color_primario, estado, plan_id, prueba_hasta, codigo_activacion, retencion_adjuntos_dias)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'prueba',$11, current_date + $12::int, $13, $14) returning id, codigo_activacion`,
            [d.nombre, d.tipo, opcional(d.ciudad), opcional(d.estadoGeo), opcional(d.direccion), opcional(d.telefono), opcional(d.correo),
             opcional(d.nombreAsociacion), opcional(d.rif), d.colorPrimario, plan.id, d.diasPrueba, codigo, plan.retencion_adjuntos_dias])).rows[0];
        } catch (e) {
          await c.query('rollback to savepoint codigo');
          if ((e as { code?: string }).code !== '23505' || intento > 5) throw e;
        }
      }
      const id = fila!.id as string;
      const logoPath = logo ? await guardarArchivo(ctx, c, 'marca', `${id}/logo-${Date.now()}.${logo.mime === 'image/png' ? 'png' : 'jpg'}`, logo) : null;
      const fotoPath = foto ? await guardarArchivo(ctx, c, 'marca', `${id}/entrada-${Date.now()}.jpg`, foto) : null;
      if (logoPath || fotoPath) await c.query(`update condominios set logo_path = $2, foto_entrada_path = $3 where id = $1`, [id, logoPath, fotoPath]);
      await c.query(`insert into unidades (condominio_id, bloque, numero, tipo, alicuota, propietario_nombre)
                     select $1, * from unnest($2::text[], $3::text[], $4::tipo_unidad[], $5::numeric[], $6::text[])`,
        [id, d.unidades.map((u) => u.bloque), d.unidades.map((u) => u.numero), d.unidades.map((u) => u.tipo),
         d.unidades.map((u) => u.alicuota), d.unidades.map((u) => u.propietario)]);
      // Cuentas de pago vacías: la junta completa los datos (teléfono de Pago Móvil, correo Zelle…).
      await c.query(`insert into cuentas_financieras (condominio_id, nombre, tipo, moneda) values
          ($1, 'Banco (Bs) · Pago Móvil', 'banco_bs', 'VES'), ($1, 'Zelle', 'zelle', 'USD'),
          ($1, 'Caja en divisas', 'caja', 'USD'), ($1, 'Fondo de reserva', 'fondo_reserva', 'USD')`, [id]);
      return { id, codigoActivacion: fila!.codigo_activacion as string };
    });
    return rep.status(201).send(r);
  });

  app.post('/plataforma/condominios/:id/estado', async (req, rep) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const d = z.object({ estado: z.enum(['prueba', 'activo', 'suspendido', 'baja']) }).parse(req.body);
    await exigir(req, ['dueno', 'soporte']);
    const r = await bd(req, (c) => c.query(`update condominios set estado = $2::estado_condominio,
        activado_en = case when $3::boolean then coalesce(activado_en, now()) else activado_en end where id = $1`, [id, d.estado, d.estado === 'activo']));
    if (!r.rowCount) throw new ErrorApi(404, 'Condominio no existe', 'no_encontrado');
    return rep.status(204).send();
  });

  // Precio especial negociado (null = vuelve al precio de su plan). Solo dueño y finanzas.
  app.post('/plataforma/condominios/:id/precio', async (req, rep) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const d = z.object({ precioEspecialUsd: z.number().positive().max(100000).nullable(),
                         nota: z.string().trim().max(200).nullable().optional() }).parse(req.body);
    await exigir(req, ['dueno', 'finanzas']);
    const r = await bd(req, (c) => c.query(`select fijar_precio_especial($1, $2, $3) as ok`, [id, d.precioEspecialUsd, d.nota ?? null]));
    if (!r.rows[0].ok) throw new ErrorApi(404, 'Condominio no existe', 'no_encontrado');
    return rep.status(204).send();
  });

  app.post('/plataforma/condominios/:id/codigo-activacion', async (req) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    await exigir(req, ['dueno', 'soporte']);
    return bd(req, async (c) => {
      const cond = una((await c.query(`select nombre from condominios where id = $1`, [id])).rows, 'Condominio');
      for (let i = 0; ; i++) {
        const codigo = codigoActivacion(cond.nombre);
        await c.query('savepoint codigo');
        try {
          await c.query(`update condominios set codigo_activacion = $2 where id = $1`, [id, codigo]);
          return { codigo };
        } catch (e) {
          await c.query('rollback to savepoint codigo');
          if ((e as { code?: string }).code !== '23505' || i > 5) throw e;
        }
      }
    });
  });

  // Un código por unidad (vence en 60 días, 3 usos, con aprobación de la junta) para imprimir y repartir.
  // Los códigos anteriores sin usar de esas unidades dejan de servir.
  app.post('/plataforma/condominios/:id/codigos-unidades', async (req): Promise<CodigoUnidad[]> => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    await exigir(req, ['dueno', 'soporte']);
    return bd(req, async (c) => {
      const us = (await c.query(`select u.*, etiqueta_unidad(u) as etiqueta from unidades u where condominio_id = $1
                                 order by bloque nulls first, numero`, [id])).rows;
      if (!us.length) throw new ErrorApi(404, 'El condominio no tiene unidades cargadas', 'no_encontrado');
      await c.query(`update codigos_acceso set expira_en = now()
                      where condominio_id = $1 and unidad_id is not null and expira_en > now() and usos = 0`, [id]);
      const salida: CodigoUnidad[] = [];
      for (const u of us) {
        for (let i = 0; ; i++) {
          const codigo = `${prefijoUnidad(u.bloque, u.numero)}-${aleatorio(4)}`;
          await c.query('savepoint cu');
          try {
            const r = await c.query(`insert into codigos_acceso (codigo, condominio_id, unidad_id, rol, creado_por)
                                     values ($1, $2, $3, 'propietario', auth.uid()) returning expira_en`, [codigo, id, u.id]);
            salida.push({ unidad: u.etiqueta, propietario: u.propietario_nombre, codigo, expiraEn: r.rows[0].expira_en.toISOString().slice(0, 10) });
            break;
          } catch (e) {
            await c.query('rollback to savepoint cu');
            if ((e as { code?: string }).code !== '23505' || i > 5) throw e;
          }
        }
      }
      return salida;
    });
  });

  // ---------- Facturación de ZentaPro ----------
  app.get('/plataforma/facturas', async (req): Promise<Factura[]> => {
    const q = z.object({ periodo: Periodo.optional() }).parse(req.query);
    await exigir(req);
    const filas = await bd(req, async (c) => (await c.query(`select f.*, c.nombre as condominio, abonado_usd_factura(f.id) as abonado_usd
        from facturas_plataforma f
        join condominios c on c.id = f.condominio_id ${q.periodo ? 'where f.periodo = $1' : ''}
        order by f.periodo desc, c.nombre`, q.periodo ? [q.periodo] : [])).rows);
    return filas.map(aFactura);
  });

  // Emite la factura del mes a cada condominio ACTIVO (cada una en su transacción: si una falla, las demás siguen).
  app.post('/plataforma/facturas/emitir', async (req): Promise<ResultadoFacturacion> => {
    const d = z.object({ periodo: Periodo }).parse(req.body);
    await exigir(req, ['dueno', 'finanzas']);
    const conds = await bd(req, async (c) => (await c.query(`select id, nombre, estado, prueba_hasta from condominios order by nombre`)).rows);
    const res: ResultadoFacturacion = { emitidas: 0, yaExistian: 0, omitidas: [] };
    for (const c of conds) {
      if (c.estado !== 'activo') {
        res.omitidas.push({ condominio: c.nombre, motivo: c.estado === 'prueba' ? `en prueba${c.prueba_hasta ? ' hasta ' + c.prueba_hasta : ''}` : c.estado });
        continue;
      }
      try {
        await bd(req, (t) => t.query(`select facturar_condominio($1, $2)`, [c.id, d.periodo]));
        res.emitidas++;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') res.yaExistian++;
        else res.omitidas.push({ condominio: c.nombre, motivo: (e as Error).message });
      }
    }
    return res;
  });

  app.get('/plataforma/pagos', async (req): Promise<PagoPlataforma[]> => {
    const q = z.object({ estado: z.enum(['reportado', 'todos']).default('reportado') }).parse(req.query);
    await exigir(req);
    const filas = await bd(req, async (c) => (await c.query(`select * from pagos_plataforma_lista($1)`, [q.estado === 'reportado'])).rows);
    return filas.map((p) => ({ id: p.id, facturaId: p.factura_id, condominioId: p.condominio_id, condominioNombre: p.condominio,
      metodo: p.metodo, moneda: p.moneda, monto: p.monto, referencia: p.referencia,
      fechaPago: p.fecha_pago, tasaBcv: p.tasa_bcv ?? null, montoUsd: p.monto_usd ?? null,
      estado: p.estado, motivoRechazo: p.motivo_rechazo ?? null,
      creadoEn: p.creado_en.toISOString(), reportadoPor: p.reportado_por }));
  });

  app.post('/plataforma/pagos/:id/confirmar', async (req, rep) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    await exigir(req, ['dueno', 'finanzas']);
    await bd(req, (c) => c.query(`select confirmar_pago_plataforma($1)`, [id]));
    return rep.status(204).send();
  });

  app.post('/plataforma/pagos/:id/rechazar', async (req, rep) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const d = z.object({ motivo: z.string().trim().min(3).max(300) }).parse(req.body);
    await exigir(req, ['dueno', 'finanzas']);
    await bd(req, (c) => c.query(`select rechazar_pago_plataforma($1, $2)`, [id, d.motivo]));
    return rep.status(204).send();
  });

  app.post('/plataforma/suspender-morosos', async (req) => {
    const d = z.object({ diasGracia: z.number().int().min(0).max(90).default(10) }).parse(req.body ?? {});
    await exigir(req, ['dueno', 'finanzas']);
    const r = await bd(req, (c) => c.query(`select suspender_morosos_plataforma($1) as n`, [d.diasGracia]));
    return { suspendidos: Number(r.rows[0].n) };
  });

  app.post('/plataforma/tasa-bcv', async (req, rep) => {
    const d = z.object({ usdVes: z.number().positive().max(1e7) }).parse(req.body);
    await exigir(req, ['dueno', 'finanzas']);
    await bd(req, (c) => c.query(`select plataforma_fijar_tasa_bcv($1)`, [d.usdVes]));
    return rep.status(204).send();
  });

  // ---------- Soporte ----------
  app.get('/plataforma/soporte/usuarios', async (req): Promise<UsuarioSoporte[]> => {
    const q = z.object({ q: z.string().trim().max(100).default('') }).parse(req.query);
    await exigir(req, ['dueno', 'soporte']);
    const filas = await bd(req, async (c) => (await c.query(`select * from soporte_buscar_usuarios($1)`, [q.q])).rows);
    return filas.map((u) => ({ usuarioId: u.usuario_id, nombre: u.nombre, correo: u.correo, condominios: u.condominios ?? [] }));
  });

  app.get('/plataforma/soporte/solicitudes', async (req): Promise<SolicitudIngreso[]> => {
    await exigir(req, ['dueno', 'soporte']);
    const filas = await bd(req, async (c) => (await c.query(`select * from soporte_solicitudes_pendientes()`)).rows);
    return filas.map((s) => ({ id: s.id, condominioId: s.condominio_id, condominioNombre: s.condominio, usuarioNombre: s.usuario,
      unidad: s.unidad, rol: s.rol, creadoEn: s.creado_en.toISOString() }));
  });

  // ---------- Equipo ----------
  app.get('/plataforma/equipo', async (req): Promise<AdminPlataforma[]> => {
    await exigir(req);
    const filas = await bd(req, async (c) => (await c.query(`select * from equipo_plataforma()`)).rows);
    return filas.map((a) => ({ usuarioId: a.usuario_id, nombre: a.nombre, correo: a.correo, rol: a.rol, activo: a.activo }));
  });

  app.post('/plataforma/equipo', async (req, rep) => {
    const d = z.object({ correo: z.string().trim().toLowerCase().email().max(200), rol: z.enum(['dueno', 'soporte', 'finanzas']) }).parse(req.body);
    await exigir(req, ['dueno']);
    await bd(req, (c) => c.query(`select agregar_admin_plataforma($1, $2)`, [d.correo, d.rol]));
    return rep.status(204).send();
  });

  app.patch('/plataforma/equipo/:usuarioId', async (req, rep) => {
    const { usuarioId } = z.object({ usuarioId: Uuid }).parse(req.params);
    const d = z.object({ rol: z.enum(['dueno', 'soporte', 'finanzas']).optional(), activo: z.boolean().optional() }).parse(req.body);
    await exigir(req, ['dueno']);
    if (usuarioId === req.usuarioId && (d.activo === false || (d.rol && d.rol !== 'dueno'))) {
      throw new ErrorApi(400, 'No puede quitarse a sí mismo el rol de dueño ni desactivarse', 'invalido');
    }
    const r = await bd(req, (c) => c.query(`update plataforma_admins set rol = coalesce($2, rol), activo = coalesce($3, activo)
                                            where usuario_id = $1`, [usuarioId, d.rol ?? null, d.activo ?? null]));
    if (!r.rowCount) throw new ErrorApi(404, 'Esa persona no está en el equipo', 'no_encontrado');
    return rep.status(204).send();
  });
}
