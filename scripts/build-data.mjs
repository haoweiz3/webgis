/**
 * 时空数据生成脚本
 * ---------------------------------------------------------------
 * 用途：生成长江武汉段三维时空数据可视化平台所需的全部演示数据，
 *       输出到 public/data/ 目录，保证前端项目可独立运行。
 *
 * 数据口径说明：
 *   1. 水域面、岸线、滩地（淹没单元）为「示意简化数据」，
 *      是用长江武汉段中心线按河宽、滩地宽度做几何偏移生成的，
 *      经纬度走向与真实河道一致，但不具备测绘精度。
 *      生产环境应替换为 OSM / 天地图 / 公开水系数据。
 *   2. 跨江桥梁要素取自本地公开整理数据（含真实经纬度与简介）。
 *   3. 站点位置取自真实站点名称与河段位置，水位、流量、雨量、水质
 *      时序数据为按水文规律模拟生成，仅用于演示，不作为任何决策依据。
 *   4. 高程统一采用吴淞高程（米），三维渲染前由前端按基准偏移量
 *      转换为场景高程，见 src/config/scene.js。
 *
 * 运行：pnpm build:data
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, join } from 'node:path'
import { STUDY_AREA } from '../src/config/scene.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const outDir = join(projectRoot, 'public', 'data')
const sourceDir = process.env.SOURCE_DATA_DIR || 'D:/学习/XZD/Part3/smart-city-wuhan/src/assets'

const EARTH_RADIUS = 6371008.8
const D2R = Math.PI / 180

/* ------------------------------------------------------------------ */
/* 基础几何工具（经纬度平面近似 + 球面面积）                              */
/* ------------------------------------------------------------------ */

const metersToLat = (m) => m / 111320
const metersToLng = (m, lat) => m / (111320 * Math.cos(lat * D2R))

function haversine(a, b) {
  const dLat = (b[1] - a[1]) * D2R
  const dLng = (b[0] - a[0]) * D2R
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)))
}

function lineLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i])
  return total
}

/** 沿折线按固定间距重采样 */
function resample(points, stepM) {
  const out = [points[0]]
  let carry = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const segLen = haversine(a, b)
    let travelled = carry
    while (travelled + stepM <= segLen) {
      travelled += stepM
      const t = travelled / segLen
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
    carry = travelled - segLen + stepM
    if (carry === stepM) carry = 0
  }
  const last = points[points.length - 1]
  if (haversine(out[out.length - 1], last) > stepM * 0.4) out.push(last)
  return out
}

/** 折线上按比例取值（t: 0~1，按累计长度） */
function pointAt(points, t) {
  const total = lineLength(points)
  let target = total * Math.min(1, Math.max(0, t))
  for (let i = 1; i < points.length; i++) {
    const segLen = haversine(points[i - 1], points[i])
    if (target <= segLen) {
      const k = segLen === 0 ? 0 : target / segLen
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * k,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * k
      ]
    }
    target -= segLen
  }
  return points[points.length - 1]
}

/** 折线法向偏移，side = 1 左侧、-1 右侧（以行进方向为准） */
function offsetLine(points, distanceM, side) {
  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    const dx = (next[0] - prev[0]) * Math.cos(p[1] * D2R)
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    // 法向量 (dx, dy) -> (-dy, dx)，再换算回经纬度
    const nx = (-dy / len) * side
    const ny = (dx / len) * side
    return [
      p[0] + metersToLng(distanceM * nx, p[1]),
      p[1] + metersToLat(distanceM * ny)
    ]
  })
}

/** 球面多边形面积（m²），坐标数组首尾不闭合亦可 */
function ringArea(ring) {
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[(i + 1) % ring.length]
    total += (lng2 - lng1) * D2R * (2 + Math.sin(lat1 * D2R) + Math.sin(lat2 * D2R))
  }
  return Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2)
}

const round = (v, n = 6) => Number(v.toFixed(n))
const roundRing = (ring) => ring.map(([lng, lat]) => [round(lng), round(lat)])
const roundLine = (line) => line.map(([lng, lat]) => [round(lng, 5), round(lat, 5)])

/* ------------------------------------------------------------------ */
/* 1. 河道中心线、岸线与河宽                                             */
/*    优先使用真实水系（scripts/data-src/yangtze-water.json，来自 OSM，    */
/*    由 pnpm fetch:water 生成）；缺失时回退到「中心线 + 假定河宽」的       */
/*    示意几何，保证脚本在离线下也能跑通。                                 */
/* ------------------------------------------------------------------ */

const REAL_WATER_FILE = join(__dirname, 'data-src', 'yangtze-water.json')
const realWater = existsSync(REAL_WATER_FILE)
  ? JSON.parse(readFileSync(REAL_WATER_FILE, 'utf8'))
  : null

/** 参与渲染的河流：研究区以长江为主，汉江汇流口是重要地物 */
const RENDERED_RIVERS = ['长江', '汉江']
/** 江心洲（内环）最小面积（km²），碎小内环不出岸线 */
const MIN_ISLAND_KM2 = 0.25
/** 岸线弧段最小长度（米），过滤按左右岸拆分时产生的碎段 */
const MIN_BANK_ARC_M = 500

/** 滩地单元：按滩地高程分带（高程为演示取值） */
const FLOOD_BANDS = [
  { id: 'B1', name: '近岸低滩', inner: 0, outer: 260, elev: 24.0 },
  { id: 'B2', name: '沿江滩地', inner: 260, outer: 640, elev: 25.5 },
  { id: 'B3', name: '外滩低地', inner: 640, outer: 1150, elev: 27.0 },
  { id: 'B4', name: '堤内洼地', inner: 1150, outer: 1750, elev: 28.5 }
]

/** 示意分支的中心线控制点（上游 → 下游，自西南向东北） */
const CENTERLINE_CONTROL = [
  [113.9, 30.215], // 新滩口（上游入口）
  [113.975, 30.245], // 汉南
  [114.032, 30.272], // 纱帽
  [114.09, 30.318], // 军山
  [114.152, 30.383], // 沌口
  [114.199, 30.443], // 白沙洲上游
  [114.2315, 30.4932], // 白沙洲长江大桥
  [114.2494, 30.5152], // 杨泗港长江大桥
  [114.2774, 30.5337], // 鹦鹉洲长江大桥
  [114.2829, 30.5521], // 武汉长江大桥
  [114.286, 30.571], // 汉江口（龙王庙）
  [114.32, 30.601], // 二七长江大桥
  [114.39, 30.652], // 天兴洲
  [114.468, 30.668], // 天兴洲下游
  [114.55, 30.682], // 阳逻长江大桥
  [114.63, 30.731], // 白浒山
  [114.7, 30.782] // 下游出口
]

/** 示意分支的河宽（半宽，米）随流程变化：城区段较窄，天兴洲段最宽 */
const HALF_WIDTH_PROFILE = [
  [0.0, 350],
  [0.14, 420],
  [0.28, 500],
  [0.42, 600],
  [0.55, 700],
  [0.66, 1050],
  [0.78, 880],
  [0.9, 700],
  [1.0, 650]
]

function profileValue(profile, t) {
  if (t <= profile[0][0]) return profile[0][1]
  for (let i = 1; i < profile.length; i++) {
    if (t <= profile[i][0]) {
      const [t0, v0] = profile[i - 1]
      const [t1, v1] = profile[i]
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)
    }
  }
  return profile[profile.length - 1][1]
}

/** 示意分支的河宽函数 */
function schematicHalfWidthAt(index, total) {
  return profileValue(HALF_WIDTH_PROFILE, total <= 1 ? 0 : index / (total - 1))
}

/** 沿折线按法向偏移生成一侧边线 */
function offsetEdge(line, side, widthAt) {
  return line.map((p, i) => {
    const hw = widthAt(i, line.length)
    const prev = line[Math.max(0, i - 1)]
    const next = line[Math.min(line.length - 1, i + 1)]
    const dx = (next[0] - prev[0]) * Math.cos(p[1] * D2R)
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * side
    const ny = (dx / len) * side
    return [p[0] + metersToLng(hw * nx, p[1]), p[1] + metersToLat(hw * ny)]
  })
}

/** 折线裁到研究区范围：保留最长的一段连续区间 */
function clipLineToStudyArea(line) {
  const inside = ([lng, lat]) =>
    lng >= STUDY_AREA.west && lng <= STUDY_AREA.east && lat >= STUDY_AREA.south && lat <= STUDY_AREA.north
  const runs = []
  let current = []
  for (const p of line) {
    if (inside(p)) current.push(p)
    else if (current.length) {
      runs.push(current)
      current = []
    }
  }
  if (current.length) runs.push(current)
  return runs.sort((a, b) => b.length - a.length)[0] ?? []
}

/** 折线方向统一为「上游 → 下游」（研究区自西南流向东北） */
function orientDownstream(line) {
  if (line.length < 2) return line
  const first = line[0][0] + line[0][1]
  const last = line[line.length - 1][0] + line[line.length - 1][1]
  return first <= last ? line : line.slice().reverse()
}

/** 点在环内（射线法） */
function pointInRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** 点是否在水面内（外环内、且不在江心洲的内环里） */
function pointInWater(pt, polygons) {
  return polygons.some(
    (polygon) => pointInRing(pt, polygon.outer) && !polygon.holes.some((h) => pointInRing(pt, h))
  )
}

/** 折线按法向等距偏移（side: 1 左法向 / -1 右法向） */
function offsetPolyline(line, distanceM, side) {
  return line.map((p, i) => {
    const prev = line[Math.max(0, i - 1)]
    const next = line[Math.min(line.length - 1, i + 1)]
    const dx = (next[0] - prev[0]) * Math.cos(p[1] * D2R)
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    return [
      p[0] + metersToLng((-dy / len) * side * distanceM, p[1]),
      p[1] + metersToLat((dx / len) * side * distanceM)
    ]
  })
}

/** 点到折线的最近点（逐段投影，比取最近顶点精确得多） */
function nearestOnPolyline(pt, line) {
  if (!line?.length) return null
  const kx = 111320 * Math.cos(pt[1] * D2R)
  const ky = 111320
  let best = line[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - pt[0]) * kx
    const ay = (line[i - 1][1] - pt[1]) * ky
    const bx = (line[i][0] - pt[0]) * kx
    const by = (line[i][1] - pt[1]) * ky
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const k = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0
    const d = Math.hypot(ax + dx * k, ay + dy * k)
    if (d < bestDistance) {
      bestDistance = d
      best = [pt[0] + (ax + dx * k) / kx, pt[1] + (ay + dy * k) / ky]
    }
  }
  return best
}

/**
 * 去掉外扩线上的回折点
 * 凹岸处按法向偏移超过曲率半径时，偏移线会折回去自己压自己（自交）。
 * 逐轮删除造成回折的顶点，可把外圈整形成简单折线；
 * 滩地内圈不做处理，保证与岸线严格贴合。
 */
function removeReversals(line, passes = 4) {
  let points = line
  for (let pass = 0; pass < passes; pass++) {
    if (points.length < 4) break
    const out = [points[0]]
    for (let i = 1; i < points.length - 1; i++) {
      const a = out[out.length - 1]
      const b = points[i]
      const c = points[i + 1]
      const v1 = [b[0] - a[0], b[1] - a[1]]
      const v2 = [c[0] - b[0], c[1] - b[1]]
      const dot = v1[0] * v2[0] + v1[1] * v2[1]
      const len1 = Math.hypot(v1[0], v1[1])
      const len2 = Math.hypot(v2[0], v2[1])
      // 夹角超过约 100°，判定为回折，丢掉中间点
      if (len1 > 0 && len2 > 0 && dot / (len1 * len2) < -Math.cos((80 * Math.PI) / 180)) continue
      out.push(b)
    }
    out.push(points[points.length - 1])
    if (out.length === points.length) break
    points = out
  }
  return points
}

/**
 * 把水面的外环按主轴拆成两条岸线
 * 河段是"细长条带"形，沿主轴投影的两个极值点就是河道的两端，
 * 在两端切开就得到左右两条岸线。
 * @returns {Number[][][]} 两条岸线
 */
function splitRingByAxis(outer) {
  const ring = outer.length > 1 ? outer.slice(0, -1) : outer
  if (ring.length < 8) return []
  const lat0 = ring.reduce((sum, p) => sum + p[1], 0) / ring.length
  const kx = 111320 * Math.cos(lat0 * D2R)
  const pts = ring.map(([lng, lat]) => [lng * kx, lat * 111320])
  const cx = pts.reduce((sum, p) => sum + p[0], 0) / pts.length
  const cy = pts.reduce((sum, p) => sum + p[1], 0) / pts.length

  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const [x, y] of pts) {
    const dx = x - cx
    const dy = y - cy
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ex = [Math.cos(theta), Math.sin(theta)]

  let indexA = 0
  let indexB = 0
  let minValue = Number.POSITIVE_INFINITY
  let maxValue = Number.NEGATIVE_INFINITY
  pts.forEach(([x, y], i) => {
    const v = (x - cx) * ex[0] + (y - cy) * ex[1]
    if (v < minValue) {
      minValue = v
      indexA = i
    }
    if (v > maxValue) {
      maxValue = v
      indexB = i
    }
  })
  const start = Math.min(indexA, indexB)
  const end = Math.max(indexA, indexB)
  return [ring.slice(start, end + 1), [...ring.slice(end), ...ring.slice(0, start + 1)]]
}

/**
 * 由两条岸线配对生成中心线
 * 比直接用 OSM 的 waterway=river 折线可靠：那条线在汊道、分汇流处会分叉，
 * 拼起来会来回横跳，据此外扩的滩地单元会离岸很远。
 * @returns {{points: Number[][], widths: Number[]}}
 */
function centerlineFromBanks(bankA, bankB, stepM = 200) {
  // 两岸方向对齐：以 A 岸起点为准，让 B 岸从同一端开始
  const alignedB =
    haversine(bankA[0], bankB[0]) <= haversine(bankA[0], bankB[bankB.length - 1])
      ? bankB
      : bankB.slice().reverse()
  const a = resample(bankA, stepM)
  const b = resample(alignedB, stepM)
  // 按相对里程逐点配对（不是取最近点）：两岸同一位置的连线才是过水断面。
  // 用最近点配对时，河道弯曲处会把上游的点配到下游岸上，中心线会跑到水面外
  const count = Math.max(8, Math.round(Math.max(lineLength(a), lineLength(b)) / stepM))
  const points = []
  const widths = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1)
    const p = pointAt(a, t)
    const q = pointAt(b, t)
    points.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2])
    widths.push(haversine(p, q))
  }
  return { points, widths }
}

/** 岸线相对中心线的侧别（以水流方向为准，叉积为正即左岸） */
function bankSide(arc, line) {
  const p = arc[Math.floor(arc.length / 2)]
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < line.length; i++) {
    const d = haversine(p, line[i])
    if (d < bestDistance) {
      bestDistance = d
      bestIndex = i
    }
  }
  const back = line[Math.max(0, bestIndex - 1)]
  const ahead = line[Math.min(line.length - 1, bestIndex + 1)]
  const fx = (ahead[0] - back[0]) * Math.cos(p[1] * D2R)
  const fy = ahead[1] - back[1]
  const vx = (p[0] - line[bestIndex][0]) * Math.cos(p[1] * D2R)
  const vy = p[1] - line[bestIndex][1]
  return fx * vy - fy * vx >= 0 ? '左岸' : '右岸'
}

/**
 * 按端点连通性把河段串成链，返回最长的一条
 * 河段之间的断口（分汇流、未测绘段）不能硬接：直接按坐标排序后拼接，
 * 会把与主河道断开的上游河段排到最前面，站点里程整体向上游偏移
 * （实测武汉关水位站偏 20 km，就是这个原因）。
 */
function chainSegments(segments, toleranceM = 3000) {
  let chains = segments.map((segment) => ({ segments: [segment], points: segment.points.slice() }))
  const distance = (a, b) => haversine(a, b)
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < chains.length; i++) {
      for (let j = i + 1; j < chains.length; j++) {
        const a = chains[i]
        const b = chains[j]
        const aHead = a.points[0]
        const aTail = a.points[a.points.length - 1]
        const bHead = b.points[0]
        const bTail = b.points[b.points.length - 1]
        const options = [
          { gap: distance(aTail, bHead), points: a.points.concat(b.points) },
          { gap: distance(aTail, bTail), points: a.points.concat(b.points.slice().reverse()) },
          { gap: distance(aHead, bTail), points: b.points.concat(a.points) },
          { gap: distance(aHead, bHead), points: b.points.slice().reverse().concat(a.points) }
        ]
        const best = options.reduce((min, item) => (item.gap < min.gap ? item : min), {
          gap: Number.POSITIVE_INFINITY
        })
        if (best.gap <= toleranceM) {
          chains[i] = { segments: [...a.segments, ...b.segments], points: best.points }
          chains.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }
  return chains.sort((a, b) => lineLength(b.points) - lineLength(a.points))
}

let centerline
/** 河道定位函数：t(0~1，上游→下游) → [lng, lat] */
let pointOnRiver
/** 滩地成环函数：(内边界距岸,m) (外边界距岸,m) (侧: 1 左岸 / -1 右岸) → 闭合环数组 */
let buildBandRings
const waterFeatures = []
const shorelineFeatures = []

if (realWater) {
  /* ---------------- 真实水系分支（OSM） ---------------- */
  const rivers = realWater.rivers ?? []
  const mainRiver = rivers.find((r) => r.name.includes('长江')) ?? rivers[0]
  const renderedRivers = rivers.filter((r) => RENDERED_RIVERS.some((n) => r.name.includes(n)))

  /**
   * 逐段处理河道：每个水面外环按主轴拆成两岸，再由两岸配对得到本段中心线。
   * 不使用 OSM 的 waterway=river 折线，也不跨段硬拼中心线 —— 分汇流处
   * OSM 中心线会分叉、河段之间本来就有断口，硬拼会在陆地上拉出假河道。
   */
  const keyOf = (line) => line.reduce((sum, p) => sum + p[0] + p[1], 0) / line.length

  function buildSegment(polygon) {
    const banks = splitRingByAxis(polygon.outer)
    if (banks.length < 2) return null
    const middle = centerlineFromBanks(banks[0], banks[1], 200)
    if (middle.points.length < 2) return null
    const points = orientDownstream(middle.points)
    return { polygon, banks, points, key: keyOf(points), length: lineLength(points) }
  }

  const riverSegments = new Map()
  for (const river of renderedRivers) {
    riverSegments.set(
      river.name,
      river.polygons
        .map(buildSegment)
        .filter(Boolean)
        .sort((a, b) => a.key - b.key)
    )
  }
  const mainSegments = riverSegments.get(mainRiver.name) ?? []
  console.log(
    `  河道分段：${[...riverSegments.entries()].map(([n, s]) => `${n} ${s.length} 段`).join('、')}`
  )

  for (const river of renderedRivers) {
    for (const polygon of river.polygons) {
      waterFeatures.push({
        type: 'Feature',
        properties: {
          id: polygon.id,
          name: `${river.name}水域面`,
          category: 'water',
          river: river.name,
          area_km2: polygon.areaKm2,
          source: 'OpenStreetMap（ODbL 1.0）',
          note: '真实水系数据，WGS-84'
        },
        geometry: {
          type: 'Polygon',
          coordinates: [roundRing(polygon.outer), ...polygon.holes.map(roundRing)]
        }
      })

      // 江心洲：内环单独成线，让天兴洲这类江心洲在水面上显出来
      polygon.holes.forEach((hole, index) => {
        const areaKm2 = ringArea(hole) / 1e6
        if (areaKm2 < MIN_ISLAND_KM2) return
        shorelineFeatures.push({
          type: 'Feature',
          properties: {
            id: `${polygon.id}-ISLAND-${index}`,
            name: `江心洲（${areaKm2.toFixed(1)} km²）`,
            category: 'shoreline',
            river: river.name,
            bank: '江心洲',
            area_km2: Number(areaKm2.toFixed(3)),
            source: 'OpenStreetMap（ODbL 1.0）'
          },
          geometry: { type: 'LineString', coordinates: roundLine(hole) }
        })
      })
    }
  }

  // 岸线：按河段拆出的左右岸，逐段成要素
  for (const river of renderedRivers) {
    for (const segment of riverSegments.get(river.name) ?? []) {
      for (const arc of segment.banks) {
        const points = orientDownstream(arc)
        if (lineLength(points) < MIN_BANK_ARC_M) continue
        const side = bankSide(points, segment.points)
        shorelineFeatures.push({
          type: 'Feature',
          properties: {
            id: `${segment.polygon.id}-${side === '左岸' ? 'L' : 'R'}-${shorelineFeatures.length}`,
            name: `${river.name}${side}`,
            category: 'shoreline',
            river: river.name,
            bank: side,
            source: 'OpenStreetMap（ODbL 1.0）'
          },
          geometry: { type: 'LineString', coordinates: roundLine(points) }
        })
      }
    }
  }

  /* 河道分段结构（连通链）在这里统计一次，便于数据出问题时快速定位 */
  const mainPolygons = mainRiver.polygons.map((p) => ({ outer: p.outer, holes: p.holes }))
  const chains = chainSegments(mainSegments)
  const mainChain = chains[0]
  console.log(
    `  长江河段 ${mainSegments.length} 段 → 连通链 ${chains.length} 条，主链 ` +
      `${mainChain.segments.length} 段 / ${(lineLength(mainChain.points) / 1000).toFixed(1)} km`
  )
  const studyReach = clipLineToStudyArea(mainChain.points)
  console.log(`  研究区主河道里程 ${(lineLength(studyReach) / 1000).toFixed(1)} km`)

  /**
   * 各河水域面（含长江与汉江），供站点锚点投影使用：
   * 锚点 → 该河水面边界上最近的点。河名用于跨河断面（宗关在汉江上）。
   */
  const allPolygonSets = renderedRivers.map((river) => ({
    name: river.name,
    polygons: river.polygons.map((p) => ({ outer: p.outer, holes: p.holes }))
  }))

  /**
   * 站点点位：把锚点投到真实水域面的边界上。
   * 水文站本来就在岸边设站，这样比投到派生中心线稳得多 ——
   * 中心线在汊道、大弯处会有几十米到几公里的偏移，而边界是权威数据。
   */
  pointOnRiver = (anchor, riverName) => {
    const mainSet = allPolygonSets.find((item) => item.name === mainRiver.name) ?? allPolygonSets[0]
    const polygons = riverName
      ? allPolygonSets.find((item) => item.name === riverName)?.polygons ?? mainSet.polygons
      : mainSet.polygons
    let best = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const polygon of polygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        const candidate = nearestOnPolyline(anchor, ring)
        if (!candidate) continue
        const d = haversine(anchor, candidate)
        if (d < bestDistance) {
          bestDistance = d
          best = candidate
        }
      }
    }
    return best ?? anchor
  }

  /**
   * 滩地单元：逐河段沿真实岸线向外偏移。
   * 不把各河段岸线拼成一条再外扩 —— 河段之间的断口会让环自己绕回去
   * （实测拼接后每环 8~35 处自交），分段成环则每个环都是简单多边形。
   * 内圈从岸边 0 m 起算，因此最近一圈严格贴在真实岸线上。
   */
  const bankArcs = { 左岸: [], 右岸: [] }
  for (const segment of mainSegments) {
    for (const arc of segment.banks) {
      const points = clipLineToStudyArea(orientDownstream(arc))
      if (points.length < 2 || lineLength(points) < MIN_BANK_ARC_M) continue
      bankArcs[bankSide(points, segment.points)].push(points)
    }
  }
  buildBandRings = (innerM, outerM, side) =>
    bankArcs[side >= 0 ? '左岸' : '右岸'].map((arc) => {
      // 内圈保持与真实岸线严格一致；外圈做一次轻度平滑，
      const inner = offsetPolyline(arc, innerM, side)
      const outer = removeReversals(offsetPolyline(arc, outerM, side))
      return [...inner, ...[...outer].reverse(), inner[0]]
    })
} else {
  /* ---------------- 示意几何分支（回退用） ---------------- */
  console.warn('  ! 未找到 scripts/data-src/yangtze-water.json，水域面与岸线使用示意几何')
  console.warn('    需要真实水系时先执行：pnpm fetch:water')

  centerline = resample(CENTERLINE_CONTROL, 400)
  // 回退分支同样按锚点投影：站点落在示意中心线上
  pointOnRiver = (anchor) => {
    let best = centerline[0]
    let bestDistance = Number.POSITIVE_INFINITY
    for (const p of centerline) {
      const d = haversine(anchor, p)
      if (d < bestDistance) {
        bestDistance = d
        best = p
      }
    }
    return best
  }
  buildBandRings = (innerM, outerM, side) => {
    const inner = offsetEdge(centerline, side, (i, total) => schematicHalfWidthAt(i, total) + innerM)
    const outer = offsetEdge(centerline, side, (i, total) => schematicHalfWidthAt(i, total) + outerM)
    return [[...inner, ...[...outer].reverse(), inner[0]]]
  }

  const leftBank = offsetEdge(centerline, 1, schematicHalfWidthAt)
  const rightBank = offsetEdge(centerline, -1, schematicHalfWidthAt)

  waterFeatures.push({
    type: 'Feature',
    properties: {
      id: 'WATER-LINE',
      name: '长江武汉段水域面（示意）',
      category: 'water',
      note: '示意简化数据，由中心线按河宽偏移生成'
    },
    geometry: {
      type: 'Polygon',
      coordinates: [roundRing([...leftBank, ...[...rightBank].reverse(), leftBank[0]])]
    }
  })

  shorelineFeatures.push(
    {
      type: 'Feature',
      properties: { id: 'SHORE-LEFT', name: '长江左岸（示意）', category: 'shoreline', bank: '左岸' },
      geometry: { type: 'LineString', coordinates: roundLine(leftBank) }
    },
    {
      type: 'Feature',
      properties: { id: 'SHORE-RIGHT', name: '长江右岸（示意）', category: 'shoreline', bank: '右岸' },
      geometry: { type: 'LineString', coordinates: roundLine(rightBank) }
    }
  )
}

/* ------------------------------------------------------------------ */
/* 2. 淹没单元（按滩地高程分带，真实面积在生成时算好）                      */
/* ------------------------------------------------------------------ */

const floodFeatures = []
for (const band of FLOOD_BANDS) {
  for (const side of [1, -1]) {
    const rings = buildBandRings(band.inner, band.outer, side)
    if (!rings.length) continue
    const areaKm2 = Number((rings.reduce((sum, ring) => sum + ringArea(ring), 0) / 1e6).toFixed(3))
    floodFeatures.push({
      type: 'Feature',
      properties: {
        id: `${band.id}-${side === 1 ? 'L' : 'R'}`,
        band: band.id,
        name: band.name,
        bank: side === 1 ? '左岸（北岸）' : '右岸（南岸）',
        elev_wusong_m: band.elev,
        area_km2: areaKm2,
        segmentCount: rings.length
      },
      // 多河段：每个河段一个环，用 MultiPolygon，避免跨河段的假连线
      geometry:
        rings.length === 1
          ? { type: 'Polygon', coordinates: [roundRing(rings[0])] }
          : { type: 'MultiPolygon', coordinates: rings.map((ring) => [roundRing(ring)]) }
    })
  }
}

/* ------------------------------------------------------------------ */
/* 3. 站点（水位站 / 水质站 / 雨量站）                                    */
/* ------------------------------------------------------------------ */

const WATER_LEVEL_STATIONS = [
  { id: 'WL01', name: '纱帽水位站', at: [114.032, 30.272], base: 24.6, warn: 26.80, amp: 5.1, lag: 0, district: '汉南区' },
  { id: 'WL02', name: '沌口水位站', at: [114.152, 30.383], base: 24.4, warn: 26.90, amp: 5.0, lag: 1, district: '蔡甸区' },
  { id: 'WL03', name: '金口水位站', at: [114.1, 30.3], base: 24.2, warn: 26.90, amp: 4.8, lag: 1, district: '江夏区' },
  { id: 'WL04', name: '白沙洲水位站', at: [114.2315, 30.4932], base: 24.1, warn: 27.00, amp: 4.7, lag: 2, district: '洪山区' },
  { id: 'WL05', name: '汉阳水位站', at: [114.2774, 30.5337], base: 24.0, warn: 27.10, amp: 4.6, lag: 2, district: '汉阳区' },
  { id: 'WL06', name: '汉口（武汉关）水位站', at: [114.286, 30.571], base: 23.9, warn: 27.30, amp: 4.5, lag: 3, district: '江汉区' },
  { id: 'WL07', name: '天兴洲水位站', at: [114.39, 30.652], base: 23.7, warn: 27.00, amp: 4.35, lag: 4, district: '青山（化工）区' },
  { id: 'WL08', name: '阳逻水位站', at: [114.55, 30.682], base: 23.5, warn: 26.80, amp: 4.1, lag: 5, district: '新洲区' }
]

/**
 * 站点锚点：站点所在河段的真实位置（公开地名与桥梁位置整理，均为 WGS-84）。
 * 生成时把锚点投影到该河的真实河道中心线水上点上，因此：
 *   站点始终落在水面内，且不会因为标志物缺失而漂到别的河段。
 * river 字段用于跨河断面：宗关在汉江上，必须在汉江上取点。
 */
const WATER_QUALITY_STATIONS = [
  { id: 'WQ01', name: '杨泗港断面', at: [114.2494, 30.5152], grade: 2, district: '汉阳区' },
  { id: 'WQ02', name: '白沙洲断面', at: [114.205, 30.455], grade: 2, district: '洪山区' },
  { id: 'WQ03', name: '龙王庙断面', at: [114.289, 30.573], grade: 2, district: '江汉区' },
  // 宗关在汉江上（汉江汇入长江之前），锚点按真实水系北岸边核定
  { id: 'WQ04', name: '宗关（汉江）断面', at: [114.19, 30.588], river: '汉江', grade: 3, district: '硚口区' },
  { id: 'WQ05', name: '天兴洲断面', at: [114.4, 30.66], grade: 2, district: '青山区' },
  { id: 'WQ06', name: '滠水河口断面', at: [114.375, 30.695], grade: 3, district: '新洲区' },
  // 白浒山在长江南岸，取真实水系南岸边位置（原手写控制点偏北约 8 km，已按真实水系核定）
  { id: 'WQ07', name: '白浒山断面', at: [114.6, 30.56], grade: 2, district: '青山区' }
]

const RAIN_STATIONS = [
  { id: 'RG01', name: '汉口雨量站', lng: 114.283, lat: 30.612, district: '江汉区' },
  { id: 'RG02', name: '汉阳雨量站', lng: 114.218, lat: 30.556, district: '汉阳区' },
  { id: 'RG03', name: '武昌雨量站', lng: 114.316, lat: 30.546, district: '武昌区' },
  { id: 'RG04', name: '青山雨量站', lng: 114.404, lat: 30.635, district: '青山区' },
  { id: 'RG05', name: '洪山雨量站', lng: 114.343, lat: 30.506, district: '洪山区' },
  { id: 'RG06', name: '蔡甸雨量站', lng: 114.029, lat: 30.582, district: '蔡甸区' },
  { id: 'RG07', name: '江夏雨量站', lng: 114.315, lat: 30.376, district: '江夏区' },
  { id: 'RG08', name: '黄陂雨量站', lng: 114.375, lat: 30.882, district: '黄陂区' },
  { id: 'RG09', name: '新洲雨量站', lng: 114.801, lat: 30.841, district: '新洲区' }
]

const stations = []

for (const s of WATER_LEVEL_STATIONS) {
  const p = pointOnRiver(s.at, s.river)
  stations.push({
    type: 'Feature',
    properties: {
      id: s.id,
      name: s.name,
      category: 'waterLevel',
      categoryName: '水位站',
      district: s.district,
      unit: 'm',
      variable: '水位',
      warnWusong: s.warn,
      baseWusong: s.base,
      datum: '吴淞高程',
      anchor: s.at.map((v) => round(v, 5)),
      note: '点位由所在河段锚点投到真实水域面边界（岸边设站）'
    },
    geometry: { type: 'Point', coordinates: [round(p[0]), round(p[1])] }
  })
}

for (const s of WATER_QUALITY_STATIONS) {
  const p = pointOnRiver(s.at, s.river)
  stations.push({
    type: 'Feature',
    properties: {
      id: s.id,
      name: s.name,
      category: 'waterQuality',
      categoryName: '水质站',
      district: s.district,
      unit: '类',
      variable: '水质类别',
      baseGrade: s.grade,
      anchor: s.at.map((v) => round(v, 5)),
      note: '点位由所在河段锚点投到真实水域面边界（岸边设站）'
    },
    geometry: { type: 'Point', coordinates: [round(p[0]), round(p[1])] }
  })
}

for (const s of RAIN_STATIONS) {
  stations.push({
    type: 'Feature',
    properties: {
      id: s.id,
      name: s.name,
      category: 'rain',
      categoryName: '雨量站',
      district: s.district,
      unit: 'mm',
      variable: '小时雨量'
    },
    geometry: { type: 'Point', coordinates: [round(s.lng), round(s.lat)] }
  })
}

/* ------------------------------------------------------------------ */
/* 4. 时序数据（96 小时降雨—洪水过程，模拟生成）                          */
/* ------------------------------------------------------------------ */

const STEP_HOURS = 96
const START_TIME = Date.UTC(2025, 6, 18, 0, 0, 0) // 2025-07-18T00:00Z = 08:00 北京时间

function makeRandom(seed) {
  let state = seed * 2654435761
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

/**
 * 降雨量级标定
 * 96 小时面雨量累计标定到 180 mm 左右、雨峰约 9 mm/h，相当于武汉一次区域性暴雨过程。
 * 标定前累计达 668 mm、雨峰 35 mm/h，接近年均降水量（约 1300 mm）的一半且强度明显失真。
 */
const RAIN_SCALE = 0.27

/** 降雨过程：主雨峰在第 30~44 小时 */
function rainAt(hour, rand) {
  const peaks = [
    { center: 26, width: 5, amp: 7 },
    { center: 36, width: 6, amp: 26 },
    { center: 44, width: 7, amp: 11 }
  ]
  let v = 0
  for (const p of peaks) v += p.amp * Math.exp(-((hour - p.center) ** 2) / (2 * p.width ** 2))
  v *= (0.9 + rand() * 0.2) * RAIN_SCALE
  // 0.1 mm 为雨量计分辨率，小于该值记为无降水
  return v < 0.1 ? 0 : Number(v.toFixed(1))
}

const timestamps = []
for (let i = 0; i < STEP_HOURS; i++) {
  timestamps.push(new Date(START_TIME + i * 3600 * 1000).toISOString())
}

// 全市平均降雨过程（用于驱动水位响应）
const basinRain = timestamps.map((_, i) => rainAt(i, makeRandom(7)))

/** 单位线：把降雨卷积成流量/水位响应（简化 Nash 瞬时单位线） */
function convolve(rain, k = 9, n = 3) {
  const out = new Array(rain.length).fill(0)
  for (let t = 0; t < rain.length; t++) {
    let acc = 0
    for (let s = 0; s <= t; s++) {
      const dt = t - s
      const u = dt <= 0 ? 0 : (dt ** (n - 1) * Math.exp(-dt / k)) / (k ** n * factorial(n - 1))
      acc += rain[s] * u
    }
    out[t] = acc
  }
  return out
}

function factorial(n) {
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}

const unitResponse = convolve(basinRain, 6, 3)
const peakResponse = Math.max(...unitResponse) || 1
const response = unitResponse.map((v) => v / peakResponse) // 0~1 的相对响应

const stationSeries = {}

for (const s of WATER_LEVEL_STATIONS) {
  const rand = makeRandom(s.id.charCodeAt(2) + 11)
  // 洪水传播：上游先涨、下游后涨，本河段洪峰传播时间约 0~5 小时（lag = 下游滞后小时数）
  const lag = s.lag ?? 0
  // 涨水幅度（米）：上游受顶托与回水影响更大，逐站递减；洪峰高程 = base + amp
  const amplitude = s.amp ?? 4.5
  const level = []
  const flow = []
  for (let i = 0; i < STEP_HOURS; i++) {
    const idx = Math.min(STEP_HOURS - 1, Math.max(0, i - lag))
    const r = response[idx]
    const wusong = s.base + amplitude * r + (rand() - 0.5) * 0.06
    level.push(Number(wusong.toFixed(2)))
    // 水位—流量关系曲线（幂函数 Q = a·(H - H0)^b），演示站点定线成果的表达
    const depth = Math.max(0.5, wusong - 18)
    flow.push(Math.round(600 * depth ** 2))
  }
  stationSeries[s.id] = { waterLevel: level, flow }
}

for (const s of WATER_QUALITY_STATIONS) {
  const rand = makeRandom(s.id.charCodeAt(2) + 23)
  const turbidity = []
  const ph = []
  const dissolvedOxygen = []
  const grade = []
  for (let i = 0; i < STEP_HOURS; i++) {
    const r = response[i]
    turbidity.push(Number((28 + 145 * r + (rand() - 0.5) * 8).toFixed(1)))
    ph.push(Number((7.9 - 0.5 * r + (rand() - 0.5) * 0.12).toFixed(2)))
    dissolvedOxygen.push(Number((8.6 - 1.9 * r + (rand() - 0.5) * 0.25).toFixed(2)))
    grade.push(Math.min(5, s.grade + (r > 0.55 ? 1 : 0)))
  }
  stationSeries[s.id] = { turbidity, ph, dissolvedOxygen, grade }
}

for (const s of RAIN_STATIONS) {
  const rand = makeRandom(s.id.charCodeAt(2) + 37)
  // 单站雨量在面雨量基础上按位置加权（城区偏多、远郊偏少），夹到合理区间
  const scale = Math.min(1.6, Math.max(0.6, 0.65 + ((s.lng - 114.0) * 1.4 + (s.lat - 30.5) * 1.1)))
  const rain = basinRain.map((v) => Number((v * scale + rand() * 0.3).toFixed(1)))
  stationSeries[s.id] = { rain, cumulative: cumulative(rain) }
}

function cumulative(arr) {
  let acc = 0
  return arr.map((v) => Number((acc += v).toFixed(1)))
}

/* ------------------------------------------------------------------ */
/* 5. 跨江桥梁（复用本地公开整理数据）                                    */
/* ------------------------------------------------------------------ */

function readBridges() {
  const file = join(sourceDir, 'Wuhan_bridge.json')
  if (!existsSync(file)) return null
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  return raw.features.map((f, i) => ({
    type: 'Feature',
    properties: {
      id: `BR${String(i + 1).padStart(2, '0')}`,
      name: f.properties?.name ?? `跨江桥梁${i + 1}`,
      category: 'bridge',
      categoryName: '跨江桥梁',
      length_m: Math.round(lineLength(f.geometry.coordinates)),
      summary: (f.properties?.info ?? '').slice(0, 180)
    },
    geometry: { type: 'LineString', coordinates: roundLine(f.geometry.coordinates) }
  }))
}

/* ------------------------------------------------------------------ */
/* 6. 主干道（从本地路网数据中筛选并抽稀）                                 */
/* ------------------------------------------------------------------ */

const MAIN_ROAD_TYPES = new Set(['motorway', 'trunk', 'primary'])

function simplifyLine(coords, maxPoints = 24) {
  if (coords.length <= maxPoints) return coords
  const step = (coords.length - 1) / (maxPoints - 1)
  const out = []
  for (let i = 0; i < maxPoints; i++) out.push(coords[Math.round(i * step)])
  return out
}

function readMainRoads(limit = 800) {
  const file = join(sourceDir, 'Wuhan_roads.json')
  if (!existsSync(file)) return null
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const kept = raw.features
    .filter((f) => f.geometry?.type === 'LineString' && MAIN_ROAD_TYPES.has(f.properties?.type))
    .sort((a, b) => b.geometry.coordinates.length - a.geometry.coordinates.length)
    .slice(0, limit)
  return kept.map((f, i) => ({
    type: 'Feature',
    properties: {
      id: `RD${String(i + 1).padStart(4, '0')}`,
      name: f.properties?.name || '未命名道路',
      category: 'road',
      roadType: f.properties?.type,
      ref: f.properties?.ref || ''
    },
    geometry: { type: 'LineString', coordinates: roundLine(simplifyLine(f.geometry.coordinates)) }
  }))
}

/* ------------------------------------------------------------------ */
/* 7. 输出                                                              */
/* ------------------------------------------------------------------ */

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

function writeJson(name, data) {
  const file = join(outDir, name)
  writeFileSync(file, JSON.stringify(data), 'utf8')
  const kb = (Buffer.byteLength(JSON.stringify(data)) / 1024).toFixed(1)
  console.log(`  ${name.padEnd(26)} ${kb} KB`)
}

const fc = (features) => ({ type: 'FeatureCollection', features })

console.log('生成时空数据 ...')

writeJson('water.geojson', fc(waterFeatures))
writeJson('shoreline.geojson', fc(shorelineFeatures))

writeJson('flood-bands.geojson', fc(floodFeatures))
writeJson('stations.geojson', fc(stations))

const bridges = readBridges()
if (bridges) writeJson('bridges.geojson', fc(bridges))
else console.warn('  ! 未找到桥梁数据源，跳过 bridges.geojson（可从公开数据补充）')

const roads = readMainRoads()
if (roads) writeJson('roads-main.geojson', fc(roads))
else console.warn('  ! 未找到路网数据源，跳过 roads-main.geojson')

writeJson('series.json', {
  generatedAt: new Date().toISOString(),
  stepHours: 1,
  timestamps,
  series: stationSeries,
  basinRain
})

writeJson('meta.json', {
  name: '长江武汉段三维时空数据可视化平台 - 演示数据',
  generatedAt: new Date().toISOString(),
  disclaimer: realWater
    ? '本数据集为演示用途：水域面与岸线取自 OpenStreetMap 真实水系（ODbL 1.0），滩地淹没单元仍为示意几何，时序数据为按水文规律模拟生成，不作为任何决策依据。'
    : '本数据集为演示用途：水域面、岸线与滩地单元均为示意简化几何，时序数据为按水文规律模拟生成，不作为任何决策依据。',
  spatialSources: {
    water: realWater
      ? 'OpenStreetMap 水系（natural=water + water=river），WGS-84，ODbL 1.0'
      : '示意简化几何（中心线按河宽偏移）',
    shoreline: realWater ? '由 OSM 水域面按中心线拆分左右岸' : '示意简化几何',
    floodBands: '示意单元：沿真实岸线向外分带（内圈贴岸），高程为演示取值'
  },
  elevationDatum: {
    analysis: '吴淞高程（站点水位、滩地高程、警戒水位均采用此基准）',
    render: '三维渲染时按固定偏移量转换为场景高程，见 src/config/scene.js 的 DATUM_OFFSET_M'
  },
  variables: {
    waterLevel: { unit: 'm', name: '水位', datum: '吴淞高程' },
    flow: { unit: 'm³/s', name: '流量' },
    rain: { unit: 'mm', name: '小时雨量' },
    turbidity: { unit: 'NTU', name: '浊度' },
    ph: { unit: '', name: 'pH' },
    dissolvedOxygen: { unit: 'mg/L', name: '溶解氧' },
    grade: { unit: '类', name: '水质类别' }
  },
  featureCounts: {
    water: waterFeatures.length,
    shoreline: shorelineFeatures.length,
    floodBands: floodFeatures.length,
    stations: stations.length,
    bridges: bridges ? bridges.length : 0,
    mainRoads: roads ? roads.length : 0
  }
})

const bandArea = floodFeatures.reduce((acc, f) => acc + f.properties.area_km2, 0)
const waterArea = waterFeatures.reduce((acc, f) => acc + (f.properties.area_km2 ?? 0), 0)
console.log(
  `\n完成。水域面 ${waterFeatures.length} 个（合计 ${waterArea.toFixed(1)} km²）、岸线 ${shorelineFeatures.length} 条、` +
    `滩地单元 ${floodFeatures.length} 个（合计 ${bandArea.toFixed(1)} km²），时间序列 ${STEP_HOURS} 小时 × ${stations.length} 个站点。`
)
console.log(
  realWater
    ? '数据来源：水域面与岸线为 OpenStreetMap 真实水系（ODbL 1.0），滩地单元仍为示意几何。'
    : '提示：当前为示意几何，执行 pnpm fetch:water 可取真实水系替换。'
)
