/**
 * FABDEM 导入脚本（读取布里斯托发布的 GeoTIFF，提取研究区 100 m 格网）
 * ------------------------------------------------------------------
 * 数据来源：FABDEM V1-2（Hawker et al., University of Bristol），1°×1° 分块，
 *   武汉段在 N30E113 / N30E114 两块内。
 *   FABDEM 的测量源是 Copernicus DEM GLO-30（TanDEM-X 雷达干涉测量），
 *   在此基础上用机器学习去掉建筑与树冠，得到近似裸地的高程。
 *   许可：CC BY-NC-SA 4.0（非商用，需署名）。
 *
 * 用法：
 *   node scripts/import-fabdem.mjs                  体检：列出研究区需要的分块并打印 TIFF 结构
 *   node scripts/import-fabdem.mjs --test-tile=0    解码某个瓦片，检查数值是否合理
 *   node scripts/import-fabdem.mjs --write         提取研究区 → 覆盖 scripts/data-src/dem-grid.*
 *
 * 实测格式（v1-2 分块）：3600×3600、1 弧秒像元、DEFLATE 压缩、
 *   水平差分预测器（predictor 2，按 int32 位模式差分）、256×256 分块、float32。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { STUDY_AREA } from '../src/config/scene.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataSrc = join(__dirname, 'data-src')
const fabdemDir = join(dataSrc, 'fabdem')
const SHOULD_WRITE = process.argv.includes('--write')
const FILE_ARG = process.argv.find((arg) => arg.startsWith('--file='))?.slice('--file='.length)
const TEST_TILE = Number(
  process.argv.find((arg) => arg.startsWith('--test-tile='))?.split('=')[1] ?? NaN
)

/** 研究区外扩一点，避免边界被裁断（与栅格淹没分析的范围一致） */
const MARGIN_DEG = 0.02
const BBOX = {
  west: Number((STUDY_AREA.west - MARGIN_DEG).toFixed(4)),
  south: Number((STUDY_AREA.south - MARGIN_DEG).toFixed(4)),
  east: Number((STUDY_AREA.east + MARGIN_DEG).toFixed(4)),
  north: Number((STUDY_AREA.north + MARGIN_DEG).toFixed(4))
}

const TAG_NAMES = {
  256: 'ImageWidth',
  257: 'ImageLength',
  258: 'BitsPerSample',
  259: 'Compression',
  262: 'PhotometricInterpretation',
  277: 'SamplesPerPixel',
  284: 'PlanarConfiguration',
  317: 'Predictor',
  322: 'TileWidth',
  323: 'TileLength',
  324: 'TileOffsets',
  325: 'TileByteCounts',
  339: 'SampleFormat',
  273: 'StripOffsets',
  278: 'RowsPerStrip',
  279: 'StripByteCounts',
  33550: 'ModelPixelScale',
  33922: 'ModelTiepoint',
  34735: 'GeoKeyDirectory',
  42113: 'GDAL_NODATA'
}
const COMPRESSION_NAMES = {
  1: '无压缩',
  5: 'LZW',
  8: 'DEFLATE(zip)',
  32946: 'DEFLATE(zip)',
  32773: 'PackBits'
}
const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 }

/* ------------------------------------------------------------------ */
/* TIFF 解析（经典 TIFF 与 BigTIFF 都支持）                              */
/* ------------------------------------------------------------------ */

function parseTiff(buffer) {
  const byteOrder = buffer.toString('ascii', 0, 2)
  if (byteOrder !== 'II' && byteOrder !== 'MM') throw new Error('不是合法的 TIFF 文件')
  const little = byteOrder === 'II'
  const readUInt16 = (at) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at))
  const readUInt32 = (at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at))
  const readUInt64 = (at) => Number(little ? buffer.readBigUInt64LE(at) : buffer.readBigUInt64BE(at))

  /** 读取标签值：type 2 是 ASCII 字符串，其余按数值数组整段读出 */
  const readValues = (at, type, count) => {
    if (type === 2) return [buffer.toString('ascii', at, at + count).replace(/\0+$/, '')]
    const size = TYPE_SIZES[type] ?? 1
    const values = []
    for (let i = 0; i < count; i++) {
      const offset = at + i * size
      if (type === 3) values.push(readUInt16(offset))
      else if (type === 4 || type === 13) values.push(readUInt32(offset))
      else if (type === 16 || type === 17 || type === 18) values.push(readUInt64(offset))
      else if (type === 11) values.push(little ? buffer.readFloatLE(offset) : buffer.readFloatBE(offset))
      else if (type === 12) values.push(little ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset))
      else values.push(buffer[offset])
    }
    return values
  }

  const version = readUInt16(2)
  const isBig = version === 43
  let offset = isBig ? Number(readUInt64(8)) : readUInt32(4)
  const entryCount = isBig ? Number(readUInt64(offset)) : readUInt16(offset)
  const entrySize = isBig ? 20 : 12
  const inlineSize = isBig ? 8 : 4
  offset += isBig ? 8 : 2

  const tags = {}
  for (let i = 0; i < entryCount; i++) {
    const base = offset + i * entrySize
    const tag = readUInt16(base)
    const type = readUInt16(base + 2)
    const count = isBig ? Number(readUInt64(base + 4)) : readUInt32(base + 4)
    const size = (TYPE_SIZES[type] ?? 1) * count
    const valueOffset = size <= inlineSize ? base + (isBig ? 12 : 8) : isBig ? Number(readUInt64(base + 12)) : readUInt32(base + 8)
    if (valueOffset + Math.min(size, 1) > buffer.length) continue
    tags[tag] = { type, count, values: readValues(valueOffset, type, count) }
  }
  return {
    little,
    bigTiff: isBig,
    width: tags[256]?.values[0],
    height: tags[257]?.values[0],
    tags
  }
}

/* ------------------------------------------------------------------ */
/* 瓦片解码                                                            */
/* ------------------------------------------------------------------ */

/**
 * 解码指定瓦片
 * 支持：DEFLATE / 无压缩；predictor 1、2（水平差分）、3（浮点字节平面）；
 *       int16 与 float32 两种样本类型。
 */
function decodeTile(record, index) {
  const { buffer, tags, width, height } = record
  const compression = tags[259]?.values[0] ?? 1
  const predictor = tags[317]?.values[0] ?? 1
  const bitsPerSample = tags[258]?.values[0] ?? 16
  const sampleFormat = tags[339]?.values[0] ?? 1
  const bytesPerSample = bitsPerSample / 8
  const tileWidth = tags[322]?.values[0]
  const tileLength = tags[323]?.values[0]
  const offsets = tags[324]?.values ?? tags[273]?.values
  const counts = tags[325]?.values ?? tags[279]?.values
  const across = Math.ceil(width / tileWidth)

  const tileCol = index % across
  const tileRow = Math.floor(index / across)
  const pixelWidth = Math.min(tileWidth, width - tileCol * tileWidth)
  const pixelHeight = Math.min(tileLength, height - tileRow * tileLength)
  const pixelCount = pixelWidth * pixelHeight

  const start = offsets[index]
  const length = counts[index]
  if (!Number.isFinite(start) || !Number.isFinite(length)) {
    console.log(`  瓦片 ${index} 取不到偏移/长度（共 ${offsets.length} 个）`)
    return null
  }
  if (start + length > buffer.length) {
    console.log(`  瓦片 ${index} 数据超出文件长度，跳过`)
    return null
  }

  const raw = buffer.subarray(start, start + length)
  const data = compression === 8 || compression === 32946 ? inflateSync(raw) : raw
  const expected = pixelCount * bytesPerSample
  if (data.length < expected) {
    console.log(`  瓦片 ${index} 解压 ${data.length} 字节，少于预期 ${expected} 字节`)
    return null
  }

  const out = new Float32Array(pixelCount)
  const view = new DataView(data.buffer, data.byteOffset, data.length)

  if (predictor === 3 && sampleFormat === 3) {
    // 浮点预测器：按字节拆成 4 个平面，各平面逐行做水平累加
    const planes = [0, 1, 2, 3].map((k) =>
      Uint8Array.from(data.subarray(k * pixelCount, (k + 1) * pixelCount))
    )
    for (const plane of planes) {
      for (let row = 0; row < pixelHeight; row++) {
        const base = row * pixelWidth
        for (let col = 1; col < pixelWidth; col++) {
          plane[base + col] = (plane[base + col] + plane[base + col - 1]) & 0xff
        }
      }
    }
    const bytes = Buffer.alloc(4)
    for (let i = 0; i < pixelCount; i++) {
      bytes[0] = planes[0][i]
      bytes[1] = planes[1][i]
      bytes[2] = planes[2][i]
      bytes[3] = planes[3][i]
      out[i] = record.little ? bytes.readFloatLE(0) : bytes.readFloatBE(0)
    }
  } else if (predictor === 2) {
    /**
     * 水平差分预测器。FABDEM 用它处理 float32：差分与累加都按 int32 位模式
     * 环绕进行，累加完成后把位模式重新解释为 float32。
     */
    const scratch = new DataView(new ArrayBuffer(4))
    for (let row = 0; row < pixelHeight; row++) {
      const base = row * pixelWidth
      let previous = 0
      for (let col = 0; col < pixelWidth; col++) {
        if (bytesPerSample === 4) {
          const value = view.getInt32((base + col) * 4, record.little)
          const restored = (value + previous) | 0
          previous = restored
          scratch.setInt32(0, restored, record.little)
          out[base + col] = sampleFormat === 3 ? scratch.getFloat32(0, record.little) : restored
        } else {
          const value = view.getInt16((base + col) * 2, record.little)
          const restored = value + previous
          previous = ((restored + 0x8000) & 0xffff) - 0x8000
          out[base + col] = previous
        }
      }
    }
  } else {
    for (let i = 0; i < pixelCount; i++) {
      if (bytesPerSample === 4 && sampleFormat === 3) out[i] = view.getFloat32(i * 4, record.little)
      else if (bytesPerSample === 2) out[i] = view.getInt16(i * 2, record.little)
      else out[i] = view.getInt32(i * 4, record.little)
    }
  }
  return { values: out, pixelWidth, pixelHeight }
}

/** 判断是不是有效高程（排除 ±FLT_MAX 之类的无数据哨兵） */
const isUsable = (value) => Number.isFinite(value) && Math.abs(value) < 1e30 && value > -500 && value < 9000

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

if (!existsSync(fabdemDir)) mkdirSync(fabdemDir, { recursive: true })
const entries = readdirSync(fabdemDir)

/** 从文件名解析分块范围：N30E114_FABDEM_V1-2.tif → 30~31°N / 114~115°E */
const tiles = entries
  .map((name) => {
    const match = name.match(/^([NS])(\d{2})([EW])(\d{3})_FABDEM/i)
    if (!match) return null
    const lat = Number(match[2])
    const lng = Number(match[4])
    const south = match[1].toUpperCase() === 'S' ? -lat - 1 : lat
    const west = match[3].toUpperCase() === 'W' ? -lng - 1 : lng
    return { name, south, west, north: south + 1, east: west + 1 }
  })
  .filter(Boolean)

const neededTiles = tiles.filter(
  (tile) =>
    tile.east > BBOX.west && tile.west < BBOX.east && tile.north > BBOX.south && tile.south < BBOX.north
)

if (!tiles.length) {
  console.log(`未在 ${fabdemDir} 找到 FABDEM 分块。`)
  console.log('请在布里斯托数据页下载 N30E110-N40E120_FABDEM_V1-2.zip 并解压到该目录：')
  console.log(`  ${fabdemDir}`)
  process.exit(1)
}

console.log(`目录内共 ${tiles.length} 个 1°×1° 分块；研究区（${BBOX.west}~${BBOX.east}°E, ${BBOX.south}~${BBOX.north}°N）需要 ${neededTiles.length} 个：`)
neededTiles.forEach((tile) => console.log(`  ${tile.name}（${tile.west}~${tile.east}°E, ${tile.south}~${tile.north}°N）`))

const records = neededTiles.map((tile) => {
  const filePath = join(fabdemDir, tile.name)
  const buffer = readFileSync(filePath)
  return { ...tile, filePath, buffer, ...parseTiff(buffer) }
})

const first = FILE_ARG
  ? (() => {
      const buffer = readFileSync(FILE_ARG)
      return { name: FILE_ARG.split(/[\\/]/).pop(), filePath: FILE_ARG, buffer, ...parseTiff(buffer) }
    })()
  : records[0]

/* ---- 体检 ---- */
console.log(`\n读取 ${first.name}（${(first.buffer.length / 1048576).toFixed(1)} MB）`)
console.log(`字节序 ${first.little ? 'II（小端）' : 'MM（大端）'}，${first.bigTiff ? 'BigTIFF' : '经典 TIFF'}`)
console.log('== 关键标签 ==')
for (const [tag, name] of Object.entries(TAG_NAMES)) {
  const entry = first.tags[tag]
  if (!entry) continue
  const preview = entry.values
    .slice(0, 6)
    .map((v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(6) : v))
    .join(', ')
  const more = entry.count > 6 ? ` …（共 ${entry.count} 个）` : ''
  const extra =
    tag === '259' ? `（${COMPRESSION_NAMES[entry.values[0]] ?? '未知'}）` : ''
  console.log(`  ${name.padEnd(24, ' ')} ${preview}${more}${extra}`)
}

const scale = first.tags[33550]?.values
const tiepoint = first.tags[33922]?.values
if (scale && tiepoint) {
  console.log(
    `\n影像 ${first.width} × ${first.height}，像元 ${scale[0]}°（约 ${Math.round(scale[0] * 111320 * Math.cos(tiepoint[4] * Math.PI / 180))} m × ` +
      `${Math.round(scale[1] * 111320)} m），左上角 ${tiepoint[3]}°E ${tiepoint[4]}°N`
  )
  console.log(
    `覆盖范围 ${tiepoint[3]}~${(tiepoint[3] + scale[0] * first.width).toFixed(4)}°E，` +
      `${(tiepoint[4] - scale[1] * first.height).toFixed(4)}~${tiepoint[4]}°N`
  )
}

/* ---- 单瓦片解码检查 ---- */
if (Number.isInteger(TEST_TILE)) {
  console.log(`\n== 解码瓦片 ${TEST_TILE} ==`)
  const decoded = decodeTile(first, TEST_TILE)
  if (decoded) {
    const { values, pixelWidth, pixelHeight } = decoded
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    let sum = 0
    let valid = 0
    let sentinels = 0
    for (const value of values) {
      if (!Number.isFinite(value) || Math.abs(value) > 1e30) {
        sentinels++
        continue
      }
      if (!isUsable(value)) continue
      min = Math.min(min, value)
      max = Math.max(max, value)
      sum += value
      valid++
    }
    const tileWidth = first.tags[322].values[0]
    const tileLength = first.tags[323].values[0]
    const across = Math.ceil(first.width / tileWidth)
    const centerLng = tiepoint[3] + ((TEST_TILE % across) * tileWidth + pixelWidth / 2) * scale[0]
    const centerLat = tiepoint[4] - (Math.floor(TEST_TILE / across) * tileLength + pixelHeight / 2) * scale[1]
    const center = values[Math.floor(pixelHeight / 2) * pixelWidth + Math.floor(pixelWidth / 2)]
    console.log(`  ${pixelWidth} × ${pixelHeight} 像素；无数据哨兵 ${sentinels}`)
    console.log(`  有效 ${valid}，高程 ${min.toFixed(1)} ~ ${max.toFixed(1)} m，均值 ${(sum / valid).toFixed(1)} m`)
    console.log(`  瓦片中心 ${centerLng.toFixed(4)}°E ${centerLat.toFixed(4)}°N → ${center.toFixed(1)} m`)
  }
}

/* ---- 提取研究区 ---- */
if (SHOULD_WRITE) {
  const CELL_DEG = 0.001
  const SCALE = 10
  const STORE_BASE = 32768
  const NO_DATA = 0
  const cols = Math.round((BBOX.east - BBOX.west) / CELL_DEG)
  const rows = Math.round((BBOX.north - BBOX.south) / CELL_DEG)
  const tileCache = new Map()

  /** 在某个分块文件内按经纬度取高程（瓦片内双线性插值） */
  function sampleRecord(record, lng, lat) {
    const tileWidth = record.tags[322].values[0]
    const tileLength = record.tags[323].values[0]
    const across = Math.ceil(record.width / tileWidth)
    const px = (lng - record.tags[33922].values[3]) / record.tags[33550].values[0]
    const py = (record.tags[33922].values[4] - lat) / record.tags[33550].values[1]
    if (px < 0 || py < 0 || px >= record.width || py >= record.height) return NaN

    const tileCol = Math.floor(px / tileWidth)
    const tileRow = Math.floor(py / tileLength)
    const tileIndex = tileRow * across + tileCol
    const cacheKey = `${record.name}_${tileIndex}`
    let decoded = tileCache.get(cacheKey)
    if (!decoded) {
      decoded = decodeTile(record, tileIndex)
      if (!decoded) return NaN
      tileCache.set(cacheKey, decoded)
    }

    const localX = px - tileCol * tileWidth
    const localY = py - tileRow * tileLength
    const x0 = Math.floor(localX)
    const y0 = Math.floor(localY)
    const fx = localX - x0
    const fy = localY - y0
    const at = (x, y) =>
      decoded.values[
        Math.min(y, decoded.pixelHeight - 1) * decoded.pixelWidth + Math.min(x, decoded.pixelWidth - 1)
      ]
    const v00 = at(x0, y0)
    const v10 = at(x0 + 1, y0)
    const v01 = at(x0, y0 + 1)
    const v11 = at(x0 + 1, y0 + 1)
    if (![v00, v10, v01, v11].every(isUsable)) {
      const fallback = [v00, v10, v01, v11].find(isUsable)
      return fallback ?? NaN
    }
    return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy
  }

  console.log(`\n== 提取研究区 ${cols} × ${rows} = ${(cols * rows).toLocaleString('en-US')} 格（100 m）==`)
  const grid = new Uint16Array(cols * rows)
  let missing = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let row = 0; row < rows; row++) {
    const lat = BBOX.south + (row + 0.5) * CELL_DEG
    for (let col = 0; col < cols; col++) {
      const lng = BBOX.west + (col + 0.5) * CELL_DEG
      const record = records.find(
        (item) => lng >= item.west && lng < item.east && lat >= item.south && lat < item.north
      )
      const elevation = record ? sampleRecord(record, lng, lat) : NaN
      if (!Number.isFinite(elevation)) {
        missing++
        grid[row * cols + col] = NO_DATA
        continue
      }
      grid[row * cols + col] = Math.max(1, Math.min(65535, Math.round(elevation * SCALE) + STORE_BASE))
      min = Math.min(min, elevation)
      max = Math.max(max, elevation)
    }
  }

  // 无数据格用邻域均值填补（与 terrarium 版一致）
  let filled = 0
  for (let pass = 0; pass < 20; pass++) {
    let changed = 0
    const next = grid.slice()
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col
        if (grid[index] !== NO_DATA) continue
        let sum = 0
        let count = 0
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const r = row + dr
          const c = col + dc
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue
          const value = next[r * cols + c]
          if (value === NO_DATA) continue
          sum += value
          count++
        }
        if (count) {
          next[index] = Math.round(sum / count)
          changed++
        }
      }
    }
    grid.set(next)
    filled += changed
    if (!changed) break
  }

  // 首次用 FABDEM 覆盖前，把 terrarium 版格网留一份，便于数据源对比
  const gridFile = join(dataSrc, 'dem-grid.bin')
  const metaFile = join(dataSrc, 'dem-grid.json')
  if (existsSync(metaFile)) {
    const previous = JSON.parse(readFileSync(metaFile, 'utf8'))
    if (!String(previous.source).includes('FABDEM')) {
      writeFileSync(join(dataSrc, 'dem-grid-srtm.bin'), readFileSync(gridFile))
      writeFileSync(join(dataSrc, 'dem-grid-srtm.json'), JSON.stringify(previous, null, 2), 'utf8')
      console.log('  已保留原格网为 dem-grid-srtm.bin / dem-grid-srtm.json（数据源对比用）')
    }
  }

  writeFileSync(gridFile, Buffer.from(grid.buffer))
  writeFileSync(
    metaFile,
    JSON.stringify(
      {
        source: 'FABDEM V1-2（去建筑与树冠，Copernicus DEM GLO-30 派生）',
        license: 'FABDEM © University of Bristol，CC BY-NC-SA 4.0（非商用、需署名）',
        sourceTiles: neededTiles.map((tile) => tile.name),
        generatedAt: new Date().toISOString(),
        verticalDatum: '随 Copernicus DEM（EGM2008 似大地水准面），使用前需与吴淞基准标定',
        grid: {
          west: BBOX.west,
          south: BBOX.south,
          cellDeg: CELL_DEG,
          cols,
          rows,
          cellMetersLng: Math.round(CELL_DEG * 111320 * Math.cos(((BBOX.south + BBOX.north) / 2) * Math.PI / 180)),
          cellMetersLat: Math.round(CELL_DEG * 111320)
        },
        storage: { file: 'dem-grid.bin', type: 'Uint16 little-endian', scale: SCALE, unit: '0.1 m', rowOrder: '南→北，西→东' },
        storageEncoding: { baseMeters: -STORE_BASE / SCALE, noDataValue: NO_DATA, note: 'value = round(elev*10) + 32768' },
        elevationRangeMeters: [Number(min.toFixed(1)), Number(max.toFixed(1))],
        missingCells: missing,
        filledCells: filled
      },
      null,
      2
    ),
    'utf8'
  )
  console.log(
    `完成：高程 ${min.toFixed(1)} ~ ${max.toFixed(1)} m，缺失 ${missing}（填补 ${filled}）\n` +
      `写出 ${gridFile}（${(grid.byteLength / 1048576).toFixed(2)} MB）与元数据\n` +
      '下一步：pnpm analyze:flood'
  )
}
