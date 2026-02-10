import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/api/events': { target: 'http://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: '../web/dist',
    emptyOutDir: true,
  },
})
