// 损益附表 1–5 config — 一个参数化 View 服务 5 条路由(P2-D spec D4)。类似 views/sales-income/layout.ts,纯 TS 常量。
// groupCol=真实母册分组列表头;sheetRe 供 FpImportModal sheetMatch 从母册挑表;storeKey 供 SchedYearGate 年槽。
import type { PnlKind } from '@/types/pnl'

export interface PnlScheduleConfig {
  schedule: 's1' | 's2' | 's3' | 's4' | 's5'
  route: 'rent-pnl' | 'elec-pnl' | 'water-pnl' | 'ops-pnl' | 'expense-pnl'
  title: string
  groupCol: '区域' | '科目名称' | '项目' | '科目'
  sheetRe: RegExp
  storeKey: string
}

export const PNL_SCHEDULES: PnlScheduleConfig[] = [
  { schedule: 's1', route: 'rent-pnl',    title: '附表1 · 租金损益明细',     groupCol: '区域',     sheetRe: /附表1租金损益/,  storeKey: 'pnl-s1' },
  { schedule: 's2', route: 'elec-pnl',    title: '附表2 · 电费损益明细',     groupCol: '科目名称', sheetRe: /附表2电费损益/,  storeKey: 'pnl-s2' },
  { schedule: 's3', route: 'water-pnl',   title: '附表3 · 水费损益明细',     groupCol: '科目名称', sheetRe: /附表3水费损益/,  storeKey: 'pnl-s3' },
  { schedule: 's4', route: 'ops-pnl',     title: '附表4 · 其他运管费用收益', groupCol: '项目',     sheetRe: /附表4其他运管/,  storeKey: 'pnl-s4' },
  { schedule: 's5', route: 'expense-pnl', title: '附表5 · 费用支出明细',     groupCol: '科目',     sheetRe: /附表5费用支出/,  storeKey: 'pnl-s5' },
]

// 本年合计客端派生(spec D3):全 null → null(整行未录),否则 Σ非空(真 0 参与)。
export function rowYearTotal(m: (number | null)[]): number | null {
  const vals = m.filter((v): v is number => v !== null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null
}

// kind 标签识别(spec D2):先判 损益 再判 合计,防「损益合计」误判 total;仅作分带/加粗渲染。
export function detectKind(label: string): PnlKind {
  if (label.includes('损益')) return 'pnl'
  if (label.includes('小计')) return 'subtotal'
  if (/合计|总计/.test(label)) return 'total'
  return 'detail'
}
