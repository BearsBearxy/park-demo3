// src/views/analysis/expense.logic.ts — 费用与报销屏纯数据变换(单测 expense.logic.spec.ts)。
// 输入 = fetchPnlYear('s5', year).rows;组带取自带总计行不重算(标签以库内实际为准,2025 已 SQL 核对:
// 「销售费用合计」group=销售费用 无冒号;「管理费用总计：」「财务费用合计：」带全角冒号 group='';
// 「修缮、改造费用」「运营费用总计」group='')。缺月 null 不补 0;期间取值统一走 cockpit.logic.atPeriod。
import type { PnlRowDTO } from '@/types/pnl'
import { atPeriod } from './cockpit.logic'

export interface ExpenseGroups {
  sales: (number | null)[]    // 销售费用合计
  admin: (number | null)[]    // 管理费用总计：
  fin: (number | null)[]      // 财务费用合计：
  repair: (number | null)[]   // 修缮、改造费用
  total: (number | null)[]    // 运营费用总计(自带大合计,不重算)
}

// 组带前缀:startsWith 兼容全角冒号,且不会误中「办公室水电费合计」等组内小计(它们 kind 也是 total)
const BAND_PREFIX: [keyof ExpenseGroups, string][] = [
  ['sales', '销售费用合计'], ['admin', '管理费用总计'], ['fin', '财务费用合计'],
  ['repair', '修缮、改造费用'], ['total', '运营费用总计'],
]

const nulls = (): (number | null)[] => new Array(12).fill(null)
function addInto(acc: (number | null)[], m: (number | null)[]): void {
  for (let i = 0; i < 12; i++) { const v = m[i]; if (v != null) acc[i] = (acc[i] ?? 0) + v }
}

/** 组带提取:kind=total 且 label 前缀命中(命中多行累加,同 anaData.extractPnlBand 语义)。 */
export function extractGroups(rows: PnlRowDTO[]): ExpenseGroups {
  const g: ExpenseGroups = { sales: nulls(), admin: nulls(), fin: nulls(), repair: nulls(), total: nulls() }
  for (const r of rows) {
    if (r.kind !== 'total') continue
    const hit = BAND_PREFIX.find(([, p]) => r.label.startsWith(p))
    if (hit) addInto(g[hit[0]], r.m)
  }
  return g
}

/** 覆盖月(1-12 升序):任一组带该月非 null(月锚回退/主图覆盖标注用)。 */
export function coveredMonths(g: ExpenseGroups): number[] {
  const out: number[] = []
  for (let i = 0; i < 12; i++) {
    if (g.sales[i] != null || g.admin[i] != null || g.fin[i] != null || g.repair[i] != null || g.total[i] != null) out.push(i + 1)
  }
  return out
}

/** 两序列逐月相加(KPI「财务费用+修缮合计」;两侧均 null 保持 null)。 */
export function addSeries(a: (number | null)[], b: (number | null)[]): (number | null)[] {
  const out = nulls()
  addInto(out, a)
  addInto(out, b)
  return out
}

/** 序列折万(图表用;null 保持 null 不补 0)。 */
export const wanSeries = (a: (number | null)[]): (number | null)[] =>
  a.map((v) => (v == null ? null : +(v / 10000).toFixed(2)))

export interface SubjectItem { label: string; group: string; value: number }

/** 科目 Top N:明细行期间取值(月=当月,年=Σ)>0 降序取前 N(小计/合计行不参与)。 */
export function topSubjects(rows: PnlRowDTO[], isMonth: boolean, mi: number, n = 10): SubjectItem[] {
  const out: SubjectItem[] = []
  for (const r of rows) {
    if (r.kind !== 'detail') continue
    const v = atPeriod(r.m, isMonth, mi)
    if (v != null && v > 0) out.push({ label: r.label, group: r.groupLabel, value: v })
  }
  return out.sort((a, b) => b.value - a.value).slice(0, n)
}

export interface MoverItem {
  label: string; group: string
  cur: number; prev: number; delta: number; pct: number
  prevM: number   // 对比基准月(1-12;缺月跨 null 取最近有数月,榜内披露)
}

/** 环比异动 Top N:明细行 当月 mi 有数 且 其前最近有数月 ≠0 → pct=(cur/prev−1)×100;
 *  持平(pct=0)不算异动;按 |pct| 降序、同幅按 |Δ金额| 降序取前 N。 */
export function momMovers(rows: PnlRowDTO[], mi: number, n = 8): MoverItem[] {
  const out: MoverItem[] = []
  for (const r of rows) {
    if (r.kind !== 'detail') continue
    const cur = r.m[mi]
    if (cur == null) continue
    let prev: number | null = null, prevM = 0
    for (let i = mi - 1; i >= 0; i--) {
      const p = r.m[i]
      if (p != null) { prev = p; prevM = i + 1; break }
    }
    if (prev == null || prev === 0) continue
    const pct = (cur / prev - 1) * 100
    if (pct === 0) continue
    out.push({ label: r.label, group: r.groupLabel, cur, prev, delta: cur - prev, pct, prevM })
  }
  return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || Math.abs(b.delta) - Math.abs(a.delta)).slice(0, n)
}

// 员工报销与办公类圈定关键词(spec §T1 原文;AnaMethodNote 披露同一常量,勿两处写死)
export const REIMBURSE_KEYWORDS = '餐补|差旅|办公|用品|饮用水|药品|接待|通信'
const REIMBURSE_RE = new RegExp(REIMBURSE_KEYWORDS)

export interface ReimburseData {
  items: SubjectItem[]        // 命中且期间值 >0,降序(小条展示)
  sum: number | null          // 命中科目期间值合计;无任何命中有数科目 → null(KPI 显 '—')
}

/** 员工报销与办公类:明细行科目名命中关键词(合计/小计行含「办公」也不圈,防重算)。 */
export function reimburse(rows: PnlRowDTO[], isMonth: boolean, mi: number): ReimburseData {
  const items: SubjectItem[] = []
  let sum: number | null = null
  for (const r of rows) {
    if (r.kind !== 'detail' || !REIMBURSE_RE.test(r.label)) continue
    const v = atPeriod(r.m, isMonth, mi)
    if (v == null) continue
    sum = (sum ?? 0) + v
    if (v > 0) items.push({ label: r.label, group: r.groupLabel, value: v })
  }
  return { items: items.sort((a, b) => b.value - a.value), sum }
}
