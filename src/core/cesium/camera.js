import * as Cesium from 'cesium'

/**
 * 飞到指定位置，并保证该位置落在视图中心
 * ------------------------------------------------------------------
 * 坑：Cesium 的 camera.flyTo 把 destination 当作「相机位置」，带俯仰角时
 * 屏幕中心落在相机前方的地面上，偏移量 = 高度 / tan|俯仰角|：
 *   3200 m 高、-50° 时偏出约 2.7 km，4200 m 高、-35° 时偏出约 6.0 km，
 *   初始视角（26000 m、-42°）偏出约 29 km —— 表现就是"飞到了但目标不在中间"。
 *
 * 做法：以目标点为球心飞，用 HeadingPitchRange 指定相机相对目标的
 * 方位角、俯仰角与斜距，Cesium 会把相机摆到「看得见目标且目标居中」的位置。
 * height 仍然是相机相对目标地面的垂直高度，语义与调用方预期一致。
 */
export function flyTo(viewer, view, duration = 1.8) {
  if (!viewer) return
  const { lng, lat, height = 10000, pitch = -40, heading = 0 } = view

  // 俯仰角接近水平时斜距会发散，夹到合理区间
  const pitchDeg = Math.min(-2, Math.max(-89.5, pitch))
  const pitchRad = Cesium.Math.toRadians(pitchDeg)
  const range = Math.abs(height / Math.sin(pitchRad))

  const target = Cesium.Cartesian3.fromDegrees(lng, lat, 0)
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
    offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(heading), pitchRad, range),
    duration
  })
}

export function flyToFeature(viewer, lngLat, height = 5000, duration = 1.6) {
  flyTo(viewer, { lng: lngLat[0], lat: lngLat[1], height, pitch: -50 }, duration)
}
