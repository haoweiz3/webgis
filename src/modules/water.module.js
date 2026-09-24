import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'

/**
 * 水域模块
 * 水面高程由水位数据驱动：拖动时间轴或手动设定水位，水面实时升降。
 * 水面对两岸的正确遮挡依赖 scene.globe.depthTestAgainstTerrain = true（在视图工厂里设置）。
 */
export default defineModule({
  id: 'water',
  name: '水域与岸线',
  group: '空间数据',
  description: '长江武汉段水域面与岸线',
  layers: [
    { id: 'layer-water', name: '水域面', group: '空间数据' },
    { id: 'layer-shoreline', name: '岸线', group: '空间数据' }
  ],
  init(ctx) {
    const viewer = ctx.viewer
    const data = ctx.data
    const geo = ctx.utils.geo
    const createdIds = []

    const waterRing = data.water?.geometry?.coordinates?.[0]
    if (waterRing?.length) {
      const flat = waterRing.flatMap(([lng, lat]) => [lng, lat])
      const entity = viewer.entities.add({
        id: 'water-surface',
        name: '长江武汉段水域面',
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)),
          // 每帧读取当前水位，拖动时间轴或滑块时水面自动升降，无需重建实体
          height: new Cesium.CallbackProperty(
            () => geo.wusongToScene(data.effectiveWaterLevel),
            false
          ),
          material: Cesium.Color.fromCssColorString('#1d6fa5').withAlpha(0.78),
          outline: false,
          perPositionHeight: false
        }
      })
      createdIds.push(entity.id)
    }

    ;(data.shoreline?.features ?? []).forEach((feature, index) => {
      const coords = feature.geometry?.coordinates
      if (!coords?.length) return
      const entity = viewer.entities.add({
        id: 'shoreline-' + index,
        name: feature.properties?.name ?? '岸线',
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(coords.flatMap(([lng, lat]) => [lng, lat])),
          width: 2,
          material: Cesium.Color.fromCssColorString('#8fd6ff').withAlpha(0.85),
          clampToGround: true
        }
      })
      createdIds.push(entity.id)
    })

    return {
      setLayerVisible(layerId, visible) {
        createdIds
          .filter((id) => (layerId === 'layer-water' ? id === 'water-surface' : id.startsWith('shoreline-')))
          .forEach((id) => {
            const entity = viewer.entities.getById(id)
            if (entity) entity.show = visible
          })
      },
      /** 当前水面高程（场景高程，米） */
      getWaterHeight: () => geo.wusongToScene(data.effectiveWaterLevel),
      getEntityIds: () => [...createdIds]
    }
  },
  destroy(ctx, api) {
    const viewer = ctx.viewer
    if (!viewer) return
    ;(api?.getEntityIds?.() ?? []).forEach((id) => {
      const entity = viewer.entities.getById(id)
      if (entity) viewer.entities.remove(entity)
    })
  }
})
