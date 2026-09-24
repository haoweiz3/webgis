import * as Cesium from 'cesium'

/**
 * 屏幕坐标 → 地理坐标（拾取）
 * 三维场景没有 DOM 元素可以直接点击，必须把鼠标位置转成射线，
 * 与地形/椭球求交后才能拿到经纬度和高程。
 */
export function pickCartographic(viewer, windowPosition) {
  if (!viewer) return null
  const scene = viewer.scene
  let cartesian = null
  if (scene.mode === Cesium.SceneMode.SCENE3D) {
    const ray = viewer.camera.getPickRay(windowPosition)
    if (ray) cartesian = scene.globe.pick(ray, scene)
  } else {
    cartesian = viewer.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid)
  }
  if (!cartesian) return null
  return Cesium.Cartographic.fromCartesian(cartesian)
}

export function formatLngLat(lng, lat, digits = 5) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return '--'
  return lng.toFixed(digits) + '°, ' + lat.toFixed(digits) + '°'
}

export function formatElevation(height) {
  if (!Number.isFinite(height)) return '--'
  return height.toFixed(1) + ' m'
}

export function toCartographicDegrees(cartographic) {
  return {
    lng: Cesium.Math.toDegrees(cartographic.longitude),
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    height: cartographic.height
  }
}

/** 经纬度数组 → Cartesian3 数组 */
export function fromDegreesArray(lngLats, height = 0) {
  const flat = []
  lngLats.forEach(([lng, lat]) => flat.push(lng, lat))
  return Cesium.Cartesian3.fromDegreesArray(flat, undefined, height)
}

/** 闭合面的 hierarchy */
export function polygonHierarchy(lngLats, height) {
  return new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights(
    lngLats.flatMap(([lng, lat]) => [lng, lat, height ?? 0])
  ))
}

export function geoJsonCoordsToLngLats(geometry) {
  if (!geometry) return []
  if (geometry.type === 'LineString') return geometry.coordinates
  if (geometry.type === 'Polygon') return geometry.coordinates[0]
  return []
}
