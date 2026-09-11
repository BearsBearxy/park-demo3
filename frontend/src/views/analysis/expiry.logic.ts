// src/views/analysis/expiry.logic.ts — expiry 屏纯数据变换(v2 抽出,口径与 v1 一致,数值不变):
// 合同快照统计 / 金额 Pareto(TopN 柱 + 累计占比线)/ Top10 集中度环 — ECharts option 纯函数。
// 锚点(2026-07-08 dev 库):合同 282 份、月租合计 4,671,702.21、有租金 235、日期缺失 282、Top10 55.8%。
import { quantile } from '@/components/ana/anaFmt'
import { bandSeries } from '@/components/ana/anaTheme'
import type { ContractDTO } from '@/types/contract'

export interface ExpiryStats {
  total: number
  rentSum: number
  withRent: number
  zeroRent: number
  medRent: number
  dateMissing: number
  top10Sum: number
  top10Pct: number
}

/** 合同快照统计(v1 ExpiryView stats computed 原样抽出)。 */
export function buildExpiryStats(cs: ContractDTO[]): ExpiryStats | null {
  if (!cs.length) return null
  const rentSum = cs.reduce((s, c) => s + c.monthlyRent, 0)
  const withRent = cs.filter((c) => c.monthlyRent > 0)
  const dateMissing = cs.filter((c) => !c.startDate && !c.endDate).length
  const top10 = [...cs].sort((a, b) => b.monthlyRent - a.monthlyRent).slice(0, 10)
  const top10Sum = top10.reduce((s, c) => s + c.monthlyRent, 0)
  return {
    total: cs.length,
    rentSum,
    withRent: withRent.length,
    zeroRent: cs.length - withRent.length,
    medRent: quantile(withRent.map((c) => c.monthlyRent), 0.5),
    dateMissing,
    top10Sum,
    top10Pct: rentSum > 0 ? +(top10Sum / rentSum * 100).toFixed(1) : 0,
  }
}

export interface ParetoData {
  tenants: string[]     // TopN 租户名(点柱→清单展开联动用)
  ids: number[]         // TopN 合同 id
  rents: number[]       // 月租金(元)
  cumPct: number[]      // 累计占全部合同月租合计 %
}

/** 合同金额 Pareto:按月租降序 TopN,累计占比对全量 rentSum。 */
export function buildPareto(cs: ContractDTO[], topN = 20): ParetoData {
  const total = cs.reduce((s, c) => s + c.monthlyRent, 0)
  const top = [...cs].sort((a, b) => b.monthlyRent - a.monthlyRent).slice(0, topN)
  let acc = 0
  const cumPct = top.map((c) => {
    acc += c.monthlyRent
    return total > 0 ? +(acc / total * 100).toFixed(1) : 0
  })
  return { tenants: top.map((c) => c.tenantName), ids: top.map((c) => c.id), rents: top.map((c) => c.monthlyRent), cumPct }
}

/** Pareto 柱线双轴 option(柱=月租金万、线=累计占比%)。 */
export function paretoOption(p: ParetoData): object {
  return {
    grid: { left: 48, right: 46, top: 30, bottom: 64 },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps: { name: string; seriesName: string; value: number }[]) =>
        ps[0].name + ps.map((x) => `<br/>${x.seriesName} ${x.seriesName === '累计占比' ? x.value + '%' : '¥' + x.value.toFixed(1) + '万'}`).join(''),
    },
    legend: { top: 0, data: ['月租金', '累计占比'] },
    xAxis: {
      type: 'category', data: p.tenants,
      axisLabel: { rotate: 38, fontSize: 11, formatter: (v: string) => (v.length > 6 ? v.slice(0, 6) + '…' : v) },
    },
    yAxis: [
      { type: 'value', name: '万/月', axisLabel: { formatter: (v: number) => String(v) } },
      { type: 'value', min: 0, max: 100, splitLine: { show: false }, axisLabel: { formatter: '{value}%' } },
    ],
    series: [
      { name: '月租金', type: 'bar', barWidth: '55%', itemStyle: { color: '#378ADD', borderRadius: [3, 3, 0, 0] }, data: p.rents.map((r) => +(r / 10000).toFixed(2)) },
      { name: '累计占比', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2, color: '#EF9F27' }, itemStyle: { color: '#EF9F27' }, data: p.cumPct },
    ],
  }
}

/* ---------- 到期墙(2026-07-12 实装:数据就绪后点亮时间轴) ---------- */

/** 入围状态:草稿/已到期/已退租不进墙。 */
const WALL_STATUS = new Set(['active', 'expiring'])

/** 'YYYY-MM-DD' → [y,m,d] 数值;拆分失败返回 null(new Date 解析字符串有 UTC 时区坑,一律手拆)。 */
function ymd(s: string): [number, number, number] | null {
  const [y, m, d] = s.split('-').map(Number)
  return y && m && d ? [y, m, d] : null
}

export interface ExpiryWallQuarter { label: string; rentSum: number; count: number }
export interface ExpiryWall { quarters: ExpiryWallQuarter[]; totalCount: number }

/** 到期墙:today 所在季度起未来 8 季逐季聚合到期月租与户数(endDate ≥ today 才进墙,按日期为准不信 status;8 季窗口外不计)。 */
export function buildExpiryWall(cs: ContractDTO[], today: Date): ExpiryWall {
  const ty = today.getFullYear(), tm = today.getMonth() + 1
  const todayKey = ty * 10000 + tm * 100 + today.getDate()
  const startQ = ty * 4 + Math.floor((tm - 1) / 3)   // 季度序号 = 年×4 + 季(0..3),跨年自然滚动
  const quarters: ExpiryWallQuarter[] = [...Array(8)].map((_, i) => {
    const qi = startQ + i
    return { label: `${Math.floor(qi / 4)}Q${qi % 4 + 1}`, rentSum: 0, count: 0 }
  })
  for (const c of cs) {
    if (!WALL_STATUS.has(c.status) || !c.endDate) continue
    const p = ymd(c.endDate)
    if (!p) continue
    const [y, m, d] = p
    if (y * 10000 + m * 100 + d < todayKey) continue   // 已过期不进墙
    const off = y * 4 + Math.floor((m - 1) / 3) - startQ
    if (off >= 8) continue                             // 窗口外(≥today 已保证 off≥0)
    quarters[off].rentSum += c.monthlyRent
    quarters[off].count++
  }
  return { quarters, totalCount: quarters.reduce((s, q) => s + q.count, 0) }
}

export interface ExpiringSoonRow {
  id: number; tenantName: string; contractNo: string
  monthlyRent: number; endDate: string; daysLeft: number
}

/** 临期清单:endDate ∈ [today, today+days] 闭区间,状态口径同到期墙,按 endDate 升序。 */
export function buildExpiringSoon(cs: ContractDTO[], today: Date, days = 90): ExpiringSoonRow[] {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())   // 归零到本地零点,天数才数得准
  const limit = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + days)
  const k0 = t0.getFullYear() * 10000 + (t0.getMonth() + 1) * 100 + t0.getDate()
  const k1 = limit.getFullYear() * 10000 + (limit.getMonth() + 1) * 100 + limit.getDate()
  const rows: ExpiringSoonRow[] = []
  for (const c of cs) {
    if (!WALL_STATUS.has(c.status) || !c.endDate) continue
    const p = ymd(c.endDate)
    if (!p) continue
    const [y, m, d] = p
    const k = y * 10000 + m * 100 + d
    if (k < k0 || k > k1) continue
    const daysLeft = Math.round((new Date(y, m - 1, d).getTime() - t0.getTime()) / 86400000)   // round 吸收 DST 时差
    rows.push({ id: c.id, tenantName: c.tenantName, contractNo: c.contractNo, monthlyRent: c.monthlyRent, endDate: c.endDate, daysLeft })
  }
  return rows.sort((a, b) => a.endDate.localeCompare(b.endDate))
}

/** 到期墙柱图 option(柱=每季到期月租折万,tooltip 含户数;样式对齐 paretoOption)。 */
export function wallOption(w: ExpiryWall): object {
  return {
    grid: { left: 48, right: 16, top: 26, bottom: 26 },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps: { name: string; value: number; dataIndex: number }[]) =>
        `${ps[0].name}<br/>¥${ps[0].value}万 · ${w.quarters[ps[0].dataIndex].count} 份合同`,
    },
    xAxis: { type: 'category', data: w.quarters.map((q) => q.label), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', name: '万/月', axisLabel: { formatter: (v: number) => String(v) } },
    series: [{
      name: '到期月租', type: 'bar', barWidth: '55%',
      itemStyle: { color: '#378ADD', borderRadius: [3, 3, 0, 0] },
      data: w.quarters.map((q) => +(q.rentSum / 10000).toFixed(2)),
    }],
  }
}

/** Top10 集中度环(Top10 vs 其余,值=月租金元;tooltip 折万)。 */
export function concentrationOption(top10Sum: number, rentSum: number): object {
  const rest = Math.max(0, rentSum - top10Sum)
  return {
    tooltip: { formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>¥${(p.value / 10000).toFixed(1)}万/月 · ${p.percent}%` },
    series: [{
      type: 'pie', radius: ['58%', '80%'], center: ['50%', '50%'],
      label: { show: false }, labelLine: { show: false },
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },   // 圆角环形+白缝(数据项 color 逐片合并仍生效)
      data: [
        { name: 'Top10 合同', value: top10Sum, itemStyle: { color: '#378ADD' } },
        { name: '其余合同', value: rest, itemStyle: { color: '#B5D4F4' } },
      ],
    }],
  }
}

/* ---------- 合约租金带(Task 7,FORECAST-BAND-AND-PLAIN-SENTENCE §1.1) ----------
 * 锁定线(实线,零随机量)= 已签约、日期覆盖到该月月末的合同。
 * 续签带(蒙特卡洛)= 到期日落在预测视界内的合同,是否续签建模成两层随机性:
 *   ① 哪几户续签 —— 每户各自一枚 Bernoulli(p);
 *   ② p 本身不准 —— p 取自历史回测的 Jeffreys 后验 Beta(hits+0.5, n−hits+0.5)。
 * 与 renewalVariance 的两项方差一一对应,只是这里不假设正态,直接对蒙特卡洛的和取经验分位
 * (稿内数反解 (Σr)²/Σr² ≈ 14.6,85 份到期在金额上等效约 15 份等额赌注,总额是块状多峰分布,
 * 正态的名义 80% 在这个规模下不成立,所以不能从方差反解 ±1.2816σ)。
 *
 * ⚠ 决定权衡与假设,供复核:
 *  · status ∈ {active, renewed}(不含稿里的 expiring)—— 实测(2026-09-11)contract.status
 *    只出现这两个值,expiring 从未出现;若真出现过,它在这套「派生桶」语义下是 active 的一个
 *    子状态(展示态细分),仍会被 active 这一支收进来,不会漏记。收进 renewed 是因为它代表
 *    真实仍在租的续签合同(实测 9 份 renewed 的 endDate ≥ 今天,其中 1 份当月仍在收租)——
 *    漏掉它们会把「锁定」系统性做小,而这条线存在的意义就是「真正锁定了多少」。
 *  · 同一单元同月多于一份合同(实测 2 例):F6(修复轮2)拿掉了 dedupByUnit——单元 455 上是两个
 *    不同租户(265/165)并行跑了好几年的两条租约链,不是重复行;按单元去重会把其中一份月租 32
 *    万的合同整个丢掉(占月度锁定线约 15%)。coveringMonth 的月末覆盖判定本身已保证同一段
 *    租约只算一次,不必再去重——唯一依赖的前提("同一租户不会在同一单元上有两份合同同时
 *    覆盖同一个月末")由 coveringMonth 里的运行时守卫钉住,理由见该函数注释。
 *  · 历史回测分母/命中不是写死的 18/90 —— 由 asOf 现算(下面 decided/renewalHits),18.5/72.5
 *    只是 asOf=2025-12-01 那一次现算的结果,换 asOf 会跟着变(全局约束①要求的锚点显式传入)。
 */

const MC_SEED = 20260910   // 固定种子(锚定稿基准日),任何人重跑都拿到逐字节相同的带
const MC_DRAWS = 10000
const MC_LO_Q = 0.10
const MC_HI_Q = 0.90

function dateKeyOf(s: string | null): number | null {
  if (!s) return null
  const p = ymd(s)
  return p ? p[0] * 10000 + p[1] * 100 + p[2] : null
}

/** asOf 起第 i 个自然月的起止日期键与 'YYYY-MM' 标签(本地 Date 构造做月份进位,不解析 ISO 字符串)。 */
function monthBounds(asOf: string, i: number): { startKey: number; endKey: number; label: string } {
  const [ay, am] = asOf.split('-').map(Number)
  const total = am - 1 + i
  const y = ay + Math.floor(total / 12)
  const m = (total % 12) + 1
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 0)   // 下月第0天 = 本月最后一天
  const key = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
  return { startKey: key(start), endKey: key(end), label: `${y}-${String(m).padStart(2, '0')}` }
}

/** 该月是否整月落在某段免租区间内(区间须覆盖 [monthStart,monthEnd] 两端,不是"月内含免租日")。 */
function monthFullyRentFree(c: ContractDTO, startKey: number, endKey: number): boolean {
  if (!c.rentFree?.length) return false
  return c.rentFree.some((p) => {
    const s = dateKeyOf(p.start), e = dateKeyOf(p.end)
    return s != null && e != null && s <= startKey && e >= endKey
  })
}

/**
 * F6(修复轮2)前提守卫:coveringMonth 不再对结果去重,前提是"同一租户不会在同一单元上
 * 有两份合同同时覆盖同一个月末"(全库验证过:唯一的同租户同单元重叠对是续签交接的 10 天,
 * 不跨任何一个月末)。两个不同租户共用同一单元是合法状态(单元 455 例),不受此守卫约束。
 * 哪天这个前提被打破,这里就地报错,而不是让锁定线/整租线悄悄多算一遍——用 fixture 测,不连库。
 */
function assertNoSameTenantDoubleCoverage(covering: ContractDTO[], endKey: number): void {
  const seenByUnit = new Map<string, number>()   // "unitId:tenantId" → 合同 id
  for (const c of covering) {
    if (c.unitId == null) continue
    const key = `${c.unitId}:${c.tenantId}`
    const prevId = seenByUnit.get(key)
    if (prevId != null) {
      throw new Error(`前提被打破:租户 ${c.tenantId} 在单元 ${c.unitId} 上有两份合同(${prevId}/${c.id})同时覆盖月末 ${endKey}`)
    }
    seenByUnit.set(key, c.id)
  }
}

function coveringMonth(cs: ContractDTO[], startKey: number, endKey: number, wantMaster: boolean): ContractDTO[] {
  const covering = cs.filter((c) => {
    if ((c.kind === 'master_lease') !== wantMaster) return false
    if (!wantMaster && c.status !== 'active' && c.status !== 'renewed') return false
    const ek = dateKeyOf(c.endDate), sk = dateKeyOf(c.startDate)
    if (ek == null || sk == null) return false
    if (ek < endKey || sk > endKey) return false
    return !monthFullyRentFree(c, startKey, endKey)
  })
  assertNoSameTenantDoubleCoverage(covering, endKey)
  return covering
}

/**
 * 锁定月租(brief §Step3 lockedRentByMonth):第 i 月 Σ monthlyRent。条件:status ∈ {active,renewed}、
 * 非整租、endDate ≥ 该月月末、startDate ≤ 该月月末,且该月不整月落在免租区间内。
 * F6(修复轮2):不再按单元去重——coveringMonth 的月末覆盖判定已保证同一段租约只算一次,
 * 一个单元上可以合法地同时住着两个不同租户(单元 455 例),去重会把其中一份真实合同丢掉。
 * asOf 必须显式传入(全局约束①):同一份合同数据在不同锚点下会算出不同的锁定线,已写成断言。
 */
export function lockedRentByMonth(cs: ContractDTO[], asOf: string, n: number): number[] {
  return [...Array(n)].map((_, i) => {
    const { startKey, endKey } = monthBounds(asOf, i)
    return coveringMonth(cs, startKey, endKey, false).reduce((s, c) => s + c.monthlyRent, 0)
  })
}

/** 整租合同月租(kind==='master_lease',单列不进 locked/KPI,理由见文件顶部锚点注释)。
 * F6(修复轮2):不再按单元去重,理由与 lockedRentByMonth 相同——coveringMonth 本身已保证
 * 单月不重复计入同一段租约,一个单元上两个不同整租租户是合法状态,不该被去重丢掉。 */
function masterLeaseByMonth(cs: ContractDTO[], asOf: string, n: number): number[] {
  return [...Array(n)].map((_, i) => {
    const { startKey, endKey } = monthBounds(asOf, i)
    return coveringMonth(cs, startKey, endKey, true).reduce((s, c) => s + c.monthlyRent, 0)
  })
}

export interface RenewalVariance { byWhichTenants: number; byRateUncertainty: number }

/**
 * 续签方差两项分开算(FORECAST §1.1):R = Σ r_i·X_i,X_i~Bernoulli(p)。
 * byWhichTenants = p(1−p)Σr²(哪几户续签的随机性,个体层面,独立可加);
 * byRateUncertainty = Var(p̂)(Σr)²(p 本身的估计误差,整体共享同一个 p,不随户数分摊)。
 * 只用 Wilson(p 的置信区间)只给出后一项 —— 这正是「不能只用 Wilson」的算术含义。
 *
 * F3(修复轮1):这两项此前从未被 buildRentRoll/rentRollOption 调用过 —— 屏上的带完全由
 * simulateRenewalDraws 的蒙特卡洛直接产出,这个闭式解只是单独测算得对,和交付物脱节。
 * 现在 expiry.logic.spec.ts 拿 simulateRenewalDraws 的经验方差和这里的闭式解直接比,
 * 断言已破坏验证过(去掉共享 p、每户各抽一个,会抹掉 byRateUncertainty,经验方差显著偏低)。
 */
export function renewalVariance(rents: number[], p: number, n: number): RenewalVariance {
  const sumR = rents.reduce((s, r) => s + r, 0)
  const sumR2 = rents.reduce((s, r) => s + r * r, 0)
  const byWhichTenants = p * (1 - p) * sumR2
  const varP = (p * (1 - p)) / n
  const byRateUncertainty = varP * sumR * sumR
  return { byWhichTenants, byRateUncertainty }
}

/** mulberry32:32 位状态确定性 PRNG(公有算法),种子固定 → 结果逐字节可重放,零依赖。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 标准正态(Box-Muller),供 Marsaglia-Tsang 的 Gamma 采样使用。 */
function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12)
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/**
 * Gamma(shape,1) 采样(Marsaglia & Tsang 2000,拒绝采样,真实分布不是正态近似)。
 * 方法本身要求 shape≥1;本任务两个形状参数是否满足取决于 n/hits(Jeffreys 后验 hits+0.5、
 * n−hits+0.5),n 很小时后者可能 <1,故补 boost 技巧:采 Gamma(shape+1) 再乘 U^(1/shape)
 * 无偏变回 Gamma(shape)(标准补丁,同一篇论文 §1)。已用 200000 次抽样核对 Beta(0.5,0.5) 与
 * Beta(18.5,72.5) 的经验均值/方差对理论值,吻合(见 task-7-report.md)。
 */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    const g = sampleGamma(shape + 1, rng)
    return g * Math.pow(rng(), 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number, v: number
    do {
      x = gaussian(rng)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rng()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/** Beta(a,b) = Ga/(Ga+Gb),Ga~Gamma(a,1)、Gb~Gamma(b,1) 独立 —— 真 Beta 分布,不是正态换标签。 */
function sampleBeta(a: number, b: number, rng: () => number): number {
  const x = sampleGamma(a, rng)
  const y = sampleGamma(b, rng)
  return x / (x + y)
}

/**
 * 蒙特卡洛续签抽样(F3,修复轮1):从 buildRentRoll 内联双重循环原样搬出来命名导出,
 * 抽样结构一个字节没动 —— 每轮共用一枚从 Beta(a,b) 抽的 p、每户各自一次 Bernoulli(p)、
 * 按到期月分桶累加。搬出来的唯一目的是让 expiry.logic.spec.ts 能拿到原始抽样和,
 * 与 renewalVariance 的闭式解比经验方差(F3 的问题是两者从未被绑在一起验证过,
 * 不是抽样本身有 bug)。
 */
export function simulateRenewalDraws(byExpMonth: number[][], a: number, b: number, draws: number, seed: number): number[][] {
  const n = byExpMonth.length
  const rng = mulberry32(seed)
  const drawSums: number[][] = [...Array(n)].map(() => new Array(draws))
  for (let d = 0; d < draws; d++) {
    const p = sampleBeta(a, b, rng)
    let running = 0
    for (let m = 0; m < n; m++) {
      for (const rent of byExpMonth[m]) running += rng() < p ? rent : 0
      drawSums[m][d] = running
    }
  }
  return drawSums
}

export interface RentRollMonth {
  month: string          // 'YYYY-MM'
  locked: number         // 锁定月租(元)
  masterLease: number    // 整租合同月租(元,单列,不进 locked)
  renewalLo: number      // 续签贡献 10 分位(元,蒙特卡洛,不含 locked)
  renewalHi: number      // 续签贡献 90 分位(元,蒙特卡洛,不含 locked)
}

export interface RentRoll {
  months: RentRollMonth[]
  locked: number[]           // = months.map(m => m.locked)
  lockedBand?: undefined     // 锁定线零随机量,不许套带(❗spec 断言这个键必须是 undefined)
  renewalN: number           // 历史回测分母:asOf 之前已到期、结果已知的合同数
  renewalHits: number        // 其中续签的数量
  renewalP: number           // hits/n(经验续签率;n=0 时给 0,不除以零)
}

/**
 * 合约租金带:锁定线(buildRentRoll.locked,实线)+ 续签区间(蒙特卡洛 10~90 分位)。
 * asOf 必须显式传入(全局约束①),n=预测月数。
 */
export function buildRentRoll(cs: ContractDTO[], asOf: string, n: number): RentRoll {
  const months = [...Array(n)].map((_, i) => monthBounds(asOf, i))
  const locked = lockedRentByMonth(cs, asOf, n)
  const masterLease = masterLeaseByMonth(cs, asOf, n)
  const asOfKey = dateKeyOf(asOf)!

  // 历史回测:asOf 之前已到期、结果已知的合同(草稿从未真正在租,不算"已知结果")。
  // 命中 = 状态已标 renewed,或存在以它为 parentContractId 的后续合同(续签链落地,状态标记
  // 是否同步不影响判定 —— 这就是为什么不能只信 status 字段)。
  //
  // F2(修复轮1,2026-09-11 实测 park_demo3):计划锚点「2025-12-01 续签率 18/90」复现不出来。
  // 查了 9 种口径 —— 仅状态标记 17/106、仅续签链 27/106、两者取或(=当前实现)27/106、
  // 三种各自再加 monthlyRent>0 分别 17/27/27@分母91、只认近12月到期 15/36、近24月到期 17/95、
  // 含 master_lease 只认状态 17/107、限 start_date≥2023-01-01 2/69。分母从没出现过 90,
  // 命中数从没出现过 18。不为了凑这个数改口径 —— 现在这套(状态标记或续签链落地)比只信状态
  // 字段稳,继续用;下面的判定规则(哪些算 decided、哪些算 hit)由 expiry.logic.spec.ts 里
  // 不依赖数据库的 fixture 钉死,口径以后被人改动会当场红。
  //
  // decided 从来不按单元去重 —— 横跨 asOf 之前的全部历史,同一单元先后好几段真实租约
  // (各自到期、各自有续签结果)是常态,不是重复数据。按单元去重会把多段历史强行合并成一段,
  // 悄悄吃掉真实存在的历史续签结果。
  const decided = cs.filter((c) =>
    c.kind !== 'master_lease' && c.status !== 'draft' && (dateKeyOf(c.endDate) ?? Infinity) < asOfKey)
  const renewalHits = decided.filter((c) => c.status === 'renewed' || cs.some((o) => o.parentContractId === c.id)).length
  const renewalN = decided.length
  const renewalP = renewalN > 0 ? renewalHits / renewalN : 0

  // 续签抽样总体:asOf 当天仍在租(未到期)、到期日落在预测视界内的合同。
  // 全程覆盖到视界末尾的合同没有续签不确定性(locked 已经算全了),不进池。
  // F6(修复轮2):不再按单元去重——理由同 lockedRentByMonth:一个单元上可以合法地同时住着
  // 两个不同租户,把它们当重复行砍掉会让续签抽样池丢真实合同。
  const pool = cs.filter((c) =>
    c.kind !== 'master_lease' && (c.status === 'active' || c.status === 'renewed') &&
    (dateKeyOf(c.endDate) ?? -Infinity) >= asOfKey)
  // F8(修复轮2):endDate 恰好等于视界最后一个月月末时,严格小于(ek < mb.endKey)在最后一个
  // 月也不成立,findIndex 全程落空、该合同不进任何桶——这不是漏算。ek 等于最后一月的 endKey
  // 时,coveringMonth 对每个月都判它"覆盖到月末"(含最后一月),即它在整个视界内都是 locked,
  // 真正的续签不确定性落在视界之外的下一个月,本来就不该有桶。这与"全程覆盖到视界末尾的合同
  // 不进池"是同一条规则的边界情形,不是新问题;钉在 expiry.logic.spec.ts 的 F8 用例里。
  const byExpMonth: number[][] = [...Array(n)].map(() => [])
  for (const c of pool) {
    const ek = dateKeyOf(c.endDate)
    if (ek == null) continue
    const idx = months.findIndex((mb) => ek < mb.endKey)   // 首个"不再算 locked"的月
    if (idx >= 0) byExpMonth[idx].push(c.monthlyRent)
  }

  const a = renewalHits + 0.5, b = renewalN - renewalHits + 0.5   // Jeffreys 后验
  const drawSums = simulateRenewalDraws(byExpMonth, a, b, MC_DRAWS, MC_SEED)
  const quantileOf = (arr: number[], q: number): number => {
    const s = [...arr].sort((x, y) => x - y)
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]
  }
  const renewalLo = drawSums.map((s) => quantileOf(s, MC_LO_Q))
  const renewalHi = drawSums.map((s) => quantileOf(s, MC_HI_Q))

  return {
    months: months.map((mb, i) => ({ month: mb.label, locked: locked[i], masterLease: masterLease[i], renewalLo: renewalLo[i], renewalHi: renewalHi[i] })),
    locked,
    lockedBand: undefined,
    renewalN, renewalHits, renewalP,
  }
}

/**
 * 合约租金带 option:锁定线(实线)+ 续签区间带(locked+renewalLo ~ locked+renewalHi)。
 *
 * ⚠ 不套 bandTooWide(anaTheme.ts):那道门判「半宽/中位 > 0.20 → 太宽只出点」,是给
 * P25~P75 这类"画宽了大概率是画法或样本问题"的带用的。这条带的宽是内容本身 ——
 * 85 份到期在金额上等效约 15 份等额赌注,续签是非黑即白的个体事件,宽本来就对,
 * 套上这道门会把这张卡存在的理由(诚实地告诉你续签不确定性有多大)本身给隐藏掉。
 */
export function rentRollOption(r: RentRoll): object {
  const months = r.months.map((m) => m.month)
  const lockedWan = r.months.map((m) => +(m.locked / 10000).toFixed(2))
  const loWan = r.months.map((m) => +((m.locked + m.renewalLo) / 10000).toFixed(2))
  const hiWan = r.months.map((m) => +((m.locked + m.renewalHi) / 10000).toFixed(2))
  return {
    grid: { left: 48, right: 16, top: 30, bottom: 30 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: ['锁定租金'] },
    xAxis: { type: 'category', data: months, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', name: '万/月', axisLabel: { formatter: (v: number) => String(v) } },
    series: [
      { name: '锁定租金', type: 'line', step: 'end', symbol: 'none', lineStyle: { width: 2, color: '#378ADD' }, data: lockedWan },
      ...bandSeries(loWan, hiWan, { name: '续签区间', color: 'rgba(55,138,221,.14)' }),
    ],
  }
}

/**
 * 卡片读数句(D1 可执行形式)。
 * F1(修复轮1):原来走 sFreq,印成「过去 N 次中 k 次」—— sFreq 的 backtests/hits 语义是
 * 区间覆盖率回测(过去做过 N 次预测、区间罩住了 k 次),而这里的 renewalN/renewalHits 是
 * 续签率的分母分子(多少份到期合同续了签),两者从没度量过同一件事,那句话等于替这条带
 * 编了一段不存在的战绩。改法:句子只说区间是什么,不再暗示任何历史命中率;n/hits 按它们
 * 真实的身份(续签统计)搬进 rentRollRefText,同屏仍可见,满足 D1。
 */
export function rentRollSentence(r: RentRoll): string | null {
  const last = r.months[r.months.length - 1]
  if (!last) return null
  const wan = (v: number) => Math.round(v / 10000)
  // 用「预计」不用「拟合」:这条带不是回归拟合出来的,是已签合同(确定)加一个续签率模拟出来的。
  // 「拟合」暗示回归,是这份计划要挤掉的那类夸大。(F7,修复轮2:上一版这里还断言了 sFreq 那句
  // 「拟合区间」措辞是对的——没查证就信了,sFreq 全仓没有生产调用方,断言已删,不替换。)
  return `末月租金预计 ${wan(last.locked + last.renewalLo)}~${wan(last.locked + last.renewalHi)}`
}

/**
 * 参照系小字:口径 + 单位 + 续签统计(与 bandRefText/elecBandRef 同职责,不解释画法)。
 * F1(修复轮1):不再叫「回测样本」——这两个数从没度量过带准不准,是「过去 N 份到期合同里
 * k 份续签」,按真实身份标注。
 */
export function rentRollRefText(r: RentRoll): string {
  return `月度口径 · 万元 · 过去${r.renewalN}份到期中${r.renewalHits}份续签`
}
