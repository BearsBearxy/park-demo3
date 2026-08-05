// 催缴单纯逻辑(S4-BILL-NOTICE-SPEC §7 S4-4 v2 拍板):费项/段字典、Excel 版式分块(非宿舍/宿舍子表)、
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

// ── Excel 版式(可莱恩 worksheet 范式,2026-08-05 拍板):非宿舍段电/水两部,逐场地「费块+维护费块」──
// 行归块映射:elec/capacity→电费块;mgmt_fee/楼层/消防/电梯/损耗/路灯→用电维护费块;
// water→水费块;water_pipe/绿化水→用水维护费块;未知键落 other 兜底(引擎加费项不丢行)。
// premise=null 的公摊行归「园区/未分场地」带(引擎改造后应都有 premise,此为兜底);场地按首现序。
const ELEC_FEE = new Set(['elec', 'capacity'])
const ELEC_MAINT = new Set([
  'mgmt_fee', 'share_elec_floor', 'share_elec_fire', 'share_elec_elevator', 'share_elec_loss', 'share_elec_light',
])
const WATER_FEE = new Set(['water'])
const WATER_MAINT = new Set(['water_pipe', 'share_green_water'])

export interface UtilLineBase { feeKey: string; premise: string | null; amount: number }
export interface UtilPremiseGroup<T> {
  premise: string | null
  label: string          // premise ?? 园区/未分场地
  fee: T[]               // 电费块(电表行+容量行)/水费块(水表行),入参序
  feeTotal: number
  maint: T[]             // 用电/用水维护费块
  maintTotal: number
  subtotal: number       // fee+maint(水部分「场地水费、维护费合计」用)
}
export interface UtilPart<T> { groups: UtilPremiseGroup<T>[]; total: number }
export interface ExcelStyleGroups<T> {
  elec: UtilPart<T>      // elec.total=「电费、用电维护费合计」
  water: UtilPart<T>     // water.total=「水费、用水维护费合计」
  other: T[]
  otherTotal: number
  total: number          // 非宿舍水电合计=Σ全行
}
export function groupExcelStyle<T extends UtilLineBase>(lines: T[]): ExcelStyleGroups<T> {
  const parts = { elec: { groups: [], total: 0 } as UtilPart<T>, water: { groups: [], total: 0 } as UtilPart<T> }
  const keys = { elec: new Map<string, UtilPremiseGroup<T>>(), water: new Map<string, UtilPremiseGroup<T>>() }
  const other: T[] = []
  for (const l of lines) {
    const part = ELEC_FEE.has(l.feeKey) || ELEC_MAINT.has(l.feeKey) ? 'elec'
      : WATER_FEE.has(l.feeKey) || WATER_MAINT.has(l.feeKey) ? 'water' : null
    if (!part) { other.push(l); continue }
    const k = l.premise ?? ''
    let g = keys[part].get(k)
    if (!g) {
      g = {
        premise: l.premise ?? null, label: l.premise ?? '园区/未分场地',
        fee: [], feeTotal: 0, maint: [], maintTotal: 0, subtotal: 0,
      }
      keys[part].set(k, g)
      parts[part].groups.push(g)
    }
    if (part === 'elec' ? ELEC_FEE.has(l.feeKey) : WATER_FEE.has(l.feeKey)) {
      g.fee.push(l); g.feeTotal = r2(g.feeTotal + l.amount)
    } else {
      g.maint.push(l); g.maintTotal = r2(g.maintTotal + l.amount)
    }
    g.subtotal = r2(g.feeTotal + g.maintTotal)
    parts[part].total = r2(parts[part].total + l.amount)
  }
  const otherTotal = r2(other.reduce((s, l) => s + l.amount, 0))
  return {
    elec: parts.elec, water: parts.water, other, otherTotal,
    total: r2(parts.elec.total + parts.water.total + otherTotal),
  }
}

// ── 宿舍子表(逐间宽行,Excel 宿舍段范式):电=电表行+电力管理费(同表挂靠)+路灯分摊(同房号唯一配对);
// 水=水表行+绿化水公摊(同房号)。配不上的公摊/损耗行落 extras 平铺,未知键落水子表尾——兜底别丢行。
// ponytail: 分时宿舍一表多段=一段一行,管理费挂该表首行;间序=入参行序。
export interface DormLineBase extends UtilLineBase {
  meterId: number | null
  meterLabel: string | null
  baseSnap: number | null
}
export interface DormRoomRow<T> {
  room: string           // 房号=premise,缺则表标签
  area: number | null    // 租赁面积=路灯/绿化水分摊行 baseSnap(面积基数)
  main: T                // 电表/水表行
  mgmt: T | null         // 电力管理费行(水恒 null)
  share: T | null        // 路灯分摊/绿化水公摊行
  amount: number         // 主行+管理费(Excel 金额列=用量×(基准电价+管理费))
}
export interface DormSub<T> { rooms: DormRoomRow<T>[]; extras: T[]; total: number }
export interface DormGroups<T> { elec: DormSub<T>; water: DormSub<T>; total: number }
export function groupDormExcelStyle<T extends DormLineBase>(lines: T[]): DormGroups<T> {
  const elec: DormSub<T> = { rooms: [], extras: [], total: 0 }
  const water: DormSub<T> = { rooms: [], extras: [], total: 0 }
  const elecByMeter = new Map<number, DormRoomRow<T>>()
  const mkRoom = (l: T): DormRoomRow<T> =>
    ({ room: l.premise ?? l.meterLabel ?? '–', area: null, main: l, mgmt: null, share: null, amount: r2(l.amount) })
  // 两遍扫:先建间行(电/水主行),再挂配对行
  for (const l of lines) {
    if (l.feeKey === 'elec') {
      const row = mkRoom(l)
      elec.rooms.push(row)
      if (l.meterId != null && !elecByMeter.has(l.meterId)) elecByMeter.set(l.meterId, row)
    } else if (l.feeKey === 'water') {
      water.rooms.push(mkRoom(l))
    }
  }
  // 同房号唯一才挂(现状 premise 为整段长串/公摊行无 premise 时自然落 extras)
  const byPremise = (rooms: DormRoomRow<T>[], premise: string | null): DormRoomRow<T> | null => {
    if (premise == null) return null
    const hit = rooms.filter(r => r.main.premise === premise)
    return hit.length === 1 ? hit[0] : null
  }
  for (const l of lines) {
    if (l.feeKey === 'elec' || l.feeKey === 'water') continue
    if (l.feeKey === 'mgmt_fee') {
      const row = l.meterId != null ? elecByMeter.get(l.meterId) : undefined
      if (row && !row.mgmt) { row.mgmt = l; row.amount = r2(row.amount + l.amount) } else elec.extras.push(l)
    } else if (l.feeKey === 'share_elec_light') {
      const row = byPremise(elec.rooms, l.premise)
      if (row && !row.share) { row.share = l; row.area = l.baseSnap } else elec.extras.push(l)
    } else if (l.feeKey === 'share_green_water') {
      const row = byPremise(water.rooms, l.premise)
      if (row && !row.share) { row.share = l; row.area = l.baseSnap } else water.extras.push(l)
    } else if (ELEC_FEE.has(l.feeKey) || ELEC_MAINT.has(l.feeKey)) {
      elec.extras.push(l)
    } else {
      water.extras.push(l)   // water_pipe + 未知键兜底
    }
  }
  const sum = (s: DormSub<T>) => r2(
    s.rooms.reduce((a, r) => a + r.amount + (r.share?.amount ?? 0), 0)
    + s.extras.reduce((a, l) => a + l.amount, 0))
  elec.total = sum(elec)
  water.total = sum(water)
  return { elec, water, total: r2(elec.total + water.total) }
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
