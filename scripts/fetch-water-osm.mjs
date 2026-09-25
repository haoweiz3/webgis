/**
 * 真实水系取数脚本（OpenStreetMap / Overpass API）
 * ------------------------------------------------------------------
 * 用途：把长江武汉段（含汉江汇流段）的真实水域面取回来，替换掉原先
 *       「中心线 + 假定河宽」生成的示意几何，让岸线能贴住影像里的岸边。
 *
 * 输出：scripts/data-src/yangtze-water.json
 *       中间成果，只含几何（外环 + 内环/江心洲），
 *       由 scripts/build-data.mjs 进一步派生出水域面、岸线、滩地单元与站点。
 *
 * 数据来源与许可：OpenStreetMap 贡献者，ODbL 1.0。
 *   本项目的坐标口径是 WGS-84，OSM 原生即为 WGS-84，无需任何转换。
 *
 * 运行：pnpm fetch:water
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const outDir = join(__dirname, 'data-src')
const outFile = join(outDir, 'yangtze-water.json')
/** 原始响应缓存：重复运行不必再次请求公共接口（加 --refresh 强制重新抓取） */
const rawCacheFile = join(outDir, 'raw-osm-water.json')

const D2R = Math.PI / 180
const EARTH_RADIUS = 6371008.8

/** 取数范围：比研究区略大一圈，保证河段在边界处完整 */
const FETCH_BBOX = { south: 30.02, west: 113.68, north: 30.96, east: 114.96 }
/** 裁剪范围：裁掉取数范围外的冗余，控制数据量 */
const CLIP_BBOX = { south: 30.12, west: 113.78, north: 30.88, east: 114.82 }
/** 保留面积门槛（km²）：滤掉池塘、港湾等零碎水体 */
const MIN_AREA_KM2 = 0.8
/** 抽稀容差（米）：12 m 在演示的观察距离下看不出与原岸线的差别 */
const SIMPLIFY_TOLERANCE_M = 12
/** 拼接环时端点匹配容差（度） */
const RING_JOIN_EPSILON = 1e-6

const ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
]

const USER_AGENT =
  'webgis-yangtze-demo/0.1 (OSM water extraction for a local non-commercial demo project)'

/* ------------------------------------------------------------------ */
/* 几何工具                                                            */
/* ------------------------------------------------------------------ */

function ringAreaM2(ring) {
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[(i + 1) % ring.length]
    total += (lng2 - lng1) * D2R * (2 + Math.sin(lat1 * D2R) + Math.sin(lat2 * D2R))
  }
  return Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2)
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

/** 以第一个点为基准，把经纬度换算成米（近似），供距离判断使用 */
function toLocalMeters(ring) {
  const lat0 = ring[0][1]
  const kx = 111320 * Math.cos(lat0 * D2R)
  const ky = 111320
  return ring.map(([lng, lat]) => [(lng - ring[0][0]) * kx, (lat - lat0) * ky])
}

/** Douglas–Peucker 抽稀（按米计算，闭合环绕过首尾） */
function simplifyRing(ring, toleranceM) {
  if (!ring || ring.length < 4) return []
  const pts = ring.slice()
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) pts.pop()
  if (pts.length <= 4) return ring

  const meters = toLocalMeters(pts)
  const keep = new Array(pts.length).fill(false)
  keep[0] = true
  keep[pts.length - 1] = true

  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()
    const [x1, y1] = meters[start]
    const [x2, y2] = meters[end]
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    let maxDist = -1
    let index = -1
    for (let i = start + 1; i < end; i++) {
      const [px, py] = meters[i]
      const dist =
        len === 0
          ? Math.hypot(px - x1, py - y1)
          : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len
      if (dist > maxDist) {
        maxDist = dist
        index = i
      }
    }
    if (maxDist > toleranceM && index > 0) {
      keep[index] = true
      stack.push([start, index], [index, end])
    }
  }

  const out = pts.filter((_, i) => keep[i])
  out.push(out[0])
  return out
}

/** Sutherland–Hodgman 裁剪（裁剪窗口是矩形，属凸多边形，方法适用） */
function clipRingToBbox(ring, bbox) {
  const edges = [
    { inside: (p) => p[0] >= bbox.west, intersect: (a, b) => [bbox.west, a[1] + ((b[1] - a[1]) * (bbox.west - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= bbox.east, intersect: (a, b) => [bbox.east, a[1] + ((b[1] - a[1]) * (bbox.east - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= bbox.south, intersect: (a, b) => [a[0] + ((b[0] - a[0]) * (bbox.south - a[1])) / (b[1] - a[1]), bbox.south] },
    { inside: (p) => p[1] <= bbox.north, intersect: (a, b) => [a[0] + ((b[0] - a[0]) * (bbox.north - a[1])) / (b[1] - a[1]), bbox.north] }
  ]

  let output = ring.slice()
  for (const edge of edges) {
    const input = output
    output = []
    for (let i = 0; i < input.length; i++) {
      const current = input[i]
      const previous = input[(i + input.length - 1) % input.length]
      const currentInside = edge.inside(current)
      const previousInside = edge.inside(previous)
      if (currentInside) {
        if (!previousInside) output.push(edge.intersect(previous, current))
        output.push(current)
      } else if (previousInside) {
        output.push(edge.intersect(previous, current))
      }
    }
    if (output.length === 0) return []
  }
  return output
}

/** 闭合性判断与去重（相邻顶点过近会退化，抽稀后需要再清理） */
function cleanRing(ring) {
  const out = []
  for (const p of ring) {
    const last = out[out.length - 1]
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) continue
    out.push(p)
  }
  if (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) out.pop()
  }
  if (out.length < 3) return []
  out.push(out[0])
  return out
}

/* ------------------------------------------------------------------ */
/* Overpass 取数与环拼接                                                */
/* ------------------------------------------------------------------ */

const QUERY = `[out:json][timeout:300];
(
  relation["natural"="water"]["water"="river"](${FETCH_BBOX.south},${FETCH_BBOX.west},${FETCH_BBOX.north},${FETCH_BBOX.east});
  way["natural"="water"]["water"="river"](${FETCH_BBOX.south},${FETCH_BBOX.west},${FETCH_BBOX.north},${FETCH_BBOX.east});
  way["waterway"="river"](${FETCH_BBOX.south},${FETCH_BBOX.west},${FETCH_BBOX.north},${FETCH_BBOX.east});
);
out geom;`

async function fetchOverpass() {
  let lastError = null
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        process.stdout.write(`  请求 ${endpoint}（第 ${attempt} 次）… `)
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'User-Agent': USER_AGENT
          },
          body: 'data=' + encodeURIComponent(QUERY),
          signal: AbortSignal.timeout(300000)
        })
        if (!res.ok) {
          console.log(`HTTP ${res.status}`)
          lastError = new Error(`${endpoint} 返回 HTTP ${res.status}`)
          continue
        }
        const text = await res.text()
        const json = JSON.parse(text)
        console.log(`成功，${(text.length / 1024).toFixed(0)} KB，元素 ${json.elements?.length ?? 0}`)
        return json
      } catch (err) {
        console.log(`失败：${err.message}`)
        lastError = err
      }
    }
  }
  throw new Error(`所有 Overpass 端点均不可用：${lastError?.message ?? '未知错误'}`)
}

/** 河流名称归一化：OSM 里长江、汉江的分段命名不统一 */
function normalizeRiverName(tags) {
  if (!tags) return ''
  const name = tags.name ?? tags['name:zh'] ?? ''
  const alt = `${tags.alt_name ?? ''} ${tags['name:zh'] ?? ''} ${tags['name:en'] ?? ''}`
  if (/汉[江水]/.test(name) || /Han River/i.test(alt) || /汉[江水]/.test(alt)) return '汉江'
  if (/长江|Chang Jiang|Yangtze/i.test(name) || /Yangtze|Chang Jiang/i.test(alt)) return '长江'
  return name
}

/** 把若干条成员 way 拼成环或链（闭合的返回环，未闭合的返回链） */
function stitchWays(lines) {
  const pool = lines.filter((line) => line.length >= 2).map((line) => line.slice())
  const chains = []
  const same = (a, b) =>
    Math.abs(a[0] - b[0]) < RING_JOIN_EPSILON && Math.abs(a[1] - b[1]) < RING_JOIN_EPSILON

  while (pool.length) {
    let ring = pool.shift()
    let progress = true
    while (progress) {
      progress = false
      if (same(ring[0], ring[ring.length - 1])) break
      for (let i = 0; i < pool.length; i++) {
        const line = pool[i]
        if (same(ring[ring.length - 1], line[0])) {
          ring = ring.concat(line.slice(1))
        } else if (same(ring[ring.length - 1], line[line.length - 1])) {
          ring = ring.concat(line.slice(0, -1).reverse())
        } else if (same(ring[0], line[line.length - 1])) {
          ring = line.slice(0, -1).concat(ring)
        } else if (same(ring[0], line[0])) {
          ring = line.slice(1).reverse().concat(ring)
        } else {
          continue
        }
        pool.splice(i, 1)
        progress = true
        break
      }
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length >= 4) ring[ring.length - 1] = ring[0]
    chains.push(ring)
  }
  return chains
}

function collectPolygons(elements) {
  const polygons = []
  for (const el of elements) {
    if (el.type === 'way' && el.tags?.waterway === 'river') continue
    if (el.type === 'way') {
      const ring = (el.geometry ?? []).map((p) => [p.lon, p.lat])
      if (ring.length >= 4) {
        const cleaned = cleanRing(ring)
        if (cleaned.length) {
          polygons.push({ osmType: 'way', osmId: el.id, outerRings: [cleaned], innerRings: [] })
        }
      }
      continue
    }

    if (el.type === 'relation') {
      const outerLines = []
      const innerLines = []
      for (const member of el.members ?? []) {
        if (member.type !== 'way' || !member.geometry?.length) continue
        const line = member.geometry.map((p) => [p.lon, p.lat])
        if (member.role === 'inner') innerLines.push(line)
        else outerLines.push(line)
      }
      const outerRings = stitchWays(outerLines).filter(
        (ring) => ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      )
      const innerRings = stitchWays(innerLines).filter(
        (ring) => ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      )
      polygons.push({ osmType: 'relation', osmId: el.id, outerRings, innerRings })
    }
  }
  return polygons
}

/** 折线裁到矩形窗口内，返回最长的一段（河流中心线用） */
function clipLineToBbox(line, bbox) {
  const inside = (p) => p[0] >= bbox.west && p[0] <= bbox.east && p[1] >= bbox.south && p[1] <= bbox.north
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

/** 中心线方向统一为「上游 → 下游」（研究区自西南流向东北） */
function orientDownstream(line) {
  if (line.length < 2) return line
  const first = line[0][0] + line[0][1]
  const last = line[line.length - 1][0] + line[line.length - 1][1]
  return first <= last ? line : line.slice().reverse()
}

/** 收集河流中心线，按名称分组 */
function collectCenterlines(elements, bbox) {
  const groups = new Map()
  for (const el of elements) {
    if (el.type !== 'way' || el.tags?.waterway !== 'river') continue
    const name = normalizeRiverName(el.tags)
    if (!name) continue
    const line = (el.geometry ?? []).map((p) => [p.lon, p.lat])
    if (line.length < 2) continue
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(line)
  }

  const out = new Map()
  for (const [name, ways] of groups) {
    const chains = stitchWays(ways)
      .map((chain) => clipLineToBbox(chain, bbox))
      .filter((chain) => chain.length >= 2)
      .map((chain) => cleanRing(simplifyRing(orientDownstream(chain), 30)))
      .sort((a, b) => b.length - a.length)
    if (chains.length) out.set(name, chains[0])
  }
  return out
}

/** 用中心线给水体重命名：中心线穿过（点在面内）最多的那条河就是它的归属 */
function namePolygon(outer, centerlines) {
  let bestName = ''
  let bestHits = 0
  for (const [name, line] of centerlines) {
    let hits = 0
    for (const p of line) {
      if (pointInRing(p, outer)) hits++
    }
    if (hits > bestHits) {
      bestHits = hits
      bestName = name
    }
  }
  return bestHits > 0 ? bestName : ''
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

const forceRefresh = process.argv.includes('--refresh')
let raw = null
if (!forceRefresh && existsSync(rawCacheFile)) {
  raw = JSON.parse(readFileSync(rawCacheFile, 'utf8'))
  console.log(
    `使用缓存的原始响应 ${rawCacheFile}（元素 ${raw.elements?.length ?? 0}），加 --refresh 可强制重新抓取`
  )
} else {
  console.log('抓取真实水系（OpenStreetMap / Overpass）…')
  raw = await fetchOverpass()
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(rawCacheFile, JSON.stringify(raw), 'utf8')
  console.log(`原始响应已缓存到 ${rawCacheFile}`)
}

console.log('组装河流中心线与水多边形…')
const centerlines = collectCenterlines(raw.elements ?? [], CLIP_BBOX)
const allPolygons = collectPolygons(raw.elements ?? [])
console.log(
  `  中心线：${[...centerlines.entries()].map(([n, l]) => `${n}(${l.length} 点)`).join('、') || '无'}`
)
console.log(`  原始多边形 ${allPolygons.length} 个`)

console.log('裁剪、抽稀、过滤、按河流归组…')
const rivers = new Map()
for (const polygon of allPolygons) {
  const outers = polygon.outerRings
    .map((ring) => clipRingToBbox(ring, CLIP_BBOX))
    .filter((ring) => ring.length >= 4)
    .map((ring) => cleanRing(simplifyRing(ring, SIMPLIFY_TOLERANCE_M)))
    .filter((ring) => ring.length >= 4)

  for (const outer of outers) {
    const areaKm2 = ringAreaM2(outer) / 1e6
    if (areaKm2 < MIN_AREA_KM2) continue
    const holes = polygon.innerRings
      .map((ring) => clipRingToBbox(ring, CLIP_BBOX))
      .filter((ring) => ring.length >= 4)
      .map((ring) => cleanRing(simplifyRing(ring, SIMPLIFY_TOLERANCE_M)))
      .filter((ring) => ring.length >= 4 && pointInRing(ring[0], outer))

    const name = namePolygon(outer, centerlines) || '未命名水体'
    if (!rivers.has(name)) {
      rivers.set(name, { name, areaKm2: 0, polygons: [], centerline: centerlines.get(name) ?? null })
    }
    const river = rivers.get(name)
    river.areaKm2 = Number((river.areaKm2 + areaKm2).toFixed(3))
    river.polygons.push({
      id: `OSM-${polygon.osmType}-${polygon.osmId}`,
      osmType: polygon.osmType,
      osmId: polygon.osmId,
      areaKm2: Number(areaKm2.toFixed(3)),
      outer,
      holes
    })
  }
}

const riverList = [...rivers.values()].sort((a, b) => b.areaKm2 - a.areaKm2)
for (const r of riverList) r.polygons.sort((a, b) => b.areaKm2 - a.areaKm2)

const totalVertices = riverList.reduce(
  (sum, r) =>
    sum +
    (r.centerline?.length ?? 0) +
    r.polygons.reduce((s, p) => s + p.outer.length + p.holes.reduce((t, h) => t + h.length, 0), 0),
  0
)
const totalArea = riverList.reduce((sum, r) => sum + r.areaKm2, 0)

console.log('\n按河流汇总：')
for (const r of riverList) {
  console.log(
    `  ${r.name.padEnd(10, ' ')} 面积 ${String(r.areaKm2).padStart(7, ' ')} km²，` +
      `${r.polygons.length} 个多边形，中心线 ${r.centerline ? r.centerline.length + ' 点' : '无'}，江心洲/内环 ${r.polygons.reduce((s, p) => s + p.holes.length, 0)} 个`
  )
}
console.log(`  合计 ${riverList.length} 条河、${totalVertices} 个顶点、${totalArea.toFixed(1)} km²`)

if (!riverList.length) {
  console.error('没有取到任何水体，未写出文件')
  process.exit(1)
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
writeFileSync(
  outFile,
  JSON.stringify(
    {
      source: 'OpenStreetMap（ODbL 1.0）',
      license: 'ODbL 1.0，© OpenStreetMap contributors',
      generatedAt: new Date().toISOString(),
      fetchBbox: FETCH_BBOX,
      clipBbox: CLIP_BBOX,
      simplifyToleranceM: SIMPLIFY_TOLERANCE_M,
      rivers: riverList
    },
    null,
    0
  ),
  'utf8'
)

const sizeKb = (JSON.stringify(riverList).length / 1024).toFixed(0)
console.log(`\n已写出 ${outFile}（约 ${sizeKb} KB）`)
console.log('下一步：pnpm build:data 会据此重新生成 public/data 下的水域面、岸线、滩地单元与站点。')
