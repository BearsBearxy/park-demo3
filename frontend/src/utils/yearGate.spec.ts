import { describe, it, expect } from 'vitest'
import { buildYearOptions, yearCardsOf, gateCurrentOf, maxSelectableYear } from './yearGate'

const at = (y: number) => new Date(`${y}-07-29T00:00:00`)

describe('buildYearOptions', () => {
  it('空数据年 = 今年-10..今年+2(空库也能补录历史年与提前开年)', () => {
    expect(buildYearOptions([], at(2026)))
      .toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028])
  })

  it('回溯窗口覆盖账册最早年 2023(用户 2026-07-29 追问的场景)', () => {
    expect(buildYearOptions([2024], at(2026))).toContain(2023)
  })

  it('跨年空缺补齐:数据只有 2024 也不会跳过 2025(死锁根因)', () => {
    // 旧口径 [...new Set([...dataYears, 今年])] = [2024, 2026] —— 2025 永远录不进去
    expect(buildYearOptions([2024, 2024], at(2026))).toContain(2025)
  })

  it('数据年在窗口外时按数据年扩(导了 2015 历史册就能选 2015)', () => {
    const ys = buildYearOptions([2015], at(2026))
    expect(ys[0]).toBe(2015)
    expect(ys[ys.length - 1]).toBe(2028)
  })

  it('今年早于数据年时向后延伸到数据最大年', () => {
    const ys = buildYearOptions([2029], at(2026))
    expect(ys[0]).toBe(2016)
    expect(ys[ys.length - 1]).toBe(2029)
  })

  it('脏数据极值被钳位,且恒含今年±1', () => {
    const ys = buildYearOptions([1900, 2999], at(2026))
    expect(ys.length).toBeLessThanOrEqual(40)
    expect(ys[0]).toBe(1996)                    // 今年-30 钳位
    expect(ys[ys.length - 1]).toBe(2035)        // 今年+9 钳位
    expect(ys).toEqual(expect.arrayContaining([2023, 2025, 2026, 2027]))
  })

  it('升序且无重复', () => {
    const ys = buildYearOptions([2027, 2024, 2024], at(2026))
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    expect(new Set(ys).size).toBe(ys.length)
  })
})

describe('yearCardsOf / gateCurrentOf', () => {
  it('空缺年出卡片且标记为无数据', () => {
    const cards = yearCardsOf([{ year: 2024, months: 12 }], '已录入月份')
    const y2025 = cards.find(c => c.year === 2025)!
    expect(y2025.hasData).toBe(false)
    expect(cards.find(c => c.year === 2024)!.metric).toBe('12 个月')
  })

  it('「最新」角标落在今年,不落在区间最高年', () => {
    const cur = new Date().getFullYear()
    expect(gateCurrentOf(yearCardsOf([{ year: cur - 2, months: 3 }], 'x'))).toBe(cur)
  })
})

describe('maxSelectableYear', () => {
  it('等于选项区间上界(今年+2)', () => {
    expect(maxSelectableYear(at(2026))).toBe(2028)
  })
})
