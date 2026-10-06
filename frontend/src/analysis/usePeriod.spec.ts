// usePeriod 单测:注入月份派生范围/夹取/步进跳稀疏月/边界禁用/粒度切换。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetPeriodForTest, providePeriodMonths, usePeriod, ymOf } from './usePeriod'

// 真实数据形状:稀疏月份(s10 只有 5 期)+ 跨年
const MONTHS = ['2024-09', '2024-12', '2025-01', '2025-02', '2025-06', '2025-07', '2025-10']

beforeEach(() => {
  __resetPeriodForTest()
  localStorage.clear()
})

describe('providePeriodMonths', () => {
  it('注入后默认落到最新月;年份列表由数据派生', () => {
    providePeriodMonths(MONTHS)
    const p = usePeriod()
    expect(p.sel.value).toEqual({ gran: 'month', year: 2025, month: 10 })
    expect(p.years.value).toEqual([2024, 2025])
    expect(p.label.value).toBe('2025年10月')
    expect(p.ym.value).toBe('2025-10')
    expect(p.atEnd.value).toBe(true)
    expect(p.atStart.value).toBe(false)
  })

  // 真实数据:全局最新月 2026-01 只有办公水电、无损益 → 默认期须落最近有损益的月,否则驾驶舱首屏空态
  it('给定 financeMonths → 默认落其最新月(而非全局最新的空月)', () => {
    providePeriodMonths([...MONTHS, '2026-01'], MONTHS)
    expect(usePeriod().sel.value).toEqual({ gran: 'month', year: 2025, month: 10 })
  })

  it('financeMonths 缺省/为空 → 回退全局最新月(向后兼容)', () => {
    providePeriodMonths([...MONTHS, '2026-01'])
    expect(usePeriod().sel.value).toEqual({ gran: 'month', year: 2026, month: 1 })
    __resetPeriodForTest()
    providePeriodMonths([...MONTHS, '2026-01'], [])
    expect(usePeriod().sel.value).toEqual({ gran: 'month', year: 2026, month: 1 })
  })

  it('financeMonths 含不在并集里的月 → 被过滤,不产生非法选择', () => {
    providePeriodMonths(MONTHS, ['2099-12', '2025-07'])
    expect(usePeriod().sel.value).toEqual({ gran: 'month', year: 2025, month: 7 })
  })

  it('gran=year 且选择失效 → 年落默认月所在年(不再固定取最新年)', () => {
    providePeriodMonths(MONTHS)
    const p = usePeriod()
    p.setGran('year')
    expect(p.sel.value.year).toBe(2025)
    // 换一批只含 2026 的月份,其中仅 2026-01 有损益 → 年应落 2026
    providePeriodMonths(['2026-01', '2026-02'], ['2026-01'])
    expect(p.sel.value.gran).toBe('year')
    expect(p.sel.value.year).toBe(2026)
  })

  it('持久化的过期选择被夹到最新月', () => {
    localStorage.setItem('fp-ana-period', JSON.stringify({ gran: 'month', year: 2023, month: 5 }))
    __resetPeriodForTest()   // 重置模块态(会清 key)→ 重新写入再模拟加载
    localStorage.setItem('fp-ana-period', JSON.stringify({ gran: 'month', year: 2023, month: 5 }))
    providePeriodMonths(MONTHS)
    const p = usePeriod()
    // 2023-05 不在可用月份 → 夹到 2025-10
    expect(p.sel.value).toEqual({ gran: 'month', year: 2025, month: 10 })
  })

  // 2026-10-05 用户拍板「按你建议修改」:新园区空库(一个可用月都没有)落今年今月,不停在 0 年;不写 localStorage
  it('没有任何可用月 → 落今年今月(读时钟),不落 0 年、不持久化', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2031, 6, 15))
    try {
      providePeriodMonths([])
      const p = usePeriod()
      expect(p.sel.value).toEqual({ gran: 'month', year: 2031, month: 7 })
      expect(localStorage.getItem('fp-ana-period')).toBeNull()
      // 后来有了数据:今月不在可用月里 → 照旧夹到最新月
      providePeriodMonths(MONTHS)
      expect(p.sel.value).toEqual({ gran: 'month', year: 2025, month: 10 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('有可用月就不读时钟:今月正好在可用月里,默认期也照旧落最新月', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2025, 6, 15))   // 2025-07 在 MONTHS 里
    try {
      providePeriodMonths(MONTHS)
      expect(usePeriod().sel.value).toEqual({ gran: 'month', year: 2025, month: 10 })
    } finally {
      vi.useRealTimers()
    }
  })

  // 新浏览器(本机没存过期间):月份注入前各屏已按 sel 取数 —— 不许是 0 年(会先打一发 ?year=0 被拒)。
  // 注入后照旧夹到最近有损益的月,今月恰好在可用月里也不停在今月(有数据时最终落点不读时钟)。
  // 破坏验证:loadSel 默认值写回 {0,0} → 第一句红;去掉 pristine(只看 isValid)→ 第二句红
  it('❗本机没存过期间:注入前是今年今月;注入后照旧落最近有损益的月', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2025, 6, 15))   // 2025-07,在 MONTHS 里
    try {
      localStorage.clear()
      vi.resetModules()
      const m = await import('./usePeriod')
      const p = m.usePeriod()
      expect(p.sel.value).toEqual({ gran: 'month', year: 2025, month: 7 })
      m.providePeriodMonths(MONTHS, ['2025-06'])
      expect(p.sel.value).toEqual({ gran: 'month', year: 2025, month: 6 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('本机存过、仍有效的期间:照旧留着,不夹', async () => {
    localStorage.setItem('fp-ana-period', JSON.stringify({ gran: 'month', year: 2025, month: 2 }))
    vi.resetModules()
    const m = await import('./usePeriod')
    m.providePeriodMonths(MONTHS, ['2025-06'])
    expect(m.usePeriod().sel.value).toEqual({ gran: 'month', year: 2025, month: 2 })
  })

  it('乱序/重复输入被排序去重', () => {
    providePeriodMonths(['2025-02', '2025-01', '2025-02'])
    const p = usePeriod()
    expect(p.months.value).toEqual(['2025-01', '2025-02'])
  })
})

describe('步进与边界', () => {
  it('按月步进沿数据月份跳稀疏(2025-10 → 2025-07)', () => {
    providePeriodMonths(MONTHS)
    const p = usePeriod()
    p.step(-1)
    expect(p.sel.value).toEqual({ gran: 'month', year: 2025, month: 7 })
    p.step(-1)
    expect(p.ym.value).toBe('2025-06')
  })

  it('跨年步进自然衔接(2025-01 → 2024-12)', () => {
    providePeriodMonths(MONTHS)
    const p = usePeriod()
    p.setYear(2025); p.setMonth(1)
    p.step(-1)
    expect(p.sel.value.year).toBe(2024)
    expect(p.sel.value.month).toBe(12)
  })

  it('起点边界禁用且不越界', () => {
    providePeriodMonths(MONTHS)
    const p = usePeriod()
    for (let i = 0; i < 20; i++) p.step(-1)
    expect(p.ym.value).toBe('2024-09')
    expect(p.atStart.value).toBe(true)
    p.step(-1)
    expect(p.ym.value).toBe('2024-09')   // 到底后再步进不动
  })
})

describe('粒度与年月切换', () => {
  it('按年粒度:ym 为 null,标签为年;步进沿年份', () => {
    providePeriodMonths(MONTHS)
    const p = usePeriod()
    p.setGran('year')
    expect(p.sel.value.gran).toBe('year')
    expect(p.ym.value).toBeNull()
    expect(p.label.value).toBe('2025年')
    p.step(-1)
    expect(p.sel.value.year).toBe(2024)
    expect(p.atStart.value).toBe(true)
  })

  it('切年份保月:目标年无该月 → 落该年最后可用月', () => {
    providePeriodMonths(MONTHS)
    const p = usePeriod()
    expect(p.sel.value.month).toBe(10)
    p.setYear(2024)   // 2024 无 10 月 → 12 月
    expect(p.sel.value).toEqual({ gran: 'month', year: 2024, month: 12 })
    p.setMonth(9)
    expect(p.ym.value).toBe('2024-09')
    p.setMonth(3)     // 非可用月 → 忽略
    expect(p.ym.value).toBe('2024-09')
  })

  it('年→月切回:该年最后可用月', () => {
    providePeriodMonths(MONTHS)
    const p = usePeriod()
    p.setGran('year')
    p.setYear(2024)
    p.setGran('month')
    // 2024 的月份 [09,12];先前 month=10 不在 → 落 12
    expect(p.sel.value).toEqual({ gran: 'month', year: 2024, month: 12 })
  })

  it('monthNumsOf 按年过滤', () => {
    providePeriodMonths(MONTHS)
    const p = usePeriod()
    expect(p.monthNumsOf(2025)).toEqual([1, 2, 6, 7, 10])
  })
})

describe('ymOf', () => {
  it('补零', () => { expect(ymOf(2025, 3)).toBe('2025-03') })
})
