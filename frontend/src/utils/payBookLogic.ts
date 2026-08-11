// 收款簿纯逻辑(S20-BILL-DELIVERY-SPEC §2/§5):收款槽注册表 COL_SLOTS、fee_key→槽映射(镜像后端
// BillFeeMap)、含继承的解析、缺口计算、行构建、暂存模型与 PUT /bills/paymap 提交计划、户级状态聚合、
// 对账表 sheet 清单、抽屉方格数据源。payBookLogic.spec.ts 锁定。
//
// ⚠ 槽 = 附表10 colId(bill_pay_company.fee_key 的值域),不是催缴单 fee_key —— 一个槽承接多个费项。
// 注册表只列催缴单实际落到的 10 个槽(2026-08-12 调研定稿),不是 25 列全集:收款簿要的是
// 「这户的电费/水费/宿舍租金往哪交」,把 25 列铺满只会让缺口徽标全是噪声。
// ponytail: 厂房/商铺侧的 factoryRent/factoryMgmtFee/shopRent… 未进注册表(调研口径);
// 若日后收款簿要管它们,只需往 COL_SLOTS 加行——payColOf 已经能映射到它们。
import type { S10ColId } from '@/types/s10'
import type { PaymapRow } from '@/api/bills'
import type { PropertyType } from '@/types/contract'
import { S10_FEE_LABELS } from './billExcel'
import {
  billFeeLabel, groupRentByPremise, resolvePhase, tenantBuildings, type TenantBuildings,
} from './billNoticeLogic'

const r2 = (v: number) => Math.round(v * 100) / 100

// ── 注册表 ──────────────────────────────────────────────
export interface ColSlot {
  colId: S10ColId
  feeKeys: string[]        // 该槽承接的催缴单 fee_key(展示名走 billFeeLabel,禁手抄)
  inheritFrom?: S10ColId   // 未设时继承(后端 BillFeeMap.fallbackCol 的同类兜底,UI 显弱化态)
  neverSeeded?: boolean    // 系统从无默认:种子没推导过,全库都是空的
  wholeNotice?: boolean    // dormRent:宿舍单整单通吃(压过逐行映射)
  note?: string
}
export const COL_SLOTS: ColSlot[] = [
  { colId: 'elecStd',
    feeKeys: ['elec', 'share_elec_floor', 'share_elec_fire', 'share_elec_elevator', 'share_elec_loss', 'share_elec_light'] },
  { colId: 'elecMaint', feeKeys: ['mgmt_fee'], inheritFrom: 'elecStd' },
  { colId: 'elecBasic', feeKeys: ['capacity'], inheritFrom: 'elecStd' },
  { colId: 'waterStd', feeKeys: ['water', 'share_green_water'] },
  { colId: 'waterMaint', feeKeys: ['water_pipe'], inheritFrom: 'waterStd' },
  { colId: 'dormRent', feeKeys: ['rent_dorm'], wholeNotice: true,
    note: '宿舍单整单通吃:该户宿舍单的全部费用(租金/水电/公摊)都收到这家,不逐项拆' },
  { colId: 'officeRent', feeKeys: ['rent_office'], neverSeeded: true },
  { colId: 'officeMgmtFee', feeKeys: [], neverSeeded: true },      // 段类型 office 的 mgmt 行
  { colId: 'landRent', feeKeys: ['rent_land'], neverSeeded: true },
  { colId: 'infraOffice', feeKeys: [], neverSeeded: true },        // 段类型 office 的 infra 行
]
const SLOT_BY_COL = new Map<string, ColSlot>(COL_SLOTS.map(s => [s.colId, s]))
export const slotOf = (colId: string): ColSlot | undefined => SLOT_BY_COL.get(colId)
// 槽名=附表10列名(单一事实源 sales-income/layout.ts leaves,billExcel 已聚好)
export const slotLabel = (colId: S10ColId): string => S10_FEE_LABELS.get(colId) ?? colId
// 槽承接的费项名:走催缴单词汇表;rent 侧两槽(mgmt/infra 按段类型分列)无独立 fee_key,回落槽名
export const slotFeeNames = (s: ColSlot): string[] =>
  s.feeKeys.length ? s.feeKeys.map(billFeeLabel) : [slotLabel(s.colId)]

// ── fee_key → 槽:逐条镜像后端 BillFeeMap(改那边必须同步改这里) ──
const PAY_COL: Record<string, S10ColId> = {
  elec: 'elecStd', mgmt_fee: 'elecMaint', capacity: 'elecBasic',
  water: 'waterStd', water_pipe: 'waterMaint',
  share_elec_floor: 'elecStd', share_elec_elevator: 'elecStd', share_elec_fire: 'elecStd',
  share_elec_light: 'elecStd', share_elec_loss: 'elecStd', share_green_water: 'waterStd',
}
const RENT_COL: Record<string, S10ColId> = {
  rent_factory: 'factoryRent', rent_office: 'officeRent', rent_dorm: 'dormRent',
  rent_shop: 'shopRent', rent_land: 'landRent',
  elevator: 'elevatorMaint', transformer: 'transformerMaint', access: 'accessMaint',
  network: 'networkFee', land_tax: 'landUseTax', other: 'otherFee',
}
const MGMT_COL: Partial<Record<PropertyType, S10ColId>> =
  { factory: 'factoryMgmtFee', office: 'officeMgmtFee', shop: 'shopMgmtFee' }
const INFRA_COL: Partial<Record<PropertyType, S10ColId>> =
  { factory: 'infraFactory', office: 'infraOffice', shop: 'infraShop', dorm: 'infraDorm' }
/** 催缴单行 → 收款槽。dorm=true(宿舍单)整单落 dormRent;mgmt/infra 随段类型分列;未知返回 null。 */
export function payColOf(
  feeKey: string, opts?: { dorm?: boolean; propertyType?: PropertyType | null },
): S10ColId | null {
  if (opts?.dorm) return 'dormRent'
  const pt = opts?.propertyType ?? null
  if (feeKey === 'mgmt') return (pt && MGMT_COL[pt]) ?? null
  if (feeKey === 'infra') return (pt && INFRA_COL[pt]) ?? null
  return PAY_COL[feeKey] ?? RENT_COL[feeKey] ?? null
}

// ── paymap 缓存与解析 ────────────────────────────────────
export const payKey = (tenantId: number, colId: string) => `${tenantId}|${colId}`
export type PayMap = Map<string, number>     // payKey → companyId(落库值)
export type PayStash = Map<string, number>   // payKey → companyId(未保存暂存,压过落库值)
export const buildPayMap = (rows: PaymapRow[]): PayMap =>
  new Map(rows.map(r => [payKey(r.tenantId, r.feeKey), r.companyId]))

export interface SlotResolved {
  companyId: number | null
  inherited: boolean          // true=值来自 inheritFrom 槽(UI 弱化显「继承自X」)
  from: S10ColId | null
}
export function resolveSlot(
  map: PayMap, tenantId: number, slot: ColSlot, stash?: PayStash,
): SlotResolved {
  const pick = (colId: string) => stash?.get(payKey(tenantId, colId)) ?? map.get(payKey(tenantId, colId)) ?? null
  const own = pick(slot.colId)
  if (own != null) return { companyId: own, inherited: false, from: null }
  if (slot.inheritFrom) {
    const up = pick(slot.inheritFrom)
    if (up != null) return { companyId: up, inherited: true, from: slot.inheritFrom }
  }
  return { companyId: null, inherited: false, from: null }
}

// ── 行构建:催缴单 → 一户一行(期归属/主楼栋与催缴单列表同源) ──
export interface PayNoticeIn {
  tenantId: number
  tenantName: string | null
  payCompanyId: number | null
  payCompanyName?: string | null
  noticeKind: string
  premiseText: string | null
  totalAmount: number
  status: string
}
export interface PayContractIn {
  tenantId: number; tenantName: string
  buildingId: number; buildingName?: string | null; rentArea?: number | null
}
export interface PayTenantRow {
  tenantId: number
  tenantName: string
  phase: 1 | 2 | 3
  bld: TenantBuildings
  dorm: boolean            // 有宿舍单(dormRent 槽只对这些户有意义)
  gap: boolean             // 该户有单未落到收款公司(橙点:提示不阻断)
  sheetCount: number       // 将出几张通知单=按收款公司拆的单数(未设公司那部分也算一张)
  totalAmount: number
  status: TenantStatus
}
export function buildPayRows(
  notices: PayNoticeIn[],
  contracts: PayContractIn[],
  buildings: { id: number; phase: number; name: string }[],
): PayTenantRow[] {
  const bById = new Map(buildings.map(b => [b.id, b]))
  const csByTenant = new Map<number, PayContractIn[]>()
  for (const c of contracts) {
    const a = csByTenant.get(c.tenantId)
    if (a) a.push(c); else csByTenant.set(c.tenantId, [c])
  }
  const nsByTenant = new Map<number, PayNoticeIn[]>()
  for (const n of notices) {
    const a = nsByTenant.get(n.tenantId)
    if (a) a.push(n); else nsByTenant.set(n.tenantId, [n])
  }
  return [...nsByTenant.entries()].map(([tenantId, ns]) => {
    const cs = csByTenant.get(tenantId) ?? []
    return {
      tenantId,
      tenantName: ns.find(n => n.tenantName)?.tenantName ?? cs[0]?.tenantName ?? `#${tenantId}`,
      phase: resolvePhase(
        cs.map(c => { const b = bById.get(c.buildingId); return { phase: b?.phase ?? 0, name: b?.name ?? '' } }),
        ns.find(n => n.premiseText)?.premiseText ?? null),
      bld: tenantBuildings(cs),
      dorm: ns.some(n => n.noticeKind === 'dorm'),
      gap: ns.some(n => n.payCompanyId == null),
      sheetCount: new Set(ns.map(n => n.payCompanyId)).size,
      totalAmount: r2(ns.reduce((s, n) => s + (n.totalAmount ?? 0), 0)),
      status: tenantStatus(ns),
    }
  })
}

/** 缺口户数:可见户中该槽解析不出收款公司的户数(dormRent 只算有宿舍单的户)。 */
export function slotGap(
  rows: PayTenantRow[], map: PayMap, slot: ColSlot, stash?: PayStash,
): number {
  return rows.filter(r =>
    (!slot.wholeNotice || r.dorm) && resolveSlot(map, r.tenantId, slot, stash).companyId == null).length
}

/** 提交计划:暂存逐条 PUT /bills/paymap(后端单格 upsert);顺序=暂存插入序,失败可从断点续。 */
export function buildPayPlan(stash: PayStash): PaymapRow[] {
  return [...stash.entries()].map(([k, companyId]) => {
    const [tid, feeKey] = k.split('|')
    return { tenantId: +tid, feeKey: feeKey as S10ColId, companyId }
  })
}

// ── 户级状态(§1.3:状态单据级存储、户级展示) ──
// 遗留/未知状态(如 v1 的 issued)一律按 draft 处理 —— 宁可显"待核对"也不冒充"已确认"。
export type TenantStatus = 'draft' | 'partial' | 'confirmed' | 'exported'
export const STATUS_LABEL: Record<TenantStatus, string> =
  { draft: '待核对', partial: '部分确认', confirmed: '已确认', exported: '已导出' }
export function tenantStatus(notices: { status: string }[]): TenantStatus {
  const live = notices.filter(n => n.status !== 'void')
  if (live.length === 0) return 'draft'
  const done = live.filter(n => n.status === 'confirmed' || n.status === 'exported')
  if (done.length === 0) return 'draft'
  if (done.length < live.length) return 'partial'
  return live.every(n => n.status === 'exported') ? 'exported' : 'confirmed'
}

// ── 对账表 sheet 清单(§5.2:总表 + 每家公司一 sheet + 未设置) ──
export interface ReconSheet {
  id: string                       // 'total' | 'co:{id}' | 'none'
  kind: 'total' | 'company' | 'none'
  companyId: number | null
  label: string
  tenants: number
  amount: number
  note: string
}
export function buildReconSheets(notices: PayNoticeIn[]): ReconSheet[] {
  const cos = new Map<number, { name: string; tenants: Set<number>; amount: number }>()
  const none = { tenants: new Set<number>(), amount: 0 }
  const all = new Set<number>()
  let total = 0
  for (const n of notices) {
    all.add(n.tenantId)
    total = r2(total + (n.totalAmount ?? 0))
    if (n.payCompanyId == null) {
      none.tenants.add(n.tenantId)
      none.amount = r2(none.amount + (n.totalAmount ?? 0))
      continue
    }
    let c = cos.get(n.payCompanyId)
    if (!c) { c = { name: n.payCompanyName || `#${n.payCompanyId}`, tenants: new Set(), amount: 0 }; cos.set(n.payCompanyId, c) }
    c.tenants.add(n.tenantId)
    c.amount = r2(c.amount + (n.totalAmount ?? 0))
  }
  const out: ReconSheet[] = [{
    id: 'total', kind: 'total', companyId: null, label: '总表',
    tenants: all.size, amount: total, note: '各公司合计 + 未设收款公司清单',
  }]
  for (const [id, c] of cos)
    out.push({ id: `co:${id}`, kind: 'company', companyId: id, label: c.name,
      tenants: c.tenants.size, amount: c.amount, note: '户 × 费项 × 金额' })
  if (none.tenants.size)
    out.push({ id: 'none', kind: 'none', companyId: null, label: '未设置收款公司',
      tenants: none.tenants.size, amount: none.amount, note: '通知单上这部分不显示收款账户' })
  return out
}

// ── 该户各槽金额(PaySlotGrid 的 amounts 入参):按后端拆单口径把明细行归到槽 ──
// rent 行的 mgmt/infra 要段类型才知道落哪列,段类型从同 premise 块里的 rent_* 行反推
// (groupRentByPremise 同一套判定,与后端 BillNoticeService 落 payCol 的口径一致)。
// ⚠ 映射不到槽的行(段类型缺失的 mgmt/infra、未知费项键)不进结果 —— 它们在后端也拿不到收款公司,
// 屏上以「该户有费项未指定收款公司」的橙点体现,而不是伪造一个格子让用户以为设了就好了。
export function slotAmounts(details: {
  noticeKind: string
  lines: { feeKey: string; premise: string | null; amount: number; feeGroup?: string | null }[]
}[]): Map<string, number> {
  const out = new Map<string, number>()
  const add = (colId: S10ColId | null, amount: number) => {
    if (colId == null) return
    out.set(colId, r2((out.get(colId) ?? 0) + (amount ?? 0)))
  }
  for (const d of details) {
    const dorm = d.noticeKind === 'dorm'
    const rent = d.lines.filter(l => l.feeGroup === 'rent')
    for (const l of d.lines) if (l.feeGroup !== 'rent') add(payColOf(l.feeKey, { dorm }), l.amount)
    for (const g of groupRentByPremise(rent).groups)
      for (const l of g.lines) add(payColOf(l.feeKey, { dorm, propertyType: g.type }), l.amount)
  }
  return out
}

// ── 导出请求(§5:两个导出窗口 → 导出实现的入参契约,三刀共用,字段名钉死) ──
export interface ExportNoticeReq {
  ym: string
  tenantIds: number[]
  /** companyId → accountId;null=该公司这次不印账户块(源册本就有无账户块的简化版) */
  accountByCompany: Record<number, number | null>
}
export interface ExportReconReq {
  ym: string
  /** 逐字喂 billNoticeExcel.exportReconWorkbook 的第三参;总表由它恒出,不在这里勾 */
  sheets: { companyId: number | null; name: string }[]
}

// ── 抽屉方格(PaySlotGrid 数据源):该户有钱的槽才出格 ──
export interface SlotCell {
  colId: S10ColId
  label: string
  items: string[]              // 该槽承接的费项名
  companyId: number | null
  companyName: string | null
  amount: number | null
  inherit: string | null       // 非空=继承态(「继承自基准电费」),弱化显示
  neverSeeded: boolean
  note: string | null
}
export function buildSlotCells(
  tenantId: number,
  ctx: { dorm: boolean; amounts: Map<string, number> },   // amounts: colId → 该户本月该槽金额
  map: PayMap,
  companies: { id: number; name: string; short?: string }[],
  stash?: PayStash,
): SlotCell[] {
  const coName = new Map(companies.map(c => [c.id, c.short || c.name]))
  const out: SlotCell[] = []
  for (const s of COL_SLOTS) {
    const amount = ctx.amounts.get(s.colId) ?? null
    // 宿舍户的 dormRent 格恒出(整单通吃,没算出金额也要能指定);其余槽有钱才出
    if (amount == null && !(s.wholeNotice && ctx.dorm)) continue
    const r = resolveSlot(map, tenantId, s, stash)
    out.push({
      colId: s.colId, label: slotLabel(s.colId), items: slotFeeNames(s),
      companyId: r.companyId, companyName: r.companyId == null ? null : coName.get(r.companyId) ?? `#${r.companyId}`,
      amount, inherit: r.inherited && r.from ? `继承自${slotLabel(r.from)}` : null,
      neverSeeded: !!s.neverSeeded, note: s.note ?? null,
    })
  }
  return out
}
