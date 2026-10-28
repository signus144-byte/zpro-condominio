import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' para que el build funcione dentro de Android (Capacitor) sin servidor.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', target: 'es2020' },
});
