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
  },
});
