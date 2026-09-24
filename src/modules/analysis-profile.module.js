import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'
import { EVENTS } from '../core/events/eventBus.js'

/**
 * 剖面分析模块（空间分析 · 剖面）
 * 在场景中画一条线，沿线采样地形高程，输出距离—高程序列，
 * 由 HUD 用图表呈现剖面曲线。这是纯 GIS 的常规操作，
 * 也是"三维场景 + 二维图表"联动的典型场景。
 */
export default defineModule({
  id: 'analysis-profile',
  name: '剖面分析',
  group: '分析图层',
  description: '沿线地形高程采样与剖面曲线',
  layers: [{ id: 'layer-profile', name: '剖面线', group: '分析图层' }],
  init(ctx) {
    const viewer = ctx.viewer
    const geo = ctx.utils.geo
    const coord = ctx.utils.coord

    let active = false
    let points = []
    const entityIds = []
    let sampling = false

    function removeAll() {
      let id
      while ((id = entityIds.pop())) {
        const entity = viewer.entities.getById(id)
        if (entity) viewer.entities.remove(entity)
      }
    }

    function drawPreview() {
      removeAll()
      points.forEach((p, index) => {
        const id = 'profile-vertex-' + index
        viewer.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(p[0], p[1]),
          point: {
            pixelSize: 7,
            color: Cesium.Color.fromCssColorString('#31c8a0'),
            outlineColor: Cesium.Color.fromCssColorString('#0b1622'),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
        entityIds.push(id)
      })
      if (points.length === 2) {
        const id = 'profile-line'
        viewer.entities.add({
          id,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(points.flatMap(([lng, lat]) => [lng, lat])),
            width: 3,
            material: Cesium.Color.fromCssColorString('#31c8a0'),
            clampToGround: true
          }
        })
        entityIds.push(id)
      }
    }

    async function runProfile() {
      if (points.length !== 2 || sampling) return
      sampling = true
      ctx.toast('正在沿线采样地形高程 …')
      try {
        const result = await geo.sampleTerrainProfile(
          ctx.terrainProvider,
          points[0],
          points[1],
          90
        )
        const length = geo.lineLength(points)
        ctx.eventBus.emit(EVENTS.ANALYSIS_RESULT, {
          type: 'profile',
          ...result,
          length,
          lengthText: geo.formatDistance(length),
          elevations: result.elevations
        })
        ctx.toast('剖面分析完成，剖面长度 ' + geo.formatDistance(length))
      } catch (err) {
        console.error('[profile] 分析失败', err)
        ctx.toast('剖面分析失败', 'error')
      } finally {
        sampling = false
      }
    }

    function onClick(movement) {
      if (!active || sampling) return
      const carto = coord.pickCartographic(viewer, movement.position)
      if (!carto) return
      const { lng, lat } = coord.toCartographicDegrees(carto)
      points.push([lng, lat])
      if (points.length > 2) points = [points[points.length - 1]]
      drawPreview()
      if (points.length === 2) runProfile()
    }

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    function stop() {
      active = false
      points = []
      removeAll()
      ctx.scene.activeTool = null
      ctx.eventBus.emit(EVENTS.ANALYSIS_CLEARED, { type: 'profile' })
    }

    return {
      start() {
        active = true
        points = []
        removeAll()
        ctx.scene.activeTool = 'profile'
        ctx.toast('剖面分析：在场景中依次点击起点与终点')
      },
      stop,
      clear: stop,
      setLayerVisible(_layerId, visible) {
        entityIds.forEach((id) => {
          const entity = viewer.entities.getById(id)
          if (entity) entity.show = visible
        })
      },
      destroyHandler() {
        if (!handler.isDestroyed()) handler.destroy()
      }
    }
  },
  destroy(ctx, api) {
    api?.destroyHandler?.()
    api?.stop?.()
  }
})
