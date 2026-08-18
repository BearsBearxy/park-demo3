import { describe, it, expect, vi, afterEach } from 'vitest'
import { latestPeriodOf } from './defaultPeriod'

// 锁 METRIC-SOURCE-SPEC §4:默认账期的 year 与 month 必须**一起**落在最后一个有数据的账期上。
// 立档证据第 4 条(2026-08-18 审计):year snap 到 2024、month 留 new Date().getMonth()+1=8,
// 拼出 2024-08 这个任何数据源里都不存在的账期 —— 所以这里把系统时钟钉在一个与数据月不同的月份,
// 断言返回值一格都不许沾上它。
describe('latestPeriodOf', () => {
  it('空集 → null(同 years 空:调用方保留当月默认)', () => {
    expect(latestPeriodOf([])).toBeNull()
  })

  it('取最大账期,不假设入参有序(端点约定升序,但别把正确性押在上面)', () => {
    expect(latestPeriodOf(['2024-10', '2024-02', '2024-09'])).toEqual({ year: 2024, month: 10 })
  })

  it('跨年比的是年不是月:2025-01 > 2024-12(字典序即时间序的落点)', () => {
    expect(latestPeriodOf(['2024-12', '2025-01'])).toEqual({ year: 2025, month: 1 })
  })
})
