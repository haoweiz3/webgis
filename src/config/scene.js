/**
 * 场景与业务参数配置
 * ------------------------------------------------------------------
 * 高程基准说明（GIS 专业要点）：
 *   站点的水位、滩地高程、警戒水位全部采用「吴淞高程」，
 *   空间分析与阈值判定都在同一基准下完成，避免混用基准导致结论错误；
 *   只有在三维渲染时才按固定偏移量换算成场景高程（近似 EGM96 大地水准面高）。
 *   DATUM_OFFSET_M 为演示取值，生产环境应使用高程基准转换模型或控制点精算。
 */

export const DATUM_OFFSET_M = -8.0

export const SCENE_DEFAULTS = {
  globeBaseColor: '#0b1622',
  atmosphereBrightnessShift: -0.12,
  fogDensity: 0.00012
}

/** 研究区范围（长江武汉段） */
export const STUDY_AREA = {
  west: 113.82,
  south: 30.16,
  east: 114.78,
  north: 30.84,
  center: { lng: 114.3, lat: 30.52 }
}

export const INITIAL_VIEW = {
  lng: 114.3,
  lat: 30.53,
  height: 26000,
  pitch: -42
}

/** 水位参数（吴淞高程，米） */
export const WATER_LEVEL = {
  min: 20,
  max: 29.5,
  default: 24.5,
  warn: 27.3,
  guarantee: 29.73,
  referenceStation: 'WL06'
}

/** 视角书签 */
export const BOOKMARKS = [
  { id: 'vv-all', name: '全域概览', lng: 114.28, lat: 30.5, height: 42000, pitch: -55 },
  { id: 'vv-bridge', name: '武汉长江大桥', lng: 114.283, lat: 30.552, height: 4200, pitch: -35 },
  { id: 'vv-tianxing', name: '天兴洲河段', lng: 114.39, lat: 30.652, height: 9000, pitch: -40 },
  { id: 'vv-hanjiang', name: '汉江汇流口', lng: 114.286, lat: 30.571, height: 5200, pitch: -40 },
  { id: 'vv-yangluo', name: '阳逻河段', lng: 114.55, lat: 30.682, height: 12000, pitch: -42 }
]

/** 底图配置（均无需密钥，或仅需免费申请的天地图 tk） */
export const BASE_MAPS = [
  {
    id: 'amap-img',
    name: '高德影像',
    kind: 'amap',
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    maximumLevel: 18,
    credit: '高德地图'
  },
  {
    id: 'amap-vec',
    name: '高德矢量',
    kind: 'amap',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    maximumLevel: 18,
    credit: '高德地图'
  },
  {
    id: 'tianditu-img',
    name: '天地图影像',
    kind: 'tianditu',
    url: 'https://t{s}.tianditu.gov.cn/img_w/wmts?tk={key}',
    layer: 'img',
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    maximumLevel: 18,
    credit: '天地图'
  }
]

export const TIANDITU_ANNOTATION = {
  url: 'https://t{s}.tianditu.gov.cn/cia_w/wmts?tk={key}',
  layer: 'cia',
  subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
  maximumLevel: 18
}

export const TERRAIN_SERVICE = {
  url: 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer',
  requestVertexNormals: true
}

/** 专题字段：同一批数据的多种表达 */
export const THEMATIC_FIELDS = [
  { id: 'waterLevel', name: '水位', unit: 'm', category: 'waterLevel' },
  { id: 'grade', name: '水质类别', unit: '类', category: 'waterQuality' },
  { id: 'rain', name: '小时雨量', unit: 'mm', category: 'rain' }
]

/** 分级配色（低 → 高） */
export const GRADIENT = ['#2f9bd8', '#31c8a0', '#ffd166', '#ff8f4d', '#ff4d6d']

/** 站点分类样式 */
export const STATION_STYLE = {
  waterLevel: { name: '水位站', color: '#2f9bd8', pixelSize: 11 },
  waterQuality: { name: '水质站', color: '#31c8a0', pixelSize: 10 },
  rain: { name: '雨量站', color: '#ffd166', pixelSize: 9 }
}

/** 图层分组顺序（图层树展示顺序） */
export const LAYER_GROUPS = ['影像底图', '地形', '空间数据', '时空数据', '分析图层']
