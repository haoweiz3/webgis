import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'
import { EVENTS } from '../core/events/eventBus.js'
import { WATER_LEVEL } from '../config/scene.js'
import { watch } from 'vue'

/**
 * 淹没分析模块（空间分析 · 淹没）
 * 原理：淹没单元（滩地）各自带一个高程属性，当水位高于该单元高程时即被淹没。
 *   淹没面积 = 被淹没单元面积之和（面积在数据生成阶段按球面多边形真实计算）。
 * 水位来自全局唯一真值 effectiveWaterLevel，因此它与三维水面、站点数据完全同步：
 * 拖时间轴就是洪水演进，拖水位滑块就是设定情景。
 *
 * 数据形态：真实水系下，一个单元沿长江被分成若干河段，
 *   几何是 MultiPolygon（每段一个环），渲染时一段一个实体 ——
 *   这样既不会跨河段连线，单元数与统计口径也保持"高程类别 × 岸别"。
 */
export default defineModule({
  id: 'analysis-flood',
  name: '淹没分析',
  group: '分析图层',
  description: '按水位高程判定淹没单元并统计面积',
  layers: [{ id: 'layer-flood', name: '淹没单元', group: '分析图层', defaultVisible: false }],
  init(ctx) {
    const viewer = ctx.viewer
    const data = ctx.data
    const createdIds = []
    let active = false

    const colorFlooded = Cesium.Color.fromCssColorString('#4fc3f7')
    const colorDry = Cesium.Color.fromCssColorString('#8fa3b8')
    const colorCalm = Cesium.Color.fromCssColorString('#2f9bd8')
    const outlineFlooded = Cesium.Color.fromCssColorString('#9be0ff').withAlpha(0.9)
    const outlineDry = Cesium.Color.fromCssColorString('#6b7d90').withAlpha(0.35)

    function isFlooded(feature) {
      return data.effectiveWaterLevel >= feature.properties.elev_wusong_m
    }

    function fillOf(feature) {
      const flooded = isFlooded(feature)
      if (!active) return flooded ? colorCalm.withAlpha(0.08) : Cesium.Color.TRANSPARENT
      return flooded ? colorFlooded.withAlpha(0.42) : colorDry.withAlpha(0.06)
    }

    function outlineOf(feature) {
      if (!active) return Cesium.Color.TRANSPARENT
      return isFlooded(feature) ? outlineFlooded : outlineDry
    }

    ;(data.floodBands ?? []).forEach((feature) => {
      const geometry = feature.geometry
      const rings =
        geometry?.type === 'MultiPolygon'
          ? geometry.coordinates.map((polygon) => polygon[0])
          : [geometry?.coordinates?.[0]]

      rings.forEach((ring, index) => {
        if (!ring?.length) return
        const entity = viewer.entities.add({
          id: index === 0 ? 'flood-' + feature.properties.id : `flood-${feature.properties.id}-${index}`,
          name: feature.properties.name + '（' + feature.properties.bank + '）',
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(
              Cesium.Cartesian3.fromDegreesArray(ring.flatMap(([lng, lat]) => [lng, lat]))
            ),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            material: new Cesium.ColorMaterialProperty(
              new Cesium.CallbackProperty(() => fillOf(feature), false)
            ),
            outline: true,
            outlineColor: new Cesium.CallbackProperty(() => outlineOf(feature), false)
          }
        })
        entity.show = false
        entity.__meta = { kind: 'floodBand', feature }
        createdIds.push(entity.id)
      })
    })

    function computeResult() {
      const level = data.effectiveWaterLevel
      const bands = data.floodBands ?? []
      const flooded = bands.filter(isFlooded)
      const areaKm2 = flooded.reduce((sum, f) => sum + (f.properties.area_km2 || 0), 0)
      const totalKm2 = bands.reduce((sum, f) => sum + (f.properties.area_km2 || 0), 0)
      return {
        type: 'flood',
        level,
        levelText: level.toFixed(2) + ' m',
        areaKm2: Number(areaKm2.toFixed(2)),
        totalKm2: Number(totalKm2.toFixed(2)),
        ratio: totalKm2 > 0 ? areaKm2 / totalKm2 : 0,
        floodedCount: flooded.length,
        bandCount: bands.length,
        overWarn: level >= WATER_LEVEL.warn,
        bands: flooded.map((f) => ({
          id: f.properties.id,
          name: f.properties.name,
          bank: f.properties.bank,
          elev: f.properties.elev_wusong_m,
          area: f.properties.area_km2
        }))
      }
    }

    function publish() {
      ctx.eventBus.emit(EVENTS.ANALYSIS_RESULT, computeResult())
    }

    const stopWatch = watch(() => data.effectiveWaterLevel, publish)

    return {
      setActive(next) {
        active = Boolean(next)
        createdIds.forEach((id) => {
          const entity = viewer.entities.getById(id)
          if (entity) entity.show = active
        })
        if (active) publish()
      },
      isActive: () => active,
      setLayerVisible(_layerId, visible) {
        active = visible
        createdIds.forEach((id) => {
          const entity = viewer.entities.getById(id)
          if (entity) entity.show = visible
        })
      },
      getResult: computeResult,
      stopWatch: () => stopWatch(),
      getEntityIds: () => [...createdIds]
    }
  },
  destroy(ctx, api) {
    api?.stopWatch?.()
    const viewer = ctx.viewer
    if (!viewer) return
    // MultiPolygon 的滩地单元一段一个实体，必须按实际创建的 id 逐个移除
    ;(api?.getEntityIds?.() ?? []).forEach((id) => {
      const entity = viewer.entities.getById(id)
      if (entity) viewer.entities.remove(entity)
    })
  }
})
