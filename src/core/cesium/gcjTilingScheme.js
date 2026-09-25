import * as Cesium from 'cesium'
import { gcj02ToWgs84, wgs84ToGcj02 } from './gcj02.js'

/**
 * 高德底图纠偏瓦片方案（GCJ-02 → WGS-84）
 * ------------------------------------------------------------------
 * 问题：高德瓦片建立在 GCJ-02 上，Cesium 按 WGS-84 摆放瓦片网格，
 *       底图与矢量、地形整体错位约 600 m（武汉段实测 568~604 m）。
 *
 * 纠偏只做两件事，方向相反、互为一体：
 *   1. 请求瓦片时（positionToTileXY）：把 WGS-84 位置先换算成高德坐标，
 *      再求它落在高德网格的哪一张瓦片上 —— 索引必须落在高德自己的
 *      网格里，{x}/{y}/{z} 才能取到正确的内容；
 *   2. 贴图显示时（tileXYToNativeRectangle / tileXYToRectangle）：
 *      瓦片图像覆盖的是 GCJ-02 范围 R，把它逆变换回 WGS-84（gcj02ToWgs84(R)）
 *      作为显示范围，影像就落到真实地理位置上。
 *
 * 因此底图、地形、矢量、量算与剖面结果全部统一在 WGS-84 下，
 * 业务数据与空间分析口径完全不受影响。
 *
 * 为什么不用「统一加固定偏移量」：GCJ-02 是位置相关的非线性加密，
 * 偏移量沿河段在 568~604 m、方位 115°~120° 之间变化，
 * 固定偏移只能让中间对上、两端露馅。
 *
 * 显示范围用 3×3 采样取包络：包络会让相邻瓦片轻微重叠而不是留缝，
 * 重叠部分内容基本一致，不影响视觉；低层级大瓦片内的非线性
 * 折合下来仍远小于一个像素，可以忽略。
 */

const SAMPLE_COUNT = 3 // 每条边采样点数（含两个端点）
const CACHE_LIMIT = 4096 // 瓦片显示范围缓存上限，防止长时间浏览持续增长

const gcjMetersScratch = new Cesium.Rectangle()
const mercatorScratch = new Cesium.Cartesian2()
const unprojectedScratch = new Cesium.Cartographic()
const gcjPositionScratch = new Cesium.Cartographic()

class Gcj02WebMercatorTilingScheme extends Cesium.WebMercatorTilingScheme {
  constructor(options) {
    super(options)
    /** 瓦片显示范围缓存：'level/x/y' → WGS-84 地理矩形（弧度） */
    this._wgsRectangleCache = new Map()
  }

  /**
   * 高德瓦片（GCJ-02 范围）对应的 WGS-84 显示范围，带缓存
   * @returns {Cesium.Rectangle} 弧度
   */
  _wgsRectangle(x, y, level) {
    const key = level + '/' + x + '/' + y
    const cached = this._wgsRectangleCache.get(key)
    if (cached) return cached

    // 父类给出的是高德网格下的瓦片范围（Web Mercator 米，即 GCJ-02 空间）
    const gcjMeters = Cesium.WebMercatorTilingScheme.prototype.tileXYToNativeRectangle.call(
      this,
      x,
      y,
      level,
      gcjMetersScratch
    )
    const projection = this.projection

    let west = Number.POSITIVE_INFINITY
    let south = Number.POSITIVE_INFINITY
    let east = Number.NEGATIVE_INFINITY
    let north = Number.NEGATIVE_INFINITY

    for (let i = 0; i < SAMPLE_COUNT; i++) {
      mercatorScratch.x = gcjMeters.west + (gcjMeters.width * i) / (SAMPLE_COUNT - 1)
      for (let j = 0; j < SAMPLE_COUNT; j++) {
        mercatorScratch.y = gcjMeters.south + (gcjMeters.height * j) / (SAMPLE_COUNT - 1)

        const gcjCarto = projection.unproject(mercatorScratch, unprojectedScratch)
        const [lng, lat] = gcj02ToWgs84(
          Cesium.Math.toDegrees(gcjCarto.longitude),
          Cesium.Math.toDegrees(gcjCarto.latitude)
        )

        if (lng < west) west = lng
        if (lng > east) east = lng
        if (lat < south) south = lat
        if (lat > north) north = lat
      }
    }

    const rectangle = new Cesium.Rectangle(
      Cesium.Math.toRadians(west),
      Cesium.Math.toRadians(south),
      Cesium.Math.toRadians(east),
      Cesium.Math.toRadians(north)
    )

    if (this._wgsRectangleCache.size >= CACHE_LIMIT) this._wgsRectangleCache.clear()
    this._wgsRectangleCache.set(key, rectangle)
    return rectangle
  }

  /**
   * 瓦片在 WGS-84 空间下的原生范围（Web Mercator 米）
   * Cesium 默认走 Web Mercator 纹理路径，贴图范围由这个方法决定。
   */
  tileXYToNativeRectangle(x, y, level, result) {
    return this.rectangleToNativeRectangle(this._wgsRectangle(x, y, level), result)
  }

  /**
   * 位置 → 瓦片索引
   * Cesium 用这个索引替换 {x}/{y}/{z}，所以必须先换算到高德坐标再取索引。
   */
  positionToTileXY(position, level, result) {
    const [lng, lat] = wgs84ToGcj02(
      Cesium.Math.toDegrees(position.longitude),
      Cesium.Math.toDegrees(position.latitude)
    )
    gcjPositionScratch.longitude = Cesium.Math.toRadians(lng)
    gcjPositionScratch.latitude = Cesium.Math.toRadians(lat)
    gcjPositionScratch.height = position.height
    return super.positionToTileXY(gcjPositionScratch, level, result)
  }
}

let sharedScheme = null

/**
 * 共享的纠偏瓦片方案实例（影像层与注记层复用同一份缓存）
 * @returns {Cesium.WebMercatorTilingScheme}
 */
export function gcj02TilingScheme() {
  if (!sharedScheme) sharedScheme = new Gcj02WebMercatorTilingScheme()
  return sharedScheme
}

export default Gcj02WebMercatorTilingScheme
