// src/analysis/anaFamily.ts — 租户家族(parent_id 关联)分析层汇总地基(spec 2026-07-11 方案A)。
// 底层数据不动:台账/s10 仍按子租户独立记账;此处仅提供「名称 → 家族根名」映射供各屏按需聚合。
// V31 已把链拍平(parent 一律指根),故 parentName 即根名,无需递归。
export function buildFamilyMap(
  tenants: { companyName: string; parentName: string | null }[],
): Map<string, string> {
  const m = new Map<string, string>()
  for (const t of tenants) m.set(t.companyName, t.parentName ?? t.companyName)
  return m
}

/** 行名 → 家族根名;不在主数据(台账历史租户已删等)→ 原名自成一族。 */
export const familyRootOf = (map: Map<string, string>, name: string): string => map.get(name) ?? name
