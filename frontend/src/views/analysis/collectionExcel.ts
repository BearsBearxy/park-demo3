// 催缴清单 Excel 导出(审计建议#1)。屏私有(仅 FinCashflowView 消费,不入 utils 以免
// utils→views 倒置)。列序:租户/家族 · 公司 · 联系人 · 电话 · 4 账龄桶 · 欠费合计 · 最早欠费月 + 末行合计。
// 金额为元(屏上折万仅为显示;催缴按精确值行动)。联系方式按租户名查主数据,家族根名即主租户名。
// 出流走 utils/sheet.ts 适配层(exceljs,内部懒加载,仅点「导出」才拉)。
import { writeAoaWorkbook } from '@/utils/sheet'
import type { CollectionRow } from './finCashflow.logic'
import { AGING_LABELS } from './finCashflow.logic'
import type { TenantDTO } from '@/types/tenant'

export interface CollectionExportOpts {
  latestYm: string        // 覆盖窗口末期(文件名+口径行)
  familyMode: boolean     // 按家族口径(影响首列表头/文件名/口径行)
  companyLabel: string    // 公司过滤标签(口径行)
}

export async function exportCollectionList(rows: CollectionRow[], tenants: TenantDTO[], opts: CollectionExportOpts): Promise<void> {
  const byName = new Map(tenants.map((t) => [t.companyName, t]))
  const who = opts.familyMode ? '家族' : '租户'
  const caption = [`催缴清单 · ${opts.companyLabel} · 按${who} · 账龄距 ${opts.latestYm}(FIFO 冲抵,期初旧账固定>6月) · 金额单位:元`]
  const header = [who, '公司', '联系人', '电话', ...AGING_LABELS, '欠费合计', '最早欠费月']

  const body = rows.map((r) => {
    const t = byName.get(r.tenantName)
    return [r.tenantName, r.companyName, t?.contactName ?? '', t?.contactPhone ?? '',
      ...r.buckets, r.total, r.oldestYm]
  })

  const sum = (i: number) => rows.reduce((s, r) => s + r.buckets[i], 0)
  const footer = [`合计(${rows.length}${opts.familyMode ? '族' : '户'})`, '', '', '',
    sum(0), sum(1), sum(2), sum(3), rows.reduce((s, r) => s + r.total, 0), '']

  await writeAoaWorkbook(`催缴清单-${opts.latestYm}-按${who}.xlsx`,
    [{ name: '催缴清单', aoa: [caption, header, ...body, footer] }])
}
