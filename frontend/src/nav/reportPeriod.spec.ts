import { describe, it, expect } from 'vitest'
import { REPORT_STEPS, parsePeriodQuery, periodLabel } from './reportPeriod'

describe('报表层的期', () => {
  it('九个步骤：三大报表 + 附表1–5 + 收入核对，顺序同报表中心目录', () => {
    expect(REPORT_STEPS.map(s => s.value)).toEqual([
      'income-statement', 'balance-sheet', 'trial-balance',
      'rent-pnl', 'elec-pnl', 'water-pnl', 'ops-pnl', 'expense-pnl',
      'reconciliation',
    ])
  })

  it('附表标签缩成「附表N」，全名进 title —— 九个步骤挤不下全称', () => {
    const s4 = REPORT_STEPS.find(s => s.value === 'ops-pnl')!
    expect(s4.label).toBe('附表4')
    expect(s4.title).toBe('附表4 运管损益')
    // 三大报表名字短，原样上条，不需要 title
    expect(REPORT_STEPS[0].label).toBe('利润表')
    expect(REPORT_STEPS[0].title).toBeUndefined()
  })

  describe('回读', () => {
    it('认得出整包', () => {
      expect(parsePeriodQuery({ y: '2025', m: '9', co: '3' })).toEqual({ year: 2025, month: 9, companyId: 3 })
    })

    it('co=all 回读成 all', () => {
      expect(parsePeriodQuery({ y: '2025', m: '9', co: 'all' })?.companyId).toBe('all')
    })

    it('只有年也认 —— 从损益附表跳回来时就是这样', () => {
      expect(parsePeriodQuery({ y: '2025' })).toEqual({ year: 2025, month: null, companyId: null })
    })

    it('没有年 = 不是深链,一律 null(别把半个期塞给屏)', () => {
      expect(parsePeriodQuery({})).toBe(null)
      expect(parsePeriodQuery({ m: '9' })).toBe(null)
    })

    it('年月越界一律丢掉,不信任地址栏', () => {
      expect(parsePeriodQuery({ y: '1999' })).toBe(null)
      expect(parsePeriodQuery({ y: '2101' })).toBe(null)
      expect(parsePeriodQuery({ y: 'abc' })).toBe(null)
      expect(parsePeriodQuery({ y: '2025', m: '13' })?.month, '月越界只丢月,年还算数').toBe(null)
      expect(parsePeriodQuery({ y: '2025', m: '0' })?.month).toBe(null)
    })

    it('co 不是数字也不是 all → 丢掉', () => {
      expect(parsePeriodQuery({ y: '2025', co: 'x' })?.companyId).toBe(null)
    })
  })

  describe('期标', () => {
    it('年月 + 公司', () => {
      expect(periodLabel(2025, 9, '物业公司')).toBe('2025-09 · 物业公司')
    })
    it('没有公司维度就只写年月(损益附表是园区全局)', () => {
      expect(periodLabel(2025, 9, null)).toBe('2025-09')
    })
    it('没有月就只写年', () => {
      expect(periodLabel(2025, null, null)).toBe('2025 年')
    })
  })
})
