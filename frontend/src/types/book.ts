// 账册与模板契约(BOOK-WORKBENCH-SPEC §1/§3/§6)。与后端 TemplateDef/BookDtos 1:1。

/** 语义槽(§6):代码常量,用户不可增删;分析层只消费槽与派生合计。 */
export const BOOK_SLOTS = ['rent', 'mgmt', 'infra', 'common', 'misc', 'elec', 'water', 'other'] as const
export type BookSlot = typeof BOOK_SLOTS[number]

export const SLOT_LABELS: Record<BookSlot, string> = {
  rent: '租金', mgmt: '管理服务费', infra: '基础设施', common: '公共设施',
  misc: '杂项', elec: '电费', water: '水费', other: '其他',
}

export interface BookCol {
  id: string          // 标准列=后端字段名;自定义列=c_xxx(建列即定,永不改)
  std: boolean        // 标准列不可删(§3)
  label: string       // 显示名(轻改动)
  aliases: string[]   // 导入匹配别名(轻改动)
  slot: BookSlot
  hidden: boolean     // 结构改动
  w?: number | null   // 列宽 px(轻改动)
}

export interface BookGroup {
  id: string
  label: string | null   // null = 无一级表头(单列直通)
  cols: BookCol[]
}

export interface BookDef { groups: BookGroup[] }

/** 归档列(spec §2):该月有钱、但本月生效模板不渲染(缺席或 hidden)的自定义列。
 *  后端在月度 DTO 里下发,前端追加成只读列——藏起来会让屏上合计永远对不上明细。 */
export interface ArchivedCol { id: string; label: string }

export interface Book {
  id: number
  screen: 'ledger' | 's10'
  companyId: number | null   // ledger 屏:所属公司
  phase: number | null       // s10 屏:期区 1-4
  name: string
  ver: number                // 现行版本号
  latestVer: number          // 全局链链尾版本号(§R5:ver < latestVer 即有新版可升)
  definition: BookDef        // 现行版定义(§3:现行版全局生效)
}

export interface TemplateSaveResult {
  book: Book
  structural: boolean        // true=本次升了版本
  changeSummary: string
}

export interface TemplateVersion {
  id: number
  ver: number
  note: string | null
  createdBy: string
  createdAt: string
  current: boolean
}

/** 展平列(跳过 hidden 由调用方决定)。 */
export function flattenCols(def: BookDef): BookCol[] {
  return def.groups.flatMap(g => g.cols)
}

export function customColIds(def: BookDef): string[] {
  return flattenCols(def).filter(c => !c.std).map(c => c.id)
}

/** 新自定义列 id:c_ + 时间戳36进制(建列即定,永不因改名而变)。 */
export function newCustomColId(existing: Set<string>): string {
  let id = 'c_' + Date.now().toString(36)
  let n = 0
  while (existing.has(id)) id = 'c_' + Date.now().toString(36) + (++n)
  return id
}
