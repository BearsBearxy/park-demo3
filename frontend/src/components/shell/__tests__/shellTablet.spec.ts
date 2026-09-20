// 平板外壳(RESPONSIVE-LAYOUT-SPEC §3.3 §3.5 §6):平板 = 小桌面 —— 图标轨与页签条照渲,
// 顶栏横向收编,触屏把「hover 才出」的钮换成常显。「❗」开头的做过破坏验证。
//
// 档位与触屏都走 useViewport 的 matchMedia;jsdom 原生 matchMedia 一律 matches:false
// (= XL 档 + 非触屏),所以不 stub 的用例就是桌面现状。单例每条用例重建。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTabsStore, HOME, NEWTAB } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { usePresenceStore, type Seat } from '@/stores/presence'
import { _resetViewportForTest } from '@/composables/useViewport'
import { landNav } from '@/test-utils/landNav'

const route = reactive({ meta: { value: 'tenants', page: '租户管理', layerLabel: '数据中心' } as Record<string, string>, path: '/tenants' })
const push = vi.fn(landNav)
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
}))
vi.mock('@/components/shell/CommandPalette.vue', () => ({ default: { name: 'CommandPaletteStub', render: () => null } }))
vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve({})),
    put: vi.fn(() => Promise.resolve({ users: [] })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 't'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

import TabStrip from '@/components/shell/TabStrip.vue'
import Toolbar from '@/components/shell/Toolbar.vue'
import FPPresenceBar from '@/components/fp/FPPresenceBar.vue'

enableAutoUnmount(afterEach)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never

const SRC = join(__dirname, '..', '..', '..')
const src = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

/**
 * 视口桩:`width` 喂给三条 max-width 查询(断点值只有 600/960/1280),
 * `touch` 单独喂 `(hover: none)` —— 触屏判定按输入能力不按宽度(§6),
 * 所以两者必须能各判各的:1024 宽 + 触屏(iPad 横屏)是真实组合。
 */
function viewport({ width = 1440, touch = false }: { width?: number; touch?: boolean } = {}) {
  vi.stubGlobal('matchMedia', (q: string) => {
    const mx = /max-width:\s*(\d+)px/.exec(q)
    return {
      matches: q.includes('hover: none') ? touch : mx ? width <= Number(mx[1]) : false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as MediaQueryList
  })
  _resetViewportForTest()
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  const auth = useAuthStore()
  auth.me = 'zhou'
  auth.permissions = ['ledger:edit']
  route.meta = { value: 'tenants', page: '租户管理', layerLabel: '数据中心' }
  route.path = '/tenants'
  push.mockClear()
  _resetViewportForTest()
})
afterEach(() => {
  vi.unstubAllGlobals()
  _resetViewportForTest()
  document.body.innerHTML = ''
})

// ── TabStrip ──────────────────────────────────────────────────────────────
/** 开几个页签,路由落在 active。jsdom 无布局 → 条宽量出来是 0 → 页签宽算到下限 96(<XMIN 120)。 */
function setupTabs(values: string[], active = values[0]) {
  const tabs = useTabsStore()
  for (const v of values) tabs.openBackground(v)
  tabs.setActive(active)
  route.meta = { value: active }
  route.path = '/' + active
  return tabs
}
const tabEl = (w: VueWrapper, v: string) => w.find(`[data-tabv="${v}"]`)
const withX = (w: VueWrapper) =>
  w.findAll('[data-tabv]').filter(t => t.find('.fp-tab-x').exists()).map(t => t.attributes('data-tabv'))
const withPin = (w: VueWrapper) =>
  w.findAll('[data-tabv]').filter(t => t.find('.fp-tab-pin').exists()).map(t => t.attributes('data-tabv'))

const TABS = ['ledger', 'tenants', 'contracts', 'meters', 'alloc', 'params', 'salary', 'utilities', 'import']

describe('TabStrip · 触屏常显(§6.1 §6.3)', () => {
  it('❗(hover: none):每个非固定页签都有 ×,每个固定得了的页签都有固定钮', async () => {
    viewport({ width: 768, touch: true })
    setupTabs(TABS, 'tenants')
    const w = mount(TabStrip)
    await nextTick()
    // 页签宽 96 < XMIN 120,触屏又永远不会有 hoverV:不常显就只剩当前签这一个 × 点得到
    expect(withX(w)).toEqual(TABS)
    // 固定钮**只挂当前签**(和已固定签,见下一条)。给每个签都挂的代价算得出来:
    // TAB.MIN=96,扣图标 16 + 固定钮 20 + 关闭钮 20 + padding 16 + 三处 gap,标题只剩个位数像素 ——
    // 稿(ShellTablet)只写「Pin 钮常显即唯一入口」,图上一颗固定钮都没画,尺寸与落位它没给。
    // 「唯一入口」要的是「想固定当前这屏时有地方点」,当前签上有就够了。
    expect(withPin(w)).toEqual(['tenants'])
    expect(tabEl(w, HOME).find('.fp-tab-pin').exists(), '首页恒固定,unpin 拒绝它').toBe(false)
  })

  it('❗已固定的签也留着固定钮 —— 否则取消固定在触屏上就没入口了', async () => {
    viewport({ width: 768, touch: true })
    const tabs = setupTabs(TABS, 'tenants')
    tabs.pin('ledger')
    const w = mount(TabStrip)
    await nextTick()
    // 当前签 tenants + 已固定的 ledger,两颗;其余非当前非固定的签一颗都没有
    expect(withPin(w).sort()).toEqual(['ledger', 'tenants'])
  })

  it('❗(hover: hover):× 回到「当前签 + 鼠标停着的那个」,固定钮一个都不渲染', async () => {
    viewport({ width: 768, touch: false })
    setupTabs(TABS, 'tenants')
    const w = mount(TabStrip)
    await nextTick()
    expect(withX(w)).toEqual(['tenants'])
    expect(withPin(w)).toEqual([])
    await tabEl(w, 'meters').trigger('mouseenter')
    expect(withX(w)).toEqual(['tenants', 'meters'])
  })

  it('❗固定钮真的固定/取消固定;新标签页没有(与右键菜单同口径)', async () => {
    viewport({ width: 768, touch: true })
    const tabs = setupTabs(['ledger', 'tenants'], 'tenants')
    const w = mount(TabStrip)
    await w.find('.fp-tab-new').trigger('click')   // 开新标签页(登记只在导航落定后兑现)
    await nextTick()
    expect(tabEl(w, NEWTAB).exists()).toBe(true)
    expect(tabEl(w, NEWTAB).find('.fp-tab-pin').exists()).toBe(false)

    // ledger 不是当前签也没固定 → 没有固定钮;切过去才有(固定钮只挂当前签与已固定签)
    expect(tabEl(w, 'ledger').find('.fp-tab-pin').exists()).toBe(false)
    tabs.setActive('ledger'); route.meta = { value: 'ledger' }
    await nextTick()
    const pin = tabEl(w, 'ledger').find('.fp-tab-pin')
    expect(pin.attributes('aria-pressed')).toBe('false')
    await pin.trigger('click')
    expect(tabs.tabs.find(t => t.value === 'ledger')?.pinned).toBe(true)
    expect(tabEl(w, 'ledger').find('.fp-tab-pin').attributes('aria-pressed')).toBe('true')
    await tabEl(w, 'ledger').find('.fp-tab-pin').trigger('click')
    expect(tabs.tabs.find(t => t.value === 'ledger')?.pinned).toBeFalsy()
  })

  it('❗桌面的右键入口没被删:右键菜单仍有「固定」一项', async () => {
    setupTabs(['ledger', 'tenants'], 'tenants')
    const w = mount(TabStrip)
    await tabEl(w, 'ledger').trigger('contextmenu', { clientX: 300, clientY: 30 })
    const rows = [...document.body.querySelectorAll('.fp-tab-menu .row')].map(r => r.textContent ?? '')
    expect(rows.some(t => t.startsWith('固定'))).toBe(true)
  })

  it('❗常显 = 可达:hover:none 块里 × 是 opacity .55,不是 0 / display:none', () => {
    const css = src('components/shell/TabStrip.vue')
    const block = /@media \(hover: none\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(block).toMatch(/\.fp-tab-x \{ opacity: 0\.55; \}/)
    expect(block).not.toMatch(/opacity: 0;/)
    expect(block).not.toMatch(/display: none/)
    // 固定签 44px = 图标 16 + 钮 20 + 间距:间距收到 2 才留得出左右各 3
    expect(block).toMatch(/\.fp-tab\.pn \{ gap: 2px; \}/)
    // ⚠ 按规则体取,不用 `[\s\S]*?`:懒量词会从 .fp-tab-pin 一路扫到 @media(hover:none) 里
    //   .fp-tab-x 的那条 opacity,把别人的值认成自己的 —— 固定钮改成完全不可见这条照样绿
    //   (2026-09-20 对抗复查实跑验证)。
    expect(css.match(/\.fp-tab-pin \{[^}]*\}/)![0]).toMatch(/opacity: 0\.55;/)
  })

  it('❗页签条高度 44 在 M 档不变:没有任何媒体查询改 .fp-tabstrip 的高', () => {
    const css = src('components/shell/TabStrip.vue')
    // 同上:44 必须落在 .fp-tabstrip 自己的规则体里。下面两条只管「全文件一处」「不在媒体块内」,
    // 不管它落在哪条规则上 —— 页签条整个不定高、44 挪到别的类上,三条都绿。
    expect(css.match(/\.fp-tabstrip \{[^}]*\}/)![0]).toMatch(/height: 44px;/)
    // 全文件只有一处 height: 44px,且它不在任何 @media 块里
    expect(css.match(/height: 44px/g)).toHaveLength(1)
    expect(css.slice(css.indexOf('@media'))).not.toMatch(/height: 44px/)
  })
})

// ── Toolbar ───────────────────────────────────────────────────────────────
const mountBar = () => mount(Toolbar, { global: { stubs: { FPPresenceBar: true } }, attachTo: document.body })

describe('Toolbar · M 档收编(§3.3 §6.2)', () => {
  it('❗M 档(768):面包屑只剩屏名一段,且仍是 button —— 点了回本层第一屏', async () => {
    viewport({ width: 768 })
    const w = mountBar()
    expect(w.findAll('.fp-crumb-grp')).toHaveLength(0)
    expect(w.findAll('.fp-crumb-sep')).toHaveLength(0)
    const crumbs = w.findAll('.fp-crumb-page')
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].element.tagName).toBe('BUTTON')
    expect(crumbs[0].text()).toBe('租户管理')
    await crumbs[0].trigger('click')
    expect(push).toHaveBeenCalledWith('/data-home')
  })

  it('❗M 档已经在本层第一屏:点不了才退回 span(和 XL 同一条判据)', () => {
    viewport({ width: 768 })
    route.meta = { value: 'data-home', page: '本月出账', layerLabel: '数据中心' }
    route.path = '/data-home'
    const w = mountBar()
    const crumbs = w.findAll('.fp-crumb-page')
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].element.tagName).toBe('SPAN')
  })

  it('❗XL 档(1440)仍是多级:层名按钮 + / + 屏名 span,一个字不变', () => {
    viewport({ width: 1440 })
    const w = mountBar()
    expect(w.find('button.fp-crumb-grp').text()).toBe('数据中心')
    expect(w.find('.fp-crumb-sep').text()).toBe('/')
    const page = w.find('.fp-crumb-page')
    expect(page.element.tagName).toBe('SPAN')
    expect(page.text()).toBe('租户管理')
  })

  it('❗顶栏高 48 不变;搜索框在 M↓ 收成 40 图钮(高度不参与收编)', () => {
    const css = src('components/shell/Toolbar.vue')
    expect(css).toMatch(/\.fp-toolbar \{\s*\n\s*height: 48px;/)
    expect(css.match(/height: 48px/g)).toHaveLength(1)
    const m = /@media \(max-width: 960px\) \{ \/\* M↓ \*\/([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(m).toMatch(/\.fp-search-btn \{[\s\S]*?width: 40px;/)
    expect(m).not.toMatch(/height:/)
    // 面包屑不许再靠 display:none 收 —— 那会把可点入口一起藏掉(§6.2)
    expect(m).not.toMatch(/fp-crumb/)
  })

  it('断点只用 600/960/1280:本板三个文件里没有第四个媒体宽度值', () => {
    for (const f of ['components/shell/Toolbar.vue', 'components/shell/TabStrip.vue', 'components/fp/FPPresenceBar.vue']) {
      const widths = [...src(f).matchAll(/@media[^{]*?(?:max|min)-width:\s*(\d+)px/g)].map(m => m[1])
      expect(widths.every(v => ['600', '960', '1280'].includes(v)), `${f}: ${widths.join()}`).toBe(true)
    }
  })
})

// ── FPPresenceBar ─────────────────────────────────────────────────────────
const seat = (user: string, displayName: string, o: Partial<Seat> = {}): Seat => ({
  sid: 's-' + user, user, displayName, role: null, scope: null, label: '月度台账', mode: 'view',
  editScopes: [], sinceMs: 252_000, idleMs: 0, self: false, ...o,
})
function people(n: number) {
  usePresenceStore().users = [
    seat('zhou', '周明', { self: true }),
    ...Array.from({ length: n }, (_, i) => seat('u' + i, '员工' + i)),
  ]
}

describe('FPPresenceBar · L↓ 收成徽记(§3.2)', () => {
  it('❗徽记定宽 76:人数 3 → 12 只换字不换宽(宽度不来自内容,也没有内联 style)', async () => {
    viewport({ width: 1024 })
    people(2)
    const w = mount(FPPresenceBar)
    await nextTick()
    const pb = w.find('.pb')
    expect(w.find('.pb-count').text()).toBe('3 人')
    const cls = pb.classes().join(' ')
    expect(pb.attributes('style'), '宽度只许来自 CSS 定宽').toBeUndefined()

    usePresenceStore().users = [seat('zhou', '周明', { self: true }), ...Array.from({ length: 11 }, (_, i) => seat('u' + i, '员工' + i))]
    await nextTick()
    expect(w.find('.pb-count').text()).toBe('12 人')
    expect(w.find('.pb').classes().join(' ')).toBe(cls)
    expect(w.find('.pb').attributes('style')).toBeUndefined()
  })

  it('❗定宽写在 L↓ 媒体块里:76px,断点是 1280(不是 1100/1200 这类野值)', () => {
    const css = src('components/fp/FPPresenceBar.vue')
    expect(css).toMatch(/\.pb \{\s*\n\s*width: 256px;/)                       // XL 满员宽
    const l = /@media \(max-width: 1280px\) \{ \/\* L↓ \*\/([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(l).toMatch(/\.pb \{\s*\n\s*width: 76px;/)
    expect(l).toMatch(/\.pb-count \{\s*\n?\s*display: inline-flex/)
  })
})
