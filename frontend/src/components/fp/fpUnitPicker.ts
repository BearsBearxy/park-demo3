// FPUnitPicker 纯逻辑(S15 §2):全楼栋分组候选 + 有序多选(首个=主单元) + chips 回填
export interface FPUnitOption {
  id: number
  buildingId: number
  buildingName: string
  floor: number
  unitNo: string
  area?: number | null
  status?: string | null   // 'vacant' 等;非 vacant 显「非空置」
}
export interface FPUnitGroup { buildingId: number; buildingName: string; units: FPUnitOption[] }
export interface FPUnitChip { id: number; label: string; missing: boolean }

// 归一化同 fpTenantPicker:剔全/半角括号·空白+小写
const norm = (s: string): string => s.toLowerCase().replace(/[()（）[\]【】\s]/g, '')

export const unitLabel = (u: FPUnitOption): string => `${u.buildingName} ${u.floor}F-${u.unitNo}`

// q 归一化后匹配整 label(栋名/楼层F/单元号任一子串命中);分组保持传入序,空组不出
export function groupUnits(list: FPUnitOption[], q: string): FPUnitGroup[] {
  const kw = norm(q)
  const groups: FPUnitGroup[] = []
  for (const u of list) {
    if (kw && !norm(unitLabel(u)).includes(kw)) continue
    let g = groups.find((x) => x.buildingId === u.buildingId)
    if (!g) { g = { buildingId: u.buildingId, buildingName: u.buildingName, units: [] }; groups.push(g) }
    g.units.push(u)
  }
  return groups
}

// 勾选切换(返回新数组):新勾追加尾部——首个自然为主;剔主后次个补位
export function toggleUnit(sel: number[], id: number): number[] {
  return sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
}

// 换主:提到首位;未选中原样返回
export function makePrimary(sel: number[], id: number): number[] {
  return sel.includes(id) ? [id, ...sel.filter((x) => x !== id)] : sel
}

// chips:每个已选 id 必出 chip——候选缺档(单元已删/脏数据/候选未加载)也可见,修「隐形 id 炸弹」
export function unitChips(sel: number[], list: FPUnitOption[]): FPUnitChip[] {
  return sel.map((id) => {
    const u = list.find((x) => x.id === id)
    return u ? { id, label: unitLabel(u), missing: false } : { id, label: `#${id} 未知单元`, missing: true }
  })
}
