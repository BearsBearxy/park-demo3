// src/analysis/anaData.ts — P3 分析层数据适配(替代原型 mock 引擎 ANAP,全部真实 API)。
//
// ══════════════════ 适配器契约(屏组 agent 依赖,勿破坏签名) ══════════════════
// 金额一律**元**(与后端一致),屏内自行折万;月键一律 'YYYY-MM';缺数据月 = null(不补 0)。
// 全部带模块级 Promise 缓存(按参数键):多屏/多次调用只打一次网络;__clearAnaCacheForTest() 清缓存。
//
// │ 导出函数                     │ 服务屏                                  │ 返回形状
// ├─ fetchAvailableMonths()     ├ 全部(AnaShell 注入 usePeriod)          ├ AnalysisMonthsDTO{months,sources}
// ├─ fetchPnlYear(sched, year)  ├ fin-pnl / pnl-analysis / breakeven      ├ PnlYearDTO(rows.m 12 长度,null=未录)
// ├─ fetchPnlSummary(year)      ├ cockpit / fin-pnl / breakeven / anomaly ├ PnlSummary{revenue/cost/profit 12 长度,bySchedule}
// ├─ fetchS10Rows()             ├ tenant-energy/churn/portfolio/park-energy/breakeven/fin-cashflow ├ AnalysisS10Row[](租户×月 slim,全月份;**源头已剔期别汇总行**)
// ├─ fetchS10PhaseMonthly()     ├ cockpit(分期收入)/ park-energy(售电)/ fin-cashflow ├ {months, phases, totals: phase→month→Σtotal, elec: phase→month→Σelec}
// ├─ fetchS10TenantMap()        ├ tenant-energy(Top榜/散点)/ churn(消失)├ Map<tenantName, AnalysisS10Row[]>(每租户按月升序)
// ├─ fetchLedgerRows()          ├ tenant-energy / churn / fin-cashflow    ├ AnalysisLedgerRow[](租户×公司×月,全月份)
// ├─ fetchCollectRates()        ├ cockpit / anomaly(收缴率各期)          ├ CollectRate[]{ym,receivable,collected,rate}
// ├─ fetchPvAll()               ├ pv-roi(全月份)/ park-energy           ├ PvRecordDTO[](跨全部有数据年)
// ├─ fetchElecYear(year)        ├ park-energy(购电,energy+basic 两类)   ├ {energy: ElecYearDTO, basic: ElecYearDTO}
// ├─ fetchChargingYear(no,year) ├ park-energy(7 汽车/8 电动车)           ├ ChargingYearDTO
// ├─ fetchUtilitiesYear(no,year)├ park-energy(13 办公/14 三期)           ├ OfficeYearDTO
// ├─ fetchReportAll(stmt,y,m)   ├ fin-pnl(is)/ fin-balance(bs)         ├ ReportPeriodDTO(全公司汇总)
// ├─ fetchBudgetAll()           ├ budget / cockpit(预算达成卡)           ├ BudgetRowDTO[](全部年份,表小一次拉全)
// ├─ fetchTenants()/fetchTenantSummary()      ├ cockpit/park/portfolio/churn ├ TenantDTO[] / TenantSummaryDTO
// ├─ fetchContracts()/fetchContractSummary()  ├ park/portfolio/expiry/cockpit├ ContractDTO[] / ContractSummaryDTO
// ├─ fetchBuildings()/fetchBuildingDetail(id) ├ park                        ├ BuildingDTO[] / BuildingDetailDTO
// ═══════════════════════════════════════════════════════════════════════════
import { analysisApi, type AnalysisLedgerRow, type AnalysisMonthsDTO, type AnalysisS10Row } from '@/api/analysis'
import { pnlApi } from '@/api/pnl'
import { pvApi } from '@/api/pv'
import { elecApi } from '@/api/elec'
import { chargingApi } from '@/api/charging'
import { utilitiesApi } from '@/api/utilities'
import { reportApi } from '@/api/report'
import { tenantApi } from '@/api/tenant'
import { contractApi } from '@/api/contract'
import { buildingApi } from '@/api/building'
import { companyApi } from '@/api/ledger'
import { budgetApi, type BudgetRowDTO } from '@/api/budget'
import type { ChargingYearDTO } from '@/types/charging'
import type { ElecYearDTO } from '@/types/elec'
import type { PnlYearDTO } from '@/types/pnl'
import type { PvRecordDTO } from '@/types/pv'
import type { OfficeYearDTO } from '@/types/utilities'
import { useTabsStore } from '@/stores/tabs'
import { fpAllPages } from '@/nav/fpNav'

// ── 模块级 Promise 缓存(失败即删,可重试) ──
const cache = new Map<string, Promise<unknown>>()
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    cache.set(key, fn().catch((e: unknown) => { cache.delete(key); throw e }))
  }
  return cache.get(key) as Promise<T>
}
export function __clearAnaCacheForTest(): void { cache.clear() }

// 分析层全部路由 value(fpNav 单一事实源派生,勿手抄清单)。
// 不读 sections:分组是侧栏的事,这里只要「属于分析层」,组怎么切都不该牵动缓存失效的范围。
const ANA_VALUES: string[] = fpAllPages().filter(p => p.layer === 'analysis').map(p => p.value)

// 导入成功(runImport)与 租户/合同/楼栋 写成功后调用:分析层全部缓存失效。
// 同时作废分析页签的 KeepAlive 缓存实例(epoch++)——只清数据缓存的话,缓存实例里的 ref
// 仍是旧值,切回页签照旧显示(审计4「导入后旧数」遗留+派生审计病根B,一处修 18 屏)。
export function invalidateAnaCache(): void {
  cache.clear()
  try {
    const tabs = useTabsStore()
    for (const v of ANA_VALUES) tabs.dropState(v)
  } catch { /* 无 pinia 环境(单测):仅清数据缓存 */ }
}

// ── 期间地基 ──
export function fetchAvailableMonths(): Promise<AnalysisMonthsDTO> {
  return cached('months', () => analysisApi.months())
}

// ── 损益附表 s1~s5 ──
export function fetchPnlYear(schedule: string, year: number): Promise<PnlYearDTO> {
  return cached(`pnl:${schedule}:${year}`, () => pnlApi.year(schedule, year))
}

export interface PnlBand {
  rev: (number | null)[]    // 12 长度,该附表底带「…收入」行
  cost: (number | null)[]   // 底带「…成本」行(s5 = 运营费用总计)
  pnl: (number | null)[]    // 底带 kind='pnl' 总损益行(s5 无 → 全 null)
}
export interface PnlSummary {
  year: number
  months: number[]              // 有覆盖的月份号(1-12,任一附表该月非 null)
  revenue: (number | null)[]    // 园区口径:Σ s1~s4 底带收入
  cost: (number | null)[]       // Σ s1~s4 底带成本 + s5 运营费用总计
  profit: (number | null)[]     // revenue − cost(两侧任一为 null → null)
  bySchedule: Record<string, PnlBand>
}

const SCHEDULES = ['s1', 's2', 's3', 's4', 's5'] as const
// s5 底带大合计行「运营费用总计」= 销售+管理+财务+修缮改造(2025 库 m1 已 SQL 回验:1,060,875.45)
const S5_GRAND_LABEL = '运营费用总计'

function addInto(acc: (number | null)[], m: (number | null)[]): void {
  for (let i = 0; i < 12; i++) {
    const v = m[i]
    if (v == null) continue
    acc[i] = (acc[i] ?? 0) + v
  }
}

/** 单附表底带提取(group_label='' 的总计带;s5 走费用合计标签)。导出仅供单测。 */
export function extractPnlBand(schedule: string, dto: PnlYearDTO): PnlBand {
  const nulls = (): (number | null)[] => new Array(12).fill(null)
  const band: PnlBand = { rev: nulls(), cost: nulls(), pnl: nulls() }
  if (schedule === 's5') {
    for (const r of dto.rows) {
      if (r.kind === 'total' && r.label.startsWith(S5_GRAND_LABEL)) addInto(band.cost, r.m)
    }
    return band
  }
  for (const r of dto.rows) {
    if (r.groupLabel !== '') continue                     // 底带 = 分组列为空的园区总计行
    if (r.kind === 'pnl') addInto(band.pnl, r.m)
    else if (r.kind === 'total' && r.label.includes('收入')) addInto(band.rev, r.m)
    else if (r.kind === 'total' && r.label.includes('成本')) addInto(band.cost, r.m)
  }
  return band
}

/** 园区收入/成本/利润 12 月(跨 s1~s5 聚合;稀疏月保持 null)。 */
export function fetchPnlSummary(year: number): Promise<PnlSummary> {
  return cached(`pnlSummary:${year}`, async () => {
    const dtos = await Promise.all(SCHEDULES.map((s) => fetchPnlYear(s, year)))
    const bySchedule: Record<string, PnlBand> = {}
    SCHEDULES.forEach((s, i) => { bySchedule[s] = extractPnlBand(s, dtos[i]) })
    const revenue: (number | null)[] = new Array(12).fill(null)
    const cost: (number | null)[] = new Array(12).fill(null)
    for (const s of ['s1', 's2', 's3', 's4']) {
      addInto(revenue, bySchedule[s].rev)
      addInto(cost, bySchedule[s].cost)
    }
    addInto(cost, bySchedule.s5.cost)
    const profit = revenue.map((r, i) => (r == null || cost[i] == null ? null : r - (cost[i] as number)))
    const months: number[] = []
    for (let i = 0; i < 12; i++) if (revenue[i] != null || cost[i] != null) months.push(i + 1)
    return { year, months, revenue, cost, profit, bySchedule }
  })
}

// ── s10 销售收入(租户×月 slim,一次拉全) ──
// 源头统一剔除期别汇总行(「202506二期」类,复审:5 屏曾双算):库内已清,此处为保险带,
// 使 PhaseMonthly/TenantMap 及全部下游屏一处受益。
export function fetchS10Rows(): Promise<AnalysisS10Row[]> {
  return cached('s10rows', async () =>
    (await analysisApi.s10TenantMonths()).filter((r) => !isS10AggregateRow(r.tenantName)))
}

export interface S10PhaseMonthly {
  months: string[]                                  // 有数据月份升序
  phases: number[]                                  // 出现过的 phase 升序
  totals: Record<number, Record<string, number>>    // phase → month → Σtotal(元)
  elec: Record<number, Record<string, number>>      // phase → month → Σelec(元)
}
export function fetchS10PhaseMonthly(): Promise<S10PhaseMonthly> {
  return cached('s10phase', async () => {
    const rows = await fetchS10Rows()
    const months = [...new Set(rows.map((r) => r.acctMonth))].sort()
    const phases = [...new Set(rows.map((r) => r.phase))].sort((a, b) => a - b)
    const totals: Record<number, Record<string, number>> = {}
    const elec: Record<number, Record<string, number>> = {}
    for (const r of rows) {
      const t = (totals[r.phase] ??= {})
      t[r.acctMonth] = (t[r.acctMonth] ?? 0) + r.total
      const e = (elec[r.phase] ??= {})
      e[r.acctMonth] = (e[r.acctMonth] ?? 0) + r.elec
    }
    return { months, phases, totals, elec }
  })
}

/** 每租户按月升序的 s10 行(键 = tenantName;tenant_id 为软引用可空,以名为准)。 */
export function fetchS10TenantMap(): Promise<Map<string, AnalysisS10Row[]>> {
  return cached('s10tenant', async () => {
    const rows = await fetchS10Rows()
    const map = new Map<string, AnalysisS10Row[]>()
    for (const r of rows) {
      const list = map.get(r.tenantName) ?? []
      list.push(r)
      map.set(r.tenantName, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.acctMonth.localeCompare(b.acctMonth))
    return map
  })
}

// ── 台账(租户×公司×月 slim,一次拉全) ──
export function fetchLedgerRows(): Promise<AnalysisLedgerRow[]> {
  return cached('ledgerRows', () => analysisApi.ledgerTenantMonths())
}

export interface CollectRate { ym: string; receivable: number; collected: number; rate: number }
/** 收缴率(跨公司按月聚合):rate = Σcollected / Σreceivable × 100(应收为 0 → 0)。 */
export function fetchCollectRates(): Promise<CollectRate[]> {
  return cached('collect', async () => {
    const rows = await fetchLedgerRows()
    const byYm = new Map<string, { receivable: number; collected: number }>()
    for (const r of rows) {
      const ym = r.year + '-' + String(r.month).padStart(2, '0')
      const acc = byYm.get(ym) ?? { receivable: 0, collected: 0 }
      acc.receivable += r.receivable
      acc.collected += r.collected
      byYm.set(ym, acc)
    }
    return [...byYm.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, v]) => ({ ym, ...v, rate: v.receivable ? +(v.collected / v.receivable * 100).toFixed(1) : 0 }))
  })
}

// ── 光伏(全月份跨年) ──
export function fetchPvAll(): Promise<PvRecordDTO[]> {
  return cached('pvAll', async () => {
    const ov = await pvApi.overview()
    const years = ov.years.filter((y) => y.hasData).map((y) => y.year)
    const dtos = await Promise.all(years.map((y) => pvApi.records(y)))
    return dtos.flatMap((d) => d.rows).sort((a, b) => a.acctMonth.localeCompare(b.acctMonth))
  })
}

// ── 能耗侧(按年缓存,park-energy 主力) ──
export function fetchElecYear(year: number) {
  return cached(`elec:${year}`, async () => {
    const [energy, basic] = await Promise.all([elecApi.records(year, 'energy'), elecApi.records(year, 'basic')])
    return { energy, basic }
  })
}
export function fetchChargingYear(no: number, year: number) {
  return cached(`charging:${no}:${year}`, () => chargingApi.records(no, year))
}
export function fetchUtilitiesYear(no: number, year: number) {
  return cached(`utilities:${no}:${year}`, () => utilitiesApi.records(no, year))
}

// ── 三大报表快照(全公司汇总,is/bs;覆盖月见 fetchAvailableMonths().sources.report) ──
export function fetchReportAll(stmt: 'is' | 'bs' | 'tb', year: number, month: number) {
  return cached(`report:${stmt}:${year}:${month}`, () => reportApi.allPeriod(stmt, year, month))
}

// ── 年度预算(budget_row 全量;BudgetView / cockpit 预算达成卡) ──
export function fetchBudgetAll(): Promise<BudgetRowDTO[]> {
  return cached('budgetAll', () => budgetApi.all())
}

// ── 主数据快照 ──
export function fetchTenants() { return cached('tenants', () => tenantApi.list()) }
export function fetchTenantSummary() { return cached('tenantSummary', () => tenantApi.summary()) }
export function fetchContracts() { return cached('contracts', () => contractApi.list()) }
export function fetchContractSummary() { return cached('contractSummary', () => contractApi.summary()) }
export function fetchBuildings() { return cached('buildings', () => buildingApi.list()) }
export function fetchBuildingDetail(id: number) { return cached(`building:${id}`, () => buildingApi.detail(id)) }

// ── 光伏期别元数据(pv-roi:期名/并网月;API 未暴露 cost/capacity,投资额走 anaSettings.pvInvestment) ──
export function fetchPvPhases() { return cached('pvPhases', () => pvApi.phases()) }

// ── park-energy 园区能耗月度平衡(纯聚合,单测见 anaDataEnergy.spec.ts) ──
// 把 购电(elec energy+basic)/光伏/充电 7+8/办公 13+14/s10 售电 合并成 目标年 的逐月行;
// 缺数据月/源 = null(不补 0,契约头规则);仅收 acctMonth 属于 year 的行。
export interface EnergyMonth {
  ym: string                  // 'YYYY-MM'
  buyKwh: number | null       // 购电量 kWh(energy 行 qty Σ)
  buyCost: number | null      // 购电成本 元(energy+basic 价税合计 Σ)
  pvSelfKwh: number | null    // 光伏自消纳 kWh
  pvGridKwh: number | null    // 光伏上网 kWh
  pvAmt: number | null        // 光伏收益 元(自消纳+上网)
  chgKwh: number | null       // 充电电量 kWh(附表7+8)
  chgProfit: number | null    // 充电毛利 元(fee − cost)
  officeKwh: number | null    // 办公/三期用电 kWh(附表13+14)
  s10Elec: number | null      // 售电(转供)收入 元(s10 电费 3 列 Σ)
  s10Water: number | null     // 售水收入 元(s10 水费 2 列 Σ)
}
type EnergyKey = Exclude<keyof EnergyMonth, 'ym'>

export function buildEnergyMonths(
  year: number,
  elec: { energy: ElecYearDTO; basic: ElecYearDTO },
  pv: PvRecordDTO[],
  charging: ChargingYearDTO[],
  office: OfficeYearDTO[],
  s10: AnalysisS10Row[],
): EnergyMonth[] {
  const map = new Map<string, EnergyMonth>()
  const prefix = year + '-'
  const add = (ym: string, key: EnergyKey, v: number): void => {
    if (!ym.startsWith(prefix)) return
    let m = map.get(ym)
    if (!m) {
      m = { ym, buyKwh: null, buyCost: null, pvSelfKwh: null, pvGridKwh: null, pvAmt: null, chgKwh: null, chgProfit: null, officeKwh: null, s10Elec: null, s10Water: null }
      map.set(ym, m)
    }
    m[key] = (m[key] ?? 0) + v
  }
  for (const r of elec.energy.rows) {
    if (r.qty != null) add(r.acctMonth, 'buyKwh', r.qty)
    add(r.acctMonth, 'buyCost', r.total)
  }
  for (const r of elec.basic.rows) add(r.acctMonth, 'buyCost', r.total)
  for (const r of pv) {
    add(r.acctMonth, 'pvSelfKwh', r.selfKwh)
    add(r.acctMonth, 'pvGridKwh', r.gridKwh)
    add(r.acctMonth, 'pvAmt', r.fee)
  }
  for (const dto of charging) for (const r of dto.rows) {
    add(r.acctMonth, 'chgKwh', r.kwh)
    add(r.acctMonth, 'chgProfit', r.profit)
  }
  for (const dto of office) for (const r of dto.rows) add(r.acctMonth, 'officeKwh', r.elecQty)
  for (const r of s10) {
    add(r.acctMonth, 's10Elec', r.elec)
    add(r.acctMonth, 's10Water', r.water)
  }
  return [...map.values()].sort((a, b) => a.ym.localeCompare(b.ym))
}

// ── 异常规则引擎(cockpit 速览 / anomaly 中心共用;spec 4 规则,全部真数据可解释) ──
// buildAnomalies 为纯函数(单测见 anaAnomaly.spec.ts);阈值敏感项(收缴率目标)由调用方传入,
// 屏内用 computed 包裹即可随「目标与阈值」设置即时重算,无需重新拉数。
export type AnomalySev = 'risk' | 'watch' | 'info'
export interface AnaAnomaly {
  id: string
  sev: AnomalySev
  dim: '园区' | '租户' | '管理公司'
  type: string      // 规则名(收缴率/能耗环比/收入中断/负值行)
  metric: string    // 依据指标短语(卡片小标签)
  title: string
  detail: string    // 依据数字(可解释性:每条给出计算依据)
  value: string
  link: string      // 深链目标路径(分析屏或录入屏);消费方按 ym(+company/tenant)组 periodLink(P0c)
  ym: string        // 所属期间 YYYY-MM
  company?: string  // 台账负值行:管理公司名(台账深链 extra.company)
  tenant?: string   // 租户维度规则:租户名(录入屏 extra.tenant 定位行)
}
export interface EnergySeries { name: string; unit: string; series: Record<string, number> }
export interface AnomalyInputs {
  ledger: AnalysisLedgerRow[]
  s10: AnalysisS10Row[]
  energy: EnergySeries[]
}

const fInt = (v: number): string => Math.round(v).toLocaleString('en-US')
const nextYm = (ym: string): string => {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}
// s10 中形如「202507二期」的期别汇总行(tenant_id NULL):按月费用打包行,不代表单一租户,
// 租户级规则(收入中断/Top榜)一律剔除。
export const isS10AggregateRow = (tenantName: string): boolean => /^\d{6}/.test(tenantName)

const SEV_RANK: Record<AnomalySev, number> = { risk: 0, watch: 1, info: 2 }

/** 四规则:①公司×期收缴率<目标 ②能耗电量环比|Δ|>40% ③s10 上期有本期无租户 ④s10/台账负值行。 */
export function buildAnomalies(inputs: AnomalyInputs, opts: { collectTarget: number }): AnaAnomaly[] {
  const out: AnaAnomaly[] = []
  const target = opts.collectTarget

  // ① 收缴率(公司×期):rate = Σ实收/Σ应收×100 < 目标
  const byCo = new Map<string, { name: string; ym: string; recv: number; coll: number }>()
  for (const r of inputs.ledger) {
    const ym = r.year + '-' + String(r.month).padStart(2, '0')
    const k = ym + '|' + r.companyName
    const acc = byCo.get(k) ?? { name: r.companyName, ym, recv: 0, coll: 0 }
    acc.recv += r.receivable
    acc.coll += r.collected
    byCo.set(k, acc)
  }
  for (const g of byCo.values()) {
    if (g.recv <= 0) continue
    const rate = (g.coll / g.recv) * 100
    if (rate >= target) continue
    const gap = target - rate
    out.push({
      id: `col:${g.ym}:${g.name}`,
      sev: gap > 20 ? 'risk' : 'watch',   // ponytail: 差 20pt 定严重,分级阈值可后续进设置弹层
      dim: '管理公司', type: '收缴率', metric: `低于目标 ${target}%`,
      title: `${g.name} ${g.ym} 收缴率 ${rate.toFixed(1)}%`,
      detail: `应收 ¥${fInt(g.recv)} · 实收 ¥${fInt(g.coll)} · 距目标 ${target}% 差 ${gap.toFixed(1)}pt`,
      value: rate.toFixed(1) + '%', link: '/fin-cashflow', ym: g.ym,
    })
  }

  // ② 能耗环比突变(相邻自然月电量,|Δ|>40%;隔月缺数不比)
  for (const es of inputs.energy) {
    for (const ym of Object.keys(es.series).sort()) {
      const n = nextYm(ym)
      const prev = es.series[ym], cur = es.series[n]
      if (!prev || cur == null || prev <= 0) continue
      const chg = (cur / prev - 1) * 100
      if (Math.abs(chg) <= 40) continue
      out.push({
        id: `nrg:${es.name}:${n}`,
        sev: Math.abs(chg) >= 60 ? 'risk' : 'watch',   // ponytail: ±60% 定严重,经验值
        dim: '园区', type: '能耗环比', metric: '环比突变 >±40%',
        title: `${es.name} ${n} 环比${chg > 0 ? '激增' : '骤降'}`,
        detail: `${ym} ${fInt(prev)}${es.unit} → ${n} ${fInt(cur)}${es.unit} · 环比 ${chg >= 0 ? '+' : '−'}${Math.abs(chg).toFixed(1)}%`,
        value: (chg >= 0 ? '+' : '−') + Math.abs(chg).toFixed(1) + '%', link: '/park-energy', ym: n,
      })
    }
  }

  // ③ s10 收入中断(最近两期对比:上期计费>0 且本期无行;剔除期别汇总行)
  const s10Months = [...new Set(inputs.s10.map((r) => r.acctMonth))].sort()
  if (s10Months.length >= 2) {
    const p = s10Months[s10Months.length - 2], c = s10Months[s10Months.length - 1]
    const prevTotals = new Map<string, number>()
    const curNames = new Set<string>()
    for (const r of inputs.s10) {
      if (isS10AggregateRow(r.tenantName)) continue
      if (r.acctMonth === p) prevTotals.set(r.tenantName, (prevTotals.get(r.tenantName) ?? 0) + r.total)
      else if (r.acctMonth === c) curNames.add(r.tenantName)
    }
    for (const [name, tot] of prevTotals) {
      if (tot <= 0 || curNames.has(name)) continue
      out.push({
        id: `gone:${c}:${name}`,
        sev: tot >= 10000 ? 'risk' : tot < 100 ? 'info' : 'watch',
        dim: '租户', type: '收入中断', metric: '上期有收入本期无',
        title: `${name} ${c} 无计费记录`,
        detail: `${p} 计费 ¥${fInt(tot)} → ${c} 无记录,请核实是否退租或漏录`,
        value: `¥${fInt(tot)}`, link: '/churn', ym: c, tenant: name,
      })
    }
  }

  // ④ 负值行(s10 电/水/合计为负;台账应收/实收为负)
  for (const r of inputs.s10) {
    const neg = r.total < 0 ? (['计费合计', r.total] as const)
      : r.elec < 0 ? (['电费', r.elec] as const)
      : r.water < 0 ? (['水费', r.water] as const) : null
    if (!neg) continue
    out.push({
      id: `neg:s10:${r.acctMonth}:${r.tenantName}`,
      sev: Math.abs(neg[1]) >= 10000 ? 'risk' : 'watch',
      dim: '租户', type: '负值行', metric: `附表10 ${neg[0]}为负`,
      title: `${r.tenantName} ${r.acctMonth} ${neg[0]}为负`,
      detail: `${neg[0]} −¥${fInt(Math.abs(neg[1]))},请核对附表10录入`,
      value: `−¥${fInt(Math.abs(neg[1]))}`, link: '/sales-income', ym: r.acctMonth, tenant: r.tenantName,
    })
  }
  for (const r of inputs.ledger) {
    const neg = r.receivable < 0 ? (['应收', r.receivable] as const)
      : r.collected < 0 ? (['实收', r.collected] as const) : null
    if (!neg) continue
    const ym = r.year + '-' + String(r.month).padStart(2, '0')
    out.push({
      id: `neg:ledger:${ym}:${r.companyName}:${r.tenantName}`,
      sev: Math.abs(neg[1]) >= 10000 ? 'risk' : 'watch',
      dim: '管理公司', type: '负值行', metric: `台账${neg[0]}为负`,
      title: `${r.tenantName} ${ym} ${neg[0]}为负`,
      detail: `${r.companyName} 台账:${neg[0]} −¥${fInt(Math.abs(neg[1]))},请核对台账录入`,
      value: `−¥${fInt(Math.abs(neg[1]))}`, link: '/ledger', ym, company: r.companyName, tenant: r.tenantName,
    })
  }

  return out.sort((a, b) =>
    SEV_RANK[a.sev] - SEV_RANK[b.sev] || b.ym.localeCompare(a.ym) || a.title.localeCompare(b.title))
}

/** 规则引擎原料(台账/s10 复用缓存;能耗电量按可用年拉全)。 */
export function fetchAnomalyInputs(): Promise<AnomalyInputs> {
  return cached('anomalyInputs', async () => {
    const [months, ledger, s10] = await Promise.all([fetchAvailableMonths(), fetchLedgerRows(), fetchS10Rows()])
    const yearsOf = (k: string): number[] => [...new Set((months.sources[k] ?? []).map((m) => +m.slice(0, 4)))]

    const elecSeries: Record<string, number> = {}
    for (const dto of await Promise.all(yearsOf('elec').map((y) => fetchElecYear(y)))) {
      for (const r of dto.energy.rows) if (r.qty) elecSeries[r.acctMonth] = (elecSeries[r.acctMonth] ?? 0) + r.qty
    }
    const chargingSeries = async (no: number): Promise<Record<string, number>> => {
      const s: Record<string, number> = {}
      for (const dto of await Promise.all(yearsOf('charging').map((y) => fetchChargingYear(no, y)))) {
        for (const r of dto.rows) s[r.acctMonth] = (s[r.acctMonth] ?? 0) + r.kwh
      }
      return s
    }
    const officeSeries = async (no: number): Promise<Record<string, number>> => {
      const s: Record<string, number> = {}
      for (const dto of await Promise.all(yearsOf('office').map((y) => fetchUtilitiesYear(no, y)))) {
        for (const r of dto.rows) s[r.acctMonth] = (s[r.acctMonth] ?? 0) + r.elecQty
      }
      return s
    }
    const [c7, c8, o13, o14] = await Promise.all([chargingSeries(7), chargingSeries(8), officeSeries(13), officeSeries(14)])
    const energy: EnergySeries[] = [
      { name: '园区购电电量', unit: ' kWh', series: elecSeries },
      { name: '汽车充电电量', unit: ' kWh', series: c7 },
      { name: '电动车充电电量', unit: ' kWh', series: c8 },
      { name: '办公水电用电量', unit: ' 度', series: o13 },
      { name: '三期水电用电量', unit: ' 度', series: o14 },
    ]
    return { ledger, s10, energy }
  })
}

// ── 法人口径(fin 三屏,G4 追加):管理公司清单 + 单公司报表快照(公司选择器消费) ──
export function fetchCompanies() { return cached('companies', () => companyApi.list()) }
export function fetchReportPeriod(stmt: 'is' | 'bs' | 'tb', companyId: number, year: number, month: number) {
  return cached(`report:${stmt}:c${companyId}:${year}:${month}`, () => reportApi.period(stmt, companyId, year, month))
}
