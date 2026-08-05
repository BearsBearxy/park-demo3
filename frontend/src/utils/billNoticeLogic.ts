// 催缴单纯逻辑(S4-BILL-NOTICE-SPEC §7 S4-4 v2 拍板):费项/段字典、premise 分段小计、
// 取价审计链 title、租户聚合(一个租户一条)/期归属/月租金参考/KPI。billNoticeLogic.spec.ts 锁定。
// fee_key 词汇沿用 alloc_result 现值(spec §4:不造第三套)——公摊类标签直接复用 ALLOC_FEE_LABEL。
// v1 的单据类/状态字典与按单 KPI 已随「屏上不显单据类/收款主体/状态」拍板删除。
import { ALLOC_FEE_LABEL } from '@/utils/allocLogic'

const r2 = (v: number) => Math.round(v * 100) / 100

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

// ── v2 拍板1:租户聚合——一个租户一条,该户全部单据(含宿舍单)合并,对齐 Excel 每租户一张 worksheet ──
export interface NoticeLike {
  id: number
  tenantId: number
  tenantName: string | null
  noticeKind: string
  premiseText: string | null
  totalAmount: number
  prevDue: number
  lineCount: number
  warn: string | null
}
export interface TenantNoticeRow {
  tenantId: number
  tenantName: string | null
  noticeIds: number[]          // 保单据序;明细抽屉逐单拉 detail 用
  lineCount: number            // 水电行数=Σ
  totalAmount: number          // 水电合计=Σ
  prevDue: number
  premiseText: string | null   // 各单场地按逗号拆项去重合并
  warn: string | null          // 各单 warn 按分号拆项去重、换行连接(悬浮原文)
  offbook: boolean             // 账外户降淡(offbook 是户级标,该户单据全为 offbook 才算)
}
export function aggregateByTenant(notices: NoticeLike[]): TenantNoticeRow[] {
  interface Acc { row: TenantNoticeRow; premises: Set<string>; warns: Set<string> }
  const accs: Acc[] = []
  const byTenant = new Map<number, Acc>()
  for (const n of notices) {
    let a = byTenant.get(n.tenantId)
    if (!a) {
      a = {
        row: {
          tenantId: n.tenantId, tenantName: n.tenantName, noticeIds: [],
          lineCount: 0, totalAmount: 0, prevDue: 0, premiseText: null, warn: null, offbook: true,
        },
        premises: new Set(), warns: new Set(),
      }
      byTenant.set(n.tenantId, a)
      accs.push(a)
    }
    const r = a.row
    r.noticeIds.push(n.id)
    r.lineCount += n.lineCount
    r.totalAmount = r2(r.totalAmount + (n.totalAmount ?? 0))
    r.prevDue = r2(r.prevDue + (n.prevDue ?? 0))
    r.tenantName ??= n.tenantName
    if (n.noticeKind !== 'offbook') r.offbook = false
    for (const p of (n.premiseText ?? '').split(',')) { const t = p.trim(); if (t) a.premises.add(t) }
    for (const w of (n.warn ?? '').split(';')) { const t = w.trim(); if (t) a.warns.add(t) }
  }
  for (const a of accs) {
    a.row.premiseText = a.premises.size ? [...a.premises].join(',') : null
    a.row.warn = a.warns.size ? [...a.warns].join('\n') : null
  }
  return accs.map(a => a.row)
}

// ── v2 拍板4:期归属——在租合同楼栋 phase(宿舍类归一期,多真期取首个非宿舍期)
//    → 回退 premise 前缀「一期/二期/三期」→ 兜底一期 ──
const DORMISH_NAME = /宿舍|散租|保障房|饭堂/
export function resolvePhase(
  buildings: { phase: number; name: string }[],   // 该户当月在租合同的楼栋(合同序)
  premiseText: string | null,
): 1 | 2 | 3 {
  let sawDorm = false
  for (const b of buildings) {
    if (b.phase === 4 || DORMISH_NAME.test(b.name)) { sawDorm = true; continue }
    if (b.phase === 1 || b.phase === 2 || b.phase === 3) return b.phase
  }
  if (sawDorm) return 1
  const m = premiseText?.match(/^(一|二|三)期/)
  if (m) return m[1] === '二' ? 2 : m[1] === '三' ? 3 : 1
  return 1
}

// ── v2:月租金(参考)——该户当月在租合同 monthlyRent 之和 ──
export function rentByTenant(contracts: { tenantId: number; monthlyRent: number | null }[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const c of contracts) m.set(c.tenantId, r2((m.get(c.tenantId) ?? 0) + (c.monthlyRent ?? 0)))
  return m
}

// ── v2 KPI:户数/水电总额/月租金合计(参考)/警告户数(随当前期 tab 联动) ──
export function tenantKpis(rows: { totalAmount: number; rent: number | null; warn: string | null }[]): {
  count: number; total: number; rent: number; warned: number
} {
  let total = 0, rent = 0, warned = 0
  for (const r of rows) {
    total += r.totalAmount ?? 0
    rent += r.rent ?? 0
    if (r.warn) warned++
  }
  return { count: rows.length, total: r2(total), rent: r2(rent), warned }
}
