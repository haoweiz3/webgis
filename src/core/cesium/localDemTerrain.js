import * as Cesium from 'cesium'
import { TERRAIN_TINT } from '@/config/scene.js'

/**
 * 本地 DEM 地形提供者
 * ------------------------------------------------------------------
 * 在线全球地形服务在城市尺度上太粗（ArcGIS Terrain3D 在武汉城区是常数 24.8 m），
 * 打开"地形起伏"也看不出地形。这里改用项目自带的 DEM 格网（FABDEM，
 * 去建筑/去树冠，保留真实地形）在浏览器里现搭一个 TerrainProvider：
 * 不依赖任何在线地形服务，数据随项目分发，离线也能看到三维起伏。
 *
 * 数据格式（见 public/data/dem-grid.json）：
 *   原始值 = Uint16 小端，elev(m) = raw / scale + baseMeters，
 *   行序为"南 → 北、西 → 东"。
 * Cesium 的高度场（HeightmapTerrainData）要求"北 → 南、西 → 东"，
 * 两者行序相反，下面的 sampleGrid() 做了换算。
 */

/**
 * @param {Object} options
 * @param {String} options.metaUrl 格网元数据地址
 * @param {String} options.binUrl  格网二进制地址
 * @param {Number} [options.tileSamples] 每个瓦片的采样数
 * @param {Number} [options.maxLevel] 地形细分到的最大层级，超过则复用父瓦片
 * @param {Number} [options.verticalShiftM] 高程基准平移量（米）
 * @param {String} [options.credit] 数据署名
 * @returns {Promise<{provider: Cesium.CustomHeightmapTerrainProvider, meta: Object, sampleHeight: Function}>}
 */
export async function createLocalDemTerrainProvider(options = {}) {
  const {
    metaUrl,
    binUrl,
    tileSamples = 32,
    maxLevel = 14,
    verticalShiftM = 0,
    credit
  } = options

  const [metaRes, binRes] = await Promise.all([fetch(metaUrl), fetch(binUrl)])
  if (!metaRes.ok) throw new Error(`本地 DEM 元数据不可用（HTTP ${metaRes.status}）`)
  if (!binRes.ok) throw new Error(`本地 DEM 格网不可用（HTTP ${binRes.status}）`)

  const meta = await metaRes.json()
  const buffer = await binRes.arrayBuffer()
  const { cols, rows, west, south, cellDeg } = meta.grid
  const { scale } = meta.storage
  const { baseMeters } = meta.storageEncoding

  const expected = cols * rows * 2
  if (buffer.byteLength < expected) {
    throw new Error(`本地 DEM 格网长度不足：期望 ${expected} 字节，实际 ${buffer.byteLength}`)
  }

  // 解码成高程数组：行序保持"南 → 北"，与文件一致
  const view = new DataView(buffer)
  const heights = new Float32Array(cols * rows)
  for (let i = 0; i < cols * rows; i += 1) {
    heights[i] = view.getUint16(i * 2, true) / scale + baseMeters + verticalShiftM
  }

  const east = west + cols * cellDeg
  const north = south + rows * cellDeg

  /** 单点采样（双线性插值；越界按边缘值延拓，避免出现断崖） */
  function sampleHeight(lng, lat) {
    const fx = Math.min(Math.max((lng - west) / cellDeg, 0), cols - 1)
    const fy = Math.min(Math.max((lat - south) / cellDeg, 0), rows - 1)
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const x1 = Math.min(x0 + 1, cols - 1)
    const y1 = Math.min(y0 + 1, rows - 1)
    const tx = fx - x0
    const ty = fy - y0
    const h00 = heights[y0 * cols + x0]
    const h10 = heights[y0 * cols + x1]
    const h01 = heights[y1 * cols + x0]
    const h11 = heights[y1 * cols + x1]
    return (
      h00 * (1 - tx) * (1 - ty) +
      h10 * tx * (1 - ty) +
      h01 * (1 - tx) * ty +
      h11 * tx * ty
    )
  }

  const tilingScheme = new Cesium.GeographicTilingScheme()

  /**
   * 瓦片缓存
   * 回调返回的是同步数组，Cesium 会认为瓦片"随时可用"，因此必须自己控量：
   *   1) 用 maxLevel 封顶——超过该层级直接返回 undefined，Cesium 会复用父瓦片；
   *      100 m 源数据在 14 级（瓦片宽约 1.2 km、32 个采样 ≈ 38 m 间距）已经饱和，
   *      再细分只是白白生成几倍于收益的网格（实测不封顶会把页面跑到无响应）。
   *   2) 同 (x, y, level) 的瓦片只算一次，避免来回缩放反复重算。
   */
  const tileCache = new Map()
  const TILE_CACHE_LIMIT = 2048

  function requestTile(x, y, level) {
    if (level > maxLevel) return undefined
    const key = `${level}/${x}/${y}`
    const cached = tileCache.get(key)
    if (cached) return cached

    const rectangle = tilingScheme.tileXYToRectangle(x, y, level)
    const westDeg = Cesium.Math.toDegrees(rectangle.west)
    const eastDeg = Cesium.Math.toDegrees(rectangle.east)
    const southDeg = Cesium.Math.toDegrees(rectangle.south)
    const northDeg = Cesium.Math.toDegrees(rectangle.north)

    const out = new Float32Array(tileSamples * tileSamples)
    for (let row = 0; row < tileSamples; row += 1) {
      // 第 0 行在最北，与 Cesium 的高度场行序一致
      const t = tileSamples === 1 ? 0 : row / (tileSamples - 1)
      const lat = Cesium.Math.lerp(northDeg, southDeg, t)
      for (let col = 0; col < tileSamples; col += 1) {
        const s = tileSamples === 1 ? 0 : col / (tileSamples - 1)
        const lng = Cesium.Math.lerp(westDeg, eastDeg, s)
        out[row * tileSamples + col] = sampleHeight(lng, lat)
      }
    }
    if (tileCache.size >= TILE_CACHE_LIMIT) tileCache.clear()
    tileCache.set(key, out)
    return out
  }

  const provider = new Cesium.CustomHeightmapTerrainProvider({
    width: tileSamples,
    height: tileSamples,
    tilingScheme,
    credit,
    callback: requestTile
  })

  return {
    provider,
    meta,
    sampleHeight,
    maxLevel,
    /** 原始高程格网（EGM2008 + verticalShiftM），供栅格淹没等模块复用 */
    heights,
    tintDataUrl: buildTintImage(heights, cols, rows, TERRAIN_TINT, meta.grid),
    coverage: { west, south, east, north }
  }
}

/** 按分级取一个高程对应的 RGB（分级设色：同一档内同色，不透明度统一在配置里给） */
function sampleTint(classes, elevation) {
  for (let i = 0; i < classes.length; i += 1) {
    const item = classes[i]
    if (item.max === null || elevation < item.max) {
      return item.color
    }
  }
  return classes[classes.length - 1].color
}

/**
 * 生成分层设色图
 * 画布第 0 行在最北，而格网第 0 行在最南，这里要翻转行序，
 * 否则色带会上下颠倒（山地出现在河口位置）。
 */
function buildTintImage(heights, cols, rows, tint, grid) {
  const { classes, alpha, featherCells, shade } = tint
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const context = canvas.getContext('2d')
  const image = context.createImageData(cols, rows)
  const data = image.data

  // 光源方向（指向光源的单位向量，x 向东、y 向北、z 向上）
  const az = (shade.azimuthDeg * Math.PI) / 180
  const alt = (shade.altitudeDeg * Math.PI) / 180
  const lightX = Math.sin(az) * Math.cos(alt)
  const lightY = Math.cos(az) * Math.cos(alt)
  const lightZ = Math.sin(alt)
  // 格距换算成米（元数据里已经算好，取不到就按 100 m 估）
  const cellX = grid.cellMetersLng || 96
  const cellY = grid.cellMetersLat || 111

  for (let row = 0; row < rows; row += 1) {
    const sourceRow = rows - 1 - row
    for (let col = 0; col < cols; col += 1) {
      const center = sourceRow * cols + col
      const elevation = heights[center]
      const [r, g, b] = sampleTint(classes, elevation)

      // 晕渲：由邻格高差求坡向，与光源方向做点积
      const westIdx = sourceRow * cols + Math.max(col - 1, 0)
      const eastIdx = sourceRow * cols + Math.min(col + 1, cols - 1)
      const southIdx = Math.max(sourceRow - 1, 0) * cols + col
      const northIdx = Math.min(sourceRow + 1, rows - 1) * cols + col
      const dzdx = (heights[eastIdx] - heights[westIdx]) / (2 * cellX)
      const dzdy = (heights[northIdx] - heights[southIdx]) / (2 * cellY)
      const nx = -dzdx * shade.strength
      const ny = -dzdy * shade.strength
      const normalLength = Math.sqrt(nx * nx + ny * ny + 1)
      const dot = (nx * lightX + ny * lightY + lightZ) / normalLength
      const factor = Math.min(
        shade.max,
        Math.max(shade.min, dot / lightZ)
      )

      // 四边羽化，渐变到透明
      const edgeDistance = Math.min(col, cols - 1 - col, row, rows - 1 - row)
      const fade = Math.min(1, edgeDistance / featherCells)
      const index = (row * cols + col) * 4
      data[index] = Math.min(255, Math.round(r * factor))
      data[index + 1] = Math.min(255, Math.round(g * factor))
      data[index + 2] = Math.min(255, Math.round(b * factor))
      data[index + 3] = Math.round(alpha * fade * 255)
    }
  }

  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}
