import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'
import { EVENTS } from '../core/events/eventBus.js'
import { MEASURE_STYLE } from '../config/scene.js'

/**
 * 量算工具模块（空间分析 · 量算）
 * 距离量算：逐点连接，按椭球测地线累加真实距离；
 * 面积量算：依次点边界点，再点回起点视为闭合，
 * 只有形成完整多边形后才按球面多边形公式计算真实面积。
 *
 * 结果绘制：面积结果（填充、描边与顶点）抬到地形与水面之上
 * （见 displayHeights），不会被水域面或地形网格盖住，始终画在最上层；
 * 距离量算沿用贴地折线，保持"沿地面量距离"的直观。
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
    const MEASURE_COLOR = '#ffd166'

    let mode = null
    let lngLats = []
    let hover = null
    const entityIds = []
    let previewId = null
    let labelId = null
    /** 面积量算是否已闭合：只有再次点中起点、形成完整多边形后才算面积 */
    let closed = false
    /** 「点回起点」的屏幕判定容差（像素） */
    const CLOSE_TOLERANCE_PX = 14

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
      // 面积只在闭合（点回起点、且至少 3 个点）之后才成立
      const isClosed = mode === 'area' && closed && lngLats.length >= 3
      const line = isClosed ? [...lngLats, lngLats[0]] : lngLats
      const length = lngLats.length >= 2 ? geo.lineLength(line) : 0
      const area = isClosed ? geo.ringArea(lngLats) : 0
      return {
        type: 'measure',
        mode,
        vertices: lngLats.length,
        length,
        lengthText: geo.formatDistance(length),
        area,
        areaText: isClosed ? geo.formatArea(area) : '--',
        closed: isClosed,
        /** 已够点数、正在等待"点回起点"闭合 */
        awaitingClose: mode === 'area' && !isClosed && lngLats.length >= 3
      }
    }

    /**
     * 每个顶点的显示高程（场景高程，米）
     * -------------------------------------------------------------
     * 顶点存的是"拾取点"(lng, lat, 场景高程)：三维场景里 globe.pick 打在
     * 渲染后的地形网格上，拿到的高程已经把垂直夸张算进去了（状态栏的地面
     * 读数除以夸张倍数才是真实高程，同一条链路）。
     *
     * 取"该点地面"与"当前水面"的较大者再加抬升量：江面上的量算就不会被
     * 水面盖住（水面是另一层实体，压在地形格网之上），城区量算也只抬几米。
     */
    function displayHeights(points) {
      const waterScene = geo.wusongToScene(ctx.data.effectiveWaterLevel)
      return points.map((point) => {
        const ground = Number.isFinite(point[2]) ? point[2] : 0
        return Math.max(ground, waterScene) + MEASURE_STYLE.liftM
      })
    }

    /** 经纬度（含拾取高程）→ 抬到最上层的 Cartesian3 数组 */
    function toCartesians(points) {
      const heights = displayHeights(points)
      const flat = []
      points.forEach(([lng, lat], index) => flat.push(lng, lat, heights[index]))
      return Cesium.Cartesian3.fromDegreesArrayHeights(flat)
    }

    function draw() {
      clearGraphics()
      if (lngLats.length === 0) return

      // 点数已够、还没闭合时把起点放大高亮，提示"点这里闭合"
      const closeable = mode === 'area' && !closed && lngLats.length >= 3
      const positions = toCartesians(lngLats)

      // 顶点：位置同样按抬升后的高程摆放，才会正好落在面上
      lngLats.forEach((p, index) => {
        const id = 'measure-vertex-' + index
        const isCloseHandle = closeable && index === 0
        viewer.entities.add({
          id,
          position: positions[index],
          point: {
            pixelSize: isCloseHandle ? 10 : 7,
            color: Cesium.Color.fromCssColorString(isCloseHandle ? '#31c8a0' : MEASURE_COLOR),
            outlineColor: Cesium.Color.fromCssColorString('#0b1622'),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
        entityIds.push(id)
      })

      const flat = lngLats.flatMap(([lng, lat]) => [lng, lat])
      if (mode === 'area' && closed && lngLats.length >= 3) {
        // 面积结果：抬到水面与地形之上的半透明填充 + 独立描边
        const areaId = 'measure-area'
        viewer.entities.add({
          id: areaId,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            perPositionHeight: true,
            material: Cesium.Color.fromCssColorString(MEASURE_COLOR).withAlpha(MEASURE_STYLE.areaAlpha),
            outline: false
          }
        })
        entityIds.push(areaId)

        const outlineId = 'measure-area-outline'
        viewer.entities.add({
          id: outlineId,
          polyline: {
            positions: toCartesians([...lngLats, lngLats[0]]),
            width: 3,
            material: Cesium.Color.fromCssColorString(MEASURE_COLOR)
          }
        })
        entityIds.push(outlineId)
      } else if (lngLats.length >= 2) {
        const id = 'measure-line'
        viewer.entities.add({
          id,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(flat),
            width: 3,
            material: Cesium.Color.fromCssColorString(MEASURE_COLOR),
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
        position: positions[positions.length - 1],
        label: {
          text: new Cesium.CallbackProperty(() => {
            const r = currentResult()
            if (r.mode === 'area') {
              if (r.closed) return '面积 ' + r.areaText
              return r.awaitingClose ? '点击起点闭合，再计算面积' : '面积量算：至少 3 个点'
            }
            return '距离 ' + r.lengthText
          }, false),
          font: '13px "Microsoft YaHei", sans-serif',
          fillColor: Cesium.Color.fromCssColorString(MEASURE_COLOR),
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

    /**
     * 这次点击是否落在首点上（按屏幕像素距离判定）
     * 三维场景里同一个地理位置随视角与地形拾取会有细微差异，
     * 用经纬度阈值判定"点回起点"不可靠，屏幕距离才是用户实际看到的"同一个点"。
     */
    function isNearFirstPoint(windowPosition) {
      if (!lngLats.length) return false
      // 首点按"实际画出来的位置"判定，否则会和抬升后的顶点差出几个像素
      const first = toCartesians(lngLats)[0]
      const screen = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, first)
      if (!screen) return false
      const dx = screen.x - windowPosition.x
      const dy = screen.y - windowPosition.y
      return Math.sqrt(dx * dx + dy * dy) <= CLOSE_TOLERANCE_PX
    }

    function onClick(movement) {
      if (!mode) return
      const carto = coord.pickCartographic(viewer, movement.position)
      if (!carto) return
      // 高程一并留下：量算图形要按"拾取到的渲染地形高度"抬到最上层
      const { lng, lat, height } = coord.toCartographicDegrees(carto)

      if (mode === 'area') {
        // 已闭合的结果保留在场景里；再次点击开始新的多边形
        if (closed) {
          lngLats = [[lng, lat, height]]
          closed = false
          draw()
          emitResult()
          return
        }
        // 再次选中起点（至少 3 个点）才算一个完成的多边形，此时才计算面积
        if (lngLats.length >= 3 && isNearFirstPoint(movement.position)) {
          closed = true
          draw()
          const result = emitResult()
          ctx.toast('多边形已闭合，面积 ' + result.areaText)
          return
        }
      }

      lngLats.push([lng, lat, height])
      draw()
      emitResult()
    }

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    function reset() {
      lngLats = []
      hover = null
      closed = false
      clearGraphics()
    }

    return {
      start(nextMode) {
        mode = nextMode
        ctx.scene.activeTool = 'measure-' + nextMode
        reset()
        ctx.toast(
          nextMode === 'area'
            ? '面积量算：依次点击边界点，最后点回起点闭合后计算面积'
            : '距离量算：依次点击测点，双击结束'
        )
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
