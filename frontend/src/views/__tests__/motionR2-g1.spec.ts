// src/views/__tests__/motionR2-g1.spec.ts — 动效第二轮(2026-09-16 行为矩阵)· 五屏挂载测:
// ChurnView / TenantEnergyView / TenantPortfolioView / TenantPeerView / FinBalanceView。
//
// 钉三件事:
//   ① S 档(≤600)首进:骨架里顶替 AnaEChart 的块走 AnaSkelChart 的降档表,文字行按行盒 20 —— 数据到的那一帧不跳;
//   ② 数据到了是真内容,不是骨架;
//   ③ 换期 / 回签不重挂:图还是同一个 DOM 节点。需网络的换期(FinBalance)在途 200ms 后退让、到数摘掉;
//      读屏回签(C1-06)静默原地换数 —— 不退回骨架、不退让。
//
// AnaEChart 换成桩(jsdom 无 canvas):「图没被卸载」= 桩的 DOM 节点还是同一个。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import type { BuildingDTO } from '@/types/building'
import type { ContractDTO } from '@/types/contract'
import type { TenantDTO } from '@/types/tenant'
import type { ReportPeriodDTO } from '@/types/report'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height', 'entrance'], template: '<div class="stub-chart" />' },
}))
vi.mock('@/analysis/anaData', () => ({
  fetchAvailableMonths: vi.fn(),
  fetchLedgerRows: vi.fn(),
  fetchS10Rows: vi.fn(),
  fetchS10TenantMap: vi.fn(),
  fetchTenants: vi.fn(),
  fetchContracts: vi.fn(),
  fetchBuildings: vi.fn(),
  fetchContractDetail: vi.fn(),
  fetchCompanies: vi.fn(),
  fetchReportAll: vi.fn(),
  fetchReportPeriod: vi.fn(),
  invalidateAnaCache: vi.fn(),
}))

import * as ana from '@/analysis/anaData'
import { providePeriodMonths, usePeriod } from '@/analysis/usePeriod'
import ChurnView from '@/views/analysis/ChurnView.vue'
import TenantEnergyView from '@/views/analysis/TenantEnergyView.vue'
import TenantPortfolioView from '@/views/analysis/TenantPortfolioView.vue'
import TenantPeerView from '@/views/analysis/TenantPeerView.vue'
import FinBalanceView from '@/views/analysis/FinBalanceView.vue'

const pending = <T>() => new Promise<T>(() => {})
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── 夹具(非退化:多户、多月、多期区) ──
const MONTHS = ['2025-12', '2026-07', '2026-08']

const LEDGER: AnalysisLedgerRow[] = [7, 8].flatMap((m) => ['甲', '乙', '丙'].map((n, i) => ({
  companyId: 1, companyName: '一公司', year: 2026, month: m, tenantId: i + 1, tenantName: n + '租户',
  balancePrev: 0, receivable: 10000 * (i + 1), collected: 8000 * (i + 1), balanceEnd: 2000 * (i + 1),
})))
const S10: AnalysisS10Row[] = ['2025-12', '2026-07', '2026-08'].flatMap((ym, k) => ['甲', '乙', '丙'].map((n, i) => ({
  acctMonth: ym, phase: i + 1, tenantId: i + 1, tenantName: n + '租户',
  elec: 1000 * (i + 1) + 100 * k, water: 100 * (i + 1), total: 1200 * (i + 1) + 100 * k,
})))
const S10_MAP = new Map<string, AnalysisS10Row[]>()
for (const r of S10) S10_MAP.set(r.tenantName, [...(S10_MAP.get(r.tenantName) ?? []), r])

const today = new Date()
const iso = (d: Date) => d.toLocaleDateString('sv')
const B = (id: number, phase: number): BuildingDTO => ({ id, name: `P${id}栋`, phase, phaseName: '', zone: 'p' + id, kind: 'normal', floorCount: 1, totalArea: 0, rentableArea: 0, status: 1, unitCount: 0, occupiedCount: 0, vacantCount: 0, expiringCount: 0, reservedCount: 0, leasedArea: 0, occRate: null, monthlyRent: 0, tenantIds: [], tenantBuildingArea: 0 })
const BUILDINGS = [B(1, 1), B(2, 2)]
const ct = (id: number, tenantId: number, buildingId: number, rent: number): ContractDTO => ({
  id, contractNo: 'HT' + id, tenantId, tenantName: `租户${String(tenantId).padStart(2, '0')}`, buildingId, buildingName: '', unitId: null, floorInfo: '',
  rentArea: 100, monthlyRent: rent, deposit: 0,
  startDate: iso(new Date(today.getFullYear() - 2, 0, 1)), endDate: iso(new Date(today.getFullYear() + 1, 0, 1)), signDate: null,
  status: 'active', kind: 'normal', termMonths: 24, daysToEnd: null, remark: null, billingLineCount: 1,
})
// 期区一 22 份(≥20 能画直方图),期区二 3 份
const CONTRACTS = [
  ...Array.from({ length: 22 }, (_, i) => ct(1000 + i, i + 1, 1, 1000 + i * 100)),
  ...Array.from({ length: 3 }, (_, i) => ct(2000 + i, 50 + i, 2, 800)),
]
const TENANTS: TenantDTO[] = CONTRACTS.map((c) => ({
  id: c.tenantId, companyName: c.tenantName, contactName: null, contactPhone: null, businessType: '', status: 1,
  categoryId: null, phase: c.buildingId, since: null, monthlyRent: c.monthlyRent, leasedArea: c.rentArea,
  primaryBuilding: null, contractCount: 1, parentId: null, parentName: null,
}))

const bsDto = (cash: number): ReportPeriodDTO => ({
  amounts: { '1': { end: cash }, '4': { end: 400 }, '31': { end: 300 }, '48': { end: cash + 100 } },
  customRows: [],
})
const isDto: ReportPeriodDTO = { amounts: { '1': { ytd: 500 }, '32': { ytd: 50 } }, customRows: [] }

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  vi.mocked(ana.fetchAvailableMonths).mockResolvedValue({ months: MONTHS, sources: { pnl: MONTHS, report: ['2025-12', '2026-08'] } })
  vi.mocked(ana.fetchLedgerRows).mockResolvedValue(LEDGER)
  vi.mocked(ana.fetchS10Rows).mockResolvedValue(S10)
  vi.mocked(ana.fetchS10TenantMap).mockResolvedValue(S10_MAP)
  vi.mocked(ana.fetchTenants).mockResolvedValue(TENANTS)
  vi.mocked(ana.fetchContracts).mockResolvedValue(CONTRACTS)
  vi.mocked(ana.fetchBuildings).mockResolvedValue(BUILDINGS as never)
  vi.mocked(ana.fetchContractDetail).mockImplementation(async () => ({ contract: {}, tenant: {}, extraUnitIds: [], billingLines: [] }) as never)
  vi.mocked(ana.fetchCompanies).mockResolvedValue([{ id: 1, name: '一公司', short: '一', sortNo: 1 }])
  vi.mocked(ana.fetchReportAll).mockImplementation(async (stmt, y) => (stmt === 'bs' ? bsDto(y === 2026 ? 120000 : 60000) : isDto))
  vi.mocked(ana.fetchReportPeriod).mockImplementation(async (stmt) => (stmt === 'bs' ? bsDto(120000) : isDto))
  // usePeriod 是模块级单例:每条挂载前显式落到 2026-08
  providePeriodMonths(MONTHS, MONTHS)
  usePeriod().setGran('month')
  usePeriod().setYear(2026)
  usePeriod().setMonth(8)
})

const mounted: VueWrapper[] = []
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  vi.unstubAllGlobals()
})

const OPTS = { global: { stubs: { RouterLink: true, teleport: true } } }
function mountView(c: Component) {
  const w = mount(c as never, OPTS)
  mounted.push(w)
  return w
}
/** KeepAlive 宿主:toggle() 切走再切回 = 回签 */
function mountKept(c: Component) {
  const shown = ref(true)
  const Other = defineComponent({ render: () => h('div') })
  const Host = defineComponent({ setup: () => () => h(KeepAlive, null, [shown.value ? h(c) : h(Other)]) })
  const w = mount(Host, OPTS)
  mounted.push(w)
  return {
    w,
    async toggle() {
      shown.value = false; await flushPromises()
      shown.value = true; await flushPromises()
    },
  }
}

/** S 档视口:只让 (max-width: 600px) 命中 */
function asPhone() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === '(max-width: 600px)', media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }))
}
const shimHeights = (w: VueWrapper, root: string) =>
  w.findAll(`${root} .fp-shim`).map((e) => (e.element as HTMLElement).style.height)
const charts = (w: VueWrapper) => w.findAll('.stub-chart').map((e) => e.element)
/** 同一批 DOM 节点 —— 比身份,不比结构:toEqual 对 DOM 走 isEqualNode,新挂上的桩也算「相等」 */
const same = (a: Element[], b: Element[]) => a.length === b.length && a.every((e, i) => e === b[i])

describe('S 档首进 · 骨架里顶替 AnaEChart 的块按降档表(300/440→260 · 250→220 · 200→180),文字行 20', () => {
  beforeEach(() => {
    asPhone()
    for (const f of [ana.fetchLedgerRows, ana.fetchS10Rows, ana.fetchS10TenantMap, ana.fetchTenants, ana.fetchContracts, ana.fetchBuildings])
      vi.mocked(f).mockImplementation(pending as never)
  })

  it('❗流失预警:页头 20/20 · 散点 260 + 图例 20 · 两表不降 · 流向图 260', async () => {
    const w = mountView(ChurnView)
    await flushPromises()
    expect(shimHeights(w, '.churn-skel')).toEqual([
      '20px', '20px',
      '20px', '260px', '20px',
      '20px', '330px',
      '20px', '420px',
      '20px', '260px',
    ])
  })

  it('❗租户用能:趋势 260 · 应收实收 180 · Top20 260 · 散点 260 + 图例 20', async () => {
    const w = mountView(TenantEnergyView)
    await flushPromises()
    expect(shimHeights(w, '.te2-skel')).toEqual([
      '20px', '31px', '',
      '20px', '260px', '20px', '20px',
      '20px', '180px', '20px',
      '20px', '260px',
      '20px', '260px', '20px',
    ])
  })

  it('❗结构与续约:帕累托 260 · 环 260 · 箱点 220;生命周期 5 行 = 156', async () => {
    const w = mountView(TenantPortfolioView)
    await flushPromises()
    expect(shimHeights(w, '.tp2-skel')).toEqual([
      '20px', '260px',
      '20px', '260px', '112px',
      '20px', '220px',
      '20px', '220px',
      '20px', '156px',
      '20px', '486px',
    ])
  })

  it('❗租户对标:没有 AnaEChart,自绘直方图 280 不降档;页头 20/20,表块 = 表头 30 + 38×n', async () => {
    const w = mountView(TenantPeerView)
    await flushPromises()
    expect(shimHeights(w, '.tp-skel')).toEqual([
      '20px', '20px', '36px',
      '31px',
      '20px', '280px', '20px', '20px',
      '20px', '106px', '20px', '20px',
      '20px', '68px', '20px', '20px',
      '20px', '182px', '20px', '20px',
    ])
  })
})

describe('数据到了是真内容;换期 / 回签不重挂', () => {
  it('❗流失预警:数据到了骨架摘掉,两张图挂上', async () => {
    const w = mountView(ChurnView)
    await flushPromises()
    expect(w.find('.churn-skel').exists()).toBe(false)
    expect(w.find('.ak-title').text()).toBe('租户流失预警')
    expect(charts(w)).toHaveLength(2)
  })

  it('❗租户用能:换年只在同一份数据上重算 —— 不打接口、不卸图、不退让', async () => {
    const w = mountView(TenantEnergyView)
    await flushPromises()
    expect(w.find('.te2-skel').exists()).toBe(false)
    const before = charts(w)
    expect(before).toHaveLength(4)
    const calls = vi.mocked(ana.fetchS10TenantMap).mock.calls.length

    usePeriod().setYear(2025)
    await flushPromises()
    await tick(260)
    await flushPromises()
    expect(w.text(), '换年没生效(本期该回退到 2025-12)').toContain('2025-12')
    expect(same(charts(w), before), '换年把图卸掉重挂了').toBe(true)
    expect(vi.mocked(ana.fetchS10TenantMap).mock.calls.length, '换年不该打接口').toBe(calls)
    expect(w.find('.fp-stale').exists()).toBe(false)
  })

  it('❗租户用能:回签重读在途 —— 旧内容原地不动,不退回骨架、不退让(C1-06)', async () => {
    const { w, toggle } = mountKept(TenantEnergyView)
    await flushPromises()
    const before = charts(w)
    expect(before).toHaveLength(4)
    vi.mocked(ana.fetchS10TenantMap).mockImplementation(pending as never)
    await toggle()
    await tick(260)
    await flushPromises()
    expect(vi.mocked(ana.fetchS10TenantMap), '回签没重读').toHaveBeenCalledTimes(2)
    expect(w.find('.te2-skel').exists(), '回签退回了骨架').toBe(false)
    expect(same(charts(w), before), '图被卸掉重挂了').toBe(true)
    expect(w.find('.fp-stale').exists()).toBe(false)
  })

  it('❗结构与续约:数据到了三张图挂上;生命周期条走 --pct(clip-path 形变),不写 width', async () => {
    const w = mountView(TenantPortfolioView)
    await flushPromises()
    expect(w.find('.tp2-skel').exists()).toBe(false)
    expect(charts(w)).toHaveLength(3)
    const fills = w.findAll('.ak-bar-fill').map((e) => (e.element as HTMLElement).style)
    expect(fills).toHaveLength(5)
    expect(fills.map((s) => s.getPropertyValue('--pct'))).toEqual(['100%', '0%', '0%', '0%', '0%'])
    expect(fills.every((s) => s.width === '')).toBe(true)
    // 生命周期条是 DOM 图:容器走 AnaBarRows(视口内首挂 / 回签擦入 320,矩阵第 1 行与回签行)
    const rows = w.findComponent({ name: 'AnaBarRows' })
    expect(rows.exists(), '生命周期条没接擦入').toBe(true)
    expect(rows.findAll('.ak-bar-fill')).toHaveLength(5)
  })

  it('❗结构与续约:回签重读在途 —— 图不卸、不退回骨架', async () => {
    const { w, toggle } = mountKept(TenantPortfolioView)
    await flushPromises()
    const before = charts(w)
    vi.mocked(ana.fetchContracts).mockImplementation(pending as never)
    await toggle()
    expect(vi.mocked(ana.fetchContracts)).toHaveBeenCalledTimes(2)
    expect(w.find('.tp2-skel').exists(), '回签退回了骨架').toBe(false)
    expect(same(charts(w), before), '图被卸掉重挂了').toBe(true)
  })

  it('❗租户对标:回签重读在途 —— 直方图还是同一个 svg,不退回骨架', async () => {
    const { w, toggle } = mountKept(TenantPeerView)
    await flushPromises()
    await flushPromises()
    const svg = w.find('svg.auh')
    expect(svg.exists(), '数据到了没画直方图').toBe(true)
    vi.mocked(ana.fetchContracts).mockImplementation(pending as never)
    await toggle()
    expect(vi.mocked(ana.fetchContracts)).toHaveBeenCalledTimes(2)
    expect(w.find('.tp-skel').exists(), '回签退回了骨架').toBe(false)
    expect(w.find('svg.auh').element).toBe(svg.element)
  })
})

describe('资产负债分析(不上骨架):首进落地 + 换年退让', () => {
  it('❗数据到了屏上有资产负债快照表的行(setup 声明顺序错了就是整屏空白)', async () => {
    const w = mountView(FinBalanceView)
    await flushPromises()
    await flushPromises()
    const rows = w.findAll('[data-bsrow]')
    expect(rows.length, '快照表一行都没有').toBeGreaterThan(40)
    expect(rows[1].text()).toContain('货币资金')
    expect(charts(w)).toHaveLength(3)
  })

  it('❗首进两趟之间(月份列表到了、报表还在路上)不闪「无数据」空卡,也不亮进度线', async () => {
    let release: () => void = () => {}
    vi.mocked(ana.fetchReportAll).mockImplementation((stmt) =>
      new Promise((res) => { const prev = release; release = () => { prev(); res(stmt === 'bs' ? bsDto(120000) : isDto) } }))
    const w = mountView(FinBalanceView)
    await flushPromises()
    expect(vi.mocked(ana.fetchReportAll), '第二趟没发出去').toHaveBeenCalled()
    await tick(260)
    await flushPromises()
    expect(w.find('.ana-empty').exists(), '报表在路上时闪了空卡').toBe(false)
    expect(w.find('.fp-lb').exists(), '首进亮了进度线').toBe(false)
    release()
    await flushPromises()
    expect(w.findAll('[data-bsrow]').length).toBeGreaterThan(40)
  })

  it('❗换年:图不卸;卡头月份跟已画的数据走;200ms 后退让、到数摘掉', async () => {
    const w = mountView(FinBalanceView)
    await flushPromises()
    await flushPromises()
    const before = charts(w)
    expect(before).toHaveLength(3)
    const host = w.find('.fin-page')
    expect(host.attributes('data-stale-host')).toBeDefined()
    expect(w.find('.fin-head .sub').text()).toContain('2026-08')
    const cash = () => w.findAll('[data-bsrow]')[1].text()
    expect(cash()).toMatch(/^货币资金12\.0/)

    let release: () => void = () => {}
    vi.mocked(ana.fetchReportAll).mockImplementation((stmt, y) =>
      new Promise((res) => { const prev = release; release = () => { prev(); res(stmt === 'bs' ? bsDto(y === 2026 ? 120000 : 60000) : isDto) } }))
    usePeriod().setYear(2025)
    await flushPromises()
    expect(same(charts(w), before), '换年把图卸掉重挂了').toBe(true)
    expect(w.find('.fin-head .sub').text(), '数据还没到,卡头先写了新月').toContain('2026-08')
    expect(host.classes()).not.toContain('fp-stale')
    await tick(260)
    await flushPromises()
    expect(w.find('.fin-page').classes()).toContain('fp-stale')
    expect(w.find('.anx-tools > .fp-lb').exists(), '工具条上没亮进度线').toBe(true)
    expect(w.find('.fin-page .fp-lb').exists()).toBe(false)

    release()
    await flushPromises()
    expect(w.find('.fin-page').element).toBe(host.element)
    expect(w.find('.fin-page').classes()).not.toContain('fp-stale')
    expect(w.find('.fp-lb').exists()).toBe(false)
    expect(w.find('.fin-head .sub').text()).toContain('2025-12')
    expect(cash(), '新数据到了表没换').toMatch(/^货币资金6\.0/)
    expect(same(charts(w), before), '图被卸掉重挂了').toBe(true)
  })

  it('❗回退横幅跟已画那份走:同年换月不打接口时跟选择;换期在途冻结(不先拔、不与卡头矛盾),到数同一拍换', async () => {
    const w = mountView(FinBalanceView)
    await flushPromises()
    await flushPromises()
    const banner = () => (w.find('.ana-pbanner').exists() ? w.find('.ana-pbanner').text() : null)
    expect(banner(), '2026-08 是报表月,不该有横幅').toBeNull()
    // 2026-07 不是报表月,快照月仍是 2026-08 —— 不打接口,横幅直接跟选择
    const calls = vi.mocked(ana.fetchReportAll).mock.calls.length
    usePeriod().setMonth(7)
    await flushPromises()
    expect(vi.mocked(ana.fetchReportAll).mock.calls.length).toBe(calls)
    expect(banner()).toBe('所选 2026-07 无报表数据,当前显示 2026-08')
    // 换到 2025-12(报表月):要打接口。在途期间屏上还是 2026-08 那份,横幅与卡头都不许先换
    let release: () => void = () => {}
    vi.mocked(ana.fetchReportAll).mockImplementation((stmt, y) =>
      new Promise((res) => { const prev = release; release = () => { prev(); res(stmt === 'bs' ? bsDto(y === 2026 ? 120000 : 60000) : isDto) } }))
    usePeriod().setYear(2025)
    await flushPromises()
    expect(usePeriod().ym.value).toBe('2025-12')
    expect(w.find('.fin-head .sub').text()).toContain('2026-08')
    expect(banner(), '在途就拔了横幅(旧内容被往上拽,到数再换一次)').toBe('所选 2026-07 无报表数据,当前显示 2026-08')
    release()
    await flushPromises()
    expect(w.find('.fin-head .sub').text()).toContain('2025-12')
    expect(banner()).toBeNull()
    // 再换回 2026-08:在途期间已画的是 2025-12 且当时所选就是它 —— 不许拿新快照月去比旧选择插横幅
    usePeriod().setYear(2026)
    await flushPromises()
    expect(usePeriod().ym.value).toBe('2026-08')
    expect(banner(), '在途插了一条「所选 2025-12 … 当前显示 2025-12」').toBeNull()
    release()
    await flushPromises()
    expect(w.find('.fin-head .sub').text()).toContain('2026-08')
    expect(banner()).toBeNull()
  })
})
