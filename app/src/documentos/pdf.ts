// Motor mínimo de maquetación PDF (pdf-lib) con el encabezado de marca del condominio.
import {
  PDFDocument, StandardFonts, rgb, clip, endPath, popGraphicsState, pushGraphicsState, rectangle,
  type PDFFont, type PDFImage, type PDFPage, type RGB as PdfRGB,
} from 'pdf-lib';
import QRCode from 'qrcode';
import { PIE, fechaCorta, hexARgb, mezclar, winAnsi, type MarcaDoc, type RGB } from './comun';

const CARTA: [number, number] = [612, 792];   // tamaño carta (8,5 × 11 pulgadas)
const M = 42;                                 // margen

const c = (x: RGB): PdfRGB => rgb(x.r, x.g, x.b);
const GRIS = rgb(0.38, 0.42, 0.41);
const TINTA = rgb(0.11, 0.14, 0.13);
const LINEA = rgb(0.86, 0.84, 0.8);

export interface Columna {
  titulo: string;
  ancho: number;                 // fracción del ancho útil (las columnas deben sumar 1)
  alinear?: 'izq' | 'der' | 'centro';
}
export interface FilaTabla { celdas: string[]; negrita?: boolean; fondo?: 'suave' | 'marca' | null }

export interface OpcionesLienzo {
  titulo: string;                // "Estado de cuenta"
  subtitulo?: string;            // "Unidad B-33 · Octubre 2026"
  codigo?: string | null;
  fecha?: Date;
  banda?: boolean;               // foto de la entrada como banda bajo el encabezado (1.ª página)
}

export class Lienzo {
  doc!: PDFDocument;
  r!: PDFFont;
  b!: PDFFont;
  pagina!: PDFPage;
  y = 0;
  readonly ancho = CARTA[0] - 2 * M;
  readonly izq = M;
  color: RGB;
  suave: RGB;
  private logo: PDFImage | null = null;
  private foto: PDFImage | null = null;

  private constructor(readonly marca: MarcaDoc, readonly o: OpcionesLienzo) {
    this.color = hexARgb(marca.colorPrimario);
    this.suave = mezclar(this.color, 0.88);
  }

  static async crear(marca: MarcaDoc, o: OpcionesLienzo): Promise<Lienzo> {
    const l = new Lienzo(marca, o);
    l.doc = await PDFDocument.create();
    l.doc.setTitle(winAnsi(`${o.titulo} · ${marca.nombre}`));
    l.doc.setAuthor(winAnsi(marca.nombreAsociacion ?? marca.nombre));
    l.doc.setCreator('ZPro Condominio · Technical Digital TD, C.A.');
    l.doc.setProducer('ZPro Condominio');
    l.r = await l.doc.embedFont(StandardFonts.Helvetica);
    l.b = await l.doc.embedFont(StandardFonts.HelveticaBold);
    try {
      if (marca.logo) l.logo = marca.logo.tipo === 'png' ? await l.doc.embedPng(marca.logo.bytes) : await l.doc.embedJpg(marca.logo.bytes);
    } catch { l.logo = null; }
    try {
      if (marca.fotoEntrada && o.banda) l.foto = marca.fotoEntrada.tipo === 'png'
        ? await l.doc.embedPng(marca.fotoEntrada.bytes) : await l.doc.embedJpg(marca.fotoEntrada.bytes);
    } catch { l.foto = null; }
    l.nuevaPagina();
    return l;
  }

  get abajo() { return M + 30; }   // reserva para el pie

  // ---------- Página y encabezado ----------
  nuevaPagina() {
    this.pagina = this.doc.addPage(CARTA);
    const [W, H] = CARTA;
    const primera = this.doc.getPageCount() === 1;
    this.pagina.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: c(this.color) });
    let y = H - 30;
    const altoLogo = primera ? 54 : 30;
    let xTexto = M;
    if (this.logo) {
      const s = this.logo.scale(1);
      const k = altoLogo / Math.max(s.height, s.width);
      this.pagina.drawImage(this.logo, { x: M, y: y - s.height * k, width: s.width * k, height: s.height * k });
      xTexto = M + s.width * k + 12;
    }
    const m = this.marca;
    const anchoTexto = CARTA[0] - M - xTexto - 170;
    this.pagina.drawText(this.corta(m.nombre, this.b, primera ? 15 : 11, anchoTexto), { x: xTexto, y: y - (primera ? 14 : 11), size: primera ? 15 : 11, font: this.b, color: TINTA });
    if (primera) {
      let yy = y - 28;
      if (m.nombreAsociacion) {
        this.pagina.drawText(this.corta(m.nombreAsociacion, this.r, 8.5, anchoTexto), { x: xTexto, y: yy, size: 8.5, font: this.r, color: GRIS }); yy -= 11;
      }
      const datos = [m.rif && `RIF ${m.rif}`, m.direccion, m.ciudad].filter(Boolean).join(' · ');
      if (datos) { this.pagina.drawText(this.corta(datos, this.r, 8, anchoTexto), { x: xTexto, y: yy, size: 8, font: this.r, color: GRIS }); yy -= 10; }
      const contacto = [m.telefono, m.correo].filter(Boolean).join(' · ');
      if (contacto) this.pagina.drawText(this.corta(contacto, this.r, 8, anchoTexto), { x: xTexto, y: yy, size: 8, font: this.r, color: GRIS });
    }
    // Título del documento a la derecha
    const tam = primera ? 14 : 10;
    const t = winAnsi(this.o.titulo);
    this.pagina.drawText(t, { x: CARTA[0] - M - this.b.widthOfTextAtSize(t, tam), y: y - tam, size: tam, font: this.b, color: c(this.color) });
    const f = winAnsi(`Emitido: ${fechaCorta(this.o.fecha ?? new Date())}`);
    this.pagina.drawText(f, { x: CARTA[0] - M - this.r.widthOfTextAtSize(f, 8), y: y - tam - 13, size: 8, font: this.r, color: GRIS });
    if (this.o.codigo && primera) {
      const k = winAnsi(`Código: ${this.o.codigo}`);
      this.pagina.drawText(k, { x: CARTA[0] - M - this.b.widthOfTextAtSize(k, 8), y: y - tam - 24, size: 8, font: this.b, color: TINTA });
    }
    y -= primera ? altoLogo + 14 : altoLogo + 8;
    this.pagina.drawLine({ start: { x: M, y }, end: { x: CARTA[0] - M, y }, thickness: 0.8, color: LINEA });
    y -= 6;

    if (primera && this.foto) {
      const alto = 92;
      y -= alto;
      this.imagenCubriendo(this.foto, M, y, this.ancho, alto);
      y -= 10;
    }
    if (primera && this.o.subtitulo) {
      y -= 4;
      this.pagina.drawText(winAnsi(this.o.subtitulo), { x: M, y: y - 12, size: 12, font: this.b, color: TINTA });
      y -= 22;
    }
    this.y = y - 4;
  }

  /** Dibuja una imagen recortada para cubrir el rectángulo (como object-fit: cover). */
  imagenCubriendo(img: PDFImage, x: number, y: number, w: number, h: number) {
    const s = img.scale(1);
    const k = Math.max(w / s.width, h / s.height);
    const iw = s.width * k, ih = s.height * k;
    this.pagina.pushOperators(pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath());
    this.pagina.drawImage(img, { x: x - (iw - w) / 2, y: y - (ih - h) / 2, width: iw, height: ih });
    this.pagina.pushOperators(popGraphicsState());
  }

  espacio(h: number) { if (this.y - h < this.abajo) this.nuevaPagina(); }

  // ---------- Texto ----------
  corta(s: string, f: PDFFont, tam: number, max: number) {
    let t = winAnsi(s);
    if (f.widthOfTextAtSize(t, tam) <= max) return t;
    while (t.length > 1 && f.widthOfTextAtSize(t + '…', tam) > max) t = t.slice(0, -1);
    return t + '…';
  }
  envolver(s: string, f: PDFFont, tam: number, max: number): string[] {
    const lineas: string[] = [];
    for (const parrafo of winAnsi(s).split('\n')) {
      let actual = '';
      for (const p of parrafo.split(/\s+/)) {
        const prueba = actual ? actual + ' ' + p : p;
        if (f.widthOfTextAtSize(prueba, tam) <= max || !actual) actual = prueba;
        else { lineas.push(actual); actual = p; }
      }
      lineas.push(actual);
    }
    // Una sola palabra más ancha que la columna: se recorta con "…".
    return lineas.map((l) => (f.widthOfTextAtSize(l, tam) > max ? this.corta(l, f, tam, max) : l));
  }
  parrafo(s: string, o: { tam?: number; negrita?: boolean; color?: 'gris' | 'marca' | 'tinta'; x?: number; ancho?: number; interlineado?: number; centrado?: boolean } = {}) {
    const tam = o.tam ?? 9.5, f = o.negrita ? this.b : this.r;
    const x = o.x ?? M, ancho = o.ancho ?? this.ancho;
    const col = o.color === 'gris' ? GRIS : o.color === 'marca' ? c(this.color) : TINTA;
    const ih = tam * (o.interlineado ?? 1.35);
    for (const l of this.envolver(s, f, tam, ancho)) {
      this.espacio(ih);
      const dx = o.centrado ? (ancho - f.widthOfTextAtSize(l, tam)) / 2 : 0;
      this.pagina.drawText(l, { x: x + dx, y: this.y - tam, size: tam, font: f, color: col });
      this.y -= ih;
    }
  }
  seccion(t: string) {
    this.espacio(40);
    this.y -= 8;
    this.pagina.drawRectangle({ x: M, y: this.y - 12, width: 3, height: 12, color: c(this.color) });
    this.pagina.drawText(winAnsi(t), { x: M + 9, y: this.y - 10.5, size: 11, font: this.b, color: TINTA });
    this.y -= 20;
  }

  /** Fila de tarjetas con cifras ("Saldo pendiente: $238,00"). */
  cifras(items: { etiqueta: string; valor: string; nota?: string; destacar?: boolean }[]) {
    const alto = 50, sep = 8;
    this.espacio(alto + 6);
    const w = (this.ancho - sep * (items.length - 1)) / items.length;
    items.forEach((it, i) => {
      const x = M + i * (w + sep);
      this.pagina.drawRectangle({
        x, y: this.y - alto, width: w, height: alto,
        color: it.destacar ? c(this.color) : c(this.suave), borderWidth: 0,
      });
      const tinta = it.destacar ? rgb(1, 1, 1) : TINTA;
      this.pagina.drawText(this.corta(it.etiqueta, this.r, 8, w - 16), { x: x + 8, y: this.y - 14, size: 8, font: this.r, color: it.destacar ? rgb(1, 1, 1) : GRIS });
      this.pagina.drawText(this.corta(it.valor, this.b, 14, w - 16), { x: x + 8, y: this.y - 32, size: 14, font: this.b, color: tinta });
      if (it.nota) this.pagina.drawText(this.corta(it.nota, this.r, 7.5, w - 16), { x: x + 8, y: this.y - 44, size: 7.5, font: this.r, color: it.destacar ? rgb(1, 1, 1) : GRIS });
    });
    this.y -= alto + 10;
  }

  /** Tabla con encabezado repetido en cada página, filas cebra, alineación por columna y texto que salta de línea. */
  tabla(cols: Columna[], filas: FilaTabla[], o: { tam?: number; maxLineas?: number } = {}) {
    const tam = o.tam ?? 8.5, pad = 5, ih = tam + 2.5, maxL = o.maxLineas ?? 3;
    const xs: number[] = [];
    let acc = M;
    for (const col of cols) { xs.push(acc); acc += col.ancho * this.ancho; }
    const encabezado = () => {
      const h = tam + 9;
      this.espacio(h * 2);
      this.pagina.drawRectangle({ x: M, y: this.y - h, width: this.ancho, height: h, color: c(this.color) });
      cols.forEach((col, i) => this.celda([winAnsi(col.titulo)], xs[i], col.ancho * this.ancho, pad, tam, ih, this.b, rgb(1, 1, 1), col.alinear));
      this.y -= h;
    };
    encabezado();
    filas.forEach((f, n) => {
      const fuente = f.negrita ? this.b : this.r;
      const lineas = cols.map((col, i) => {
        const w = col.ancho * this.ancho - 2 * pad;
        const ls = col.alinear === 'der' ? [this.corta(f.celdas[i] ?? '', fuente, tam, w)] : this.envolver(f.celdas[i] ?? '', fuente, tam, w);
        return ls.length > maxL ? [...ls.slice(0, maxL - 1), this.corta(ls.slice(maxL - 1).join(' '), fuente, tam, w)] : ls;
      });
      const alto = Math.max(...lineas.map((l) => l.length)) * ih + 6.5;
      if (this.y - alto < this.abajo) { this.nuevaPagina(); encabezado(); }
      const fondo = f.fondo === 'marca' ? c(this.suave) : f.fondo === 'suave' || n % 2 === 1 ? rgb(0.975, 0.97, 0.96) : null;
      if (fondo) this.pagina.drawRectangle({ x: M, y: this.y - alto, width: this.ancho, height: alto, color: fondo });
      cols.forEach((col, i) => this.celda(lineas[i], xs[i], col.ancho * this.ancho, pad, tam, ih, fuente, TINTA, col.alinear));
      this.y -= alto;
    });
    this.pagina.drawLine({ start: { x: M, y: this.y }, end: { x: M + this.ancho, y: this.y }, thickness: 0.6, color: LINEA });
    this.y -= 8;
  }
  private celda(lineas: string[], x: number, w: number, pad: number, tam: number, ih: number, f: PDFFont, col: PdfRGB, al?: Columna['alinear']) {
    lineas.forEach((s, k) => {
      const tw = f.widthOfTextAtSize(s, tam);
      const dx = al === 'der' ? w - pad - tw : al === 'centro' ? (w - tw) / 2 : pad;
      this.pagina.drawText(s, { x: x + dx, y: this.y - tam - 3.5 - k * ih, size: tam, font: f, color: col });
    });
  }

  /** Código QR vectorial (nítido a cualquier tamaño). */
  qr(texto: string, x: number, yTop: number, lado: number) {
    const q = QRCode.create(texto, { errorCorrectionLevel: 'M' });
    const n = q.modules.size, k = lado / (n + 2);
    this.pagina.drawRectangle({ x, y: yTop - lado, width: lado, height: lado, color: rgb(1, 1, 1) });
    for (let fy = 0; fy < n; fy++) for (let fx = 0; fx < n; fx++) {
      if (q.modules.get(fy, fx)) this.pagina.drawRectangle({ x: x + (fx + 1) * k, y: yTop - (fy + 2) * k, width: k, height: k, color: TINTA });
    }
  }

  /** Bloques de firma (y sello) al final del documento. */
  firmas(cargos: string[], conSello = true) {
    const altoSello = 92;
    this.espacio(altoSello + 30);
    this.y -= 18;
    const top = this.y;
    const huecoSello = conSello ? 116 : 0;
    const w = Math.min(220, (this.ancho - huecoSello - 16 * (cargos.length - 1)) / cargos.length);
    const yLinea = top - 58;
    cargos.forEach((cargo, i) => {
      const x = M + i * (w + 16);
      this.pagina.drawLine({ start: { x, y: yLinea }, end: { x: x + w, y: yLinea }, thickness: 0.8, color: TINTA });
      this.pagina.drawText(this.corta(cargo, this.b, 8.5, w), { x, y: yLinea - 11, size: 8.5, font: this.b, color: TINTA });
      this.pagina.drawText('Nombre:', { x, y: yLinea - 24, size: 7.5, font: this.r, color: GRIS });
      this.pagina.drawText('C.I.:', { x, y: yLinea - 35, size: 7.5, font: this.r, color: GRIS });
    });
    if (conSello) {
      const x = M + this.ancho - 100;
      this.pagina.drawRectangle({ x, y: top - altoSello, width: 100, height: altoSello, borderColor: GRIS, borderWidth: 0.8, borderDashArray: [3, 3] });
      const t = 'SELLO';
      this.pagina.drawText(t, { x: x + 50 - this.b.widthOfTextAtSize(t, 9) / 2, y: top - altoSello / 2 - 3, size: 9, font: this.b, color: GRIS });
    }
    this.y = top - altoSello - 8;
  }

  /** Pie en todas las páginas y bytes finales. */
  async terminar(): Promise<Uint8Array> {
    const total = this.doc.getPageCount();
    this.doc.getPages().forEach((p, i) => {
      p.drawLine({ start: { x: M, y: M + 14 }, end: { x: CARTA[0] - M, y: M + 14 }, thickness: 0.5, color: LINEA });
      p.drawText(this.corta(PIE(this.o.codigo), this.r, 7, this.ancho - 80), { x: M, y: M + 3, size: 7, font: this.r, color: GRIS });
      const pg = `Página ${i + 1} de ${total}`;
      p.drawText(pg, { x: CARTA[0] - M - this.r.widthOfTextAtSize(pg, 7), y: M + 3, size: 7, font: this.r, color: GRIS });
    });
    return this.doc.save();
  }
}
