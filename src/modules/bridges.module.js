import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'
import { EVENTS } from '../core/events/eventBus.js'

/**
 * 跨江桥梁模块
 * 线要素承载几何、属性承载信息，点选后由 HUD 弹出属性卡 ——
 * 这是"要素 + 属性"这条 GIS 基本范式在三维场景里的体现。
 */
export default defineModule({
  id: 'bridges',
  name: '跨江桥梁',
  group: '空间数据',
  description: '跨江桥梁线要素与属性查询',
  layers: [{ id: 'layer-bridges', name: '跨江桥梁', group: '空间数据' }],
  init(ctx) {
    const viewer = ctx.viewer
    const features = ctx.data.bridges ?? []
    const createdIds = []

    features.forEach((feature) => {
      const coords = feature.geometry?.coordinates ?? []
      if (coords.length < 2) return
      const flat = coords.flatMap(([lng, lat]) => [lng, lat])
      const positions = Cesium.Cartesian3.fromDegreesArray(flat)

      const lineEntity = viewer.entities.add({
        id: 'bridge-line-' + feature.properties.id,
        name: feature.properties.name,
        polyline: {
          positions,
          width: 6,
          material: Cesium.Color.fromCssColorString('#ffb703').withAlpha(0.95),
          clampToGround: false
        }
      })
      lineEntity.__meta = { kind: 'bridge', feature }
      createdIds.push(lineEntity.id)

      // 桥位标注点：更容易点选，也方便做相机定位
      const mid = Cesium.Cartesian3.midpoint(positions[0], positions[positions.length - 1], new Cesium.Cartesian3())
      const labelEntity = viewer.entities.add({
        id: 'bridge-label-' + feature.properties.id,
        name: feature.properties.name,
        position: mid,
        point: {
          pixelSize: 9,
          color: Cesium.Color.fromCssColorString('#ffb703'),
          outlineColor: Cesium.Color.fromCssColorString('#1b2430'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: feature.properties.name,
          font: '13px "Microsoft YaHei", sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#ffffff'),
          outlineColor: Cesium.Color.fromCssColorString('#0b1622'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 40000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
      labelEntity.__meta = { kind: 'bridge', feature }
      createdIds.push(labelEntity.id)
    })

    function onClick(movement) {
      if (ctx.scene.activeTool) return
      const picked = viewer.scene.pick(movement.position)
      const meta = picked?.id?.__meta
      if (meta?.kind === 'bridge') {
        ctx.data.selectFeature({ kind: 'bridge', feature: meta.feature })
        ctx.eventBus.emit(EVENTS.FEATURE_SELECTED, { kind: 'bridge', feature: meta.feature })
      }
    }

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return {
      setLayerVisible(_layerId, visible) {
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
