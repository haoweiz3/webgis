/**
 * GCJ-02（火星坐标）与 WGS-84 互转
 * ------------------------------------------------------------------
 * 背景：高德、腾讯等国内底图服务的瓦片建立在 GCJ-02 坐标系上，
 *       同一地点的高德坐标与真实经纬度（WGS-84）相差数百米，
 *       长江武汉段实测偏差 568~604 m、方位 115°~120°（东南偏东）。
 *       Cesium 全程按 WGS-84 处理瓦片网格与地形，直接叠加就会错位。
 *
 * 处理原则（GIS 专业要点）：
 *   平台的真值坐标一律是 WGS-84 —— 量算、剖面、淹没判定、状态栏读数
 *   都在该坐标系下完成；纠偏只作用在「底图瓦片」这一层，
 *   做法见 src/core/cesium/gcjTilingScheme.js，业务数据一个字节都不改。
 *
 * 算法为公开的 GCJ-02 转换式（克拉索夫斯基椭球参数），
 * 仅在中国范围内生效，境外原样返回。
 */

const PI = Math.PI
const AXIS = 6378245.0 // 克拉索夫斯基椭球长半轴（米）
const ECC_SQUARED = 0.00669342162296594323 // 第一偏心率平方

/** 粗略判断是否在国内（境外不做偏移） */
export function outOfChina(lng, lat) {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55)
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320.0 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0
  return ret
}

/**
 * WGS-84 → GCJ-02
 * @param {Number} lng 经度（度）
 * @param {Number} lat 纬度（度）
 * @returns {Number[]} [lng, lat]
 */
export function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat]

  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)

  const radLat = (lat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - ECC_SQUARED * magic * magic
  const sqrtMagic = Math.sqrt(magic)

  dLat = (dLat * 180.0) / (((AXIS * (1 - ECC_SQUARED)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180.0) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI)

  return [lng + dLng, lat + dLat]
}

/**
 * GCJ-02 → WGS-84
 * 转换式不可解析求逆，采用不动点迭代；3~4 次迭代即可收敛到厘米级，
 * 远优于影像一个像素对应的地面尺寸。
 * @param {Number} lng 经度（度）
 * @param {Number} lat 纬度（度）
 * @returns {Number[]} [lng, lat]
 */
export function gcj02ToWgs84(lng, lat, iterations = 4) {
  if (outOfChina(lng, lat)) return [lng, lat]

  let wLng = lng
  let wLat = lat
  for (let i = 0; i < iterations; i++) {
    const [gLng, gLat] = wgs84ToGcj02(wLng, wLat)
    wLng -= gLng - lng
    wLat -= gLat - lat
  }
  return [wLng, wLat]
}

/**
 * 某点 GCJ-02 相对 WGS-84 的偏移（米），用于诊断与文档说明。
 * @returns {{dlng: Number, dlat: Number, distance: Number, bearing: Number}}
 */
export function gcj02Offset(lng, lat) {
  const [gLng, gLat] = wgs84ToGcj02(lng, lat)
  const dLat = (gLat - lat) * 111320
  const dLng = (gLng - lng) * 111320 * Math.cos((lat * PI) / 180)
  const distance = Math.hypot(dLng, dLat)
  const bearing = ((Math.atan2(dLng, dLat) / PI) * 180 + 360) % 360
  return { dlng: gLng - lng, dlat: gLat - lat, distance, bearing }
}
