import { describe, it, expect, beforeEach } from 'vitest'
import { loadExtraYears, saveExtraYears, buildYearRows } from './matrixYears'

describe('matrixYears', () => {
  beforeEach(() => localStorage.clear())

  it('存取往返;去重排序;清空即删键', () => {
    saveExtraYears('ledger', 3, [2027, 2023, 2023])
    expect(loadExtraYears('ledger', 3)).toEqual([2023, 2027])
    saveExtraYears('ledger', 3, [])
    expect(localStorage.getItem('bw-extra-years:ledger:3')).toBeNull()
  })

  it('坏数据回空,不炸', () => {
    localStorage.setItem('bw-extra-years:ledger:9', '{oops')
    expect(loadExtraYears('ledger', 9)).toEqual([])
  })

  it('buildYearRows:范围=数据∪当前∪手工,连续补满;manual=非数据年', () => {
    const rows = buildYearRows([2024, 2025], 2026, [2023])
    expect(rows.map(r => r.year)).toEqual([2023, 2024, 2025, 2026])
    expect(rows.map(r => r.manual)).toEqual([true, false, false, true])
  })

  it('脏年份钳位:一个离谱的年不会让区间跨两千年', () => {
    // 不钳位就是 1..2999 共 2999 行 × 12 张卡,实测直接撑爆堆内存(P2 T4 复查)。
    const rows = buildYearRows([1, 2025], 2026, [2999])
    expect(rows[0].year).toBe(1996)                  // currentYear - 30
    expect(rows[rows.length - 1].year).toBe(2035)    // currentYear + 9
    expect(rows).toHaveLength(40)
  })

  it('手工年拉出的区间空洞自动补位(2022手工+2024数据 → 2023 也在,manual)', () => {
    const rows = buildYearRows([2024], 2024, [2022])
    expect(rows.map(r => r.year)).toEqual([2022, 2023, 2024])
    expect(rows[1].manual).toBe(true)
  })
})
