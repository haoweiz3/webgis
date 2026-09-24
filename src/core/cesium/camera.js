import * as Cesium from 'cesium'

export function flyTo(viewer, view, duration = 1.8) {
  if (!viewer) return
  const { lng, lat, height = 10000, pitch = -40, heading = 0 } = view
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, height),
    orientation: {
      heading: Cesium.Math.toRadians(heading),
      pitch: Cesium.Math.toRadians(pitch),
      roll: 0
    },
    duration
  })
}

export function flyToFeature(viewer, lngLat, height = 5000, duration = 1.6) {
  flyTo(viewer, { lng: lngLat[0], lat: lngLat[1], height, pitch: -50 }, duration)
}
