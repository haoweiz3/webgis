import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'
import { BASE_MAPS, TIANDITU_ANNOTATION } from '../config/scene.js'

const TK = import.meta.env.VITE_TIANDITU_KEY || ''

/**
 * 底图与注记模块
 * 统一管理影像图层：高德影像 / 高德矢量 / 天地图影像（需免费 tk），
 * 影像与注记分离，便于图层树独立控制。
 */
export default defineModule({
  id: 'basemap',
  name: '底图与注记',
  group: '影像底图',
  description: '影像底图切换与注记图层控制',
  layers: [
    { id: 'layer-imagery', name: '影像底图', group: '影像底图' },
    { id: 'layer-annotation', name: '地名注记', group: '影像底图', defaultVisible: true }
  ],
  init(ctx) {
    const viewer = ctx.viewer
    const available = BASE_MAPS.filter((item) => item.kind !== 'tianditu' || TK)
    ctx.scene.hasTiandituKey = Boolean(TK)
    ctx.scene.baseMaps = available

    let baseLayer = null
    let annotationLayer = null
    let imageryVisible = true
    let annotationVisible = true

    function createProvider(config) {
      if (config.kind === 'tianditu') {
        return new Cesium.WebMapTileServiceImageryProvider({
          url: config.url.replace('{key}', TK),
          layer: config.layer,
          style: 'default',
          format: 'tiles',
          tileMatrixSetID: 'w',
          maximumLevel: config.maximumLevel,
          subdomains: config.subdomains,
          credit: config.credit
        })
      }
      return new Cesium.UrlTemplateImageryProvider({
        url: config.url,
        subdomains: config.subdomains,
        maximumLevel: config.maximumLevel,
        credit: config.credit
      })
    }

    function createAnnotationProvider() {
      if (TK) {
        return new Cesium.WebMapTileServiceImageryProvider({
          url: TIANDITU_ANNOTATION.url.replace('{key}', TK),
          layer: TIANDITU_ANNOTATION.layer,
          style: 'default',
          format: 'tiles',
          tileMatrixSetID: 'w',
          maximumLevel: TIANDITU_ANNOTATION.maximumLevel,
          subdomains: TIANDITU_ANNOTATION.subdomains,
          credit: '天地图'
        })
      }
      // 无天地图 tk 时使用高德注记瓦片
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&style=8&x={x}&y={y}&z={z}',
        subdomains: ['1', '2', '3', '4'],
        maximumLevel: 18,
        credit: '高德地图'
      })
    }

    function applyBaseMap(id) {
      const config = available.find((item) => item.id === id) || available[0]
      if (baseLayer) viewer.imageryLayers.remove(baseLayer, true)
      baseLayer = viewer.imageryLayers.addImageryProvider(createProvider(config))
      baseLayer.show = imageryVisible
      ctx.scene.baseMapId = config.id
      if (annotationLayer) viewer.imageryLayers.raiseToTop(annotationLayer)
    }

    baseLayer = viewer.imageryLayers.addImageryProvider(createProvider(available[0]))
    annotationLayer = viewer.imageryLayers.addImageryProvider(createAnnotationProvider())

    return {
      setBaseMap(id) {
        applyBaseMap(id)
      },
      setLayerVisible(layerId, visible) {
        if (layerId === 'layer-imagery') {
          imageryVisible = visible
          if (baseLayer) baseLayer.show = visible
        }
        if (layerId === 'layer-annotation') {
          annotationVisible = visible
          if (annotationLayer) annotationLayer.show = visible
        }
      },
      isAnnotationVisible: () => annotationVisible
    }
  }
})
