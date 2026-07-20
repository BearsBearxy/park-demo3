// 账单 Excel 导出(BILLS-SPEC 2026-07-16):应收账单口径,数据源=附表10;
// 成员=租户主数据家族(root+children,非台账行)——户数与向几个公司主体交钱无关。
// 工资条=转置版式:行=费用项,列=成员(禁「成员行×费用列」宽表,曾 13+ 列横滚被否决)。
// 家族/工资条/AOA 均为纯函数(billExcel.spec.ts 锁定);xlsx/fflate 懒加载,仅点导出才拉。
// 费用中文名单一事实源=sales-income/layout.ts leaves,禁手抄。
import type { BillS10RowDTO } from '../api/bills'
import type { TenantDTO } from '../types/tenant'
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
const S10_KEYS = [...S10_FEE_LABELS.keys()]

// ponytail: 催缴期限先做全局常量,日后若按合同差异化再参数化
export const BILL_DUE_DAYS = 10
export const BILL_DUE_NOTE = `请于收到账单后 ${BILL_DUE_DAYS} 日内缴清，逾期将按合同约定处理`
// 转账指引(BILLS-SPEC §5):账单底部不再只有催缴语
export const BILL_TRANSFER_NOTE = '请按上表各费用项目对应公司转账'

// 收款公司指引 lookup(BILLS-SPEC §5):tenantId × feeKey(附表10 colId) → 公司全名;null=未设置。
// 映射数据(bill_pay_company)由页面拉取缓存,导出/打印以函数注入保持纯函数可测。
export type PayCoLookup = (tenantId: number | null, feeKey: S10ColId) => string | null

export interface BillMember {
  tenantId: number | null   // null = 未关联租户档案的独立户
  tenantName: string
  child: boolean            // 子租户 → └ 缩进
  missing: boolean          // 该期无附表10记录(催收方要看得见谁缺数,BILLS-SPEC §2)
  fees: Partial<Record<S10ColId, number>>   // 一成员多 s10 行(跨期数/profile)按费用项求和
  total: number             // = Σ fees
}

export interface BillFamily {
  rootName: string
  unlinked: boolean         // 附表10 行匹配不到任何租户档案 → 按 tenantName 独立成户
  members: BillMember[]     // root 前、子按名称 zh 序;含无附表10记录的成员
  totalReceivable: number   // 附表10 合计 = Σ 成员 total
}

/** 家族构建(纯函数,BILLS-SPEC §2):骨架来自租户主数据(root=parentId空,子挂 parentId),
 *  s10 行匹配 tenantId 优先/tenantName 全等兜底;匹配不到档案的行按 tenantName 独立成户。
 *  只返回本期有附表10数据的家族(含未关联独立户),默认应收降序——本期应收 100% 覆盖附表10,不丢行。 */
export function buildFamilies(tenants: TenantDTO[], s10Rows: BillS10RowDTO[]): BillFamily[] {
  const byId = new Map<number, TenantDTO>()
  for (const t of tenants) byId.set(t.id, t)

  // 家族骨架:rootId → 成员列表(root 在前,子按 zh 序);parentId 悬空的子自立门户
  const rootsOrder: TenantDTO[] = []
  const childrenOf = new Map<number, TenantDTO[]>()
  for (const t of tenants) {
    if (t.parentId != null && byId.has(t.parentId)) {
      const arr = childrenOf.get(t.parentId)
      if (arr) arr.push(t)
      else childrenOf.set(t.parentId, [t])
    } else rootsOrder.push(t)
  }

  const mkMember = (t: TenantDTO, child: boolean): BillMember =>
    ({ tenantId: t.id, tenantName: t.companyName, child, missing: true, fees: {}, total: 0 })
  const famOf = rootsOrder.map(root => ({
    rootName: root.companyName,
    members: [
      mkMember(root, false),
      ...(childrenOf.get(root.id) ?? [])
        .sort((a, b) => a.companyName.localeCompare(b.companyName, 'zh-Hans-CN'))
        .map(t => mkMember(t, true)),
    ],
  }))

  // 成员索引:tenantId 优先,tenantName 全等兜底(同名档案先入为主)
  const memberById = new Map<number, BillMember>()
  const memberByName = new Map<string, BillMember>()
  for (const f of famOf) for (const m of f.members) {
    memberById.set(m.tenantId!, m)
    if (!memberByName.has(m.tenantName)) memberByName.set(m.tenantName, m)
  }

  // s10 行落位:命中成员按费用项累加;未命中 → 按 tenantName 独立成户
  const unlinked = new Map<string, BillMember>()
  for (const r of s10Rows) {
    let m = (r.tenantId != null ? memberById.get(r.tenantId) : undefined) ?? memberByName.get(r.tenantName)
    if (!m) {
      m = unlinked.get(r.tenantName)
      if (!m) {
        m = { tenantId: null, tenantName: r.tenantName, child: false, missing: false, fees: {}, total: 0 }
        unlinked.set(r.tenantName, m)
      }
    }
    m.missing = false
    for (const k of S10_KEYS) m.fees[k] = (m.fees[k] ?? 0) + Number(r[k] ?? 0)
  }

  const withTotals = (rootName: string, isUnlinked: boolean, members: BillMember[]): BillFamily => {
    for (const m of members) m.total = S10_KEYS.reduce((s, k) => s + (m.fees[k] ?? 0), 0)
    return { rootName, unlinked: isUnlinked, members, totalReceivable: members.reduce((s, m) => s + m.total, 0) }
  }
  return [
    // 外层列表=有本期 s10 数据的家族;家族只要任一成员命中即整族入列(缺数成员照常出现)
    ...famOf.filter(f => f.members.some(m => !m.missing)).map(f => withTotals(f.rootName, false, f.members)),
    ...[...unlinked.values()].map(m => withTotals(m.tenantName, true, [m])),
  ].sort((a, b) => b.totalReceivable - a.totalReceivable)
}

// ─── 工资条(转置版式,BILLS-SPEC §4):行=费用项,列=成员+合计 ────────
export interface PayslipTable {
  members: BillMember[]     // 列序 = fam.members(root 前子后)
  rows: { key: S10ColId; label: string; values: number[]; total: number }[]   // 家族非零费用项(office 叶序)
  memberTotals: number[]    // 末行:各成员列合计,与 members 对齐
  grandTotal: number        // = 附表10 应收合计
}

/** 工资条构建(纯函数):费用项行=家族内非零项;missing 成员值全 0(呈现层画「—」)。 */
export function buildPayslip(fam: BillFamily): PayslipTable {
  const rows = S10_KEYS
    .filter(k => fam.members.some(m => (m.fees[k] ?? 0) !== 0))
    .map(k => {
      const values = fam.members.map(m => m.fees[k] ?? 0)
      return { key: k, label: S10_FEE_LABELS.get(k)!, values, total: values.reduce((a, b) => a + b, 0) }
    })
  return {
    members: fam.members,
    rows,
    memberTotals: fam.members.map(m => m.total),
    grandTotal: fam.totalReceivable,
  }
}

// ─── 账单条 AOA 与导出 ────────────────────────────────────
type Cell = string | number

/** 成员列头(xlsx 与打印同构复用):子户 └ 缩进,缺数成员标注。 */
export function billMemberHead(m: BillMember): string {
  const name = m.child ? `└ ${m.tenantName}` : m.tenantName
  return m.missing ? `${name}（无附表10记录）` : name
}

/** 「转入公司」格(xlsx 与打印同构复用,BILLS-SPEC §5):missing 成员随金额画「—」;
 *  零金额格留白;非零无映射=「未设置」兜底(含 tenantId 空的未关联户)。 */
export function billPayCoCell(m: BillMember, k: S10ColId, v: number, payCo: PayCoLookup): string {
  return m.missing ? '—' : v === 0 ? '' : payCo(m.tenantId, k) ?? '未设置'
}

/** 单户账单条 AOA(纯函数):标题 → 转置工资条表(每成员金额列右侧「转入公司」列) → 应收合计
 *  → 转账指引 + 催缴语(BILLS-SPEC §5/§6)。无台账实收/结余;missing 成员整列画「—」,列头带「无附表10记录」。 */
export function buildBillAoa(fam: BillFamily, year: number, month: number, payCo: PayCoLookup): Cell[][] {
  const ps = buildPayslip(fam)
  const aoa: Cell[][] = [
    ['园区租户账单'],
    ['期间', `${year}年${month}月`],
    ['户名', ps.members.length > 1 ? `${fam.rootName}（家族 ${ps.members.length} 户）` : fam.rootName],
    [],
    ['费用项', ...ps.members.flatMap(m => [billMemberHead(m), '转入公司']), '合计'],
  ]
  const cell = (m: BillMember, v: number): Cell => (m.missing ? '—' : v)
  for (const r of ps.rows)
    aoa.push([r.label, ...r.values.flatMap((v, i) => [cell(ps.members[i], v), billPayCoCell(ps.members[i], r.key, v, payCo)]), r.total])
  aoa.push(
    // 合计行「转入公司」列留白(公司按费用项行标注,合计不重复)
    ['合计', ...ps.memberTotals.flatMap((t, i) => [cell(ps.members[i], t), '' as Cell]), ps.grandTotal],
    [],
    ['附表10应收合计', ps.grandTotal],
    [],
    [BILL_TRANSFER_NOTE],
    [BILL_DUE_NOTE],
  )
  return aoa
}

/** 文件名 sanitize + 定名:账单-YYYY年MM月-户名.xlsx。 */
export function billFileName(year: number, month: number, rootName: string): string {
  const safe = rootName.replace(/[\\/:*?"<>|]/g, '') || '账单'
  return `账单-${year}年${String(month).padStart(2, '0')}月-${safe}.xlsx`
}

// 单户 workbook → xlsx 字节(批量与单户共用版式)
async function billXlsxBytes(fam: BillFamily, year: number, month: number, payCo: PayCoLookup): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildBillAoa(fam, year, month, payCo)), `${year}年${month}月`)
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** 抽屉内「导出账单」:单户 xlsx 直接下载。 */
export async function exportBillFile(fam: BillFamily, year: number, month: number, payCo: PayCoLookup): Promise<void> {
  const bytes = await billXlsxBytes(fam, year, month, payCo)
  downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    billFileName(year, month, fam.rootName))
}

/** 批量导出:一户一独立 xlsx,fflate zip 打包(136 户逐个触发下载会被浏览器拦截)。 */
export async function exportBillsZip(families: BillFamily[], year: number, month: number, payCo: PayCoLookup): Promise<void> {
  if (!families.length) return
  const { zipSync } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  for (const fam of families) {
    let name = billFileName(year, month, fam.rootName)
    // sanitize 后撞名兜底(如「甲/乙」与「甲乙」)
    for (let i = 2; files[name]; i++) name = billFileName(year, month, `${fam.rootName}~${i}`)
    files[name] = await billXlsxBytes(fam, year, month, payCo)
  }
  // ponytail: level 0 存储——xlsx 本身已是 deflate 压缩包,再压白耗 CPU
  const zipped = zipSync(files, { level: 0 })
  downloadBlob(new Blob([zipped], { type: 'application/zip' }), `账单-${year}年${String(month).padStart(2, '0')}月.zip`)
}
