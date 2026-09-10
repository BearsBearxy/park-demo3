// src/views/analysis/monitor.logic.ts — 租户异常监控中心纯函数(spec §二.2;单测 monitor.logic.spec.ts)。
// 风险分沿 churn 活跃度模型口径:收缴恶化40% + 营收变动30% + 能耗变动30%,缺项按权重归一,
// 高分=差(清单最差在前)。与 churn 的差异:能耗取|环比|(突变双向都算),阈值走 anaSettings
// (收缴目标 collectTarget / 突变阈值 spikeTh / 风险线 churnTh)。
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import { isS10AggregateRow } from '@/analysis/anaData'
import { quantile } from '@/components/ana/anaFmt'

const clamp100 = (v: number): number => Math.max(0, Math.min(100, Math.round(v)))
const fInt = (v: number): string => Math.round(v).toLocaleString('en-US')
const W_PAY = 0.4, W_REV = 0.3, W_ENERGY = 0.3

export interface MonitorSpike { series: 'elec' | 'water'; idx: number; chg: number }
export interface MonitorRule { id: string; sev: 'risk' | 'watch'; type: string; detail: string; ym: string }
export interface MonitorTenant {
  name: string
  company: string                  // 台账末期应收最大公司(''=无台账,深链禁用)
  phase: number | null             // s10 最近行期区(查附表10 深链用)
  months: string[]                 // s10 有数月(升序)
  elec: number[]                   // 电费(元,与 months 对齐)
  water: number[]                  // 水费(元)
  totals: number[]                 // 计费合计(元)
  recv: number                     // 台账末期Σ应收(元)
  coll: number                     // 台账末期Σ实收(元)
  payRate: number | null           // 收缴率%(应收>0)
  arrears: number                  // 末期欠费 = max(应收−实收, 0)
  revMom: number | null            // s10 计费合计 相邻有数月环比%
  elecMom: number | null           // s10 电费 相邻有数月环比%
  spikes: MonitorSpike[]           // 电/水费 |环比| > 突变阈值 的月(相邻有数月口径)
  gone: boolean                    // s10 最近月 < 全局最近月(收入中断口径)
  parts: { pay: number | null; rev: number | null; energy: number | null }   // 各因子 0~100(高=差)
  score: number                    // 风险分 0~100(高=差;全缺项=0)
  tier: 'risk' | 'watch' | 'normal'
  rules: MonitorRule[]             // 本屏租户级规则命中(欠费/能耗突变;id 稳定供状态跟踪)
}
export interface MonitorModel {
  list: MonitorTenant[]            // 最差在前(风险分降序,同分欠费降序)
  lastLedgerYm: string | null
  lastS10Ym: string | null
  cards: { risk: number; watch: number; arrearsTotal: number; arrearsCount: number; spikeTenants: number }
  band: Record<string, { p25: number; p75: number; n: number }>   // 月 → 园区租户电费 P25/P75(灰带;D3 三档 <20 户不建 key)
}
export interface MonitorOpts { collectTarget: number; spikeTh: number; riskTh: number }

/** 相邻有数月环比突变:|chg|>th 且上月>0(隔月缺数按相邻有数期对比,口径见屏内标注)。 */
export function detectSpikes(vals: number[], th: number): { idx: number; chg: number }[] {
  const out: { idx: number; chg: number }[] = []
  for (let i = 1; i < vals.length; i++) {
    const prev = vals[i - 1]
    if (prev <= 0) continue
    const chg = (vals[i] / prev - 1) * 100
    if (Math.abs(chg) > th) out.push({ idx: i, chg })
  }
  return out
}

/** 缺项归一加权(churn 同款):可用因子按权重占比合成,全缺 → 0。 */
export function weighScore(parts: { pay: number | null; rev: number | null; energy: number | null }): number {
  let num = 0, den = 0
  if (parts.pay != null) { num += W_PAY * parts.pay; den += W_PAY }
  if (parts.rev != null) { num += W_REV * parts.rev; den += W_REV }
  if (parts.energy != null) { num += W_ENERGY * parts.energy; den += W_ENERGY }
  return den > 0 ? Math.round(num / den) : 0
}

/** 电费读数句:选中租户末月电费 vs 同类 P25~P75 区间(v/band 任一缺 → 闭嘴,不写占位句)。 */
export function elecReadout(v: number | null, band: { p25: number; p75: number } | undefined): string | null {
  if (v == null || !band) return null
  const pos = v > band.p75 ? '高于' : v < band.p25 ? '低于' : '落在'
  return `电费${pos}同类区间 ¥${fInt(band.p25)}~¥${fInt(band.p75)}`
}

/** 选中租户 应收vs实收 分期条(台账各期,跨公司求和)。 */
export function tenantLedgerBars(ledger: AnalysisLedgerRow[], name: string): { yms: string[]; recv: number[]; coll: number[] } {
  const by = new Map<string, { recv: number; coll: number }>()
  for (const r of ledger) {
    if (r.tenantName !== name) continue
    const ym = r.year + '-' + String(r.month).padStart(2, '0')
    const acc = by.get(ym) ?? { recv: 0, coll: 0 }
    acc.recv += r.receivable
    acc.coll += r.collected
    by.set(ym, acc)
  }
  const yms = [...by.keys()].sort()
  return { yms, recv: yms.map((y) => by.get(y)!.recv), coll: yms.map((y) => by.get(y)!.coll) }
}

export function buildMonitorModel(ledger: AnalysisLedgerRow[], s10: AnalysisS10Row[], opts: MonitorOpts): MonitorModel {
  const { collectTarget, spikeTh, riskTh } = opts

  // ── 台账末期:租户Σ应收/Σ实收 + 应收最大公司 ──
  const ymKey = (r: AnalysisLedgerRow): string => r.year + '-' + String(r.month).padStart(2, '0')
  const ledYms = [...new Set(ledger.map(ymKey))].sort()
  const lastLedgerYm = ledYms[ledYms.length - 1] ?? null
  const led = new Map<string, { recv: number; coll: number; company: string; mx: number }>()
  if (lastLedgerYm) for (const r of ledger) {
    if (ymKey(r) !== lastLedgerYm) continue
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

  // ── 园区灰带:各月 租户电费 P25/P75(同类=全部计费租户;D3 三档:<20 户不建带) ──
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

    let revMom: number | null = null, elecMom: number | null = null
    if (months.length >= 2) {
      const pT = totals[totals.length - 2], cT = totals[totals.length - 1]
      if (pT > 0) revMom = +(((cT - pT) / pT) * 100).toFixed(1)
      const pE = elec[elec.length - 2], cE = elec[elec.length - 1]
      if (pE > 0) elecMom = +(((cE - pE) / pE) * 100).toFixed(1)
    }
    const spikes: MonitorSpike[] = [
      ...detectSpikes(elec, spikeTh).map((s) => ({ series: 'elec' as const, ...s })),
      ...detectSpikes(water, spikeTh).map((s) => ({ series: 'water' as const, ...s })),
    ]

    // 因子(高=差):收缴=未收比例;营收=下行幅度(增长不加分);能耗=|环比|(突变双向);中断=顶格
    const parts = {
      pay: payRate != null ? clamp100(100 - payRate) : null,
      rev: gone ? 100 : revMom != null ? clamp100(-revMom) : null,
      energy: gone ? 100 : elecMom != null ? clamp100(Math.abs(elecMom)) : null,
    }
    const score = weighScore(parts)
    const tier: MonitorTenant['tier'] = score >= riskTh ? 'risk' : score >= riskTh - 20 ? 'watch' : 'normal'

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
      months, elec, water, totals, recv, coll, payRate, arrears,
      revMom, elecMom, spikes, gone, parts, score, tier, rules,
    }
  }).sort((a, b) => b.score - a.score || b.arrears - a.arrears || a.name.localeCompare(b.name))

  return {
    list, lastLedgerYm, lastS10Ym, band,
    cards: {
      risk: list.filter((t) => t.tier === 'risk').length,
      watch: list.filter((t) => t.tier === 'watch').length,
      arrearsTotal: list.reduce((s, t) => s + t.arrears, 0),
      arrearsCount: list.filter((t) => t.arrears > 0.005).length,
      spikeTenants: list.filter((t) => t.spikes.length > 0).length,
    },
  }
}
