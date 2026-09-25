import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useDataStore } from './data.js'

/**
 * HUD 导航历史（返回 / 前进）
 * ------------------------------------------------------------------
 * 记录的是"选择状态快照"：当前选中的站点 + 当前打开的要素属性卡。
 * 所有入口都会自动进历史 —— 右侧列表点选、三维场景点选（模块里调
 * data.selectStation）、面板上的关闭与返回按钮，因为记录动作集中在
 * App.vue 的一个状态监听里，各组件不必各自维护历史。
 *
 * 语义与浏览器一致：新操作会截断"前进"分支；最多保留 50 条。
 * 判断"是否要新记一条"的方式是和当前历史项比较，因此回退/前进
 * 本身不会产生新的历史（不需要额外的标志位，也不受 watch 触发时机影响）。
 */
const HISTORY_LIMIT = 50
const EMPTY_ENTRY = { stationId: null, feature: null, label: '未选择' }

export const useNavStore = defineStore('nav', () => {
  const history = ref([{ ...EMPTY_ENTRY }])
  const index = ref(0)

  const current = computed(() => history.value[index.value] ?? EMPTY_ENTRY)
  const currentLabel = computed(() => current.value.label)
  const canGoBack = computed(() => index.value > 0)
  const canGoForward = computed(() => index.value < history.value.length - 1)

  function describe(stationId, feature) {
    if (feature?.properties?.name) return '要素 · ' + feature.properties.name
    if (stationId) {
      const data = useDataStore()
      return '站点 · ' + (data.stationMap.get(stationId)?.properties?.name ?? stationId)
    }
    return '未选择'
  }

  /** 记录一次选择变化（由 App.vue 的状态监听调用） */
  function record({ stationId = null, feature = null } = {}) {
    const last = history.value[index.value]
    if (last && last.stationId === stationId && last.feature === feature) return
    history.value = history.value.slice(0, index.value + 1)
    history.value.push({ stationId, feature, label: describe(stationId, feature) })
    if (history.value.length > HISTORY_LIMIT) history.value.shift()
    index.value = history.value.length - 1
  }

  function apply(entry) {
    const data = useDataStore()
    data.selectedStationId = entry.stationId
    data.selectedFeature = entry.feature
  }

  function goBack() {
    if (!canGoBack.value) return
    index.value -= 1
    apply(history.value[index.value])
  }

  function goForward() {
    if (!canGoForward.value) return
    index.value += 1
    apply(history.value[index.value])
  }

  /** 回到站点列表：清空站点选择（作为一次新操作进历史，可再前进回站点） */
  function backToList() {
    const data = useDataStore()
    data.selectedStationId = null
  }

  function reset() {
    history.value = [{ ...EMPTY_ENTRY }]
    index.value = 0
  }

  return {
    history,
    index,
    current,
    currentLabel,
    canGoBack,
    canGoForward,
    record,
    goBack,
    goForward,
    backToList,
    reset
  }
})
