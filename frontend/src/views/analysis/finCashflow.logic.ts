// fin-cashflow v2 纯函数(spec §二.9):应收实收分组柱 option + 点柱下钻的欠费租户清单。
// 瀑布 option 复用 finPnl.logic.waterfallOption(同屏组共用技法)。单测 finCashflow.logic.spec.ts。
import type { AnalysisLedgerRow } from '@/api/analysis'
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
