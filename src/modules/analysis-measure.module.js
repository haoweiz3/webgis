import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'
import { EVENTS } from '../core/events/eventBus.js'

/**
 * 量算工具模块（空间分析 · 量算）
 * 距离量算：逐点连接，按椭球测地线累加真实距离；
 * 面积量算：闭合多边形，按球面多边形公式计算真实面积。
 */
export default defineModule({
  id: 'analysis-measure',
  name: '量算工具',
  group: '分析图层',
  description: '距离量算与面积量算',
  layers: [{ id: 'layer-measure', name: '量算结果', group: '分析图层' }],
  init(ctx) {
    const viewer = ctx.viewer
    const geo = ctx.utils.geo
    const coord = ctx.utils.coord

    let mode = null
    let lngLats = []
    let hover = null
    const entityIds = []
    let previewId = null
    let labelId = null

    function removeEntity(id) {
      const entity = id && viewer.entities.getById(id)
      if (entity) viewer.entities.remove(entity)
    }

    function clearGraphics() {
      let id
      while ((id = entityIds.pop())) removeEntity(id)
      removeEntity(previewId)
      removeEntity(labelId)
      previewId = null
      labelId = null
    }

    function currentResult() {
      const closed = mode === 'area' && lngLats.length >= 3
      const line = closed ? [...lngLats, lngLats[0]] : lngLats
      const length = lngLats.length >= 2 ? geo.lineLength(line) : 0
      const area = closed ? geo.ringArea(lngLats) : 0
      return {
        type: 'measure',
        mode,
        vertices: lngLats.length,
        length,
        lengthText: geo.formatDistance(length),
        area,
        areaText: geo.formatArea(area),
        closed
      }
    }

    function draw() {
      clearGraphics()
      if (lngLats.length === 0) return

      // 顶点
      lngLats.forEach((p, index) => {
        const id = 'measure-vertex-' + index
        viewer.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(p[0], p[1]),
          point: {
            pixelSize: 7,
            color: Cesium.Color.fromCssColorString('#ffd166'),
            outlineColor: Cesium.Color.fromCssColorString('#0b1622'),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
        entityIds.push(id)
      })

      const flat = lngLats.flatMap(([lng, lat]) => [lng, lat])
      if (mode === 'area' && lngLats.length >= 3) {
        const id = 'measure-area'
        viewer.entities.add({
          id,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)),
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            material: Cesium.Color.fromCssColorString('#ffd166').withAlpha(0.28),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#ffd166')
          }
        })
        entityIds.push(id)
      } else if (lngLats.length >= 2) {
        const id = 'measure-line'
        viewer.entities.add({
          id,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(flat),
            width: 3,
            material: Cesium.Color.fromCssColorString('#ffd166'),
            clampToGround: true
          }
        })
        entityIds.push(id)
      }

      // 结果标注贴在上一个顶点旁边
      const last = lngLats[lngLats.length - 1]
      labelId = 'measure-label'
      viewer.entities.add({
        id: labelId,
        position: Cesium.Cartesian3.fromDegrees(last[0], last[1]),
        label: {
          text: new Cesium.CallbackProperty(() => {
            const r = currentResult()
            if (r.mode === 'area') {
              return r.closed ? '面积 ' + r.areaText : '面积量算：至少 3 个点'
            }
            return '距离 ' + r.lengthText
          }, false),
          font: '13px "Microsoft YaHei", sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#ffd166'),
          outlineColor: Cesium.Color.fromCssColorString('#0b1622'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
      entityIds.push(labelId)
    }

    function emitResult() {
      const result = currentResult()
      ctx.eventBus.emit(EVENTS.ANALYSIS_RESULT, result)
      return result
    }

    function onClick(movement) {
      if (!mode) return
      const carto = coord.pickCartographic(viewer, movement.position)
      if (!carto) return
      const { lng, lat } = coord.toCartographicDegrees(carto)
      lngLats.push([lng, lat])
      draw()
      emitResult()
    }

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    function reset() {
      lngLats = []
      hover = null
      clearGraphics()
    }

    return {
      start(nextMode) {
        mode = nextMode
        ctx.scene.activeTool = 'measure-' + nextMode
        reset()
        ctx.toast(nextMode === 'area' ? '面积量算：依次点击边界点，至少 3 个点' : '距离量算：依次点击测点，双击结束')
      },
      stop() {
        mode = null
        ctx.scene.activeTool = null
        reset()
        ctx.eventBus.emit(EVENTS.ANALYSIS_CLEARED, { type: 'measure' })
      },
      clear() {
        reset()
        mode = null
        ctx.scene.activeTool = null
        ctx.eventBus.emit(EVENTS.ANALYSIS_CLEARED, { type: 'measure' })
      },
      isActive: () => Boolean(mode),
      getResult: () => currentResult(),
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
    api?.clear?.()
  }
})
