/**
 * 堤防取数脚本（OpenStreetMap / Overpass）
 * ------------------------------------------------------------------
 * 用途：为栅格法淹没分析提供「堤线屏障」。
 * 口径说明（重要）：OSM 里只有堤的**位置**，没有任何一条带 height/ele
 *   （研究区内实测 0/146），所以堤顶高程无法从这里获得。
 *   因此本脚本只提供"不可穿越的堤线"，用于给出淹没范围的**下界**；
 *   上界仍是不考虑堤防的连通淹没。真实值落在两者之间。
 *
 * 输出：scripts/data-src/levees-osm.json（原始要素，供栅格化）
 * 运行：pnpm fetch:levees
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, join } from 'node:path'
import { STUDY_AREA } from '../src/config/scene.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataSrc = join(__dirname, 'data-src')
const outFile = join(dataSrc, 'levees-osm.json')
const forceRefresh = process.argv.includes('--refresh')

const MARGIN = 0.02
const bbox = [
  (STUDY_AREA.south - MARGIN).toFixed(4),
  (STUDY_AREA.west - MARGIN).toFixed(4),
  (STUDY_AREA.north + MARGIN).toFixed(4),
  (STUDY_AREA.east + MARGIN).toFixed(4)
].join(',')

const QUERY = `[out:json][timeout:180];
(
  way["man_made"="embankment"](${bbox});
  way["man_made"="dyke"](${bbox});
  way["barrier"="dyke"](${bbox});
  way["barrier"="embankment"](${bbox});
  way["embankment"="yes"](${bbox});
  way["embankment"="levee"](${bbox});
);
out geom;`

if (!forceRefresh && existsSync(outFile)) {
  const cached = JSON.parse(readFileSync(outFile, 'utf8'))
  console.log(`使用缓存 ${outFile}（${cached.elements?.length ?? 0} 个要素）`)
  process.exit(0)
}

const ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter'
]

let data = null
for (const endpoint of ENDPOINTS) {
  try {
    process.stdout.write(`请求 ${endpoint} … `)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'webgis-yangtze-demo/0.1 (levee extraction for a local demo)'
      },
      body: 'data=' + encodeURIComponent(QUERY),
      signal: AbortSignal.timeout(180000)
    })
    if (!res.ok) {
      console.log(`HTTP ${res.status}`)
      continue
    }
    const text = await res.text()
    data = JSON.parse(text)
    console.log(`成功，元素 ${data.elements?.length ?? 0}`)
    break
  } catch (err) {
    console.log(`失败：${err.message}`)
  }
}

if (!data) {
  console.error('所有端点都不可用')
  process.exit(1)
}

if (!existsSync(dataSrc)) mkdirSync(dataSrc, { recursive: true })
writeFileSync(
  outFile,
  JSON.stringify(
    {
      source: 'OpenStreetMap（ODbL 1.0）',
      note: '只有堤线位置、没有堤顶高程（0/146 带 height）；用于不可穿越屏障',
      generatedAt: new Date().toISOString(),
      elements: data.elements
    },
    null,
    0
  ),
  'utf8'
)
console.log(`已写出 ${outFile}`)
