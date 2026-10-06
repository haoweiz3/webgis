/**
 * 栅格法淹没分析（第一步：数据侧验证，不改 UI）
 * ------------------------------------------------------------------
 * 目的：回答"淹没范围是否受地形控制、和现在的示意单元差多少"。
 *
 * 做的四件事：
 *   1. 解析并体检高程格网（含 SRTM 在水体上的异常值处理）；
 *   2. 高程基准标定：用「汉口站序列最低水位」锚定 DEM 里对应的水面，
 *      把 EGM96 口径的高程换算到吴淞口径（这一步不做，淹没面积会整体偏大或偏小）；
 *   3. 逐水位做栅格淹没：z < h 判定 + 从河道种子做连通性分析；
 *   4. 与现有「示意单元法」的结果对照，并输出一张山体阴影 + 淹没范围预览图。
 *
 * 输出：
 *   scripts/data-src/flood-raster-report.json     逐水位统计与对比
 *   scripts/data-src/flood-raster-preview.png     预览图（山影 + 水面 + 淹没范围）
 *
 * 运行：pnpm analyze:flood
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataSrc = join(__dirname, 'data-src')
const publicData = join(__dirname, '..', 'public', 'data')

/** 高程格网后缀：--grid=srtm 用 dem-grid-srtm.*，默认用 dem-grid.*（当前为 FABDEM） */
const GRID_SUFFIX = process.argv.find((arg) => arg.startsWith('--grid='))?.split('=')[1] ?? ''
const GRID_BASE = GRID_SUFFIX ? `dem-grid-${GRID_SUFFIX}` : 'dem-grid'
const OUTPUT_SUFFIX = GRID_SUFFIX ? `-${GRID_SUFFIX}` : ''
/** 可选：手动指定高程基准偏移（米），用于敏感性分析 */
const OFFSET_OVERRIDE = Number(
  process.argv.find((arg) => arg.startsWith('--offset='))?.split('=')[1] ?? NaN
)
/**
 * 口径框架：
 *   relative（默认）——水位用「相对基准水面的抬升量」表达，地面直接用 DEM 原始高程。
 *     这样做的前提是 DEM 与吴淞在同一零点上；实测三套 DEM 都把江面读成 15~17 m，
 *     与汉口枯水位量级一致，因此差值只按 0 处理，并把「待标定 ±1~2 m」写进口径说明。
 *   absolute ——沿用旧的"自动标定偏移"，仅用于敏感性对比。
 */
const FRAME = process.argv.find((arg) => arg.startsWith('--frame='))?.split('=')[1] ?? 'absolute'
const BASELINE_FROM_SERIES = true
/**
 * 文献口径的基准偏移（米）：吴淞高程 = 1985 国家高程基准读数 + 1.83~1.87。
 * 出处：docs/吴淞高程系.docx（吴淞高程系词条）——宁波 1.87、嘉兴 1.828；
 *   DEM 侧垂直基准是 EGM2008（Copernicus 官方页 / OpenTopography / FABDEM 论文），
 *   EGM2008 与 1985 国家高程基准在华东的差值只有分米级，故整体取 +1.87 ± 0.5 m。
 * 该词条同时明确警告「不能用一个简单的常差或用简单的公式来换算」，
 *   所以这里只作为**带不确定度的默认值**，任何结论都要配 --offset 做敏感性。
 */
const DOCUMENTED_OFFSET = 1.87
const DOCUMENTED_UNCERTAINTY = 0.5

const EARTH_RADIUS = 6371008.8
const D2R = Math.PI / 180
/** 预览与统计用的水位（吴淞，米） */
const PREVIEW_LEVEL = 27.3 // 警戒水位
/**
 * 统计水位：默认 20~29.5 m 每 0.5 m 一档；
 * 用 --levels=26.5,26.6,26.7 可以指定任意档位，用来查"某一档为什么突然多淹一片"。
 */
const LEVELS_ARG = process.argv.find((arg) => arg.startsWith('--levels='))?.slice('--levels='.length)
const LEVELS = LEVELS_ARG
  ? LEVELS_ARG.split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
  : []
if (!LEVELS.length) {
  for (let level = 20; level <= 29.5 + 1e-9; level += 0.5) LEVELS.push(Number(level.toFixed(1)))
  if (!LEVELS.includes(24.0)) LEVELS.push(24.0)
  LEVELS.sort((a, b) => a - b)
}

/* ------------------------------------------------------------------ */
/* 1. 读高程格网                                                       */
/* ------------------------------------------------------------------ */

const gridMeta = JSON.parse(readFileSync(join(dataSrc, `${GRID_BASE}.json`), 'utf8'))
const rawGrid = new Uint16Array(readFileSync(join(dataSrc, `${GRID_BASE}.bin`)).buffer)
const { cols, rows, west, south, cellDeg } = gridMeta.grid
const storeBase = gridMeta.storageEncoding.baseMeters
const scale = gridMeta.storage.scale

/** 格网高程（DEM 原始口径，米） */
const elevation = new Float32Array(cols * rows)
for (let i = 0; i < elevation.length; i++) elevation[i] = rawGrid[i] / scale + storeBase

const cellMeta = (row, col) => ({
  lng: west + (col + 0.5) * cellDeg,
  lat: south + (row + 0.5) * cellDeg
})
/** 单元真实面积（球面公式，随纬度变化） */
function cellAreaM2(row) {
  const lat1 = south + row * cellDeg
  const lat2 = lat1 + cellDeg
  const dLng = cellDeg * D2R
  return EARTH_RADIUS * EARTH_RADIUS * dLng * (Math.sin(lat2 * D2R) - Math.sin(lat1 * D2R))
}
const rowArea = new Float64Array(rows)
for (let row = 0; row < rows; row++) rowArea[row] = cellAreaM2(row)

console.log(`高程格网：${cols} × ${rows}，${gridMeta.source}`)
console.log(`高程范围（DEM 原始口径）：${gridMeta.elevationRangeMeters[0]} ~ ${gridMeta.elevationRangeMeters[1]} m`)

/* ------------------------------------------------------------------ */
/* 2. 水域掩膜：把河道/江心洲栅格化                                      */
/* ------------------------------------------------------------------ */

const waterSource = JSON.parse(readFileSync(join(dataSrc, 'yangtze-water.json'), 'utf8'))
const waterPolygons = waterSource.rivers
  .filter((river) => ['长江', '汉江'].some((name) => river.name.includes(name)))
  .flatMap((river) => river.polygons.map((polygon) => ({ river: river.name, outer: polygon.outer, holes: polygon.holes })))

/**
 * 扫描线栅格化多边形（含内环/江心洲，用奇偶规则统一处理）
 * 逐行求与所有边的交点，排序后成对填充。
 */
function rasterizeWater(polygons) {
  const mask = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row++) {
    const lat = south + (row + 0.5) * cellDeg
    const crossings = []
    for (const polygon of polygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        for (let i = 1; i < ring.length; i++) {
          const [x1, y1] = ring[i - 1]
          const [x2, y2] = ring[i]
          if (y1 > lat === y2 > lat) continue
          crossings.push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1))
        }
      }
    }
    if (!crossings.length) continue
    crossings.sort((a, b) => a - b)
    for (let i = 1; i < crossings.length; i += 2) {
      const from = Math.max(0, Math.ceil((crossings[i - 1] - west) / cellDeg - 0.5))
      const to = Math.min(cols - 1, Math.floor((crossings[i] - west) / cellDeg - 0.5))
      for (let col = from; col <= to; col++) mask[row * cols + col] = 1
    }
  }
  return mask
}

const waterMask = rasterizeWater(waterPolygons)
let waterCells = 0
for (let i = 0; i < waterMask.length; i++) if (waterMask[i]) waterCells++
console.log(`水域掩膜：${waterCells.toLocaleString('en-US')} 格（占 ${((waterCells / waterMask.length) * 100).toFixed(1)}%）`)

/* ------------------------------------------------------------------ */
/* 2b. 堤线屏障：OSM 堤防折线栅格化为不可穿越格                            */
/* ------------------------------------------------------------------ */

/**
 * 堤防口径：OSM 只有堤线位置、没有堤顶高程（研究区内 0/146 带 height），
 * 因此把堤线当作"不可穿越"的屏障来算**下界**；
 * 上界是不考虑堤防的连通淹没。真实值落在两者之间。
 * 栅格化时把线加粗一档（含四邻域），避免 Bresenham 对角步进在 4 邻域连通里渗漏。
 */
const barrier = new Uint8Array(cols * rows)
const leveeFile = join(dataSrc, 'levees-osm.json')
let leveeWays = 0
if (existsSync(leveeFile)) {
  const levees = JSON.parse(readFileSync(leveeFile, 'utf8'))
  const toCell = ([lng, lat]) => {
    const col = Math.round((lng - west) / cellDeg - 0.5)
    const row = Math.round((lat - south) / cellDeg - 0.5)
    return [col, row]
  }
  const mark = (col, row) => {
    for (const [dr, dc] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const r = row + dr
      const c = col + dc
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue
      barrier[r * cols + c] = 1
    }
  }
  for (const element of levees.elements ?? []) {
    const geometry = element.geometry ?? []
    if (geometry.length < 2) continue
    leveeWays++
    for (let i = 1; i < geometry.length; i++) {
      let [x0, y0] = toCell([geometry[i - 1].lon, geometry[i - 1].lat])
      const [x1, y1] = toCell([geometry[i].lon, geometry[i].lat])
      const dx = Math.abs(x1 - x0)
      const dy = Math.abs(y1 - y0)
      const sx = x0 < x1 ? 1 : -1
      const sy = y0 < y1 ? 1 : -1
      let err = dx - dy
      for (let guard = 0; guard < 20000; guard++) {
        mark(x0, y0)
        if (x0 === x1 && y0 === y1) break
        const e2 = 2 * err
        if (e2 > -dy) {
          err -= dy
          x0 += sx
        }
        if (e2 < dx) {
          err += dx
          y0 += sy
        }
      }
    }
  }
  let barrierCells = 0
  for (let i = 0; i < barrier.length; i++) if (barrier[i]) barrierCells++
  console.log(
    `堤线屏障：${leveeWays} 条堤防折线 → ${barrierCells.toLocaleString('en-US')} 格（占 ${((barrierCells / barrier.length) * 100).toFixed(2)}%）；` +
      `仅用于下界口径（无堤顶高程，不模拟漫堤）`
  )
} else {
  console.log('未找到 levees-osm.json，本次只给"不考虑堤防"的上界（可运行 pnpm fetch:levees 补齐）')
}

/** DEM 反演的堤顶脊线（FABDEM 保留堤防），并入屏障给 OSM 的缺口打补丁 */
const ridgeFile = join(dataSrc, 'levees-dem.bin')
const ridgeRawFile = join(dataSrc, 'levees-dem-raw.bin')
let ridgeRawMask = null
let ridgeMask = null
if (existsSync(ridgeFile)) {
  const ridge = new Uint8Array(readFileSync(ridgeFile).buffer)
  ridgeMask = ridge
  let added = 0
  for (let i = 0; i < ridge.length; i++) {
    if (ridge[i] && !barrier[i]) {
      barrier[i] = 1
      added++
    }
  }
  console.log(`DEM 反演脊线并入：新增 ${added.toLocaleString('en-US')} 格屏障`)
}
if (existsSync(ridgeRawFile)) ridgeRawMask = new Uint8Array(readFileSync(ridgeRawFile).buffer)

/* ------------------------------------------------------------------ */
/* 2c. 导出浏览器端要用的掩膜（--export-masks）                          */
/* ------------------------------------------------------------------ */

/**
 * 三维场景里的栅格淹没要在浏览器里现算，需要两个掩膜：
 *   bit0 = 河道种子（长江/汉江水面，BFS 的起点）
 *   bit1 = 堤线屏障（OSM 堤线 ∪ DEM 反演脊线，不可穿越）
 * 两者和 Node 分析用的是同一份，避免两边口径漂移。
 */
if (process.argv.includes('--export-masks')) {
  const packed = new Uint8Array(cols * rows)
  let seedCells = 0
  let barrierCells = 0
  for (let i = 0; i < packed.length; i += 1) {
    let value = 0
    if (waterMask[i]) {
      value |= 1
      seedCells += 1
    }
    if (barrier[i]) {
      value |= 2
      barrierCells += 1
    }
    packed[i] = value
  }
  writeFileSync(join(publicData, 'flood-mask.bin'), packed)
  writeFileSync(
    join(publicData, 'flood-mask.json'),
    JSON.stringify(
      {
        note: '栅格淹没掩膜：bit0=河道种子，bit1=堤线屏障；行列与 dem-grid.json 完全一致',
        grid: gridMeta.grid,
        waterDatumOffsetM: DOCUMENTED_OFFSET,
        seedCells,
        barrierCells,
        generatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  )
  console.log(
    `\n已导出浏览器掩膜：public/data/flood-mask.bin（种子 ${seedCells.toLocaleString('en-US')} 格 / 屏障 ${barrierCells.toLocaleString('en-US')} 格）`
  )
}

/* ------------------------------------------------------------------ */
/* 3. 异常值处理：SRTM 在水面上的伪低值                                  */
/* ------------------------------------------------------------------ */

/** 水面在 DEM 里应当是平的；水体格的高程单独统计，不参与地形判定 */
const waterElevations = []
for (let i = 0; i < waterMask.length; i++) if (waterMask[i]) waterElevations.push(elevation[i])
waterElevations.sort((a, b) => a - b)
const pick = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]
const waterStats = {
  min: pick(waterElevations, 0),
  p25: pick(waterElevations, 0.25),
  median: pick(waterElevations, 0.5),
  p75: pick(waterElevations, 0.75),
  max: pick(waterElevations, 0.999)
}
console.log(
  `水面高程（DEM 原始口径）：${waterStats.min.toFixed(1)} / ${waterStats.p25.toFixed(1)} / ` +
    `${waterStats.median.toFixed(1)} / ${waterStats.p75.toFixed(1)} / ${waterStats.max.toFixed(1)} m（min/p25/中位/p75/max）`
)

/** 水体之外、高程又低得离谱的格子（SRTM 噪声）用邻域中值修复 */
const FLOOR_METERS = 5
let outliers = 0
function repairOutliers() {
  const next = elevation.slice()
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col
      if (waterMask[index]) continue
      if (elevation[index] >= FLOOR_METERS) continue
      const neighbours = []
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const r = row + dr
          const c = col + dc
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue
          const value = elevation[r * cols + c]
          if (!waterMask[r * cols + c] && value >= FLOOR_METERS) neighbours.push(value)
        }
      }
      if (neighbours.length) {
        neighbours.sort((a, b) => a - b)
        next[index] = neighbours[Math.floor(neighbours.length / 2)]
      } else {
        next[index] = FLOOR_METERS
      }
      outliers++
    }
  }
  elevation.set(next)
}
repairOutliers()
console.log(`陆域异常低值（< ${FLOOR_METERS} m）：修复 ${outliers} 格`)

/* ------------------------------------------------------------------ */
/* 4. 高程基准标定：DEM 口径 → 吴淞口径                                  */
/* ------------------------------------------------------------------ */

const series = JSON.parse(readFileSync(join(publicData, 'series.json'), 'utf8'))
const referenceSeries = series.series?.WL06?.waterLevel ?? []
const referenceLevel = Math.min(...referenceSeries)
/** 基准水面（吴淞）：序列的起始水位，作为"抬升量"的零点 */
const baselineLevel = Number((referenceSeries[0] ?? referenceLevel).toFixed(2))
/**
 * 标定假设：terrarium/SRTM 成像时河道处于枯水期，
 * 用汉口站序列的最低水位当作 DEM 水面所对应的吴淞高程。
 */
const autoOffset = Number((referenceLevel - waterStats.median).toFixed(2))
/**
 * 基准偏移是这套分析里最敏感的参数：
 *   按「江面 = 序列最低水位」标定时，会把整个城区地面抬到 33~37 m 吴淞（偏高 6~8 m），
 *   27 m 水位下几乎不淹；按「城区地面 ≈ 25~27 m 吴淞」标定时偏移只有 +1~2 m。
 * 由于缺少控制点，这里把它作为显式参数，并用敏感性分析给出面积区间。
 */
const datumOffset = Number.isFinite(OFFSET_OVERRIDE)
  ? OFFSET_OVERRIDE
  : FRAME === 'relative'
    ? 0
    : DOCUMENTED_OFFSET
console.log(`\n== 口径框架：${FRAME === 'relative' ? '相对（抬升量）' : '绝对（自动标定）'} ==`)
console.log(
  `  基准水面（吴淞）：序列起始水位 ${baselineLevel.toFixed(2)} m；` +
    `水位"抬升量" = 吴淞水位 − ${baselineLevel.toFixed(2)}`
)
if (FRAME === 'relative') {
  console.log(
    `  DEM 高程按原值使用（偏移 ${datumOffset} m）。依据：三套独立 DEM（SRTM/GLO-90/FABDEM）都把江面读成 ` +
      `${waterStats.min.toFixed(1)}~${waterStats.max.toFixed(1)} m，与汉口枯水位量级一致；` +
      `"DEM 与吴淞是否恰好同零点"仍是待标定量（估计 ±1~2 m），有控制点后应复核。`
  )
} else {
  console.log(
    `  文献口径偏移 +${DOCUMENTED_OFFSET} m（吴淞 = 1985 国家高程基准 + 1.83~1.87，出自 docs/吴淞高程系.docx；` +
      `EGM2008↔1985 的差值只有分米级），不确定度 ±${DOCUMENTED_UNCERTAINTY} m` +
      `；旧的自动标定值 ${autoOffset >= 0 ? '+' : ''}${autoOffset} m（江面 = 序列最低水位）已被证伪，仅作对照`
  )
}

const wusongElevation = new Float32Array(cols * rows)
for (let i = 0; i < elevation.length; i++) wusongElevation[i] = elevation[i] + datumOffset

/* ------------------------------------------------------------------ */
/* 5. 逐水位淹没 + 连通性                                              */
/* ------------------------------------------------------------------ */

const visited = new Uint8Array(cols * rows)
const stack = new Int32Array(cols * rows)

/**
 * 计算某一水位下的淹没范围
 * - 全量：z < h 的所有格
 * - 连通：从河道种子出发、经 4 邻域连通的部分（避免把内陆洼地当成淹没区）
 */
function floodAt(level, { useBarrier = false } = {}) {
  visited.fill(0)
  let allCells = 0
  for (let i = 0; i < wusongElevation.length; i++) {
    if (wusongElevation[i] < level) allCells++
  }

  // 种子：河道（水面按定义就是淹没的）
  let top = 0
  for (let i = 0; i < waterMask.length; i++) {
    if (!waterMask[i]) continue
    visited[i] = 1
    stack[top++] = i
  }

  let connectedCells = 0
  let depthSum = 0
  let maxDepth = 0
  let minElevation = Infinity
  while (top > 0) {
    const index = stack[--top]
    connectedCells++
    if (!waterMask[index]) {
      const depth = level - wusongElevation[index]
      depthSum += depth
      if (depth > maxDepth) maxDepth = depth
      if (wusongElevation[index] < minElevation) minElevation = wusongElevation[index]
    }
    const row = (index / cols) | 0
    const col = index % cols
    const neighbours = []
    if (row > 0) neighbours.push(index - cols)
    if (row < rows - 1) neighbours.push(index + cols)
    if (col > 0) neighbours.push(index - 1)
    if (col < cols - 1) neighbours.push(index + 1)
    for (const next of neighbours) {
      if (visited[next]) continue
      if (useBarrier && barrier[next]) continue
      if (wusongElevation[next] >= level) continue
      visited[next] = 1
      stack[top++] = next
    }
  }

  const dryNew = connectedCells - waterCells
  return {
    allAreaKm2: allCellsArea(allCells),
    connectedAreaKm2: allCellsArea(connectedCells),
    newlyFloodedKm2: allCellsArea(dryNew),
    meanDepth: dryNew > 0 ? depthSum / dryNew : 0,
    maxDepth,
    lowestElevation: Number.isFinite(minElevation) ? minElevation : null,
    connectedCells,
    dryNew,
    /** 连通掩膜（1 = 与河道连通，含河道本身）；调用方要留存必须自己拷贝 */
    mask: visited
  }
}

/** 面积 = Σ 单元球面面积；为避免每格都算，这里按行统计 */
function allCellsArea(cellCount) {
  if (cellCount === 0) return 0
  // 淹没格在行间近似均匀，用平均单元面积换算（格面积只随纬度变化，误差 < 0.3%）
  const meanArea = rowArea.reduce((sum, v) => sum + v, 0) / rows
  return Number(((cellCount * meanArea) / 1e6).toFixed(2))
}

/** 现有示意单元法在同一水位下的面积（单元高程 ≤ 水位即整块计入） */
const unitBands = JSON.parse(readFileSync(join(publicData, 'flood-bands.geojson'), 'utf8')).features
const unitAreaAt = (level) =>
  Number(
    unitBands
      .filter((feature) => feature.properties.elev_wusong_m <= level)
      .reduce((sum, feature) => sum + feature.properties.area_km2, 0)
      .toFixed(2)
  )

console.log('\n== 各级水位淹没面积（栅格法 vs 示意单元法）==')
console.log(`  基准水面（吴淞）${baselineLevel.toFixed(2)} m；"抬升"= 吴淞水位 − 基准水面`)
console.log(
  '吴淞(m)'.padStart(9) +
    '抬升(m)'.padStart(9) +
    '全部低于水位'.padStart(13) +
    '下界-有堤'.padStart(11) +
    '上界-无堤'.padStart(11) +
    '下界新增陆地'.padStart(13) +
    '平均水深'.padStart(10) +
    '最大水深'.padStart(10) +
    '示意单元法'.padStart(11)
)
const results = []
const resultMasks = []
for (const level of LEVELS) {
  const lower = floodAt(level, { useBarrier: true })
  // 掩膜是复用的缓冲区，必须立刻拷贝
  const lowerMask = Uint8Array.from(lower.mask)
  const upper = floodAt(level, { useBarrier: false })
  const upperMask = Uint8Array.from(upper.mask)
  const unitArea = unitAreaAt(level)
  results.push({
    levelWusong: level,
    riseAboveBaseline: Number((level - baselineLevel).toFixed(2)),
    allBelowLevelKm2: upper.allAreaKm2,
    lowerBoundKm2: lower.connectedAreaKm2,
    upperBoundKm2: upper.connectedAreaKm2,
    lowerNewLandKm2: lower.newlyFloodedKm2,
    meanDepthM: lower.meanDepth,
    maxDepthM: lower.maxDepth,
    unitMethodKm2: unitArea
  })
  resultMasks.push({ level, lowerMask, upperMask })
  console.log(
    String(level.toFixed(1)).padStart(8) +
      (level - baselineLevel).toFixed(2).padStart(9) +
      String(upper.allAreaKm2).padStart(13) +
      String(lower.connectedAreaKm2).padStart(11) +
      String(upper.connectedAreaKm2).padStart(11) +
      String(lower.newlyFloodedKm2).padStart(13) +
      lower.meanDepth.toFixed(2).padStart(10) +
      lower.maxDepth.toFixed(2).padStart(10) +
      String(unitArea).padStart(11)
  )
}

/* ------------------------------------------------------------------ */
/* 5b. 相邻档位的跳变诊断（只在显式指定 --levels= 时输出）                */
/* ------------------------------------------------------------------ */

/**
 * 栅格淹没是硬阈值模型：水位只要越过某个"鞍部"高程，
 * 水就会翻过那道坎灌进整片低洼地，面积出现台阶式跳变。
 * 这段输出就是为了把台阶找出来——跳了多少、跳在哪、那道坎有多高。
 */
if (LEVELS_ARG && resultMasks.length > 1) {
  const toLngLat = (index) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    return {
      lng: Number((west + (col + 0.5) * cellDeg).toFixed(4)),
      lat: Number((south + (row + 0.5) * cellDeg).toFixed(4))
    }
  }
  console.log('\n== 相邻档位跳变诊断（有堤口径）==')
  for (let i = 1; i < resultMasks.length; i++) {
    const prev = resultMasks[i - 1]
    const cur = resultMasks[i]
    const additions = []
    let minLng = Infinity
    let maxLng = -Infinity
    let minLat = Infinity
    let maxLat = -Infinity
    for (let k = 0; k < cur.lowerMask.length; k++) {
      if (!cur.lowerMask[k] || prev.lowerMask[k]) continue
      additions.push(k)
      const { lng, lat } = toLngLat(k)
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }

    const areaKm2 = allCellsArea(additions.length)
    const previous = results[i - 1]?.lowerBoundKm2 ?? 0
    const ratio = previous > 0 ? ((areaKm2 / previous) * 100).toFixed(1) : '—'
    console.log(
      `${prev.level.toFixed(2)} → ${cur.level.toFixed(2)} m：新增 ${additions.length.toLocaleString('en-US')} 格 / ${areaKm2} km²` +
        `（上一档 ${previous} km² 的 ${ratio}%；同时段无堤上界 ${results[i].upperBoundKm2} km²）`
    )
    if (additions.length) {
      console.log(
        `  新增区域范围：${minLng}~${maxLng}°E，${minLat}~${maxLat}°N`
      )
      // 新增格按 4 邻域聚簇：最大的那一簇才是"水面灌进去的那片"，
      // 只有找到它，才能把"过水鞍部"定位到对的缺口上（否则会被别处的零星格子带偏）。
      const additionSet = new Set(additions)
      const seen = new Set()
      const clusters = []
      for (const start of additions) {
        if (seen.has(start)) continue
        const queue = [start]
        seen.add(start)
        const cells = []
        while (queue.length) {
          const index = queue.pop()
          cells.push(index)
          const row = Math.floor(index / cols)
          const col = index % cols
          const neighbours = []
          if (row > 0) neighbours.push(index - cols)
          if (row < rows - 1) neighbours.push(index + cols)
          if (col > 0) neighbours.push(index - 1)
          if (col < cols - 1) neighbours.push(index + 1)
          for (const next of neighbours) {
            if (!additionSet.has(next) || seen.has(next)) continue
            seen.add(next)
            queue.push(next)
          }
        }
        clusters.push(cells)
      }
      clusters.sort((a, b) => b.length - a.length)
      for (const cluster of clusters.slice(0, 3)) {
        let saddle = null
        let sumLng = 0
        let sumLat = 0
        for (const index of cluster) {
          const { lng, lat } = toLngLat(index)
          sumLng += lng
          sumLat += lat
          const row = Math.floor(index / cols)
          const col = index % cols
          const neighbours = []
          if (row > 0) neighbours.push(index - cols)
          if (row < rows - 1) neighbours.push(index + cols)
          if (col > 0) neighbours.push(index - 1)
          if (col < cols - 1) neighbours.push(index + 1)
          if (!neighbours.some((n) => prev.lowerMask[n])) continue
          // 与上一档淹没区相邻 = 水刚越过的前沿，最低的那一格就是过水鞍部
          if (!saddle || wusongElevation[index] < saddle.elevation) {
            saddle = { elevation: wusongElevation[index], ...toLngLat(index) }
          }
        }
        const centroidLng = (sumLng / cluster.length).toFixed(4)
        const centroidLat = (sumLat / cluster.length).toFixed(4)
        console.log(
          `  新增区块：${allCellsArea(cluster.length)} km²，中心约 ${centroidLng}°E ${centroidLat}°N` +
            (saddle
              ? `；过水鞍部 ${saddle.lng}°E ${saddle.lat}°N，高程 ${saddle.elevation.toFixed(2)} m（吴淞）`
              : '（未与上一档淹没区相接）')
        )
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 6. 预览图：山体阴影 + 水面 + 淹没范围                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 6a. 诊断：横断面 + DEM 平滑敏感性                                     */
/* ------------------------------------------------------------------ */

/** 取某点起向给定方位延伸的横断面（打印 DEM 口径与吴淞口径） */
function sampleSection(name, from, bearingDeg, lengthM, steps) {
  const values = []
  const bearing = bearingDeg * D2R
  for (let i = 0; i <= steps; i++) {
    const distance = (lengthM * i) / steps
    const dLat = (distance * Math.cos(bearing)) / 111320
    const dLng = (distance * Math.sin(bearing)) / (111320 * Math.cos(from[1] * D2R))
    const lng = from[0] + dLng
    const lat = from[1] + dLat
    const col = Math.round((lng - west) / cellDeg - 0.5)
    const row = Math.round((lat - south) / cellDeg - 0.5)
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue
    values.push({ distance: Math.round(distance), dem: elevation[row * cols + col], wusong: wusongElevation[row * cols + col] })
  }
  console.log(`\n${name}（每段 ${Math.round(lengthM / steps)} m）：`)
  console.log(
    '  距起点(m) ' + values.map((v) => String(v.distance).padStart(8)).join('')
  )
  console.log('  DEM高程   ' + values.map((v) => v.dem.toFixed(1).padStart(8)).join(''))
  console.log('  吴淞口径  ' + values.map((v) => v.wusong.toFixed(1).padStart(8)).join(''))
  return values
}

console.log('\n== 诊断 1：从江边向陆地的横断面（看有没有"挡住水"的高值）==')
sampleSection('汉口江滩 → 西北内陆', [114.29, 30.578], 315, 2000, 10)
sampleSection('武昌江边 → 东南内陆', [114.31, 30.55], 135, 2000, 10)
sampleSection('阳逻江边 → 西北内陆', [114.54, 30.68], 315, 2000, 10)

/** 对高程做 5×5 中值滤波，用于检验"城区伪高值阻挡连通性"的假设 */
function medianSmoothedGrid(radius = 2) {
  const out = new Float32Array(elevation.length)
  const window = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      window.length = 0
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const r = row + dr
          const c = col + dc
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue
          window.push(elevation[r * cols + c])
        }
      }
      window.sort((a, b) => a - b)
      out[row * cols + col] = window[Math.floor(window.length / 2)]
    }
  }
  return out
}

const smoothed = medianSmoothedGrid(2)
const rawBackup = Float32Array.from(wusongElevation)
for (let i = 0; i < wusongElevation.length; i++) wusongElevation[i] = smoothed[i] + datumOffset
const smoothedResult = floodAt(27.3)
wusongElevation.set(rawBackup)
const rawResult = floodAt(27.3)
console.log('\n== 诊断 2：DEM 平滑敏感性（27.3 m 警戒水位）==')
console.log(`  原始 DEM      ：连通淹没 ${rawResult.connectedAreaKm2} km²（其中新增陆地 ${rawResult.newlyFloodedKm2} km²）`)
console.log(
  `  5×5 中值平滑后：连通淹没 ${smoothedResult.connectedAreaKm2} km²（其中新增陆地 ${smoothedResult.newlyFloodedKm2} km²）`
)

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function encodePng(width, height, rgb) {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const typeBuffer = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
    return Buffer.concat([length, typeBuffer, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** 山体阴影：按西北方向光源计算坡面明暗 */
function buildHillshade() {
  const shade = new Float32Array(cols * rows)
  const azimuth = 315 * D2R
  const altitude = 45 * D2R
  const cellMeters = cellDeg * 111320
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col
      const left = elevation[row * cols + Math.max(0, col - 1)]
      const right = elevation[row * cols + Math.min(cols - 1, col + 1)]
      const down = elevation[Math.max(0, row - 1) * cols + col]
      const up = elevation[Math.min(rows - 1, row + 1) * cols + col]
      const dzdx = (right - left) / (2 * cellMeters)
      const dzdy = (up - down) / (2 * cellMeters)
      const slope = Math.atan(Math.hypot(dzdx, dzdy))
      const aspect = Math.atan2(dzdy, -dzdx)
      const value =
        Math.cos(altitude) * Math.cos(slope) +
        Math.sin(altitude) * Math.sin(slope) * Math.cos(azimuth - aspect)
      shade[index] = Math.max(0, Math.min(1, value))
    }
  }
  return shade
}

const shade = buildHillshade()
// 预览图用"不考虑堤防"的上界（能看出地形驱动的不规则边界），堤线另画深色细线
const preview = floodAt(PREVIEW_LEVEL, { useBarrier: true })
const pixel = Buffer.alloc(cols * rows * 3)

/**
 * 配图口径（写进 README 与报告）：
 *   河道     深蓝
 *   连通淹没 青蓝（按水深加深）
 *   低于水位但未连通  淡黄 —— 被堤防或城区建筑伪高值挡住的部分，是这张图最值得看的信息
 *   陆地     灰度山影 + 高程分带着色
 *   白色细线 现有「示意单元法」的单元边界（用于对照）
 *   橙色细线 OSM 堤线（位置来源）
 *   红色调  DEM 反演出来的堤顶屏障（给 OSM 缺口打的补丁）
 */
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    // 图像 y 轴向下，格网 row 自南向北 → 翻转
    const index = row * cols + col
    const target = ((rows - 1 - row) * cols + col) * 3
    const height = wusongElevation[index]
    let r
    let g
    let b
    if (waterMask[index]) {
      r = 26
      g = 79
      b = 122
    } else if (visited[index]) {
      // 淹没区：按水深分级（浅青 → 深蓝），主题图的主色
      const depth = Math.max(0, PREVIEW_LEVEL - height)
      const t = Math.min(1, depth / 8)
      r = Math.round(120 - 90 * t)
      g = Math.round(200 - 110 * t)
      b = Math.round(235 - 30 * t)
    } else if (height < PREVIEW_LEVEL) {
      // 低于水位却没连通：淡黄，表示"无堤时会进水的范围"
      const base = shade[index]
      r = Math.round(226 + 22 * base)
      g = Math.round(216 + 24 * base)
      b = Math.round(150 + 40 * base)
    } else {
      // 陆地：浅色山影做底，让蓝色淹没区跳出来
      const light = 0.55 + 0.45 * shade[index]
      const band = Math.min(1, Math.max(0, (height - 20) / 60))
      const tone = (205 - 60 * band) * light + 35
      r = Math.round(tone * 0.96)
      g = Math.round(tone)
      b = Math.round(tone * 0.93)
      // DEM 反演脊线：暗红细线，展示它给 OSM 补的缺口
      if (ridgeRawMask?.[index]) {
        r = 200
        g = 60
        b = 60
      }
    }
    pixel[target] = r
    pixel[target + 1] = g
    pixel[target + 2] = b
  }
}

/** 把现有示意单元的边界画成白色细线（Bresenham，直接在像素缓冲上画） */
function drawPolyline(a, b, color = [90, 90, 90]) {
  const toPixel = ([lng, lat]) => [
    Math.round((lng - west) / cellDeg - 0.5),
    Math.round((lat - south) / cellDeg - 0.5)
  ]
  let [x0, y0] = toPixel(a)
  const [x1, y1] = toPixel(b)
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  for (let guard = 0; guard < 10000; guard++) {
    if (x0 >= 0 && x0 < cols && y0 >= 0 && y0 < rows) {
      const target = ((rows - 1 - y0) * cols + x0) * 3
      pixel[target] = color[0]
      pixel[target + 1] = color[1]
      pixel[target + 2] = color[2]
    }
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x0 += sx
    }
    if (e2 < dx) {
      err += dx
      y0 += sy
    }
  }
}
for (const feature of unitBands) {
  const polygons =
    feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) drawPolyline(ring[i - 1], ring[i])
    }
  }
}

/** OSM 堤线画成橙色，便于与 DEM 反演（红色调）区分 */
if (existsSync(leveeFile)) {
  const levees = JSON.parse(readFileSync(leveeFile, 'utf8'))
  for (const element of levees.elements ?? []) {
    const geometry = element.geometry ?? []
    for (let i = 1; i < geometry.length; i++) {
      drawPolyline(
        [geometry[i - 1].lon, geometry[i - 1].lat],
        [geometry[i].lon, geometry[i].lat],
        [235, 120, 20]
      )
    }
  }
}
const previewFile = join(dataSrc, `flood-raster-preview${OUTPUT_SUFFIX}.png`)
writeFileSync(previewFile, encodePng(cols, rows, pixel))

/* ------------------------------------------------------------------ */
/* 7. 报告                                                             */
/* ------------------------------------------------------------------ */

const report = {
  generatedAt: new Date().toISOString(),
  dem: {
    source: gridMeta.source,
    license: gridMeta.license,
    verticalDatum: gridMeta.verticalDatum,
    zoom: gridMeta.zoom,
    grid: gridMeta.grid,
    elevationRangeMeters: gridMeta.elevationRangeMeters
  },
  datumCalibration: {
    referenceStation: 'WL06 汉口（武汉关）',
    referenceLevelWusong: referenceLevel,
    demWaterSurfaceMedian: Number(waterStats.median.toFixed(2)),
    demWaterSurfaceSpreadMeters: Number((waterStats.max - waterStats.min).toFixed(2)),
    offsetMeters: datumOffset,
    assumption: '假定 DEM 成像时为枯水期水面，以汉口站序列最低水位作为吴淞基准锚点'
  },
  outliersRepaired: outliers,
  waterCells,
  diagnostics: {
    smoothingSensitivity: {
      level: 27.3,
      rawConnectedKm2: rawResult.connectedAreaKm2,
      smoothedConnectedKm2: smoothedResult.connectedAreaKm2,
      rawNewlyFloodedKm2: rawResult.newlyFloodedKm2,
      smoothedNewlyFloodedKm2: smoothedResult.newlyFloodedKm2
    },
    note: '5×5 中值平滑用于检验城区建筑/树冠伪高值对连通性的影响'
  },
  preview: {
    file: `flood-raster-preview${OUTPUT_SUFFIX}.png`,
    level: PREVIEW_LEVEL,
    legend: '深蓝=河道；青蓝=连通淹没；淡黄=低于水位但未连通（堤防或城区伪高值阻挡）；白线=现有示意单元边界'
  },
  levels: results
}
const reportFile = join(dataSrc, `flood-raster-report${OUTPUT_SUFFIX}.json`)
writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8')

console.log(`\n预览图（${PREVIEW_LEVEL} m）：${previewFile}`)
console.log(`明细报告：${reportFile}`)
