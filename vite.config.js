import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  plugins: [vue(), cesium()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@data': fileURLToPath(new URL('./public/data', import.meta.url))
    }
  },
  server: {
    port: 5173,
    host: '127.0.0.1'
  },
  build: {
    chunkSizeWarningLimit: 4096
  }
})
