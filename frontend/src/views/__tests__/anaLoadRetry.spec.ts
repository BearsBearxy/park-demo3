// src/views/__tests__/anaLoadRetry.spec.ts — 分析屏其余几屏(T24)换上十件标准件之后的行为:
//   ① 加载失败(画布 06-D 右格):FPLoadError 换掉内容区,带「重试」,点了接口再打一次、成功后失败卡退场;
//      失败卡只在成功分支清(重试在途时留在原地);年度屏的失败句记的是失败的那一年,不跟着换年先改字。
//   ② 页面状态(06-B ⑥):预算屏「按全年显示」、电费成本屏「含模拟数据」从正文横条改成期间选择旁的标签。
//   ③ 结果回执(06-B ⑧):现金流量屏导出催缴清单的两处 alert 换成回执,失败带「重试」。
//
// 取数 mock 在 anaData / api 这一层(同 anaScreensMount.spec);夹具按真实 DTO 类型写,数值不是常数。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Component } from 'vue'
import type { AnalysisLedgerRow, AnalysisMonthsDTO, AnalysisS10Row } from '@/api/analysis'
import type { BudgetRowDTO } from '@/api/budget'
import type { CpPowerUsageDTO, CpReadingDTO, CpStationDTO } from '@/api/cpMeter'
import type { ElecCostEntryDTO, ElecMeterDTO, ElecMetricsMonthDTO, ElecPriceCfgDTO } from '@/api/elecCost'
import type { PvReadingDTO, PvStationDTO } from '@/api/pvMeter'
import type { BuildingDTO, BuildingSummaryDTO } from '@/types/building'
import type { ContractDTO, ContractDetailDTO } from '@/types/contract'
import type { CompanyDTO } from '@/types/ledger'
import type { TenantDTO } from '@/types/tenant'
import type { S10PhaseMonthly } from '@/analysis/anaData'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height'], template: '<div class="stub-chart" />' },
}))
vi.mock('@/analysis/anaData', async (orig) => {
  const a = await orig<typeof import('@/analysis/anaData')>()
  return {
    ...a,
    invalidateAnaCache: vi.fn(),
    fetchAvailableMonths: vi.fn(async () => MONTHS_DTO),
    fetchBuildings: vi.fn(async () => BUILDINGS),
    fetchBuildingSummary: vi.fn(async () => BUILDING_SUM),
    fetchContracts: vi.fn(async () => CONTRACTS),
    fetchContractDetail: vi.fn(async (id: number) => contractDetail(id)),
    fetchTenants: vi.fn(async () => TENANTS),
    fetchS10TenantMap: vi.fn(async () => s10TenantMap()),
    fetchS10PhaseMonthly: vi.fn(async () => s10Phase()),
    fetchCompanies: vi.fn(async () => COMPANIES),
    fetchLedgerRows: vi.fn(async () => LEDGER_ARREARS),
    fetchBudgetAll: vi.fn(async () => BUDGET),
    fetchPnlSummary: vi.fn(async () => { throw new Error('预算夹具只给 2025 前的年份,不该取损益') }),
    fetchPnlYear: vi.fn(async () => { throw new Error('预算夹具只给 2025 前的年份,不该取损益') }),
  }
})
vi.mock('@/api/cpMeter', () => ({
  cpMeterApi: {
    stations: vi.fn(async () => CP_STATIONS),
    years: vi.fn(async () => [2025, 2026]),
    readings: vi.fn(async (y: number) => cpReadings(y)),
    powerUsage: vi.fn(async (y: number) => cpUsage(y)),
  },
}))
vi.mock('@/api/elecCost', () => ({
  elecCostApi: {
    meters: vi.fn(async () => EC_METERS),
    metricsYear: vi.fn(async (y: number) => ecMetrics(y)),
    entries: vi.fn(async (y: number, m: number) => ecEntries(y, m, true)),
    priceCfg: vi.fn(async (ym: string) => ecPrice(ym)),
  },
}))
vi.mock('@/api/pvMeter', () => ({
  pvMeterApi: {
    stations: vi.fn(async () => PV_STATIONS),
    readingsYear: vi.fn(async (y: number) => (y === 2026 ? PV_READINGS : [])),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { list: vi.fn(async () => []) } }))
vi.mock('@/views/analysis/collectionExcel', () => ({ exportCollectionList: vi.fn(async () => undefined) }))

import { fetchBuildings, fetchContracts, fetchLedgerRows } from '@/analysis/anaData'
import { cpMeterApi } from '@/api/cpMeter'
import { elecCostApi } from '@/api/elecCost'
import { pvMeterApi } from '@/api/pvMeter'
import { exportCollectionList } from '@/views/analysis/collectionExcel'
import { receipts } from '@/utils/receipt'
import { __resetPeriodForTest, usePeriod } from '@/analysis/usePeriod'
import { __resetCompareForTest } from '@/analysis/useCompare'
import BudgetView from '@/views/analysis/BudgetView.vue'
import ChargingAnalysisView from '@/views/analysis/ChargingAnalysisView.vue'
import ElecAnalysisView from '@/views/analysis/ElecAnalysisView.vue'
import FinCashflowView from '@/views/analysis/FinCashflowView.vue'
import ParkView from '@/views/analysis/ParkView.vue'
import PvMeterAnaView from '@/views/analysis/PvMeterAnaView.vue'
import TenantPeerView from '@/views/analysis/TenantPeerView.vue'
import TenantPortfolioView from '@/views/analysis/TenantPortfolioView.vue'

// ═════════════════════════════ 夹具(「今天」钉在 2026-09-16) ═════════════════════════════
const pad = (n: number) => String(n).padStart(2, '0')
const range = (n: number) => Array.from({ length: n }, (_, i) => i)
/** 确定性起伏:夹具不许是常数 */
const wave = (i: number) => 1 + 0.12 * Math.sin(i * 1.3) + 0.05 * Math.cos(i * 3.7)
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)
const covered = (y: number) => (y === 2026 ? 8 : y === 2025 ? 12 : 0)
const ymsOf = (y: number) => range(covered(y)).map((i) => `${y}-${pad(i + 1)}`)
const YMS = [...ymsOf(2025), ...ymsOf(2026)]
const MONTHS_DTO: AnalysisMonthsDTO = {
  months: YMS,
  sources: { pnl: YMS, s10: YMS, ledger: ymsOf(2026), pv: YMS, elec: YMS, charging: YMS, office: YMS, report: ['2026-08'] },
}

// ── 租户 / 楼栋 / 合同 ──
const N_T = 8
const tname = (i: number) => `租户${pad(i + 1)}`
const phaseOfT = (i: number) => (i < 5 ? 1 : 2)
const TENANTS: TenantDTO[] = range(N_T).map((i) => ({
  id: i + 1, companyName: tname(i), contactName: '联系人', contactPhone: '13800000000',
  businessType: '制造', status: 1, categoryId: null, phase: phaseOfT(i),
  since: '2023-01', monthlyRent: Math.round(20_000 * wave(i)), leasedArea: 200 + i * 40,
  primaryBuilding: `P${phaseOfT(i)}栋`, contractCount: 1, parentId: null, parentName: null,
}))
const BUILDINGS: BuildingDTO[] = [1, 2].map((p) => ({
  id: p, name: `P${p}栋`, phase: p, phaseName: ['一期', '二期'][p - 1], zone: `p${p}`, kind: 'normal',
  floorCount: 4, totalArea: 40_000 * p, rentableArea: 30_000 * p, status: 1,
  unitCount: 20 * p, occupiedCount: 15 * p, vacantCount: 5 * p, expiringCount: 1, reservedCount: 0,
  leasedArea: 18_000 * p, occRate: 60 + p * 8, monthlyRent: 300_000 * p, tenantIds: [], tenantBuildingArea: 14_000 * p,
}))
const BUILDING_SUM: BuildingSummaryDTO = { buildingCount: 2, stoppedCount: 0, rentableArea: 90_000, occRate: 70.4, vacantCount: 15, unitCount: 60 }
const CONTRACTS: ContractDTO[] = range(N_T).map((i) => {
  const rentArea = 150 + ((i * 37) % 400)
  return {
    id: i + 1, contractNo: 'HT' + (i + 1), tenantId: i + 1, tenantName: tname(i),
    buildingId: phaseOfT(i), buildingName: `P${phaseOfT(i)}栋`, unitId: i + 1, floorInfo: '1F',
    rentArea, monthlyRent: Math.round(rentArea * (18 + ((i * 7) % 15))), deposit: 0, buildingArea: +(rentArea * 0.8).toFixed(1),
    startDate: '2024-01-01', endDate: '2027-12-31', signDate: '2023-12-15',
    status: 'active', kind: 'normal', termMonths: 48, daysToEnd: 470, remark: null, billingLineCount: 1,
  }
})
function contractDetail(id: number): ContractDetailDTO {
  const c = CONTRACTS.find((x) => x.id === id) ?? CONTRACTS[0]
  return {
    contract: c,
    tenant: { companyName: c.tenantName, contactName: '联系人', contactPhone: '13800000000', businessType: '制造', status: 1 },
    billingLines: [{ id: 1, contractId: c.id, location: '主', feeKey: 'rent_factory', propertyType: 'factory', billMode: 'per_sqm_month', unitPrice: 20, area: c.rentArea, coeff: 1, source: 'manual', seq: 0 }],
    extraUnitIds: [],
  }
}
const S10: AnalysisS10Row[] = ymsOf(2026).flatMap((ym, mi) => range(N_T).map((i) => {
  const elec = Math.round((3_000 + i * 450) * wave(mi + i))
  const water = Math.round((300 + i * 20) * wave(mi * 2 + i))
  return { acctMonth: ym, phase: phaseOfT(i), tenantId: i + 1, tenantName: tname(i), elec, water, total: elec + water + 20_000 + i * 1_000 }
}))
function s10TenantMap(): Map<string, AnalysisS10Row[]> {
  const m = new Map<string, AnalysisS10Row[]>()
  for (const r of S10) m.set(r.tenantName, [...(m.get(r.tenantName) ?? []), r])
  return m
}
function s10Phase(): S10PhaseMonthly {
  const out: S10PhaseMonthly = { months: ymsOf(2026), phases: [1, 2], totals: {}, elec: {} }
  for (const r of S10) {
    const t = (out.totals[r.phase] ??= {}), e = (out.elec[r.phase] ??= {})
    t[r.acctMonth] = (t[r.acctMonth] ?? 0) + r.total
    e[r.acctMonth] = (e[r.acctMonth] ?? 0) + r.elec
  }
  return out
}

// ── 台账(现金流量屏):一份有欠费(收缴 72%~99%),一份逐月收齐(没有可催的) ──
const COMPANIES: CompanyDTO[] = [
  { id: 1, name: '一期管理公司', short: '一期', sortNo: 1 },
  { id: 2, name: '二期管理公司', short: '二期', sortNo: 2 },
]
function ledger(paidUp: boolean): AnalysisLedgerRow[] {
  return range(N_T).flatMap((i) => {
    let bal = paidUp ? 0 : 5_000 * (i % 3)
    const co = COMPANIES[phaseOfT(i) - 1]
    return range(8).map((k) => {
      const receivable = Math.round((25_000 + i * 900) * wave(k + i))
      const collected = paidUp ? receivable : Math.round(receivable * (0.72 + (((i * 7 + k) % 10) * 0.03)))
      const row = { companyId: co.id, companyName: co.name, year: 2026, month: k + 1, tenantId: i + 1, tenantName: tname(i),
        balancePrev: bal, receivable, collected, balanceEnd: bal + receivable - collected }
      bal = row.balanceEnd
      return row
    })
  })
}
const LEDGER_ARREARS = ledger(false)
const LEDGER_PAID = ledger(true)

// ── 预算:只给 2025 之前的年份(PNL_SOT_FROM_YEAR 起实际才走损益推算,这里不牵损益) ──
const BUDGET: BudgetRowDTO[] = [2023, 2024].flatMap((y, k) => [
  { year: y, label: '营业收入总计', sub: false, budget: 90_000_000 + k * 4e6, actual: Math.round(86_000_000 * wave(k)), note: null, sortOrder: 1 },
  { year: y, label: '营业成本总计', sub: false, budget: 55_000_000 + k * 2e6, actual: Math.round(53_000_000 * wave(k + 1)), note: null, sortOrder: 2 },
  { year: y, label: '利润总额', sub: false, budget: 21_000_000 + k * 1e6, actual: Math.round(19_500_000 * wave(k + 2)), note: '含营业外', sortOrder: 3 },
])

// ── 分桩运营账(充电桩分析) ──
const CP_STATIONS: CpStationDTO[] = [
  { id: 1, name: 'A区快充', operator: '万城万', vehicleType: 'car', sortNo: 1 },
  { id: 2, name: 'B区快充', operator: '小桔', vehicleType: 'car', sortNo: 2 },
  { id: 3, name: '车棚一', operator: '万城万', vehicleType: 'ebike', sortNo: 3 },
]
const cpReadings = (y: number): CpReadingDTO[] => range(covered(y)).flatMap((i) => CP_STATIONS.map((s) => {
  const chargeKwh = Math.round(4_000 * wave(i + s.id * 3))
  return { id: i * 10 + s.id, stationId: s.id, stationName: s.name, readDate: `${y}-${pad(i + 1)}-15`,
    chargeKwh, fee: Math.round(chargeKwh * 0.04), revenue: Math.round(chargeKwh * 0.35), note: null, source: 'manual' as const }
}))
const cpUsage = (y: number): CpPowerUsageDTO[] => range(covered(y)).map((i) => {
  const sumChargeKwh = sum(cpReadings(y).filter((r) => r.stationId <= 2 && r.readDate.slice(5, 7) === pad(i + 1)), (r) => r.chargeKwh)
  const meterKwh = Math.round(sumChargeKwh * (1.02 + 0.03 * wave(i)))
  return { id: i, operator: '万城万', vehicleType: 'car' as const, month: i + 1, meterKwh, sumChargeKwh, lossKwh: meterKwh - sumChargeKwh, note: null }
})

// ── 电费成本模型(电费成本分析) ──
const EC_METERS: ElecMeterDTO[] = [
  { id: 1, name: '一期总表', kind: 'master', sortNo: 1 },
  { id: 2, name: '宿舍表', kind: 'dorm', sortNo: 2 },
]
const EC_FEES: [number, string, number][] = [
  [1, 'tou_industrial', 420_000], [1, 'basic_industrial', 60_000], [2, 'usage', 18_000], [1, 'pv_grid_income', 12_000],
]
/** sim:第一条费项记成模拟填充(库里现状);false = 全是手录 */
const ecEntries = (y: number, m: number, sim: boolean): ElecCostEntryDTO[] => (m > covered(y) ? [] : EC_FEES.map(([meterId, feeKey, base], k) => ({
  id: m * 100 + k, meterId, meterName: EC_METERS[meterId - 1].name, acctMonth: `${y}-${pad(m)}`, feeKey, subKey: '',
  amount: Math.round(base * wave(m + k)), qty: null, note: null, source: sim && k === 0 ? 'simulated' as const : 'manual' as const,
})))
const ecMetrics = (y: number): ElecMetricsMonthDTO[] => range(covered(y)).map((i) => ({
  month: i + 1,
  metrics: [['parkElecProfit', '园区电费收益'], ['pvInvestIncome', '光伏投资收益']].map(([key, label], k) =>
    ({ key, label, value: Math.round((50_000 - k * 30_000) * wave(i + k)), formulaText: '', missing: [] })),
}))
const ecPrice = (ym: string): ElecPriceCfgDTO[] => {
  const i = +ym.slice(5, 7)
  return [
    { cfgKey: 'grid_posted_price', value: +(0.66 * wave(i)).toFixed(4), source: 'month', monthValue: null, defaultValue: 0.65, note: null },
    { cfgKey: 'third_party_price', value: +(0.61 * wave(i + 1)).toFixed(4), source: 'month', monthValue: null, defaultValue: 0.6, note: null },
  ]
}

// ── 分栋抄表(光伏分栋分析):4 栋 × 2026-01-01~08-31 逐日,±3% 抖动 ──
const PV_STATIONS: PvStationDTO[] = range(4).map((i) => ({
  id: i + 1, name: `S${i + 1}`, phase: i < 2 ? 1 : 2, metered: 1,
  capacityKwp: 100, panelCount: 200, panelWatt: 500, priceYuan: 0.86, sortNo: i,
}))
const PV_READINGS: PvReadingDTO[] = range(243).flatMap((d) => {
  const date = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10)
  return PV_STATIONS.map((s) => {
    const gen = 400 * (1 + (d % 5) * 0.1) * (1 + 0.03 * Math.sin(d * 7.1 + s.id * 2.3))
    return { id: d * 10 + s.id, stationId: s.id, stationName: s.name, readDate: date,
      genTotal: gen, selfUse: gen * 0.7, gridFeed: gen * (0.27 + (d % 4) * 0.005),
      priceSnap: 0.86, revenue: gen * 0.7 * 0.86, note: null, source: 'simulated' as const }
  })
})

// ═════════════════════════════ 挂载 ═════════════════════════════
let w: VueWrapper | null = null
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })   // 只假 Date:flushPromises 靠真 setTimeout
  vi.setSystemTime(new Date(2026, 8, 16, 12, 0, 0))
  setActivePinia(createPinia())
  localStorage.clear()
  __resetPeriodForTest()
  __resetCompareForTest()
  receipts.splice(0)
  vi.clearAllMocks()
  vi.mocked(elecCostApi.entries).mockImplementation(async (y: number, m: number) => ecEntries(y, m, true))
  vi.mocked(pvMeterApi.readingsYear).mockImplementation(async (y: number) => (y === 2026 ? PV_READINGS : []))
})
afterEach(() => {
  w?.unmount()
  w = null
  vi.useRealTimers()
})
async function settle() {
  for (let i = 0; i < 4; i++) await flushPromises()
  await new Promise((r) => setTimeout(r, 0))
  await flushPromises()
}
async function mountScreen(comp: Component) {
  w = mount(comp, { global: { stubs: { RouterLink: true, teleport: true } } })
  await settle()
  return w
}
const loadErr = (v: VueWrapper) => v.find('.fp-empty.error')
/** 一个永远不回的请求:停在「重试在途」那一刻看屏 */
const pending = <T>() => new Promise<T>(() => {})
/** 光伏屏首挂时期间还是 0 年(外壳注入月份前),会先打一趟 readingsYear(0) —— 只让 2026 那一趟失败一次 */
function failPv2026Once() {
  let hit = false
  vi.mocked(pvMeterApi.readingsYear).mockImplementation(async (y: number) => {
    if (y === 2026 && !hit) { hit = true; throw new Error('boom') }
    return y === 2026 ? PV_READINGS : []
  })
}

// ═════════════════════════════ ① 加载失败 → 重试 ═════════════════════════════
describe('分析屏其余 · 加载失败换成 FPLoadError,点「重试」重新取数', () => {
  const boom = (fn: () => { mockRejectedValueOnce: (e: Error) => unknown }) => () => { fn().mockRejectedValueOnce(new Error('boom')) }
  const CASES = [
    { name: 'ParkView', comp: ParkView, fn: () => vi.mocked(fetchBuildings), text: '楼栋、合同和租户数据没读到' },
    { name: 'TenantPeerView', comp: TenantPeerView, fn: () => vi.mocked(fetchContracts), text: '合同、楼栋和租户数据没读到' },
    { name: 'ElecAnalysisView', comp: ElecAnalysisView, fn: () => vi.mocked(elecCostApi.metricsYear), text: '2026 年的电费成本数据没读到' },
    { name: 'ChargingAnalysisView', comp: ChargingAnalysisView, fn: () => vi.mocked(cpMeterApi.readings), text: '2026 年的充电桩数据没读到' },
    // 光伏屏一次取数打两趟 readingsYear(这一年 + 上一年,2026-10-06 改稿:比去年同月要上一年读数)
    { name: 'PvMeterAnaView', comp: PvMeterAnaView, fn: () => vi.mocked(pvMeterApi.readingsYear), text: '2026 年的分栋抄表数据没读到', arm: failPv2026Once, per: 2 },
  ].map((c) => ({ arm: boom(c.fn), per: 1, ...c }))

  it.each(CASES)('❗$name:失败卡换掉内容区、写明哪份没读到;点重试接口再打一次,成功后失败卡退场', async ({ comp, fn, text, arm, per }) => {
    arm()
    const v = await mountScreen(comp)
    expect(loadErr(v).exists(), '失败了却没出失败卡').toBe(true)
    expect(loadErr(v).find('.t').text()).toBe(text)
    const retry = loadErr(v).find('button')
    expect(retry.text()).toBe('重试')
    const before = fn().mock.calls.length
    await retry.trigger('click')
    await settle()
    expect(fn(), '点「重试」没有重新取数').toHaveBeenCalledTimes(before + per)
    expect(loadErr(v).exists(), '重试成功了失败卡还挂着').toBe(false)
  })

  it('❗ParkView:重试在途时失败卡留在原地(错误只在成功分支清),到数才退场', async () => {
    vi.mocked(fetchBuildings).mockRejectedValueOnce(new Error('boom'))
    const v = await mountScreen(ParkView)
    let done!: (b: BuildingDTO[]) => void
    vi.mocked(fetchBuildings).mockImplementationOnce(() => new Promise((r) => { done = r }))
    await loadErr(v).find('button').trigger('click')
    await settle()
    expect(loadErr(v).exists(), '重试一按下失败卡就没了 —— 在途时会先闪出一页空表').toBe(true)
    done(BUILDINGS)
    await settle()
    expect(loadErr(v).exists()).toBe(false)
    expect(v.find('.pk-name').text()).toBe('出租与楼栋')   // 2026-10 改稿:屏名进工具条,页头大标题撤掉
  })

  it('❗ElecAnalysisView:换年失败后再换年,在途时失败卡留着、仍写失败的那一年(不跟着选择先改字)', async () => {
    const v = await mountScreen(ElecAnalysisView)
    expect(v.find('.ea-concl').exists(), '首载 2026 没走到有数分支').toBe(true)
    vi.mocked(elecCostApi.metricsYear).mockRejectedValueOnce(new Error('boom'))
    usePeriod().setYear(2025)
    await settle()
    expect(loadErr(v).find('.t').text()).toBe('2025 年的电费成本数据没读到')
    vi.mocked(elecCostApi.metricsYear).mockImplementationOnce(() => pending())
    usePeriod().setYear(2026)
    await settle()
    expect(vi.mocked(elecCostApi.metricsYear)).toHaveBeenLastCalledWith(2026)
    expect(loadErr(v).exists(), '换年在途失败卡先没了 —— 会闪回旧年内容').toBe(true)
    expect(loadErr(v).find('.t').text()).toBe('2025 年的电费成本数据没读到')
  })
})

// 两趟叠着发(切回重读 + 点重试)只认后发的那趟:先发的晚到,不管带回旧数还是失败,都不许盖屏。
// 第一趟、第二趟挂住,第三趟(默认夹具)先到 → 记下屏上的字 → 放第二趟带少一截的旧数 → 放第一趟失败。
describe('分析屏其余 · 两趟叠着发只认后发的那趟(seq 守卫)', () => {
  function held<T>() {
    let ok!: (v: T) => void, fail!: (e: Error) => void
    const p = new Promise<T>((res, rej) => { ok = res; fail = rej })
    return { p, ok, fail }
  }
  // 破坏验证:各屏 reload 成功支的 `if (my !== seq) return` 删掉 → 旧数盖屏 → 红;
  //           catch 支的 seq 判断删掉 → 冒失败卡 → 红
  const CASES = [
    { name: 'ParkView', comp: ParkView, fn: () => vi.mocked(fetchBuildings), stale: () => BUILDINGS.slice(0, 1) },
    { name: 'TenantPeerView', comp: TenantPeerView, fn: () => vi.mocked(fetchContracts), stale: () => CONTRACTS.slice(0, 2) },
    { name: 'TenantPortfolioView', comp: TenantPortfolioView, fn: () => vi.mocked(fetchContracts), stale: () => CONTRACTS.slice(0, 2) },
  ]
  it.each(CASES)('❗$name:先发的晚到,旧数不盖新数、失败不冒失败卡', async ({ comp, fn, stale }) => {
    const first = held<never>(), second = held<never>()
    ;(fn() as unknown as { mockImplementationOnce: (f: () => Promise<never>) => { mockImplementationOnce: (f: () => Promise<never>) => void } })
      .mockImplementationOnce(() => first.p).mockImplementationOnce(() => second.p)
    const v = await mountScreen(comp)
    const vm = v.vm as unknown as { reload: () => Promise<void> }
    void vm.reload()
    await vm.reload()
    await settle()
    expect(loadErr(v).exists(), '前置:第三趟到数').toBe(false)
    const fresh = v.text()
    second.ok(stale() as never)
    await settle()
    expect(v.text(), '先发的旧数盖了上来').toBe(fresh)
    first.fail(new Error('boom'))
    await settle()
    expect(loadErr(v).exists(), '先发的失败冒了出来').toBe(false)
    expect(v.text()).toBe(fresh)
  })
})

// ═════════════════════════════ ② 期间选择旁的页面状态 ═════════════════════════════
describe('分析屏其余 · 横条改成期间选择旁的 FPStateTag', () => {
  it('❗BudgetView:按月选期时期间旁出「按 2026 全年显示」,按年选期不出;正文里没有横条', async () => {
    const v = await mountScreen(BudgetView)
    usePeriod().setGran('month')
    await settle()
    expect(v.find('.anx-period .fp-state').text()).toBe('预算为年度口径 · 按 2026 全年显示')
    expect(v.find('.bv2-page .bv2-gran-hint').exists()).toBe(false)
    usePeriod().setGran('year')
    await settle()
    expect(v.find('.anx-period .fp-state').exists()).toBe(false)
  })

  it('❗ElecAnalysisView:费项含模拟填充 → 期间旁「本页含模拟数据」,正文不再有说明条;全是手录 → 不出', async () => {
    const v = await mountScreen(ElecAnalysisView)
    expect(v.find('.anx-period .fp-state').text()).toBe('本页含模拟数据 · 真实电费单导入后自动替换')
    expect(v.find('.ak-page .ea-simbar').exists()).toBe(false)
    v.unmount()
    w = null
    __resetPeriodForTest()
    vi.mocked(elecCostApi.entries).mockImplementation(async (y: number, m: number) => ecEntries(y, m, false))
    const v2 = await mountScreen(ElecAnalysisView)
    expect(v2.find('.ea-concl').exists(), '夹具没走到有数分支').toBe(true)
    expect(v2.find('.anx-period .fp-state').exists()).toBe(false)
  })

  it('❗ElecAnalysisView:首进还没数据时标签按「有」隐形留位(数据一到工具条不多折一行)', async () => {
    vi.mocked(elecCostApi.metricsYear).mockImplementationOnce(() => pending())
    const v = await mountScreen(ElecAnalysisView)
    expect(v.find('.ak-skel').exists(), '应停在首进骨架').toBe(true)
    expect(v.find('.anx-period .fp-state').classes()).toContain('ana-hole')
  })
})

// ═════════════════════════════ ③ 导出催缴清单走回执 ═════════════════════════════
describe('FinCashflowView · 导出催缴清单的成败走结果回执,不弹 alert', () => {
  const exportBtn = (v: VueWrapper) => v.findAll('button.fin-link').find((b) => b.text() === '导出催缴清单')!

  it('❗没有欠费:回执(提醒档)写「无需催缴」,不导出、不弹 alert', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.mocked(fetchLedgerRows).mockResolvedValueOnce(LEDGER_PAID)
    const v = await mountScreen(FinCashflowView)
    await exportBtn(v).trigger('click')
    await settle()
    expect(receipts.map((r) => [r.tone, r.text])).toEqual([['warn', '当前口径下无欠费,无需催缴']])
    expect(exportCollectionList).not.toHaveBeenCalled()
    expect(alert).not.toHaveBeenCalled()
    alert.mockRestore()
  })

  it('❗导出失败:失败回执带「重试」,点了按同一口径再导一次', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.mocked(exportCollectionList).mockRejectedValueOnce(new Error('写文件失败'))
    const v = await mountScreen(FinCashflowView)
    await exportBtn(v).trigger('click')
    await settle()
    expect(receipts.map((r) => [r.tone, r.text, r.action?.label])).toEqual([['fail', '写文件失败', '重试']])
    expect(alert).not.toHaveBeenCalled()
    receipts[0].action!.run()
    await settle()
    expect(exportCollectionList).toHaveBeenCalledTimes(2)
    expect(vi.mocked(exportCollectionList).mock.calls[1][0]).toEqual(vi.mocked(exportCollectionList).mock.calls[0][0])
    alert.mockRestore()
  })
})
