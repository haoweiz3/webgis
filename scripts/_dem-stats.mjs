/**
 * 临时探针：统计本地 DEM 格网的高程分布，判断换用本地地形是否能看到起伏。
 * 只读，不改任何数据。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const meta = JSON.parse(readFileSync(join(here, 'data-src/dem-grid.json'), 'utf8'))
const buf = readFileSync(join(here, 'data-src', meta.storage.file))

const { cols, rows, west, south, cellDeg } = meta.grid
const scale = meta.storage.scale
const baseMeters = meta.storageEncoding.baseMeters

function elev(lon, lat) {
  const col = Math.round((lon - west) / cellDeg)
  const row = Math.round((lat - south) / cellDeg)
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null
  const idx = row * cols + col
  const raw = buf.readUInt16LE(idx * 2)
  return raw / scale + baseMeters
}

const values = []
for (let i = 0; i < cols * rows; i += 1) {
  values.push(buf.readUInt16LE(i * 2) / scale + baseMeters)
}
values.sort((a, b) => a - b)
const q = (p) => values[Math.min(values.length - 1, Math.floor(values.length * p))]

console.log('格网：', cols, '×', rows, ' 覆盖 lon', west, '→', (west + cols * cellDeg).toFixed(3), ' lat', south, '→', (south + rows * cellDeg).toFixed(3))
console.log('最小', values[0].toFixed(1), ' 1%分位', q(0.01).toFixed(1), ' 中位', q(0.5).toFixed(1), ' 99%分位', q(0.99).toFixed(1), ' 最大', values[values.length - 1].toFixed(1))
console.log('95% 与 5% 的分位差：', (q(0.95) - q(0.05)).toFixed(1), 'm')

const probes = [
  ['汉口江边（武汉关）', 114.2936, 30.6016],
  ['龟山', 114.2536, 30.5557],
  ['蛇山（黄鹤楼）', 114.3062, 30.5445],
  ['喻家山（华中科大）', 114.3600, 30.5110],
  ['珞珈山（武大）', 114.3620, 30.5370],
  ['后湖', 114.3280, 30.6600],
  ['天兴洲洲头', 114.4200, 30.6300],
  ['阳逻', 114.5600, 30.6600],
  ['长江河道（武汉关断面）', 114.3000, 30.5950]
]
console.log('--- 样点高程（EGM2008，米）---')
for (const [name, lon, lat] of probes) {
  const v = elev(lon, lat)
  console.log(name.padEnd(24, ' '), v === null ? '越界' : v.toFixed(1))
}

// 沿汉口→黄陂方向 30 km 断面，看有没有起伏
console.log('--- 断面：沿 114.29°E，30.55°N → 30.82°N ---')
const line = []
for (let lat = 30.55; lat <= 30.82; lat += 0.02) {
  const v = elev(114.29, lat)
  line.push(v === null ? '—' : v.toFixed(0))
}
console.log(line.join(' '))

// 武汉关一带的方格网：能直接看出长江河道与两岸地面的高差
console.log('--- 武汉关一带网格（行=纬度自北向南，列=经度自西向东，0.01°≈1 km）---')
console.log('        ' + Array.from({ length: 13 }, (_, i) => (114.22 + i * 0.01).toFixed(2).slice(-4)).join(' '))
for (let lat = 30.66; lat >= 30.53; lat -= 0.01) {
  const row = []
  for (let lon = 114.22; lon <= 114.34; lon += 0.01) {
    const v = elev(lon, lat)
    row.push(v === null ? ' -- ' : v.toFixed(0).padStart(4, ' '))
  }
  console.log(lat.toFixed(2) + '  ' + row.join(' '))
}

// 河道水面在 DEM 里的代表值：取长江主河道走廊（114.24~114.44 / 30.50~30.64）的低分位
const channel = []
for (let lat = 30.50; lat <= 30.64; lat += 0.002) {
  for (let lon = 114.24; lon <= 114.44; lon += 0.002) {
    const v = elev(lon, lat)
    if (v !== null) channel.push(v)
  }
}
channel.sort((a, b) => a - b)
console.log('河道走廊低分位：5%', channel[Math.floor(channel.length * 0.05)].toFixed(1),
  ' 25%', channel[Math.floor(channel.length * 0.25)].toFixed(1),
  ' 中位', channel[Math.floor(channel.length * 0.5)].toFixed(1))

// 研究走廊（站点与河道所在范围）的高程分布，用来定色带分级
const corridor = []
for (let lat = 30.25; lat <= 30.80; lat += 0.002) {
  for (let lon = 113.90; lon <= 114.70; lon += 0.002) {
    const v = elev(lon, lat)
    if (v !== null) corridor.push(v)
  }
}
corridor.sort((a, b) => a - b)
const cq = (p) => corridor[Math.min(corridor.length - 1, Math.floor(corridor.length * p))]
console.log('--- 研究走廊 113.9~114.7E / 30.25~30.80N ---')
console.log('最小', corridor[0].toFixed(1), ' 5%', cq(0.05).toFixed(1), ' 中位', cq(0.5).toFixed(1),
  ' 95%', cq(0.95).toFixed(1), ' 99%', cq(0.99).toFixed(1), ' 最大', corridor[corridor.length - 1].toFixed(1))
for (const p of [0.5, 0.8, 0.9, 0.95, 0.98, 0.995, 0.999]) {
  console.log(`  ${(p * 100).toFixed(1)}% 分位 = ${cq(p).toFixed(1)} m`)
}
