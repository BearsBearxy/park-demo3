// src/views/analysis/churn.logic.ts — churn 屏纯数据变换(v2 抽出,口径与 v1 逐字一致,数值不变):
// ① 活跃度模型:缴费恶化(40%)+ s10收入下行(30%)+ 用能下行(30%),缺项按权重归一;
//    已流失 = 台账首期在租 ∩ 末期缺席;s10 逐月出现/消失 = 相邻有数月名单对比。
// ② ECharts option 构建(风险象限散点 / 出现·消失正负柱)— 纯函数,jsdom 单测友好。
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'

export type Tier = 'high' | 'mid' | 'low'

export interface ChurnRow {
  name: string
  company: string          // 深链用:末期应收最大的公司
  recv: number             // 末期应收(元)
  payRate: number | null   // 收款率%(应收>0)
  payScore: number
  revMom: number | null    // s10 收入环比%
  revScore: number | null
  elecScore: number | null
  gone10: boolean          // s10 曾出现、末期缺席
  score: number
  tier: Tier
}

export interface ChurnFlow { label: string; appeared: number; disappeared: number }

export interface ChurnModel {
  firstYm: string
  lastYm: string
  lastY: number
  lastM: number
  list: ChurnRow[]
  counts: { high: number; mid: number; low: number }
  avgScore: number
  overallRate: number
  churned: { name: string; recv: number; company: string }[]
  churnedRecv: number
  flows: ChurnFlow[]
}

const W_PAY = 0.4, W_REV = 0.3, W_ELEC = 0.3
const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
export const mZh = (ym: string) => +ym.slice(5, 7) + '月'

/** 活跃度流失模型(v1 ChurnView model computed 原样抽出;churnTh 由屏传入 anaSettings.churnTh)。 */
export function buildChurnModel(ledgerRows: AnalysisLedgerRow[], s10Rows: AnalysisS10Row[], churnTh: number): ChurnModel | null {
  if (!ledgerRows.length) return null
  const ymKey = (r: AnalysisLedgerRow) => r.year + '-' + String(r.month).padStart(2, '0')
  const yms = [...new Set(ledgerRows.map(ymKey))].sort()
  const firstYm = yms[0], lastYm = yms[yms.length - 1]

  // 台账按租户聚合首/末期(跨公司求和;公司取该期应收最大者,深链用)
  const led = new Map<string, { fRecv: number; fCompany: string; fMax: number; recv: number; coll: number; byCompany: Map<string, number> }>()
  for (const r of ledgerRows) {
    const ym = ymKey(r)
    if (ym !== firstYm && ym !== lastYm) continue
    const acc = led.get(r.tenantName) ?? { fRecv: 0, fCompany: '', fMax: -1, recv: 0, coll: 0, byCompany: new Map<string, number>() }
    if (ym === firstYm) {
      acc.fRecv += r.receivable
      if (r.receivable > acc.fMax) { acc.fMax = r.receivable; acc.fCompany = r.companyName }
    }
    if (ym === lastYm) {
      acc.recv += r.receivable
      acc.coll += r.collected
      acc.byCompany.set(r.companyName, (acc.byCompany.get(r.companyName) ?? 0) + r.receivable)
    }
    led.set(r.tenantName, acc)
  }
  const inLast = new Set([...led.entries()].filter(([, v]) => v.byCompany.size).map(([k]) => k))
  const inFirst = new Set(ledgerRows.filter((r) => ymKey(r) === firstYm).map((r) => r.tenantName))

  // s10 按租户×月聚合(同月多期区求和)
  const s10Months = [...new Set(s10Rows.map((r) => r.acctMonth))].sort()
  const lastS10 = s10Months[s10Months.length - 1]
  const s10ByTenant = new Map<string, Map<string, { total: number; elec: number }>>()
  for (const r of s10Rows) {
    const byM = s10ByTenant.get(r.tenantName) ?? new Map<string, { total: number; elec: number }>()
    const acc = byM.get(r.acctMonth) ?? { total: 0, elec: 0 }
    acc.total += r.total
    acc.elec += r.elec
    byM.set(r.acctMonth, acc)
    s10ByTenant.set(r.tenantName, byM)
  }
  // s10 逐月出现/消失(相邻有数月对比)
  const flows: ChurnFlow[] = s10Months.slice(1).map((m, i) => {
    const prev = new Set([...s10ByTenant.entries()].filter(([, byM]) => byM.has(s10Months[i])).map(([k]) => k))
    const cur = new Set([...s10ByTenant.entries()].filter(([, byM]) => byM.has(m)).map(([k]) => k))
    let appeared = 0, disappeared = 0
    for (const t of cur) if (!prev.has(t)) appeared++
    for (const t of prev) if (!cur.has(t)) disappeared++
    return { label: mZh(s10Months[i]) + '→' + mZh(m), appeared, disappeared }
  })

  // 已流失清单:首期在租 ∩ 末期缺席
  const churned = [...inFirst].filter((t) => !inLast.has(t))
    .map((t) => ({ name: t, recv: led.get(t)?.fRecv ?? 0, company: led.get(t)?.fCompany ?? '' }))
    .sort((a, b) => b.recv - a.recv)
  const churnedRecv = churned.reduce((s, c) => s + c.recv, 0)

  // 在租租户评分
  const list: ChurnRow[] = [...inLast].map((name) => {
    const l = led.get(name)!
    const payRate = l.recv > 0 ? +(l.coll / l.recv * 100).toFixed(1) : null
    const payScore = l.recv > 0 ? clamp100((1 - Math.min(1, l.coll / l.recv)) * 100) : 0
    let revMom: number | null = null, revScore: number | null = null, elecScore: number | null = null, gone10 = false
    const byM = s10ByTenant.get(name)
    if (byM) {
      const ms = [...byM.keys()].sort()
      if (ms[ms.length - 1] < lastS10) {
        gone10 = true
        revScore = 100
        elecScore = 100
      } else if (ms.length >= 2) {
        const prev = byM.get(ms[ms.length - 2])!, cur = byM.get(ms[ms.length - 1])!
        if (prev.total > 0) {
          revMom = +((cur.total - prev.total) / prev.total * 100).toFixed(1)
          revScore = clamp100(-revMom)
        }
        if (prev.elec > 0) elecScore = clamp100(-((cur.elec - prev.elec) / prev.elec * 100))
      }
    }
    let num = W_PAY * payScore, den = W_PAY
    if (revScore != null) { num += W_REV * revScore; den += W_REV }
    if (elecScore != null) { num += W_ELEC * elecScore; den += W_ELEC }
    const score = Math.round(num / den)
    const tier: Tier = score >= churnTh ? 'high' : score >= churnTh - 20 ? 'mid' : 'low'
    let company = '', mx = -1
    for (const [c, v] of l.byCompany) if (v > mx) { mx = v; company = c }
    return { name, company, recv: l.recv, payRate, payScore, revMom, revScore, elecScore, gone10, score, tier }
  }).sort((a, b) => b.score - a.score || b.recv - a.recv)

  const counts = {
    high: list.filter((t) => t.tier === 'high').length,
    mid: list.filter((t) => t.tier === 'mid').length,
    low: list.filter((t) => t.tier === 'low').length,
  }
  const avgScore = list.length ? Math.round(list.reduce((s, t) => s + t.score, 0) / list.length) : 0
  const overallRate = (() => {
    let r = 0, c = 0
    for (const t of list) { r += t.recv; c += t.recv * (t.payRate ?? 0) / 100 }
    return r > 0 ? +(c / r * 100).toFixed(1) : 0
  })()
  return { firstYm, lastYm, lastY: +lastYm.slice(0, 4), lastM: +lastYm.slice(5, 7), list, counts, avgScore, overallRate, churned, churnedRecv, flows }
}

// ── ECharts option 构建(主题色字面值:fpAnaTheme 无法引用 CSS 变量) ──
export const TIER_ECOLOR: Record<Tier, string> = { high: '#E24B4A', mid: '#EF9F27', low: '#378ADD' }
const RED = '#E24B4A'   // 复审:统一主题语义红

/** C5 散点 x 限幅:超界点钉在边界并记 clamped(真值仍在 revMom,tooltip 显示用)。 */
export function clampPts<T extends { revMom: number | null }>(pts: T[], lo = -100, hi = 300): (T & { x: number; clamped: boolean })[] {
  return pts.map((t) => {
    const raw = t.revMom ?? 0
    const x = Math.max(lo, Math.min(hi, raw))
    return { ...t, x, clamped: x !== raw }
  })
}

interface ScatterDatum { name: string; company: string; value: [number, number]; rawMom: number; score: number; recv: number }

/** 风险象限散点:x=s10收入环比%(clampPts 钉边,超界点三角+描边)、y=收款率%、气泡=月应收;
 *  均值 markLine 十字(x=环比均值,取真值口径,y=整体收款率);tooltip 显环比真值(rawMom)。 */
export function churnScatterOption(list: ChurnRow[], overallRate: number): object {
  const pts = clampPts(list.filter((t) => t.revMom != null && t.payRate != null))
  const xMean = pts.length ? +(pts.reduce((s, t) => s + t.revMom!, 0) / pts.length).toFixed(1) : 0
  const rMax = Math.max(1, ...pts.map((t) => t.recv))
  return {
    grid: { left: 52, right: 30, top: 30, bottom: 42 },   // right/top 留白:markLine 标签画在图内不裁切
    tooltip: {
      formatter: (p: { data: ScatterDatum }) =>
        `${p.data.name}<br/>s10收入环比 ${p.data.rawMom >= 0 ? '+' : ''}${p.data.rawMom}%` +
        `<br/>收款率 ${p.data.value[1]}%<br/>风险分 ${p.data.score} · 月应收 ¥${(p.data.recv / 10000).toFixed(1)}万`,
    },
    xAxis: { type: 'value', name: '收入变化(环比%)', nameLocation: 'middle', nameGap: 26, axisLabel: { formatter: (v: number) => (v > 0 ? '+' : '') + v } },
    yAxis: { type: 'value', name: '收款率(%)', axisLabel: { formatter: '{value}%' } },
    series: [{
      type: 'scatter',
      data: pts.map((t) => ({
        name: t.name, company: t.company, value: [t.x, t.payRate!] as [number, number],
        rawMom: t.revMom!, clamped: t.clamped,
        score: t.score, recv: t.recv,
        symbol: t.clamped ? 'triangle' : 'circle',
        symbolSize: 7 + Math.sqrt(t.recv / rMax) * 20,
        itemStyle: { color: TIER_ECOLOR[t.tier], opacity: 0.72, ...(t.clamped ? { borderColor: 'rgba(28,28,28,.8)', borderWidth: 1.2 } : {}) },
      })),
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { type: 'dashed', color: 'rgba(28,28,28,.35)', width: 1.2 },
        label: { fontSize: 11, color: 'rgba(28,28,28,.62)' },
        // 标签画在图内防裁切:x 均值线(竖)insideStartTop 避开顶部轴名;y 均值线(横)insideEndTop 不贴右缘
        data: [
          { xAxis: xMean, label: { position: 'insideStartTop', formatter: `均值 ${xMean >= 0 ? '+' : ''}${xMean}%` } },
          { yAxis: overallRate, label: { position: 'insideEndTop', formatter: `均值 ${overallRate}%` } },
        ],
      },
    }],
  }
}

/** s10 逐月出现/消失正负柱:新出现向上(蓝)、消失向下(红,取负)。 */
export function churnFlowOption(flows: ChurnFlow[]): object {
  return {
    grid: { left: 40, right: 12, top: 30, bottom: 26 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: { seriesName: string; value: number; name: string }[]) =>
        ps[0].name + ps.map((p) => `<br/>${p.seriesName} ${Math.abs(p.value)} 户`).join(''),
    },
    legend: { top: 0, data: ['新出现', '消失'] },
    xAxis: { type: 'category', data: flows.map((f) => f.label) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => String(Math.abs(v)) } },
    series: [
      { name: '新出现', type: 'bar', stack: 'flow', barWidth: '46%', itemStyle: { color: '#378ADD', borderRadius: [3, 3, 0, 0] }, data: flows.map((f) => f.appeared) },
      { name: '消失', type: 'bar', stack: 'flow', itemStyle: { color: RED, borderRadius: [0, 0, 3, 3] }, data: flows.map((f) => -f.disappeared) },
    ],
  }
}
