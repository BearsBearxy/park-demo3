import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'

import './styles/tokens.css'
import './styles/base.css'
import './styles/motion.css'
import './styles/scrollbar.css'
import './styles/mx-list.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
// 等首次导航(含 auth 守卫重定向)解析完成再挂载,避免首帧落在未解析的 '/'
// 而先闪一下主壳(App.vue 按 route.path 判 login/shell)。
router.isReady().then(() => app.mount('#app'))
