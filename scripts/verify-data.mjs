/**
 * 空间数据体检脚本
 * ------------------------------------------------------------------
 * 检查 public/data 下生成结果的关键不变量，避免"数据看起来生成成功、
 * 实际几何已经坏掉"这类隐性错误：
 *   1. 水域面：环闭合、内环（江心洲）落在外环内、面积与属性一致；
 *   2. 岸线：长江/汉江左右岸是否齐全，江心洲是否成线；
 *   3. 站点：水位站是否落在真实水域面内（中心线定位的直接检验）；
 *   4. 滩地单元：最近的一圈是否贴着真实岸线（示意图元与真实岸线的贴合度）；
 *   5. 桥梁断面：用真实桥梁量过水宽度，与生成的河道宽度对比。
 *
 * 运行：pnpm verify:data
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'public', 'data')
const sourceDir = process.env.SOURCE_DATA_DIR || 'D:/学习/XZD/Part3/smart-city-wuhan/src/assets'

const D2R = Math.PI / 180
const R = 6371008.8
let failures = 0

const check = (label, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  → ' + detail : ''}`)
}
const meters = (a, b) => {
  const dLat = (b[1] - a[1]) * 111320
  const dLng = (b[0] - a[0]) * 111320 * Math.cos((((a[1] + b[1]) / 2) * D2R))
  return Math.hypot(dLat, dLng)
}
const lineLength = (line) => {
  let total = 0
  for (let i = 1; i < line.length; i++) total += meters(line[i - 1], line[i])
  return total
}
function ringAreaM2(ring) {
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[(i + 1) % ring.length]
    total += (lng2 - lng1) * D2R * (2 + Math.sin(lat1 * D2R) + Math.sin(lat2 * D2R))
  }
  return Math.abs((total * R * R) / 2)
}
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
const read = (file) => JSON.parse(readFileSync(join(dataDir, file), 'utf8'))
const readOptional = (file) => {
  try {
    return JSON.parse(readFileSync(join(sourceDir, file), 'utf8'))
  } catch {
    return null
  }
}

/* ---------------- 1. 水域面 ---------------- */
console.log('== 1. 水域面几何 ==')
const water = read('water.geojson')
const waterFeatures = water.features ?? []
check('水域面为 FeatureCollection', water.type === 'FeatureCollection', `${waterFeatures.length} 个面`)

let ringCount = 0
let islandCount = 0
let waterArea = 0
let unclosed = 0
let holesOutside = 0
let areaMismatch = 0
for (const f of waterFeatures) {
  const rings = f.geometry?.coordinates ?? []
  const outer = rings[0] ?? []
  ringCount++
  const closed =
    outer.length > 3 &&
    outer[0][0] === outer[outer.length - 1][0] &&
    outer[0][1] === outer[outer.length - 1][1]
  if (!closed) unclosed++
  const area = ringAreaM2(outer) / 1e6
  waterArea += area
  if (f.properties?.area_km2 && Math.abs(area - f.properties.area_km2) / area > 0.02) areaMismatch++
  for (const hole of rings.slice(1)) {
    islandCount++
    if (!pointInRing(hole[0], outer)) holesOutside++
  }
}
check('所有外环闭合', unclosed === 0, unclosed ? `${unclosed} 个未闭合` : `${ringCount} 个环`)
check('所有内环（江心洲）落在外环内', holesOutside === 0, `${islandCount} 个内环，越界 ${holesOutside}`)
check('属性面积与几何面积一致（误差 < 2%）', areaMismatch === 0, `${areaMismatch} 个不符`)

const named = new Set(waterFeatures.map((f) => f.properties?.river).filter(Boolean))
console.log(`  水体：${[...named].join('、')}；合计 ${waterArea.toFixed(1)} km²，内环 ${islandCount} 个`)

/* ---------------- 2. 岸线 ---------------- */
console.log('\n== 2. 岸线 ==')
const shoreline = read('shoreline.geojson').features ?? []
const byBank = { 左岸: [], 右岸: [], 江心洲: [] }
for (const f of shoreline) {
  const bank = f.properties?.bank
  if (byBank[bank]) byBank[bank].push(f)
}
for (const bank of Object.keys(byBank)) {
  const list = byBank[bank]
  const longest = list.length ? Math.max(...list.map((f) => lineLength(f.geometry.coordinates))) : 0
  const total = list.reduce((sum, f) => sum + lineLength(f.geometry.coordinates), 0)
  console.log(`  ${bank}：${list.length} 段，合计 ${(total / 1000).toFixed(1)} km，最长段 ${(longest / 1000).toFixed(1)} km`)
}
check('左右岸都存在', byBank['左岸'].length > 0 && byBank['右岸'].length > 0)
check('存在江心洲岸线', byBank['江心洲'].length > 0, `${byBank['江心洲'].length} 段`)
const changjiangBanks = shoreline.filter((f) => f.properties?.river === '长江')
check('长江岸线段数合理（≥ 4）', changjiangBanks.length >= 4, `${changjiangBanks.length} 段`)

/* ---------------- 3. 站点是否落在水里 ---------------- */
console.log('\n== 3. 站点定位（锚点投到真实岸线）==')
const stations = read('stations.geojson').features ?? []
const waterLevelStations = stations.filter((f) => f.properties?.category === 'waterLevel')
// 边界点包含外环与内环（江心洲岸线），天兴洲这类断面就落在江心洲岸边
// 边界用"线"来量（抽稀后顶点间距可达百米，量到顶点会虚高）
const waterBoundaryRings = waterFeatures.flatMap((f) => f.geometry.coordinates)
function distanceToBoundary(pt) {
  let nearest = Infinity
  for (const ring of waterBoundaryRings) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]
      const b = ring[i]
      const kx = 111320 * Math.cos(pt[1] * D2R)
      const ky = 111320
      const ax = (a[0] - pt[0]) * kx
      const ay = (a[1] - pt[1]) * ky
      const bx = (b[0] - pt[0]) * kx
      const by = (b[1] - pt[1]) * ky
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy
      const k = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0
      const d = Math.hypot(ax + dx * k, ay + dy * k)
      if (d < nearest) nearest = d
    }
  }
  return nearest
}
let worstStation = { name: '-', distance: 0 }
let worstAnchor = { name: '-', distance: 0 }
for (const station of [...waterLevelStations, ...stations.filter((f) => f.properties?.category === 'waterQuality')]) {
  const [lng, lat] = station.geometry.coordinates
  const nearest = distanceToBoundary([lng, lat])
  if (nearest > worstStation.distance) worstStation = { name: station.properties.name, distance: nearest }
  const anchor = station.properties.anchor
  if (anchor) {
    const gap = meters([lng, lat], anchor)
    if (gap > worstAnchor.distance) worstAnchor = { name: station.properties.name, distance: gap }
  }
}
check(
  '水位站/水质断面都贴在水面岸边（距边界线 < 20 m）',
  worstStation.distance < 20,
  `最大 ${worstStation.distance.toFixed(1)} m（${worstStation.name}）`
)
check(
  '点位与站点锚点一致（不漂到别的河段，< 2 km）',
  worstAnchor.distance < 2000,
  `最大 ${worstAnchor.distance.toFixed(0)} m（${worstAnchor.name}）`
)

/* ---------------- 4. 滩地单元贴合度 ---------------- */
console.log('\n== 4. 滩地单元与真实岸线的贴合度 ==')
const changjiangOuterPoints = waterFeatures
  .filter((f) => f.properties?.river === '长江')
  .flatMap((f) => f.geometry.coordinates[0])
const bands = read('flood-bands.geojson').features ?? []
const nearestBand = bands.filter((f) => f.properties?.band === 'B1')
const sampleDistances = []
for (const band of nearestBand) {
  const rings =
    band.geometry.type === 'MultiPolygon'
      ? band.geometry.coordinates.map((polygon) => polygon[0])
      : [band.geometry.coordinates[0]]
  for (const ring of rings) {
    for (const p of ring) {
      let best = Infinity
      for (const q of changjiangOuterPoints) {
        const d = meters(p, q)
        if (d < best) best = d
      }
      sampleDistances.push(best)
    }
  }
}
sampleDistances.sort((a, b) => a - b)
// B1 环里一半是内圈（贴着岸线）、一半是外圈（再向外 260 m），
// 所以用 25 分位衡量"内圈贴岸"的程度
const p25 = sampleDistances[Math.floor(sampleDistances.length * 0.25)]
const p50 = sampleDistances[Math.floor(sampleDistances.length * 0.5)]
const p75 = sampleDistances[Math.floor(sampleDistances.length * 0.75)]
console.log(
  `  B1 环上各点到真实岸线：25 分位 ${p25.toFixed(1)} m，中位 ${p50.toFixed(1)} m，75 分位 ${p75.toFixed(1)} m`
)
check('最近一圈内圈贴合真实岸线（25 分位 < 80 m）', p25 < 80, `${p25.toFixed(1)} m`)
const bandArea = bands.reduce((sum, f) => sum + (f.properties?.area_km2 ?? 0), 0)
check('滩地单元数量与面积正常', bands.length === 8 && bandArea > 50, `${bands.length} 个，合计 ${bandArea.toFixed(1)} km²`)

/* ---------------- 5. 用真实桥梁量过水宽度 ---------------- */
console.log('\n== 5. 桥梁断面对照（真实桥梁量生成河道）==')
const bridges = readOptional('Wuhan_bridge.json')
if (!bridges) {
  console.log('  未找到桥梁源数据，跳过')
} else {
  const target = bridges.features.find((f) => f.properties.name === '长江大桥')
  if (!target) {
    console.log('  未找到武汉长江大桥，跳过')
  } else {
    const [a, b] = target.geometry.coordinates
    const span = meters(a, b)
    const aIn = waterFeatures.some((f) => pointInRing(a, f.geometry.coordinates[0]))
    const bIn = waterFeatures.some((f) => pointInRing(b, f.geometry.coordinates[0]))
    console.log(
      `  武汉长江大桥主跨 ${span.toFixed(0)} m（公开资料主桥 1155.5 m）；` +
        `两端点是否仍在水域面内：${aIn ? '是' : '否'} / ${bIn ? '是' : '否'}`
    )
    check('主跨两端点不再被水域面覆盖（岸线回到真实岸边）', !aIn && !bIn)
  }
}

/* ---------------- 6. 滩地环自交检查 ---------------- */
console.log('\n== 6. 滩地环自交检查 ==')
function selfIntersections(ring, stride = 4) {
  const pts = ring.filter((_, i) => i % stride === 0)
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const inter = (a, b, c, d) =>
    cross(c, d, a) > 0 !== cross(c, d, b) > 0 && cross(a, b, c) > 0 !== cross(a, b, d) > 0
  let count = 0
  for (let i = 1; i < pts.length; i++) {
    for (let j = i + 2; j < pts.length; j++) {
      if (i === 1 && j === pts.length - 1) continue
      if (inter(pts[i - 1], pts[i], pts[j - 1], pts[j])) count++
    }
  }
  return count
}
const ringsOf = (feature) =>
  feature.geometry.type === 'MultiPolygon'
    ? feature.geometry.coordinates.map((polygon) => polygon[0])
    : [feature.geometry.coordinates[0]]
for (const band of bands) {
  const rings = ringsOf(band)
  const hits = rings.reduce((sum, ring) => sum + selfIntersections(ring), 0)
  const worst = Math.max(...rings.map((ring) => selfIntersections(ring)))
  console.log(
    `  ${band.properties.bank} ${band.properties.name}：${rings.length} 个环，自交 ${hits} 处（单环最多 ${worst}），面积 ${band.properties.area_km2} km²`
  )
}
// 沿真实岸线向外偏移时，凹岸处不可避免会出现少量自交（外扩线打结）。
// 判据取"单环不超过 4 处"：超过这个量级就说明外扩参数或岸线数据出了问题。
const worstRing = Math.max(
  ...bands.flatMap((band) => ringsOf(band).map((ring) => selfIntersections(ring)))
)
check('没有严重自交的滩地环（单环 ≤ 4 处）', worstRing <= 4, `最差单环 ${worstRing} 处`)
const b1 = bands.filter((f) => f.properties.band === 'B1')
const b1Worst = Math.max(...b1.flatMap((band) => ringsOf(band).map((ring) => selfIntersections(ring))))
check('最近一圈（贴岸窄带）折叠轻微（单环 ≤ 2 处）', b1Worst <= 2, `最差单环 ${b1Worst} 处`)

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项未通过'}`)
process.exit(failures === 0 ? 0 : 1)
