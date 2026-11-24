import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the built dist/ works inside the .ehpk package.
  base: './',
  server: { host: true, port: 5173, strictPort: true },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
