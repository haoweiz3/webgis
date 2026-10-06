import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

/**
 * 部署基路径
 * ------------------------------------------------------------------
 * 根路径部署（本地 pnpm preview、Vercel、自有域名）：保持默认 '/'。
 * 子路径部署（GitHub Pages 项目站 https://<用户>.github.io/<仓库>/）：用 './'。
 *   GitHub Pages：DEPLOY_BASE=./ pnpm build
 *   Vercel 等：   pnpm build
 * 为什么子路径要用相对值而不是 '/<仓库>/'：vite-plugin-cesium 在非根 base 下会把 Cesium
 * 资源复制到 dist/<仓库>/cesium，而页面引用的是 /<仓库>/cesium，两者错位导致 404；
 * 用 './' 时复制位置正确，且相对路径在任何部署路径下都能解析。
 * 已在静态服务器上按 /webgis/ 子路径验证：首页、Cesium.js、Widgets、Workers 与全部数据文件均 200。
 */
const base = process.env.DEPLOY_BASE ?? '/'

export default defineConfig({
  base,
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
