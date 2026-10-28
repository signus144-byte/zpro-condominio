import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 1200 }, // exceljs (~900 kB) se carga aparte, solo al importar unidades
});
