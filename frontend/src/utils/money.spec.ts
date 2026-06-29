import { describe, it, expect } from 'vitest'
import { fpMoney, fpWan } from './money'

describe('fpMoney', () => {
  it('null/undefined → 「—」', () => {
    expect(fpMoney(null)).toBe('—')
    expect(fpMoney(undefined)).toBe('—')
  })
  it('合法的 0 → ¥0（不与无数据混淆）', () => {
    expect(fpMoney(0)).toBe('¥0')
  })
  it('千分位', () => {
    expect(fpMoney(1234567)).toBe('¥1,234,567')
  })
  it('负数', () => {
    expect(fpMoney(-1200)).toBe('¥-1,200')
  })
})

describe('fpWan', () => {
  it('null → ¥0', () => {
    expect(fpWan(null)).toBe('¥0')
    expect(fpWan(undefined)).toBe('¥0')
  })
  it('< 10万 保留 1 位小数', () => {
    expect(fpWan(12000)).toBe('¥1.2万')
  })
  it('>= 10万 去小数', () => {
    expect(fpWan(2000000)).toBe('¥200万')
  })
  it('负数：按绝对值定小数位，Unicode 负号', () => {
    expect(fpWan(-12000)).toBe('−¥1.2万')
    expect(fpWan(-2000000)).toBe('−¥200万') // 阈值按绝对值，大负数也去小数
  })
})
