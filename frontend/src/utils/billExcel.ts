// 附表10 费用中文名表 + 通用下载。原本是「账单管理」页的导出模块(BILLS-SPEC 2026-07-16),
// 该页 2026-08-13 撤下(职能被催缴单交付链 S20 取代),家族/工资条/AOA 那套随之删除,
// 只留下被出账链复用的这两件:S10_FEE_LABELS(payBookLogic 收款槽标签)、downloadBlob(billNoticeExcel 出流)。
// 费用中文名单一事实源=sales-income/layout.ts leaves,禁手抄。
import type { S10ColId } from '../types/s10'
import { leavesOf } from '../views/sales-income/layout'

// colId → 中文列名:office(25 叶=全集) 先入定序,factory 重复列跳过(office 措辞为准)。
export const S10_FEE_LABELS: ReadonlyMap<S10ColId, string> = (() => {
  const m = new Map<S10ColId, string>()
  for (const l of [...leavesOf('office'), ...leavesOf('factory')]) {
    if (!m.has(l.colId)) m.set(l.colId, l.label)
  }
  return m
})()

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
