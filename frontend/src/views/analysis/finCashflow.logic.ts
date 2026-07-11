// fin-cashflow v2 纯函数(spec §二.9):应收实收分组柱 option + 点柱下钻的欠费租户清单 + 欠费账龄分桶(spec §D)。
// 瀑布 option 复用 finPnl.logic.waterfallOption(同屏组共用技法)。单测 finCashflow.logic.spec.ts。
import type { AnalysisLedgerRow } from '@/api/analysis'
import { familyRootOf } from '@/analysis/anaFamily'
import { fnum } from '@/components/ana/anaFmt'

const wanTip = (v: number): string => '¥' + fnum(v, 1) + '万'

export interface RcPeriod { ym: string; receivable: number; collected: number }

/** 应收 vs 实收 分组柱 option(值折万;柱可点击,name=期)。 */
export function rcGroupOption(periods: RcPeriod[]): object {
  return {
    grid: { left: 8, right: 12, top: 30, bottom: 4, containLabel: true },
    legend: { top: 0, right: 0 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : wanTip(v)) },
    xAxis: { type: 'category', data: periods.map((p) => p.ym) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fnum(v, 0) } },
    series: [
      { name: '应收', type: 'bar', cursor: 'pointer', data: periods.map((p) => p.receivable / 1e4), barWidth: '26%', itemStyle: { color: '#85B7EB', borderRadius: 3 } },
      { name: '实收', type: 'bar', cursor: 'pointer', data: periods.map((p) => p.collected / 1e4), barWidth: '26%', itemStyle: { color: '#378ADD', borderRadius: 3 } },
    ],
  }
}

// 账龄 4 桶固定顺序(spec §D:距全局最新台账月的月龄;期初旧账固定归 >6月)
export const AGING_LABELS = ['≤1月', '2~3月', '4~6月', '>6月'] as const

export interface AgingBucket { label: string; amount: number; tenantCount: number }

/**
 * 欠费账龄(spec §D):租户×公司分组、月升序;组内最早覆盖月的 balancePrev>0 作「期初旧账」
 * 入队(视为最老);逐月 net=应收−实收,>0 入队 / <0 以 |net| FIFO 冲抵队首最旧(可跨多笔,
 * 超出队列的冲抵额忽略);余队按月龄分桶。月龄基准=全局最新台账月,不随公司过滤(与覆盖窗口
 * 徽章同口径);cid 过滤口径同 arrearsOf。tenantCount=桶内有余额的去重租户(租户×公司)数。
 */
export function agingBuckets(rows: AnalysisLedgerRow[], cid: string): { buckets: AgingBucket[]; total: number } {
  const buckets: AgingBucket[] = AGING_LABELS.map((label) => ({ label, amount: 0, tenantCount: 0 }))
  let latest = -1
  for (const r of rows) latest = Math.max(latest, r.year * 12 + r.month)
  if (latest < 0) return { buckets, total: 0 }

  const groups = new Map<string, AnalysisLedgerRow[]>()
  for (const r of rows) {
    if (cid !== '0' && String(r.companyId) !== cid) continue
    const g = groups.get(r.companyId + '|' + r.tenantName)
    if (g) g.push(r)
    else groups.set(r.companyId + '|' + r.tenantName, [r])
  }

  const tenantSets = buckets.map(() => new Set<string>())
  let total = 0
  for (const [key, list] of groups) {
    list.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))
    // FIFO 欠费队列,队首最旧;opening=期初旧账(记账早于覆盖窗口,月龄不可知 → 固定 >6月)
    const queue: { idx: number; amount: number; opening: boolean }[] = []
    const firstIdx = list[0].year * 12 + list[0].month
    const opening = list.reduce((s, r) => s + (r.year * 12 + r.month === firstIdx ? r.balancePrev : 0), 0)
    if (opening > 0) queue.push({ idx: firstIdx, amount: opening, opening: true })
    for (const r of list) {
      const net = r.receivable - r.collected
      if (net > 0) queue.push({ idx: r.year * 12 + r.month, amount: net, opening: false })
      else if (net < 0) {
        let rest = -net
        while (rest > 0 && queue.length) {
          const cut = Math.min(queue[0].amount, rest)
          queue[0].amount -= cut
          rest -= cut
          if (queue[0].amount <= 0) queue.shift()
        }
      }
    }
    for (const e of queue) {
      if (e.amount <= 0) continue
      const age = latest - e.idx
      const bi = e.opening ? 3 : age <= 1 ? 0 : age <= 3 ? 1 : age <= 6 ? 2 : 3
      buckets[bi].amount += e.amount
      tenantSets[bi].add(key)
      total += e.amount
    }
  }
  buckets.forEach((b, i) => { b.tenantCount = tenantSets[i].size })
  return { buckets, total }
}

// ── 家族映射器(spec §B/W2 方案A):按家族口径时先过此函数,再走现有 arrearsOf/agingBuckets ──
export interface FamilyLedgerRow extends AnalysisLedgerRow { members: number }

/**
 * rows 家族合并:tenantName→家族根名(familyRootOf),同(公司×家族×年月)行合并——
 * 金额四字段(balancePrev/receivable/collected/balanceEnd)求和,members=该格去重成员数
 * (本期有流水成员数)。合并后 FIFO 在家族合并流水上跑,天然实现「家族内预收/多收抵减
 * 其他成员欠费」净额口径,零新聚合逻辑;单户家族原行不变(members=1)。
 */
export function mergeFamilyRows(rows: AnalysisLedgerRow[], fam: Map<string, string>): FamilyLedgerRow[] {
  const byKey = new Map<string, { row: FamilyLedgerRow; names: Set<string> }>()
  const out: FamilyLedgerRow[] = []
  for (const r of rows) {
    const root = familyRootOf(fam, r.tenantName)
    const key = r.companyId + '|' + root + '|' + r.year + '|' + r.month
    const hit = byKey.get(key)
    if (hit) {
      hit.row.balancePrev += r.balancePrev
      hit.row.receivable += r.receivable
      hit.row.collected += r.collected
      hit.row.balanceEnd += r.balanceEnd
      hit.names.add(r.tenantName)
      hit.row.members = hit.names.size
    } else {
      const merged: FamilyLedgerRow = { ...r, tenantName: root, members: 1 }
      byKey.set(key, { row: merged, names: new Set([r.tenantName]) })
      out.push(merged)
    }
  }
  return out
}

export interface ArrearsRow {
  tenantName: string
  companyName: string
  balancePrev: number
  receivable: number
  collected: number
  balanceEnd: number
}

/** 点柱下钻:该期(可选公司过滤)期末仍有欠费的租户清单,按欠费额降序。 */
export function arrearsOf(rows: AnalysisLedgerRow[], cid: string, ym: string): ArrearsRow[] {
  const out: ArrearsRow[] = []
  for (const r of rows) {
    if (cid !== '0' && String(r.companyId) !== cid) continue
    if (r.year + '-' + String(r.month).padStart(2, '0') !== ym) continue
    if (r.balanceEnd <= 0) continue
    out.push({
      tenantName: r.tenantName, companyName: r.companyName,
      balancePrev: r.balancePrev, receivable: r.receivable,
      collected: r.collected, balanceEnd: r.balanceEnd,
    })
  }
  return out.sort((a, b) => b.balanceEnd - a.balanceEnd)
}
