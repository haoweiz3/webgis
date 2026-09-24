import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'
import { EVENTS } from '../core/events/eventBus.js'
import { GRADIENT, STATION_STYLE, WATER_LEVEL } from '../config/scene.js'

/**
 * 监测站点模块（时空数据的场景表达）
 * 同一批站点数据，随「专题字段」与「时间轴」变化：
 *   水位站 → 按水位高低分级着色，超警戒变红；
 *   水质站 → 按水质类别着色；
 *   雨量站 → 按小时雨量着色。
 * 颜色与数值都用 CallbackProperty 逐帧读取状态，所以时间推进时场景自动更新。
 */
export default defineModule({
  id: 'stations',
  name: '监测站点',
  group: '时空数据',
  description: '水位站 / 水质站 / 雨量站时空数据表达',
  layers: [
    { id: 'layer-stations', name: '监测站点', group: '时空数据' },
    { id: 'layer-station-labels', name: '站点数值标注', group: '时空数据' }
  ],
  init(ctx) {
    const viewer = ctx.viewer
    const data = ctx.data
    const time = ctx.time
    const createdIds = []
    const labelIds = []

    const ramp = GRADIENT.map((hex) => Cesium.Color.fromCssColorString(hex))
    const normalColor = Cesium.Color.fromCssColorString('#2f9bd8')
    const warnColor = Cesium.Color.fromCssColorString('#ff4d6d')

    function rampColor(ratio) {
      const t = Math.min(0.999, Math.max(0, ratio))
      return ramp[Math.floor(t * ramp.length)]
    }

    /** 当前时刻、当前专题字段下该站点的显示样式 */
    function styleOf(feature) {
      const props = feature.properties
      const field = data.field
      const index = time.index

      if (props.category === 'waterLevel') {
        const value = data.valueAt(props.id, 'waterLevel', index)
        if (value == null) return { color: normalColor, size: STATION_STYLE.waterLevel.pixelSize }
        const span = Math.max(0.5, WATER_LEVEL.warn - WATER_LEVEL.min)
        const ratio = (value - WATER_LEVEL.min) / span
        return {
          color: value >= WATER_LEVEL.warn ? warnColor : rampColor(ratio * 0.85),
          size: STATION_STYLE.waterLevel.pixelSize + (value >= WATER_LEVEL.warn ? 4 : 0)
        }
      }

      if (props.category === 'waterQuality') {
        const grade = data.valueAt(props.id, 'grade', index) ?? props.baseGrade
        return { color: rampColor((grade - 1) / 5), size: STATION_STYLE.waterQuality.pixelSize }
      }

      const rain = data.valueAt(props.id, 'rain', index) ?? 0
      return {
        color: rampColor(rain / 22),
        size: STATION_STYLE.rain.pixelSize + Math.min(6, rain / 5)
      }
    }

    function valueText(feature) {
      const props = feature.properties
      if (props.category === 'waterLevel') {
        const value = data.valueAt(props.id, 'waterLevel', time.index)
        return value == null ? '' : value.toFixed(2) + ' m'
      }
      if (props.category === 'waterQuality') {
        const grade = data.valueAt(props.id, 'grade', time.index)
        return grade == null ? '' : grade + ' 类'
      }
      const rain = data.valueAt(props.id, 'rain', time.index)
      return rain == null ? '' : rain.toFixed(1) + ' mm'
    }

    ;(data.stations ?? []).forEach((feature) => {
      const [lng, lat] = feature.geometry.coordinates
      const props = feature.properties
      const entity = viewer.entities.add({
        id: 'station-' + props.id,
        name: props.name,
        position: Cesium.Cartesian3.fromDegrees(lng, lat),
        point: {
          pixelSize: new Cesium.CallbackProperty(() => styleOf(feature).size, false),
          color: new Cesium.CallbackProperty(() => styleOf(feature).color, false),
          outlineColor: Cesium.Color.fromCssColorString('#0b1622'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
      entity.__meta = { kind: 'station', feature }
      createdIds.push(entity.id)

      // 水位站带数值标注，让"时空变化"在场景里直接可见
      if (props.category === 'waterLevel') {
        const label = viewer.entities.add({
          id: 'station-label-' + props.id,
          name: props.name + ' 数值标注',
          position: Cesium.Cartesian3.fromDegrees(lng, lat),
          label: {
            text: new Cesium.CallbackProperty(
              () => props.name.replace('水位站', '') + ' ' + valueText(feature),
              false
            ),
            font: '12px "Microsoft YaHei", sans-serif',
            fillColor: new Cesium.CallbackProperty(
              () => (data.valueAt(props.id, 'waterLevel', time.index) >= WATER_LEVEL.warn
                ? warnColor
                : Cesium.Color.WHITE),
              false
            ),
            outlineColor: Cesium.Color.fromCssColorString('#0b1622'),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            scale: 0.95,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
        label.__meta = { kind: 'station', feature }
        createdIds.push(label.id)
        labelIds.push(label.id)
      }
    })

    function onClick(movement) {
      if (ctx.scene.activeTool) return
      const picked = viewer.scene.pick(movement.position)
      const meta = picked?.id?.__meta
      if (meta?.kind === 'station') {
        data.selectStation(meta.feature.properties.id)
        ctx.eventBus.emit(EVENTS.STATION_SELECTED, { id: meta.feature.properties.id })
      }
    }

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return {
      setLayerVisible(layerId, visible) {
        if (layerId === 'layer-station-labels') {
          labelIds.forEach((id) => {
            const entity = viewer.entities.getById(id)
            if (entity) entity.show = visible
          })
          return
        }
        createdIds.forEach((id) => {
          const entity = viewer.entities.getById(id)
          if (entity) entity.show = visible
        })
      },
      getEntityIds: () => [...createdIds],
      destroyHandler() {
        if (!handler.isDestroyed()) handler.destroy()
      }
    }
  },
  destroy(ctx, api) {
    const viewer = ctx.viewer
    if (!viewer) return
    api?.destroyHandler?.()
    ;(api?.getEntityIds?.() ?? []).forEach((id) => {
      const entity = viewer.entities.getById(id)
      if (entity) viewer.entities.remove(entity)
    })
  }
})
