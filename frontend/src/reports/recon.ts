// 收入核对清单纯函数 — P2-E plan Task2。过滤/排序/计数/状态色,可单测。同 reports/trialBalance.ts 约定。
import type { ReconEntity, ReconStatus } from '@/types/recon'

export type ReconSeg = 'all' | 'diff' | 'miss' | 'ok'

// 排序权重:未核实差异在前→缺记→已平
const STATUS_RANK: Record<ReconStatus, number> = { diff: 0, miss: 1, ok: 2 }

/**
 * 清单过滤+排序:seg 按 status 过滤(all=全部;已核实不剔除,灰显靠排序)、query 搜 tenantName 含。
 * 排序:未核实 diff→miss→ok,已核实(marked)统一排最后(组内仍按状态);同键保输入序(sort 稳定)。
 */
export function filterEntities(entities: ReconEntity[], seg: ReconSeg, query: string): ReconEntity[] {
  const q = query.trim()
  return entities
    .filter(e => (seg === 'all' || e.status === seg) && (!q || e.tenantName.includes(q)))
    .sort((a, b) =>
      (a.marked ? 1 : 0) - (b.marked ? 1 : 0) || STATUS_RANK[a.status] - STATUS_RANK[b.status])
}

// Segmented 四档计数徽标:all=全部,其余按 status(含已核实)。
export function segCounts(entities: ReconEntity[]): Record<ReconSeg, number> {
  const counts: Record<ReconSeg, number> = { all: entities.length, diff: 0, miss: 0, ok: 0 }
  for (const e of entities) counts[e.status]++
  return counts
}

// 状态 → demo3 色 token 名(对齐蓝/金额不符橙/缺记红,plan Task3 token 映射)。
export function statusColor(status: ReconStatus): string {
  return status === 'ok' ? '--hue-blue' : status === 'diff' ? '--hue-orange' : '--hue-red'
}
