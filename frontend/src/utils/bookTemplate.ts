// 模板(BookDef) → 现有列结构的映射 + extra_fees 口袋列平铺/收回(BOOK-WORKBENCH-SPEC §1/§3)。
// 目标形状:台账 = ledgerColumns.ts 的 ColumnModel;附表10 = sales-income/layout.ts 的 Group/Leaf。
import type { BookDef } from '../types/book'
import { customColIds } from '../types/book'
import type { ColumnModel, ColumnGroup, ColumnKey, LeafColumn } from './ledgerColumns'
import type { Group, Leaf } from '../views/sales-income/layout'
import type { S10ColId } from '../types/s10'

/** 自定义列 id 全集(含 hidden——合计口径含隐藏列,与后端 ExtraFees.sum 全口袋一致)。 */
export const extraColIds = customColIds

const DEFAULT_W = 96

/** 归档列:该月有钱但模板不渲染的自定义列(spec §2)。只读,不接受录入。 */
export interface ArchivedCol { id: string; label: string }

/**
 * 模板 → 台账 ColumnModel。费用列来自 def.groups(hidden 跳过,整组隐藏则丢组);
 * fixedLeft(tenantName/balancePrev)与 fixedRight(totalReceivable/totalCollected/balanceEnd/note)
 * 不在模板里,照抄 lgColumns 现状。组名中的 MON 占位替换为 `${prev}月`(与 layout.ts 约定一致)。
 */
export function toLedgerColumns(def: BookDef, prev: number, archived: ArchivedCol[] = []): ColumnModel {
  const groups: ColumnGroup[] = []
  for (const g of def.groups) {
    const cols: LeafColumn[] = g.cols.filter(c => !c.hidden).map(c => ({
      // 自定义列 c_xxx 不在 ColumnKey 联合内;宽表按字符串 key 取值,运行时安全
      key: c.id as ColumnKey,
      label: c.label,
      w: c.w ?? DEFAULT_W,
    }))
    if (cols.length === 0) continue
    groups.push({ name: (g.label ?? '').replace('MON', prev + '月'), cols })
  }
  // hidden 的语义是「不再接受新录入」,不是「藏起已经发生的钱」——
  // 藏起来会让屏上的应收合计永远对不上明细(recalc 全口袋照加,见 spec §2)
  if (archived.length) {
    groups.push({
      name: '已归档',
      cols: archived.map(a => ({ key: a.id as ColumnKey, label: a.label, w: DEFAULT_W, readonly: true })),
    })
  }
  return {
    fixedLeft: [
      { key: 'tenantName', label: '租户', w: 132, kind: 'text' },
      { key: 'balancePrev', label: prev + '月结余', w: 104, kind: 'num' },
    ],
    groups,
    fixedRight: [
      { key: 'totalReceivable', label: '本月应收合计', w: 116, kind: 'sum' },
      { key: 'totalCollected', label: '本月收款', w: 104, kind: 'num' },
      { key: 'balanceEnd', label: '本月结余', w: 104, kind: 'bal' },
      { key: 'note', label: '备注', w: 150, kind: 'note' },
    ],
  }
}

/**
 * 模板 → 附表10 Group[]。hidden 跳过,整组隐藏则丢组;label 为 null → 不带 label 键
 * (= layout.ts「无一级表头直通列」写法);elec/water 表头着色由语义槽推导(整组同槽才标);
 * MON 占位由 S10Table 渲染时自行替换,此处保留原样。
 */
export function toS10Layout(def: BookDef): Group[] {
  const out: Group[] = []
  for (const g of def.groups) {
    const visible = g.cols.filter(c => !c.hidden)
    if (visible.length === 0) continue
    const leaves: Leaf[] = visible.map(c => ({
      colId: c.id as S10ColId, // 同上:自定义列越出联合,运行时按字符串取值
      label: c.label,
      ...(c.aliases.length ? { aliases: c.aliases } : {}),
    }))
    // S10Table 把无 label 组按「单叶直通列」渲染(rowspan=2 只画 leaves[0]):
    // 无 label 多叶组会整表错列——拆成每叶一个直通组(审查#19)
    if (g.label == null && leaves.length > 1) {
      for (const l of leaves) out.push({ leaves: [l] })
      continue
    }
    const grp: Group = { leaves }
    if (g.label != null) grp.label = g.label
    if (visible.every(c => c.slot === 'elec')) grp.elec = true
    if (visible.every(c => c.slot === 'water')) grp.water = true
    out.push(grp)
  }
  return out
}

/**
 * extra_fees 口袋平铺进行顶层(c_xxx),返回新对象——表格组件直接按列 key 取值。
 * extraFees 原字段保留但平铺后不再是事实源(编辑改顶层字段,保存走 extractExtras)。
 */
export function mergeExtras<T extends object>(row: T): T {
  const extras = (row as { extraFees?: Record<string, number | null> | null }).extraFees
  if (!extras) return { ...row }
  const flat = { ...row } as Record<string, unknown>
  // 只平铺 c_ 键:畸形口袋里混进物理字段同名键(如 totalCollected)不得覆盖行字段(审查#11)
  for (const [k, v] of Object.entries(extras)) if (k.startsWith('c_')) flat[k] = v
  return flat as T
}

/** 从平铺行收回口袋(保存请求用)。customIds 全键输出;缺失/空串/非数 → null。 */
export function extractExtras(row: Record<string, unknown>, customIds: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const id of customIds) {
    const v = row[id]
    const n = v == null || v === '' ? NaN : Number(v)
    out[id] = Number.isFinite(n) ? n : null
  }
  return out
}
