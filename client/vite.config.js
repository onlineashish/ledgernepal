import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development the browser talks only to Vite; /api is forwarded to Express.
    // In production Express serves both, so the browser always sees one origin.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    css: false,
  },
});
