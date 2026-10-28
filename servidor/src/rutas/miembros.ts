// Miembros, códigos de acceso, solicitudes de ingreso y directorio de casas (CONTRATO_API.md §7).
import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CasaDirectorio, CodigoAcceso, MiembroCondominio, SolicitudIngresoJunta } from '../../../compartido/tipos.js';
import { bd } from '../contexto.js';
import type { Tx } from '../db/conexion.js';
import { ErrorApi } from '../util/errores.js';
import { ParamsC, Uuid } from './condominio.js';
import { exigir, exigirJunta, iso } from './_comun.js';

const Rol = z.enum(['presidente', 'tesorero', 'vocal', 'administrador', 'propietario', 'inquilino']);
// Sin 0/O/1/I para dictarlos por teléfono.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const aleatorio = (n: number) => Array.from({ length: n }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
const prefijo = (bloque: string | null, numero: string) =>
  `${bloque ?? ''}${numero}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'ZP';

async function listarCodigos(c: Tx, cid: string): Promise<CodigoAcceso[]> {
  const filas = (await c.query(`
    select k.*, case when u.id is null then null else etiqueta_unidad(u) end as unidad
      from codigos_acceso k left join unidades u on u.id = k.unidad_id
     where k.condominio_id = $1 and k.expira_en > now() and k.usos < k.usos_max
     order by u.bloque nulls first, u.numero, k.codigo`, [cid])).rows;
  return filas.map((k) => ({
    codigo: k.codigo, unidadId: k.unidad_id, unidad: k.unidad, rol: k.rol, usos: k.usos, usosMax: k.usos_max,
    expiraEn: iso(k.expira_en)!, requiereAprobacion: k.requiere_aprobacion,
  }));
}

export default async function rutasMiembros(app: FastifyInstance) {
  // ---------- Miembros ----------
  app.get('/c/:cid/miembros', async (req): Promise<MiembroCondominio[]> => {
    const { cid } = ParamsC.parse(req.params);
    const filas = await bd(req, async (c) => {
      await exigirJunta(c, cid);
      return (await c.query(`
        select m.usuario_id, p.nombre, m.rol, m.unidad_id, m.activo, m.alta_en,
               case when u.id is null then null else etiqueta_unidad(u) end as unidad
          from membresias m join perfiles p on p.id = m.usuario_id left join unidades u on u.id = m.unidad_id
         where m.condominio_id = $1 order by m.activo desc, p.nombre, m.rol`, [cid])).rows;
    });
    return filas.map((m) => ({ usuarioId: m.usuario_id, nombre: m.nombre, rol: m.rol, unidadId: m.unidad_id, unidad: m.unidad,
                               activo: m.activo, altaEn: iso(m.alta_en)! }));
  });

  // Cambia rol o activa/desactiva a un miembro (presidente o administrador; lo exige la política de membresias).
  app.patch('/c/:cid/miembros/:usuarioId', async (req, rep) => {
    const p = ParamsC.extend({ usuarioId: Uuid }).parse(req.params);
    const d = z.object({ rol: Rol.optional(), activo: z.boolean().optional(), unidadId: Uuid.nullable().optional(),
                         rolActual: Rol.optional() }).parse(req.body);
    if (d.rol === undefined && d.activo === undefined) throw new ErrorApi(400, 'Nada que cambiar', 'invalido');
    await bd(req, async (c) => {
      await exigir(c, `tiene_rol($1, array['presidente','administrador']::rol_condominio[])`, [p.cid],
        'Solo presidencia o la administración gestiona los miembros');
      if (p.usuarioId === req.usuarioId && d.activo === false) throw new ErrorApi(400, 'No puede desactivarse a sí mismo', 'invalido');
      const r = await c.query(`update membresias set rol = coalesce($3, rol), activo = coalesce($4, activo)
                                where condominio_id = $1 and usuario_id = $2 and ($5::rol_condominio is null or rol = $5)`,
        [p.cid, p.usuarioId, d.rol ?? null, d.activo ?? null, d.rolActual ?? null]);
      if (!r.rowCount) throw new ErrorApi(404, 'Miembro no existe', 'no_encontrado');
      // Siempre debe quedar al menos un presidente o administrador activo.
      const q = await c.query(`select count(*) n from membresias where condominio_id = $1 and activo and rol in ('presidente','administrador')`, [p.cid]);
      if (Number(q.rows[0].n) === 0) throw new ErrorApi(400, 'Debe quedar al menos un presidente o administrador activo', 'invalido');
    });
    return rep.status(204).send();
  });

  // ---------- Códigos de acceso ----------
  app.get('/c/:cid/codigos', async (req): Promise<CodigoAcceso[]> => {
    const { cid } = ParamsC.parse(req.params);
    return bd(req, async (c) => {
      await exigir(c, `tiene_rol($1, array['presidente','administrador']::rol_condominio[])`, [cid]);
      return listarCodigos(c, cid);
    });
  });

  // Genera códigos: por casas (unidadIds), para TODAS las casas sin código vigente, o uno de junta (sin unidad, rol de junta).
  app.post('/c/:cid/codigos', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({
      unidadIds: z.array(Uuid).max(1000).optional(), todas: z.boolean().default(false), rol: Rol.default('propietario'),
      usosMax: z.number().int().min(1).max(10).default(3), dias: z.number().int().min(1).max(365).default(60),
      requiereAprobacion: z.boolean().default(true),
    }).parse(req.body);
    const esJuntaRol = ['presidente', 'tesorero', 'vocal', 'administrador'].includes(d.rol);
    if (!d.todas && !d.unidadIds?.length && !esJuntaRol) throw new ErrorApi(400, 'Indique las casas o use "todas"', 'invalido');
    const lista = await bd(req, async (c) => {
      await exigir(c, `tiene_rol($1, array['presidente','administrador']::rol_condominio[])`, [cid]);
      const unidades = esJuntaRol && !d.unidadIds?.length && !d.todas ? [{ id: null, bloque: null, numero: 'JUNTA' }]
        : (await c.query(`select id, bloque, numero from unidades u where condominio_id = $1
              and (($2::uuid[]) is null or id = any($2))
              and (not $3 or not exists (select 1 from codigos_acceso k where k.unidad_id = u.id and k.expira_en > now() and k.usos < k.usos_max))
            order by bloque nulls first, numero`, [cid, d.todas ? null : d.unidadIds, d.todas])).rows;
      if (!d.todas && d.unidadIds && unidades.length !== d.unidadIds.length) throw new ErrorApi(404, 'Alguna unidad no pertenece al condominio', 'no_encontrado');
      for (const u of unidades) {
        for (let intento = 0; intento < 5; intento++) {
          const codigo = `${prefijo(u.bloque, u.numero)}-${aleatorio(5)}`;
          const r = await c.query(`insert into codigos_acceso (codigo, condominio_id, unidad_id, rol, usos_max, expira_en, requiere_aprobacion, creado_por)
              values ($1, $2, $3, $4, $5, now() + make_interval(days => $6), $7, auth.uid()) on conflict (codigo) do nothing`,
            [codigo, cid, u.id, d.rol, d.usosMax, d.dias, d.requiereAprobacion]);
          if (r.rowCount) break;
        }
      }
      return listarCodigos(c, cid);
    });
    return rep.status(201).send(lista);
  });

  app.delete('/c/:cid/codigos/:codigo', async (req, rep) => {
    const p = ParamsC.extend({ codigo: z.string().max(40) }).parse(req.params);
    const r = await bd(req, (c) => c.query(`delete from codigos_acceso where codigo = $1 and condominio_id = $2`, [p.codigo.toUpperCase(), p.cid]));
    if (!r.rowCount) throw new ErrorApi(404, 'Código no existe', 'no_encontrado');
    return rep.status(204).send();
  });

  // ---------- Solicitudes de ingreso ----------
  app.get('/c/:cid/solicitudes', async (req): Promise<SolicitudIngresoJunta[]> => {
    const { cid } = ParamsC.parse(req.params);
    const filas = await bd(req, async (c) => (await c.query(`select * from solicitudes_pendientes($1)`, [cid])).rows);
    return filas.map((s) => ({ id: s.id, usuarioNombre: s.usuario_nombre, unidadId: s.unidad_id, unidad: s.unidad, rol: s.rol, creadoEn: iso(s.creado_en)! }));
  });

  app.post('/c/:cid/solicitudes/:id', async (req, rep) => {
    const p = ParamsC.extend({ id: Uuid }).parse(req.params);
    const d = z.object({ aprobar: z.boolean() }).parse(req.body);
    await bd(req, async (c) => {
      const s = await c.query(`select 1 from solicitudes_ingreso where id = $1 and condominio_id = $2`, [p.id, p.cid]);
      if (!s.rowCount) throw new ErrorApi(404, 'Solicitud no existe', 'no_encontrado');
      await c.query(`select resolver_solicitud($1, $2)`, [p.id, d.aprobar]);
    });
    return rep.status(204).send();
  });

  // ---------- Directorio de casas ----------
  app.get('/c/:cid/directorio', async (req): Promise<CasaDirectorio[]> => {
    const { cid } = ParamsC.parse(req.params);
    const filas = await bd(req, async (c) => (await c.query(`select * from directorio($1)`, [cid])).rows);
    return filas.map((f) => ({ unidadId: f.unidad_id, etiqueta: f.etiqueta, nombres: f.nombres ?? [] }));
  });

  app.patch('/c/:cid/directorio/yo', async (req, rep) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({ mostrar: z.boolean() }).parse(req.body);
    await bd(req, (c) => c.query(`select mostrar_en_directorio($1, $2)`, [cid, d.mostrar]));
    return rep.status(204).send();
  });
}
