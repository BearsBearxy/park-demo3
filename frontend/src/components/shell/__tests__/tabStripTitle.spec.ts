import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import TabStrip from '@/components/shell/TabStrip.vue'
import { useTabsStore } from '@/stores/tabs'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { value: 'ledger' }, path: '/ledger' }),
  useRouter: () => ({ push }),
}))

const SRC = join(__dirname, '..', '..', '..')
const src = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

// TabStrip.vue:49 裸 new ResizeObserver(没有 typeof 守卫),jsdom 里没有这个全局 ——
// 不桩掉 5 条会全部炸成 ReferenceError 而不是断言失败(照 anaEChart.spec 的既有写法)。
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never

describe('TabStrip · 标题拼上下文(§6)', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear() })

  it('有期有公司:屏名 · 期 · 公司', () => {
    const tabs = useTabsStore()
    tabs.open('ledger', { pin: true })
    tabs.setCtx('ledger', { p: '2025-06', coName: '一期公司' })
    expect(mount(TabStrip).text()).toContain('月度台账 · 2025-06 · 一期公司')
  })

  it('只有期:两段;什么都没有:只有屏名(有几段写几段)', () => {
    const tabs = useTabsStore()
    tabs.open('ledger', { pin: true })
    tabs.setCtx('ledger', { p: '2025-06' })
    expect(mount(TabStrip).text()).toContain('月度台账 · 2025-06')
    tabs.clearCtx('ledger')
    const t = mount(TabStrip).text()
    expect(t).toContain('月度台账')
    expect(t).not.toContain('·')
  })

  it('title 属性带全文(定宽必然截断,鼠标停住能看全)', () => {
    const tabs = useTabsStore()
    tabs.open('ledger', { pin: true })
    tabs.setCtx('ledger', { p: '2025-06', coName: '一期公司' })
    // ⚠ 用 data-tabv 选,别用 .fp-tab —— 基底页签 data-home 排在 ledger 前面,first() 命中的是它
    const el = mount(TabStrip).find('[data-tabv="ledger"]')
    expect(el.attributes('title')).toContain('2025-06')
    expect(el.attributes('title')).toContain('一期公司')
  })

  it('页签定宽 148px(改名不改宽 —— 标题现在会跟着期变,弹性宽度等于每换一次期整条跳一次)', () => {
    const s = src('components/shell/TabStrip.vue')
    expect(s.includes('flex: 0 0 148px')).toBe(true)
    expect(/\.fp-tab\s*\{[^}]*flex:\s*1 1 0/.test(s)).toBe(false)
  })

})
