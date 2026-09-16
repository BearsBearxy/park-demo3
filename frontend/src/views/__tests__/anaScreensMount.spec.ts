// src/views/__tests__/anaScreensMount.spec.ts — 20 个分析屏挂载冒烟:挡「整屏空白」这一类 bug。
//
// 2026-09-16:FinBalanceView 的 flashLabel 声明在 immediate watch 之后 —— 暂时性死区,watch 回调
// 第一句就抛 ReferenceError,取数一行不跑,整屏空白,而既有 spec 全绿(没有一条真把那屏挂起来取数)。
// 这里对 src/views/analysis/ 下每个 *View.vue 各挂一次、给非空的最小数据,钉两件事:
//   ① 挂载与取数期间:没有未处理的 promise rejection、没有 Vue error / warn、没有 console.error / warn;
//   ② 数据到齐后:不是骨架(无 *-skel / .fp-shim),也不是空白(内容块 ≥ 该屏下限:图桩 / 自绘 svg / 表格行)。
//
// 夹具不退化:空数组 / null 会走到空态分支,测不到真渲染 —— 数值都带确定性起伏(wave),不是常数。
// AnaEChart 换桩(同 anaScreenSkeleton / tenantPeerScreen):option 是 computed,传 prop 时照样求值,
// 选项构造里抛的错照样冒到 errorHandler;桩只是不起 echarts(AnaEChart 自己的行为由它的 spec 管)。
// 取数 mock 在 anaData 这一层(沿用既有屏级 spec 的写法);纯函数(buildAnomalies / extractPnlBand …)用真的。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Component } from 'vue'
import type { AnalysisLedgerRow, AnalysisMonthsDTO, AnalysisS10Row } from '@/api/analysis'
import type { BudgetRowDTO } from '@/api/budget'
import type { CpPowerUsageDTO, CpReadingDTO, CpStationDTO } from '@/api/cpMeter'
import type { ElecCostEntryDTO, ElecMeterDTO, ElecMetricsMonthDTO, ElecPriceCfgDTO } from '@/api/elecCost'
import type { PvReadingDTO, PvStationDTO } from '@/api/pvMeter'
import type { BuildingDTO, BuildingSummaryDTO } from '@/types/building'
import type { ChargingYearDTO } from '@/types/charging'
import type { ContractDTO, ContractDetailDTO, ContractSummaryDTO } from '@/types/contract'
import type { ElecRecordDTO, ElecYearDTO } from '@/types/elec'
import type { CompanyDTO } from '@/types/ledger'
import type { PnlKind, PnlRowDTO, PnlYearDTO } from '@/types/pnl'
import type { PvPhaseDTO, PvRecordDTO } from '@/types/pv'
import type { ReportPeriodDTO } from '@/types/report'
import type { TenantDTO, TenantSummaryDTO } from '@/types/tenant'
import type { OfficeYearDTO } from '@/types/utilities'
import type { AnomalyInputs, CollectRate, PnlSummary, S10PhaseMonthly } from '@/analysis/anaData'

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
    fetchPnlYear: vi.fn(async (s: string, y: number) => pnlYear(s, y)),
    fetchPnlSummary: vi.fn(async (y: number) => pnlSummary(y)),
    fetchS10Rows: vi.fn(async () => S10),
    fetchS10PhaseMonthly: vi.fn(async () => s10Phase()),
    fetchS10TenantMap: vi.fn(async () => s10TenantMap()),
    fetchLedgerRows: vi.fn(async () => LEDGER),
    fetchCollectRates: vi.fn(async () => collectRates()),
    fetchAnomalyInputs: vi.fn(async (): Promise<AnomalyInputs> => ({ ledger: LEDGER, s10: S10, energy: ENERGY })),
    fetchPvAll: vi.fn(async () => PV),
    fetchPvPhases: vi.fn(async () => PV_PHASES),
    fetchElecYear: vi.fn(async (y: number) => ({ energy: elecYear(y, 'energy'), basic: elecYear(y, 'basic') })),
    fetchChargingYear: vi.fn(async (no: number, y: number) => chargingYear(no, y)),
    fetchUtilitiesYear: vi.fn(async (no: number, y: number) => officeYear(no, y)),
    fetchReportAll: vi.fn(async (stmt: string) => (stmt === 'bs' ? BS : IS)),
    fetchReportPeriod: vi.fn(async (stmt: string) => (stmt === 'bs' ? BS : IS)),
    fetchBudgetAll: vi.fn(async () => BUDGET),
    fetchCompanies: vi.fn(async () => COMPANIES),
    fetchTenants: vi.fn(async () => TENANTS),
    fetchTenantSummary: vi.fn(async () => TENANT_SUM),
    fetchContracts: vi.fn(async () => CONTRACTS),
    fetchContractSummary: vi.fn(async () => CONTRACT_SUM),
    fetchContractDetail: vi.fn(async (id: number) => contractDetail(id)),
    fetchBuildings: vi.fn(async () => BUILDINGS),
    fetchBuildingSummary: vi.fn(async () => BUILDING_SUM),
    fetchBuildingDetail: vi.fn(async () => { throw new Error('分析屏不该取单栋详情') }),
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
    entries: vi.fn(async (y: number, m: number) => ecEntries(y, m)),
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

import { extractPnlBand } from '@/analysis/anaData'
import { __resetPeriodForTest } from '@/analysis/usePeriod'
import { __resetCompareForTest } from '@/analysis/useCompare'
import AnomalyView from '@/views/analysis/AnomalyView.vue'
import BreakevenView from '@/views/analysis/BreakevenView.vue'
import BudgetView from '@/views/analysis/BudgetView.vue'
import ChargingAnalysisView from '@/views/analysis/ChargingAnalysisView.vue'
import ChurnView from '@/views/analysis/ChurnView.vue'
import CockpitView from '@/views/analysis/CockpitView.vue'
import ElecAnalysisView from '@/views/analysis/ElecAnalysisView.vue'
import ExpenseView from '@/views/analysis/ExpenseView.vue'
import ExpiryView from '@/views/analysis/ExpiryView.vue'
import FinBalanceView from '@/views/analysis/FinBalanceView.vue'
import FinCashflowView from '@/views/analysis/FinCashflowView.vue'
import FinPnlView from '@/views/analysis/FinPnlView.vue'
import ParkEnergyView from '@/views/analysis/ParkEnergyView.vue'
import ParkView from '@/views/analysis/ParkView.vue'
import PnlAnalysisView from '@/views/analysis/PnlAnalysisView.vue'
import PvMeterAnaView from '@/views/analysis/PvMeterAnaView.vue'
import PvRoiView from '@/views/analysis/PvRoiView.vue'
import TenantEnergyView from '@/views/analysis/TenantEnergyView.vue'
import TenantPeerView from '@/views/analysis/TenantPeerView.vue'
import TenantPortfolioView from '@/views/analysis/TenantPortfolioView.vue'

// ═════════════════════════════ 夹具 ═════════════════════════════
// 「今天」钉在 2026-09-16(beforeEach 假 Date);数据覆盖 2025-01 ~ 2026-08,损益/附表10 各屏默认落 2026-08。
const pad = (n: number) => String(n).padStart(2, '0')
const range = (n: number) => Array.from({ length: n }, (_, i) => i)
/** 确定性起伏(±17%):夹具不许是常数 —— 零方差会让拟合 / 分位 / 环比走到退化分支 */
const wave = (i: number) => 1 + 0.12 * Math.sin(i * 1.3) + 0.05 * Math.cos(i * 3.7)
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)
const covered = (y: number) => (y === 2026 ? 8 : y === 2025 ? 12 : 0)
const ymsOf = (y: number) => range(covered(y)).map((i) => `${y}-${pad(i + 1)}`)
const YMS = [...ymsOf(2025), ...ymsOf(2026)]

const MONTHS_DTO: AnalysisMonthsDTO = {
  months: YMS,
  sources: {
    pnl: YMS, s10: YMS, ledger: ymsOf(2026), pv: YMS, elec: YMS, charging: YMS, office: YMS,
    report: ['2026-07', '2026-08'],
  },
}

// ── 损益附表 s1~s5(底带标签照 anaData.extractPnlBand / expense.logic 的真实库标签) ──
const series = (y: number, base: number, seed: number): (number | null)[] =>
  range(12).map((i) => (i < covered(y) ? Math.round(base * wave(i + seed + y)) : null))
const prow = (groupLabel: string, label: string, kind: PnlKind, m: (number | null)[], k: number): PnlRowDTO =>
  ({ rowKey: 'r' + k, groupLabel, label, kind, note: null, m, sortOrder: k })
const addUp = (rows: (number | null)[][]): (number | null)[] =>
  range(12).map((i) => (rows[0][i] == null ? null : sum(rows, (r) => r[i] ?? 0)))
const SCHED_BASE: Record<string, [number, number]> = {
  s1: [5_000_000, 3_000_000], s2: [1_200_000, 1_000_000], s3: [200_000, 150_000], s4: [600_000, 400_000],
}
function pnlYear(s: string, y: number): PnlYearDTO {
  if (s === 's5') {
    const d = (g: string, l: string, base: number, k: number) => prow(g, l, 'detail', series(y, base, k), k)
    const sales = [d('销售费用', '一期中介费', 80_000, 1), d('销售费用', '广告费', 30_000, 2)]
    const admin = [d('管理费用', '员工工资', 300_000, 3), d('管理费用', '办公用品', 12_000, 4),
      d('管理费用', '差旅费', 9_000, 5), d('管理费用', '餐补费', 15_000, 6)]
    const fin = [d('财务费用', '银行手续费', 5_000, 7)]
    const repair = series(y, 50_000, 8)
    const bands = [addUp(sales.map((r) => r.m)), addUp(admin.map((r) => r.m)), addUp(fin.map((r) => r.m)), repair]
    return {
      year: y,
      rows: [
        ...sales, ...admin, ...fin,
        prow('销售费用', '销售费用合计', 'total', bands[0], 10),
        prow('', '管理费用总计：', 'total', bands[1], 11),
        prow('', '财务费用合计：', 'total', bands[2], 12),
        prow('', '修缮、改造费用', 'total', repair, 13),
        prow('', '运营费用总计', 'total', addUp(bands), 14),
      ],
    }
  }
  const [rb, cb] = SCHED_BASE[s]
  const seed = +s.slice(1)
  const rev = series(y, rb, seed)
  const cost = series(y, cb, seed + 5)
  return {
    year: y,
    rows: [
      prow('一期', '一期收入', 'detail', rev.map((v) => (v == null ? null : Math.round(v * 0.6))), 1),
      prow('', '园区收入合计', 'total', rev, 2),
      prow('', '园区成本合计', 'total', cost, 3),
      prow('', '园区损益', 'pnl', rev.map((v, i) => (v == null ? null : v - (cost[i] ?? 0))), 4),
    ],
  }
}
/** 与 anaData.fetchPnlSummary 同口径的聚合(那段是模块内私有,mock 掉之后在这里照抄一遍) */
function pnlSummary(year: number): PnlSummary {
  const bySchedule = Object.fromEntries(['s1', 's2', 's3', 's4', 's5'].map((s) => [s, extractPnlBand(s, pnlYear(s, year))]))
  const acc = (keys: string[], pick: 'rev' | 'cost') => range(12).map((i) => {
    let t: number | null = null
    for (const k of keys) { const v = bySchedule[k][pick][i]; if (v != null) t = (t ?? 0) + v }
    return t
  })
  const revenue = acc(['s1', 's2', 's3', 's4'], 'rev')
  const cost = acc(['s1', 's2', 's3', 's4', 's5'], 'cost')
  const profit = revenue.map((r, i) => (r == null || cost[i] == null ? null : r - (cost[i] as number)))
  const months = range(12).filter((i) => revenue[i] != null || cost[i] != null).map((i) => i + 1)
  return { year, months, revenue, cost, profit, bySchedule }
}

// ── 预算(2027 只有预算 = 前瞻年;「其中:电费支出」子行给园区能耗的购电预算线) ──
const BUDGET: BudgetRowDTO[] = [2025, 2026, 2027].flatMap((y, k) => {
  const actual = (v: number) => (y === 2027 ? null : Math.round(v * wave(k)))
  return [
    { year: y, label: '营业收入总计', sub: false, budget: 90_000_000 + k * 4e6, actual: actual(86_000_000), note: null, sortOrder: 1 },
    { year: y, label: '营业成本总计', sub: false, budget: 55_000_000 + k * 2e6, actual: actual(53_000_000), note: null, sortOrder: 2 },
    { year: y, label: '管理费用', sub: false, budget: 4_000_000, actual: actual(3_800_000), note: null, sortOrder: 3 },
    { year: y, label: '其中:电费支出', sub: true, budget: 11_000_000, actual: actual(10_500_000), note: null, sortOrder: 4 },
    { year: y, label: '利润总额', sub: false, budget: 21_000_000 + k * 1e6, actual: actual(19_500_000), note: '含营业外', sortOrder: 5 },
  ]
})

// ── 租户 / 楼栋 / 合同(30 户:一期 22 户够 MIN_SAMPLE=20 → 对标直方图真画;末户已退租) ──
const N_T = 30
const phaseOfT = (i: number) => (i < 22 ? 1 : i < 27 ? 2 : 3)
const tname = (i: number) => `租户${pad(i + 1)}`
const COMPANIES: CompanyDTO[] = [
  { id: 1, name: '一期管理公司', short: '一期', sortNo: 1 },
  { id: 2, name: '二期管理公司', short: '二期', sortNo: 2 },
]
const TENANTS: TenantDTO[] = range(N_T).map((i) => ({
  id: i + 1, companyName: tname(i), contactName: '联系人', contactPhone: '13800000000',
  businessType: '制造', status: i === N_T - 1 ? 0 : 1, categoryId: null, phase: phaseOfT(i),
  since: '2023-01', monthlyRent: Math.round(20_000 * wave(i) * (1 + (i % 5))), leasedArea: 200 + i * 40,
  primaryBuilding: `P${phaseOfT(i)}栋`, contractCount: 1,
  parentId: i === 1 ? 1 : null, parentName: i === 1 ? tname(0) : null,   // 一对家族,给「按家族」开关
}))
const BUILDINGS: BuildingDTO[] = [1, 2, 3].map((p) => ({
  id: p, name: `P${p}栋`, phase: p, phaseName: ['一期', '二期', '三期'][p - 1], zone: `p${p}`, kind: 'normal',
  floorCount: 4, totalArea: 40_000 * p, rentableArea: 30_000 * p, status: 1,
  unitCount: 20 * p, occupiedCount: 15 * p, vacantCount: 5 * p, expiringCount: 1, reservedCount: 0,
  leasedArea: 18_000 * p, occRate: 60 + p * 8, monthlyRent: 300_000 * p, tenantIds: [], tenantBuildingArea: 14_000 * p,
}))
const BUILDING_SUM: BuildingSummaryDTO = { buildingCount: 3, stoppedCount: 0, rentableArea: 180_000, occRate: 74.2, vacantCount: 30, unitCount: 120 }
const TENANT_SUM: TenantSummaryDTO = { tenantActive: N_T - 1, occRate: 74.2, monthlyRent: 1_850_000, expiringTenants: 4 }

const ct = (p: Partial<ContractDTO> & Pick<ContractDTO, 'id' | 'tenantId'>): ContractDTO => ({
  contractNo: 'HT' + p.id, tenantName: tname(p.tenantId - 1),
  buildingId: phaseOfT(p.tenantId - 1), buildingName: `P${phaseOfT(p.tenantId - 1)}栋`, unitId: p.id, floorInfo: '1F',
  rentArea: 300, monthlyRent: 6_000, deposit: 0, buildingArea: 240,
  startDate: '2024-01-01', endDate: '2027-12-31', signDate: '2023-12-15',
  status: 'active', kind: 'normal', termMonths: 48, daysToEnd: 470, remark: null, billingLineCount: 1,
  ...p,
})
// 在租:29 户各一份;每三户一份在未来 12 个月内到期(到期墙 / 续签抽样池有料);单位租金 18~32 起伏
const LIVE = range(N_T - 1).map((i) => {
  const rentArea = 150 + ((i * 37) % 400)
  return ct({
    id: i + 1, tenantId: i + 1, rentArea, buildingArea: +(rentArea * 0.8).toFixed(1),
    monthlyRent: Math.round(rentArea * (18 + ((i * 7) % 15))),
    endDate: i % 3 === 0 ? `2027-${pad(1 + (i % 6))}-28` : i === 4 ? '2026-11-30' : '2028-06-30',
    status: i === 4 ? 'expiring' : 'active',
    // 前三户是 2023 年那份的续签子期 —— 续签回测有命中
    ...(i < 3 ? { parentContractId: 100 + i, linkType: 'renew' as const } : {}),
  })
})
// 已到期、结果已知的 6 份(3 续签 3 未续) + 草稿 / 终止各一,生命周期卡五档都有数
const HISTORY = [
  ...range(6).map((k) => ct({
    id: 100 + k, tenantId: k + 1, startDate: '2021-01-01', endDate: '2023-12-31', signDate: '2020-12-20',
    status: k < 3 ? 'renewed' : 'expired', monthlyRent: 5_000 + k * 700, daysToEnd: null,
  })),
  ct({ id: 110, tenantId: 8, status: 'draft', startDate: '2026-10-01', endDate: '2028-09-30' }),
  ct({ id: 111, tenantId: 9, status: 'terminated', startDate: '2022-01-01', endDate: '2025-03-31' }),
]
const CONTRACTS: ContractDTO[] = [...LIVE, ...HISTORY]
const CONTRACT_SUM: ContractSummaryDTO = { total: CONTRACTS.length, contractActive: 28, contractExpiring: 1, contractDraft: 1, monthlyRent: sum(LIVE, (c) => c.monthlyRent) }
function contractDetail(id: number): ContractDetailDTO {
  const c = CONTRACTS.find((x) => x.id === id) ?? LIVE[0]
  return {
    contract: c,
    tenant: { companyName: c.tenantName, contactName: '联系人', contactPhone: '13800000000', businessType: '制造', status: 1 },
    billingLines: [{ id: 1, contractId: c.id, location: '主', feeKey: 'rent_factory', propertyType: 'factory', billMode: 'per_sqm_month', unitPrice: 20, area: c.rentArea, coeff: 1, source: 'manual', seq: 0 }],
    extraUnitIds: [],
  }
}

// ── 附表10(租户×月):末户 2026-08 消失(流失 / 收入中断),倒数第二户 2025-06 才出现,租户06 七月电费尖峰 ──
const S10: AnalysisS10Row[] = YMS.flatMap((ym, mi) => range(N_T - 1)
  .filter((i) => !(i === N_T - 2 && ym === '2026-08') && !(i === N_T - 3 && ym < '2025-06'))
  .map((i) => {
    const elec = Math.round((3_000 + i * 450) * wave(mi + i) * (i === 5 && ym === '2026-07' ? 2.2 : 1))
    const water = Math.round((300 + i * 20) * wave(mi * 2 + i))
    return { acctMonth: ym, phase: phaseOfT(i), tenantId: i + 1, tenantName: tname(i), elec, water, total: elec + water + 20_000 + i * 1_000 }
  }))
function s10Phase(): S10PhaseMonthly {
  const out: S10PhaseMonthly = { months: YMS, phases: [...new Set(S10.map((r) => r.phase))].sort(), totals: {}, elec: {} }
  for (const r of S10) {
    const t = (out.totals[r.phase] ??= {}), e = (out.elec[r.phase] ??= {})
    t[r.acctMonth] = (t[r.acctMonth] ?? 0) + r.total
    e[r.acctMonth] = (e[r.acctMonth] ?? 0) + r.elec
  }
  return out
}
function s10TenantMap(): Map<string, AnalysisS10Row[]> {
  const m = new Map<string, AnalysisS10Row[]>()
  for (const r of S10) m.set(r.tenantName, [...(m.get(r.tenantName) ?? []), r])
  return m
}

// ── 台账(2026-01~08,租户×公司×月):收缴 72%~99% 起伏,有户低于 96% 目标 → 欠费 / 规则①有料 ──
const LEDGER: AnalysisLedgerRow[] = range(N_T - 1).flatMap((i) => {
  let bal = 5_000 * (i % 3)
  const co = COMPANIES[phaseOfT(i) === 1 ? 0 : 1]
  return range(8).map((k) => {
    const receivable = Math.round((25_000 + i * 900) * wave(k + i))
    const collected = Math.round(receivable * (0.72 + (((i * 7 + k) % 10) * 0.03)))
    const row = { companyId: co.id, companyName: co.name, year: 2026, month: k + 1, tenantId: i + 1, tenantName: tname(i),
      balancePrev: bal, receivable, collected, balanceEnd: bal + receivable - collected }
    bal = row.balanceEnd
    return row
  })
})
function collectRates(): CollectRate[] {
  return ymsOf(2026).map((ym, k) => {
    const rows = LEDGER.filter((r) => r.month === k + 1)
    const receivable = sum(rows, (r) => r.receivable), collected = sum(rows, (r) => r.collected)
    return { ym, receivable, collected, rate: +((collected / receivable) * 100).toFixed(1) }
  })
}
// 园区购电电量:2026-05 跳 +55% → 规则②(能耗环比)有料
const ENERGY = [{
  name: '园区购电电量', unit: ' kWh',
  series: Object.fromEntries(YMS.map((ym, i) => [ym, Math.round(800_000 * wave(i) * (ym === '2026-05' ? 1.55 : 1))])),
}]

// ── 光伏附表6 ──
const PV_PHASES: PvPhaseDTO[] = [
  { id: 'p1', name: '一期光伏', short: '一期', online: '2023-06' },
  { id: 'p2', name: '二期光伏', short: '二期', online: '2024-03' },
]
const PV: PvRecordDTO[] = YMS.flatMap((ym, mi) => PV_PHASES.map((p, k) => {
  const selfKwh = Math.round((40_000 + k * 15_000) * wave(mi + k))
  const gridKwh = Math.round(selfKwh * 0.3)
  const selfAmt = Math.round(selfKwh * 0.62), gridAmt = Math.round(gridKwh * 0.39)
  return { id: mi * 10 + k + 1, phase: p.id, phaseName: p.name, acctMonth: ym, occurMonth: ym,
    selfKwh, selfAmt, gridKwh, gridAmt, gen: selfKwh + gridKwh, fee: selfAmt + gridAmt, note: null, source: 'seed' as const }
}))

// ── 能耗侧(附表11 购电 / 7·8 充电 / 13·14 水电) ──
function elecYear(y: number, type: 'energy' | 'basic'): ElecYearDTO {
  const rows: ElecRecordDTO[] = range(covered(y)).map((i) => {
    const qty = type === 'energy' ? Math.round(800_000 * wave(i + 2)) : null
    const demand = type === 'basic' ? Math.round(3_000 * wave(i)) : null
    const price = type === 'energy' ? 0.62 : 28
    const amount = Math.round((qty ?? demand ?? 0) * price)
    const tax = Math.round(amount * 0.13)
    return { id: i + 1, type, phase: 'p1', phaseName: '一期', acctMonth: `${y}-${pad(i + 1)}`, invDate: null,
      period: type === 'energy' ? '平' : null, cat: null, unit: null, qty, demand, price, rate: 0.13,
      amount, tax, total: amount + tax, note: null, source: 'seed' }
  })
  return { year: y, type, phases: [{ id: 'p1', name: '一期', short: '一期' }], rows,
    total: { qty: sum(rows, (r) => r.qty ?? 0), demand: sum(rows, (r) => r.demand ?? 0), amount: sum(rows, (r) => r.amount), tax: sum(rows, (r) => r.tax), total: sum(rows, (r) => r.total) } }
}
function chargingYear(no: number, y: number): ChargingYearDTO {
  const rows = range(covered(y)).map((i) => {
    const kwh = Math.round((no === 7 ? 30_000 : 8_000) * wave(i + no))
    const fee = Math.round(kwh * 0.5), cost = Math.round(kwh * 0.38)
    return { id: i + 1, scheduleNo: no, cat: 'dc', catName: '直流', acctMonth: `${y}-${pad(i + 1)}`, kwh, fee, cost, profit: fee - cost, note: null, source: 'seed' as const }
  })
  return { year: y, cats: [{ catId: 'dc', name: '直流快充', short: '直流', tint: null }], rows,
    total: { kwh: sum(rows, (r) => r.kwh), fee: sum(rows, (r) => r.fee), cost: sum(rows, (r) => r.cost), profit: sum(rows, (r) => r.profit) } }
}
function officeYear(no: number, y: number): OfficeYearDTO {
  const rows = range(covered(y)).map((i) => {
    const elecQty = Math.round((no === 13 ? 20_000 : 12_000) * wave(i + no)), elecPrice = 0.8
    const waterQty = Math.round(600 * wave(i)), waterPrice = 4.2
    const elecAmt = Math.round(elecQty * elecPrice), waterAmt = Math.round(waterQty * waterPrice)
    const ym = `${y}-${pad(i + 1)}`
    return { id: i + 1, scheduleNo: no, acctMonth: ym, belongMonth: ym, elecQty, elecPrice, elecAmt, waterQty, waterPrice, waterAmt, total: elecAmt + waterAmt, note: null, source: 'seed' as const }
  })
  return { year: y, scheduleNo: no, rows,
    total: { elecQty: sum(rows, (r) => r.elecQty), elecAmt: sum(rows, (r) => r.elecAmt), waterQty: sum(rows, (r) => r.waterQty), waterAmt: sum(rows, (r) => r.waterAmt), total: sum(rows, (r) => r.total) } }
}

// ── 三大报表快照(只给叶子行,小计由 reports/* 的公式算) ──
const BS: ReportPeriodDTO = {
  amounts: Object.fromEntries(Object.entries({
    1: 5.2e6, 4: 3.1e6, 5: 4e5, 9: 9e5, 18: 2.4e7, 19: 6e6, 21: 1.5e6, 25: 2.2e6,
    31: 4e6, 33: 2.3e6, 35: 3e5, 36: 6e5, 39: 1.1e6, 43: 5e6, 48: 1e7, 50: 8e5, 51: 5.2e6,
  }).map(([k, v]) => [k, { end: v }])),
  customRows: [],
}
const IS: ReportPeriodDTO = {
  amounts: {
    1: { cur: 7.5e6, ytd: 6.1e7 }, 2: { cur: 4.1e6, ytd: 3.3e7 }, 3: { cur: 2e5, ytd: 1.6e6 },
    11: { cur: 3e5, ytd: 2.2e6 }, 14: { cur: 9e5, ytd: 7.4e6 }, 18: { cur: 5e4, ytd: 4e5 },
    22: { cur: 2e4, ytd: 1.5e5 }, 24: { cur: 1e4, ytd: 6e4 }, 31: { cur: 4e5, ytd: 3.1e6 },
  },
  customRows: [],
}

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
const cpUsage = (y: number): CpPowerUsageDTO[] => range(covered(y)).flatMap((i) =>
  [...new Set(CP_STATIONS.map((s) => `${s.operator}|${s.vehicleType}`))].map((key, k) => {
    const [operator, vehicleType] = key.split('|') as [string, 'car' | 'ebike']
    const ids = CP_STATIONS.filter((s) => s.operator === operator && s.vehicleType === vehicleType).map((s) => s.id)
    const sumChargeKwh = sum(cpReadings(y).filter((r) => ids.includes(r.stationId) && r.readDate.slice(5, 7) === pad(i + 1)), (r) => r.chargeKwh)
    const meterKwh = Math.round(sumChargeKwh * (1.02 + 0.03 * wave(i + k)))
    return { id: i * 10 + k, operator, vehicleType, month: i + 1, meterKwh, sumChargeKwh, lossKwh: meterKwh - sumChargeKwh, note: null }
  }))

// ── 电费成本模型(电费成本分析) ──
const EC_METERS: ElecMeterDTO[] = [
  { id: 1, name: '一期总表', kind: 'master', sortNo: 1 },
  { id: 2, name: '二期总表', kind: 'master', sortNo: 2 },
  { id: 3, name: '宿舍表', kind: 'dorm', sortNo: 3 },
  { id: 4, name: '运营表', kind: 'ops', sortNo: 4 },
]
const EC_FEES: [number, string, number][] = [
  [1, 'tou_industrial', 420_000], [1, 'basic_industrial', 60_000], [1, 'commercial', 30_000],
  [2, 'tou_industrial', 260_000], [2, 'basic_industrial', 40_000], [3, 'usage', 18_000],
  [4, 'usage', 25_000], [4, 'allocated', 9_000], [1, 'pf_reward', 3_000], [1, 'pv_grid_income', 12_000],
]
const ecEntries = (y: number, m: number): ElecCostEntryDTO[] => (m > covered(y) ? [] : EC_FEES.map(([meterId, feeKey, base], k) => ({
  id: m * 100 + k, meterId, meterName: EC_METERS[meterId - 1].name, acctMonth: `${y}-${pad(m)}`, feeKey, subKey: '',
  amount: Math.round(base * wave(m + k)), qty: null, note: null, source: k === 0 ? 'simulated' as const : 'manual' as const,
})))
const EC_METRICS: [string, string][] = [
  ['parkElecProfit', '园区电费收益'], ['pvInvestIncome', '光伏投资收益'],
  ['basicElecProfit', '基本用电费收益'], ['sellAgreementPnl', '签订售电协议损益'],
]
const ecMetrics = (y: number): ElecMetricsMonthDTO[] => range(covered(y)).map((i) => ({
  month: i + 1,
  metrics: EC_METRICS.map(([key, label], k) => ({ key, label, value: Math.round((50_000 - k * 30_000) * wave(i + k)), formulaText: '', missing: [] })),
}))
const ecPrice = (ym: string): ElecPriceCfgDTO[] => {
  const i = +ym.slice(5, 7)
  return [
    { cfgKey: 'grid_posted_price', value: +(0.66 * wave(i)).toFixed(4), source: 'month', monthValue: null, defaultValue: 0.65, note: null },
    { cfgKey: 'third_party_price', value: +(0.61 * wave(i + 1)).toFixed(4), source: 'month', monthValue: null, defaultValue: 0.6, note: null },
  ]
}

// ── 分栋抄表(光伏分栋分析):6 栋 × 2026-01-01~08-31 逐日,±3% 抖动(同 pvMeterAnaScreen 的「健康栋也要有噪声」) ──
const PV_STATIONS: PvStationDTO[] = range(6).map((i) => ({
  id: i + 1, name: `S${i + 1}`, phase: i < 4 ? 1 : 2, metered: 1,
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

// ═════════════════════════════ 屏清单 ═════════════════════════════
// min = 数据到齐后该屏的内容块数(图桩 + 非图标 svg + tbody 行),2026-09-16 按本夹具实测定,
// 且逐屏对过模板:每张图卡都走到了有数分支。掉到下限以下 = 有卡片退成了空态 / 空白 —— 本文件要挡的就是这个。
// 实测时屏上仍有 .ana-empty 的三处都是模板里无条件的占位卡,不是夹具没喂到:
// FinBalance「趋势数据待录入」、FinCashflow「现金流量表数据待录入」、TenantPortfolio「续约风险」。
const SCREENS: { name: string; comp: Component; min: number }[] = [
  { name: 'AnomalyView', comp: AnomalyView, min: 2 },
  { name: 'BreakevenView', comp: BreakevenView, min: 5 },
  { name: 'BudgetView', comp: BudgetView, min: 8 },
  { name: 'ChargingAnalysisView', comp: ChargingAnalysisView, min: 5 },
  { name: 'ChurnView', comp: ChurnView, min: 31 },
  { name: 'CockpitView', comp: CockpitView, min: 17 },
  { name: 'ElecAnalysisView', comp: ElecAnalysisView, min: 4 },
  { name: 'ExpenseView', comp: ExpenseView, min: 9 },
  { name: 'ExpiryView', comp: ExpiryView, min: 57 },
  { name: 'FinBalanceView', comp: FinBalanceView, min: 64 },
  { name: 'FinCashflowView', comp: FinCashflowView, min: 4 },
  { name: 'FinPnlView', comp: FinPnlView, min: 37 },
  { name: 'ParkEnergyView', comp: ParkEnergyView, min: 7 },
  { name: 'ParkView', comp: ParkView, min: 33 },
  { name: 'PnlAnalysisView', comp: PnlAnalysisView, min: 8 },
  { name: 'PvMeterAnaView', comp: PvMeterAnaView, min: 5 },
  { name: 'PvRoiView', comp: PvRoiView, min: 22 },
  { name: 'TenantEnergyView', comp: TenantEnergyView, min: 6 },
  { name: 'TenantPeerView', comp: TenantPeerView, min: 10 },
  { name: 'TenantPortfolioView', comp: TenantPortfolioView, min: 15 },
]

// ═════════════════════════════ 探针 ═════════════════════════════
const rejections: unknown[] = []
const onRejection = (r: unknown) => { rejections.push(r) }
let spyErr: ReturnType<typeof vi.spyOn>
let spyWarn: ReturnType<typeof vi.spyOn>
let wrapper: VueWrapper | null = null

beforeEach(() => {
  // 只假 Date,不假 setTimeout —— flushPromises 靠真 setTimeout 排空(同 pvMeterAnaScreen)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 16, 12, 0, 0))
  setActivePinia(createPinia())
  localStorage.clear()
  __resetPeriodForTest()      // 模块级单例:不复位的话上一屏选的期会带进下一屏
  __resetCompareForTest()
  rejections.length = 0
  process.on('unhandledRejection', onRejection)
  spyErr = vi.spyOn(console, 'error')
  spyWarn = vi.spyOn(console, 'warn')
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  process.off('unhandledRejection', onRejection)
  spyErr.mockRestore()
  spyWarn.mockRestore()
  vi.useRealTimers()
})

/** 取数链多跳(外壳注入月份 → 期间单例变 → 屏的 watch 取数 → 二段取数):排空几轮,再让 Node 派发 unhandledRejection */
async function settle() {
  for (let i = 0; i < 4; i++) await flushPromises()
  await new Promise((r) => setTimeout(r, 0))
  await flushPromises()
}

describe('分析屏挂载冒烟 · 屏清单与目录一致', () => {
  it('src/views/analysis/ 下的 *View.vue 一个不漏(新屏必须进 SCREENS)', () => {
    const files = readdirSync(join(__dirname, '..', 'analysis')).filter((f) => f.endsWith('View.vue')).map((f) => f.slice(0, -4)).sort()
    expect(files).toHaveLength(20)
    expect(SCREENS.map((s) => s.name).sort()).toEqual(files)
  })
})

describe('分析屏挂载冒烟 · 挂上、取数、出内容(挡整屏空白)', () => {
  it.each(SCREENS)('❗$name', async ({ comp, min }) => {
    const vueErrors: string[] = []
    const vueWarns: string[] = []
    wrapper = mount(comp, {
      global: {
        stubs: { RouterLink: true, teleport: true },
        config: {
          errorHandler: (err, _vm, info) => { vueErrors.push(`${info}: ${String(err)}`) },
          warnHandler: (msg) => { vueWarns.push(msg) },
        },
      },
    })
    await settle()

    // ① 挂载与取数期间零异常 —— 暂时性死区 / 取数形状不对抛的 TypeError 都落在这里
    expect({
      vueErrors,
      vueWarns,
      rejections: rejections.map(String),
      consoleError: spyErr.mock.calls.map((c) => c.map(String).join(' ')),
      consoleWarn: spyWarn.mock.calls.map((c) => c.map(String).join(' ')),
    }).toEqual({ vueErrors: [], vueWarns: [], rejections: [], consoleError: [], consoleWarn: [] })

    // ② 数据到齐:骨架摘掉了,且真有内容 —— 被 catch 吞掉的失败(屏退成空态 / 失败卡)落在这里
    const root = wrapper.element as HTMLElement
    expect(root.querySelectorAll('[class*="-skel"], .fp-shim, .page-spin').length, '数据到齐了还挂着骨架').toBe(0)
    const content = root.querySelectorAll('.stub-chart, svg:not(.lucide), tbody tr').length
    expect(content, `内容块 ${content} < ${min}(图桩 / 自绘 svg / 表格行)`).toBeGreaterThanOrEqual(min)
  })
})
