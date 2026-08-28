// 期区显示名。与后端 ZoneService.label 同口径,两边都必须「认不出就原样返回」——
// 返回 undefined 会静默印进导出文件名(tsconfig 没开 noUncheckedIndexedAccess,编译器不报)。
const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

const numeral = (n: number): string => {
  if (n <= 0 || n >= 100) return String(n)
  if (n < 10) return DIGITS[n]
  if (n === 10) return '十'
  if (n < 20) return '十' + DIGITS[n % 10]
  return DIGITS[Math.floor(n / 10)] + '十' + DIGITS[n % 10]
}

export const zoneLabel = (code: string): string => {
  if (code === 'dorm') return '宿舍'
  const m = /^p(\d+)$/.exec(code ?? '')
  return m ? numeral(+m[1]) + '期' : (code ?? '')
}
