// 按比例出列(datagrid.prompt.md「按比例出列」定稿·待实现,画布 04-C;实现规范 §1.9)。
// 尖峰平谷只对分时表有意义:看这张表里有分时读数的表占多少 ——
//   没有 → 'none':不出列,也不出开关(04-C 宿舍 0/299)
//   少数 → 'row' :默认不出列,那一行点开看或录(04-C 一期 49/184)
//   过半 → 'cols':默认出列(04-C 二期 63/69)
// 开关记住上次选择(2026-09-29 拍板,公共电核算同一套)。公共电核算、园区抄表两屏共用。
export type TouMode = 'none' | 'row' | 'cols'

export function touMode(touCount: number, total: number): TouMode {
  if (touCount <= 0) return 'none'
  return touCount * 2 > total ? 'cols' : 'row'   // 恰好一半不算过半
}

// 记忆按屏分开(key='pool' / 'meter'),存 '1' / '0';没存过 = null。
// localStorage 在隐私模式 / 禁用站点数据时会抛,读写都包 try/catch —— 存不下就只在本次会话生效。
const lsKey = (key: string) => `fp-tou-${key}`

export function loadTouPref(key: string): boolean | null {
  try {
    const v = localStorage.getItem(lsKey(key))
    return v === '1' ? true : v === '0' ? false : null
  } catch { return null }
}

export function saveTouPref(key: string, on: boolean): void {
  try { localStorage.setItem(lsKey(key), on ? '1' : '0') } catch { /* 存不下就只在本次会话生效 */ }
}

// 开关此刻该不该开:'none' 恒关(没有开关);否则上次选择优先,没选过按比例(过半开、少数关)。
export function touColsOn(mode: TouMode, key: string): boolean {
  if (mode === 'none') return false
  return loadTouPref(key) ?? mode === 'cols'
}
