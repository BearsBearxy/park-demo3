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
