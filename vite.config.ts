import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'shoe-viewer': resolve(__dirname, 'shoe-viewer/index.html'),
        'particle-flow': resolve(__dirname, 'particle-flow/index.html'),
      },
    },
  },
});
