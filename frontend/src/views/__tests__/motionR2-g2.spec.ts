// src/views/__tests__/motionR2-g2.spec.ts — 动效第二轮(2026-09-16 行为矩阵)· 园区能耗 / 出租与楼栋 /
// 电费成本分析 / 租户异常监控 / 现金流量五屏。
//
// 钉的是用户在真屏上看到的两件事:
//   ① 换年时图组件**不被卸载**(同一个 DOM 节点)—— 卸载重挂 = 200 形变没了 + 整页位移一次;
//      旧内容留在原地,过 200ms 门才退让(.fp-stale),数据到了摘掉;标题 / KPI 跟「已画的那一年」走。
//   ② 首进骨架里顶替 AnaEChart 的块与图同表降档(≤600 数据到的那一帧不跳)。
// 读屏回签(Park / FinCashflow)按 C1-06 是静默原地换数:不回骨架、不退让、不亮进度线。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref, type Component } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// AnaEChart 整个桩掉(同 expiryScreen / tenantPeerScreen 的写法)。没用 anaEChart.spec 那种只桩 ./echartsBundle 的办法:
// 一屏多张图同时 import('./echartsBundle') 时 vi.mock 只接住一张(本机实测 3 张图 init 只被调 1 次),其余加载真 echarts,
// jsdom 无 canvas 当场炸。图高降档由 anaEChart.spec 钉,这里只需要「同一个组件节点还在不在」。
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height', 'entrance'], template: '<div class="stub-chart" />' },
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('@/analysis/anaData', async (orig) => ({
  ...(await orig<typeof import('@/analysis/anaData')>()),
  fetchAvailableMonths: vi.fn(async () => ({ months: ['2025-06', '2026-06'], sources: { pnl: ['2025-06', '2026-06'] } })),
  fetchElecYear: vi.fn(),
  fetchChargingYear: vi.fn(async () => ({ rows: [] })),
  fetchUtilitiesYear: vi.fn(async () => ({ rows: [] })),
  fetchPvAll: vi.fn(async () => []),
  fetchS10Rows: vi.fn(async () => []),
  fetchBudgetAll: vi.fn(async () => []),
  fetchBuildings: vi.fn(),
  fetchBuildingSummary: vi.fn(),
  fetchContracts: vi.fn(),
  fetchTenants: vi.fn(),
  fetchAnomalyInputs: vi.fn(),
  fetchCompanies: vi.fn(),
  fetchLedgerRows: vi.fn(),
  fetchS10PhaseMonthly: vi.fn(),
}))
vi.mock('@/api/elecCost', () => ({
  elecCostApi: { meters: vi.fn(), metricsYear: vi.fn(), entries: vi.fn(), priceCfg: vi.fn() },
}))

import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaSkelChart from '@/components/ana/AnaSkelChart.vue'
import DsSelect from '@/components/ds/Select.vue'
import ParkEnergyView from '@/views/analysis/ParkEnergyView.vue'
import ElecAnalysisView from '@/views/analysis/ElecAnalysisView.vue'
import AnomalyView from '@/views/analysis/AnomalyView.vue'
import ParkView from '@/views/analysis/ParkView.vue'
import FinCashflowView from '@/views/analysis/FinCashflowView.vue'
import * as ana from '@/analysis/anaData'
import { elecCostApi } from '@/api/elecCost'
import { providePeriodMonths, usePeriod } from '@/analysis/usePeriod'
import { __resetCompareForTest } from '@/analysis/useCompare'

const m = vi.mocked
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const STUBS = { global: { stubs: { RouterLink: true, teleport: true } } }
const mounted: VueWrapper[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  __resetCompareForTest()
  providePeriodMonths(['2025-06', '2026-06'], ['2025-06', '2026-06'])
})
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
})

const chartEls = (w: VueWrapper) => w.findAllComponents(AnaEChart).map((c) => c.element)
function expectSameCharts(w: VueWrapper, before: Element[], why: string) {
  const now = chartEls(w)
  expect(now.length, why).toBe(before.length)
  now.forEach((el, i) => expect(el, `${why}(第 ${i + 1} 张图换了节点)`).toBe(before[i]))
}

function mountPlain(view: Component): VueWrapper {
  const w = mount(view, STUBS) as VueWrapper
  mounted.push(w)
  return w
}
/** 包进 KeepAlive,alive 开关模拟切走 / 切回(照 readScreenRefresh.spec.ts 的写法) */
function mountKept(view: Component) {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(view) : null) }),
  }), STUBS)
  mounted.push(w)
  return { w, alive }
}

const kpiV = (w: VueWrapper, label: string) =>
  w.findAll('.av2-kpi').find((k) => k.find('.l').text() === label)!.find('.v').text()

describe('换年:图不卸载,旧年内容留在原地退让,到数原地换新', () => {
  it('❗园区能耗:同一批 AnaEChart 节点;页头期间与 KPI 在途停在旧年;200ms 后 .fp-stale + 进度线', async () => {
    const p = usePeriod()
    p.setGran('month'); p.setYear(2026); p.setMonth(6)
    const elecFx = (y: number, total: number) =>
      ({ energy: { rows: [{ acctMonth: `${y}-06`, qty: 1000, total }] }, basic: { rows: [] } }) as never
    m(ana.fetchElecYear).mockImplementation(async (y: number) => elecFx(y, 80000))

    const w = mountPlain(ParkEnergyView)
    expect(w.find('.ak-skel').exists(), '首进没出骨架').toBe(true)
    await flushPromises()
    expect(w.find('.ak-skel').exists(), '数据到了还是骨架').toBe(false)
    const page = w.find('.ak-page[data-stale-host]')
    expect(page.exists(), '内容宿主没挂 data-stale-host').toBe(true)
    const before = chartEls(w)
    expect(before.length).toBeGreaterThanOrEqual(2)
    expect(w.find('.ak-sub').text()).toContain('期间 2026年6月')
    expect(kpiV(w, '购电成本')).toBe('¥8.0万')

    let release = () => {}
    m(ana.fetchElecYear).mockImplementation((y: number) =>
      new Promise((res) => { release = () => res(elecFx(y, 50000)) }))
    p.setYear(2025)
    await flushPromises()

    expect(w.find('.ak-skel').exists(), '换年不该退回骨架').toBe(false)
    expect(w.find('.ak-page').element, '内容宿主被卸载重挂了').toBe(page.element)
    expectSameCharts(w, before, '换年在途图被卸载了')
    expect(w.find('.ak-sub').text(), '在途期间页头先换成了新年(旧年数据配新年标题)').toContain('期间 2026年6月')
    expect(kpiV(w, '购电成本'), '在途期间 KPI 被清空了').toBe('¥8.0万')
    expect(w.find('.ak-page').classes(), '没到 200ms 就退让了').not.toContain('fp-stale')

    await wait(260)
    await flushPromises()
    expect(w.find('.ak-page').classes()).toContain('fp-stale')
    expect(w.find('.anx-tools > .fp-lb').exists(), 'AnaShell 工具条没亮进度线(busy 没接)').toBe(true)

    release()
    await flushPromises()
    expect(w.find('.ak-page').classes()).not.toContain('fp-stale')
    expect(w.find('.fp-lb').exists()).toBe(false)
    expectSameCharts(w, before, '到数时图被卸载了')
    expect(w.find('.ak-sub').text()).toContain('期间 2025年6月')
    expect(kpiV(w, '购电成本')).toBe('¥5.0万')
  })

  it('❗电费成本分析:同一批 AnaEChart 节点;卡头年份在途停在旧年;200ms 后 .fp-stale + 进度线', async () => {
    const p = usePeriod()
    p.setGran('year'); p.setYear(2026)
    const metricsFx = (y: number) => [{
      month: 6,
      metrics: [{ key: 'parkElecProfit', label: '园区电费收益', value: y === 2026 ? 10000 : 5000, formulaText: '', missing: [] }],
    }]
    const entry = (y: number) => ({
      id: 1, meterId: 1, meterName: '一期总表', acctMonth: `${y}-06`, feeKey: 'tou_industrial', subKey: '',
      amount: 100, qty: null, note: null, source: 'manual' as const,
    })
    m(elecCostApi.meters).mockResolvedValue([])
    m(elecCostApi.metricsYear).mockImplementation(async (y: number) => metricsFx(y))
    m(elecCostApi.entries).mockImplementation(async (y: number, mo: number) => (mo === 6 ? [entry(y)] : []))
    m(elecCostApi.priceCfg).mockResolvedValue([])

    const w = mountPlain(ElecAnalysisView)
    expect(w.find('.ak-skel').exists(), '首进没出骨架').toBe(true)
    await flushPromises()
    expect(w.find('.ak-skel').exists(), '数据到了还是骨架').toBe(false)
    const page = w.find('.ak-page[data-stale-host]')
    expect(page.exists(), '内容宿主没挂 data-stale-host').toBe(true)
    const before = chartEls(w)
    expect(before.length, '趋势图 + 结构图').toBe(2)
    const title = () => w.find('.av2-core .av2-card-h .t').text()
    expect(title()).toBe('收益四指标月度趋势 · 2026年')

    let release = () => {}
    m(elecCostApi.metricsYear).mockImplementation((y: number) =>
      new Promise((res) => { release = () => res(metricsFx(y)) }))
    p.setYear(2025)
    await flushPromises()

    expect(w.find('.ak-skel').exists(), '换年不该退回骨架').toBe(false)
    expect(w.find('.ak-page').element, '内容宿主被卸载重挂了').toBe(page.element)
    expectSameCharts(w, before, '换年在途图被卸载了')
    expect(title(), '在途期间卡头先换成了新年').toBe('收益四指标月度趋势 · 2026年')
    expect(w.find('.ak-page').classes()).not.toContain('fp-stale')

    await wait(260)
    await flushPromises()
    expect(w.find('.ak-page').classes()).toContain('fp-stale')
    expect(w.find('.anx-tools > .fp-lb').exists(), 'AnaShell 工具条没亮进度线(busy 没接)').toBe(true)

    release()
    await flushPromises()
    expect(w.find('.ak-page').classes()).not.toContain('fp-stale')
    expectSameCharts(w, before, '到数时图被卸载了')
    expect(title()).toBe('收益四指标月度趋势 · 2025年')
  })
})

describe('读屏回签(C1-06):静默原地换数 —— 不回骨架、不退让、不亮进度线、图不重挂', () => {
  it('❗出租与楼栋', async () => {
    m(ana.fetchBuildings).mockResolvedValue([])
    m(ana.fetchBuildingSummary).mockResolvedValue(null as never)
    m(ana.fetchContracts).mockResolvedValue([])
    m(ana.fetchTenants).mockResolvedValue([])
    const { w, alive } = mountKept(ParkView)
    expect(w.find('.ak-skel').exists(), '首进没出骨架').toBe(true)
    await flushPromises()
    expect(w.find('.ak-skel').exists(), '数据到了还是骨架').toBe(false)
    const before = chartEls(w)
    expect(before.length, 'TreeMap + 环 + 散点').toBe(3)

    let release = () => {}
    m(ana.fetchBuildings).mockImplementation(() => new Promise((res) => { release = () => res([]) }))
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(ana.fetchBuildings).toHaveBeenCalledTimes(2)
    await wait(260)
    await flushPromises()
    expect(w.find('.ak-skel').exists(), '回签退回了骨架').toBe(false)
    expectSameCharts(w, before, '回签在途图被卸载了')
    expect(w.find('.fp-stale').exists(), '回签不该退让').toBe(false)
    expect(w.find('.fp-lb').exists(), '回签不该亮进度线').toBe(false)
    release()
    await flushPromises()
    expectSameCharts(w, before, '回签到数时图被卸载了')
  })

  it('❗现金流量:换公司图不重挂;回签在途图不重挂、不退让', async () => {
    const row = (companyId: number, receivable: number) => ({
      companyId, companyName: companyId === 1 ? '甲' : '乙', year: 2026, month: 6, tenantId: 1,
      tenantName: '租户A', balancePrev: 10, receivable, collected: 50, balanceEnd: 10 + receivable - 50,
    })
    const rows = [row(1, 100), row(2, 300)]
    m(ana.fetchCompanies).mockResolvedValue([
      { id: 1, name: '甲', short: '甲', sortNo: 1 }, { id: 2, name: '乙', short: '乙', sortNo: 2 },
    ])
    m(ana.fetchLedgerRows).mockResolvedValue(rows)
    m(ana.fetchS10PhaseMonthly).mockResolvedValue({ months: [], phases: [], totals: {}, elec: {} })
    m(ana.fetchTenants).mockResolvedValue([])
    const { w, alive } = mountKept(FinCashflowView)
    await flushPromises()
    const before = chartEls(w)
    expect(before.length, '瀑布 + 分组柱').toBe(2)

    w.findComponent(DsSelect).vm.$emit('update:modelValue', '2')
    await flushPromises()
    expect(w.find('.fin-page').text()).toContain('法人口径 · 乙')
    expectSameCharts(w, before, '换公司图被卸载了')

    let release = () => {}
    m(ana.fetchLedgerRows).mockImplementation(() => new Promise((res) => { release = () => res(rows) }))
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(ana.fetchLedgerRows).toHaveBeenCalledTimes(2)
    await wait(260)
    await flushPromises()
    expectSameCharts(w, before, '回签在途图被卸载了')
    expect(w.find('.fp-stale').exists(), '回签不该退让').toBe(false)
    expect(w.find('.fp-lb').exists(), '回签不该亮进度线').toBe(false)
    release()
    await flushPromises()
    expectSameCharts(w, before, '回签到数时图被卸载了')
  })
})

describe('首进骨架 · S 档(≤600)与图同表降档', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 600px'), media: q }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('❗租户异常监控:右列两块图骨架 220 / 180,电/水费卡图下常驻两行各 20;到数后换成真图', async () => {
    let release = () => {}
    const inputs = {
      ledger: [{ companyId: 1, companyName: '甲', year: 2026, month: 6, tenantId: 1, tenantName: '租户A',
        balancePrev: 0, receivable: 100, collected: 50, balanceEnd: 50 }],
      s10: [5, 6].map((mo) => ({ acctMonth: `2026-0${mo}`, phase: 1, tenantId: 1, tenantName: '租户A',
        elec: 100 * mo, water: 10, total: 100 * mo + 10 })),
      energy: [],
    }
    m(ana.fetchAnomalyInputs).mockImplementation(() => new Promise((res) => { release = () => res(inputs) }))
    const w = mountPlain(AnomalyView)
    await flushPromises()

    expect(w.findAllComponents(AnaSkelChart).map((c) => (c.element as HTMLElement).style.height))
      .toEqual(['220px', '180px'])
    const energyCard = w.find('.ak-skel .mn-right > .av2-card')
    // 2026-09-16 起卡头与两行照抄真版式:灰条只剩图块 220,读数句 / 参照系是真版式同类的 <p … hold>
    expect(energyCard.findAll('.fp-shim').map((s) => (s.element as HTMLElement).style.height)).toEqual(['220px'])
    expect(energyCard.find('p.ana-read.hold').exists()).toBe(true)
    expect(energyCard.find('p.ana-ref.hold').exists()).toBe(true)
    // 真版式那一侧确实是这两行(ana.css .ana-read margin 8 0 0 / .ana-ref margin 2 0 0)
    const src = readFileSync(join(__dirname, '..', 'analysis', 'AnomalyView.vue'), 'utf8')
    expect(src).toContain('<p class="ana-read hold">')
    expect(src).toContain('<p class="ana-ref hold">')

    release()
    await flushPromises()
    expect(w.find('.ak-skel').exists(), '数据到了还是骨架').toBe(false)
    expect(w.findAllComponents(AnaEChart).map((c) => c.props('height')), '真版式那一侧是这两张图').toEqual([250, 200])
  })
})

describe('首进骨架 · 顶替 AnaEChart 的块逐张对上图高(源码坐标)', () => {
  const read = (f: string) => readFileSync(join(__dirname, '..', 'analysis', f), 'utf8')
  it.each([
    ['ParkEnergyView.vue', [300, 170, 250, 250, 170]],
    ['ParkView.vue', [300, 300, 300, 250]],
    ['ElecAnalysisView.vue', [300, 300, 300]],
    ['AnomalyView.vue', [250, 200]],
  ] as const)('❗%s', (file, heights) => {
    const tpl = read(file).split('<template>').slice(1).join('<template>')
    const skel = [...tpl.matchAll(/<AnaSkelChart :height="(\d+)" \/>/g)].map((x) => Number(x[1]))
    const charts = [...tpl.matchAll(/<AnaEChart [^>]*:height="(\d+)"/g)].map((x) => Number(x[1]))
    expect(charts, '图高变了').toEqual([...heights])
    expect(skel, '骨架没跟图高 / 还有顶替图的块没换成 AnaSkelChart').toEqual([...heights])
  })
})
