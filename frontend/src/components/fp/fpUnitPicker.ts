// FPUnitPicker 纯逻辑(S15 §2):全楼栋分组候选 + 有序多选(首个=主单元) + chips 回填
export interface FPUnitOption {
  id: number
  buildingId: number
  buildingName: string
  floor: number
  unitNo: string
  area?: number | null
  status?: string | null   // 'vacant' 等;非 vacant 显「非空置」
  phase?: number | null    // 楼栋期区(4=宿舍栋),标的面积预填分路用
}
export interface FPUnitGroup { buildingId: number; buildingName: string; units: FPUnitOption[] }
export interface FPUnitChip { id: number; label: string; missing: boolean }

// 归一化同 fpTenantPicker:剔全/半角括号·空白+小写
const norm = (s: string): string => s.toLowerCase().replace(/[()（）[\]【】\s]/g, '')

export const unitLabel = (u: FPUnitOption): string => `${u.buildingName} ${u.floor}F-${u.unitNo}`
// 面积尾注(chips用):area>0 才显;0/空=档案未录不显。unitLabel 保持纯净供搜索归一化匹配
export const areaSuffix = (u: FPUnitOption): string => ((u.area ?? 0) > 0 ? ` · ${u.area}㎡` : '')

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
    return u ? { id, label: unitLabel(u) + areaSuffix(u), missing: false } : { id, label: `#${id} 未知单元`, missing: true }
  })
}

// ─── 标的面积预填(a方案联动半,ContractNewDialog 消费) ──────────────────────
export const DORM_PHASE = 4
export interface FPAreaSums { dorm: number | null; nonDorm: number | null }

// 选中单元面积Σ按宿舍(phase=4)/非宿舍分桶;仅计 area>0;某桶无贡献=null(不触发预填)
export function selectedAreaSums(sel: number[], list: FPUnitOption[]): FPAreaSums {
  let dorm: number | null = null
  let nonDorm: number | null = null
  for (const id of sel) {
    const u = list.find((x) => x.id === id)
    if (!u || !((u.area ?? 0) > 0)) continue
    if (u.phase === DORM_PHASE) dorm = (dorm ?? 0) + u.area!
    else nonDorm = (nonDorm ?? 0) + u.area!
  }
  const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100)
  return { dorm: r2(dorm), nonDorm: r2(nonDorm) }
}

// 租金行面积预填值:面积格空或0才填(用户已填的值绝不覆盖);宿舍行走宿舍桶,
// 厂房/办公/商铺走非宿舍桶;其余费项/空地不填。返回 null=不动
export function prefillRentArea(feeKey: string, current: number | null | undefined, sums: FPAreaSums): number | null {
  if (typeof current === 'number' && !Number.isNaN(current) && current !== 0) return null
  if (feeKey === 'rent_dorm') return sums.dorm
  if (feeKey === 'rent_factory' || feeKey === 'rent_office' || feeKey === 'rent_shop') return sums.nonDorm
  return null
}
