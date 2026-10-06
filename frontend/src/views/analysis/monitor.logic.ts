// src/views/analysis/monitor.logic.ts — 异常提醒中心纯函数(spec §二.2;单测 monitor.logic.spec.ts)。
// 风险分沿 churn 活跃度模型的三个因子:收缴恶化40% + 营收变动30% + 能耗变动30%,高分=差。
// 2026-10-05 改稿(用户按推荐定 av2-ask 2 选 C):缺项不再按其余项归一放大 —— 没数的项记 0,
// 原来「只有一项、这一项满分」也是 100 分(100 分的 54 户里 40 户只是销售收入表没有这户)。
// 能耗环比(av2-ask 4):只比相邻自然月,前一个月没数就不比(原来比「前一个有数的月」,跨 3–4 个月也算)。
// 2026-10-05 第二轮(用户「按你推荐改」):销售收入表停在最近月之前的户,收入降幅、电费涨跌也算没数(记 0,原来顶格 100 ——
// 第一轮高风险 52 户里 45 户一分没欠、只因停了就 60 分);清单不再按档分组,整张按末期未收从多到少排(这屏回答「先处理谁、多少钱」),
// 行上给高风险 / 观察两档挂小标签,屏顶两张瓦的户数在清单里找得到。
// 阈值走 anaSettings(收缴目标 collectTarget / 突变阈值 spikeTh / 风险线 churnTh)。
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import { isS10AggregateRow, type AnaAnomaly, type EnergySeries } from '@/analysis/anaData'
import { quantile } from '@/components/ana/anaFmt'
import { nextYm } from '@/components/ana/anaSentence'

const clamp100 = (v: number): number => Math.max(0, Math.min(100, Math.round(v)))
/** 末期未收取整到元:清单排序、行上金额、行内「收了 x%」都按它(不足 ¥1 当 0) */
export const owedYuan = (t: { arrears: number }): number => Math.round(t.arrears)
const fInt = (v: number): string => Math.round(v).toLocaleString('en-US')
export const W = { pay: 0.4, rev: 0.3, energy: 0.3 }   // 清单卡参照「未收比例4成…」从这里出
const ymOf = (r: AnalysisLedgerRow): string => r.year + '-' + String(r.month).padStart(2, '0')

export interface MonitorSpike { series: 'elec' | 'water'; idx: number; chg: number }
export interface MonitorRule { id: string; sev: 'risk' | 'watch'; type: string; detail: string; ym: string }
export type MonitorTier = 'risk' | 'watch' | 'normal'
export interface MonitorTenant {
  name: string
  company: string                  // 台账末期应收最大公司(''=无台账,深链禁用)
  phase: number | null             // s10 最近行期区(查销售收入表深链用)
  months: string[]                 // s10 有数月(升序)
  elec: number[]                   // 电费(元,与 months 对齐)
  water: number[]                  // 水费(元)
  totals: number[]                 // 计费合计(元)
  ledYms: string[]                 // 这户有台账行的月(不管应收正负;清单行「没有台账 / 10月没有台账」用)
  recv: number                     // 台账末期Σ应收(元)
  coll: number                     // 台账末期Σ实收(元)
  payRate: number | null           // 收缴率%(应收>0)
  arrears: number                  // 末期未收 = max(应收−实收, 0)
  revMom: number | null            // s10 计费合计 末月比上月%(上月没数 = null)
  elecMom: number | null           // s10 电费 末月比上月%
  spikes: MonitorSpike[]           // 电/水费 |环比| > 突变阈值 的月(相邻自然月)
  gone: boolean                    // s10 最近月 < 全局最近月(收入中断口径;风险分里收入、能耗两项按没数算)
  parts: { pay: number | null; rev: number | null; energy: number | null }   // 各因子 0~100(高=差;null=没数)
  score: number                    // 风险分 0~100(高=差;没数的项记 0)
  tier: MonitorTier
  rules: MonitorRule[]             // 本屏租户级规则命中(欠费/能耗突变;id 稳定供状态跟踪)
}
export interface MonitorModel {
  list: MonitorTenant[]            // 末期未收多的在前;未收一样(多是 0)按风险分高的在前
  lastLedgerYm: string | null
  lastS10Ym: string | null
  s10Months: string[]              // 销售收入表有数的月(全园,升序)
  cards: { risk: number; watch: number; arrearsTotal: number; arrearsCount: number; spikeTenants: number }
  band: Record<string, { p25: number; p75: number; n: number }>   // 月 → 园区租户电费 P25/P75(灰带;D3 三档 <20 户不建 key)
}
export interface MonitorOpts { collectTarget: number; spikeTh: number; riskTh: number }

/** 环比突变:|chg|>th 且上月>0。months 给了就只比相邻自然月(前一个月没数不比);不给 = 数组相邻两项照比。 */
export function detectSpikes(vals: number[], th: number, months?: string[]): { idx: number; chg: number }[] {
  const out: { idx: number; chg: number }[] = []
  for (let i = 1; i < vals.length; i++) {
    if (months && nextYm(months[i - 1]) !== months[i]) continue
    const prev = vals[i - 1]
    if (prev <= 0) continue
    const chg = (vals[i] / prev - 1) * 100
    if (Math.abs(chg) > th) out.push({ idx: i, chg })
  }
  return out
}

/** 40/30/30 加权;没数的项记 0(不按其余项归一放大)。 */
export function weighScore(parts: { pay: number | null; rev: number | null; energy: number | null }): number {
  return Math.round(W.pay * (parts.pay ?? 0) + W.rev * (parts.rev ?? 0) + W.energy * (parts.energy ?? 0))
}

export function buildMonitorModel(ledger: AnalysisLedgerRow[], s10: AnalysisS10Row[], opts: MonitorOpts): MonitorModel {
  const { collectTarget, spikeTh, riskTh } = opts

  // ── 台账末期:租户Σ应收/Σ实收 + 应收最大公司;每户有台账行的月 ──
  const ledYms = [...new Set(ledger.map(ymOf))].sort()
  const lastLedgerYm = ledYms[ledYms.length - 1] ?? null
  const led = new Map<string, { recv: number; coll: number; company: string; mx: number }>()
  const ymsOf = new Map<string, Set<string>>()
  for (const r of ledger) {
    const ym = ymOf(r)
    ymsOf.set(r.tenantName, (ymsOf.get(r.tenantName) ?? new Set()).add(ym))
    if (ym !== lastLedgerYm) continue
    const acc = led.get(r.tenantName) ?? { recv: 0, coll: 0, company: '', mx: -1 }
    acc.recv += r.receivable
    acc.coll += r.collected
    if (r.receivable > acc.mx) { acc.mx = r.receivable; acc.company = r.companyName }
    led.set(r.tenantName, acc)
  }

  // ── s10 租户×月(剔期别汇总行;同月多期区求和) ──
  const rows = s10.filter((r) => !isS10AggregateRow(r.tenantName))
  const s10Months = [...new Set(rows.map((r) => r.acctMonth))].sort()
  const lastS10Ym = s10Months[s10Months.length - 1] ?? null
  const byTenant = new Map<string, Map<string, { total: number; elec: number; water: number }>>()
  const phaseOf = new Map<string, number>()
  for (const r of rows) {
    const byM = byTenant.get(r.tenantName) ?? new Map<string, { total: number; elec: number; water: number }>()
    const acc = byM.get(r.acctMonth) ?? { total: 0, elec: 0, water: 0 }
    acc.total += r.total
    acc.elec += r.elec
    acc.water += r.water
    byM.set(r.acctMonth, acc)
    byTenant.set(r.tenantName, byM)
    phaseOf.set(r.tenantName, r.phase)   // 行按月升序 → 留最近行期区
  }

  // ── 园区灰带:各月 租户电费 P25/P75(按全园全部计费租户建,不分行业/品类;D3 三档:<20 户不建带) ──
  const band: Record<string, { p25: number; p75: number; n: number }> = {}
  for (const m of s10Months) {
    const vals: number[] = []
    for (const byM of byTenant.values()) { const v = byM.get(m); if (v && v.elec > 0) vals.push(v.elec) }
    if (vals.length >= 20) {
      band[m] = { p25: quantile(vals, 0.25), p75: quantile(vals, 0.75), n: vals.length }
    }
  }

  // ── 逐租户评分 + 规则命中 ──
  const names = new Set<string>([...led.keys(), ...byTenant.keys()])
  const list: MonitorTenant[] = [...names].map((name) => {
    const l = led.get(name)
    const recv = l?.recv ?? 0, coll = l?.coll ?? 0
    const payRate = l && recv > 0 ? +((coll / recv) * 100).toFixed(1) : null
    const arrears = Math.max(recv - coll, 0)

    const byM = byTenant.get(name)
    const months = byM ? [...byM.keys()].sort() : []
    const elec = months.map((m) => byM!.get(m)!.elec)
    const water = months.map((m) => byM!.get(m)!.water)
    const totals = months.map((m) => byM!.get(m)!.total)
    const gone = months.length > 0 && lastS10Ym != null && months[months.length - 1] < lastS10Ym

    // 末月比上月:上月没数不比(同突变,相邻自然月)
    let revMom: number | null = null, elecMom: number | null = null
    const n = months.length
    if (n >= 2 && nextYm(months[n - 2]) === months[n - 1]) {
      if (totals[n - 2] > 0) revMom = +(((totals[n - 1] - totals[n - 2]) / totals[n - 2]) * 100).toFixed(1)
      if (elec[n - 2] > 0) elecMom = +(((elec[n - 1] - elec[n - 2]) / elec[n - 2]) * 100).toFixed(1)
    }
    const spikes: MonitorSpike[] = [
      ...detectSpikes(elec, spikeTh, months).map((s) => ({ series: 'elec' as const, ...s })),
      ...detectSpikes(water, spikeTh, months).map((s) => ({ series: 'water' as const, ...s })),
    ]

    // 因子(高=差):收缴=未收比例;营收=下行幅度(增长不加分);能耗=|环比|(突变双向);销售收入表停了 = 这两项没数(记 0)
    const parts = {
      pay: payRate != null ? clamp100(100 - payRate) : null,
      rev: gone ? null : revMom != null ? clamp100(-revMom) : null,
      energy: gone ? null : elecMom != null ? clamp100(Math.abs(elecMom)) : null,
    }
    const score = weighScore(parts)
    const tier: MonitorTier = score >= riskTh ? 'risk' : score >= riskTh - 20 ? 'watch' : 'normal'

    // 租户级规则(id 稳定 → localStorage 'fp-ana-anom' 状态跨会话保留)
    const rules: MonitorRule[] = []
    if (payRate != null && payRate < collectTarget && lastLedgerYm) {
      rules.push({
        id: `mon:arr:${lastLedgerYm}:${name}`,
        sev: collectTarget - payRate > 20 ? 'risk' : 'watch',
        type: '欠费', ym: lastLedgerYm,
        detail: `${lastLedgerYm} 应收 ¥${fInt(recv)} · 实收 ¥${fInt(coll)} · 收缴率 ${payRate.toFixed(1)}% < 目标 ${collectTarget}%`,
      })
    }
    for (const s of spikes) {
      const ym = months[s.idx], prevYm = months[s.idx - 1]
      const seriesZh = s.series === 'elec' ? '电费' : '水费'
      const a = s.series === 'elec' ? elec : water
      rules.push({
        id: `mon:spike:${s.series}:${ym}:${name}`,
        sev: Math.abs(s.chg) >= spikeTh * 1.5 ? 'risk' : 'watch',
        type: '能耗突变', ym,
        detail: `${seriesZh} ${prevYm} ¥${fInt(a[s.idx - 1])} → ${ym} ¥${fInt(a[s.idx])} · 环比 ${s.chg >= 0 ? '+' : '−'}${Math.abs(s.chg).toFixed(1)}% 超阈值 ±${spikeTh}%`,
      })
    }

    return {
      name, company: l?.company ?? '', phase: phaseOf.get(name) ?? null,
      months, elec, water, totals, ledYms: [...(ymsOf.get(name) ?? [])].sort(), recv, coll, payRate, arrears,
      revMom, elecMom, spikes, gone, parts, score, tier, rules,
    }
  // 按取整到元的未收排(行上金额也写整元):差几分钱的户算 0,不排到高风险户前面(10-05 第二轮复查:库里 22 户只差 ¥0.01–0.98)
  }).sort((a, b) => owedYuan(b) - owedYuan(a) || b.score - a.score || a.name.localeCompare(b.name))

  return {
    list, lastLedgerYm, lastS10Ym, s10Months, band,
    cards: {
      risk: list.filter((t) => t.tier === 'risk').length,
      watch: list.filter((t) => t.tier === 'watch').length,
      arrearsTotal: list.reduce((s, t) => s + t.arrears, 0),
      arrearsCount: list.filter((t) => t.arrears > 0.005).length,
      spikeTenants: list.filter((t) => t.spikes.length > 0).length,
    },
  }
}

/** 默认选中:清单里第一户「有数据」的(这期收缴率有、电费有 2 个月以上、台账 2 期以上);都没有就第一户。 */
export function defaultPick(list: MonitorTenant[]): MonitorTenant | null {
  return list.find((t) => t.payRate != null && t.elec.filter((v) => v > 0).length >= 2 && t.ledYms.length >= 2) ?? list[0] ?? null
}

// ── 底部两张计数卡:规则引擎 ① 收缴率(公司×期)、② 园区电量环比,按公司 / 按电量收成一行 ──
export interface SumRow { name: string; n: number; of?: number; last: AnaAnomaly; all: AnaAnomaly[] }

/** 收缴率没到目标的公司:一家一行;of = 这家应收 > 0 的期数;按没到的期数多到少。 */
export function coSummary(anoms: AnaAnomaly[], ledger: AnalysisLedgerRow[]): SumRow[] {
  const recvBy = new Map<string, Map<string, number>>()
  for (const r of ledger) {
    const m = recvBy.get(r.companyName) ?? new Map<string, number>()
    m.set(ymOf(r), (m.get(ymOf(r)) ?? 0) + r.receivable)
    recvBy.set(r.companyName, m)
  }
  const by = new Map<string, AnaAnomaly[]>()
  for (const a of anoms) {
    if (a.type !== '收缴率') continue
    const co = a.id.slice(`col:${a.ym}:`.length)   // id = col:{ym}:{公司}
    by.set(co, [...(by.get(co) ?? []), a])
  }
  return [...by].map(([name, hs]) => {
    const all = [...hs].sort((a, b) => b.ym.localeCompare(a.ym))
    return { name, n: all.length, of: [...(recvBy.get(name)?.values() ?? [])].filter((v) => v > 0).length, last: all[0], all }
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
}

/** 园区电量变动超阈值的项:一项电量一行,按次数多到少(同次数按电量表的顺序)。 */
export function nrgSummary(anoms: AnaAnomaly[], energy: EnergySeries[]): SumRow[] {
  return energy.map((e) => {
    const all = anoms.filter((a) => a.type === '能耗环比' && a.id.startsWith(`nrg:${e.name}:`)).sort((a, b) => b.ym.localeCompare(a.ym))
    return { name: e.name, n: all.length, last: all[0], all }
  }).filter((r) => r.n > 0).sort((a, b) => b.n - a.n)
}

/** 电量各序列到哪个月:多数序列的最后一个月;比它晚的另计几项、到哪个月(工具条 S.asof 用)。 */
export function energyAsof(energy: EnergySeries[]): { ym: string; later: { n: number; ym: string } | null } | null {
  const lasts = energy.map((e) => Object.keys(e.series).sort().pop()).filter((x): x is string => !!x)
  if (!lasts.length) return null
  const cnt = (x: string) => lasts.filter((y) => y === x).length
  const ym = [...new Set(lasts)].sort((a, b) => cnt(b) - cnt(a) || b.localeCompare(a))[0]
  const later = lasts.filter((x) => x > ym).sort()
  return { ym, later: later.length ? { n: later.length, ym: later[later.length - 1] } : null }
}
