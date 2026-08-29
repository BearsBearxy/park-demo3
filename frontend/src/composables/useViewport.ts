// src/composables/useViewport.ts — JS 侧视口档位/触屏判定(RESPONSIVE-LAYOUT-SPEC §1)。
// 模块级单例:matchMedia listener 只挂一次,所有调用方共享同一组 Ref——
// 视口是全局事实,逐组件各挂一套监听既浪费又可能判定不一致。
import { ref, type Ref } from 'vue'
import { BP } from '../styles/breakpoints'

export type ViewportTier = 'xl' | 'l' | 'm' | 's'

interface ViewportState {
  tier: Ref<ViewportTier>
  isTouch: Ref<boolean>
}

let state: ViewportState | null = null
let cleanups: Array<() => void> = []

function init(): ViewportState {
  // 无 matchMedia 环境(jsdom/SSR)guard,照抄 stores/ui.ts:19——
  // 默认 xl(现状零差异档)、非触屏,不抛错。
  const tier = ref<ViewportTier>('xl')
  const isTouch = ref(false)

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    // 三条 max-width 查询与 CSS 断点一一对应;档位 = 命中的最窄一档。
    const s = window.matchMedia(`(max-width: ${BP.s}px)`)
    const m = window.matchMedia(`(max-width: ${BP.m}px)`)
    const l = window.matchMedia(`(max-width: ${BP.l}px)`)
    const compute = () => {
      tier.value = s.matches ? 's' : m.matches ? 'm' : l.matches ? 'l' : 'xl'
    }
    compute()
    for (const mql of [s, m, l]) {
      mql.addEventListener('change', compute)
      cleanups.push(() => mql.removeEventListener('change', compute))
    }

    // 触屏按输入能力不按视口(spec §6):hover:none 命中即触屏,
    // iPad 外接鼠标时 hover:hover 恢复,由媒体查询自动跟随、禁 UA 嗅探。
    const hover = window.matchMedia('(hover: none)')
    const computeTouch = () => { isTouch.value = hover.matches }
    computeTouch()
    hover.addEventListener('change', computeTouch)
    cleanups.push(() => hover.removeEventListener('change', computeTouch))
  }

  return { tier, isTouch }
}

export function useViewport(): ViewportState {
  if (!state) state = init()
  return state
}

// 仅测试用:单例挂一次监听,测试间换 matchMedia mock 后必须能重建,
// 否则第二个用例拿到的还是第一份 mock 的判定。生产代码不得调用。
export function _resetViewportForTest(): void {
  cleanups.forEach((fn) => fn())
  cleanups = []
  state = null
}
