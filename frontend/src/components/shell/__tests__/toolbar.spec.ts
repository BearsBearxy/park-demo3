// 顶栏(TAB-BAR-SPEC §6):面包屑第一段能点、☆ = 收藏、首页上不出期间与 ☆、每个图标有说明气泡。
// 「❗」开头的做过破坏验证。
import { landNav } from '@/test-utils/landNav'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ourPark } from '@/test-utils/appConfig'
import { nextTick, reactive } from 'vue'
import { useTabsStore } from '@/stores/tabs'
import { useFavoritesStore } from '@/stores/favorites'
import { useAuthStore } from '@/stores/auth'
import { ALL_VIEWS } from '@/test-utils/perms'
import { useUpdateStore } from '@/stores/update'
import { tipState } from '../ShellTip.vue'
import FPReceiptHost from '@/components/fp/FPReceiptHost.vue'
import { receipts } from '@/utils/receipt'

const route = reactive({ meta: { value: 'tenants', page: '租户管理', layerLabel: '数据中心' } as Record<string, string>, path: '/tenants' })
const push = vi.fn(landNav)
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
}))
// C1-07 ③:数一下命令面板那个 chunk 被拉了几次。工厂只在模块首次被 import 时跑一次。
const pal = vi.hoisted(() => ({ loaded: 0 }))
vi.mock('@/components/shell/CommandPalette.vue', () => {
  pal.loaded++
  return { default: { name: 'CommandPaletteStub', render: () => null } }
})
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

import Toolbar from '../Toolbar.vue'

enableAutoUnmount(afterEach)

const mountBar = () => mount(Toolbar, { global: { stubs: { FPPresenceBar: true } }, attachTo: document.body })
const at = (value: string, page: string, layerLabel?: string) => {
  route.meta = { value, page, ...(layerLabel ? { layerLabel } : {}) }
  route.path = '/' + value
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia()); ourPark()
  const auth = useAuthStore()
  auth.me = 'zhou'
  auth.permissions = ['ledger:edit', ...ALL_VIEWS]   // RBAC v3:没有查看权的屏不留在页签条上
  at('tenants', '租户管理', '数据中心')
  push.mockClear()
  tipState.lastHide = 0
  receipts.splice(0)
})
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

describe('Toolbar · 面包屑(§6.2)', () => {
  it('❗不在这一层第一屏:第一段是按钮,点了当前页签回第一屏', async () => {
    const w = mountBar()
    const tabs = useTabsStore()
    tabs.open('tenants')
    tabs.setActive('tenants')
    const b = w.find('button.fp-crumb-grp')
    expect(b.text()).toBe('数据中心')
    await b.trigger('click')
    expect(push).toHaveBeenCalledWith('/data-home')
    expect(tabs.tabs.map(t => t.value), '当前页签那一格换成本月出账').toEqual(['home', 'data-home'])
  })

  it('❗已经在第一屏上:只是标签,点不了', () => {
    at('data-home', '本月出账', '数据中心')
    const w = mountBar()
    expect(w.find('button.fp-crumb-grp').exists()).toBe(false)
    expect(w.find('span.fp-crumb-grp').text()).toBe('数据中心')
  })

  it('其他层回各自第一屏:账簿与报表 → 报表中心', async () => {
    at('income-statement', '利润表', '账簿与报表')
    const w = mountBar()
    await w.find('button.fp-crumb-grp').trigger('click')
    expect(push).toHaveBeenCalledWith('/reports-home')
  })

  it('悬停 500ms 出说明「回到 数据中心 · 本月出账」', async () => {
    vi.useFakeTimers()
    const w = mountBar()
    await w.find('button.fp-crumb-grp').element.parentElement!.dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(499)
    await nextTick()
    expect(document.body.querySelector('.fp-tip')).toBeNull()
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(document.body.querySelector('.fp-tip')!.textContent).toBe('回到 数据中心 · 本月出账')
  })
})

describe('Toolbar · ☆ 收藏(§6.3,收藏成没成走底部结果回执)', () => {
  // 回执画在 FPReceiptHost 里(挂 body),文本 + 动作钮都在 .fpt 上
  const rcpt = () => [...document.body.querySelectorAll<HTMLElement>('.frh .fpt')]
  const undoBtn = () => rcpt().at(-1)?.querySelector<HTMLButtonElement>('.fpt-act')

  it('❗点 ☆ 收藏,变实心;底部出回执「已收藏，在「首页」上能找到 · 撤销」,不再有 ☆ 下方的条;点撤销收藏数回退', async () => {
    const f = useFavoritesStore()
    mount(FPReceiptHost, { attachTo: document.body })
    const w = mountBar()
    const before = f.list.length
    const star = () => w.find('.fp-star button')
    expect(star().attributes('aria-label')).toBe('收藏此页')
    expect(star().attributes('aria-pressed')).toBe('false')
    await star().trigger('click')
    expect(f.has('tenants')).toBe(true)
    expect(f.list.length).toBe(before + 1)
    expect(star().attributes('aria-pressed')).toBe('true')
    expect(w.find('.fp-star-on').exists()).toBe(true)
    expect(document.body.querySelector('.fp-star-note')).toBeNull()
    expect(rcpt()).toHaveLength(1)
    expect(rcpt()[0].querySelector('.fpt-m')?.textContent).toBe('已收藏，在「首页」上能找到')
    expect(undoBtn()?.textContent).toBe('撤销')
    undoBtn()!.click()
    await nextTick()
    expect(f.has('tenants')).toBe(false)
    expect(f.list.length).toBe(before)
    expect(rcpt(), '点了动作钮回执就收').toHaveLength(0)
  })

  // ❗回执是全站的,换了屏还在 —— 撤销必须撤刚收藏的那一页,不是「现在停在哪」(2026-09-18 对抗复查)
  it('❗换了屏再点撤销:撤的是刚收藏的那一页,不碰现在这一屏', async () => {
    const f = useFavoritesStore()
    mount(FPReceiptHost, { attachTo: document.body })
    const w = mountBar()
    f.toggle('contracts')                                   // 合同管理本来就收藏着
    await w.find('.fp-star button').trigger('click')      // 在租户管理点 ☆
    at('contracts', '合同管理', '数据中心')                 // 4 秒内切到别的屏
    await nextTick()
    undoBtn()!.click()
    expect(f.has('tenants')).toBe(false)
    expect(f.has('contracts'), '现在这屏的收藏不动').toBe(true)
  })

  it('回执 4 秒后自己收起;已收藏时再点直接取消,不出回执', async () => {
    vi.useFakeTimers()
    mount(FPReceiptHost, { attachTo: document.body })
    const w = mountBar()
    await w.find('.fp-star button').trigger('click')
    await nextTick()
    expect(rcpt()).toHaveLength(1)
    vi.advanceTimersByTime(4000)
    await nextTick()
    expect(rcpt()).toHaveLength(0)
    await w.find('.fp-star button').trigger('click')
    await nextTick()
    expect(useFavoritesStore().has('tenants')).toBe(false)
    expect(rcpt()).toHaveLength(0)
  })

  it('满 12 个:不加,出警告回执「最多收藏 12 个」', async () => {
    const f = useFavoritesStore()
    for (const v of ['ledger', 'contracts', 'buildings', 'meters', 'alloc', 'params', 'salary', 'utilities', 'import', 'cockpit', 'park']) f.toggle(v)
    expect(f.list.length).toBe(12)
    mount(FPReceiptHost, { attachTo: document.body })
    const w = mountBar()
    await w.find('.fp-star button').trigger('click')
    await nextTick()
    expect(f.has('tenants')).toBe(false)
    expect(receipts.map(r => [r.tone, r.text])).toEqual([['warn', '最多收藏 12 个，先在首页去掉几个']])
    expect(rcpt()[0].querySelector('.fpt-m')?.textContent).toBe('最多收藏 12 个，先在首页去掉几个')
  })

  it('☆ 在期间 chip 后面,不在最左边', () => {
    const w = mountBar()
    const html = w.find('.fp-toolbar').html()
    expect(html.indexOf('fp-ctx-chip')).toBeLessThan(html.indexOf('fp-star'))
    expect(html.indexOf('fp-crumb')).toBeLessThan(html.indexOf('fp-ctx-chip'))
  })
})

describe('Toolbar · 首页 / 新标签页(§5.6)', () => {
  it('❗面包屑只写页名;不出期间 chip,不出 ☆', () => {
    at('home', '首页')
    const w = mountBar()
    expect(w.find('.fp-crumb').text()).toBe('首页')
    expect(w.find('.fp-ctx-chip').exists()).toBe(false)
    expect(w.find('.fp-star').exists()).toBe(false)
  })
})

// 06-G 规则表「只挂在铃铛上」;06-E 系统组「有没看过的更新记录」→ 进铃铛(S5 FE-TOOLBAR)
describe('Toolbar · 铃铛', () => {
  // 破坏验证:✦ 后面加回 `<span v-if="upd.unread" class="fp-upd-dot" />` → 红
  it('❗有没看过的更新:✦ 那一格不挂点', () => {
    const upd = useUpdateStore()
    upd.loadSeen()
    expect(upd.unread, '前置:真有没看过的更新').toBe(true)
    const w = mountBar()
    expect(w.find('.fp-upd button[aria-label="版本更新"]').exists(), '选到的是 ✦ 那一格').toBe(true)
    expect(w.find('.fp-upd-dot').exists()).toBe(false)
    expect(w.find('.fp-upd [class*="dot"]').exists()).toBe(false)
  })

  // 破坏验证:把 <NotifyBell /> 换回原来 aria-label="待批授权" 的按钮 / 删掉 → 红
  it('❗顶栏只有一个铃铛,按钮名以「通知」开头,旧的「待批授权」按钮没了', () => {
    const w = mountBar()
    const bells = w.findAll('button').filter((b) => (b.attributes('aria-label') ?? '').startsWith('通知'))
    expect(bells).toHaveLength(1)
    expect(w.find('[aria-label="待批授权"]').exists()).toBe(false)
  })
})

describe('Toolbar · 其余', () => {
  it('上下文 chip:无期显「—」,有期显 期 · 公司', async () => {
    const w = mountBar()
    expect(w.find('.fp-ctx-chip').text()).toBe('—')
    useTabsStore().setCtx('tenants', { p: '2025-06', coName: '一期公司' })
    await nextTick()
    expect(w.find('.fp-ctx-chip').text()).toBe('2025-06 · 一期公司')
  })

  it('主题钮删除;搜索钮只承诺「页面 / 分组」', () => {
    const w = mountBar()
    expect(w.find('button[aria-label="浅色/深色模式"]').exists()).toBe(false)
    expect(w.find('.fp-search-btn').text()).toContain('搜索页面 / 分组')
    expect(w.find('.fp-search-btn').text()).not.toContain('租户')
  })

  it('搜索钮 pointerenter 预取命令面板 chunk(C1-07:首开不加指示器,把等挪到按下之前)', async () => {
    const w = mountBar()
    expect(pal.loaded).toBe(0)
    await w.find('.fp-search-btn').trigger('pointerenter')
    await new Promise(r => setTimeout(r, 0))
    expect(pal.loaded).toBe(1)
  })

  it('❗图标说明:收起一个后紧接着停到旁边的图标上立即出;按下鼠标即收', async () => {
    vi.useFakeTimers()
    mountBar()
    const wraps = [...document.body.querySelectorAll<HTMLElement>('.fp-toolbar .fp-tipw')]
    const search = wraps.find(el => el.querySelector('.fp-search-btn'))!
    const bell = wraps.find(el => el.querySelector('[aria-label^="通知"]'))!
    search.dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(document.body.querySelector('.fp-tip')!.textContent).toBe('搜索页面Ctrl K输入页面名直接跳过去')
    search.dispatchEvent(new MouseEvent('mouseleave'))
    bell.dispatchEvent(new MouseEvent('mouseenter'))
    await nextTick()
    expect(document.body.querySelector('.fp-tip')!.textContent).toBe('通知')
    bell.dispatchEvent(new MouseEvent('mousedown'))
    await nextTick()
    expect(document.body.querySelector('.fp-tip')).toBeNull()
  })
})
