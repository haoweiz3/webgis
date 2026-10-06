/**
 * 从 FABDEM 反演堤顶脊线（给 OSM 堤线补缺口）
 * ------------------------------------------------------------------
 * 依据：FABDEM 的设计目标是"去建筑、去树、保留地形"，堤防属于地形会被保留；
 *   堤的形态特征很规矩——沿河连续、宽 8~10 m、高出相邻平地面 2~4 m。
 * 做法：对高程做半径 R 的可分离滑动平均当作"局部地面"，
 *   脊线 = 高程 − 局部平均 > 阈值，并限制在河道走廊内（避免误抓丘陵）。
 * 验证：用 OSM 的 416 条堤线做命中率检查。
 *
 * 输出：scripts/data-src/levees-dem.bin（Uint8 掩膜，与 dem-grid 同网格）
 * 运行：pnpm derive:levees
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataSrc = join(__dirname, 'data-src')
const R = 12 // 滑动平均半径（格，100 m/格 → 约 1.2 km）
const RIDGE_MIN = 1.5 // 高于局部地面的阈值（米）
const CORRIDOR_CELLS = 30 // 河道走廊宽度（格，约 3 km）
const nearArg = process.argv.find((arg) => arg.startsWith('--near='))
const NEAR_WATER_CELLS = nearArg ? Number(nearArg.split('=')[1]) : 15 // 堤紧邻河道：默认 1.5 km 内
const MIN_COMPONENT_CELLS = 60 // 连通分量最小长度（格，约 600 m）
const SIDE_SCAN_CELLS = 8 // 两侧判据的扫描距离（格，约 800 m）
const SIDE_LOW_DROP = 2.0 // 另一侧要低这么多米才算"堤外低地"
/**
 * 侧判据默认关闭：实测开启后 OSM 命中率从 30.6% 掉到 15.5%、下界从 1452 反弹到 2918 ✗。
 * 原因是"临水"参照只有长江/汉江水面，而武汉不少堤段外侧是 1~2 km 宽的江滩，
 * 800 m 扫描够不到水面；需要先把湖泊/江滩纳入"水"参照，再启用这条判据。
 * 用 --side-check 可手动开启做对照。
 */
const USE_SIDE_CHECK = process.argv.includes('--side-check')

const meta = JSON.parse(readFileSync(join(dataSrc, 'dem-grid.json'), 'utf8'))
const { cols, rows, west, south, cellDeg } = meta.grid
const raw = new Uint16Array(readFileSync(join(dataSrc, 'dem-grid.bin')).buffer)
const elevation = new Float32Array(cols * rows)
for (let i = 0; i < elevation.length; i++) {
  elevation[i] = raw[i] / meta.storage.scale + meta.storageEncoding.baseMeters
}

/** 河道走廊掩膜：把水域面栅格化后按 CORRIDOR_CELLS 膨胀 */
const waterSource = JSON.parse(readFileSync(join(dataSrc, 'yangtze-water.json'), 'utf8'))
const rings = waterSource.rivers
  .flatMap((river) => river.polygons.map((p) => ({ outer: p.outer, holes: p.holes })))
function rasterizeWater() {
  const mask = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row++) {
    const lat = south + (row + 0.5) * cellDeg
    const crossings = []
    for (const polygon of rings) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        for (let i = 1; i < ring.length; i++) {
          const [x1, y1] = ring[i - 1]
          const [x2, y2] = ring[i]
          if (y1 > lat === y2 > lat) continue
          crossings.push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1))
        }
      }
    }
    crossings.sort((a, b) => a - b)
    for (let i = 1; i < crossings.length; i += 2) {
      const from = Math.max(0, Math.ceil((crossings[i - 1] - west) / cellDeg - 0.5))
      const to = Math.min(cols - 1, Math.floor((crossings[i] - west) / cellDeg - 0.5))
      for (let col = from; col <= to; col++) mask[row * cols + col] = 1
    }
  }
  return mask
}
const water = rasterizeWater()
/** 紧邻水面的带（堤一定靠河），用于剔除内陆路堤与孤立凸起 */
const nearWater = new Uint8Array(cols * rows)
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    if (!water[row * cols + col]) continue
    for (let dr = -NEAR_WATER_CELLS; dr <= NEAR_WATER_CELLS; dr++) {
      for (let dc = -NEAR_WATER_CELLS; dc <= NEAR_WATER_CELLS; dc++) {
        const r = row + dr
        const c = col + dc
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue
        nearWater[r * cols + c] = 1
      }
    }
  }
}
const corridor = new Uint8Array(cols * rows)
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    if (!water[row * cols + col]) continue
    for (let dr = -CORRIDOR_CELLS; dr <= CORRIDOR_CELLS; dr++) {
      for (let dc = -CORRIDOR_CELLS; dc <= CORRIDOR_CELLS; dc++) {
        const r = row + dr
        const c = col + dc
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue
        corridor[r * cols + c] = 1
      }
    }
  }
}

/** 可分离滑动平均（O(n)）：先横后纵 */
const blur = new Float32Array(cols * rows)
const temp = new Float32Array(cols * rows)
for (let row = 0; row < rows; row++) {
  let sum = 0
  for (let col = 0; col < cols; col++) {
    sum += elevation[row * cols + col]
    if (col > 2 * R) sum -= elevation[row * cols + col - 2 * R - 1]
    const count = Math.min(col + 1, 2 * R + 1)
    temp[row * cols + col] = sum / count
  }
}
for (let col = 0; col < cols; col++) {
  let sum = 0
  for (let row = 0; row < rows; row++) {
    sum += temp[row * cols + col]
    if (row > 2 * R) sum -= temp[(row - 2 * R - 1) * cols + col]
    const count = Math.min(row + 1, 2 * R + 1)
    blur[row * cols + col] = sum / count
  }
}

/** 脊线掩膜 + 一档加粗（避免 4 邻域连通时对角渗漏） */
const ridge = new Uint8Array(cols * rows)
const ridgeRaw = new Uint8Array(cols * rows)
let rawRidge = 0
/**
 * 堤的形态本质：一侧临水（河），另一侧是低地。
 * 这条判据用来剔除内陆路堤、田埂与孤立凸起 —— 它们两侧都是同类地面。
 */
function hasWaterAndLowSide(row, col) {
  const self = elevation[row * cols + col]
  for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    let waterSide = false
    let lowSide = false
    for (let k = 1; k <= SIDE_SCAN_CELLS; k++) {
      const r = row + dr * k
      const c = col + dc * k
      if (r < 0 || r >= rows || c < 0 || c >= cols) break
      if (water[r * cols + c]) waterSide = true
    }
    for (let k = 1; k <= SIDE_SCAN_CELLS; k++) {
      const r = row - dr * k
      const c = col - dc * k
      if (r < 0 || r >= rows || c < 0 || c >= cols) break
      if (elevation[r * cols + c] < self - SIDE_LOW_DROP) lowSide = true
    }
    if (waterSide && lowSide) return true
  }
  return false
}
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    const index = row * cols + col
    if (!nearWater[index]) continue
    if (elevation[index] - blur[index] <= RIDGE_MIN) continue
    if (USE_SIDE_CHECK && !hasWaterAndLowSide(row, col)) continue
    rawRidge++
    ridgeRaw[index] = 1
    for (const [dr, dc] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const r = row + dr
      const c = col + dc
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue
      ridge[r * cols + c] = 1
    }
  }
}

/* ---- 连通分量过滤：丢掉长度不足的孤立碎点（田埂、路堤、噪声） ---- */
{
  const seen = new Uint8Array(cols * rows)
  const stack = new Int32Array(cols * rows)
  const keep = new Uint8Array(cols * rows)
  const component = []
  for (let start = 0; start < ridgeRaw.length; start++) {
    if (!ridgeRaw[start] || seen[start]) continue
    let top = 0
    stack[top++] = start
    seen[start] = 1
    component.length = 0
    while (top > 0) {
      const current = stack[--top]
      component.push(current)
      const row = (current / cols) | 0
      const col = current % cols
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const r = row + dr
        const c = col + dc
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue
        const next = r * cols + c
        if (!ridgeRaw[next] || seen[next]) continue
        seen[next] = 1
        stack[top++] = next
      }
    }
    if (component.length >= MIN_COMPONENT_CELLS) for (const index of component) keep[index] = 1
  }
  ridge.fill(0)
  ridgeRaw.fill(0)
  rawRidge = 0
  for (let index = 0; index < keep.length; index++) {
    if (!keep[index]) continue
    ridgeRaw[index] = 1
    rawRidge++
    const row = (index / cols) | 0
    const col = index % cols
    for (const [dr, dc] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const r = row + dr
      const c = col + dc
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue
      ridge[r * cols + c] = 1
    }
  }
}

/* ---- 用 OSM 堤线验证命中率 ---- */
let osmCells = 0
let hit = 0
try {
  const levees = JSON.parse(readFileSync(join(dataSrc, 'levees-osm.json'), 'utf8'))
  const toCell = ([lng, lat]) => [
    Math.round((lng - west) / cellDeg - 0.5),
    Math.round((lat - south) / cellDeg - 0.5)
  ]
  for (const element of levees.elements ?? []) {
    const geometry = element.geometry ?? []
    for (let i = 1; i < geometry.length; i++) {
      const [x0, y0] = toCell([geometry[i - 1].lon, geometry[i - 1].lat])
      const [x1, y1] = toCell([geometry[i].lon, geometry[i].lat])
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
      for (let k = 0; k <= steps; k++) {
        const col = Math.round(x0 + ((x1 - x0) * k) / steps)
        const row = Math.round(y0 + ((y1 - y0) * k) / steps)
        if (row < 0 || row >= rows || col < 0 || col >= cols) continue
        osmCells++
        if (ridge[row * cols + col]) hit++
      }
    }
  }
} catch {
  console.log('（未找到 levee-osm.json，跳过命中率验证）')
}

let ridgeCells = 0
for (let i = 0; i < ridge.length; i++) if (ridge[i]) ridgeCells++
console.log(`脊线检测：滑窗半径 ${R} 格（约 ${((R * 2 + 1) * cellDeg * 111320).toFixed(0)} m），阈值 ${RIDGE_MIN} m，走廊限制 ${CORRIDOR_CELLS} 格`)
console.log(`  原始脊线 ${rawRidge.toLocaleString('en-US')} 格 → 加粗后 ${ridgeCells.toLocaleString('en-US')} 格`)
if (osmCells) {
  console.log(`  OSM 堤线命中率：${((hit / osmCells) * 100).toFixed(1)}%（${hit}/${osmCells} 格）`)
}
writeFileSync(join(dataSrc, 'levees-dem.bin'), Buffer.from(ridge.buffer))
writeFileSync(join(dataSrc, 'levees-dem-raw.bin'), Buffer.from(ridgeRaw.buffer))
console.log(`已写出 scripts/data-src/levees-dem.bin（屏障）与 levees-dem-raw.bin（原始脊线，画图用）`)
