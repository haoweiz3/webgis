import { createEventBus } from '../events/eventBus.js'
import * as coord from '../cesium/coord.js'
import * as geo from '../cesium/geoUtils.js'
import { flyTo, flyToFeature } from '../cesium/camera.js'
import { getViewer } from '../viewerHolder.js'
import { createDataService } from '../../services/dataService.js'
import { useSceneStore } from '../../stores/scene.js'
import { useTimeStore } from '../../stores/time.js'
import { useDataStore } from '../../stores/data.js'

/**
 * 平台上下文 ctx
 * 模块唯一能接触到的"外部世界"：引擎、状态、事件、数据服务、工具函数。
 * 模块不直接 import 具体 store 或 Cesium，接口收敛、依赖清晰、便于替换。
 */
export function createContext() {
  const eventBus = createEventBus()
  const scene = useSceneStore()
  const time = useTimeStore()
  const data = useDataStore()

  const ctx = {
    eventBus,
    scene,
    time,
    data,
    dataService: createDataService(),
    utils: { coord, geo, camera: { flyTo, flyToFeature } },
    get viewer() {
      return getViewer()
    },
    get camera() {
      return getViewer()?.camera ?? null
    },
    get terrainProvider() {
      return getViewer()?.terrainProvider ?? null
    },
    toast(message, type = 'info') {
      eventBus.emit('ui:toast', { message, type, at: Date.now() })
    }
  }

  return ctx
}
