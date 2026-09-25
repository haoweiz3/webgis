/**
 * 坐标纠偏回归校核脚本
 * ------------------------------------------------------------------
 * 校验 src/core/cesium/gcj02.js 与 gcjTilingScheme.js 两件事：
 *   1. GCJ-02 ↔ WGS-84 互转的精度（往返误差应远小于一个像素）；
 *   2. 高德瓦片纠偏后的贴图偏差 —— 按「瓦片像素」衡量，
 *      逐层级检查残差 < 0.5 px，并检查相邻瓦片不留缝、点位被覆盖。
 *
 * 数据口径变化或 Cesium 升级后跑一遍：pnpm verify:gcj02
 */
import * as Cesium from 'cesium'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { gcj02ToWgs84, wgs84ToGcj02, gcj02Offset } = require('../src/core/cesium/gcj02.js')
const { gcj02TilingScheme } = require('../src/core/cesium/gcjTilingScheme.js')

const plain = new Cesium.WebMercatorTilingScheme()
const fixed = gcj02TilingScheme()
const projection = fixed.projection
const D2R = Math.PI / 180

const metersBetween = (a, b) => {
  const dLat = (b[1] - a[1]) * 111320
  const dLng = (b[0] - a[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * D2R)
  return Math.hypot(dLat, dLng)
}

let failures = 0
const check = (label, ok, detail) => {
  if (!ok) failures++
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? '  → ' + detail : ''}`)
}

/* --- 1. 三角函数往返精度 --- */
console.log('== 1. GCJ-02 ↔ WGS-84 往返精度 ==')
for (const [name, lng, lat] of [
  ['武汉长江大桥', 114.2829, 30.5521],
  ['天兴洲', 114.39, 30.652],
  ['纱帽', 114.032, 30.272]
]) {
  const [gLng, gLat] = wgs84ToGcj02(lng, lat)
  const [backLng, backLat] = gcj02ToWgs84(gLng, gLat)
  const err = metersBetween([lng, lat], [backLng, backLat])
  check(`${name} 往返误差`, err < 0.01, err.toExponential(2) + ' m')
}
const tokyo = gcj02ToWgs84(139.7, 35.7)
check('境外点保持原样', tokyo[0] === 139.7 && tokyo[1] === 35.7, `${tokyo[0]}, ${tokyo[1]}`)

/* --- 2. 武汉段偏移量 --- */
console.log('\n== 2. 高德(GCJ-02) 相对 WGS-84 的偏移（纠偏要消掉的就是这个量）==')
for (const [name, lng, lat] of [
  ['新滩口（上游）', 113.9, 30.215],
  ['白沙洲', 114.2315, 30.4932],
  ['武汉长江大桥', 114.2829, 30.5521],
  ['天兴洲', 114.39, 30.652],
  ['阳逻（下游）', 114.55, 30.682]
]) {
  const o = gcj02Offset(lng, lat)
  console.log(
    `  ${name.padEnd(14, ' ')} 偏移 ${o.distance.toFixed(1)} m，方位 ${o.bearing.toFixed(1)}°`
  )
}

/* --- 3. 核心指标：影像内容落在哪里 vs 点位真实位置 --- */
console.log('\n== 3. 贴图残差（影像内容位置 - 真实位置），越小越准 ==')
const points = [
  ['新滩口', 113.9, 30.215],
  ['沌口', 114.152, 30.383],
  ['武汉长江大桥', 114.2829, 30.5521],
  ['天兴洲', 114.39, 30.652],
  ['阳逻', 114.55, 30.682],
  ['偏移区内陆点', 114.5, 30.35]
]
const levels = [6, 10, 14, 18]

function residual(scheme, useCorrection, lng, lat, level) {
  const [gLng, gLat] = wgs84ToGcj02(lng, lat)
  const tile = useCorrection
    ? scheme.positionToTileXY(Cesium.Cartographic.fromDegrees(lng, lat), level)
    : scheme.positionToTileXY(Cesium.Cartographic.fromDegrees(gLng, gLat), level)

  const gcjNative = Cesium.WebMercatorTilingScheme.prototype.tileXYToNativeRectangle.call(
    plain,
    tile.x,
    tile.y,
    level
  )
  const shownNative = useCorrection
    ? scheme.tileXYToNativeRectangle(tile.x, tile.y, level)
    : gcjNative

  const gcjMeters = projection.project(Cesium.Cartographic.fromDegrees(gLng, gLat))
  const u = (gcjMeters.x - gcjNative.west) / gcjNative.width
  const v = (gcjNative.north - gcjMeters.y) / gcjNative.height

  const drawn = new Cesium.Cartesian2(
    shownNative.west + u * shownNative.width,
    shownNative.north - v * shownNative.height
  )
  const drawnCarto = projection.unproject(drawn)
  const meters = metersBetween(
    [lng, lat],
    [Cesium.Math.toDegrees(drawnCarto.longitude), Cesium.Math.toDegrees(drawnCarto.latitude)]
  )
  // 折合成瓦片像素：一个瓦片 256 px 平铺在该层级的瓦片跨度上
  const metersPerPixel = gcjNative.width / 256
  return { meters, pixels: meters / metersPerPixel, metersPerPixel }
}

for (const level of levels) {
  const rows = points.map(([name, lng, lat]) => ({
    name,
    before: residual(plain, false, lng, lat, level),
    after: residual(fixed, true, lng, lat, level)
  }))
  console.log(`  —— 层级 ${level}（1 px ≈ ${rows[0].before.metersPerPixel.toFixed(1)} m）——`)
  for (const r of rows) {
    console.log(
      `    ${r.name.padEnd(14, ' ')} 纠偏前 ${r.before.meters.toFixed(1).padStart(7, ' ')} m (${r.before.pixels.toFixed(2).padStart(6, ' ')} px)` +
        `  →  纠偏后 ${r.after.meters.toFixed(2).padStart(6, ' ')} m (${r.after.pixels.toFixed(3)} px)`
    )
  }
  const worst = Math.max(...rows.map((r) => r.after.pixels))
  check(`层级 ${level} 纠偏后最大残差 < 0.5 px`, worst < 0.5, worst.toFixed(3) + ' px')
  const minBefore = Math.min(...rows.map((r) => r.before.meters))
  check(`层级 ${level} 纠偏前残差本就很大`, minBefore > 400, minBefore.toFixed(1) + ' m')
  // 低层级本来就看不出（不到 1 px），纠偏在 level ≥ 10 才有肉眼意义
  const minBeforePx = Math.min(...rows.map((r) => r.before.pixels))
  const visible = level >= 10 ? minBeforePx > 0.5 : minBeforePx > 0.2
  check(`层级 ${level} 纠偏前偏差与层级相符`, visible, minBeforePx.toFixed(2) + ' px')
}

/* --- 4. 瓦片索引必须落在高德自己的网格里 --- */
console.log('\n== 4. 瓦片索引一致性（决定 {x}/{y}/{z} 取到的是不是正确内容）==')
for (const level of [12, 18]) {
  for (const [name, lng, lat] of points) {
    const [gLng, gLat] = wgs84ToGcj02(lng, lat)
    const a = fixed.positionToTileXY(Cesium.Cartographic.fromDegrees(lng, lat), level)
    const b = plain.positionToTileXY(Cesium.Cartographic.fromDegrees(gLng, gLat), level)
    check(
      `层级 ${level} ${name} 索引一致`,
      a.x === b.x && a.y === b.y,
      `纠偏方案 (${a.x},${a.y}) vs 高德网格 (${b.x},${b.y})`
    )
  }
}

/* --- 5. 相邻瓦片不留缝 + 点位被显示范围覆盖 --- */
console.log('\n== 5. 覆盖检查：相邻瓦片是否留缝、点位是否被覆盖 ==')
for (const level of [14, 18]) {
  const tile = fixed.positionToTileXY(Cesium.Cartographic.fromDegrees(114.2829, 30.5521), level)
  const self = fixed.tileXYToNativeRectangle(tile.x, tile.y, level)
  const nextX = fixed.tileXYToNativeRectangle(tile.x + 1, tile.y, level)
  const nextY = fixed.tileXYToNativeRectangle(tile.x, tile.y + 1, level)
  const gapX = nextX.west - self.east
  const gapY = self.south - nextY.north
  console.log(`  层级 ${level} 东侧邻接差 ${gapX.toFixed(2)} m，南侧邻接差 ${gapY.toFixed(2)} m（≤0 表示重叠）`)
  check(`层级 ${level} 横向不留缝`, gapX <= 0.01)
  check(`层级 ${level} 纵向不留缝`, gapY <= 0.01)

  const geo = fixed.tileXYToRectangle(tile.x, tile.y, level)
  const contains =
    Cesium.Math.toDegrees(geo.west) <= 114.2829 &&
    114.2829 <= Cesium.Math.toDegrees(geo.east) &&
    Cesium.Math.toDegrees(geo.south) <= 30.5521 &&
    30.5521 <= Cesium.Math.toDegrees(geo.north)
  check(`层级 ${level} 显示范围覆盖点位`, contains)
}

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项未通过'}`)
process.exit(failures === 0 ? 0 : 1)
