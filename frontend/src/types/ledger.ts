// Ledger DTOs — shapes mirror backend records (spec §4.1/§4.2). JSON camelCase ⇄ Java record.
// 21 fee columns are flattened onto LedgerRowDTO/LedgerFooter as BigDecimal→number.
import type { ArchivedCol } from './book'

export interface CompanyDTO {
  id: number
  name: string
  short: string
  sortNo: number
}

// 年份门:有数据的年份 + 该年已录入月份数(台账/三大报表共用,镜像后端 YearMonthsDTO)
export interface YearMonthsDTO {
  year: number
  months: number
}

export interface MonthMeta {
  month: number
  recv: number
  coll: number
  tenants: number
  status: 'done' | 'current' | 'empty'
}

export interface LedgerOverviewDTO {
  companyName: string
  year: number
  monthsWithData: number
  ytdRecv: number
  avgRecv: number
  activeTenants: number
  months: MonthMeta[]
}

// 21 fee columns (order = spec §3.1). Shared by row + footer.
export interface LedgerFees {
  factoryRent: number
  factoryMgmtFee: number
  shopRent: number
  dormRent: number
  dormFacilitiesFee: number
  shopMgmtFee: number
  factoryInfraMaint: number
  shopInfraMaint: number
  dormInfraMaint: number
  elevatorMaint: number
  transformerMaint: number
  landUseTax: number
  networkFee: number
  accessCtrlMaint: number
  officeOtherFee: number
  dormOtherFee: number
  basicElectricity: number
  standardElectricity: number
  electricityMaint: number
  standardWater: number
  waterMaint: number
}

export interface LedgerRowDTO extends LedgerFees {
  id: number | null       // 行 id(服务端行必有;编辑态本地新增行为 null,保存后获得)
  tenantId: number | null // null = 未绑定档案(V105 软引用)
  tenantName: string      // 账面名快照,与档案名可不一致
  balancePrev: number
  balancePrevDerived?: boolean  // true=结余链派生(上月期末,禁编辑);false/缺省=首次出现月期初(可录)
  carried?: boolean             // true=结转虚行(本月无存储行,只带上月结余;录数保存即落成真行)
  totalCollected: number
  note: string | null
  totalReceivable: number // derived
  balanceEnd: number      // derived
  extraFees?: Record<string, number | null>  // 自定义列口袋(键=列固定id c_xxx,方案A;后端恒下发,本地新增行可缺省)
}

export interface LedgerFooter extends LedgerFees {
  balancePrev: number
  totalReceivable: number
  totalCollected: number
  balanceEnd: number
}

export interface LedgerMonthDTO {
  companyName: string
  year: number
  month: number
  prevMonth: number
  rows: LedgerRowDTO[]
  footer: LedgerFooter
  archivedCols?: ArchivedCol[]   // 归档列(spec §2):本月有钱但模板不渲染的自定义列,追加成只读列
}

// PUT save body (spec §4.2): derived columns omitted, backend recomputes.
export interface LedgerSaveRow extends LedgerFees {
  id?: number | null        // 既有行身份(未绑定行必带;绑定行可省走 tenantId)
  tenantId: number | null
  tenantName?: string       // 提供即改账面名快照(未绑定行改名后后端自动按新名配档)
  balancePrev: number
  totalCollected: number
  note: string | null
  extraFees?: Record<string, number | null> | null  // 非空=整包替换;缺省=不动
}

// 行稳定键:服务端行用 id;无 id 的行(编辑态新增/结转虚行)用 -tenantId 负数命名空间;
// 未绑定结转虚行(id/tenantId 双空)按账面名散列进更深的负数段,同表内稳定唯一
const nameKey = (s: string): number => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return -1_000_000_000 - Math.abs(h % 900_000_000)
}
export const ledgerRowKey = (r: { id?: number | null; tenantId?: number | null; tenantName?: string }): number =>
  r.id ?? (r.tenantId != null ? -r.tenantId : nameKey(r.tenantName ?? ''))

/** 保存包的身份三件套。**未绑定的结转虚行 id 与 tenantId 双空,只能靠账面名认领** ——
 *  漏掉 tenantName 后端会以「台账行缺少身份」把整包拒收(2026-08-27 线上撞到:
 *  导入落下未绑定行 → 下月显示成结转虚行 → 进编辑态保存即炸)。
 *  与 ledgerRowKey 同源:那边也是 id → tenantId → 账面名 三级取身份。 */
export const saveRowIdentity = (r: { id?: number | null; tenantId?: number | null; tenantName?: string }) => ({
  id: r.id ?? undefined,
  tenantId: r.tenantId ?? null,
  tenantName: r.tenantName,
})

/** 导入前的「会覆盖几家」计数。**结转虚行不算**:它是读层为显示合成的行,库里没有数据,
 *  算进去会让任何上月有余额的户都触发覆盖确认 —— 每次导入都弹,弹到没人看(2026-08-27 线上撞到)。 */
export const overwriteTargets = (
  rows: { tenantName: string; carried?: boolean }[],
  incoming: (string | null | undefined)[],
): number => {
  const stored = new Set(rows.filter(r => !r.carried).map(r => r.tenantName))
  return new Set(incoming.map(n => String(n ?? '').trim()).filter(n => n !== '' && stored.has(n))).size
}

export interface BindResultDTO { bound: number; conflicts: number }

export interface LedgerSaveRequest {
  rows: LedgerSaveRow[]
}

// 导入 body:tenantName(按名解析 FK)+ 文件里出现的列。列级定向 upsert:
// 字段缺省(文件没这列)= 不动既有值;为 0(文件里是 '-')= 显式清零。
export interface LedgerImportRow extends Partial<LedgerFees> {
  tenantName: string
  balancePrev?: number
  totalCollected?: number
  note?: string
  extraFees?: Record<string, number | null>   // 自定义列:按键合并(键出现=覆盖含0;缺席=不动)
}

export interface LedgerImportRequest {
  rows: LedgerImportRow[]
}
