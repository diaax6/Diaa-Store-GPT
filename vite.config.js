import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'https://ai-redeem.cc',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        secure: true,
        headers: {
          'Origin': 'https://ai-redeem.cc',
          'Referer': 'https://ai-redeem.cc/',
          'X-Product-ID': 'chatgpt',
        },
      },
    },
  },
});
