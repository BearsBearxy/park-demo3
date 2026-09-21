// src/views/reports/trial-balance/__tests__/tbCardS.spec.ts
// 科目余额表 S 档 行→卡片(稿 ReportPhone §2 表第 3 行:形态 = 行→卡片,标准 88 档)。
//
// 钉三件事:
//   ① 卡是 88 档,且卡面每个字段确实来自它该来的那一列(6 根数值列只挑得出 3~4 个字段,
//      挑错列没人看得出来 —— 屏上只剩一个数);
//   ② 折叠没丢:卡片档没有 ▸,整卡点击接管展开/收起,否则手机上除了搜索再看不到下级科目;
//   ③ 宽档仍是 <table>(1440 零差异),编辑态即使在 S 档也仍是 <table> ——
//      §11.2(2026-08-30 用户拍板)手机录入「不禁止、不隐藏」,而卡片上没有输入格。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import { _resetViewportForTest } from '@/composables/useViewport'
import TrialBalanceView from '../TrialBalanceView.vue'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'

vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() },
  ledgerApi: {},
}))
vi.mock('@/api/report', () => ({
  reportApi: { years: vi.fn(), year: vi.fn(), period: vi.fn(), allPeriod: vi.fn(), save: vi.fn() },
}))
vi.mock('@/api/review', () => ({
  reviewApi: {
    list: vi.fn(() => Promise.resolve([])), states: vi.fn(() => Promise.resolve([])),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(), recall: vi.fn(),
    closedMonths: vi.fn(() => Promise.resolve([])), pending: vi.fn(() => Promise.resolve([])),
  },
}))
// 进编辑要先占锁(CONCURRENCY-SPEC §4);这里只需要它批下来
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: vi.fn(() => Promise.resolve({ granted: true, holder: null, acquiredAt: 1 })),
    release: vi.fn(() => Promise.resolve()),
    releaseOnUnload: vi.fn(),
    heartbeat: vi.fn(() => Promise.resolve({ evicted: null })),
    takeover: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
  },
}))
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRoute: () => ({ query, meta: { value: 'trial-balance' }, get fullPath() { return '/trial-balance' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

/** S 档桩(照 fpWideCards.spec:15):只让 ≤600 命中 */
function asS() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 600px'), media: q,
    addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

// 科目树:三个一级 + 一个挂在 1002 下的二级(默认折叠,点卡才出来)
const ACCOUNTS = [
  { rowKey: '1001', parentKey: null, code: '1001', label: '库存现金', level: 0, sortOrder: 0 },
  { rowKey: '1002', parentKey: null, code: '1002', label: '银行存款', level: 0, sortOrder: 1 },
  { rowKey: '100201', parentKey: '1002', code: '100201', label: '农商行', level: 1, sortOrder: 2 },
  { rowKey: '2202', parentKey: null, code: '2202', label: '应付账款', level: 0, sortOrder: 3 },
  // 期末借贷皆 0 的科目:专为「不画胶囊」那条分支准备 —— 没有它,那个 null 分支
  // 在整套夹具里走不到,tbCard 里写成恒画胶囊也照样全绿(2026-09-20 对抗复查实测)
  { rowKey: '6602', parentKey: null, code: '6602', label: '管理费用', level: 0, sortOrder: 4 },
]
// ⚠ 夹具不退化:期初/本期借/本期贷/期末四类值两两不等,且 1001/1002 余额在**借方**、
// 2202 在**贷方** —— 全挂一边的话「借贷方向跟着数走」写死一个方向也绿。
const AMOUNTS: Record<string, Record<string, number>> = {
  '1001':   { openDr: 5000,   periodDr: 12000,  periodCr: 9000,   endDr: 8000 },
  '1002':   { openDr: 260000, periodDr: 480000, periodCr: 315000, endDr: 425000 },
  '100201': { openDr: 60000,  periodDr: 70000,  periodCr: 40000,  endDr: 90000 },
  '2202':   { openCr: 74000,  periodDr: 30000,  periodCr: 52000,  endCr: 96000 },
  // 本期有发生额但结平:期末两侧都是 0
  '6602':   { periodDr: 18000, periodCr: 18000 },
}

function wire() {
  vi.mocked(companyApi.list).mockResolvedValue([{ id: 1, name: '物业公司', short: '物业' }] as never)
  vi.mocked(reportApi.years).mockResolvedValue([{ year: 2025, months: 3 }] as never)
  vi.mocked(reportApi.year).mockResolvedValue({
    year: 2025,
    months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hasData: i < 3, netPreview: 0 })),
  } as never)
  vi.mocked(reportApi.period).mockResolvedValue({
    year: 2025, month: 1, rows: [], customRows: [], amounts: AMOUNTS, accounts: ACCOUNTS,
  } as never)
}

/** 开屏 → 点第一个月格进正文 */
async function openBody() {
  const w = mount(TrialBalanceView, {
    global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } },
  })
  await flushPromises()
  await w.findAll('.bmm-card')[0].trigger('click')
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['master:edit', 'report:edit']
  vi.clearAllMocks()
  localStorage.clear()
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  wire()
  asS()
})
afterEach(() => { vi.unstubAllGlobals(); _resetViewportForTest() })

describe('科目余额表 · S 档行→卡片', () => {
  it('❗S 档查看态出 88 档卡片,表不再渲;行数 = 折叠后的可见行(默认只到一级)', async () => {
    const w = await openBody()
    expect(w.find('table.tb-table').exists(), 'S 档查看态还在渲表').toBe(false)
    const cards = w.findAll('.fpwc-c')
    expect(cards, '默认折叠到一级 = 四张卡(1001 / 1002 / 2202 / 6602,100201 折在 1002 下)').toHaveLength(4)
    expect(cards.every(c => c.classes().includes('d88')), '不是标准 88 档').toBe(true)
  })

  it('❗卡面四个字段各自来自它该来的那一列(代码+名称 / 期末 / 借贷方向 / 期初·本期)', async () => {
    const w = await openBody()
    const cards = w.findAll('.fpwc-c')

    // 1001:余额在借方 → 主数取 endDr,胶囊是「期末借方」
    expect(cards[0].find('.nm').text()).toBe('1001 库存现金')
    expect(cards[0].find('.amt').text()).toBe('¥8,000.00')
    expect(cards[0].find('.pill').text()).toBe('期末借方')
    expect(cards[0].find('.sub').text()).toBe('期初 ¥5,000.00 · 本期借 ¥12,000.00 · 本期贷 ¥9,000.00')

    // 1002 有一个下级 → 末行缀「下级 1」(卡片档没有 ▸,这个数是「点得开」的唯一提示)
    expect(cards[1].find('.amt').text()).toBe('¥425,000.00')
    expect(cards[1].find('.sub').text()).toBe('期初 ¥260,000.00 · 本期借 ¥480,000.00 · 本期贷 ¥315,000.00 · 下级 1')

    // 2202:借方为 0 → 主数取 endCr、期初取 openCr,胶囊换成「期末贷方」
    expect(cards[2].find('.nm').text()).toBe('2202 应付账款')
    expect(cards[2].find('.amt').text()).toBe('¥96,000.00')
    expect(cards[2].find('.pill').text()).toBe('期末贷方')
    expect(cards[2].find('.sub').text()).toBe('期初 ¥74,000.00 · 本期借 ¥30,000.00 · 本期贷 ¥52,000.00')
    // 叶子行不缀「下级」
    expect(cards[0].find('.sub').text()).not.toContain('下级')

    // 胶囊色调:借贷方向是**方位**不是好坏,三态都走 info,不许被涂成 ok/warn
    expect(cards[0].find('.pill').classes()).toContain('info')
    expect(cards[2].find('.pill').classes()).toContain('info')
    expect(cards[0].find('.pill').classes()).not.toContain('warn')

    // 6602 期末借贷皆 0 → 不画胶囊(没有方向可言,画一个「期末借方 ¥0」是在编方向)
    expect(cards[3].find('.nm').text()).toBe('6602 管理费用')
    expect(cards[3].find('.pill').exists(), '期末为 0 的科目不该有借贷方向胶囊').toBe(false)
    expect(cards[3].find('.amt').text()).toBe('¥0.00')
  })

  it('❗整卡点击接管 ▸ 的活:点父卡展开下级,再点收起;叶子卡点了不动', async () => {
    const w = await openBody()
    await w.findAll('.fpwc-c')[1].trigger('click')          // 1002 银行存款
    expect(w.findAll('.fpwc-c')).toHaveLength(5)
    expect(w.findAll('.fpwc-c')[2].find('.nm').text()).toBe('100201 农商行')

    await w.findAll('.fpwc-c')[1].trigger('click')          // 收起
    expect(w.findAll('.fpwc-c')).toHaveLength(4)

    await w.findAll('.fpwc-c')[0].trigger('click')          // 叶子:无下级可展
    expect(w.findAll('.fpwc-c')).toHaveLength(4)
  })

  it('❗编辑态即使在 S 档也仍是表(§11.2:手机录入不禁止、不隐藏 —— 卡片上没有输入格)', async () => {
    const w = await openBody()
    await w.find("button.fp-emb").trigger('click')
    await flushPromises()
    expect(w.find('table.tb-table').exists(), '编辑态被换成了卡片 = 手机上没法录入').toBe(true)
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
    expect(w.findAll('table.tb-table input.fin-ni').length, '行内录入格没了').toBeGreaterThan(0)
    // 荐桌面那行提示随编辑态出文案(位置常驻,见 TrialBalanceView .tb-s-hint)
    expect(w.find('.tb-s-hint').text()).toBe('编辑模式 · 小屏可录入,建议在桌面端操作')
  })

  it('❗宽档零差异:tier 不是 s 时照旧渲 <table>,一张卡都不出', async () => {
    vi.unstubAllGlobals(); _resetViewportForTest()          // jsdom 原生 matchMedia → tier='xl'
    const w = await openBody()
    expect(w.find('table.tb-table').exists()).toBe(true)
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
    // 8 根数值列 + 代码 + 名称,一根不少(colgroup 根数任何档位都不变)
    expect(w.findAll('table.tb-table colgroup col')).toHaveLength(10)
  })
})
