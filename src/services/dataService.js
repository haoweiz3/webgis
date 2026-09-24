/**
 * 数据服务
 * 统一负责空间数据与时空数据的获取，模块不直接写 fetch。
 * 数据文件位于 public/data/，由 scripts/build-data.mjs 生成。
 */

const SPATIAL_FILES = [
  { key: 'water', file: 'water.geojson' },
  { key: 'shoreline', file: 'shoreline.geojson' },
  { key: 'floodBands', file: 'flood-bands.geojson' },
  { key: 'stations', file: 'stations.geojson' },
  { key: 'bridges', file: 'bridges.geojson' },
  { key: 'roads', file: 'roads-main.geojson' }
]

export function createDataService() {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  const cache = new Map()

  /**
   * 加载单个数据文件
   * 带超时控制：网络被拦截或请求悬挂时明确报错，而不是让初始化界面永远停在原地。
   */
  async function loadJson(file, { timeout = 12000 } = {}) {
    if (cache.has(file)) return cache.get(file)
    const url = `${base}/data/${file}`
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? window.setTimeout(() => controller.abort(), timeout) : null
    try {
      const response = await fetch(url, controller ? { signal: controller.signal } : undefined)
      if (!response.ok) throw new Error(`${file} 返回 HTTP ${response.status}`)
      const json = await response.json()
      cache.set(file, json)
      return json
    } catch (err) {
      const reason = err?.name === 'AbortError' ? `请求超时（${timeout} ms）` : err?.message ?? String(err)
      throw new Error(`${file} 加载失败：${reason}`)
    } finally {
      if (timer) window.clearTimeout(timer)
    }
  }

  /** 加载全部空间要素 */
  async function loadSpatial() {
    const entries = await Promise.all(
      SPATIAL_FILES.map(async (item) => [item.key, await loadJson(item.file)])
    )
    return Object.fromEntries(entries)
  }

  async function loadSeries() {
    return loadJson('series.json')
  }

  async function loadMeta() {
    return loadJson('meta.json')
  }

  /** 需要参与场景构建的数据文件清单（含进度回调） */
  const ALL_FILES = [...SPATIAL_FILES, { key: 'series', file: 'series.json' }, { key: 'meta', file: 'meta.json' }]

  const CRITICAL_KEYS = ['stations', 'series']

  /**
   * 加载全部数据：允许个别文件失败（例如某个大数据文件被网络策略拦截），
   * 失败的条目放进 failures 返回，由调用方提示，而不是整站卡住。
   */
  async function loadAll(onProgress) {
    const results = {}
    const failures = []
    let finished = 0
    await Promise.all(
      ALL_FILES.map(async (item) => {
        try {
          results[item.key] = await loadJson(item.file)
        } catch (err) {
          failures.push({ key: item.key, file: item.file, message: err.message })
          console.error('[dataService]', err.message)
        } finally {
          finished += 1
          onProgress?.({ finished, total: ALL_FILES.length, file: item.file })
        }
      })
    )

    const spatial = {}
    SPATIAL_FILES.forEach((item) => {
      spatial[item.key] = results[item.key] ?? null
    })

    const critical = failures.filter((item) => CRITICAL_KEYS.includes(item.key))
    const empty = ALL_FILES.filter((item) => !results[item.key]).length === ALL_FILES.length
    if (empty) throw new Error('全部数据文件加载失败，请确认已执行 pnpm build:data 且 public/data 可访问')

    return { spatial, series: results.series ?? null, meta: results.meta ?? null, failures, critical }
  }

  return { loadJson, loadSpatial, loadSeries, loadMeta, loadAll }
}
