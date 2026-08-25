// 选期矩阵手工年(BOOK-WORKBENCH-SPEC §5 v3,2026-08-24 拍板):
// 年份范围 = 数据年 ∪ 当前自然年 ∪ 手工年,连续补满;手工年按 屏+册 记在本机
// (localStorage,沿旧年份门机制),录入数据即转正;数据年不可移除。
// 纯函数 + 两个薄存取,不发请求;矩阵渲染与增删入口在 BookMonthMatrix。

const key = (screen: string, bookKey: number | string) => `bw-extra-years:${screen}:${bookKey}`

export function loadExtraYears(screen: string, bookKey: number | string): number[] {
  try {
    const raw = localStorage.getItem(key(screen, bookKey))
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((y): y is number => Number.isInteger(y)) : []
  } catch {
    return []
  }
}

export function saveExtraYears(screen: string, bookKey: number | string, years: number[]): void {
  try {
    if (years.length) localStorage.setItem(key(screen, bookKey), JSON.stringify([...new Set(years)].sort()))
    else localStorage.removeItem(key(screen, bookKey))
  } catch { /* 隐私模式等存不进就算了:手工年只是本机便利 */ }
}

export interface YearRow { year: number; manual: boolean }

/**
 * 组年份行(升序,连续):range = [min..max] of (数据年∪当前年∪手工年)。
 * manual = 非数据年(含区间内自动补位的空年)——这类年整年为空时行尾可「移除」;
 * 但移除只对手工年生效(自动补位年随范围存在),removable 判定在调用方结合 extra 名单做。
 */
export function buildYearRows(dataYears: number[], currentYear: number, extraYears: number[]): YearRow[] {
  const all = [...dataYears, currentYear, ...extraYears]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const data = new Set(dataYears)
  const rows: YearRow[] = []
  for (let y = lo; y <= hi; y++) rows.push({ year: y, manual: !data.has(y) })
  return rows
}
