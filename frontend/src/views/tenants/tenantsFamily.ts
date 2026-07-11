// 家族聚合排序(spec §T2):租户列表默认视图(sort=null)专用。
// 口径:族键=根名(子取 parentName,root 取自身名);族间按名称 zh 序;族内 root 在前、子按名称 zh 序。
// 父被过滤/parentName 悬空时子仍按族键落位(单独成"族"),不崩。
export interface FamilySortRow {
  companyName: string
  parentName: string | null
}

export function familySort<T extends FamilySortRow>(rows: T[]): T[] {
  const famKey = (t: T) => t.parentName ?? t.companyName
  return [...rows].sort((a, b) => {
    const k = famKey(a).localeCompare(famKey(b), 'zh-Hans-CN')
    if (k !== 0) return k
    // 同族:root(parentName 空)在前,子按名称
    const ca = a.parentName != null ? 1 : 0
    const cb = b.parentName != null ? 1 : 0
    if (ca !== cb) return ca - cb
    return a.companyName.localeCompare(b.companyName, 'zh-Hans-CN')
  })
}
