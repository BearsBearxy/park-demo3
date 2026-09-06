// building.spec.ts — 出租率显示口径单测(METRIC-SOURCE-SPEC §3:算不出来必须能表达算不出来)。
import { describe, expect, it } from 'vitest'
import { occByUnit, occPct } from './building'

describe('occPct', () => {
  it('null → 「—」;不拼出 "null%"', () => {
    expect(occPct(null)).toBe('—')
    expect(occPct(0)).toBe('0%')       // 真的 0% 与「没法算」必须分得开
    expect(occPct(52.8)).toBe('52.8%')
  })
})

describe('occByUnit', () => {
  // 「按单元 n/m」同句出现在楼栋管理 KPI 与出租与楼栋屏(§2 同名指标同源),
  // 分子固定 unitCount − vacantCount:换成 Σ occupiedCount 会漏掉 reserved 单元,两屏对不上。
  it('已占单元/总单元 + 1 位小数比率(与后端 occRateOf 对齐)', () => {
    expect(occByUnit({ unitCount: 373, vacantCount: 176 })).toEqual({ text: '按单元 197/373', rate: 52.8 })
    expect(occByUnit({ unitCount: 61, vacantCount: 37 })).toEqual({ text: '按单元 24/61', rate: 39.3 })
  })

  it('无单元 → rate 为 null(不拿 0 冒充「没法算」)', () => {
    expect(occByUnit({ unitCount: 0, vacantCount: 0 })).toEqual({ text: '按单元 0/0', rate: null })
  })
})
