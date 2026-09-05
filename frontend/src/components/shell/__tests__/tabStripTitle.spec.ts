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
    // 只盯 `.fp-tab { }` 块内的 flex 防不住「换个选择器把宽度写回来」——
    // 本次清掉的那行 min-width 就在 `.fp-tab.on:hover` 里(2026-09-06 T4 评审实测:塞回去 37 条全绿)。
    // 所以扫整个 <style>:任何 .fp-tab 系列规则里都不许再出现伸缩宽度。
    const style = s.slice(s.indexOf('<style'))
    // (?![\w-]) 排掉 .fp-tabs 容器与 .fp-tab-label / -overflow / -actions —— 它们该有 min-width:0
    for (const rule of style.match(/\.fp-tab(?![\w-])[^{]*\{[^}]*\}/g) ?? []) {
      expect(rule, `${rule.split('{')[0].trim()} 里又出现了伸缩宽度`)
        .not.toMatch(/(min-width|max-width)\s*:|flex:\s*1/)
    }
  })

  it('溢出下拉行也拼上下文(定宽之后下拉从「几乎不发生」变常态入口,它是看全文的唯一去处之一)', () => {
    const s = src('components/shell/TabStrip.vue')
    const row = s.slice(s.indexOf('fp-tablist-row'), s.indexOf('fp-tablist-row') + 600)
    expect(row, '下拉行的 title 丢了 titleOf').toContain(':title="titleOf(value)"')
    expect(row, '下拉行的文字丢了 titleOf').toContain('{{ titleOf(value) }}')
  })

})
