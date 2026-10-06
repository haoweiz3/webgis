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
  fogDensity: 0.00012,
  /**
   * 渲染清晰度
   * useBrowserRecommendedResolution=false：按屏幕物理像素渲染。
   *   Cesium 默认忽略 devicePixelRatio（用 CSS 像素渲染），在 125%~200%
   *   缩放的笔记本屏上画面会被放大，底图看着发软。
   * maxRenderPixelRatio：物理像素放大上限，4K/Retina 下兼顾清晰度与帧率。
   * globeMaximumScreenSpaceError：地形与影像的屏幕误差阈值，默认 2；
   *   调小会让同一视距请求更高层级（更清晰）的瓦片与更密的地形网格。
   */
  useBrowserRecommendedResolution: false,
  maxRenderPixelRatio: 2,
  globeMaximumScreenSpaceError: 1.5
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
  },
  {
    // 无需 key，和项目已用的 ArcGIS 地形同一个服务商；WGS-84 口径，不需要纠偏。
    // 城市区影像通常比高德影像更细（高德影像最高 18 级，这里到 19 级）。
    id: 'esri-img',
    name: 'Esri 影像',
    kind: 'esri',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 19,
    credit: 'Esri World Imagery'
  },
  {
    // 无需 key；Esri 世界晕渲图（山体阴影），用来直观表达地形起伏。
    // 三维地形本身没有影像可看，把底图切成晕渲图是最快的看地形方式。
    // 同样是 WGS-84 口径，不能挂高德的 GCJ-02 纠偏方案。
    id: 'esri-hillshade',
    name: '地形晕渲',
    kind: 'esri',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 16,
    credit: 'Esri World Hillshade'
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

/**
 * 本地 DEM 地形（替代在线全球地形）
 * ------------------------------------------------------------------
 * 为什么需要它：ArcGIS 全球地形（Terrain3D）在研究区内是常数 24.8 m
 * （2026-10 实测：汉口、龟山、蛇山、珞珈山、喻家山、后湖全部 24.8 m，
 * 只有研究区外的木兰山才有 286.3 m），因此打开"地形起伏"也看不出任何起伏。
 *
 * 这里改用本地 FABDEM 格网（去建筑、去树冠，保留地形）自建 TerrainProvider：
 * 水体被抹平后保留河床下切，城区能看到蛇山 62 m / 珞珈山 105 m 的隆起。
 *
 * 垂直口径：FABDEM 是 EGM2008 似大地水准面，这里按"相对口径"直接当场景高程用——
 * 基准水位（23.93 m 吴淞 → 场景 15.93 m）与格网里的长江水面（15.0 m）只差约 1 m，
 * 河床、江滩、堤外地面的相对关系是自洽的。绝对基准仍由 DATUM_OFFSET_M 决定，
 * 淹没面积一类量算不使用这份地形。
 */
export const LOCAL_DEM = {
  enabled: true,
  // 用 BASE_URL 拼接，兼容子路径部署（见 vite.config.js 的 DEPLOY_BASE 说明）
  metaUrl: `${import.meta.env.BASE_URL}data/dem-grid.json`,
  binUrl: `${import.meta.env.BASE_URL}data/dem-grid.bin`,
  /** 每个瓦片的采样数（列 = 行），32 对 100 m 源数据足够，16 会明显丢细节 */
  tileSamples: 32,
  /**
   * 地形细分到的最大层级。
   * 100 m 源数据在 14 级已经饱和（瓦片宽约 1.2 km，32 个采样 ≈ 38 m 间距），
   * 不设上限时 Cesium 会一路细分下去，实测能把页面跑到无响应。
   */
  maxLevel: 14,
  /** 本地 DEM 高程 → 场景高程的平移量（相对口径，见上面的说明） */
  verticalShiftM: 0,
  credit: 'FABDEM © University of Bristol（CC BY-NC-SA 4.0）'
}

/**
 * 地形垂直夸张
 * ------------------------------------------------------------------
 * 研究区是平原，真实高差只有几米（江滩）到几十米（蛇山、珞珈山），
 * 正上方俯视时就算地形数据完全正确，画面上也看不出区别。
 * 这里按倍数放大地形网格高度，让"地形起伏"这个图层开关有可见效果。
 *
 * 注意：这是**显示口径**，只影响三维视觉；
 * 水面等实体通过 geoUtils.wusongToScene() 乘同一个倍数，保证不被地形吞掉；
 * 剖面曲线、淹没面积等数值仍然是真实高程，不参与夸张。
 */
export const TERRAIN_EXAGGERATION = {
  /**
   * 固定 3 倍。
   * 曾经在界面上给过 1/2/3/5 四档，实测在常用视距下各档差别不明显，
   * 3 倍已经足够把长江河床与两岸的关系表达清楚，索性固定下来。
   */
  factor: 3
}

/**
 * 地形高程分级设色
 * ------------------------------------------------------------------
 * 影像底图叠加在三维地形上之后，地貌是靠"影像的透视变形"表达的，
 * 正视时几乎看不出高程差别。这里用同一份本地 DEM 现场生成一张分级设色图，
 * 以半透明影像层铺在地形上：低处蓝→青→绿，中间黄→橙，高处红→紫红，
 * 高程差异一眼可见。
 *
 * 分级边界不是拍脑袋来的，按研究走廊（113.9~114.7E / 30.25~30.80N）的
 * 高程分布实测（脚本 scripts/_dem-stats.mjs）：
 *   中位 22.2 m、80% 分位 29.2 m、95% 分位 44.2 m、99.5% 分位 97.3 m、最大 260.5 m。
 * 所以边界主要落在 15~50 m 这个"城市主体"区间里，最上面一档收在 85 m——
 * 再往上只有边角几座山头，再把色带往 260 m 铺只会让 95% 的地面挤在色条最左端。
 * 分级数值是 EGM2008（与地形格网同一口径）。
 */
export const TERRAIN_TINT = {
  /** 设色层的不透明度：压到 0.65，让底图影像还能透出来 */
  alpha: 0.65,
  /** 分级上界（米，null 表示最后一档不封顶）与配色 */
  classes: [
    { max: 15, color: [24, 78, 152], label: '< 15 m' },
    { max: 19, color: [46, 138, 190], label: '15–19 m' },
    { max: 23, color: [74, 182, 164], label: '19–23 m' },
    { max: 28, color: [140, 202, 102], label: '23–28 m' },
    { max: 35, color: [232, 206, 62], label: '28–35 m' },
    { max: 50, color: [240, 148, 50], label: '35–50 m' },
    { max: 85, color: [216, 74, 72], label: '50–85 m' },
    { max: null, color: [156, 52, 148], label: '≥ 85 m' }
  ],
  /** 覆盖范围边缘渐隐的格数（0.001° ≈ 100 m），避免出现硬邦邦的矩形边界 */
  featherCells: 45,
  /**
   * 晕渲（山体阴影）
   * 只靠颜色表达高程，平原城市内部还是一大片同色；叠加晕渲才有立体感。
   * 坡度放大倍数远大于显示夸张，是因为 100 m 格网上真实坡度只有百分之几，
   * 不放大算出来的明暗差不到 3%，肉眼完全看不出来。
   */
  shade: {
    /** 光源方位角（正北为 0°，顺时针；315° = 西北方向来光） */
    azimuthDeg: 315,
    /** 光源高度角 */
    altitudeDeg: 28,
    /** 坡度放大倍数 */
    strength: 12,
    /** 明暗乘子的上下限 */
    min: 0.52,
    max: 1.55
  }
}

/**
 * 淹没范围配色
 * ------------------------------------------------------------------
 * 栅格淹没输出三类结果，颜色必须能在界面上自解释，图例取的就是这份配置：
 *   channel   —— 河道本身（连通性搜索的种子，按定义就是淹的）
 *   connected —— 与河道连通的新增淹没陆地，这才是"真的淹到了"的部分
 *   isolated  —— 地形上低于当前水位、但没有和河道连通的部分：
 *                主要是被堤防挡在堤内的低地，也有少量是城区建筑/树冠残留
 *                造成的伪高值挡住了水路。它就是这个口径下"水进不去"的地方，
 *                也是下界与上界之间的差距所在，所以单独画出来而不是并进淹没面积。
 * 高水位时 isolated 会铺满整个平原（27 m 时约 3900 km²，比连通淹没还大），
 * 因此界面上给了开关，嫌乱可以关掉。
 */
export const FLOOD_PALETTE = {
  channel: { rgb: [40, 112, 190], alpha: 0.8, label: '河道' },
  connected: { rgb: [92, 200, 240], alpha: 0.65, label: '连通淹没' },
  isolated: { rgb: [236, 220, 132], alpha: 0.38, label: '低于水位但未连通' }
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

/**
 * 量算结果样式
 * ------------------------------------------------------------------
 * 量算结果是"分析结论"，必须压在所有图层之上，否则贴在江面上的面会被
 * 水面（另一层实体，半透明蓝）盖成一片灰黄，看不清量的是哪一块。
 *
 * 做法是给结果的每个顶点算一个显示高程：取"该点被拾取到的渲染地形高度"
 * 与"当前水面场景高度"的较大者，再加一个小抬升量。这样结果既贴地、
 * 又不会沉到水面或地形下面，排序上就落在水面之上；抬升量只有几米
 * （场景口径，换算成真实高程约 1 m），肉眼看不出来。
 */
export const MEASURE_STYLE = {
  /** 面积填充不透明度：0.8 让结果压住影像与水面后仍然清楚 */
  areaAlpha: 0.8,
  /** 结果抬升量（场景高程，米）；垂直夸张只作用于显示，这里同样按场景口径给 */
  liftM: 3
}

/** 图层分组顺序（图层树展示顺序） */
export const LAYER_GROUPS = ['影像底图', '地形', '空间数据', '时空数据', '分析图层']
