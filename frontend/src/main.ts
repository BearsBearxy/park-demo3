import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { vTip } from './directives/tip'

import './styles/tokens.css'
import './styles/base.css'
import './styles/motion.css'
import './styles/scrollbar.css'
import './styles/mx-list.css'
import './styles/form-sheet.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
// 悬停说明 v-tip(十件 ⑩):全站替代浏览器 title;test-setup.ts 里同样全局注册
app.directive('tip', vTip)
// 等首次导航(含 auth 守卫重定向)解析完成再挂载,避免首帧落在未解析的 '/'
// 而先闪一下主壳(App.vue 按 route.path 判 login/shell)。
router.isReady().then(() => app.mount('#app'))
