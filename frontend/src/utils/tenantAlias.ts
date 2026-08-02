// 租户匹配名集合 = 正名 + 别名(V86,逗号/中文逗号分隔,去空白去重)。
// 园区财务 worksheet 常用老板个人名(如「李富全」=鑫皇),导入/挂号按名匹配时别名与正名同权;
// 多租户共用同一别名时,各匹配点的「唯一命中才挂」护栏自动落待核。镜像后端 TenantService.matchNames。
export function tenantMatchNames(t: { companyName: string; aliases?: string | null }): string[] {
  const names = [t.companyName]
  for (const a of (t.aliases ?? '').split(/[,，]/)) {
    const s = a.trim()
    if (s && !names.includes(s)) names.push(s)
  }
  return names
}
