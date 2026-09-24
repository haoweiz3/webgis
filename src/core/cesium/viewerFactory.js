import * as Cesium from 'cesium'
import { SCENE_DEFAULTS, INITIAL_VIEW } from '@/config/scene.js'
import { flyTo } from './camera.js'

/** WebGL 环境检测：不支持时给出明确提示，而不是让用户对着黑屏等 */
export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    )
  } catch (err) {
    return false
  }
}

/**
 * 三维视图工厂
 * 平台的引擎层：统一在这里创建 Viewer、配置场景参数，
 * 业务模块只使用 ctx.viewer，不自己 new Viewer —— 配置只改一处，将来换引擎也不动业务代码。
 */
export function createViewer(container) {
  const viewer = new Cesium.Viewer(container, {
    // 关闭 Cesium 默认底图（默认底图依赖 Cesium ion 令牌），底图由 basemap 模块加载
    imageryProvider: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: false,
    creditContainer: document.createElement('div')
  })

  const scene = viewer.scene
  scene.globe.baseColor = Cesium.Color.fromCssColorString(SCENE_DEFAULTS.globeBaseColor)
  // 关键设置：让地形能够遮挡实体，否则水面会盖住两岸
  scene.globe.depthTestAgainstTerrain = true
  scene.skyAtmosphere.brightnessShift = SCENE_DEFAULTS.atmosphereBrightnessShift
  scene.fog.density = SCENE_DEFAULTS.fogDensity
  scene.highDynamicRange = true
  scene.screenSpaceCameraController.minimumZoomDistance = 150
  scene.screenSpaceCameraController.maximumZoomDistance = 800000

  // 双击默认会锁定实体，演示时容易误操作，移除该行为
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
  )

  flyTo(viewer, INITIAL_VIEW, 0)
  return viewer
}
