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
/* 1. 长江武汉段中心线（上游 → 下游，自西南向东北）                        */
/* ------------------------------------------------------------------ */

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

/** 河宽（半宽，米）随流程变化：城区段较窄，天兴洲段最宽 */
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

const centerline = resample(CENTERLINE_CONTROL, 400)

/** 河宽沿线数组（半宽，米），逐点记录便于偏移 */
function halfWidthAt(index, total) {
  return profileValue(HALF_WIDTH_PROFILE, total <= 1 ? 0 : index / (total - 1))
}

function channelEdge(side) {
  return centerline.map((p, i) => {
    const hw = halfWidthAt(i, centerline.length)
    const prev = centerline[Math.max(0, i - 1)]
    const next = centerline[Math.min(centerline.length - 1, i + 1)]
    const dx = (next[0] - prev[0]) * Math.cos(p[1] * D2R)
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * side
    const ny = (dx / len) * side
    return [p[0] + metersToLng(hw * nx, p[1]), p[1] + metersToLat(hw * ny)]
  })
}

const leftBank = channelEdge(1)
const rightBank = channelEdge(-1)
const waterRing = roundRing([...leftBank, ...[...rightBank].reverse(), leftBank[0]])

/* ------------------------------------------------------------------ */
/* 2. 淹没单元（按滩地高程分带，真实面积在生成时算好）                      */
/* ------------------------------------------------------------------ */

const FLOOD_BANDS = [
  { id: 'B1', name: '近岸低滩', inner: 0, outer: 260, elev: 24.0 },
  { id: 'B2', name: '沿江滩地', inner: 260, outer: 640, elev: 25.5 },
  { id: 'B3', name: '外滩低地', inner: 640, outer: 1150, elev: 27.0 },
  { id: 'B4', name: '堤内洼地', inner: 1150, outer: 1750, elev: 28.5 }
]

function bandEdge(distanceM, side) {
  return centerline.map((p, i) => {
    const hw = halfWidthAt(i, centerline.length) + distanceM
    const prev = centerline[Math.max(0, i - 1)]
    const next = centerline[Math.min(centerline.length - 1, i + 1)]
    const dx = (next[0] - prev[0]) * Math.cos(p[1] * D2R)
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * side
    const ny = (dx / len) * side
    return [p[0] + metersToLng(hw * nx, p[1]), p[1] + metersToLat(hw * ny)]
  })
}

const floodFeatures = []
for (const band of FLOOD_BANDS) {
  for (const side of [1, -1]) {
    const inner = bandEdge(band.inner, side)
    const outer = bandEdge(band.outer, side)
    const ring = roundRing([...inner, ...[...outer].reverse(), inner[0]])
    floodFeatures.push({
      type: 'Feature',
      properties: {
        id: `${band.id}-${side === 1 ? 'L' : 'R'}`,
        band: band.id,
        name: band.name,
        bank: side === 1 ? '左岸（北岸）' : '右岸（南岸）',
        elev_wusong_m: band.elev,
        area_km2: Number((ringArea(ring) / 1e6).toFixed(3))
      },
      geometry: { type: 'Polygon', coordinates: [ring] }
    })
  }
}

/* ------------------------------------------------------------------ */
/* 3. 站点（水位站 / 水质站 / 雨量站）                                    */
/* ------------------------------------------------------------------ */

const WATER_LEVEL_STATIONS = [
  { id: 'WL01', name: '纱帽水位站', t: 0.07, base: 24.6, warn: 26.80, district: '汉南区' },
  { id: 'WL02', name: '沌口水位站', t: 0.2, base: 24.4, warn: 26.90, district: '蔡甸区' },
  { id: 'WL03', name: '金口水位站', t: 0.31, base: 24.2, warn: 26.90, district: '江夏区' },
  { id: 'WL04', name: '白沙洲水位站', t: 0.42, base: 24.1, warn: 27.00, district: '洪山区' },
  { id: 'WL05', name: '汉阳水位站', t: 0.52, base: 24.0, warn: 27.10, district: '汉阳区' },
  { id: 'WL06', name: '汉口（武汉关）水位站', t: 0.58, base: 23.9, warn: 27.30, district: '江汉区' },
  { id: 'WL07', name: '天兴洲水位站', t: 0.71, base: 23.7, warn: 27.00, district: '青山（化工）区' },
  { id: 'WL08', name: '阳逻水位站', t: 0.88, base: 23.5, warn: 26.80, district: '新洲区' }
]

const WATER_QUALITY_STATIONS = [
  { id: 'WQ01', name: '杨泗港断面', t: 0.47, grade: 2, district: '汉阳区' },
  { id: 'WQ02', name: '白沙洲断面', t: 0.4, grade: 2, district: '洪山区' },
  { id: 'WQ03', name: '龙王庙断面', t: 0.57, grade: 2, district: '江汉区' },
  { id: 'WQ04', name: '宗关（汉江）断面', t: 0.56, grade: 3, district: '硚口区', lngShift: -0.012, latShift: 0.014 },
  { id: 'WQ05', name: '天兴洲断面', t: 0.7, grade: 2, district: '青山区' },
  { id: 'WQ06', name: '滠水河口断面', t: 0.8, grade: 3, district: '新洲区', lngShift: 0.004, latShift: 0.036 },
  { id: 'WQ07', name: '白浒山断面', t: 0.92, grade: 2, district: '青山区' }
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
  const p = pointAt(centerline, s.t)
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
      datum: '吴淞高程'
    },
    geometry: { type: 'Point', coordinates: [round(p[0]), round(p[1])] }
  })
}

for (const s of WATER_QUALITY_STATIONS) {
  const p = pointAt(centerline, s.t)
  const shifted = [
    p[0] + (s.lngShift || 0),
    p[1] + (s.latShift || 0)
  ]
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
      baseGrade: s.grade
    },
    geometry: { type: 'Point', coordinates: [round(shifted[0]), round(shifted[1])] }
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

/** 降雨过程：主雨峰在第 30~44 小时 */
function rainAt(hour, rand) {
  const peaks = [
    { center: 26, width: 5, amp: 7 },
    { center: 36, width: 6, amp: 26 },
    { center: 44, width: 7, amp: 11 }
  ]
  let v = 0
  for (const p of peaks) v += p.amp * Math.exp(-((hour - p.center) ** 2) / (2 * p.width ** 2))
  v *= 0.9 + rand() * 0.2
  return v < 0.2 ? 0 : Number(v.toFixed(1))
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
  const lag = Math.round((0.07 - s.t) * 6) // 上游略早、下游略晚
  const amplitude = 5.2 - s.t * 1.2
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
  const scale = 0.65 + ((s.lng - 114.0) * 1.4 + (s.lat - 30.5) * 1.1)
  const rain = basinRain.map((v) => Number((v * Math.max(0.35, scale) + rand() * 0.6).toFixed(1)))
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

writeJson('water.geojson', fc([
  {
    type: 'Feature',
    properties: {
      id: 'WATER-LINE',
      name: '长江武汉段水域面',
      category: 'water',
      note: '示意简化数据，由中心线按河宽偏移生成'
    },
    geometry: { type: 'Polygon', coordinates: [waterRing] }
  }
]))

writeJson('shoreline.geojson', fc([
  {
    type: 'Feature',
    properties: { id: 'SHORE-LEFT', name: '长江左岸（北岸）岸线', category: 'shoreline', bank: '左岸' },
    geometry: { type: 'LineString', coordinates: roundRing(leftBank) }
  },
  {
    type: 'Feature',
    properties: { id: 'SHORE-RIGHT', name: '长江右岸（南岸）岸线', category: 'shoreline', bank: '右岸' },
    geometry: { type: 'LineString', coordinates: roundRing(rightBank) }
  }
]))

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
  disclaimer: '本数据集为演示用途：水域面与滩地单元为示意简化几何，时序数据为按水文规律模拟生成，不作为任何决策依据。',
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
    water: 1,
    shoreline: 2,
    floodBands: floodFeatures.length,
    stations: stations.length,
    bridges: bridges ? bridges.length : 0,
    mainRoads: roads ? roads.length : 0
  }
})

const bandArea = floodFeatures.reduce((acc, f) => acc + f.properties.area_km2, 0)
console.log(`\n完成。滩地单元合计面积 ${bandArea.toFixed(1)} km²，时间序列 ${STEP_HOURS} 小时 × ${stations.length} 个站点。`)
console.log('提示：水域面与滩地为示意简化几何，可通过替换 OSM / 天地图水系数据提升精度。')
