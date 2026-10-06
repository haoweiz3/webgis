/**
 * 脊线判据的分层校核
 * ------------------------------------------------------------------
 * 问题：用"OSM 堤线命中率"评价脊线检测其实不严谨——
 *   放宽查询后抓进来大量 `embankment=yes` 的内陆道路堤，它们本来就不靠河，
 *   混在一起会把命中率压低，指标失去意义。
 * 做法：把 OSM 堤线的每个顶点按「到水面边界的距离」分档，
 *   再看各档的脊线命中率 —— 靠河的堤应当命中率高，内陆路堤应当低。
 *
 * 运行：pnpm verify:ridge
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataSrc = join(__dirname, 'data-src')

const meta = JSON.parse(readFileSync(join(dataSrc, 'dem-grid.json'), 'utf8'))
const { cols, rows, west, south, cellDeg } = meta.grid
const ridge = new Uint8Array(readFileSync(join(dataSrc, 'levees-dem-raw.bin')).buffer)
const water = JSON.parse(readFileSync(join(dataSrc, 'yangtze-water.json'), 'utf8'))
const levees = JSON.parse(readFileSync(join(dataSrc, 'levees-osm.json'), 'utf8'))

const waterPoints = water.rivers.flatMap((river) =>
  river.polygons.flatMap((polygon) => polygon.outer)
)

const D2R = Math.PI / 180
const meters = (a, b) => {
  const dLat = (b[1] - a[1]) * 111320
  const dLng = (b[0] - a[0]) * 111320 * Math.cos((((a[1] + b[1]) / 2) * D2R))
  return Math.hypot(dLat, dLng)
}

const BANDS = [
  { label: '≤ 500 m', max: 500 },
  { label: '500~1000 m', max: 1000 },
  { label: '1000~1500 m', max: 1500 },
  { label: '1500~2000 m', max: 2000 },
  { label: '> 2000 m（多为内陆路堤）', max: Infinity }
]
const stats = BANDS.map(() => ({ total: 0, hit: 0 }))

for (const element of levees.elements ?? []) {
  const geometry = element.geometry ?? []
  for (let i = 1; i < geometry.length; i++) {
    const [a, b] = [geometry[i - 1], geometry[i]]
    const steps = Math.max(
      Math.abs(Math.round((b.lon - a.lon) / cellDeg)),
      Math.abs(Math.round((b.lat - a.lat) / cellDeg)),
      1
    )
    for (let k = 0; k <= steps; k++) {
      const lng = a.lon + ((b.lon - a.lon) * k) / steps
      const lat = a.lat + ((b.lat - a.lat) * k) / steps
      const col = Math.round((lng - west) / cellDeg - 0.5)
      const row = Math.round((lat - south) / cellDeg - 0.5)
      if (row < 0 || row >= rows || col < 0 || col >= cols) continue

      let nearest = Infinity
      for (const p of waterPoints) {
        const d = meters([lng, lat], p)
        if (d < nearest) nearest = d
        if (nearest < 200) break
      }
      const band = stats[BANDS.findIndex((item) => nearest <= item.max)]
      band.total++
      if (ridge[row * cols + col]) band.hit++
    }
  }
}

console.log('OSM 堤线顶点按「到水面距离」分档，看脊线命中率：')
console.log('  距离分档'.padEnd(30, ' ') + '样本数'.padStart(9) + '命中数'.padStart(9) + '命中率'.padStart(9))
let failures = 0
stats.forEach((item, index) => {
  const rate = item.total ? item.hit / item.total : 0
  console.log(
    `  ${BANDS[index].label.padEnd(28, ' ')}${String(item.total).padStart(9)}${String(item.hit).padStart(9)}` +
      `${(rate * 100).toFixed(1).padStart(8)}%`
  )
})
const near = stats[0]
const nearRate = near.total ? near.hit / near.total : 0
const far = stats[4]
const farRate = far.total ? far.hit / far.total : 0
const check = (label, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  → ' + detail : ''}`)
}
console.log('')
check('500 m 内的堤线命中率高于 40%', nearRate > 0.4, (nearRate * 100).toFixed(1) + '%')
check(
  '靠河段命中率高于内陆段（说明判据确实在抓"堤"）',
  nearRate > farRate,
  `靠河 ${(nearRate * 100).toFixed(1)}% vs 内陆 ${(farRate * 100).toFixed(1)}%`
)
console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项未通过'}`)
process.exit(failures === 0 ? 0 : 1)
