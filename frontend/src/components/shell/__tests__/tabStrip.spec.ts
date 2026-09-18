// 页签条(TAB-BAR-SPEC §3 §4)。「❗」开头的做过破坏验证。
// jsdom 没有布局:条宽、页签位置用原型上的 getter 桩出来(每个页签按它在条里的次序占 100px)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTabsStore, HOME, NEWTAB } from '@/stores/tabs'
import { useFavoritesStore } from '@/stores/favorites'
import { useAuthStore } from '@/stores/auth'

const route = reactive({ meta: { value: 'ledger' } as Record<string, string>, path: '/ledger' })
// push 桩 = 导航立刻落定:改路由 + 走一遍 afterEach(页签条只在导航落定后兑现登记)
const push = vi.fn((p: string) => { route.meta = { value: p.slice(1) }; route.path = p; return landNav(p) })
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
}))
vi.mock('@/api', () => ({
  default: { get: vi.fn(() => Promise.resolve([])), post: vi.fn(() => Promise.resolve()), delete: vi.fn(() => Promise.resolve()) },
  readToken: vi.fn(() => 't'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

import TabStrip from '@/components/shell/TabStrip.vue'
import { landNav } from '@/test-utils/landNav'

enableAutoUnmount(afterEach)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never

const SRC = join(__dirname, '..', '..', '..')
const src = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

// ── 布局桩:条宽 STRIP;每个页签 offsetLeft = 次序 × 100 ──
let STRIP = 1099
const proto = HTMLElement.prototype
// 桩直接定义在 HTMLElement.prototype 上(clientWidth 原本在 Element 上),用完删掉自有属性即恢复
const saved = {
  ol: Object.getOwnPropertyDescriptor(proto, 'offsetLeft'),
  ow: Object.getOwnPropertyDescriptor(proto, 'offsetWidth'),
  rect: proto.getBoundingClientRect,
}
function slot(el: HTMLElement) {
  const all = [...(el.parentElement?.querySelectorAll(':scope > [data-tabv]') ?? [])]
  return all.indexOf(el)
}
beforeEach(() => {
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('fp-tabstrip') ? STRIP : 0 } })
  Object.defineProperty(proto, 'offsetLeft', { configurable: true, get() { const el = this as HTMLElement; return el.dataset.tabv ? slot(el) * 100 : 0 } })
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get() { return (this as HTMLElement).dataset.tabv ? 100 : 0 } })
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const l = this.dataset.tabv ? slot(this) * 100 : 0
    return { left: l, right: l + 100, top: 0, bottom: 44, width: 100, height: 44, x: l, y: 0, toJSON() {} } as DOMRect
  }
  setActivePinia(createPinia())
  localStorage.clear()
  const auth = useAuthStore()
  auth.me = 'zhou'
  auth.permissions = ['ledger:edit']
  route.meta = { value: 'ledger' }
  route.path = '/ledger'
  push.mockClear()
  STRIP = 1099
})
afterEach(() => {
  delete (proto as unknown as Record<string, unknown>).clientWidth
  if (saved.ol) Object.defineProperty(proto, 'offsetLeft', saved.ol)
  if (saved.ow) Object.defineProperty(proto, 'offsetWidth', saved.ow)
  proto.getBoundingClientRect = saved.rect
  document.body.innerHTML = ''
})

/** 开几个页签,路由落在 active。 */
function setup(values: string[], active = values[0]) {
  const tabs = useTabsStore()
  for (const v of values) tabs.openBackground(v)
  tabs.setActive(active)
  route.meta = { value: active }
  route.path = '/' + active
  return tabs
}
const vals = () => useTabsStore().tabs.map(t => t.value)
const tabEl = (w: VueWrapper, v: string) => w.find(`[data-tabv="${v}"]`)
const widthOf = (w: VueWrapper, v: string) => tabEl(w, v).attributes('style')?.match(/--w:\s*(\d+)px/)?.[1]
const menuRows = () => [...document.body.querySelectorAll<HTMLButtonElement>('.fp-tab-menu .row')]
async function openMenu(w: VueWrapper, v: string) {
  await tabEl(w, v).trigger('contextmenu', { clientX: 300, clientY: 30 })
}
function pick(label: string) {
  const b = menuRows().find(r => r.textContent?.startsWith(label))
  if (!b) throw new Error('菜单里没有:' + label)
  b.click()
}

describe('TabStrip · 标题', () => {
  it('有期有公司:屏名 · 期 · 公司;有几段写几段', async () => {
    const tabs = setup(['ledger'])
    tabs.setCtx('ledger', { p: '2025-06', coName: '一期公司' })
    const w = mount(TabStrip)
    expect(tabEl(w, 'ledger').text()).toContain('月度台账 · 2025-06 · 一期公司')
    tabs.setCtx('ledger', { p: '2025-06' })
    await nextTick()
    expect(tabEl(w, 'ledger').text()).toContain('月度台账 · 2025-06')
    expect(tabEl(w, 'ledger').text()).not.toContain('一期公司')
  })

  it('❗标题一律不用斜体(源码里没有 italic)', () => {
    expect(src('components/shell/TabStrip.vue')).not.toMatch(/italic/)
  })

  it('首页固定在最左:只有房子图标,没有标题、没有 ×', () => {
    setup(['ledger'])
    const w = mount(TabStrip)
    const home = tabEl(w, HOME)
    expect(w.findAll('[data-tabv]')[0].attributes('data-tabv')).toBe(HOME)
    expect(home.classes()).toContain('pn')
    expect(home.find('.fp-tab-label').exists()).toBe(false)
    expect(home.find('.fp-tab-x').exists()).toBe(false)
  })
})

describe('TabStrip · 宽度(§3.2)', () => {
  it('❗4 个页签每个 220(上限);9 个一起变窄;15 个停在 96 并在 ⌄ 旁出总数', async () => {
    setup(['ledger', 'tenants', 'contracts', 'meters'])
    let w = mount(TabStrip)
    await nextTick()                                  // 条宽在 onMounted 里量,下一拍才重算宽度
    expect(widthOf(w, 'ledger')).toBe('220')
    expect(w.find('.fp-tab-list .n').exists()).toBe(false)
    w.unmount()

    setActivePinia(createPinia()); localStorage.clear()
    setup(['ledger', 'tenants', 'contracts', 'meters', 'alloc', 'params', 'salary', 'utilities', 'import'])
    w = mount(TabStrip)
    await nextTick()
    // 可用宽 = 1099 − 16 − 44(首页)− 32(+)− 48(⌄)= 959;959 / 9 = 106
    expect(widthOf(w, 'ledger')).toBe('106')
    w.unmount()

    setActivePinia(createPinia()); localStorage.clear()
    const many = ['ledger', 'tenants', 'contracts', 'meters', 'alloc', 'params', 'salary', 'utilities', 'import', 'buildings', 'cockpit', 'park', 'churn', 'expiry', 'budget']
    setup(many)
    w = mount(TabStrip)
    await nextTick()
    expect(widthOf(w, 'ledger')).toBe('96')
    expect(w.find('.fp-tab-list .n').text()).toBe('16')
  })

  it('❗窄于 120:只有当前页签和鼠标停着的那个显示 ×', async () => {
    setup(['ledger', 'tenants', 'contracts', 'meters', 'alloc', 'params', 'salary', 'utilities', 'import'], 'tenants')
    const w = mount(TabStrip)
    const withX = () => w.findAll('[data-tabv]').filter(t => t.find('.fp-tab-x').exists()).map(t => t.attributes('data-tabv'))
    expect(withX()).toEqual(['tenants'])
    await tabEl(w, 'meters').trigger('mouseenter')
    expect(withX()).toEqual(['tenants', 'meters'])
  })

  it('宽的时候每个页签都有 ×', async () => {
    setup(['ledger', 'tenants'])
    const w = mount(TabStrip)
    await nextTick()
    expect(tabEl(w, 'tenants').find('.fp-tab-x').exists()).toBe(true)
  })

  it('❗连着关:点 × 关掉一个后其余先不变宽,鼠标离开页签条再重算', async () => {
    setup(['ledger', 'tenants', 'contracts', 'meters', 'alloc', 'params', 'salary', 'utilities', 'import', 'buildings'], 'ledger')
    const w = mount(TabStrip)
    await nextTick()
    const before = widthOf(w, 'ledger')
    expect(before).toBe('96')                         // 959 / 10 = 95 → 最窄 96
    await tabEl(w, 'meters').trigger('mouseenter')
    await tabEl(w, 'meters').find('.fp-tab-x').trigger('click')
    await nextTick()
    expect(vals()).not.toContain('meters')
    expect(widthOf(w, 'ledger'), '关掉后先保持原宽').toBe(before)
    await w.find('.fp-tabstrip').trigger('mouseleave')
    expect(widthOf(w, 'ledger'), '离开后重算:959 / 9').toBe('106')
  })
})

describe('TabStrip · 点、关、新建', () => {
  it('点页签切过去', async () => {
    setup(['ledger', 'tenants'])
    const w = mount(TabStrip)
    await tabEl(w, 'tenants').trigger('click')
    expect(push).toHaveBeenCalledWith('/tenants')
  })

  it('❗中键点页签 = 关掉;关的是当前页签就跳到右边那格,再弃掉它的缓存', async () => {
    setup(['ledger', 'tenants', 'contracts'], 'tenants')
    const w = mount(TabStrip)
    await tabEl(w, 'tenants').trigger('auxclick', { button: 1 })
    await nextTick()
    expect(vals()).toEqual([HOME, 'ledger', 'contracts'])
    expect(push).toHaveBeenCalledWith('/contracts')
    expect(useTabsStore().epochOf('tenants')).toBe(1)
  })

  it('❗点 +:新建「新标签页」并跳过去;已有就只切过去', async () => {
    setup(['ledger'])
    const w = mount(TabStrip)
    await w.find('.fp-tab-new').trigger('click')
    expect(vals()).toEqual([HOME, 'ledger', NEWTAB])
    expect(push).toHaveBeenLastCalledWith('/newtab')
    await w.find('.fp-tab-new').trigger('click')
    expect(vals()).toEqual([HOME, 'ledger', NEWTAB])
  })
})

describe('TabStrip · 右键菜单(§3.4)', () => {
  it('❗十行、两条分隔线;「重新加载」「关闭」带灰字', async () => {
    setup(['ledger', 'tenants'])
    const w = mount(TabStrip, { attachTo: document.body })
    await openMenu(w, 'ledger')
    expect(menuRows().map(r => r.textContent)).toEqual([
      '在右侧新建页签', '重新加载回到刚打开的样子', '固定', '收藏此页',
      '关闭中键', '关闭其他页签', '关闭右侧页签', '重新打开关闭的页签',
    ])
    expect(document.body.querySelectorAll('.fp-tab-menu .sep').length).toBe(2)
    expect(menuRows().at(-1)!.disabled, '没关过东西时灰掉').toBe(true)
  })

  it('❗首页上只有「在右侧新建」「重新加载」「重新打开」可用', async () => {
    setup(['ledger'])
    const w = mount(TabStrip, { attachTo: document.body })
    await openMenu(w, HOME)
    const on = menuRows().filter(r => !r.disabled).map(r => r.textContent)
    expect(on).toEqual(['在右侧新建页签', '重新加载回到刚打开的样子'])
  })

  it('关闭其他 / 关闭右侧:不关固定的;关掉的能重新打开', async () => {
    const tabs = setup(['ledger', 'tenants', 'contracts', 'meters'], 'ledger')
    tabs.pin('meters')
    const w = mount(TabStrip, { attachTo: document.body })
    await openMenu(w, 'tenants')
    pick('关闭右侧页签')
    await nextTick()
    expect(vals()).toEqual([HOME, 'meters', 'ledger', 'tenants'])
    await openMenu(w, 'tenants')
    pick('关闭其他页签')
    await nextTick(); await nextTick()
    expect(vals()).toEqual([HOME, 'meters', 'tenants'])
    expect(push, '当前页签(台账)被关了,跳到菜单那一格').toHaveBeenCalledWith('/tenants')
    await openMenu(w, 'tenants')
    pick('重新打开关闭的页签')
    await nextTick()
    expect(vals()).toEqual([HOME, 'meters', 'tenants', 'ledger'])
  })

  it('固定 / 取消固定;收藏此页;重新加载 = 换新实例', async () => {
    const tabs = setup(['ledger', 'tenants'])
    const w = mount(TabStrip, { attachTo: document.body })
    await openMenu(w, 'tenants')
    pick('固定')
    await nextTick()
    expect(tabs.tabs[1]).toEqual({ value: 'tenants', pinned: true })
    await openMenu(w, 'tenants')
    pick('取消固定')
    expect(tabs.tabs.find(t => t.value === 'tenants')?.pinned).toBeFalsy()
    await openMenu(w, 'tenants')
    pick('收藏此页')
    expect(useFavoritesStore().has('tenants')).toBe(true)
    await openMenu(w, 'ledger')
    pick('重新加载')
    expect(tabs.epochOf('ledger')).toBe(1)
  })

  it('Esc / 点外面关菜单', async () => {
    setup(['ledger'])
    const w = mount(TabStrip, { attachTo: document.body })
    await openMenu(w, 'ledger')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.body.querySelector('.fp-tab-menu')).toBeNull()
    await openMenu(w, 'ledger')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(document.body.querySelector('.fp-tab-menu')).toBeNull()
  })
})

describe('TabStrip · 正在编辑的页签', () => {
  it('❗关掉 / 重新加载 / 关闭其他 我正在编辑的页签:先问;说「不」就什么都不动', async () => {
    const tabs = setup(['ledger', 'tenants'], 'tenants')
    vi.spyOn(tabs, 'isEditing').mockImplementation((v: string) => v === 'ledger')
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const w = mount(TabStrip, { attachTo: document.body })
    await tabEl(w, 'ledger').trigger('auxclick', { button: 1 })
    expect(ask).toHaveBeenCalledWith('「月度台账」正在编辑。关掉会丢失未保存的改动，继续？')
    expect(vals()).toContain('ledger')
    await openMenu(w, 'ledger')
    pick('重新加载')
    expect(tabs.epochOf('ledger')).toBe(0)
    await openMenu(w, 'tenants')
    pick('关闭其他页签')
    await nextTick()
    expect(vals()).toContain('ledger')
    ask.mockReturnValue(true)
    await tabEl(w, 'ledger').trigger('auxclick', { button: 1 })
    await nextTick()
    expect(vals()).not.toContain('ledger')
    ask.mockRestore()
  })

  it('不在编辑的页签照常关,不问', async () => {
    setup(['ledger', 'tenants'], 'tenants')
    const ask = vi.spyOn(window, 'confirm')
    const w = mount(TabStrip)
    await tabEl(w, 'ledger').trigger('auxclick', { button: 1 })
    expect(ask).not.toHaveBeenCalled()
    expect(vals()).not.toContain('ledger')
    ask.mockRestore()
  })

  it('收藏满 12 个:右键「收藏此页」灰掉并写「已满 12 个」', async () => {
    const f = useFavoritesStore()
    // 第一次登录已预置本月出账一格,再加 11 个 = 12
    for (const v of ['contracts', 'buildings', 'meters', 'alloc', 'params', 'salary', 'utilities', 'import', 'cockpit', 'park', 'churn']) f.toggle(v)
    expect(f.list.length).toBe(12)
    setup(['ledger'])
    const w = mount(TabStrip, { attachTo: document.body })
    await openMenu(w, 'ledger')
    const row = menuRows().find(r => r.textContent?.startsWith('收藏此页'))!
    expect(row.disabled).toBe(true)
    expect(row.textContent).toBe('收藏此页已满 12 个')
  })
})

describe('TabStrip · 全部页签(§3.5)', () => {
  it('❗列出已打开(当前那行高亮)与最近关闭;搜索按标题过滤;点最近关闭的重新打开', async () => {
    const tabs = setup(['ledger', 'tenants', 'contracts'])
    tabs.close('contracts')
    const w = mount(TabStrip)
    await w.find('.fp-tab-list').trigger('click')
    const pop = w.find('.fp-tablist-pop')
    expect(pop.find('.fp-tablist-hd').text()).toBe('已打开 · 3')
    expect(pop.findAll('.fp-tablist-row:not(.closed) .nm').map(x => x.text())).toEqual(['首页', '月度台账', '租户管理'])
    expect(pop.find('.fp-tablist-row.on .nm').text()).toBe('月度台账')
    expect(pop.findAll('.fp-tablist-row.closed .nm').map(x => x.text())).toEqual(['合同管理'])
    await pop.find('input').setValue('租户')
    expect(w.findAll('.fp-tablist-row:not(.closed) .nm').map(x => x.text())).toEqual(['租户管理'])
    await w.find('.fp-tablist-row.closed').trigger('click')
    expect(vals()).toEqual([HOME, 'ledger', 'tenants', 'contracts'])
    expect(push).toHaveBeenCalledWith('/contracts')
  })
})

describe('TabStrip · 悬停卡片(§3.3)', () => {
  it('停 600ms 出:屏名 / 期·公司 / 层 · 分组', async () => {
    vi.useFakeTimers()
    const tabs = setup(['ledger'])
    tabs.setCtx('ledger', { p: '2026-08', coName: '一期公司' })
    const w = mount(TabStrip)
    await tabEl(w, 'ledger').trigger('mouseenter')
    vi.advanceTimersByTime(599)
    await nextTick()
    expect(w.find('.fp-tab-card').exists()).toBe(false)
    vi.advanceTimersByTime(1)
    await nextTick()
    const c = w.find('.fp-tab-card')
    expect(c.find('.t').text()).toBe('月度台账')
    expect(c.find('.m').text()).toBe('2026-08 · 一期公司')
    expect(c.find('.m2').text()).toBe('数据中心 · 记账 · 按月')
    // 按下鼠标即收(§3.3)
    await tabEl(w, 'ledger').trigger('pointerdown', { button: 0 })
    expect(w.find('.fp-tab-card').exists()).toBe(false)
    vi.useRealTimers()
  })
})

describe('TabStrip · 拖动(§4)', () => {
  const ev = (type: string, x: number, y = 20) => new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })

  it('❗按住横移:越过邻居一半就换位;拖完那一下不算点击', async () => {
    setup(['ledger', 'tenants', 'contracts', 'meters'], 'ledger')
    const w = mount(TabStrip)
    // 次序:首页 0、台账 1、租户 2、合同 3、抄表 4(各 100px)。把抄表往左拖过合同的中线
    tabEl(w, 'meters').element.dispatchEvent(ev('pointerdown', 450))
    window.dispatchEvent(ev('pointermove', 448))            // <4px:还不算拖
    await nextTick()
    expect(vals()).toEqual([HOME, 'ledger', 'tenants', 'contracts', 'meters'])
    window.dispatchEvent(ev('pointermove', 340))
    await nextTick()
    expect(vals()).toEqual([HOME, 'ledger', 'tenants', 'meters', 'contracts'])
    window.dispatchEvent(ev('pointerup', 340))
    await nextTick()
    await tabEl(w, 'meters').trigger('click')
    expect(push).not.toHaveBeenCalled()
  })

  it('❗拖到页签条上下 40px 以外松手:放回原位', async () => {
    setup(['ledger', 'tenants', 'contracts', 'meters'], 'ledger')
    const w = mount(TabStrip)
    tabEl(w, 'meters').element.dispatchEvent(ev('pointerdown', 450))
    window.dispatchEvent(ev('pointermove', 340))
    await nextTick()
    expect(vals()).toEqual([HOME, 'ledger', 'tenants', 'meters', 'contracts'])
    window.dispatchEvent(ev('pointerup', 340, 200))
    await nextTick()
    expect(vals()).toEqual([HOME, 'ledger', 'tenants', 'contracts', 'meters'])
  })

  it('触屏被浏览器接管成滚动(pointercancel):当作没拖过,不换位、不吞下一次点击', async () => {
    setup(['ledger', 'tenants', 'contracts', 'meters'], 'ledger')
    const w = mount(TabStrip)
    tabEl(w, 'meters').element.dispatchEvent(ev('pointerdown', 450))
    window.dispatchEvent(ev('pointermove', 440))
    window.dispatchEvent(ev('pointercancel', 440))
    window.dispatchEvent(ev('pointermove', 300))
    await nextTick()
    expect(vals()).toEqual([HOME, 'ledger', 'tenants', 'contracts', 'meters'])
    await tabEl(w, 'tenants').trigger('click')
    expect(push).toHaveBeenCalledWith('/tenants')
  })

  it('首页拖不动', async () => {
    setup(['ledger', 'tenants'], 'ledger')
    const w = mount(TabStrip)
    tabEl(w, HOME).element.dispatchEvent(ev('pointerdown', 50))
    window.dispatchEvent(ev('pointermove', 250))
    await nextTick()
    expect(vals()).toEqual([HOME, 'ledger', 'tenants'])
  })
})
