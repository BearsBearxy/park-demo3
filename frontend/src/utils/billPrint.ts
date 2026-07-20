// 打印账单(BILLS-SPEC §6):抽屉「打印账单」→ A4 版式 HTML 新窗写入后自动 print()(浏览器打印/另存 PDF)。
// 与 xlsx 账单条同构:标题 → 期间/户名 → 工资条表(每成员金额列右侧「转入公司」列) → 应收合计 → 转账指引 + 催缴语。
// 纯 HTML + print CSS 不引库;黑白朴素版式(打印给租户)。数据派生全部复用 billExcel 纯函数,禁另抄口径。
import {
  buildPayslip, billMemberHead, billPayCoCell, BILL_DUE_NOTE, BILL_TRANSFER_NOTE,
  type BillFamily, type PayCoLookup,
} from './billExcel'
import { fpMoney } from './money'

// 租户名等入 HTML 前转义(数据来自本库,防御成本一行)
const esc = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

/** A4 打印页完整 HTML(纯函数)。 */
export function buildBillHtml(fam: BillFamily, year: number, month: number, payCo: PayCoLookup): string {
  const ps = buildPayslip(fam)
  const title = `账单-${year}年${String(month).padStart(2, '0')}月-${fam.rootName}`
  const household = ps.members.length > 1 ? `${fam.rootName}（家族 ${ps.members.length} 户）` : fam.rootName

  const headCells = ps.members
    .map(m => `<th>${esc(billMemberHead(m))}</th><th class="co">转入公司</th>`)
    .join('')
  const bodyRows = ps.rows.map(r => {
    const cells = r.values
      .map((v, i) => {
        const m = ps.members[i]
        return `<td>${m.missing ? '—' : fpMoney(v)}</td><td class="co">${esc(billPayCoCell(m, r.key, v, payCo))}</td>`
      })
      .join('')
    return `<tr><td class="l">${esc(r.label)}</td>${cells}<td class="b">${fpMoney(r.total)}</td></tr>`
  }).join('')
  const totalCells = ps.memberTotals
    .map((t, i) => `<td>${ps.members[i].missing ? '—' : fpMoney(t)}</td><td class="co"></td>`)
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { margin: 0; color: #000; font: 12.5px/1.7 "Microsoft YaHei", "PingFang SC", sans-serif; }
  h1 { margin: 0 0 14px; font-size: 19px; text-align: center; letter-spacing: 2px; }
  .meta { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 4px 8px; text-align: right; white-space: nowrap; }
  th { background: #f0f0f0; font-weight: 600; }
  .l { text-align: left; }
  .co { text-align: center; font-size: 11.5px; }
  .b, .total td { font-weight: 600; }
  .sum { margin: 12px 0 16px; text-align: right; font-size: 14px; font-weight: 600; }
  .note { margin: 3px 0; }
</style>
</head>
<body>
<h1>园区租户账单</h1>
<div class="meta"><span>期间：${year}年${month}月</span><span>户名：${esc(household)}</span></div>
<table>
  <thead><tr><th class="l">费用项</th>${headCells}<th>合计</th></tr></thead>
  <tbody>
    ${bodyRows}
    <tr class="total"><td class="l">合计</td>${totalCells}<td>${fpMoney(ps.grandTotal)}</td></tr>
  </tbody>
</table>
<p class="sum">本期应收合计：${fpMoney(ps.grandTotal)}</p>
<p class="note">${esc(BILL_TRANSFER_NOTE)}</p>
<p class="note">${esc(BILL_DUE_NOTE)}</p>
<script>addEventListener('load', function () { print() })</script>
</body>
</html>`
}

/** 新窗打印:写入 HTML 后由页内 load 钩子自动弹打印对话框(弹窗被拦截时浏览器自会提示)。 */
export function printBill(fam: BillFamily, year: number, month: number, payCo: PayCoLookup): void {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(buildBillHtml(fam, year, month, payCo))
  w.document.close()
}
