import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'chrome120',
    rolldownOptions: {
      input: { popup: 'popup.html', background: 'src/background.ts' },
      output: { entryFileNames: '[name].js' },
    },
  },
});
