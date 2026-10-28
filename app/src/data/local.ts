// CONSTANCIA LOCAL: lo que llega por el chat queda guardado en ESTE dispositivo.
// - IndexedDB (web y WebView de Capacitor): mensajes recibidos y archivos descargados (blob + huella SHA-256).
// - Android/iOS nativo: además se copia cada archivo a Documentos/ZPro Condominio/<condominio>/.
// El servidor borra los archivos a los N días (purga nocturna); la copia local permanece.
import { Capacitor } from '@capacitor/core';
import type { Adjunto, Mensaje } from './tipos';

const BD = 'zpro-constancia';
const VERSION = 1;

export interface ArchivoLocal {
  id: string; nombre: string; mime: string; bytes: number; blob: Blob;
  sha256: string | null; guardadoEn: string; condominio: string; rutaDispositivo: string | null;
}

// ---------- IndexedDB con respaldo en memoria (modo privado, previews, etc.) ----------
const memoria = { mensajes: new Map<string, Mensaje>(), archivos: new Map<string, ArchivoLocal>() };
let abrir: Promise<IDBDatabase | null> | null = null;

function bd(): Promise<IDBDatabase | null> {
  if (abrir) return abrir;
  abrir = new Promise((ok) => {
    try {
      if (typeof indexedDB === 'undefined') return ok(null);
      const req = indexedDB.open(BD, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('mensajes')) db.createObjectStore('mensajes', { keyPath: 'id' }).createIndex('conv', 'conversacionId');
        if (!db.objectStoreNames.contains('archivos')) db.createObjectStore('archivos', { keyPath: 'id' });
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => ok(null);
      req.onblocked = () => ok(null);
    } catch { ok(null); }
  });
  return abrir;
}

function tx<T>(almacen: 'mensajes' | 'archivos', modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return bd().then((db) => new Promise<T | undefined>((ok) => {
    if (!db) return ok(undefined);
    try {
      const t = db.transaction(almacen, modo);
      const r = fn(t.objectStore(almacen));
      t.oncomplete = () => ok(r ? r.result : undefined);
      t.onerror = () => ok(undefined);
    } catch { ok(undefined); }
  }));
}

// ---------- Ajustes (por dispositivo) ----------
const leerAjuste = <T>(k: string, def: T): T => {
  try { const v = localStorage.getItem('zpro.' + k); return v == null ? def : (JSON.parse(v) as T); } catch { return def; }
};
const guardarAjuste = (k: string, v: unknown) => { try { localStorage.setItem('zpro.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

export const ajustes = {
  /** Descargar y guardar automáticamente cada archivo recibido (como "descarga automática" de WhatsApp). */
  get autoDescarga() { return leerAjuste('autoDescarga', true); },
  set autoDescarga(v: boolean) { guardarAjuste('autoDescarga', v); },
  silenciada(conv: string) { return leerAjuste<string[]>('silenciadas', []).includes(conv); },
  silenciar(conv: string, si: boolean) {
    const l = new Set(leerAjuste<string[]>('silenciadas', []));
    if (si) l.add(conv); else l.delete(conv);
    guardarAjuste('silenciadas', [...l]);
  },
  bloqueadas(usuario: string) { return leerAjuste<string[]>('bloqueadas.' + usuario, []); },
  marcarBloqueada(usuario: string, unidad: string, si: boolean) {
    const l = new Set(leerAjuste<string[]>('bloqueadas.' + usuario, []));
    if (si) l.add(unidad); else l.delete(unidad);
    guardarAjuste('bloqueadas.' + usuario, [...l]);
  },
};

// ---------- Mensajes ----------
export async function guardarMensajes(lista: Mensaje[]) {
  if (!lista.length) return;
  // Se guarda la versión sin URL temporal (las URL de blob/firmadas caducan).
  const limpios = lista.map((m) => ({ ...m, adjunto: m.adjunto ? { ...m.adjunto, url: null } : null }));
  limpios.forEach((m) => memoria.mensajes.set(m.id, m));
  await tx('mensajes', 'readwrite', (s) => { limpios.forEach((m) => s.put(m)); });
}

export async function mensajesLocales(conversacionId: string): Promise<Mensaje[]> {
  const r = await tx<Mensaje[]>('mensajes', 'readonly', (s) => s.index('conv').getAll(conversacionId));
  const lista = r ?? [...memoria.mensajes.values()].filter((m) => m.conversacionId === conversacionId);
  return lista.sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
}

// ---------- Archivos ----------
export async function sha256(blob: Blob): Promise<string | null> {
  try {
    if (!crypto?.subtle) return null;
    const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

export async function archivoLocal(id: string): Promise<ArchivoLocal | null> {
  const r = await tx<ArchivoLocal>('archivos', 'readonly', (s) => s.get(id));
  return r ?? memoria.archivos.get(id) ?? null;
}

const nombreSeguro = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '_').trim() || 'archivo';

async function aBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Copia el archivo a Documentos/ZPro Condominio/<condominio>/ en el teléfono (solo app nativa). */
async function copiarADocumentos(condominio: string, nombre: string, blob: Blob): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const ruta = `ZPro Condominio/${nombreSeguro(condominio)}/${nombreSeguro(nombre)}`;
    await Filesystem.writeFile({ path: ruta, data: await aBase64(blob), directory: Directory.Documents, recursive: true });
    return ruta;
  } catch { return null; }
}

export async function guardarArchivo(a: Pick<Adjunto, 'id' | 'nombre' | 'mime' | 'bytes'>, blob: Blob, condominio: string): Promise<ArchivoLocal> {
  const reg: ArchivoLocal = {
    id: a.id, nombre: a.nombre, mime: a.mime || blob.type, bytes: blob.size || a.bytes, blob,
    sha256: await sha256(blob), guardadoEn: new Date().toISOString(), condominio,
    rutaDispositivo: await copiarADocumentos(condominio, a.nombre, blob),
  };
  memoria.archivos.set(a.id, reg);
  await tx('archivos', 'readwrite', (s) => { s.put(reg); });
  return reg;
}

/** Si el archivo aún está en el servidor y no hay copia, lo descarga y lo guarda. */
export async function asegurarCopia(a: Adjunto, descargar: (a: Adjunto) => Promise<Blob>, condominio: string): Promise<ArchivoLocal | null> {
  const ya = await archivoLocal(a.id);
  if (ya) return ya;
  if (a.vencido || !a.url) return null;
  try { return await guardarArchivo(a, await descargar(a), condominio); } catch { return null; }
}

// ---------- Exportar conversación (constancia en texto) ----------
export async function exportarConversacion(opts: { condominio: string; titulo: string; mensajes: Mensaje[] }): Promise<void> {
  const f = (iso: string) => new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const lineas = [
    `${opts.condominio} · ZPro Condominio`,
    `Conversación: ${opts.titulo}`,
    `Exportada el ${f(new Date().toISOString())} desde este dispositivo.`,
    'Cada archivo lleva su huella SHA-256 para comprobar que la copia no fue alterada.',
    '-'.repeat(60),
  ];
  for (const m of opts.mensajes) {
    const quien = `${m.autorEtiqueta}${m.autorNombre ? ' · ' + m.autorNombre : ''}`;
    if (m.eliminado) { lineas.push(`[${f(m.creadoEn)}] ${quien}: (mensaje eliminado)`); continue; }
    if (m.texto) lineas.push(`[${f(m.creadoEn)}] ${quien}: ${m.texto}${m.editado ? ' (editado)' : ''}`);
    if (m.adjunto) {
      const local = await archivoLocal(m.adjunto.id);
      lineas.push(`[${f(m.creadoEn)}] ${quien}: <archivo: ${m.adjunto.nombre}, ${Math.round(m.adjunto.bytes / 1024)} KB` +
        (local?.sha256 ? `, SHA-256 ${local.sha256}` : '') + (local ? ', copia guardada en este dispositivo' : m.adjunto.vencido ? ', vencido en el servidor' : '') + '>');
    }
  }
  const nombre = `Chat_${nombreSeguro(opts.titulo).replace(/ /g, '_')}_${new Date().toISOString().slice(0, 10)}.txt`;
  const blob = new Blob([lineas.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });

  if (Capacitor.isNativePlatform()) {
    const ruta = await copiarADocumentos(opts.condominio, nombre, blob);
    if (ruta) {
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const { Share } = await import('@capacitor/share');
        const { uri } = await Filesystem.getUri({ path: ruta, directory: Directory.Documents });
        await Share.share({ title: nombre, url: uri });
      } catch { /* el archivo quedó guardado aunque no se comparta */ }
      return;
    }
  }
  descargarEnNavegador(blob, nombre);
}

export function descargarEnNavegador(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
