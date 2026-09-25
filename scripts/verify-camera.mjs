/**
 * 相机飞行校核脚本
 * ------------------------------------------------------------------
 * 检查「飞到某个位置后，该位置是否真的落在视图中心」。
 * Cesium 的 camera.flyTo 把 destination 当相机位置，带俯仰角时屏幕中心
 * 会落在相机前方的地面上，偏移量 = 高度 / tan|俯仰角| ——
 * 站点定位偏 2.7 km、视角书签偏 6.0 km、初始视角偏 29 km 都是这个原因。
 *
 * 运行：pnpm verify:camera
 */
import * as Cesium from 'cesium'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { flyTo } = require('../src/core/cesium/camera.js')

function makeViewer() {
  const canvas = {
    clientWidth: 1000,
    clientHeight: 700,
    width: 1000,
    height: 700,
    addEventListener() {},
    removeEventListener() {},
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 })
  }
  const scene = {
    canvas,
    drawingBufferWidth: 1000,
    drawingBufferHeight: 700,
    mapProjection: new Cesium.GeographicProjection(),
    mode: Cesium.SceneMode.SCENE3D,
    pixelRatio: 1,
    // 与 viewerFactory 里的设置保持一致，供 adjustBoundingSphereOffset 使用
    screenSpaceCameraController: { minimumZoomDistance: 150, maximumZoomDistance: 800000 },
    requestRender() {}
  }
  return { camera: new Cesium.Camera(scene), scene }
}

const D2R = Math.PI / 180
const meters = (a, b) => {
  const dLat = (b[1] - a[1]) * 111320
  const dLng = (b[0] - a[0]) * 111320 * Math.cos((((a[1] + b[1]) / 2) * D2R))
  return Math.hypot(dLat, dLng)
}

/** 屏幕中心射线打到椭球上的点 */
function centerGroundPoint(camera, width = 1000, height = 700) {
  const ray = camera.getPickRay(new Cesium.Cartesian2(width / 2, height / 2))
  const hit = Cesium.IntersectionTests.rayEllipsoid(ray, Cesium.Ellipsoid.WGS84)
  if (!hit) return null
  const point = Cesium.Ray.getPoint(ray, hit.start)
  const carto = Cesium.Cartographic.fromCartesian(point)
  return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)]
}

/** 旧实现：把 destination 当相机位置（用来量化原来的偏移） */
function flyToOld(viewer, { lng, lat, height, pitch, heading = 0 }) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, height),
    orientation: {
      heading: Cesium.Math.toRadians(heading),
      pitch: Cesium.Math.toRadians(pitch),
      roll: 0
    },
    duration: 0
  })
}

const cases = [
  { name: '站点定位（纱帽水位站）', view: { lng: 114.01762, lat: 30.26568, height: 3200, pitch: -50 } },
  { name: '视角书签（武汉长江大桥）', view: { lng: 114.283, lat: 30.552, height: 4200, pitch: -35 } },
  { name: '初始视角', view: { lng: 114.3, lat: 30.53, height: 26000, pitch: -42 } }
]

let failures = 0
const check = (label, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  → ' + detail : ''}`)
}

console.log('== 视图中心与目标点的距离（越小越好）==')
for (const item of cases) {
  const viewer = makeViewer()
  flyTo(viewer, item.view, 0)
  const center = centerGroundPoint(viewer.camera)
  const after = center ? meters(center, [item.view.lng, item.view.lat]) : NaN
  const cameraHeight = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC).height

  const oldViewer = makeViewer()
  flyToOld(oldViewer, item.view)
  const oldCenter = centerGroundPoint(oldViewer.camera)
  const before = oldCenter
    ? meters(oldCenter, [item.view.lng, item.view.lat])
    : NaN

  console.log(
    `  ${item.name.padEnd(26, ' ')} 修复前 ${before.toFixed(0).padStart(6, ' ')} m → 修复后 ${after.toFixed(1).padStart(6, ' ')} m` +
      `（相机垂直高度 ${cameraHeight.toFixed(0)} m，目标设定 ${item.view.height} m）`
  )
  check(`${item.name}：目标点落在视图中心（< 50 m）`, after < 50, `${after.toFixed(1)} m`)
  check(`${item.name}：相机垂直高度与设定一致（±1%）`, Math.abs(cameraHeight - item.view.height) / item.view.height < 0.01)
}

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项未通过'}`)
process.exit(failures === 0 ? 0 : 1)
