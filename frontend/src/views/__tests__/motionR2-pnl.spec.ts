// src/views/__tests__/motionR2-pnl.spec.ts — 动效第二轮(2026-09-16 行为矩阵)· 费用 / 损益附表 / 预算 / 利润表 / 驾驶舱。
//
// 钉三件事:
//   ① 换年不重挂:骨架门只认首进;换年在途 AnaEChart 还是同一个 DOM 节点、旧年内容留在原地,
//      过 200ms 门槛才挂 .fp-stale(宿主常挂 data-stale-host),到数摘掉;卡头年份跟已加载的那一年走。
//   ② S 档骨架高:顶替 AnaEChart 的块与图同一张降档表(≤600:300→260 / 250→220),顶替自绘图 / DOM 的块照旧写死。
//   ③ 弹层里的图 entrance=false(原则 7);读屏回签静默换数(C1-06),行与推算同一拍落地。
//
// 夹具不用退化数据:各月数值带起伏,两年的覆盖月数不同(2026 录到 8 月,2025 录满 12 月)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
// 数组式 props:entrance 缺省就是 undefined(不走 Boolean 强转),弹层那张才看得出 false
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height', 'entrance'], template: '<div class="stub-chart" />' },
}))
vi.mock('@/analysis/anaData', async (orig) => {
  const a = await orig<typeof import('@/analysis/anaData')>()
  return {
    ...a,
    fetchAvailableMonths: vi.fn(), fetchPnlYear: vi.fn(), fetchPnlSummary: vi.fn(), fetchBudgetAll: vi.fn(),
    fetchCompanies: vi.fn(), fetchReportAll: vi.fn(), fetchReportPeriod: vi.fn(),
    fetchCollectRates: vi.fn(), fetchS10PhaseMonthly: vi.fn(), fetchLedgerRows: vi.fn(),
    fetchTenantSummary: vi.fn(), fetchContractSummary: vi.fn(), fetchAnomalyInputs: vi.fn(),
  }
})

import * as data from '@/analysis/anaData'
import type { PnlBand, PnlSummary } from '@/analysis/anaData'
import type { PnlRowDTO, PnlYearDTO } from '@/types/pnl'
import type { BudgetRowDTO } from '@/api/budget'
import { providePeriodMonths, usePeriod } from '@/analysis/usePeriod'
import { __resetCompareForTest } from '@/analysis/useCompare'
import ExpenseView from '@/views/analysis/ExpenseView.vue'
import PnlAnalysisView from '@/views/analysis/PnlAnalysisView.vue'
import BudgetView from '@/views/analysis/BudgetView.vue'
import FinPnlView from '@/views/analysis/FinPnlView.vue'
import CockpitView from '@/views/analysis/CockpitView.vue'

// ── 夹具 ──
const MONTHS = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']
const upto = (y: number) => (y === 2026 ? 8 : 12)
const k = (y: number) => (y === 2026 ? 1 : 0.8)
/** 12 长度月序列:录到 upto 月,逐月起伏(不是平线) */
const ser = (y: number, base: number): (number | null)[] =>
  Array.from({ length: 12 }, (_, i) => (i < upto(y) ? Math.round(base * k(y) * (1 + ((i * 7) % 5) * 0.03)) : null))
const nulls = (): (number | null)[] => new Array(12).fill(null)

function pnlSum(y: number): PnlSummary {
  const band = (r: number, c: number): PnlBand => {
    const rev = ser(y, r), cost = ser(y, c)
    return { rev, cost, pnl: rev.map((v, i) => (v == null ? null : v - cost[i]!)) }
  }
  const by: Record<string, PnlBand> = {
    s1: band(500000, 200000), s2: band(120000, 100000), s3: band(30000, 26000), s4: band(80000, 50000),
    s5: { rev: nulls(), cost: ser(y, 90000), pnl: nulls() },
  }
  const sum = (key: 'rev' | 'cost', ks: string[]) => Array.from({ length: 12 }, (_, i) =>
    (i < upto(y) ? ks.reduce((s, x) => s + (by[x][key][i] ?? 0), 0) : null))
  const revenue = sum('rev', ['s1', 's2', 's3', 's4'])
  const cost = sum('cost', ['s1', 's2', 's3', 's4', 's5'])
  return {
    year: y, months: Array.from({ length: upto(y) }, (_, i) => i + 1),
    revenue, cost, profit: revenue.map((v, i) => (v == null ? null : v - cost[i]!)), bySchedule: by,
  }
}

const prow = (label: string, kind: PnlRowDTO['kind'], m: (number | null)[], groupLabel = ''): PnlRowDTO =>
  ({ rowKey: label, groupLabel, label, kind, note: null, m, sortOrder: 0 })
function s5For(y: number): PnlYearDTO {
  return {
    year: y,
    rows: [
      prow('办公费', 'detail', ser(y, 12000), '管理费用'),
      prow('差旅费', 'detail', ser(y, 7000), '管理费用'),
      prow('广告费', 'detail', ser(y, 15000), '销售费用'),
      prow('销售费用合计', 'total', ser(y, 15000), '销售费用'),
      prow('管理费用总计：', 'total', ser(y, 19000)),
      prow('财务费用合计：', 'total', ser(y, 4000)),
      prow('运营费用总计', 'total', ser(y, 38000)),
    ],
  }
}

const brow = (year: number, label: string, budget: number | null, actual: number | null, sortOrder: number): BudgetRowDTO =>
  ({ year, label, sub: false, budget, actual, note: null, sortOrder })
const budgetRows = (rev2026: number): BudgetRowDTO[] => [
  brow(2024, '收入总计', 7_000_000, 6_800_000, 1), brow(2024, '利润总计', 1_500_000, 1_400_000, 2),
  brow(2025, '收入总计', 8_000_000, null, 1), brow(2025, '利润总计', 1_800_000, null, 2),
  brow(2026, '收入总计', rev2026, null, 1), brow(2026, '利润总计', 2_000_000, null, 2),
]

function wireData() {
  vi.mocked(data.fetchAvailableMonths).mockResolvedValue({ months: MONTHS, sources: { pnl: MONTHS, report: ['2025-12', '2026-08'] } })
  vi.mocked(data.fetchPnlYear).mockImplementation(async (_s: string, y: number) => s5For(y))
  vi.mocked(data.fetchPnlSummary).mockImplementation(async (y: number) => pnlSum(y))
  vi.mocked(data.fetchBudgetAll).mockResolvedValue(budgetRows(9_000_000))
  vi.mocked(data.fetchCompanies).mockResolvedValue([{ id: 1, name: '甲公司', short: '甲', sortNo: 1 }])
  vi.mocked(data.fetchReportAll).mockResolvedValue({ amounts: { 1: { cur: 800000, ytd: 6400000 }, 2: { cur: 300000, ytd: 2500000 } }, customRows: [] })
  vi.mocked(data.fetchCollectRates).mockResolvedValue([])
  vi.mocked(data.fetchS10PhaseMonthly).mockResolvedValue(null as never)
  vi.mocked(data.fetchLedgerRows).mockResolvedValue([])
  vi.mocked(data.fetchTenantSummary).mockResolvedValue(null as never)
  vi.mocked(data.fetchContractSummary).mockResolvedValue(null as never)
  vi.mocked(data.fetchAnomalyInputs).mockResolvedValue(null as never)
}

/** 之后的该取数全部停住,手动一起放行(放行时按各自请求的年份给数) */
function holdNext<T>(fn: (...a: never[]) => Promise<T>, make: (...a: never[]) => T) {
  const waiting: (() => void)[] = []
  vi.mocked(fn).mockImplementation(((...a: never[]) => new Promise<T>((res) => { waiting.push(() => res(make(...a))) })) as never)
  return () => waiting.splice(0).forEach((r) => r())
}

// ── 挂载 ──
const mounted: VueWrapper[] = []
const STUBS = { global: { stubs: { RouterLink: true, teleport: true } } }
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function boot(comp: Component, gran: 'month' | 'year' = 'month') {
  const w = mount(comp as never, STUBS)
  mounted.push(w)
  await flushPromises()
  providePeriodMonths(MONTHS, MONTHS)
  usePeriod().setYear(2026)
  usePeriod().setGran(gran)
  if (gran === 'month') usePeriod().setMonth(8)
  await flushPromises()
  return w
}

const nodes = (w: VueWrapper) => w.findAll('.stub-chart').map((e) => e.element)
function expectSameNodes(w: VueWrapper, before: Element[], why: string) {
  const now = nodes(w)
  expect(now.length, why).toBe(before.length)
  now.forEach((e, i) => expect(e, `${why}(第 ${i + 1} 张图被卸载重挂)`).toBe(before[i]))
}

/** 换年在途的共同形状:同一节点、不塌回骨架、200ms 前不退让 → 过门槛退让 + 工具条进度线 → 到数摘掉 */
async function expectStaleCycle(w: VueWrapper, o: { host: string; skel?: string; release: () => void; charts: Element[] }) {
  const hostEl = w.find(o.host).element
  expect(w.find(o.host).attributes('data-stale-host'), '没有 data-stale-host,退场会是硬切').toBeDefined()
  if (o.skel) expect(w.find(o.skel).exists(), '换年塌回骨架了').toBe(false)
  expectSameNodes(w, o.charts, '换年在途')
  expect(w.find(o.host).element, '内容宿主被卸载重挂了').toBe(hostEl)
  expect(w.find(o.host).classes(), '没到 200ms 门槛就退让了').not.toContain('fp-stale')
  await tick(260)
  await flushPromises()
  expect(w.find(o.host).classes(), '过了 200ms 还没退让').toContain('fp-stale')
  expect(w.find('.anx-tools > .fp-lb').exists(), '工具条上没有进度线(AnaShell busy 没接)').toBe(true)
  o.release()
  await flushPromises()
  expect(w.find(o.host).element).toBe(hostEl)
  expect(w.find(o.host).classes(), '到数没摘退让').not.toContain('fp-stale')
  expect(w.find('.fp-lb').exists()).toBe(false)
  expectSameNodes(w, o.charts, '到数之后')
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  __resetCompareForTest()
  wireData()
})
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  vi.unstubAllGlobals()
})

describe('换年不重挂 + 旧内容退让(C5-02,2026-09-16 行为矩阵)', () => {
  it('❗费用与报销:三张图同一节点;卡头年份与 KPI 瓦等数据一起换', async () => {
    const w = await boot(ExpenseView)
    expect(w.find('.ex-skel').exists()).toBe(false)
    const charts = nodes(w)
    expect(charts, '主图 / 结构环 / Top10 三张都该在').toHaveLength(3)
    const title = () => w.find('.av2-s8 .av2-card-h .t').text()
    expect(title()).toBe('月度费用构成 · 2026年')

    const release = holdNext(data.fetchPnlYear, (_s: string, y: number) => s5For(y))
    usePeriod().setYear(2025)
    await flushPromises()
    expect(title(), '旧年的图配上了新年的卡头').toBe('月度费用构成 · 2026年')
    expect(w.findAll('.anx-kpis .av2-kpi'), 'KPI 瓦在途期间被清空了').toHaveLength(6)
    await expectStaleCycle(w, { host: '.av2-grid[data-stale-host]', skel: '.ex-skel', release, charts })
    expect(title()).toBe('月度费用构成 · 2025年')
  })

  it('❗损益附表分析:两张图同一节点;KPI 口径年份等数据一起换', async () => {
    const w = await boot(PnlAnalysisView, 'year')
    expect(w.find('.pa2-skel').exists()).toBe(false)
    const charts = nodes(w)
    expect(charts).toHaveLength(2)
    const note = () => w.findAll('.anx-kpis .av2-kpi')[0].text()
    expect(note()).toContain('2026 年全年口径')

    const release = holdNext(data.fetchPnlSummary, (y: number) => pnlSum(y))
    usePeriod().setYear(2025)
    await flushPromises()
    expect(note(), '在途期间 KPI 先印了新年').toContain('2026 年全年口径')
    await expectStaleCycle(w, { host: '.pa2-page[data-stale-host]', skel: '.pa2-skel', release, charts })
    expect(note()).toContain('2025 年全年口径')
  })

  it('❗利润表分析:不上骨架;三张图同一节点;页头年份 / 报表月等数据一起换', async () => {
    const release0 = holdNext(data.fetchPnlSummary, (y: number) => pnlSum(y))
    const w = mount(FinPnlView as never, STUBS)
    mounted.push(w)
    await flushPromises()
    expect(w.find('.fp-shim').exists(), '利润表分析不上骨架(用户 2026-09-16 拍板)').toBe(false)
    vi.mocked(data.fetchPnlSummary).mockImplementation(async (y: number) => pnlSum(y))
    release0()
    await flushPromises()
    providePeriodMonths(MONTHS, MONTHS)
    usePeriod().setYear(2026)
    await flushPromises()

    const charts = nodes(w)
    expect(charts, '瀑布 / 科目趋势 / 收入结构三张都该在').toHaveLength(3)
    const sub = () => w.find('.fin-head .sub').text()
    expect(sub()).toContain('园区口径 · 2026年')
    expect(sub()).toContain('法人口径 · 2026-08')

    const release = holdNext(data.fetchPnlSummary, (y: number) => pnlSum(y))
    usePeriod().setYear(2025)
    await flushPromises()
    expect(sub(), '在途期间页头先印了新年').toContain('园区口径 · 2026年')
    expect(sub(), '在途期间报表月先换了').toContain('法人口径 · 2026-08')
    await expectStaleCycle(w, { host: '.fin-page', release, charts })
    expect(sub()).toContain('园区口径 · 2025年')
    expect(sub()).toContain('法人口径 · 2025-12')
  })

  it('❗预算对比:换年不打接口、图不重挂、不退让;回签重读静默(C1-06),行与损益推算同一拍落地', async () => {
    const alive = ref(true)
    const w = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(BudgetView) : null) }),
    }), STUBS)
    mounted.push(w)
    await flushPromises()
    providePeriodMonths(MONTHS, MONTHS)
    usePeriod().setYear(2026)
    await flushPromises()
    expect(w.find('.bv2-skel').exists()).toBe(false)
    const charts = nodes(w)
    expect(charts).toHaveLength(1)
    const budgetCell = () => w.find('.bv2-tbl tbody tr td.n').text()
    const cellBefore = budgetCell()

    // 换年:一次拉全年份,不打接口 —— 图不动
    const calls = vi.mocked(data.fetchBudgetAll).mock.calls.length
    usePeriod().setYear(2025)
    await flushPromises()
    expect(vi.mocked(data.fetchBudgetAll).mock.calls.length).toBe(calls)
    expectSameNodes(w, charts, '换年')
    usePeriod().setYear(2026)
    await flushPromises()

    // 回签:新预算行先到、损益推算后到 —— 两者同一拍落地,期间屏上还是旧数,不退让不亮线
    vi.mocked(data.fetchBudgetAll).mockResolvedValue(budgetRows(12_000_000))
    const release = holdNext(data.fetchPnlSummary, (y: number) => pnlSum(y))
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(vi.mocked(data.fetchBudgetAll).mock.calls.length, '回签没重读').toBe(calls + 1)
    expect(budgetCell(), '新预算行先落地了,配的是旧推算').toBe(cellBefore)
    await tick(260)
    await flushPromises()
    expect(w.find('.fp-stale').exists(), '读屏回签不该退让(C1-06)').toBe(false)
    expect(w.find('.fp-lb').exists(), '读屏回签不该亮进度线(C1-06)').toBe(false)
    release()
    await flushPromises()
    expect(budgetCell(), '到数没换').not.toBe(cellBefore)
    expectSameNodes(w, charts, '回签到数')
  })
})

describe('对抗复查 2026-09-16:首进两趟取数 / 换年在途的横幅与预测带 / 报销行重排', () => {
  it('❗利润表分析首进:月份列表到了才知道报表月 —— 两趟之间不闪「无利润表数据」空卡,也不挂退让', async () => {
    providePeriodMonths(MONTHS, MONTHS)
    usePeriod().setYear(2026)
    const release = holdNext(data.fetchReportAll, () => ({ amounts: { 1: { cur: 800000, ytd: 6400000 }, 2: { cur: 300000, ytd: 2500000 } }, customRows: [] }))
    const w = mount(FinPnlView as never, STUBS)
    mounted.push(w)
    await flushPromises()
    expect(vi.mocked(data.fetchReportAll), '第二趟(报表快照)没发出').toHaveBeenCalledWith('is', 2026, 8)
    expect(w.text(), '两趟之间闪出了空卡').not.toContain('该公司该期无利润表数据')
    expect(w.text()).not.toContain('损益数据未录入')
    const grid = w.find('.fin-page .av2-grid')
    const top = grid.element.firstElementChild
    await tick(260)
    await flushPromises()
    expect(w.find('.fin-page').classes(), '首进那一趟不算换期,不该退让').not.toContain('fp-stale')
    release()
    await flushPromises()
    expect(grid.element.firstElementChild, '到数时顶上的卡被换掉 = 整页跳').toBe(top)
    expect(w.find('.fin-head .sub').text()).toContain('法人口径 · 2026-08')
    expect(w.findAll('.av2-s12')).toHaveLength(1)
    expect(w.find('.av2-s12 table.ak-tbl').exists()).toBe(true)
  })

  /** 月粒度落到 2026-01 再挂(2026 录到 8 月,2025 录满 12 月) */
  async function bootJan(comp: Component) {
    providePeriodMonths(MONTHS, MONTHS)
    usePeriod().setGran('month')
    usePeriod().setYear(2026)
    usePeriod().setMonth(1)
    const w = mount(comp as never, STUBS)
    mounted.push(w)
    await flushPromises()
    return w
  }
  /** 跨年步进在途:期间旁的回退标签不冒出来、grid 不被推;到数后也没有(2025-12 有数) */
  async function expectNoBannerAcrossYear(w: VueWrapper, fn: (...a: never[]) => Promise<unknown>, make: (...a: never[]) => unknown) {
    const grid = w.find('.av2-grid[data-stale-host]').element
    const before = grid.previousElementSibling
    expect(w.find('.anx-period .fp-state').exists()).toBe(false)
    const release = holdNext(fn as never, make as never)
    usePeriod().step(-1)
    await flushPromises()
    expect(usePeriod().ym.value).toBe('2025-12')
    expect(w.find('.anx-period .fp-state').exists(), '在途拿新月对旧年的覆盖月,冒出一个假回退标签').toBe(false)
    expect(grid.previousElementSibling, 'grid 上方多了东西 = 被推下去').toBe(before)
    release()
    await flushPromises()
    expect(w.find('.anx-period .fp-state').exists()).toBe(false)
  }

  it('❗驾驶舱:2026-01 步进到 2025-12,在途不出回退标签', async () => {
    const w = await bootJan(CockpitView)
    await expectNoBannerAcrossYear(w, data.fetchPnlSummary, (y: number) => pnlSum(y))
  })

  it('❗费用与报销 · 报销 Top7:换月名次互换 → 行节点顺序不动(被挪的节点丢过渡),名次走 translateY', async () => {
    const swap = (a: number, b: number) => [a, b, ...new Array(10).fill(null)] as (number | null)[]
    vi.mocked(data.fetchPnlYear).mockImplementation(async (_s: string, y: number) => {
      const dto = s5For(y)
      return { ...dto, rows: [...dto.rows, prow('通信费', 'detail', swap(900, 100), '管理费用'), prow('餐补', 'detail', swap(100, 900), '管理费用')] }
    })
    const w = await bootJan(ExpenseView)
    const rows = () => w.findAll('.ex-reim-rows > .ak-bar-row')
    const names = () => rows().map((r) => r.find('.ak-bar-name').text())
    const ys = () => rows().map((r) => (r.element as HTMLElement).style.transform)
    expect(names()).toEqual(['办公费', '差旅费', '通信费', '餐补'])
    expect(ys()).toEqual(['translateY(0px)', 'translateY(34px)', 'translateY(68px)', 'translateY(102px)'])
    expect((w.find('.ex-reim-rows').element as HTMLElement).style.height, '容器高 = 4 × 34 − 14').toBe('122px')
    const els = rows().map((r) => r.element)
    usePeriod().setMonth(2)
    await flushPromises()
    expect(rows().map((r) => r.element), '名次一变节点被挪了 = 条长直接跳').toEqual(els)
    rows().forEach((r, i) => expect(r.element).toBe(els[i]))
    expect(names()).toEqual(['办公费', '差旅费', '通信费', '餐补'])
    expect(ys(), '名次没换到 translateY 上').toEqual(['translateY(0px)', 'translateY(34px)', 'translateY(102px)', 'translateY(68px)'])
  })

  it('❗费用与报销:2026-01 步进到 2025-12,在途不出回退标签', async () => {
    const w = await bootJan(ExpenseView)
    await expectNoBannerAcrossYear(w, data.fetchPnlYear, (_s: string, y: number) => s5For(y))
  })

  // 2026-10 改稿:驾驶舱不再有跨年拼接的预测带(AnaForecastChart),两条预测带用例换成新稿的两处在途形状
  it('❗驾驶舱按年:往后进一年,本年还在途 —— 屏上仍是上一年那块板(不拿新年去配旧数据),到数才整块换', async () => {
    providePeriodMonths(MONTHS, MONTHS)
    usePeriod().setGran('year')
    usePeriod().setYear(2025)
    const w = mount(CockpitView as never, STUBS)
    mounted.push(w)
    await flushPromises()
    const hints = () => w.findAll('.av2-grid[data-stale-host] .av2-card-h .hint').map((e) => e.text())
    const before = hints()
    let release = () => {}
    vi.mocked(data.fetchPnlSummary).mockImplementation((y: number) =>
      (y === 2026 ? new Promise((res) => { release = () => res(pnlSum(y)) }) : Promise.resolve(pnlSum(y))))
    usePeriod().setYear(2026)
    await flushPromises()
    expect(hints(), '在途期间板先换了').toEqual(before)
    release()
    await flushPromises()
    expect(hints(), '2026 只录到 8 月,累计卡卡头该写出覆盖到哪').toContain('2026年1–8月 · 万元')
  })

  it('❗驾驶舱 1 月:上一年还在途 —— 整屏照常出,1 月瓦先不带涨跌;上一年到了补上「比12月」', async () => {
    providePeriodMonths(MONTHS, MONTHS)
    usePeriod().setGran('month')
    usePeriod().setYear(2026)
    usePeriod().setMonth(1)
    let release = () => {}
    vi.mocked(data.fetchPnlSummary).mockImplementation((y: number) =>
      (y === 2025 ? new Promise((res) => { release = () => res(pnlSum(y)) }) : Promise.resolve(pnlSum(y))))
    const w = mount(CockpitView as never, STUBS)
    mounted.push(w)
    await flushPromises()
    const revTile = () => w.findAll('.av2-kpi')[0].text()
    expect(w.find('.cv2-skel').exists(), '上一年拖住了整屏').toBe(false)
    expect(revTile()).not.toContain('比12月')
    release()
    await flushPromises()
    expect(revTile()).toContain('比12月')
  })
})

describe('S 档骨架高:顶替 AnaEChart 的块与图同一张降档表', () => {
  const pending = () => new Promise<never>(() => {})
  function stallAll() {
    for (const f of [data.fetchPnlYear, data.fetchPnlSummary, data.fetchBudgetAll, data.fetchCollectRates,
      data.fetchS10PhaseMonthly, data.fetchLedgerRows, data.fetchTenantSummary, data.fetchContractSummary, data.fetchAnomalyInputs])
      vi.mocked(f).mockImplementation(pending as never)
  }
  function viewport(phone: boolean) {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: phone && q === '(max-width: 600px)', media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }))
  }
  async function heights(comp: Component, sel: string, phone: boolean) {
    stallAll()
    viewport(phone)
    const w = mount(comp as never, STUBS)
    mounted.push(w)
    await flushPromises()
    const shims = w.findAll(sel)
    expect(shims.length, `首进没出骨架 ${sel}`).toBeGreaterThan(0)
    return shims.map((e) => (e.element as HTMLElement).style.height)
  }

  // 2026-09-16 起卡头 / 异动行 / 报销合计照抄真版式,灰条只剩图块与报销条块(浏览器 390 / 1366 宽逐块对过)
  it('❗费用与报销:主图 / 结构环 300→260、Top10 250→220;报销条块是 DOM,照旧 190', async () => {
    expect(await heights(ExpenseView, '.ex-skel .fp-shim', true)).toEqual(['260px', '260px', '220px', '190px'])
  })

  it('❗费用与报销:>600 仍是 :height 字面值', async () => {
    expect(await heights(ExpenseView, '.ex-skel .fp-shim', false)).toEqual(['300px', '300px', '250px', '190px'])
  })

  it('❗损益附表分析:两张图 300→260', async () => {
    expect(await heights(PnlAnalysisView, '.pa2-skel .av2-grid .fp-shim', true)).toEqual(['260px', '260px'])
  })

  it('❗预算对比:主图 300→260;明细表块照旧 420(达成卡是真 AnaBullet + 真行,隐形)', async () => {
    expect(await heights(BudgetView, '.bv2-skel .fp-shim', true)).toEqual(['260px', '420px'])
  })

  // 2026-10 改稿:按月 预测图 280(降档表里没有 280,不降)/ 构成 · 分期 · 各公司收缴率 250→220;回测表块 258(DOM);规则卡照抄真版式
  it('❗驾驶舱按月:预测图 280 不降档,三张成对条 / 横条 250→220,回测表块 258', async () => {
    providePeriodMonths(MONTHS, MONTHS)
    usePeriod().setGran('month')
    expect(await heights(CockpitView, '.cv2-skel .fp-shim', true)).toEqual(['280px', '220px', '220px', '220px', '258px'])
  })
})

describe('弹层里的图瞬现(原则 7)', () => {
  it('❗驾驶舱:点营业收入构成的条开出的板块趋势图 entrance=false;屏上的图不传(挂载即入场)', async () => {
    const w = await boot(CockpitView)
    const charts = w.findAllComponents({ name: 'AnaEChart' })
    expect(charts.length).toBeGreaterThan(0)
    for (const c of charts) expect(c.props('entrance'), '屏上的图不该关入场').toBeUndefined()
    const compo = charts.find((c) => ((c.props('option') as { yAxis?: { data?: string[] } }).yAxis?.data ?? []).includes('租金'))
    expect(compo, '营业收入构成不在').toBeTruthy()
    compo!.vm.$emit('chart-click', { componentType: 'series', name: '租金', dataIndex: 0 })
    await flushPromises()
    const modal = w.find('.cv2-modal')
    expect(modal.exists(), '点扇区没开弹层').toBe(true)
    const inModal = w.findAllComponents({ name: 'AnaEChart' }).filter((c) => modal.element.contains(c.element))
    expect(inModal).toHaveLength(1)
    expect(inModal[0].props('entrance')).toBe(false)
  })
})

// 画布 06-D 中格 / 实现规范 §1.5、§2 第 8 条:期间回退不用满宽横条 —— 整页回退贴期间选择旁,离群月是图卡里一行。
describe('期间回退:期间选择旁的标签 / 图卡里一行,不用满宽横条', () => {
  type TipEl = HTMLElement & { _tip?: { text: string } }
  const tags = (w: VueWrapper) => w.findAll('.anx-period .fp-state').map((e) => e.text())
  /** 驾驶舱某张图卡头里的回退标签(画布 06-D 中格:单图回退贴卡头) */
  const headTag = (w: VueWrapper, title: string) =>
    w.findAll('.av2-grid[data-stale-host] .av2-card-h .t').find((t) => t.text().startsWith(title))!.find('.fp-state')
  async function bootAug(comp: Component) {
    providePeriodMonths(MONTHS, MONTHS)
    usePeriod().setGran('month')
    usePeriod().setYear(2026)
    usePeriod().setMonth(8)
    const w = mount(comp as never, STUBS)
    mounted.push(w)
    await flushPromises()
    return w
  }

  // 2026-10 改稿(cv2-notdone):整页回退看损益表有数的月(fetchAvailableMonths 的 sources.pnl),标签不出 YYYY-MM 写法
  it('❗驾驶舱:选 2026-08 而损益表只录到 7 月 → 整页显示 7 月,只在期间旁挂一枚「显示 7月 · 8月无数据」', async () => {
    vi.mocked(data.fetchAvailableMonths).mockResolvedValue({ months: MONTHS, sources: { pnl: MONTHS.filter((m) => m !== '2026-08') } })
    const w = await bootAug(CockpitView)
    expect(tags(w)).toEqual(['显示 7月 · 8月无数据'])
    expect(w.findAll('.anx-body .fp-state').length, '正文里不该有整页回退标签').toBe(0)
    expect(w.findAll('.av2-kpi')[0].text(), '整页按 7 月画:瓦比的是 6 月').toContain('比6月')
    usePeriod().setMonth(7)
    await flushPromises()
    expect(tags(w), '7 月有损益,期间旁标签该撤').toEqual([])
  })

  it('❗驾驶舱:台账只到 7 月 → 各公司收缴率卡头「显示 7月」、瓦标签「收缴率(7月)」,期间旁不挂;选 7 月不挂', async () => {
    vi.mocked(data.fetchCollectRates).mockResolvedValue([
      { ym: '2026-06', receivable: 100000, collected: 90000, rate: 90 },
      { ym: '2026-07', receivable: 120000, collected: 96000, rate: 80 },
    ])
    const w = await bootAug(CockpitView)
    expect(tags(w)).toEqual([])
    expect(headTag(w, '各公司收缴率').text()).toBe('显示 7月')
    expect(w.findAll('.av2-kpi')[3].text()).toContain('收缴率(7月)')
    usePeriod().setMonth(7)
    await flushPromises()
    expect(headTag(w, '各公司收缴率').exists(), '所选月有台账,不回退').toBe(false)
  })

  // 新稿把「收缴率显示 YYYY-MM」那枚期间旁标签并进了瓦标签和卡头(收缴率单图回退贴它自己的卡头)
  it('❗驾驶舱:台账断月(04、06 有,05 无)选 05 → 瓦与卡头都按 4 月,期间旁不挂', async () => {
    vi.mocked(data.fetchCollectRates).mockResolvedValue([
      { ym: '2026-04', receivable: 100000, collected: 90000, rate: 90 },
      { ym: '2026-06', receivable: 120000, collected: 96000, rate: 80 },
    ])
    const w = await bootAug(CockpitView)
    usePeriod().setMonth(5)
    await flushPromises()
    expect(tags(w)).toEqual([])
    expect(headTag(w, '各公司收缴率').text()).toBe('显示 4月')
    expect(w.findAll('.av2-kpi')[3].text()).toContain('收缴率(4月)')
  })
  // 「当年有收入为负的月 → 主图卡里一行 FPNote」那条 2026-10 改稿删:新稿拿掉了卡内黄条(cv2-changes 第 1 条),负数照实画在预测图里

  it('❗费用与报销:选 2026-08 而附表5 只录到 7 月 → 期间旁「显示 2026-07 · 8 月无数据」;异动榜科目名悬停看全称', async () => {
    vi.mocked(data.fetchPnlYear).mockImplementation(async (_s: string, y: number) => {
      const d = s5For(y)
      return y === 2026 ? { ...d, rows: d.rows.map((r) => ({ ...r, m: r.m.map((v, i) => (i === 7 ? null : v)) })) } : d
    })
    const w = await bootAug(ExpenseView)
    expect(tags(w)).toEqual(['显示 2026-07 · 8 月无数据'])
    const lbs = w.findAll('.ex-mv .lb')
    expect(lbs.length, '异动榜没出行,这条判据是空跑').toBeGreaterThan(0)
    for (const lb of lbs) {
      expect(lb.attributes('title')).toBeUndefined()
      expect((lb.element as TipEl)._tip?.text).toBe(lb.text())
    }
  })
})
