import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    target: 'chrome120',
    emptyOutDir: false,
    lib: {
      entry: 'src/content.ts',
      name: 'TubePulseContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
