import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'
import { TERRAIN_SERVICE } from '../config/scene.js'

/**
 * 地形模块
 * 使用 ArcGIS 全球地形服务（无需密钥），可随时切换为椭球面以对比效果。
 */
export default defineModule({
  id: 'terrain',
  name: '三维地形',
  group: '地形',
  description: '全球地形服务加载与开关',
  layers: [{ id: 'layer-terrain', name: '地形起伏', group: '地形' }],
  init(ctx) {
    const viewer = ctx.viewer
    const ellipsoid = new Cesium.EllipsoidTerrainProvider()
    let terrainProvider = null
    let enabled = true

    function apply() {
      viewer.terrainProvider = enabled && terrainProvider ? terrainProvider : ellipsoid
    }

    async function load() {
      try {
        const provider = new Cesium.ArcGISTiledElevationTerrainProvider({
          url: TERRAIN_SERVICE.url,
          requestVertexNormals: TERRAIN_SERVICE.requestVertexNormals
        })
        await provider.readyPromise
        terrainProvider = provider
        apply()
        ctx.toast('地形服务已加载，可进行剖面分析')
      } catch (err) {
        console.warn('[terrain] 地形服务加载失败', err)
        ctx.toast('地形服务不可用，已使用椭球面（剖面结果为椭球高）', 'warn')
      }
    }

    load()

    return {
      setEnabled(next) {
        enabled = next
        ctx.scene.terrainEnabled = next
        apply()
      },
      setLayerVisible(_layerId, visible) {
        enabled = visible
        ctx.scene.terrainEnabled = visible
        apply()
      }
    }
  }
})
