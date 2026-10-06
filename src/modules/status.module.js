import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'
import { getTerrainExaggeration } from '../core/terrainState.js'

/**
 * 场景状态模块
 * 负责状态栏所需的实时读数：光标处经纬度/高程、相机高度、帧率。
 * 这些是"三维平台"的基本素养——用户要随时知道自己在看哪里、地面有多高。
 */
export default defineModule({
  id: 'status',
  name: '场景状态读数',
  group: '时空数据',
  description: '光标位置、相机高度与帧率',
  layers: [],
  init(ctx) {
    const viewer = ctx.viewer
    const scene = ctx.scene
    const coord = ctx.utils.coord

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((movement) => {
      const carto = coord.pickCartographic(viewer, movement.endPosition)
      if (!carto) {
        scene.setCursor({ lng: null, lat: null, height: null })
        return
      }
      const { lng, lat, height } = coord.toCartographicDegrees(carto)
      // 地形可能被垂直夸张，读数要还原成真实地面高程再显示
      scene.setCursor({ lng, lat, height: height / getTerrainExaggeration() })
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    let lastSample = 0
    let frames = 0
    function sampleStatus() {
      frames += 1
      const now = performance.now()
      if (now - lastSample >= 1000) {
        scene.fps = Math.round((frames * 1000) / (now - lastSample))
        frames = 0
        lastSample = now
        scene.cameraHeight = Math.round(viewer.camera.positionCartographic.height)
      }
      raf = window.requestAnimationFrame(sampleStatus)
    }
    let raf = window.requestAnimationFrame(sampleStatus)

    return {
      destroyStatus() {
        if (raf) window.cancelAnimationFrame(raf)
        raf = null
        if (!handler.isDestroyed()) handler.destroy()
      }
    }
  },
  destroy(ctx, api) {
    api?.destroyStatus?.()
  }
})
