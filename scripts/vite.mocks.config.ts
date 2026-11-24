import { defineConfig } from 'vite';

// Bundles scripts/render-mocks.ts into a plain Node script (npm run mocks).
export default defineConfig({
  build: {
    ssr: 'scripts/render-mocks.ts',
    outDir: 'build-scripts',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'render-mocks.mjs' } },
  },
  ssr: { noExternal: true },
});
