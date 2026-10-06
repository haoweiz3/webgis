/**
 * 地形状态持有器
 * ------------------------------------------------------------------
 * 放两样跟地形强相关的运行期状态，与 viewer 一样用模块级普通变量持有，
 * 不进 Vue 响应式系统：
 *
 * 1. sampler —— 本地 DEM 的采高函数。
 *    Cesium 的 sampleTerrainMostDetailed 要求地形服务提供 availability（瓦片可用性），
 *    而 CustomHeightmapTerrainProvider 没有这个属性，直接调用会抛 DeveloperError。
 *    本地 DEM 由我们自己构建，手上就有原始格网，直接查格网比走地形瓦片又快又准。
 *
 * 2. exaggeration —— 垂直夸张倍数（仅视觉）。
 *    研究区是平原，真实高差只有几米到几十米，正上方俯视时地形在画面上看不出来。
 *    地形网格会按这个倍数放大高度，水面等实体也必须用同一个倍数，
 *    否则水面会被放大后的地形吞掉，所以换算入口统一放在 geoUtils.wusongToScene()。
 */
let sampler = null
let exaggeration = 1
let demGrid = null

export function setTerrainSampler(fn) {
  sampler = typeof fn === 'function' ? fn : null
}

export function getTerrainSampler() {
  return sampler
}

export function setTerrainExaggeration(value) {
  const next = Number(value)
  exaggeration = Number.isFinite(next) && next > 0 ? next : 1
  return exaggeration
}

export function getTerrainExaggeration() {
  return exaggeration
}

/**
 * 原始高程格网
 * 地形模块加载本地 DEM 后把整份格网放进来，
 * 栅格淹没、剖面等需要"逐格计算"的模块可以直接复用，不必再取一次数据。
 */
export function setDemGrid(grid) {
  demGrid = grid
}

export function getDemGrid() {
  return demGrid
}
