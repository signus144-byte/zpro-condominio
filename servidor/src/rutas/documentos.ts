// Documentos con código de verificación (CONTRATO_API.md §6). Los PDF/Excel se generan en el teléfono
// (app/src/documentos); aquí se registran para obtener su código y se verifican públicamente por QR.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bd, bdAnonimo } from '../contexto.js';
import { ErrorApi } from '../util/errores.js';
import { ParamsC, Periodo, Uuid } from './condominio.js';
import { iso } from './_comun.js';

const Codigo = z.string().trim().regex(/^[A-Za-z0-9]{6,16}$/, 'código inválido');
const NOMBRES: Record<string, string> = {
  estado_cuenta: 'Estado de cuenta', recibo: 'Recibo de condominio', solvencia: 'Solvencia', relacion_gastos: 'Relación de gastos',
  acta_votacion: 'Acta de votación', convocatoria: 'Convocatoria', morosidad: 'Reporte de morosidad',
  libro_ingresos_egresos: 'Libro de ingresos y egresos', circular: 'Circular',
};

interface Verificacion { tipo: string; condominio: string; unidad: string | null; emitidoEn: string; vigente: boolean }

async function verificar(req: Parameters<typeof bdAnonimo>[0], codigo: string): Promise<Verificacion | null> {
  const r = await bdAnonimo(req, (c) => c.query(`select * from verificar_documento($1)`, [codigo]));
  const v = r.rows[0];
  return v ? { tipo: v.tipo, condominio: v.condominio, unidad: v.unidad, emitidoEn: iso(v.emitido_en)!, vigente: v.vigente } : null;
}

export default async function rutasDocumentos(app: FastifyInstance) {
  app.post('/c/:cid/documentos', async (req) => {
    const { cid } = ParamsC.parse(req.params);
    const d = z.object({
      tipo: z.enum(['estado_cuenta', 'recibo', 'relacion_gastos', 'acta_votacion', 'convocatoria', 'morosidad', 'libro_ingresos_egresos', 'circular']),
      formato: z.enum(['pdf', 'xlsx']), unidadId: Uuid.optional(), periodo: Periodo.optional(), votacionId: Uuid.optional(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    }).parse(req.body);
    const r = await bd(req, (c) => c.query(`select registrar_documento($1, $2, $3, $4, $5, $6, $7) as codigo`,
      [cid, d.tipo, d.formato, d.unidadId ?? null, d.periodo ?? null, d.votacionId ?? null, d.sha256 ?? null]));
    return { codigo: r.rows[0].codigo as string };
  });

  app.post('/c/:cid/unidades/:uid/solvencia', async (req) => {
    const p = ParamsC.extend({ uid: Uuid }).parse(req.params);
    const r = await bd(req, async (c) => {
      const u = await c.query(`select 1 from unidades where id = $1 and condominio_id = $2`, [p.uid, p.cid]);
      if (!u.rowCount) throw new ErrorApi(404, 'Unidad no existe', 'no_encontrado');
      return c.query(`select emitir_solvencia($1) as codigo`, [p.uid]);
    });
    return { codigo: r.rows[0].codigo as string };
  });

  // Verificación pública (sin sesión): solo lo mínimo para saber si el documento es auténtico.
  app.get('/verificar/:codigo', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { codigo } = z.object({ codigo: Codigo }).parse(req.params);
    const v = await verificar(req, codigo);
    if (!v) throw new ErrorApi(404, 'No existe un documento con ese código', 'no_encontrado');
    return v;
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function pagina(titulo: string, cuerpo: string, ok: boolean | null) {
  const color = ok === null ? '#5b6662' : ok ? '#157347' : '#b42318';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(titulo)} · ZPro Condominio</title>
<style>body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f5f2ec;color:#1d2523}
main{max-width:520px;margin:0 auto;padding:40px 20px}.t{background:#fff;border:1px solid #e3ded4;border-radius:14px;padding:24px}
h1{font-size:1.4rem;margin:0 0 12px;color:${color}}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:16px 0 0}
dt{color:#5b6662}dd{margin:0;font-weight:600}p.pie{font-size:.8rem;color:#5b6662;text-align:center;margin-top:24px}
form{display:flex;gap:8px;margin-top:16px}input{flex:1;padding:10px;border:1px solid #e3ded4;border-radius:10px;font:inherit;text-transform:uppercase}
button{padding:10px 16px;border:0;border-radius:10px;background:#0f4c4a;color:#fff;font:inherit;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#111716;color:#e8eeec}.t{background:#1a2220;border-color:#2b3734}dt,p.pie{color:#9fb0ab}}</style>
</head><body><main><div class="t">${cuerpo}</div><p class="pie">ZPro Condominio · Technical Digital TD, C.A.</p></main></body></html>`;
}

/** Página pública /verificar/:codigo (fuera de /api) para quien escanea el QR de un documento. */
export async function paginaVerificar(app: FastifyInstance) {
  const formulario = `<form method="get" action="/verificar"><input name="c" placeholder="Código del documento" maxlength="16" required><button>Verificar</button></form>`;
  app.get('/verificar', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, rep) => {
    const c = (req.query as { c?: string }).c;
    if (c && /^[A-Za-z0-9]{6,16}$/.test(c.trim())) return rep.redirect(`/verificar/${encodeURIComponent(c.trim().toUpperCase())}`);
    return rep.type('text/html; charset=utf-8').send(pagina('Verificar documento',
      `<h1>Verificar un documento</h1><p>Escriba el código impreso en el documento.</p>${formulario}`, null));
  });

  app.get<{ Params: { codigo: string } }>('/verificar/:codigo', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, rep) => {
    const codigo = req.params.codigo.trim().toUpperCase();
    rep.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    if (!/^[A-Z0-9]{6,16}$/.test(codigo)) {
      return rep.status(400).send(pagina('Código inválido', `<h1>Código inválido</h1>${formulario}`, false));
    }
    const v = await verificar(req, codigo);
    if (!v) {
      return rep.status(404).send(pagina('No encontrado',
        `<h1>✗ Documento no encontrado</h1><p>No existe un documento con el código <b>${esc(codigo)}</b>. Revise que esté bien escrito: un documento sin código válido no es auténtico.</p>${formulario}`, false));
    }
    const fecha = new Date(v.emitidoEn).toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Caracas' });
    return rep.send(pagina('Documento verificado', `
      <h1>${v.vigente ? '✓ Documento auténtico y vigente' : '⚠ Documento auténtico, pero NO vigente'}</h1>
      <dl><dt>Documento</dt><dd>${esc(NOMBRES[v.tipo] ?? v.tipo)}</dd>
      <dt>Condominio</dt><dd>${esc(v.condominio)}</dd>
      ${v.unidad ? `<dt>Unidad</dt><dd>${esc(v.unidad)}</dd>` : ''}
      <dt>Emitido</dt><dd>${esc(fecha)}</dd><dt>Código</dt><dd>${esc(codigo)}</dd></dl>
      ${v.vigente ? '' : '<p>Fue anulado o su vigencia terminó. Pida uno nuevo al condominio.</p>'}`, v.vigente));
  });
}
