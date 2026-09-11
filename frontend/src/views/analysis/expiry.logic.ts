// src/views/analysis/expiry.logic.ts — expiry 屏纯数据变换(v2 抽出,口径与 v1 一致,数值不变):
// 合同快照统计 / 金额 Pareto(TopN 柱 + 累计占比线)/ Top10 集中度环 — ECharts option 纯函数。
// 锚点(2026-07-08 dev 库):合同 282 份、月租合计 4,671,702.21、有租金 235、日期缺失 282、Top10 55.8%。
import { quantile } from '@/components/ana/anaFmt'
import { bandSeries } from '@/components/ana/anaTheme'
import type { ContractDTO } from '@/types/contract'
import { isInForce } from './TenantPeer.logic'

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
 *  · 「在租」判据是黑名单 NOT_COVERING_STATUS = {draft, expired, terminated},不是白名单
 *    {active, renewed}。**这条注释曾经写反过**:白名单版本的假设是「expiring 从未出现,
 *    真出现了也会被 active 这一支收进来」——后半句是错的,白名单会把 status='expiring' 的
 *    合同整个滤掉,不会落进 active 那一支。查 DB 原始列看不出这个问题(那一列确实只有
 *    active/renewed),因为 expiring/future 是后端 `ContractService.effectiveStatus` 在
 *    请求时按日期现算的展示态,只在**调 API 拿到的 ContractDTO**上才看得见。
 *    数错过一次(F1,修复轮1 对抗复查):最初写的是"做小了近 9%",那是拿整本账算的
 *    (378,356/4,311,044——分母混进大量不覆盖当月的合同,分子也数错,23 份 expiring 里
 *    只有 21 份真覆盖当月)。对**「当前合约租金」瓦实际求和的那批合同**(asOf=2026-09-11,
 *    coveringMonth 覆盖 2026-09 月末、非整租、已剔除整月免租,92 份 = 70 active + 1 renewed
 *    + 21 expiring)重算:白名单(active/renewed)¥1,969,962.68/月,黑名单(现用)
 *    ¥2,320,829.23/月,做小了 **15.1%**(相对黑名单;相对白名单是 17.8%)。
 *    断言钉在 expiry.logic.spec.ts「F1(修复轮1)」一节。收进 renewed 是因为它代表真实仍在租的续签合同
 *    (实测 9 份 renewed 的 endDate ≥ 今天,其中 1 份当月仍在收租)——
 *    漏掉它们会把「锁定」系统性做小,而这条线存在的意义就是「真正锁定了多少」。
 *  · 同一单元同月多于一份合同(实测 2 例):F6(修复轮2)拿掉了 dedupByUnit——单元 455 上是两个
 *    不同租户(265/165)并行跑了好几年的两条租约链,不是重复行;按单元去重会把其中一份月租 32
 *    万的合同整个丢掉(占月度锁定线约 15%)。coveringMonth 的月末覆盖判定本身已保证同一段
 *    租约只算一次,不必再去重——唯一依赖的前提("同一租户不会在同一单元上有两份合同同时
 *    覆盖同一个月末")由 coveringMonth 里的运行时守卫钉住,理由见该函数注释。
 *    ⚠ 那道守卫**只管走 coveringMonth 的两条线**(锁定线、整租线)。续签抽样池不走它,
 *    池子那边靠的是另一条判据:已有后继合同的不进池(F10,见 buildRentRoll 里的注释)。
 *    两者防的不是同一件事,别把它们当成一道。
 *  · 历史回测分母/命中不是写死的 18/90 —— 由 asOf 现算(下面 decided/renewalHits),18.5/72.5
 *    只是 asOf=2025-12-01 那一次现算的结果,换 asOf 会跟着变(全局约束①要求的锚点显式传入)。
 */

const MC_SEED = 20260910   // 固定种子(锚定稿基准日),任何人重跑都拿到逐字节相同的带
const MC_DRAWS = 10000
const MC_LO_Q = 0.10
const MC_MID_Q = 0.50   // T4/T5(design-boards):「预计」中线 —— 与 Lo/Hi 同一批抽样,同一个分位函数
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

/**
 * T4(design-boards,2026-09-11 对抗复查):不在租的三个「派生桶」终态,判"覆盖"时排除。
 * 判据从白名单(只认 active/renewed)改成黑名单——白名单当年漏了 `effectiveStatus` 会派生出的
 * 另外两桶:`expiring`(签的是 active,只是 endDate 在 90 天内)与 `future`(签的是 active,
 * startDate 还没到)。两者都不是"不在租",是"在租的两种展示态细分",之前被白名单误伤。
 * 数错过一次(F1,修复轮1 对抗复查):最初写的是"做小了近 9%",那是拿 389 份整本账的
 * expiring/future 计数(23 份¥37.8万/月、27 份¥76.6万/月)去除整本账的分母算出来的——
 * 分母里混进大量不覆盖当月的合同。对**「当前合约租金」瓦实际求和的那批合同**(asOf=
 * 2026-09-11,coveringMonth 覆盖 2026-09 月末、非整租、已剔除整月免租,92 份 = 70 active
 * + 1 renewed + 21 expiring)重算:白名单¥1,969,962.68/月,黑名单(现用)¥2,320,829.23/月,
 * 做小了 **15.1%**(相对黑名单;相对白名单是 17.8%)。断言钉在 expiry.logic.spec.ts
 * 「F1(修复轮1)」一节。黑名单只排除三个确定"不算在租"的终态,其余(含以后可能新增的展示态)
 * 一律按日期本身说了算——这正是 coveringMonth 下面几行本来就在做的事。
 */
const NOT_COVERING_STATUS = new Set(['draft', 'expired', 'terminated'])

function coveringMonth(cs: ContractDTO[], startKey: number, endKey: number, wantMaster: boolean): ContractDTO[] {
  const covering = cs.filter((c) => {
    if ((c.kind === 'master_lease') !== wantMaster) return false
    if (!wantMaster && NOT_COVERING_STATUS.has(c.status)) return false
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

/** 锁定合同份数(T4,design-boards):判据与 lockedRentByMonth 逐字相同,只换成计数——
 * 供「当前合约租金」瓦的「N 份在租」用,不另立一套覆盖口径。 */
export function lockedCountByMonth(cs: ContractDTO[], asOf: string, n: number): number[] {
  return [...Array(n)].map((_, i) => {
    const { startKey, endKey } = monthBounds(asOf, i)
    return coveringMonth(cs, startKey, endKey, false).length
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
  lockedCount: number    // 锁定合同份数(T4,design-boards:「N 份在租」瓦用)
  masterLease: number    // 整租合同月租(元,单列,不进 locked)
  renewalLo: number      // 续签贡献 10 分位(元,蒙特卡洛,不含 locked)
  renewalMid: number     // 续签贡献 50 分位(元,蒙特卡洛,不含 locked;T4/T5「预计」中线,与 Lo/Hi 同一批抽样)
  renewalHi: number      // 续签贡献 90 分位(元,蒙特卡洛,不含 locked)
}

export interface RentRollGap {
  monthsAway: number   // 锁定线最早出现下跌的月序(1-based,第 1 月 = asOf 的下一月)
  count: number         // 拉低当月锁定线的到期合同份数
  totalRentSum: number  // 这些合同的月租合计(元)
  names: string[]       // 按月租降序取前两个租户名(供「名字1+名字2 等N份」这类文案拼接)
}

/**
 * 最近的缺口(T4/T5,design-boards):锁定线里最早出现的月度下跌,连同拉低它的到期合同。
 * 判「到期」用 endDate 本身(< 当月月末),不用「覆盖集合的差集」——两者通常一致,但免租期
 * 满月退出(monthFullyRentFree)也会让合同暂时退出 coveringMonth,那不是「到期」,不该混进来。
 * 复用已经算好的 locked 数组(buildRentRoll 调用处传入),不重新拟合一次口径。
 *
 * F4(对抗复查):改前不管 dropped 里的合同有没有后继——4 份同月就有后继合同接上的租约(其中 2 份
 * 续签链就明明白白写在 parent_contract_id 上)被当成了「缺口」,「N 份到期」的份数与图上红 pin 标的
 * 跌幅(−12.3万)对不上锁定线实际的跌幅(−11.0万)。buildRentRoll 里续签抽样池早就用 hasSuccessor
 * 把"结果已经发生的合同"剔出去过(F10,同一条规则的镜像);这里复用同一个集合(调用处传入,
 * 不重算——同一个数不能算两次各出各的账),已有后继的合同不算「到期缺口」。
 */
export function nearestGap(cs: ContractDTO[], asOf: string, locked: number[], hasSuccessor: Set<number>): RentRollGap | null {
  for (let i = 1; i < locked.length; i++) {
    if (locked[i] >= locked[i - 1]) continue
    const prev = monthBounds(asOf, i - 1)
    const cur = monthBounds(asOf, i)
    const dropped = coveringMonth(cs, prev.startKey, prev.endKey, false)
      .filter((c) => (dateKeyOf(c.endDate) ?? Infinity) < cur.endKey)
      .filter((c) => !hasSuccessor.has(c.id))
      .sort((a, b) => b.monthlyRent - a.monthlyRent)
    if (!dropped.length) continue   // 下跌另有原因(如整月免租退出,或全部到期合同都已续签接上),不算「到期缺口」
    return {
      monthsAway: i,
      count: dropped.length,
      totalRentSum: dropped.reduce((s, c) => s + c.monthlyRent, 0),
      names: dropped.slice(0, 2).map((c) => c.tenantName),
    }
  }
  return null
}

export interface RentPriorityRow {
  id: number; contractNo: string; tenantName: string
  endDate: string; monthlyRent: number
  monthsLeft: number   // 与 byExpMonth 同一个下标(0=到期落在 asOf 当月的桶),不是 RentRollGap.monthsAway 那个 1-based 序号
}

export interface RentRoll {
  months: RentRollMonth[]
  locked: number[]           // = months.map(m => m.locked)
  lockedBand?: undefined     // 锁定线零随机量,不许套带(❗spec 断言这个键必须是 undefined)
  renewalN: number           // 历史回测分母:asOf 之前已到期、结果已知的合同数
  renewalHits: number        // 其中续签的数量
  renewalP: number           // hits/n(经验续签率;n=0 时给 0,不除以零)
  expiringCount: number      // T4:视界内(byExpMonth 实际分到桶里)的到期合同份数,与续签抽样同一份数据
  expiringRentSum: number    // 上面这批合同的月租合计(元)
  expiringList: RentPriorityRow[]   // T6:与 expiringCount/expiringRentSum 同一份 pool/桶,按月租金降序 —— 供「先谈哪几户」卡用,不另起一套过滤
  gap: RentRollGap | null    // T4/T5:最近的到期缺口,KPI 瓦与图上标注共用同一个值
}

/**
 * 合约租金带:锁定线(buildRentRoll.locked,实线)+ 续签区间(蒙特卡洛 10~90 分位)。
 * asOf 必须显式传入(全局约束①),n=预测月数。
 */
export function buildRentRoll(cs: ContractDTO[], asOf: string, n: number): RentRoll {
  const months = [...Array(n)].map((_, i) => monthBounds(asOf, i))
  const locked = lockedRentByMonth(cs, asOf, n)
  const lockedCount = lockedCountByMonth(cs, asOf, n)
  const masterLease = masterLeaseByMonth(cs, asOf, n)
  const asOfKey = dateKeyOf(asOf)!

  // 历史回测:asOf 之前已到期、结果已知的**租约**(不是合同行)。草稿从未真正在租,不算"已知结果"。
  //
  // C1(对抗复查,2026-09-11):`parentContractId` 不等于「续签了」。它是两件事共用的链指针,
  // 分辨这两件事的字段是 `linkType`,而这个判断本仓早就写下来了 ——
  // `CONTRACT-ESCALATION-SPLIT-SPEC §1`:链的形状是「档1(new) ← 档2(escalation) ← … ←
  // 末档(escalation) ← 续签子期(renew)」,合同屏 `ContractsView.vue:193` 据此给递增段单发一个
  // 「递增」徽标,注释原话是「递增段≠续签换约」。分析屏原来把两者合成一件事:
  //
  //   实测 park_demo3(2026-09-11,SQL 见 task-8-report.md):全库 link_type 分布
  //   new 338 / escalation 79 / renew 14;锚点 2025-12-01 原口径 27 次「命中」里,
  //   后继是 escalation 的 24 次、是 renew 的只有 3 次 —— 印在屏上的续签率大了近七倍。
  //
  // 改后的两条判据(分子分母同时改,只改一头会拿一个错数换另一个错数):
  //
  //  ① 分母折到**租约末档**:有 escalation 后继的那份是同一份租约的上一个价格档,它的 endDate
  //     是换档日不是到期日,不该在分母里各算一次。实测锚点 2025-12-01:106 份合同行里 24 份是
  //     中间价格档,折完剩 82 份租约。
  //  ② 分子只认 `linkType === 'renew'` 的后继。`status === 'renewed'` 这一支**删掉** ——
  //     拆链脚本的原话是「中间档 status='renewed',末档保持原状态」,也就是说这个状态字段编码的是
  //     「被下一期取代」,取代它的既可能是续签也可能是下一个价格档。实测:全库 45 条 renewed 全部有
  //     后继(其中 39 条后继是递增段),没有一条是「标了 renewed 却没有后继」;折链之后的 82 份租约里
  //     3 份是 renewed,这 3 份的后继全是 renew —— 留着这一支今天不多算一条,但它随时会把下一批
  //     递增段放进来,是个定时炸弹,不是保险带。
  //     linkType 缺失(库里 NOT NULL DEFAULT 'new',只有老 fixture 会缺)按「不是续签」处理:
  //     这条带上沿高了才骗人,宁可保守。
  //
  //  锚点 2025-12-01 改后:3/82 = 3.7%(原 27/106 = 25.5%)。蒙特卡洛的 Beta(3.5, 79.5) 均值 0.042。
  //
  // decided 从来不按**单元**去重 —— 横跨 asOf 之前的全部历史,同一单元先后好几段真实租约
  // (各自到期、各自有续签结果)是常态,不是重复数据。按单元去重会把多段历史强行合并成一段,
  // 悄悄吃掉真实存在的历史续签结果。折价格档与按单元去重是两回事:前者折的是同一份租约被拆开的
  // 几个价格档,后者会把同一单元上先后两份不同租约也一起吃掉。
  //
  // F2(修复轮1):计划锚点「2025-12-01 续签率 18/90」查了 9 种口径都复现不出来,不为了凑那个数
  // 改口径;判定规则由 expiry.logic.spec.ts 里不依赖数据库的 fixture 钉死,以后被人改动会当场红。
  const succBy = (t: 'renew' | 'escalation') => new Set(
    cs.filter((c) => c.linkType === t && c.parentContractId != null).map((c) => c.parentContractId))
  const midTier = succBy('escalation')   // 有递增后继 = 自己只是链中间的一个价格档
  const renewedInto = succBy('renew')    // 有续签后继 = 真的换约续租了
  const decided = cs.filter((c) =>
    c.kind !== 'master_lease' && c.status !== 'draft' &&
    (dateKeyOf(c.endDate) ?? Infinity) < asOfKey && !midTier.has(c.id))
  const renewalHits = decided.filter((c) => renewedInto.has(c.id)).length
  const renewalN = decided.length
  const renewalP = renewalN > 0 ? renewalHits / renewalN : 0

  // 续签抽样总体:asOf 当天仍在租(未到期)、到期日落在预测视界内的合同。
  // 全程覆盖到视界末尾的合同没有续签不确定性(locked 已经算全了),不进池。
  // F6(修复轮2):不再按单元去重——理由同 lockedRentByMonth:一个单元上可以合法地同时住着
  // 两个不同租户,把它们当重复行砍掉会让续签抽样池丢真实合同。
  //
  // F10(修复轮3):已有后继合同的那份**排除出池**。池子问的是「这份合同会不会续签」,
  // 而一份已被 parentContractId 指向的合同,续签结果已经发生了——后继合同就是那个结果。
  // 留着它等于把一个已知答案当成还没掷的骰子,既多算一份不确定性,又在交接重叠期
  // (实测单元 418 的 296→424,重叠 10 天)把同一段租约放进池子两次、当成两次独立的伯努利。
  // 这也是 coveringMonth 那道守卫覆盖不到的地方——池子不走月末覆盖判定,
  // 而这里用「有没有后继」判,比按单元/租户去重更贴语义:它问的是结果知不知道,不是行重不重复。
  const hasSuccessor = new Set(
    cs.map((c) => c.parentContractId).filter((v): v is number => v != null))
  // T4:同一个黑名单(NOT_COVERING_STATUS),理由同 coveringMonth——旧白名单漏掉的 23 份
  // expiring 合同恰恰是离到期最近、最该被建模"续不续得上"的那批,漏进池子外等于假装它们没有不确定性。
  const pool = cs.filter((c) =>
    c.kind !== 'master_lease' && !NOT_COVERING_STATUS.has(c.status) &&
    (dateKeyOf(c.endDate) ?? -Infinity) >= asOfKey && !hasSuccessor.has(c.id))
  // F8(修复轮2):endDate 恰好等于视界最后一个月月末时,严格小于(ek < mb.endKey)在最后一个
  // 月也不成立,findIndex 全程落空、该合同不进任何桶——这不是漏算。ek 等于最后一月的 endKey
  // 时,coveringMonth 对每个月都判它"覆盖到月末"(含最后一月),即它在整个视界内都是 locked,
  // 真正的续签不确定性落在视界之外的下一个月,本来就不该有桶。这与"全程覆盖到视界末尾的合同
  // 不进池"是同一条规则的边界情形,不是新问题;钉在 expiry.logic.spec.ts 的 F8 用例里。
  const byExpMonth: number[][] = [...Array(n)].map(() => [])
  // T6(design-boards):expiringList 与 byExpMonth 同一次遍历产出,同一个 idx —— 「先谈哪几户」卡
  // 与「未来12月到期」瓦(expiringCount/expiringRentSum)必须是同一份合同,不能各自过滤一遍再对不上账。
  const expiringList: RentPriorityRow[] = []
  for (const c of pool) {
    const ek = dateKeyOf(c.endDate)
    if (ek == null) continue
    const idx = months.findIndex((mb) => ek < mb.endKey)   // 首个"不再算 locked"的月
    if (idx >= 0) {
      byExpMonth[idx].push(c.monthlyRent)
      expiringList.push({ id: c.id, contractNo: c.contractNo, tenantName: c.tenantName, endDate: c.endDate!, monthlyRent: c.monthlyRent, monthsLeft: idx })
    }
  }
  expiringList.sort((a, b) => b.monthlyRent - a.monthlyRent)

  const a = renewalHits + 0.5, b = renewalN - renewalHits + 0.5   // Jeffreys 后验
  const drawSums = simulateRenewalDraws(byExpMonth, a, b, MC_DRAWS, MC_SEED)
  const quantileOf = (arr: number[], q: number): number => {
    const s = [...arr].sort((x, y) => x - y)
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]
  }
  const renewalLo = drawSums.map((s) => quantileOf(s, MC_LO_Q))
  const renewalMid = drawSums.map((s) => quantileOf(s, MC_MID_Q))
  const renewalHi = drawSums.map((s) => quantileOf(s, MC_HI_Q))

  // T4(design-boards):「未来 N 月到期」瓦读的是喂给蒙特卡洛的同一批合同(byExpMonth),
  // 不是 pool 本身——pool 里覆盖到视界末尾之外的长租约不进任何一个桶,不该算进"到期"份数。
  const expiringCount = byExpMonth.reduce((s, arr) => s + arr.length, 0)
  const expiringRentSum = byExpMonth.reduce((s, arr) => s + arr.reduce((s2, v) => s2 + v, 0), 0)

  return {
    months: months.map((mb, i) => ({
      month: mb.label, locked: locked[i], lockedCount: lockedCount[i], masterLease: masterLease[i],
      renewalLo: renewalLo[i], renewalMid: renewalMid[i], renewalHi: renewalHi[i],
    })),
    locked,
    lockedBand: undefined,
    renewalN, renewalHits, renewalP,
    expiringCount, expiringRentSum, expiringList,
    gap: nearestGap(cs, asOf, locked, hasSuccessor),
  }
}

/**
 * 合约租金带 option:锁定线(实线)+ 续签区间带(locked+renewalLo ~ locked+renewalHi)。
 *
 * N4(修复轮2):这条带**不受宽度门管**(C2 已把那道门整个删掉,理由见 anaTheme.ts 墓志铭)。
 * 那道门原本判「半宽/中位 > 0.20 → 太宽只出点」,是给 P25~P75 这类"画宽了大概率是画法或
 * 样本问题"的带用的。这条带的宽是内容本身 —— 85 份到期在金额上等效约 15 份等额赌注,
 * 续签是非黑即白的个体事件,宽本来就对,套上这种门会把这张卡存在的理由
 * (诚实地告诉你续签不确定性有多大)本身给隐藏掉。
 */
export function rentRollOption(r: RentRoll): object {
  const months = r.months.map((m) => m.month)
  const lockedWan = r.months.map((m) => +(m.locked / 10000).toFixed(2))
  const loWan = r.months.map((m) => +((m.locked + m.renewalLo) / 10000).toFixed(2))
  const midWan = r.months.map((m) => +((m.locked + m.renewalMid) / 10000).toFixed(2))
  const hiWan = r.months.map((m) => +((m.locked + m.renewalHi) / 10000).toFixed(2))
  // T5(design-boards):「已实现」= 预测起点(第 0 月,今天)这一个点,已经是事实不是模拟;
  // 「已锁定」= 同一条锁定线往后延伸的部分。两段本是同一个数组,只按第 0 月拆成两个图例,
  // 不另算一次口径——这样才不会出现两条线在起点对不上的缺陷。
  const realizedWan = lockedWan.map((v, i) => (i === 0 ? v : null))
  const gap = r.gap
  const gapNames = gap ? gap.names.join('+') + (gap.count > gap.names.length ? ` 等${gap.count}份` : '') : ''
  const gapWan = gap ? +(gap.totalRentSum / 10000).toFixed(1) : 0
  return {
    grid: { left: 48, right: 16, top: 30, bottom: 30 },
    tooltip: { trigger: 'axis' },
    // F4(修复轮1):图例顺序照稿——已实现/预计/80%区间/已锁定,原实现把已锁定错排在第二位。
    legend: { top: 0, data: ['已实现', '预计', '80%区间', '已锁定'] },
    xAxis: { type: 'category', data: months, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', name: '万/月', axisLabel: { formatter: (v: number) => String(v) } },
    series: [
      {
        name: '已锁定', type: 'line', step: 'end', symbol: 'none', lineStyle: { width: 2, color: '#378ADD' }, data: lockedWan,
        // 预测起点竖线:钉在第 0 月,标当天的锁定值——不用系统时钟,值就是数组第一项。
        markLine: {
          silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: '#9CA3AF' },
          label: { formatter: `预测起点\n${lockedWan[0] ?? 0}`, fontSize: 10, color: '#6B7280' },
          data: [{ xAxis: 0 }],
        },
        // 缺口标注:最近一次到期扎堆造成的锁定线下跌,连同拉低它的合同名字(与「最近的缺口」瓦同一份 gap)。
        markPoint: gap ? {
          symbol: 'pin', symbolSize: 36, itemStyle: { color: '#E24B4A' },
          label: { fontSize: 10, color: '#fff', formatter: `−${gapWan}万\n${gapNames}` },
          data: [{ coord: [gap.monthsAway, lockedWan[gap.monthsAway]] }],
        } : undefined,
      },
      // scatter(不是 line):只有第 0 月一个值,没有第二个点可连,天然不画线,不必再手写隐藏线样式。
      { name: '已实现', type: 'scatter', symbolSize: 7, itemStyle: { color: '#1C1C1C' }, data: realizedWan },
      { name: '预计', type: 'line', symbol: 'none', lineStyle: { width: 1.5, type: 'dashed', color: '#185FA5' }, data: midWan },
      ...bandSeries(loWan, hiWan, { name: '80%区间', color: 'rgba(55,138,221,.14)' }),
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

/* ---------- T6(design-boards):先谈哪几户 —— 既有「临期90天」卡改造,不新增卡 ----------
 * 原卡按 endDate 升序、90 天窗口(buildExpiringSoon)。稿上「前8份占2026到期租金的58%·
 * 其余77份合计92.2万」总数 8+77=85,与「2026 到期 85 份」KPI 同一个数 —— population 从
 * 90 天窗口换成 rentRoll.expiringList(未来 12 月、与续签抽样同一批),按月租金降序。
 * buildExpiringSoon 因此不再被本屏调用,连同 ExpiringSoonRow 一并删除(不留孤儿导出)。
 */
const PRIORITY_TOP_K = 8

/** 前 K 份(按月租金降序)占 rentRoll.expiringRentSum 的份额。 */
export function priorityReadout(list: RentPriorityRow[], totalRentSum: number, topK = PRIORITY_TOP_K): string | null {
  if (!list.length || totalRentSum <= 0) return null
  const top = list.slice(0, topK)
  const topSum = top.reduce((s, r) => s + r.monthlyRent, 0)
  const pct = Math.round((topSum / totalRentSum) * 100)
  return `前${top.length}份占未来12月到期租金的${pct}%`
}

/** 其余份数与合计(万) —— 与 priorityReadout 同一个 topK,两句必须对得上账。 */
export function priorityRefText(list: RentPriorityRow[], totalRentSum: number, topK = PRIORITY_TOP_K): string {
  const top = list.slice(0, topK)
  const topSum = top.reduce((s, r) => s + r.monthlyRent, 0)
  const restCount = list.length - top.length
  const restSum = totalRentSum - topSum
  return `其余${restCount}份合计${(restSum / 10000).toFixed(1)}万`
}

/* ---------- T7(design-boards):续签率从哪来 / 续签率变一档 ---------- */

/**
 * 续签率本身的后验抽样 —— 只抽 p,不抽「哪几户续签」。
 * 与 simulateRenewalDraws 分开路径(踩坑提示,写在这):那个函数每轮从 Beta(a,b) 抽一个 p
 * 之后紧接着对每户各抽一次 Bernoulli(p),返回的是金额和,从里面倒推不出 p 自己的分布。
 * 「续签率从哪来」卡要的是 p 本身有多不确定,不是金额的宽窄,所以另起一个只抽 p 的函数,
 * 不去改 simulateRenewalDraws,也不通过给它一个收紧的先验来"模拟"定值(那样抽出来的还是
 * 一个分布,只是窄了,答的仍是错的问题)。
 */
export function simulateRenewalRate(hits: number, n: number, draws: number, seed: number): number[] {
  const a = hits + 0.5, b = n - hits + 0.5   // Jeffreys 后验,与 buildRentRoll 里的写法一致
  const rng = mulberry32(seed)
  return [...Array(draws)].map(() => sampleBeta(a, b, rng))
}

/** 续签率本身 10~90 分位(不是金额区间,是比例这个数自己的不确定性)。 */
export function renewalRateBand(hits: number, n: number, draws = MC_DRAWS, seed = MC_SEED): { lo: number; hi: number } {
  const ps = simulateRenewalRate(hits, n, draws, seed)
  return { lo: quantile(ps, MC_LO_Q), hi: quantile(ps, MC_HI_Q) }
}

/** 卡片读数句(同 rentRollSentence 的 D1 可执行形式):n=0 时闭嘴,不硬造一个区间。 */
export function renewalRateReadout(hits: number, n: number, draws = MC_DRAWS, seed = MC_SEED): string | null {
  if (n <= 0) return null
  const { lo, hi } = renewalRateBand(hits, n, draws, seed)
  return `续签率本身80%落在${Math.round(lo * 100)}%~${Math.round(hi * 100)}%`
}

export interface SensitivityRow {
  ratePct: number    // 续签率,整数百分比
  tag: string         // '全不续' | '历史' | ''
  finalRentWan: number  // 该档下视界最后一月的月租(万)
  deltaPct: number      // 相对「当前合约租金」(今天)的百分比变化,整数,可正可负
  verdict: string        // 够不够的判定文案
}

/**
 * 固定续签率下,视界最后一月的租金 —— 这是「trap」要避开的那条:不做蒙特卡洛。
 * 一旦续签率是指定值(不是从后验抽的),「哪几户续签」这层随机性对总额求期望就是线性的
 * (Σ独立伯努利·租金 的期望 = 续签率 × Σ租金),不需要抽样去逼近一个本来就有闭式解的数。
 * 抽样反而会引入不必要的随机噪声,让四档之间的差异掺进抽样误差。
 */
export function sensitivityFinalRent(lockedLast: number, expiringRentSum: number, rate: number): number {
  return lockedLast + rate * expiringRentSum
}

/** 够不够的判定:相对今天的百分比变化分四档,边界见 sensitivityRows.spec 逐条断言。 */
function sensitivityVerdict(deltaPct: number): string {
  if (deltaPct < -20) return '低于盈亏平衡'
  if (deltaPct < -5) return '勉强打平'
  if (deltaPct < 5) return '持平'
  return '有余量'
}

/** 四档续签率(0/历史/40%/60%)一张表 —— historicalP 传 rentRoll.renewalP。 */
export function sensitivityRows(lockedLast: number, expiringRentSum: number, todayRent: number, historicalP: number): SensitivityRow[] {
  const scenarios: [number, string][] = [[0, '全不续'], [historicalP, '历史'], [0.4, ''], [0.6, '']]
  return scenarios.map(([rate, tag]) => {
    const finalRent = sensitivityFinalRent(lockedLast, expiringRentSum, rate)
    const deltaPct = todayRent > 0 ? Math.round(((finalRent - todayRent) / todayRent) * 100) : 0
    return { ratePct: Math.round(rate * 100), tag, finalRentWan: +(finalRent / 10000).toFixed(1), deltaPct, verdict: sensitivityVerdict(deltaPct) }
  })
}

/** 四档里(按续签率从低到高)第一个「持平」或「有余量」——「守得住今天的租金」要的最低续签率档。 */
export function neededRatePct(rows: SensitivityRow[]): number | null {
  const sorted = [...rows].sort((a, b) => a.ratePct - b.ratePct)
  const hit = sorted.find((r) => r.verdict === '持平' || r.verdict === '有余量')
  return hit ? hit.ratePct : null
}

/**
 * T7(design-boards,真实数据核对后改):四档一档都不够的情况不是"没数据"—— 实测当前库
 * (asOf=2026-09-11)恰好落在这一支:60% 都还差着,不该跟着 rows 为空那种情况一样闭嘴,
 * 那样整张卡连同它的口径浮层会一起消失,读者反而看不到最需要看到的那句结论。
 */
export function sensitivitySentence(rows: SensitivityRow[]): string | null {
  if (!rows.length) return null
  const need = neededRatePct(rows)
  return need == null ? `${rows.length}档都守不住今天的租金` : `续签率要到${need}%才守得住今天的租金`
}

/* ---------- F1(修复轮1,design-boards):板上收尾行 ----------
 * board-expiry.txt 最后一行「历史 20% · 缺口 44 万/月,约等于 15 户中型厂房」——原实现整句没做
 * (grep「缺口」「中型厂房」零命中,报告未做清单里也没提)。它算得出来:缺口 = 今天的月租
 * (todayRent,即 rentRoll.months[0].locked)− 按历史续签率(rows 里 tag==='历史' 那档)推出的
 * 末月月租,直接读 rows 已经算好的 finalRentWan,不重算 sensitivityFinalRent(同一个数不能算两次
 * 各出各的账)。
 *
 * 「中型厂房」口径查库定,不是拍脑袋。但 F3(对抗复查)坐实:改前那条 SQL 的「在租」判据读的是
 * c.status 原始列(`status IN ('active','expiring')`)——本仓早写死规矩(ContractService.java:97,
 * TenantPeer.logic.ts isInForce 同一口径镜像了后端 inForceOn):status 列只存人工态,合同到期后
 * 它不会自动改成 expired,「在租/将到期」一律要按日期区间派生,不该在候选查询里就先按 status
 * 筛一道(旧实现连候选集合本身都用 status IN ('active','expiring') 圈的,这道预筛同样会漏——
 * 库里有 1 份纯厂房类合同 status='renewed' 但日期区间明明还覆盖今天,旧候选集合直接把它排除在外,
 * 分母从一开始就不完整)。改法:候选查询只排除 status='draft'(与 isInForce 自己的排除条件一致),
 * 「在租」与否完全交给 medianFactoryRent() 用 isInForce 按日期现判。
 *
 * 实测(park_demo3,2026-09-11):候选(纯厂房类,status<>'draft'、kind='normal')129 份,按
 * isInForce 过滤后 54 份真在租,中位数 ¥11,448.50。改前那条按 status IN ('active','expiring')
 * 预筛的候选只有 103 份(漏了 1 份 status='renewed' 但仍在租的),就算重新套 isInForce 也只筛得出
 * 53 份——53 vs 54 这一份差额正是"候选阶段就不该用 status 筛"的证据,不是巧合(诚实记录:本轮
 * 开发时先犯过这个错,53 份中位数会落在 ¥11,808,靠上面这条"候选与在租两处 status 都别用"的判据
 * 才抓出来,断言 fixture 里也把这个真实的反例钉了一条,见 expiry.logic.spec.ts)。
 *   SELECT c.id, c.monthly_rent, c.start_date, c.end_date, c.status FROM contract c
 *     JOIN contract_billing_term t ON t.contract_id=c.id
 *     WHERE c.status<>'draft' AND c.kind='normal'
 *     GROUP BY c.id, c.monthly_rent, c.start_date, c.end_date, c.status
 *     HAVING SUM(t.property_type<>'factory')=0 AND SUM(t.property_type='factory')>0 ORDER BY c.id;
 * 这批候选会随合同新签/到期漂移,不是常量;expiry.logic.spec.ts 里有断言把 MEDIAN_FACTORY_RENT
 * 的值钉死,谁改动 FACTORY_RENT_CANDIDATES 或 MEDIAN_FACTORY_RENT_ASOF 不同步改断言就会被看见。
 *
 * gap 四舍五入到「万」之后若 ≤0(续签率已经够,或差额小到不足 0.5 万),说一句「已经守住」,
 * 不说「缺口 0 万」或「缺口 −44 万」这种读不通的话。
 */
type FactoryRentCandidate = readonly [rent: number, startDate: string, endDate: string]
// 候选:纯厂房类合同(billing_term 全部行 property_type='factory'),status<>'draft'、kind='normal'
// (park_demo3 实测,2026-09-11,129 份——SQL 见上方注释)。候选阶段不按 status 再细分(不管
// 'active' 还是 'renewed'),「在租」全部交给下面 medianFactoryRent() 用 isInForce(日期区间)现判。
const FACTORY_RENT_CANDIDATES: readonly FactoryRentCandidate[] = [
  [31453.00, '2023-07-14', '2026-07-13'], [29172.50, '2023-11-01', '2029-08-06'], [2020.03, '2023-10-17', '2026-10-16'],
  [21597.00, '2022-12-01', '2025-11-30'], [43004.00, '2025-12-01', '2028-11-30'], [38952.30, '2022-12-22', '2025-12-21'],
  [26720.64, '2026-03-03', '2029-03-02'], [32270.00, '2023-03-01', '2026-02-28'], [22863.60, '2026-05-23', '2028-05-22'],
  [27017.31, '2023-07-17', '2029-07-16'], [1224.25, '2023-11-24', '2025-11-23'], [2160.06, '2023-07-20', '2024-07-19'],
  [5064.40, '2023-11-01', '2026-07-18'], [56316.58, '2023-08-21', '2025-08-20'], [4529.25, '2026-09-11', '2029-09-10'],
  [13744.50, '2023-09-15', '2026-09-14'], [13744.50, '2023-09-19', '2026-09-18'], [19923.75, '2029-10-15', '2032-10-14'],
  [11808.00, '2023-10-10', '2026-10-09'], [1015.79, '2024-01-01', '2025-12-31'], [120631.04, '2030-01-01', '2032-12-31'],
  [73807.00, '2029-10-12', '2032-10-11'], [1699.03, '2025-12-01', '2028-11-30'], [2944.16, '2023-03-01', '2026-02-28'],
  [7319.60, '2026-09-01', '2029-08-31'], [3977.80, '2026-09-01', '2029-08-31'], [3968.00, '2023-09-01', '2026-08-31'],
  [3331.43, '2023-10-01', '2024-09-30'], [2840.28, '2023-10-10', '2026-10-09'], [3689.00, '2026-09-01', '2029-08-31'],
  [3772.00, '2023-08-25', '2026-08-24'], [1719.40, '2026-04-25', '2028-04-24'], [1619.92, '2023-08-01', '2025-07-31'],
  [14910.92, '2023-08-01', '2026-07-31'], [9688.50, '2023-07-25', '2026-07-24'], [5851.80, '2023-09-10', '2024-09-09'],
  [3819.28, '2024-01-10', '2025-01-09'], [11852.24, '2027-01-01', '2028-12-31'], [2854.00, '2026-05-25', '2029-05-24'],
  [1532.96, '2023-07-15', '2024-07-14'], [6457.61, '2029-10-01', '2032-09-30'], [6457.61, '2029-10-01', '2032-09-30'],
  [4177.96, '2023-12-16', '2026-12-15'], [10987.00, '2024-01-01', '2026-12-31'], [5689.12, '2027-01-01', '2028-12-31'],
  [20075.48, '2023-10-01', '2026-09-30'], [7738.80, '2023-10-01', '2026-09-30'], [3869.90, '2023-11-25', '2026-11-24'],
  [5107.00, '2023-11-15', '2026-11-14'], [2247.61, '2029-11-15', '2032-11-14'], [361444.45, '2023-01-01', '2025-12-31'],
  [101626.13, '2028-10-10', '2031-10-09'], [31458.00, '2022-09-15', '2025-09-14'], [27169.48, '2028-10-19', '2031-10-18'],
  [25083.71, '2025-11-03', '2028-11-02'], [61336.00, '2022-11-04', '2025-11-03'], [162853.44, '2022-09-16', '2031-09-15'],
  [15129.38, '2022-12-26', '2031-12-25'], [24999.84, '2023-01-01', '2028-07-23'], [21214.70, '2025-12-10', '2028-12-09'],
  [12100.00, '2026-08-23', '2029-08-22'], [5920.06, '2026-07-10', '2029-07-09'], [8990.30, '2026-07-04', '2028-07-03'],
  [67320.00, '2026-10-30', '2029-10-29'], [12503.04, '2023-05-17', '2026-05-16'], [1024.70, '2023-01-01', '2024-02-29'],
  [30700.66, '2028-12-26', '2031-12-25'], [38264.68, '2026-03-16', '2029-03-15'], [2988.00, '2023-12-01', '2026-11-30'],
  [23581.76, '2025-12-01', '2028-11-30'], [13749.99, '2026-05-17', '2029-05-16'], [9782.88, '2026-07-25', '2028-07-24'],
  [3665.23, '2026-09-01', '2029-08-31'], [19970.81, '2026-10-01', '2029-09-30'], [7988.15, '2026-10-01', '2029-09-30'],
  [3994.02, '2026-11-25', '2029-11-24'], [4743.12, '2026-11-15', '2029-11-14'], [3223.20, '2026-12-01', '2028-11-30'],
  [11211.12, '2027-01-01', '2028-12-31'], [39109.00, '2022-12-01', '2025-11-30'], [24320.40, '2023-03-03', '2026-03-02'],
  [20814.00, '2023-05-23', '2026-05-22'], [4117.50, '2023-09-11', '2026-09-10'], [15750.00, '2023-10-15', '2026-10-14'],
  [17325.00, '2026-10-15', '2029-10-14'], [104896.00, '2027-01-01', '2029-12-31'], [95360.00, '2024-01-01', '2026-12-31'],
  [58543.00, '2023-10-12', '2026-10-11'], [64303.00, '2026-10-12', '2029-10-11'], [1559.03, '2022-12-01', '2025-11-30'],
  [6712.00, '2023-09-01', '2026-08-31'], [3674.00, '2023-09-01', '2026-08-31'], [3395.00, '2023-09-01', '2026-08-31'],
  [1592.00, '2023-04-25', '2026-04-24'], [10864.40, '2024-01-01', '2026-12-31'], [2609.00, '2023-05-25', '2026-05-24'],
  [5250.00, '2023-10-01', '2026-09-30'], [5705.70, '2026-10-01', '2029-09-30'], [5250.00, '2023-10-01', '2026-09-30'],
  [5705.70, '2026-10-01', '2029-09-30'], [5244.20, '2024-01-01', '2026-12-31'], [1910.00, '2023-11-15', '2026-11-14'],
  [2037.40, '2026-11-15', '2029-11-14'], [90009.26, '2025-10-10', '2028-10-09'], [81886.40, '2022-10-10', '2025-10-09'],
  [21574.00, '2022-10-19', '2025-10-18'], [23685.50, '2025-10-19', '2028-10-18'], [22845.00, '2022-11-03', '2025-11-02'],
  [19315.00, '2022-12-10', '2025-12-09'], [11000.00, '2023-08-23', '2026-08-22'], [5381.97, '2023-07-10', '2026-07-09'],
  [8173.00, '2023-07-04', '2026-07-03'], [61200.00, '2023-10-30', '2026-10-29'], [24344.50, '2022-12-26', '2025-12-25'],
  [26743.05, '2025-12-26', '2028-12-25'], [31662.75, '2020-03-16', '2023-03-15'], [34806.53, '2023-03-16', '2026-03-15'],
  [4595.84, '2021-07-10', '2027-07-09'], [10109.00, '2023-06-13', '2026-06-12'], [11089.00, '2026-06-13', '2029-06-12'],
  [2020.03, '2023-07-01', '2025-06-30'], [35712.50, '2024-01-15', '2027-01-14'], [4199.15, '2022-12-01', '2025-11-30'],
  [588.00, '2022-12-01', '2025-11-30'], [1256.60, '2023-04-10', '2024-04-09'], [3674.00, '2023-09-20', '2029-09-19'],
  [16322.51, '2026-08-01', '2029-07-31'], [17875.26, '2029-08-01', '2032-07-31'], [2840.28, '2023-01-01', '2023-09-30'],
]
export const MEDIAN_FACTORY_RENT_ASOF = '2026-09-11'   // 与上面 SQL 同一次实测的日期锚点(全局约束①:显式传入)

/**
 * 纯厂房类「在租」合同 monthly_rent 中位数(F3,对抗复查)。「在租」复用 isInForce
 * (TenantPeer.logic.ts,镜像后端 ContractService.inForceOn 的日期区间口径)——候选查询只排除
 * status='draft',与 isInForce 自己的排除条件一致(不在候选阶段就先按 active/expiring 圈一遍,
 * 那正是旧实现漏掉 1 份 renewed-但-仍在租合同的原因)。
 */
export function medianFactoryRent(candidates: readonly FactoryRentCandidate[], asOf: string): number | null {
  const inForce = candidates.filter(([, startDate, endDate]) =>
    isInForce({ status: 'active', kind: 'normal', startDate, endDate }, asOf))
  return inForce.length ? quantile(inForce.map(([rent]) => rent), 0.5) : null
}

export const MEDIAN_FACTORY_RENT = medianFactoryRent(FACTORY_RENT_CANDIDATES, MEDIAN_FACTORY_RENT_ASOF)!   // 元/月;54/129 份真在租,¥11,448.50

export function sensitivityGapSentence(rows: SensitivityRow[], todayRent: number, medianFactoryRent = MEDIAN_FACTORY_RENT): string | null {
  const hist = rows.find((r) => r.tag === '历史')
  if (!hist || todayRent <= 0) return null
  const gap = todayRent - hist.finalRentWan * 10000
  const gapWan = Math.round(gap / 10000)
  if (gapWan <= 0) return `历史${hist.ratePct}% · 已经守住今天的租金,没有缺口`
  const units = Math.max(1, Math.round(gap / medianFactoryRent))
  return `历史${hist.ratePct}% · 缺口${gapWan}万/月,约等于${units}户中型厂房`
}
