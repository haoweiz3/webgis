import { ref } from 'vue'

/**
 * 运行期诊断
 * 三维项目最容易出现的问题是"界面停在加载中、控制台才有报错"，
 * 这里把全局错误统一收集起来，直接显示在加载界面上，便于定位。
 */
export const appErrors = ref([])

export function recordError(source, error) {
  const message = error?.message ?? String(error ?? '未知错误')
  appErrors.value = [
    ...appErrors.value.slice(-4),
    { source, message, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) }
  ]
  console.error(`[${source}]`, error)
}

export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    recordError('运行错误', event.error ?? event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    recordError('未处理的异步错误', event.reason)
  })
}
