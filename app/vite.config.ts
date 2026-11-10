import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Lector de comprobantes (v0.10): los archivos de Tesseract van DENTRO de la app, en ocr/, para no depender de
// otros servidores. Se copian de node_modules al compilar (y se sirven igual en desarrollo).
// El idioma va DESCOMPRIMIDO: Android descomprime y renombra los .gz al empaquetar la APK (spa.traineddata.gz →
// spa.traineddata), así que se entrega ya sin comprimir y el lector lo pide con ese nombre (la APK igual lo comprime).
const req = createRequire(import.meta.url);
const core = dirname(req.resolve('tesseract.js-core/package.json'));
const OCR: Record<string, string> = {
  'worker.min.js': join(dirname(req.resolve('tesseract.js/package.json')), 'dist/worker.min.js'),
  'tesseract-core-simd-lstm.wasm.js': join(core, 'tesseract-core-simd-lstm.wasm.js'),
  'tesseract-core-lstm.wasm.js': join(core, 'tesseract-core-lstm.wasm.js'),
  'spa.traineddata': join(dirname(req.resolve('@tesseract.js-data/spa/package.json')), '4.0.0_best_int/spa.traineddata.gz'),
};
const leer = (ruta: string) => (ruta.endsWith('.gz') ? gunzipSync(readFileSync(ruta)) : readFileSync(ruta));
const lectorOcr = (): Plugin => ({
  name: 'lector-ocr',
  configureServer(s) {
    s.middlewares.use((rq, rs, sig) => {
      const m = rq.url?.match(/\/ocr\/([^?]+)/);
      if (!m || !OCR[m[1]]) return sig();
      rs.setHeader('Content-Type', m[1].endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
      rs.end(leer(OCR[m[1]]));
    });
  },
  generateBundle() {
    for (const [nombre, ruta] of Object.entries(OCR)) this.emitFile({ type: 'asset', fileName: `ocr/${nombre}`, source: leer(ruta) });
  },
});

// base './' para que el build funcione dentro de Android (Capacitor) sin servidor.
export default defineConfig({
  plugins: [react(), lectorOcr()],
  base: './',
  build: { outDir: 'dist', target: 'es2020' },
});
