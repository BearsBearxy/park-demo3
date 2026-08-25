// 导入列映射决策 → 模板定义合成(BOOK-WORKBENCH §4)。纯函数,LedgerView 在 apply 后
// 用返回的 def 调一次 booksApi.saveTemplate 持久化。
//   map    = 表头追进目标列 aliases(轻改动;表头等于列显示名或已在别名里则不动)
//   create = 追加自定义列到「自定义」组(无则建组;结构改动升版);用户改了显示名时
//            原表头留作别名,否则重解析对不上这一列
//   ignore = 收进 ignore 清单(模板不动,导入按忽略处理)
import type { BookDef } from '@/types/book'
import { flattenCols, newCustomColId } from '@/types/book'
import type { ColDecision } from '@/components/fp/ColumnMapPanel.vue'

export interface MapDecisionResult {
  def: BookDef        // 合成后的定义(changed=false 时与入参定义内容一致)
  ignore: string[]    // 显式忽略的表头
  changed: boolean    // 是否需要 saveTemplate(全忽略=false,跳过持久化)
}

export function applyColDecisions(definition: BookDef, decisions: ColDecision[]): MapDecisionResult {
  const ignore = decisions.filter(d => d.action === 'ignore').map(d => d.header)
  const changes = decisions.filter(d => d.action !== 'ignore')
  if (!changes.length) return { def: definition, ignore, changed: false }

  const def = JSON.parse(JSON.stringify(definition)) as BookDef
  const byId = new Map(flattenCols(def).map(c => [c.id, c]))
  const existing = new Set(byId.keys())
  let changed = false
  for (const d of changes) {
    if (d.action === 'map') {
      const col = d.targetColId ? byId.get(d.targetColId) : undefined
      if (col && d.header !== col.label && !col.aliases.includes(d.header)) {
        col.aliases.push(d.header)
        changed = true
      }
    } else {
      let g = def.groups.find(x => x.id === 'g_custom')
      if (!g) { g = { id: 'g_custom', label: '自定义', cols: [] }; def.groups.push(g) }
      const id = newCustomColId(existing)
      existing.add(id)
      const label = (d.newLabel ?? d.header).trim() || d.header
      g.cols.push({ id, std: false, label, aliases: label !== d.header ? [d.header] : [], slot: 'other', hidden: false, w: null })
      changed = true
    }
  }
  return { def, ignore, changed }
}
