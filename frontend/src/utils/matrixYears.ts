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

// 年份区间的钳位窗口。往回 30 年够覆盖真导进来的历史册,往前 9 年够提前开年
// (与 utils/yearGate.ts 年选择器的 back/forward 默认值同源)。
const BACK = 30, FORWARD = 9

/**
 * 这个年份落在年份条画得出的窗口里吗 —— 与 buildYearRows 的 lo/hi 同一口径。
 * 给调用方**先滤脏年**用:钳位只保证不撑爆(见下),滤掉才不会让一条脏值把条从 4 行拉成 31 行。
 */
export const inYearWindow = (year: number, currentYear: number) =>
  year >= currentYear - BACK && year <= currentYear + FORWARD

/**
 * 组年份行(升序,连续):range = [min..max] of (数据年∪当前年∪手工年)。
 * manual = 非数据年(含区间内自动补位的空年)——这类年整年为空时行尾可「移除」;
 * 但移除只对手工年生效(自动补位年随范围存在),removable 判定在调用方结合 extra 名单做。
 */
export function buildYearRows(dataYears: number[], currentYear: number, extraYears: number[]): YearRow[] {
  const all = [...dataYears, currentYear, ...extraYears]
  // 钳位:一个脏年(1 / 1900 / 2999)会把 lo..hi 撑到两千年,循环出两千行 × 12 张月卡 ——
  // 2026-09-06 复查实测直接 FATAL ERROR: JavaScript heap out of memory + worker 退出。
  // 口径与 utils/yearGate.ts 的年选择器同源(那里注释原话「再由钳位挡住脏数据年(1900/2999)
  // 撑爆下拉」)。all 里恒含 currentYear,所以 lo <= currentYear <= hi,钳位不会把结果钳成空。
  const lo = Math.max(Math.min(...all), currentYear - BACK)
  const hi = Math.min(Math.max(...all), currentYear + FORWARD)
  const data = new Set(dataYears)
  const rows: YearRow[] = []
  for (let y = lo; y <= hi; y++) rows.push({ year: y, manual: !data.has(y) })
  return rows
}
