/**
 * 栅格淹没计算（浏览器端）
 * ------------------------------------------------------------------
 * 与 scripts/analyze-flood-raster.mjs 同一口径，逐条对齐：
 *   1. 陆域异常低值修复：水面之外的格子若高程 < 5 m（DEM 噪声）用 5×5 邻域中值替换；
 *   2. 基准换算：吴淞 = DEM + datumOffset（默认 +1.87，出自 docs/吴淞高程系.docx）；
 *   3. 连通淹没：从河道种子出发做 4 邻域 BFS，只淹低于水位的格子；
 *      开堤防屏障时不可穿越（下界），不开则是最宽松的上界——真实值落在两者之间；
 *   4. 面积按每行球面单元面积折算（格面积只随纬度变化，误差 < 0.3%）。
 *
 * 输出掩膜取值：0 未淹 / 1 河道 / 2 连通新增陆地 / 3 低于水位但未连通。
 * 第 3 类单独标出来是有意为之：它就是"地形上低于水位、但被堤防或城区伪高值挡住"的部分，
 * 示意单元法看不到这个差别。
 */

const EARTH_RADIUS = 6371008.8
const D2R = Math.PI / 180
/** 陆域低于这个高程的格子按噪声处理（米） */
export const FLOOR_METERS = 5

export const MASK_DRY = 0
export const MASK_CHANNEL = 1
export const MASK_CONNECTED = 2
export const MASK_ISOLATED = 3

export function createFloodRasterizer({ heights, cols, rows, west, south, cellDeg, seed, barrier, datumOffset }) {
  const size = cols * rows
  if (!heights || heights.length !== size) {
    throw new Error(`高程格网尺寸不符：期望 ${size}`)
  }

  /** DEM 原始口径高程（米） */
  const elevation = Float32Array.from(heights)
  const repaired = repairOutliers(elevation, cols, rows, seed)

  /** 吴淞口径高程（米） */
  const wusong = new Float32Array(size)
  for (let i = 0; i < size; i += 1) wusong[i] = elevation[i] + datumOffset

  const rowArea = new Float64Array(rows)
  let areaSum = 0
  for (let row = 0; row < rows; row += 1) {
    const lat1 = south + row * cellDeg
    const lat2 = lat1 + cellDeg
    const area =
      EARTH_RADIUS * EARTH_RADIUS * (cellDeg * D2R) * (Math.sin(lat2 * D2R) - Math.sin(lat1 * D2R))
    rowArea[row] = area
    areaSum += area
  }
  const meanCellAreaM2 = areaSum / rows

  let waterCells = 0
  for (let i = 0; i < size; i += 1) if (seed[i]) waterCells += 1

  const visited = new Uint8Array(size)
  const stack = new Int32Array(size)
  const mask = new Uint8Array(size)

  const toKm2 = (cellCount) => Number(((cellCount * meanCellAreaM2) / 1e6).toFixed(2))

  /**
   * 计算某个水位（吴淞，米）下的淹没范围
   * @param {Number} level 水位（吴淞高程）
   * @param {Object} [options]
   * @param {Boolean} [options.useBarrier=true] 是否把堤线当作不可穿越屏障（下界口径）
   */
  function floodAt(level, { useBarrier = true } = {}) {
    visited.fill(0)
    mask.fill(MASK_DRY)

    let belowCells = 0
    for (let i = 0; i < size; i += 1) {
      if (wusong[i] < level) {
        belowCells += 1
        mask[i] = MASK_ISOLATED
      }
    }

    // 种子：河道水面按定义就是淹没的
    let top = 0
    for (let i = 0; i < size; i += 1) {
      if (!seed[i]) continue
      visited[i] = 1
      mask[i] = MASK_CHANNEL
      stack[top++] = i
    }

    let connectedCells = 0
    let depthSum = 0
    let maxDepth = 0
    let lowest = Infinity
    while (top > 0) {
      const index = stack[--top]
      connectedCells += 1
      if (!seed[index]) {
        const depth = level - wusong[index]
        depthSum += depth
        if (depth > maxDepth) maxDepth = depth
        if (wusong[index] < lowest) lowest = wusong[index]
        mask[index] = MASK_CONNECTED
      }
      const row = (index / cols) | 0
      const col = index % cols
      if (row > 0) push(index - cols)
      if (row < rows - 1) push(index + cols)
      if (col > 0) push(index - 1)
      if (col < cols - 1) push(index + 1)
    }

    function push(next) {
      if (visited[next]) return
      if (useBarrier && barrier[next]) return
      if (wusong[next] >= level) return
      visited[next] = 1
      stack[top++] = next
    }

    const newLandCells = connectedCells - waterCells
    return {
      mask,
      level,
      useBarrier,
      channelCells: waterCells,
      connectedCells,
      newLandCells,
      belowCells,
      isolatedCells: belowCells - connectedCells,
      channelKm2: toKm2(waterCells),
      connectedKm2: toKm2(connectedCells),
      newLandKm2: toKm2(newLandCells),
      belowKm2: toKm2(belowCells),
      isolatedKm2: toKm2(belowCells - connectedCells),
      meanDepth: newLandCells > 0 ? depthSum / newLandCells : 0,
      maxDepth,
      lowestElevation: Number.isFinite(lowest) ? Number(lowest.toFixed(2)) : null,
      meanCellAreaM2,
      repairedCells: repaired,
      waterDatumOffsetM: datumOffset
    }
  }

  return { floodAt, cols, rows, west, south, cellDeg, meanCellAreaM2, repairedCells: repaired }
}

/** 水面之外、高程又低得离谱的格子用 5×5 邻域中值修复（与 Node 脚本一致） */
function repairOutliers(elevation, cols, rows, seed) {
  const next = elevation.slice()
  let count = 0
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col
      if (seed[index]) continue
      if (elevation[index] >= FLOOR_METERS) continue
      const neighbours = []
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const r = row + dr
          const c = col + dc
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue
          const at = r * cols + c
          if (!seed[at] && elevation[at] >= FLOOR_METERS) neighbours.push(elevation[at])
        }
      }
      if (neighbours.length) {
        neighbours.sort((a, b) => a - b)
        next[index] = neighbours[Math.floor(neighbours.length / 2)]
      } else {
        next[index] = FLOOR_METERS
      }
      count += 1
    }
  }
  elevation.set(next)
  return count
}

/**
 * 把掩膜画成一张可直接当影像层用的画布（第 0 行在北，与 Cesium 一致）
 * 传入 targetCanvas 可以复用同一块画布与同一份 ImageData：
 * 时间轴播放时每秒要重画好几次，反复分配 2.9 MB 的缓冲区既浪费又掉帧。
 */
export function renderMaskToCanvas(mask, cols, rows, palette, targetCanvas) {
  const canvas = targetCanvas ?? document.createElement('canvas')
  if (canvas.width !== cols || canvas.height !== rows) {
    canvas.width = cols
    canvas.height = rows
    canvas.__imageData = null
  }
  const context = canvas.getContext('2d')
  let image = canvas.__imageData
  if (!image || image.width !== cols || image.height !== rows) {
    image = context.createImageData(cols, rows)
    canvas.__imageData = image
  }
  const data = image.data
  data.fill(0)

  for (let row = 0; row < rows; row += 1) {
    const sourceRow = rows - 1 - row
    for (let col = 0; col < cols; col += 1) {
      const value = mask[sourceRow * cols + col]
      const index = (row * cols + col) * 4
      const color = palette[value]
      if (!color) continue
      data[index] = color[0]
      data[index + 1] = color[1]
      data[index + 2] = color[2]
      data[index + 3] = color[3]
    }
  }

  context.putImageData(image, 0, 0)
  return canvas
}
