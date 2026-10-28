// MODO DEMO · Chat tipo WhatsApp en memoria. Imita las reglas de 0005_chat.sql:
//  - partes = casas o la junta; todos los miembros de una casa comparten su bandeja
//  - directa casa↔casa (con nombre, NO anónimo) · junta casa↔junta · grupo · canal (solo la junta escribe)
//  - la junta NO lee conversaciones entre vecinos (solo el mensaje que se le denuncia)
//  - bloqueos, adjuntos con vencimiento, ✓ enviado / ✓✓ entregado / ✓✓ azul leído
import type {
  Adjunto, CasaDirectorio, Conversacion, Mensaje, NuevoMensaje, Sesion, TipoConversacion, Unidad,
} from './tipos';

type Parte = { unidadId: string | null; esJunta: boolean };
interface ConvDemo { id: string; tipo: TipoConversacion; titulo: string | null; partes: Parte[]; soloJuntaEscribe: boolean; creadoEn: string }
interface AdjDemo { id: string; convId: string; nombre: string; mime: string; bytes: number; expiraEn: string; eliminado: boolean; blob: () => Blob; url?: string }
interface MsgDemo {
  id: string; convId: string; autorId: string; autorNombre: string; autorUnidadId: string | null; comoJunta: boolean;
  tipo: Mensaje['tipo']; texto: string | null; adjuntoId: string | null; creadoEn: string; editadoEn: string | null; eliminadoEn: string | null;
}
interface Miembro { id: string; nombre: string; mostrar: boolean }

export interface ContextoChat {
  unidades: Unidad[];
  sesion: () => Sesion | null;
  condominio: () => string;
  /** La junta permite el chat casa ↔ casa (si no, las conversaciones entre casas quedan de solo lectura). */
  chatVecinos: () => boolean;
}

const RETENCION_DIAS = 30;
let n = 0;
const id = (p: string) => `${p}-${++n}`;
const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const enDias = (desde: string, dias: number) => new Date(new Date(desde).getTime() + dias * 86_400_000).toISOString();

// Seudónimo de la unidad (igual que etiqueta_unidad() en SQL). En la demo, el sector A son casas y el bloque B apartamentos.
export function etiquetaChat(u: Pick<Unidad, 'bloque' | 'numero'>) {
  return u.bloque === 'A' ? `Casa ${u.numero}` : `Apto ${u.bloque ? u.bloque + '-' : ''}${u.numero}`;
}

// ---------- Archivos de muestra (se generan en el navegador; no hay fotos reales) ----------
function svg(titulo: string, fondo: string): () => Blob {
  return () => new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
<rect width="640" height="420" fill="${fondo}"/>
<rect x="60" y="120" width="520" height="260" fill="#e9e4da" stroke="#b9b1a3" stroke-width="4"/>
<path d="M120 380 L200 210 L235 260 L300 150 L360 300 L420 230 L520 380" fill="none" stroke="#6b5e4b" stroke-width="7" stroke-linejoin="round"/>
<rect x="0" y="0" width="640" height="56" fill="rgba(0,0,0,.45)"/>
<text x="20" y="37" font-family="Arial, sans-serif" font-size="24" fill="#fff">${titulo}</text>
<text x="20" y="405" font-family="Arial, sans-serif" font-size="14" fill="#fff">Ilustración de muestra · ZPro Condominio (demo)</text>
</svg>`], { type: 'image/svg+xml' });
}

// PDF mínimo válido (solo ASCII) para que el archivo de muestra se pueda abrir.
function pdf(lineas: string[]): () => Blob {
  return () => {
    const esc = (t: string) => t.replace(/[()\\]/g, '\\$&');
    const contenido = `BT /F1 14 Tf 50 780 Td 20 TL ${lineas.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
    ];
    let s = '%PDF-1.4\n';
    const offs: number[] = [];
    objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = s.length;
    s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([s], { type: 'application/pdf' });
  };
}

export function crearChatDemo(ctx: ContextoChat) {
  const unidad = (uid: string) => ctx.unidades.find((u) => u.id === uid)!;

  // Miembros de cada casa (quién tiene la app). B-32 no tiene a nadie registrado.
  // Pedro (B-34) eligió ocultar su nombre en el directorio de vecinos.
  const miembros: Record<string, Miembro[]> = {
    'u-A11': [{ id: 'usr-luis', nombre: 'Luis Pérez', mostrar: true }, { id: 'usr-carmen', nombre: 'Carmen de Pérez', mostrar: true }],
    'u-A12': [{ id: 'usr-carlos', nombre: 'Carlos Rivas', mostrar: true }],
    'u-A13': [{ id: 'usr-ana', nombre: 'Ana Gómez', mostrar: true }],
    'u-A14': [{ id: 'usr-luism', nombre: 'Luis Medina', mostrar: true }],
    'u-B31': [{ id: 'usr-rosa', nombre: 'Rosa Herrera', mostrar: true }],
    'u-B32': [],
    'u-B33': [{ id: 'usr-elena', nombre: 'Elena Castro', mostrar: true }],
    'u-B34': [{ id: 'usr-pedro', nombre: 'Pedro Salas', mostrar: false }],
  };
  const junta: Miembro[] = [{ id: 'usr-maria', nombre: 'María Fernández', mostrar: true }, { id: 'usr-jorge', nombre: 'Jorge Rondón', mostrar: true }];

  const convs: ConvDemo[] = [];
  const msgs: MsgDemo[] = [];
  const adjs = new Map<string, AdjDemo>();
  const lecturas = new Map<string, { entregado: string; leido: string }>();   // `${conv}|${usuario}`
  const bloqueos = new Set<string>();                                         // `${bloquea}|${bloqueada}`
  const denuncias: { mensajeId: string; por: string; motivo: string }[] = [];
  const oyentes = new Map<string, Set<(m: Mensaje) => void>>();
  const yaRespondio = new Set<string>();

  // ---------- Permisos (espejo de puedo_ver_conversacion / puedo_escribir) ----------
  const misUnidades = (s: Sesion) => (s.unidadId ? [s.unidadId] : []);
  const exigir = () => { const s = ctx.sesion(); if (!s) throw new Error('Inicie sesión'); return s; };
  function puedoVer(c: ConvDemo, s: Sesion) {
    return c.tipo === 'canal' || c.partes.some((p) => (p.esJunta && s.esJunta) || (p.unidadId && misUnidades(s).includes(p.unidadId)));
  }
  function escriboComoJunta(c: ConvDemo, s: Sesion) {
    return s.esJunta && c.tipo !== 'directa' && c.partes.some((p) => p.esJunta);
  }
  function puedoEscribir(c: ConvDemo, s: Sesion, comoJunta: boolean) {
    if (comoJunta) return s.esJunta && c.partes.some((p) => p.esJunta);
    if (c.tipo === 'canal' || c.soloJuntaEscribe) return false;
    if (c.tipo === 'directa' && !ctx.chatVecinos()) return false;
    const u = s.unidadId;
    if (!u || !c.partes.some((p) => p.unidadId === u)) return false;
    if (c.tipo === 'directa' && c.partes.some((o) => o.unidadId && o.unidadId !== u && bloqueos.has(`${o.unidadId}|${u}`))) return false;
    return true;
  }
  const conv = (cid: string) => {
    const c = convs.find((x) => x.id === cid);
    const s = exigir();
    if (!c || !puedoVer(c, s)) throw new Error('Conversación no disponible');
    return c;
  };
  const usuariosDeParte = (p: Parte) => (p.esJunta ? junta : miembros[p.unidadId!] ?? []);

  // ---------- Vistas ----------
  function nombresVisibles(uid: string, s: Sesion) {
    return (miembros[uid] ?? []).filter((m) => s.esJunta || m.mostrar).map((m) => m.nombre);
  }
  function estadoDe(m: MsgDemo): 1 | 2 | 3 {
    const c = convs.find((x) => x.id === m.convId)!;
    const destinos = c.partes.filter((p) => !(p.esJunta && m.comoJunta) && p.unidadId !== m.autorUnidadId)
      .map((p) => usuariosDeParte(p)).filter((us) => us.length > 0);
    if (!destinos.length) return 1;
    const lect = (u: Miembro) => lecturas.get(`${m.convId}|${u.id}`);
    if (destinos.every((us) => us.some((u) => (lect(u)?.leido ?? '') >= m.creadoEn))) return 3;
    if (destinos.every((us) => us.some((u) => (lect(u)?.entregado ?? '') >= m.creadoEn))) return 2;
    return 1;
  }
  function vistaAdjunto(a: AdjDemo): Adjunto {
    const vencido = a.eliminado || a.expiraEn < new Date().toISOString();
    if (!vencido && !a.url) a.url = URL.createObjectURL(a.blob());
    return { id: a.id, nombre: a.nombre, mime: a.mime, bytes: a.bytes, url: vencido ? null : a.url!, expiraEn: a.expiraEn, vencido, guardadoLocal: false };
  }
  function vistaMensaje(m: MsgDemo, s: Sesion): Mensaje {
    const esMio = m.autorId === s.usuarioId;
    return {
      id: m.id, conversacionId: m.convId, autorNombre: m.autorNombre,
      autorEtiqueta: m.comoJunta ? 'Junta de condominio' : m.autorUnidadId ? etiquetaChat(unidad(m.autorUnidadId)) : '',
      esMio, comoJunta: m.comoJunta, tipo: m.tipo, texto: m.eliminadoEn ? null : m.texto,
      adjunto: m.adjuntoId && !m.eliminadoEn ? vistaAdjunto(adjs.get(m.adjuntoId)!) : null,
      creadoEn: m.creadoEn, editado: !!m.editadoEn, eliminado: !!m.eliminadoEn, estado: esMio ? estadoDe(m) : null,
    };
  }
  function vistaConversacion(c: ConvDemo, s: Sesion): Conversacion {
    let titulo = c.titulo ?? '';
    let subtitulo: string | null = null;
    if (c.tipo === 'directa') {
      const otra = c.partes.find((p) => p.unidadId && p.unidadId !== s.unidadId)!;
      const nombres = nombresVisibles(otra.unidadId!, s);
      titulo = etiquetaChat(unidad(otra.unidadId!)) + (nombres.length ? ` · ${nombres.join(', ')}` : '');
      subtitulo = 'Vecino';
    } else if (c.tipo === 'junta') {
      if (s.esJunta) {
        const u = c.partes.find((p) => p.unidadId)!.unidadId!;
        const nombres = nombresVisibles(u, s);
        titulo = etiquetaChat(unidad(u)) + (nombres.length ? ` · ${nombres.join(', ')}` : ' · sin usuarios en la app');
        subtitulo = 'Conversación con la junta';
      } else { titulo = 'Junta de condominio'; subtitulo = 'Presidencia, tesorería y vocales'; }
    } else if (c.tipo === 'grupo') {
      subtitulo = `Grupo · ${c.partes.filter((p) => p.unidadId).length} casas + junta`;
    } else subtitulo = 'Canal · solo la junta escribe';
    const propios = msgs.filter((m) => m.convId === c.id).sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
    const ultimo = propios.at(-1);
    const leido = lecturas.get(`${c.id}|${s.usuarioId}`)?.leido ?? '';
    const resumen = (m: MsgDemo) => m.eliminadoEn ? 'Se eliminó este mensaje'
      : m.texto ?? (m.adjuntoId ? `📎 ${adjs.get(m.adjuntoId)!.nombre}` : '');
    return {
      id: c.id, tipo: c.tipo, titulo, subtitulo,
      ultimoMensaje: ultimo ? `${ultimo.autorId === s.usuarioId ? 'Usted: ' : ''}${resumen(ultimo)}` : null,
      ultimoMensajeEn: ultimo?.creadoEn ?? c.creadoEn,
      noLeidos: propios.filter((m) => m.autorId !== s.usuarioId && m.creadoEn > leido).length,
      puedoEscribir: puedoEscribir(c, s, escriboComoJunta(c, s)),
    };
  }

  function emitir(cid: string, m: MsgDemo) {
    const s = ctx.sesion();
    if (!s) return;
    for (const f of oyentes.get(cid) ?? []) f(vistaMensaje(m, s));
  }
  function marcar(cid: string, uid: string, tipo: 'entregado' | 'leido', cuando = new Date().toISOString()) {
    const k = `${cid}|${uid}`;
    const l = lecturas.get(k) ?? { entregado: '', leido: '' };
    if (cuando > l.entregado) l.entregado = cuando;
    if (tipo === 'leido' && cuando > l.leido) l.leido = cuando;
    lecturas.set(k, l);
  }

  // ---------- Siembra ----------
  function nuevaConv(tipo: TipoConversacion, partes: Parte[], titulo: string | null = null, soloJunta = false, creado = hace(60 * 24 * 20)) {
    const c: ConvDemo = { id: id('conv'), tipo, titulo, partes, soloJuntaEscribe: tipo === 'canal' || soloJunta, creadoEn: creado };
    convs.push(c);
    return c;
  }
  function sembrar(c: ConvDemo, minAgo: number, autor: { id: string; nombre: string }, unidadId: string | null, texto: string | null,
                   adj?: { nombre: string; mime: string; bytes: number; blob: () => Blob; diasAtras?: number }) {
    const creadoEn = hace(minAgo);
    let adjuntoId: string | null = null;
    if (adj) {
      const a: AdjDemo = { id: id('adj'), convId: c.id, nombre: adj.nombre, mime: adj.mime, bytes: adj.bytes,
        expiraEn: enDias(creadoEn, RETENCION_DIAS), eliminado: false, blob: adj.blob };
      adjs.set(a.id, a);
      adjuntoId = a.id;
    }
    const m: MsgDemo = { id: id('msg'), convId: c.id, autorId: autor.id, autorNombre: autor.nombre, autorUnidadId: unidadId,
      comoJunta: unidadId === null, tipo: adj ? (adj.mime.startsWith('image/') ? 'imagen' : 'archivo') : 'texto',
      texto, adjuntoId, creadoEn, editadoEn: null, eliminadoEn: null };
    msgs.push(m);
    return m;
  }
  const M = (uid: string, i = 0) => miembros[uid][i];
  const [maria, jorge] = junta;
  const J = (uid: string) => [{ unidadId: uid, esJunta: false }, { unidadId: null, esJunta: true }] as Parte[];

  // Canal oficial
  const canal = nuevaConv('canal', [{ unidadId: null, esJunta: true }], 'Avisos oficiales');
  sembrar(canal, 60 * 26, maria, null, 'Buenos días, vecinos. Se adjunta la circular del corte de agua del sábado (8:00 a 12:00) por mantenimiento del tanque.',
    { nombre: 'Circular_corte_de_agua.pdf', mime: 'application/pdf', bytes: 1180,
      blob: pdf(['Residencias Los Samanes - Junta de Condominio', '', 'CIRCULAR: corte de agua programado', 'Sabado de 8:00 a 12:00 - mantenimiento del tanque.', 'Por favor guarden agua.', '', 'Documento de muestra (demo)']) });
  sembrar(canal, 60 * 3, jorge, null, 'Recordatorio: la cuota de este mes vence el día 5. Pueden reportar su pago desde la app (Pagar).');

  // Junta ↔ B-33 (Elena). Incluye un adjunto VENCIDO (hace 40 días) sin copia en el teléfono.
  const jB33 = nuevaConv('junta', J('u-B33'));
  const vencido = sembrar(jB33, 60 * 24 * 40, M('u-B33'), 'u-B33', 'Les envío la foto de la filtración del techo de mi baño.',
    { nombre: 'foto_filtracion.jpg', mime: 'image/jpeg', bytes: 284_000, blob: svg('Filtración', '#8aa') });
  adjs.get(vencido.adjuntoId!)!.eliminado = true;   // la purga nocturna ya lo borró del servidor
  sembrar(jB33, 60 * 24 * 39, maria, null, 'Recibido, Sra. Elena. El plomero pasa el jueves en la mañana.');
  sembrar(jB33, 60 * 24 * 2, jorge, null, 'Buenas tardes. Le confirmamos su pago de septiembre. Adjunto el recibo.',
    { nombre: 'Recibo_septiembre_B-33.pdf', mime: 'application/pdf', bytes: 1100,
      blob: pdf(['Residencias Los Samanes', 'Recibo de pago - Apto B-33', 'Septiembre - USD 154,00', 'Documento de muestra (demo)']) });
  sembrar(jB33, 60 * 24 * 2 - 30, M('u-B33'), 'u-B33', '¡Muchas gracias!');

  // B-33 ↔ Casa 12 (Carlos): vecinos, con nombre.
  const dir = nuevaConv('directa', [{ unidadId: 'u-B33', esJunta: false }, { unidadId: 'u-A12', esJunta: false }]);
  sembrar(dir, 60 * 5, M('u-A12'), 'u-A12', 'Buenas, vecina. ¿El carro gris del puesto V2 es de su visita?');
  sembrar(dir, 60 * 5 - 12, M('u-B33'), 'u-B33', 'No, Carlos. Ya lo reporté a la junta.');
  sembrar(dir, 40, M('u-A12'), 'u-A12', 'Perfecto, gracias. Avíseme si necesita algo.');

  // Grupo Bloque B
  const grupoB = nuevaConv('grupo', [{ unidadId: null, esJunta: true }, ...['u-B31', 'u-B32', 'u-B33', 'u-B34'].map((u) => ({ unidadId: u, esJunta: false }))], 'Bloque B');
  sembrar(grupoB, 60 * 7, M('u-B31'), 'u-B31', '¿Alguien sabe qué días pasa el camión del aseo?');
  sembrar(grupoB, 60 * 7 - 5, M('u-B34'), 'u-B34', 'Martes y jueves en la mañana.');
  sembrar(grupoB, 60 * 2, M('u-B31'), 'u-B31', 'Así quedó la grieta de la fachada después de la lluvia 😟',
    { nombre: 'grieta_fachada.svg', mime: 'image/svg+xml', bytes: 2100, blob: svg('Grieta en la fachada · Bloque B', '#556') });
  sembrar(grupoB, 25, maria, null, 'Gracias, Rosa. Por eso está abierta la votación de la pintura de la fachada: por favor voten en la app.');

  // Junta ↔ B-34 (Pedro) y Casa 13 ↔ Casa 14 (privado entre vecinos: ni Elena ni la junta lo ven).
  const jB34 = nuevaConv('junta', J('u-B34'));
  sembrar(jB34, 60 * 24, maria, null, 'Sr. Salas, le recordamos su saldo pendiente. Cualquier duda estamos a la orden.');
  const privado = nuevaConv('directa', [{ unidadId: 'u-A13', esJunta: false }, { unidadId: 'u-A14', esJunta: false }]);
  sembrar(privado, 90, M('u-A13'), 'u-A13', 'Luis, ¿me presta la escalera el sábado?');

  // Lecturas iniciales: Elena leyó todo salvo lo último del grupo Bloque B y del canal; la junta leyó B-33.
  const todos = () => msgs.map((m) => m.creadoEn).sort().at(-1)!;
  marcar(jB33.id, 'usr-elena', 'leido', todos());
  marcar(jB33.id, 'usr-maria', 'leido', todos());
  marcar(dir.id, 'usr-elena', 'leido', hace(41));
  marcar(dir.id, 'usr-carlos', 'leido', todos());
  marcar(grupoB.id, 'usr-elena', 'leido', hace(60 * 6));
  marcar(canal.id, 'usr-elena', 'leido', hace(60 * 20));
  marcar(jB34.id, 'usr-pedro', 'entregado', hace(60 * 23));
  marcar(jB34.id, 'usr-maria', 'leido', todos());
  marcar(grupoB.id, 'usr-maria', 'leido', todos());
  marcar(canal.id, 'usr-maria', 'leido', todos());

  // ---------- Simulación: la otra parte recibe, lee y a veces responde ----------
  function simular(c: ConvDemo, m: MsgDemo) {
    const destinos = c.partes.filter((p) => !(p.esJunta && m.comoJunta) && p.unidadId !== m.autorUnidadId);
    const usuarios = destinos.flatMap((p) => usuariosDeParte(p).slice(0, 1));
    if (!usuarios.length) return;
    const reemitirPropios = () => msgs.filter((x) => x.convId === c.id && x.autorId === m.autorId).slice(-5).forEach((x) => emitir(c.id, x));
    setTimeout(() => { usuarios.forEach((u) => marcar(c.id, u.id, 'entregado')); reemitirPropios(); }, 900);
    setTimeout(() => { usuarios.forEach((u) => marcar(c.id, u.id, 'leido')); reemitirPropios(); }, 2600);
    if (yaRespondio.has(c.id) || c.tipo === 'canal' || c.tipo === 'grupo') return;
    yaRespondio.add(c.id);
    setTimeout(() => {
      let r: MsgDemo | null = null;
      if (c.tipo === 'junta' && !m.comoJunta) r = sembrar(c, 0, maria, null, 'Recibido, gracias. Lo revisamos y le respondemos por aquí.');
      else if (c.tipo === 'junta' && m.comoJunta) {
        const u = c.partes.find((p) => p.unidadId)!.unidadId!;
        const quien = miembros[u]?.[0];
        if (quien) r = sembrar(c, 0, quien, u, 'Buenas tardes, recibido. ¡Gracias!');
      } else if (c.tipo === 'directa') {
        const otra = c.partes.find((p) => p.unidadId !== m.autorUnidadId)!.unidadId!;
        const quien = miembros[otra]?.[0];
        if (quien && !bloqueos.has(`${m.autorUnidadId}|${otra}`)) r = sembrar(c, 0, quien, otra, '👍 Gracias, vecino.');
      }
      if (r) emitir(c.id, r);
    }, 4200);
  }

  // ---------- Métodos del contrato Api ----------
  return {
    async directorio(): Promise<CasaDirectorio[]> {
      const s = exigir();
      return ctx.unidades.map((u) => ({ unidadId: u.id, etiqueta: etiquetaChat(u), nombres: nombresVisibles(u.id, s) }));
    },
    async mostrarEnDirectorio(mostrar: boolean) {
      const s = exigir();
      for (const lista of Object.values(miembros)) for (const m of lista) if (m.id === s.usuarioId) m.mostrar = mostrar;
    },
    async conversaciones(): Promise<Conversacion[]> {
      const s = exigir();
      return convs.filter((c) => puedoVer(c, s)).map((c) => vistaConversacion(c, s))
        .sort((a, b) => (b.ultimoMensajeEn ?? '').localeCompare(a.ultimoMensajeEn ?? ''));
    },
    async abrirConCasa(unidadId: string) {
      const s = exigir();
      if (!ctx.unidades.some((u) => u.id === unidadId)) throw new Error('Esa casa no pertenece a su condominio');
      if (s.esJunta && !s.unidadId) {
        const ya = convs.find((c) => c.tipo === 'junta' && c.partes.some((p) => p.unidadId === unidadId));
        return (ya ?? nuevaConv('junta', J(unidadId), null, false, new Date().toISOString())).id;
      }
      if (!s.unidadId) throw new Error('Su usuario no tiene casa asignada');
      if (unidadId === s.unidadId) throw new Error('No puede escribirse a sí mismo');
      if (!ctx.chatVecinos()) throw new Error('La junta de condominio no ha habilitado el chat entre vecinos');
      const ya = convs.find((c) => c.tipo === 'directa' && c.partes.some((p) => p.unidadId === unidadId) && c.partes.some((p) => p.unidadId === s.unidadId));
      return (ya ?? nuevaConv('directa', [{ unidadId: s.unidadId, esJunta: false }, { unidadId, esJunta: false }], null, false, new Date().toISOString())).id;
    },
    async abrirConJunta() {
      const s = exigir();
      if (!s.unidadId) throw new Error('Su usuario no tiene casa asignada');
      const ya = convs.find((c) => c.tipo === 'junta' && c.partes.some((p) => p.unidadId === s.unidadId));
      return (ya ?? nuevaConv('junta', J(s.unidadId), null, false, new Date().toISOString())).id;
    },
    async crearSala(tipo: 'grupo' | 'canal', titulo: string, unidadesSel: string[]) {
      const s = exigir();
      if (!s.esJunta) throw new Error('Solo la junta crea salas');
      if (!titulo.trim()) throw new Error('Indique un nombre para la sala');
      const partes: Parte[] = [{ unidadId: null, esJunta: true }];
      if (tipo === 'grupo') partes.push(...unidadesSel.filter((u) => ctx.unidades.some((x) => x.id === u)).map((u) => ({ unidadId: u, esJunta: false })));
      const c = nuevaConv(tipo, partes, titulo.trim(), false, new Date().toISOString());
      return c.id;
    },
    async mensajes(cid: string, antesDe?: string): Promise<Mensaje[]> {
      const s = exigir();
      conv(cid);
      return msgs.filter((m) => m.convId === cid && (!antesDe || m.creadoEn < antesDe))
        .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn)).slice(-50).map((m) => vistaMensaje(m, s));
    },
    async enviarMensaje(cid: string, nm: NuevoMensaje): Promise<Mensaje> {
      const s = exigir();
      const c = conv(cid);
      const comoJunta = nm.comoJunta ?? escriboComoJunta(c, s);
      if (!puedoEscribir(c, s, comoJunta)) {
        if (c.tipo === 'canal' || c.soloJuntaEscribe) throw new Error('En este canal solo escribe la junta');
        if (c.tipo === 'directa' && !ctx.chatVecinos()) throw new Error('La junta de condominio no ha habilitado el chat entre vecinos');
        throw new Error('No puede enviar mensajes en esta conversación (es posible que la otra casa le haya bloqueado)');
      }
      const texto = nm.texto?.trim() || null;
      if (!texto && !nm.archivo) throw new Error('Mensaje vacío');
      if (texto && texto.length > 4000) throw new Error('Máximo 4.000 caracteres');
      let adjuntoId: string | null = null;
      if (nm.archivo) {
        if (nm.archivo.size > 25 * 1024 * 1024) throw new Error('El archivo supera 25 MB');
        const archivo = nm.archivo;
        const a: AdjDemo = { id: id('adj'), convId: cid, nombre: archivo.name || 'archivo', mime: archivo.type || 'application/octet-stream',
          bytes: archivo.size, expiraEn: enDias(new Date().toISOString(), RETENCION_DIAS), eliminado: false, blob: () => archivo };
        adjs.set(a.id, a);
        adjuntoId = a.id;
      }
      const m: MsgDemo = {
        id: id('msg'), convId: cid, autorId: s.usuarioId, autorNombre: s.nombre, autorUnidadId: comoJunta ? null : s.unidadId,
        comoJunta, tipo: nm.archivo ? (nm.archivo.type.startsWith('image/') ? 'imagen' : nm.archivo.type.startsWith('audio/') ? 'audio' : 'archivo') : 'texto',
        texto, adjuntoId, creadoEn: new Date().toISOString(), editadoEn: null, eliminadoEn: null,
      };
      msgs.push(m);
      marcar(cid, s.usuarioId, 'leido', m.creadoEn);
      simular(c, m);
      return vistaMensaje(m, s);
    },
    async marcarLeido(cid: string) {
      const s = exigir();
      conv(cid);
      marcar(cid, s.usuarioId, 'leido');
    },
    suscribirConversacion(cid: string, alRecibir: (m: Mensaje) => void) {
      if (!oyentes.has(cid)) oyentes.set(cid, new Set());
      oyentes.get(cid)!.add(alRecibir);
      return () => { oyentes.get(cid)?.delete(alRecibir); };
    },
    async descargarAdjunto(a: Adjunto): Promise<Blob> {
      const d = adjs.get(a.id);
      if (!d || d.eliminado || d.expiraEn < new Date().toISOString()) throw new Error('El archivo ya no está en el servidor');
      return d.blob();
    },
    async bloquearCasa(unidadId: string, bloquear: boolean) {
      const s = exigir();
      if (!s.unidadId) throw new Error('Solo un residente puede bloquear a otra casa');
      const k = `${s.unidadId}|${unidadId}`;
      if (bloquear) bloqueos.add(k); else bloqueos.delete(k);
    },
    async denunciarMensaje(mensajeId: string, motivo: string) {
      const s = exigir();
      const m = msgs.find((x) => x.id === mensajeId);
      if (!m) throw new Error('Mensaje no existe');
      conv(m.convId);
      if (!motivo.trim()) throw new Error('Indique el motivo');
      if (denuncias.some((d) => d.mensajeId === mensajeId && d.por === s.usuarioId)) throw new Error('Ya denunció este mensaje');
      denuncias.push({ mensajeId, por: s.usuarioId, motivo });
    },
  };
}
