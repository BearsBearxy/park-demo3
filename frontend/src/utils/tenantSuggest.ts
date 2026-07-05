// 台账导入预检:未登记租户名 → 推荐关联的主租户(纯函数,供 LedgerImportResolveDialog 与单测)。
// 规则:候选 = 库中租户 t 满足 t.companyName.length>=2 且 name 以 t.companyName 开头且严格更长
//      (如「王柱宿舍」命中「王柱」);多个命中取 companyName 最长者;子租户(parentId 非空)不作候选(仅一级关联)。
export function suggestParent(
  name: string,
  tenants: { id: number; companyName: string; parentId?: number | null }[],
): { id: number; companyName: string } | null {
  let best: { id: number; companyName: string } | null = null
  for (const t of tenants) {
    if (t.parentId != null) continue
    if (t.companyName.length < 2) continue
    if (!name.startsWith(t.companyName) || name.length <= t.companyName.length) continue
    if (!best || t.companyName.length > best.companyName.length) best = { id: t.id, companyName: t.companyName }
  }
  return best
}

// 剥常见场所后缀(「王柱宿舍」→「王柱」),供展示提示用;不命中原样返回。
const KNOWN_SUFFIXES = ['宿舍', '商铺', '厂房', '仓库', '车间', '办公室', '门面']
export function stripKnownSuffix(name: string): string {
  for (const s of KNOWN_SUFFIXES) {
    if (name.endsWith(s) && name.length > s.length) return name.slice(0, name.length - s.length)
  }
  return name
}
