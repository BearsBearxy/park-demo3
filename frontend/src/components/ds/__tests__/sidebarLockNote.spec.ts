import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import SidebarNav from '@/components/ds/SidebarNav.vue'
import { usePresenceStore } from '@/stores/presence'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve([])),
    put: vi.fn(() => Promise.resolve({ users: [] })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

/**
 * 侧栏「有人在编辑」标记的共锁注解(2026-08-26 用户投诉「莫名其妙」的那条修复)。
 *
 * ⚠ 2026-08-30 presence 改版时被静默回退过一次:scopeNote 原来喂的是 seat.scope,
 *   而改版后它只是「在哪一屏」(生产里 AppShell 恒传 null),锁挪进了 editScopes ——
 *   注解从此永远渲染不出来,且当时零测试覆盖。这份 spec 就是那次回退的赎罪。
 */
describe('侧栏 · 共锁注解', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  function seed() {
    usePresenceStore().users = [{
      sid: 's1', user: 'zhangsan', displayName: '张三', role: null,
      // ⚠ scope 必须按生产实况给 null(AppShell 恒传 null) —— 给了值等于把回退遮住
      scope: null, label: '催缴单', mode: 'edit',
      editScopes: ['billing-chain:2026-08'], sinceMs: 1000, idleMs: 0, self: false,
    }]
  }

  const ITEMS = [{ value: 'bill-notices', label: '催缴单' }]

  it('❗共锁屏的编辑点要带「为什么四个一起亮」的解释', () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    const dot = w.find('span[title*="共用同一把月锁"]')
    expect(dot.exists(), 'scopeNote 必须从 editScopes 里命中前缀的那把锁取,不是 seat.scope').toBe(true)
    expect(dot.attributes('title')).toContain('张三 正在编辑')
  })

  it('没人编辑时不画点', () => {
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    expect(w.find('span[title*="正在编辑"]').exists()).toBe(false)
  })

  it('折叠的组把子项的编辑点聚到标题行;展开后点回到子项(SIDEBAR-UX-REDESIGN §3.2)', async () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ title: '出账', items: ITEMS }], openTitles: [] } })
    expect(w.find('.fp-sbnav-row').exists()).toBe(false)                            // 收着
    const title = w.find('button.fp-sbnav-title')
    expect(title.find('span[title*="张三 正在编辑"]').exists()).toBe(true)           // 聚合点在标题行
    await title.trigger('click')
    expect(w.emitted('toggle')).toEqual([['出账']])                                  // 开合由外层决定
    await w.setProps({ openTitles: ['出账'] })
    expect(w.find('button.fp-sbnav-title span[title*="正在编辑"]').exists()).toBe(false)
    expect(w.find('.fp-sbnav-row span[title*="张三 正在编辑"]').exists()).toBe(true)  // 点回到子项行
  })

  it('在场点有 role="img" 与 aria-label —— 屏读能念出「谁在编辑哪一期」', () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    const dot = w.find('span[title*="正在编辑"]')
    expect(dot.attributes('role')).toBe('img')
    expect(dot.attributes('aria-label')).toBe(dot.attributes('title'))
  })

  it('在场点可聚焦(tabindex=0),Enter 开 Popover', async () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    const dot = w.find('span[title*="正在编辑"]')
    expect(dot.attributes('tabindex')).toBe('0')
    expect(w.find('.ds-popover-panel').exists()).toBe(false)
    await dot.trigger('keydown', { key: 'Enter' })
    expect(w.find('.ds-popover-panel').exists()).toBe(true)
    // ❗Enter 开的是浮层,不是整行导航 —— 冒泡到行 <button> 会顺带把这一屏切走(2026-09-06 实测坐实)
    expect(w.emitted('select')).toBeUndefined()
  })

  it('❗点在场点只开 Popover,不许顺带把整行 select 掉(2026-09-06 实测坐实)', async () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    const dot = w.find('span[title*="正在编辑"]')
    await dot.trigger('click')
    expect(w.find('.ds-popover-panel').exists(), '点击也该把面板打开').toBe(true)
    expect(w.emitted('select')).toBeUndefined()
  })

  it('❗非 Enter 键不开 Popover —— 按键守卫删掉(只留 preventDefault+click)也会全绿的洞', async () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    const dot = w.find('span[title*="正在编辑"]')
    await dot.trigger('keydown', { key: 'a' })
    expect(w.find('.ds-popover-panel').exists()).toBe(false)
  })

  it('❗Popover 面板真的载了文案,不是空壳 —— default slot 删空也要能被这条抓到', async () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    const dot = w.find('span[title*="正在编辑"]')
    await dot.trigger('keydown', { key: 'Enter' })
    expect(w.find('.ds-popover-panel').text()).toContain('正在编辑')
  })

  it('文案带期:名字 · 期 · 共锁解释三段用 · 拼(§3.3)', () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    const dot = w.find('span[title*="正在编辑"]')
    expect(dot.attributes('title')).toContain(' · 2026-08 · ')
  })

  it('❗点的外层包壳要有 display:flex + alignItems:center —— 否则点被行内基线顶偏(2026-09-06 实测偏下 9px,jsdom 断不到像素,退而求其次断样式)', () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    const dot = w.find('span[title*="正在编辑"]')
    // dot → Popover 的 trigger 包裹层 → Popover 根 span → 这一层是 SidebarNav 自己的外层包壳
    const outer = dot.element.parentElement?.parentElement?.parentElement as HTMLElement
    expect(outer.style.display).toBe('flex')
    expect(outer.style.alignItems).toBe('center')
  })

  it('❗折叠组的聚合点也要有 role="img" 与 aria-label —— 收着的时候它是唯一的在场信号', async () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ title: '出账', items: ITEMS }], openTitles: [] } })
    const dot = w.find('button.fp-sbnav-title span[title*="张三 正在编辑"]')
    expect(dot.attributes('role')).toBe('img')
    expect(dot.attributes('aria-label')).toBe(dot.attributes('title'))
  })

  it('❗Popover 面板宽度不超侧栏内容区(约 206px)—— 260px 会被 234px 的 .fp-panel 裁光', async () => {
    // jsdom 不跑布局引擎,断不到真实溢出像素(那部分留给真浏览器实测,见报告)——
    // 这里钉住喂给 Popover 的 width prop 本身没有超过 .fp-panel 的内容区宽度(234-14*2=206)。
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    const dot = w.find('span[title*="正在编辑"]')
    await dot.trigger('keydown', { key: 'Enter' })
    const panel = w.find('.ds-popover-panel')
    const panelStyle = (panel.element as HTMLElement).style
    const width = parseInt(panelStyle.width, 10)
    expect(width, `面板宽度 ${panelStyle.width} 不许超过侧栏内容区 206px`).toBeLessThanOrEqual(206)
  })
})
