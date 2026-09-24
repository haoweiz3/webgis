import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'

/**
 * 主干道模块
 * 数据量为三千余条主干道中的前 800 条（按节点数排序取骨干），
 * 用于提供城市空间参照；默认关闭，需要时在图层树打开。
 */
export default defineModule({
  id: 'roads',
  name: '主干道路网',
  group: '空间数据',
  description: '城市主干道线要素，作为空间参照底衬',
  layers: [{ id: 'layer-roads', name: '主干道', group: '空间数据', defaultVisible: false }],
  init(ctx) {
    const viewer = ctx.viewer
    const features = ctx.data.roads ?? []
    const createdIds = []

    features.forEach((feature) => {
      const coords = feature.geometry?.coordinates ?? []
      if (coords.length < 2) return
      const entity = viewer.entities.add({
        id: 'road-' + feature.properties.id,
        name: feature.properties.name,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(coords.flatMap(([lng, lat]) => [lng, lat])),
          width: 1.6,
          material: Cesium.Color.fromCssColorString('#7fd4ff').withAlpha(0.5),
          clampToGround: true
        }
      })
      createdIds.push(entity.id)
    })

    return {
      setLayerVisible(_layerId, visible) {
        createdIds.forEach((id) => {
          const entity = viewer.entities.getById(id)
          if (entity) entity.show = visible
        })
      },
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
