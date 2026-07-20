import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: false,
    // the RAG tier runs server-side (credentials + heavy embedding index)
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT ?? 5174}`, changeOrigin: true } },
  },
  // transformers.js loads its own wasm/onnx at runtime; don't let Vite pre-bundle it.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
