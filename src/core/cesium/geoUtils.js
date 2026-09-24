import * as Cesium from 'cesium'
import { DATUM_OFFSET_M } from '@/config/scene.js'

/**
 * 空间计算工具
 * 距离用椭球测地线、面积用球面多边形公式，不依赖任何第三方空间库，
 * 所有计算结果均为真实度量单位（米 / 平方米 / 平方公里）。
 */

export function geodesicDistance(a, b) {
  const geodesic = new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromDegrees(a[0], a[1]),
    Cesium.Cartographic.fromDegrees(b[0], b[1])
  )
  return geodesic.surfaceDistance
}

export function lineLength(lngLats) {
  let total = 0
  for (let i = 1; i < lngLats.length; i++) total += geodesicDistance(lngLats[i - 1], lngLats[i])
  return total
}

/** 球面多边形面积（m²），输入为经纬度数组 */
export function ringArea(lngLats) {
  const R = 6371008.8
  const D2R = Math.PI / 180
  let total = 0
  for (let i = 0; i < lngLats.length; i++) {
    const [lng1, lat1] = lngLats[i]
    const [lng2, lat2] = lngLats[(i + 1) % lngLats.length]
    total += (lng2 - lng1) * D2R * (2 + Math.sin(lat1 * D2R) + Math.sin(lat2 * D2R))
  }
  return Math.abs((total * R * R) / 2)
}

export function cartesiansToLngLat(positions) {
  return positions.map((p) => {
    const c = Cesium.Cartographic.fromCartesian(p)
    return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)]
  })
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '--'
  if (meters >= 1000) return (meters / 1000).toFixed(3) + ' km'
  return meters.toFixed(1) + ' m'
}

export function formatArea(m2) {
  if (!Number.isFinite(m2)) return '--'
  const km2 = m2 / 1e6
  if (km2 >= 1) return km2.toFixed(3) + ' km²'
  return m2.toFixed(1) + ' m²'
}

/** 吴淞高程 → 场景高程（演示用固定偏移，生产环境应做基准转换） */
export function wusongToScene(wusongM) {
  return wusongM + DATUM_OFFSET_M
}

/** 场景高程 → 吴淞高程 */
export function sceneToWusong(sceneM) {
  return sceneM - DATUM_OFFSET_M
}

/**
 * 沿线段采样地形高程
 * 返回 { lngLats, distances, elevations }，用于剖面分析。
 */
export async function sampleTerrainProfile(terrainProvider, start, end, sampleCount = 80) {
  const lngLats = []
  for (let i = 0; i < sampleCount; i++) {
    const t = sampleCount === 1 ? 0 : i / (sampleCount - 1)
    lngLats.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t])
  }

  const cartographics = lngLats.map(([lng, lat]) => Cesium.Cartographic.fromDegrees(lng, lat))
  let sampled = cartographics
  try {
    sampled = await Cesium.sampleTerrainMostDetailed(terrainProvider, cartographics)
    if (!sampled || sampled.some((c) => !Number.isFinite(c.height))) sampled = cartographics
  } catch (err) {
    console.warn('[profile] 地形采样失败，使用椭球高近似', err)
  }

  const distances = []
  let acc = 0
  for (let i = 0; i < lngLats.length; i++) {
    if (i > 0) acc += geodesicDistance(lngLats[i - 1], lngLats[i])
    distances.push(acc)
  }

  return {
    lngLats,
    distances,
    elevations: sampled.map((c) => Number(c.height.toFixed(2)))
  }
}
