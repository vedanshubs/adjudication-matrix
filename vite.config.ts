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
  },
  // transformers.js loads its own wasm/onnx at runtime; don't let Vite pre-bundle it.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
