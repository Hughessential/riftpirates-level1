import { defineConfig } from 'vite';

export default defineConfig({
  // Keep the preview URL stable; report a port conflict instead of silently
  // moving to 8001 and leaving the player looking at a stale server on 8000.
  server: { strictPort: true },
  preview: { strictPort: true },
  // Audio is loaded dynamically by cue name, so serve/copy the curated runtime
  // library verbatim instead of forcing every sample into the JavaScript graph.
  publicDir: 'assets',
  build: {
    target: 'es2022',
    // The intentionally isolated Three.js engine chunk is ~594 kB minified
    // (~148 kB gzip). Keep a documented ceiling above that stable vendor
    // boundary while retaining the default-sized budget for the game chunk.
    chunkSizeWarningLimit: 650,
    // Keep the renderer cached across gameplay/UI releases instead of making
    // returning players download the whole engine with every game change.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
