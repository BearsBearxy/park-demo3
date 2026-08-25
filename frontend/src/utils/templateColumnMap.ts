// 模板 → 导入匹配词典(BOOK-WORKBENCH-SPEC §4)。
// 匹配词典 = 现行版模板的 显示名+别名,标准列与自定义列同权;hidden 列也进词典 ——
// 导入命中隐藏列时要提示(§3),绝不能因为宽表不显示就认不出它。
//
// 键做 normalizeHeader 归一(去空格/常见标点):导入匹配全线走归一比较,
// 冲突也只在归一层面真实发生(「厂房租金」vs「厂房 租金」宽表里是两个名字,匹配时是同一个)。
import type { BookDef } from '@/types/book'
import { flattenCols } from '@/types/book'
import { normalizeHeader } from '@/utils/importHeaderMatch'

export interface ColumnMapBuild {
  /** normalizeHeader(显示名|别名) → col.id */
  map: Record<string, string>
  /** 同一个导入名指向多列:先到先得(列序靠前者赢),这里逐条记告警供落导入 notices */
  warnings: string[]
}

export function buildColumnMap(def: BookDef): ColumnMapBuild {
  const map: Record<string, string> = {}
  const owner: Record<string, string> = {}   // 归一名 → 先到列的显示名(告警文案用)
  const warnings: string[] = []
  for (const col of flattenCols(def)) {
    for (const name of [col.label, ...col.aliases]) {
      const key = normalizeHeader(name)
      if (!key) continue
      if (key in map) {
        if (map[key] !== col.id) {
          warnings.push(`导入名「${name}」同时挂在「${owner[key]}」与「${col.label}」,按先到先得归「${owner[key]}」`)
        }
        continue // 同列 label/alias 归一后撞车(如「租金」与「租 金」)不算冲突,静默去重
      }
      map[key] = col.id
      owner[key] = col.label
    }
  }
  return { map, warnings }
}
