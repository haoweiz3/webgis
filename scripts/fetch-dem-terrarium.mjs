/**
 * 高程格网取数脚本（AWS 开放地形瓦片 / Mapzen terrarium）
 * ------------------------------------------------------------------
 * 用途：为「栅格法淹没分析」准备研究区的高程格网。
 *
 * 为什么不用现有的 ArcGIS 全球地形：它在武汉段完全没有起伏
 * （实测跨龟山 2 km、20 m 间距的 101 个点全部 24.8 m），
 * 拿它做栅格淹没只会得到均匀淹没，和现在的示意单元没区别。
 * terrarium 瓦片是 SRTM 30 m 派生，实测武汉城区有 53 m 高差
 * （河面 17 m ~ 喻家山 65 m），足以驱动淹没范围的差异。
 *
 * 数据来源与许可：Mapzen / AWS Open Data 地形瓦片（terrarium），
 *   高程编码：elevation = R * 256 + G + B / 256 - 32768（米，EGM96 口径）。
 *   署名：Terrain Tiles (Mapzen, AWS Open Data)，数据源 SRTM 等。
 *
 * 输出：
 *   scripts/data-src/dem-tiles/          原始瓦片缓存（不入库）
 *   scripts/data-src/dem-grid.bin        高程格网（Uint16，单位 0.1 m）
 *   scripts/data-src/dem-grid.json       格网元数据（范围、步长、口径）
 *
 * 运行：pnpm fetch:dem [--zoom=12] [--refresh]
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { STUDY_AREA } from '../src/config/scene.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, 'data-src')
const tileDir = join(outDir, 'dem-tiles')
const gridFile = join(outDir, 'dem-grid.bin')
const metaFile = join(outDir, 'dem-grid.json')

/** 瓦片层级：z12 约 28 m/像素，与 SRTM 30 m 的原始分辨率匹配 */
const zoomArg = process.argv.find((arg) => arg.startsWith('--zoom='))
const ZOOM = zoomArg ? Number(zoomArg.split('=')[1]) : 12
const forceRefresh = process.argv.includes('--refresh')

/** 格网范围：研究区外扩一点，避免淹没范围被边界裁断 */
const MARGIN_DEG = 0.02
const GRID = {
  west: Number((STUDY_AREA.west - MARGIN_DEG).toFixed(4)),
  south: Number((STUDY_AREA.south - MARGIN_DEG).toFixed(4)),
  east: Number((STUDY_AREA.east + MARGIN_DEG).toFixed(4)),
  north: Number((STUDY_AREA.north + MARGIN_DEG).toFixed(4))
}
/** 格网步长（度）：约 96 m（经向）× 111 m（纬向） */
const CELL_DEG = 0.001
const COLS = Math.round((GRID.east - GRID.west) / CELL_DEG)
const ROWS = Math.round((GRID.north - GRID.south) / CELL_DEG)
/**
 * 存储：Uint16 存 round(elev * 10) + 32768，等价于基准 -3276.8 m、单位 0.1 m，
 * 这样负高程（洼地/水面噪声）也能如实保存；0 用作「无数据」哨兵值。
 */
const SCALE = 10
const STORE_BASE = 32768
const NO_DATA = 0
/** terrarium 里没有数据时编码为 -32768 m，取一个阈值区分 */
const NO_DATA_METERS = -1000

const lngToTileX = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z)
const latToTileY = (lat, z) => {
  const rad = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
  )
}
/** 经纬度 → 全球像素坐标（256 像素/瓦片，左上角原点） */
const globalPixel = (lng, lat, z) => {
  const n = 2 ** z * 256
  const rad = (lat * Math.PI) / 180
  return [
    ((lng + 180) / 360) * n,
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  ]
}

/* ------------------------------------------------------------------ */
/* PNG 解码（只处理 8 位 RGB/RGBA，terrarium 瓦片就是这个格式）            */
/* ------------------------------------------------------------------ */

function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) throw new Error('不是合法的 PNG')
  }
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (bitDepth !== 8) throw new Error(`暂不支持 ${bitDepth} 位 PNG`)
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0
  if (!channels) throw new Error(`暂不支持颜色类型 ${colorType} 的 PNG`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)
  let rawOffset = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOffset++]
    const line = raw.subarray(rawOffset, rawOffset + stride)
    rawOffset += stride
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0
      const up = prev ? prev[x] : 0
      const upLeft = prev && x >= channels ? prev[x - channels] : 0
      let value = line[x]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) {
        // Paeth
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      out[x] = value & 0xff
    }
  }
  return { width, height, channels, pixels }
}

/** terrarium 解码：elevation = R * 256 + G + B / 256 - 32768 */
function decodeElevation(png) {
  const { width, height, channels, pixels } = png
  const out = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * channels]
    const g = pixels[i * channels + 1]
    const b = pixels[i * channels + 2]
    out[i] = r * 256 + g + b / 256 - 32768
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 下载与格网重采样                                                     */
/* ------------------------------------------------------------------ */

const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`

async function loadTile(z, x, y, attempts = 4) {
  const file = join(tileDir, `${z}_${x}_${y}.png`)
  if (!forceRefresh && existsSync(file)) return readFileSync(file)
  let lastError = null
  // 公共瓦片服务偶发断连，重试几次；已下载的瓦片会直接复用
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(TILE_URL(z, x, y), {
        headers: { 'User-Agent': 'webgis-yangtze-demo/0.1 (terrain tiles for a local demo)' }
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      writeFileSync(file, buffer)
      return buffer
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, attempt * 500))
    }
  }
  throw new Error(`瓦片 ${z}/${x}/${y} 下载失败：${lastError?.message ?? '未知错误'}`)
}

async function mapWithConcurrency(items, limit, worker) {
  const queue = items.slice()
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      await worker(item)
    }
  })
  await Promise.all(runners)
}

console.log(`取高程格网：zoom=${ZOOM}，范围 ${GRID.west}~${GRID.east}, ${GRID.south}~${GRID.north}`)
console.log(`格网 ${COLS} × ${ROWS} = ${(COLS * ROWS).toLocaleString('en-US')} 格，步长 ${CELL_DEG}°`)

const minX = lngToTileX(GRID.west, ZOOM)
const maxX = lngToTileX(GRID.east, ZOOM)
const minY = latToTileY(GRID.north, ZOOM)
const maxY = latToTileY(GRID.south, ZOOM)
const tileList = []
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) tileList.push([x, y])
  }
console.log(`需要瓦片 ${tileList.length} 张（${minX}~${maxX} × ${minY}~${maxY}），已缓存的直接复用`)

if (!existsSync(tileDir)) mkdirSync(tileDir, { recursive: true })
const mosaic = new Map()
let downloaded = 0
await mapWithConcurrency(tileList, 6, async ([x, y]) => {
  const cached = !forceRefresh && existsSync(join(tileDir, `${ZOOM}_${x}_${y}.png`))
  const buffer = await loadTile(ZOOM, x, y)
  if (!cached) downloaded++
  mosaic.set(`${x}_${y}`, decodeElevation(decodePng(buffer)))
})
console.log(`瓦片就绪（本次下载 ${downloaded} 张）`)

/** 双线性采样：格网单元中心 → 瓦片像素 */
const TILE_PX = 256
function sampleElevation(lng, lat) {
  const [px, py] = globalPixel(lng, lat, ZOOM)
  const gx = px - minX * TILE_PX
  const gy = py - minY * TILE_PX
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const fx = gx - x0
  const fy = gy - y0
  const at = (x, y) => {
    const tile = mosaic.get(`${minX + Math.floor(x / TILE_PX)}_${minY + Math.floor(y / TILE_PX)}`)
    if (!tile) return NaN
    const ix = ((x % TILE_PX) + TILE_PX) % TILE_PX
    const iy = ((y % TILE_PX) + TILE_PX) % TILE_PX
    return tile[iy * TILE_PX + ix]
  }
  let v00 = at(x0, y0)
  let v10 = at(x0 + 1, y0)
  let v01 = at(x0, y0 + 1)
  let v11 = at(x0 + 1, y0 + 1)
  // 无数据的瓦片像素（terrarium 编码为 -32768）不参与插值，退化为有效邻值均值
  const valid = [v00, v10, v01, v11].filter((v) => Number.isFinite(v) && v > NO_DATA_METERS)
  if (!valid.length) return NaN
  const fill = (v) => (Number.isFinite(v) && v > NO_DATA_METERS ? v : valid.reduce((s, x) => s + x, 0) / valid.length)
  v00 = fill(v00)
  v10 = fill(v10)
  v01 = fill(v01)
  v11 = fill(v11)
  return (
    v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy
  )
}

console.log('重采样到规则格网 …')
const grid = new Uint16Array(COLS * ROWS)
let minElevation = Number.POSITIVE_INFINITY
let maxElevation = Number.NEGATIVE_INFINITY
let missing = 0
for (let row = 0; row < ROWS; row++) {
  const lat = GRID.south + (row + 0.5) * CELL_DEG
  for (let col = 0; col < COLS; col++) {
    const lng = GRID.west + (col + 0.5) * CELL_DEG
    const elevation = sampleElevation(lng, lat)
    if (!Number.isFinite(elevation)) {
      missing++
      grid[row * COLS + col] = NO_DATA
      continue
    }
    const stored = Math.max(1, Math.min(65535, Math.round(elevation * SCALE) + STORE_BASE))
    grid[row * COLS + col] = stored
    minElevation = Math.min(minElevation, (stored - STORE_BASE) / SCALE)
    maxElevation = Math.max(maxElevation, (stored - STORE_BASE) / SCALE)
  }
}

/**
 * 无数据格用邻域均值迭代填补（通常只有零星几格，例如瓦片边缘或水体）
 * 不填的话它们会被当成"高程 0 的深洼"，在淹没分析里变成假淹没区
 */
function fillNoData(grid) {
  let filled = 0
  for (let pass = 0; pass < 20; pass++) {
    let changed = 0
    const next = grid.slice()
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const index = row * COLS + col
        if (grid[index] !== NO_DATA) continue
        let sum = 0
        let count = 0
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const r = row + dr
          const c = col + dc
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue
          const value = next[r * COLS + c]
          if (value === NO_DATA) continue
          sum += value
          count++
        }
        if (count) {
          next[index] = Math.round(sum / count)
          changed++
        }
      }
    }
    grid.set(next)
    filled += changed
    if (!changed) break
  }
  return filled
}

const filledCells = fillNoData(grid)
const remainingNoData = grid.reduce((sum, value) => sum + (value === NO_DATA ? 1 : 0), 0)
console.log(`无数据格：原始 ${missing}，邻域填补 ${filledCells}，剩余 ${remainingNoData}`)

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
writeFileSync(gridFile, Buffer.from(grid.buffer))
writeFileSync(
  metaFile,
  JSON.stringify(
    {
      source: 'Terrain Tiles（Mapzen / AWS Open Data），SRTM 等 30 m 派生',
      license: 'Terrain Tiles © Mapzen，数据源 SRTM 等（开放数据）',
      generatedAt: new Date().toISOString(),
      zoom: ZOOM,
      verticalDatum: 'EGM96 正高（米），需与吴淞基准做标定',
      grid: {
        west: GRID.west,
        south: GRID.south,
        cellDeg: CELL_DEG,
        cols: COLS,
        rows: ROWS,
        cellMetersLng: Math.round(CELL_DEG * 111320 * Math.cos(((GRID.south + GRID.north) / 2) * Math.PI / 180)),
        cellMetersLat: Math.round(CELL_DEG * 111320)
      },
      storage: { file: 'dem-grid.bin', type: 'Uint16 little-endian', scale: SCALE, unit: '0.1 m', rowOrder: '南→北，西→东' },
      storageEncoding: { baseMeters: -STORE_BASE / SCALE, noDataValue: NO_DATA, note: 'value = round(elev*10) + 32768' },
      elevationRangeMeters: [Number(minElevation.toFixed(1)), Number(maxElevation.toFixed(1))],
      missingCells: missing,
      filledCells
    },
    null,
    2
  ),
  'utf8'
)

console.log(
  `完成：高程 ${minElevation.toFixed(1)} ~ ${maxElevation.toFixed(1)} m，缺失 ${missing} 格\n` +
    `写出 ${gridFile}（${(grid.byteLength / 1048576).toFixed(2)} MB）与 ${metaFile}`
)
