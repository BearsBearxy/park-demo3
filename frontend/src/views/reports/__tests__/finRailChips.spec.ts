// src/views/reports/__tests__/finRailChips.spec.ts
// 三大报表屏:左轨 workbench 在 M/S 档收成顶部横滑 chips(RESPONSIVE-LAYOUT-SPEC §5.6 第 1 类)。
//
// 为什么是三份副本:.finw 那套外壳是 scoped 样式,利润表 / 资产负债表 / 科目余额表各带一份,
// 改漏一屏在 1440 上看不出来(桌面三屏都没变),所以每条都 it.each 三屏逐屏断。
//
// 钉四件事:
//   ① 960 块里轨收掉、chips 显出来,几何按台账屏那一份(36 高 / radius-full / overflow-x:auto);
//      选中态**只换色不改尺寸** —— 改尺寸就是点一下 chip 整行横滚位移(LAYOUT-STABILITY)。
//   ② 宽档零差异(§9):.finw-rail 的 flex:0 0 208px 原样留在媒体块**外**,960 块里不许出现。
//   ③ 层叠位置:960 块必须排在 .finw-rail 基础规则**之后**。同特异性按源序,写在前面
//      `display:none` 会被后面的 `display:flex` 静默盖回去 —— 屏上轨照样占 208px,
//      而「块里写了 display:none」这条断言照样绿。位置不进断言就等于没断。
//   ④ 管理那颗是虚线 chip,点它**开面板**而不是直接执行删除;面板里三颗钮一个不少
//      (收轨不等于收权限)。
//
// 为什么读源码字面量而不是挂载后量:jsdom 不做布局也不算 @media,挂载断言在这里只能得到恒真式
// (同 kpiNarrowTier.spec 的理由)。DOM 侧只断结构(chips 行在不在、几颗、点了开什么)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaBlock } from '@/test-utils/mediaBlock'

import { useAuthStore } from '@/stores/auth'
import { _resetViewportForTest } from '@/composables/useViewport'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'
import IncomeStatementView from '../income-statement/IncomeStatementView.vue'
import BalanceSheetView from '../balance-sheet/BalanceSheetView.vue'
import TrialBalanceView from '../trial-balance/TrialBalanceView.vue'

vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() },
  ledgerApi: {},
}))
vi.mock('@/api/report', () => ({
  reportApi: {
    years: vi.fn(), year: vi.fn(), period: vi.fn(), allPeriod: vi.fn(), save: vi.fn(),
    addCustomRow: vi.fn(), deleteCustomRow: vi.fn(),
  },
}))
vi.mock('@/api/review', () => ({
  reviewApi: {
    list: vi.fn(() => Promise.resolve([])), states: vi.fn(() => Promise.resolve([])),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(), recall: vi.fn(),
    closedMonths: vi.fn(() => Promise.resolve([])), pending: vi.fn(() => Promise.resolve([])),
  },
}))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: vi.fn(() => Promise.resolve({ granted: true, holder: null, acquiredAt: 1 })),
    release: vi.fn(() => Promise.resolve()), releaseOnUnload: vi.fn(),
    heartbeat: vi.fn(() => Promise.resolve({ evicted: null })),
    takeover: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
  },
}))
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRoute: () => ({ query, meta: { value: 'reports' }, get fullPath() { return '/reports' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

// ⚠ 夹具不退化:三家公司名字各不相同且都不叫「全部汇总」——
// 只放一家的话「chips 数 = 轨项数 + 管理那颗」写成任何常数都绿,选中态也永远落在第一颗。
const COMPANIES = [
  { id: 7, name: '物业公司', short: '物业' },
  { id: 8, name: '建设公司', short: '建设' },
  { id: 9, name: '能源公司', short: '能源' },
]
/** 轨项 = 「全部汇总」+ 三家 = 4;chips = 轨项 4 + 管理那颗 = 5 */
const RAIL_ITEMS = COMPANIES.length + 1
const CHIPS = RAIL_ITEMS + 1

const read = (rel: string) =>
  readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n')
/** 只取 <style> 段并去注释:注释里出现的 208px / display:none 不该被当成规则 */
const styleOf = (rel: string) => {
  const src = read(rel)
  return src.slice(src.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '')
}

const SCREENS = [
  ['利润表', 'income-statement/IncomeStatementView.vue', IncomeStatementView, ['960', '600']],
  // 2026-09-21:§5.7 给本屏新开了 600 块(KPI 横滑),所以断点从 ['960'] 变 ['960','600']。
  // 有序 toEqual 不改成集合 —— 它同时钉着「宽档在前窄档在后」,那一条不能松。
  ['资产负债表', 'balance-sheet/BalanceSheetView.vue', BalanceSheetView, ['960', '600']],
  ['科目余额表', 'trial-balance/TrialBalanceView.vue', TrialBalanceView, ['960', '600']],
] as const

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['master:edit', 'report:edit']
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(companyApi.list).mockResolvedValue(COMPANIES as never)
  vi.mocked(reportApi.years).mockResolvedValue([{ year: 2025, months: 3 }] as never)
  vi.mocked(reportApi.year).mockResolvedValue({
    year: 2025,
    months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hasData: i < 3, netPreview: 1000 })),
  } as never)
})
afterEach(() => {
  vi.unstubAllGlobals()
  _resetViewportForTest()
})

async function open(comp: unknown) {
  const w = mount(comp as never, {
    global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } },
  })
  await flushPromises()
  return w
}

describe('§5.6 ① 960 块:左轨收掉、chips 显出来,几何按台账屏那一份', () => {
  it.each(SCREENS)('%s', async (_n, rel) => {
    const css = styleOf(rel)
    const m = mediaBlock(css, '@media (max-width: 960px)')
    expect(m, `${rel} 取不到 960 块 —— 后面几条会变成「空串里找不到」的恒真`).not.toBe('')

    expect(m).toMatch(/\.finw\s*\{[^}]*flex-direction:\s*column/)
    expect(m).toMatch(/\.finw-rail\s*\{\s*display:\s*none;?\s*\}/)
    expect(m).toMatch(/\.finw-chips\s*\{[^}]*display:\s*flex/)
    expect(m).toMatch(/\.finw-chips\s*\{[^}]*overflow-x:\s*auto/)
    // chip 36 高 / 胶囊圆角(台账 .lgw-chip 原值)
    expect(m).toMatch(/\.finw-chip\s*\{[^}]*height:\s*36px/)
    expect(m).toMatch(/\.finw-chip\s*\{[^}]*border-radius:\s*var\(--radius-full\)/)
    expect(m).toMatch(/\.finw-chip\s*\{[^}]*white-space:\s*nowrap/)
    // 管理那颗:虚线
    expect(m).toMatch(/\.finw-chip\.mng\s*\{[^}]*border-style:\s*dashed/)
  })

  it.each(SCREENS)('%s:选中态只换色不改尺寸(改尺寸 = 点一下 chip 整行位移)', async (_n, rel) => {
    const m = mediaBlock(styleOf(rel), '@media (max-width: 960px)')
    const on = m.match(/\.finw-chip\.on\s*\{([^}]*)\}/)
    expect(on, '.finw-chip.on 这条规则没找到 —— 下面的「不含尺寸属性」会恒真').not.toBeNull()
    const decls = on![1]
    expect(decls).toContain('background:')
    for (const banned of ['height', 'padding', 'font-size', 'border-width', 'border-style', 'margin', 'gap']) {
      expect(decls, `.finw-chip.on 里出现了 ${banned}:选中会改尺寸`).not.toContain(banned)
    }
  })
})

describe('§5.6 ② 宽档零差异(§9):208px 定宽轨原样留在媒体块外', () => {
  it.each(SCREENS)('%s:基础规则仍是 flex: 0 0 208px', async (_n, rel) => {
    const outside = styleOf(rel).replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    expect(outside).toMatch(/\.finw-rail\s*\{[^}]*flex:\s*0 0 208px/)
    expect(outside).toMatch(/\.finw\s*\{[^}]*display:\s*flex/)
    // chips 行的「桌面不存在」这条必须在块外:写进 960 块 = 桌面反而显出来
    expect(outside).toMatch(/\.finw-chips\s*\{\s*display:\s*none;?\s*\}/)
  })

  it.each(SCREENS)('%s:反向 —— 960 块里不许出现 flex: 0 0 208px', async (_n, rel) => {
    const m = mediaBlock(styleOf(rel), '@media (max-width: 960px)')
    expect(m, '空串里当然找不到 208px;先确认块里真有 chips 规则').toContain('.finw-chips')
    expect(m).not.toContain('0 0 208px')
  })

  it.each(SCREENS)('%s:断点只有 600/960,且宽档在前', async (_n, rel, _c, order) => {
    const css = styleOf(rel)
    expect([...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map(x => x[1])).toEqual([...order])
  })
})

describe('§5.6 ③ 层叠位置:960 块排在 .finw-rail 基础规则之后(写反是静默失效)', () => {
  it.each(SCREENS)('%s', async (_n, rel) => {
    const css = styleOf(rel)
    const base = css.search(/\.finw-rail\s*\{[^}]*flex:\s*0 0 208px/)
    const at960 = css.indexOf('@media (max-width: 960px)')
    expect(base, '.finw-rail 基础规则没找到').toBeGreaterThan(-1)
    expect(at960, '960 块没找到').toBeGreaterThan(-1)
    expect(at960, '960 块写在基础规则之前:display:none 会被后面的 display:flex 盖回去').toBeGreaterThan(base)
  })
})

describe('§5.6 ④ DOM:chips 行在轨后面,轨项 + 管理那颗', () => {
  it.each(SCREENS)('%s:chips 行紧跟在左轨之后,共 %s 颗', async (_n, _rel, comp) => {
    const w = await open(comp)
    const row = w.find('.finw-chips')
    expect(row.exists()).toBe(true)
    expect(row.element.previousElementSibling?.className, 'chips 行没挨着左轨').toContain('finw-rail')

    const chips = w.findAll('.finw-chips .finw-chip')
    expect(chips).toHaveLength(CHIPS)
    expect(chips[0].text()).toBe('全部汇总')
    expect(chips.slice(1, RAIL_ITEMS).map(c => c.text())).toEqual(COMPANIES.map(c => c.name))
    expect(chips[CHIPS - 1].text()).toBe('管理')

    // 选中态落在进屏自动选中的首家(不是「全部汇总」,也不是恒定第一颗)
    const on = w.findAll('.finw-chips .finw-chip.on')
    expect(on).toHaveLength(1)
    expect(on[0].text()).toBe('物业公司')
  })

  it.each(SCREENS)('%s:点 chip 换公司,选中态跟着走(与轨内点击同源)', async (_n, _rel, comp) => {
    const w = await open(comp)
    const chips = w.findAll('.finw-chips .finw-chip')
    await chips[3].trigger('click')          // 第三家:能源公司
    await flushPromises()
    expect(w.find('.finw-chips .finw-chip.on').text()).toBe('能源公司')
  })

  it.each(SCREENS)('%s:管理是虚线 chip —— 点它开面板,不是直接删', async (_n, _rel, comp) => {
    const w = await open(comp)
    const mng = w.findAll('.finw-chips .finw-chip.mng')
    expect(mng).toHaveLength(1)
    expect(w.find('[aria-label="管理公司"]').exists(), '面板一进屏就开着').toBe(false)

    await mng[0].trigger('click')
    const panel = w.find('[aria-label="管理公司"]')
    expect(panel.exists(), '点管理 chip 没开面板').toBe(true)
    // 三颗管理钮一颗不少(收轨不等于收权限),且点 chip 本身不触发任何写操作
    expect(panel.findAll('.finw-mbtn').map(b => b.text())).toEqual(['新增', '重命名', '删除'])
    expect(companyApi.remove).not.toHaveBeenCalled()
    expect(companyApi.rename).not.toHaveBeenCalled()
  })

  it.each(SCREENS)('%s:无 master:edit 时没有管理那颗(门不因收轨而消失或凭空多出)', async (_n, _rel, comp) => {
    useAuthStore().permissions = ['report:edit']
    const w = await open(comp)
    const chips = w.findAll('.finw-chips .finw-chip')
    expect(chips).toHaveLength(RAIL_ITEMS)
    expect(chips.some(c => c.classes('mng'))).toBe(false)
  })

  it.each(SCREENS)('%s:XL 档左轨照旧渲染(§9 桌面零差异)', async (_n, _rel, comp) => {
    const w = await open(comp)
    expect(w.find('.finw-rail').exists()).toBe(true)
    expect(w.findAll('.finw-rail .br-item')).toHaveLength(RAIL_ITEMS)
  })
})

describe('§5.6 S 档:面板是全屏 sheet(壳复用 form-sheet.css,不新造组件)', () => {
  it.each(SCREENS)('%s', async (_n, _rel, comp) => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('max-width: 600px') || q.includes('max-width: 960px'),
      media: q, addEventListener() {}, removeEventListener() {},
    }))
    _resetViewportForTest()
    const w = await open(comp)
    await w.find('.finw-chip.mng').trigger('click')
    const mask = w.find('[aria-label="管理公司"]').element.parentElement
    expect(mask?.className, 'S 档没挂 .fp-fsheet:面板还是 390 宽里的居中小卡').toContain('fp-fsheet')
  })
})
