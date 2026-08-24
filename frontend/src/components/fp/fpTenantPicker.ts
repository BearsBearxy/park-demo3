// FPTenantPicker 纯逻辑:候选过滤+排序(spec §T3)
export interface FPTenantOption {
  id: number
  name: string
  phase?: number | null       // 1一期 2二期 3三期 4宿舍,无则不显徽章
  parentName?: string | null  // 子租户显示「关联:<parentName>」
}

// 匹配前归一化:剔除全/半角括号·空白+转小写——库内子租户名多为「广联（宿舍）」全角括号,
// 用户手输「广联宿舍」必须命中(2026-07-11 用户实测报障)
const norm = (s: string): string => s.toLowerCase().replace(/[()（）[\]【】\s]/g, '')

// q 空→全量;否则 归一化后 name 含 q;结果一律按 name zh 升序
export function filterTenants(list: FPTenantOption[], q: string): FPTenantOption[] {
  const kw = norm(q)
  const hits = kw ? list.filter((t) => norm(t.name).includes(kw)) : [...list]
  return hits.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

// 绑定场景的候选构造(台账/附表10 行级绑定 + 问题面板共用):
// 全部档案入选(退租户也算——账期当时可能在租),非在租(status≠1;2退租/3黑名单)名字后缀标注
export function toBindOptions(
  ts: { id: number; companyName: string; status?: number; phase?: number | null; parentName?: string | null }[],
): FPTenantOption[] {
  return ts.map(t => ({
    id: t.id,
    name: t.status != null && t.status !== 1 ? `${t.companyName}(已退租)` : t.companyName,
    phase: t.phase ?? null,
    parentName: t.parentName ?? null,
  }))
}
