import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { installGlobalErrorHandlers, recordError } from './core/diagnostics.js'
import './styles/main.scss'

installGlobalErrorHandlers()

const app = createApp(App)
app.config.errorHandler = (err, instance, info) => {
  recordError(`组件错误（${info}）`, err)
}
app.use(createPinia())
app.mount('#app')
