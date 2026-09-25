import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'
import { gcj02TilingScheme } from '../core/cesium/gcjTilingScheme.js'
import { BASE_MAPS, TIANDITU_ANNOTATION } from '../config/scene.js'

const TK = import.meta.env.VITE_TIANDITU_KEY || ''

/**
 * 底图与注记模块
 * 统一管理影像图层：高德影像 / 高德矢量 / 天地图影像（需免费 tk），
 * 影像与注记分离，便于图层树独立控制。
 *
 * 坐标系统一（GIS 专业要点）：
 *   高德瓦片是 GCJ-02 加密坐标，直接叠加会让底图与矢量错位约 600 m；
 *   天地图是 2000 国家大地坐标系，与 WGS-84 在演示精度下一致。
 *   因此只给高德图层挂上纠偏瓦片方案（gcj02TilingScheme），
 *   影像与注记用同一套方案，保证两者之间也相互对齐；
 *   业务数据、量算与剖面口径始终是 WGS-84，不因底图切换而改变。
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
      // 高德影像/矢量瓦片均为 GCJ-02，需纠偏到 WGS-84 后显示；
      // 将来接入 Esri / OSM 等本身就是 WGS-84 的底图时，不要再挂这个方案
      return new Cesium.UrlTemplateImageryProvider({
        url: config.url,
        subdomains: config.subdomains,
        maximumLevel: config.maximumLevel,
        credit: config.credit,
        tilingScheme: config.kind === 'amap' ? gcj02TilingScheme() : undefined
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
        credit: '高德地图',
        tilingScheme: gcj02TilingScheme()
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
