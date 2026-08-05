// 催缴单纯逻辑(S4-BILL-NOTICE-SPEC §7 S4-4):单据类/费项/段/状态字典、premise 分段小计、
// 取价审计链 title、列表 KPI。billNoticeLogic.spec.ts 锁定。
// fee_key 词汇沿用 alloc_result 现值(spec §4:不造第三套)——公摊类标签直接复用 ALLOC_FEE_LABEL。
import { ALLOC_FEE_LABEL } from '@/utils/allocLogic'

const r2 = (v: number) => Math.round(v * 100) / 100

// ── 单据类(entity BillNotice.noticeKind 词汇:combined/fee/maint/dorm/offbook) ──
export const NOTICE_KIND_LABEL: Record<string, string> = {
  combined: '合一单',
  fee: '水电费单',
  maint: '维护费单',
  dorm: '宿舍单',
  offbook: '账外单',
}
export const noticeKindLabel = (k: string) => NOTICE_KIND_LABEL[k] ?? k

// ── 费项(spec §4 表):直连计费键 + 公摊键(复用 alloc 字典);损耗按单据词汇显「线路损耗」 ──
export const BILL_FEE_LABEL: Record<string, string> = {
  ...ALLOC_FEE_LABEL,
  share_elec_loss: '线路损耗',
  elec: '电费',
  mgmt_fee: '电力管理费',
  capacity: '装机容量费',
  water: '水费',
  water_pipe: '水管网维护费',
}
export const billFeeLabel = (k: string) => BILL_FEE_LABEL[k] ?? k

// ── 分时段 ──
export const SEG_LABEL: Record<string, string> = { sharp: '尖', peak: '峰', flat: '平', valley: '谷' }
export const segLabel = (s: string | null | undefined) => (s == null ? '' : SEG_LABEL[s] ?? s)

// ── 状态 ──
export const NOTICE_STATUS_LABEL: Record<string, string> = {
  draft: '草稿', issued: '已签发', void: '已作废',
}

// ── 单内按场地分段小计(BILL-DERIVE-SPEC §1.1:多场地租户单内按 premise 分段) ──
// 分组按首现序(后端行序=场地段→表序→段序,premise 天然连续);无场地行归「未标场地」一组。
export interface PremiseGroup<T> {
  premise: string | null
  label: string
  lines: T[]
  subtotal: number
}
export function groupLinesByPremise<T extends { premise: string | null; amount: number }>(
  lines: T[],
): PremiseGroup<T>[] {
  const groups: PremiseGroup<T>[] = []
  const byKey = new Map<string, PremiseGroup<T>>()
  for (const l of lines) {
    const key = l.premise ?? ''
    let g = byKey.get(key)
    if (!g) {
      g = { premise: l.premise ?? null, label: l.premise ?? '未标场地', lines: [], subtotal: 0 }
      byKey.set(key, g)
      groups.push(g)
    }
    g.lines.push(l)
    g.subtotal = r2(g.subtotal + (l.amount ?? 0))
  }
  return groups
}

// ── 取价审计链 title(行尾 info 图标悬浮):price_key/price_scope/price_month/rule_branch ──
export const RULE_BRANCH_LABEL: Record<string, string> = {
  tou: '分时四段',
  resident: '居民价',
  commercial: '商业价',
  tenant_override: '户级例外',
  fixed: '固定费率',
  pool: '公摊池',
}
export function priceScopeLabel(scope: string): string {
  if (scope === '') return '全园默认'
  if (scope.startsWith('tenant:')) return `户级例外(${scope})`
  return scope
}
export function auditTitle(l: {
  priceKey: string | null
  priceScope: string | null
  priceMonth: string | null
  ruleBranch: string | null
}): string | null {
  const rows = [
    l.priceKey ? `取价键 ${l.priceKey}` : null,
    l.priceScope != null ? `作用域 ${priceScopeLabel(l.priceScope)}` : null,
    l.priceMonth != null ? `价目月 ${l.priceMonth === '' ? '初始版本(自始生效)' : l.priceMonth}` : null,
    l.ruleBranch ? `判定分支 ${RULE_BRANCH_LABEL[l.ruleBranch] ?? l.ruleBranch}` : null,
  ].filter((s): s is string => !!s)
  return rows.length ? rows.join('\n') : null
}

// ── 列表 KPI:单数/明细行数/总额合计/警告单数 ──
export function noticeKpis(rows: { lineCount: number; totalAmount: number; warn: string | null }[]): {
  count: number; lineCount: number; total: number; warned: number
} {
  let lineCount = 0, total = 0, warned = 0
  for (const r of rows) {
    lineCount += r.lineCount
    total += r.totalAmount ?? 0
    if (r.warn) warned++
  }
  return { count: rows.length, lineCount, total: r2(total), warned }
}
