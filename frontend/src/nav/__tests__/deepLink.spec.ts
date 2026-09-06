// src/nav/__tests__/deepLink.spec.ts — 期间深链协议(SIDEBAR-UX-REDESIGN §4.2):一个出口 periodLink、一个收口 parsePeriod。
// 收口认三代格式(p 新 | ym 出账链旧链 | y&m 报表层 / 台账 / 附10 旧链),旧解析器委托过来后旧用例照旧绿。
import { describe, it, expect } from 'vitest'
import { periodLink, periodOf, parsePeriod } from '../deepLink'
import { parsePeriodQuery } from '../reportPeriod'

describe('periodLink 发链', () => {
  it('p 必带;co 与 extra 有才写,值一律 string', () => {
    expect(periodLink('income-statement', { p: '2025-06', co: 'all' }))
      .toEqual({ path: '/income-statement', query: { p: '2025-06', co: 'all' } })
    expect(periodLink('meters', { p: '2024-02' })).toEqual({ path: '/meters', query: { p: '2024-02' } })
    expect(periodLink('params', { p: '2024-02', co: 3, extra: { zone: 'p1', rule: 23, edit: undefined, x: null } }))
      .toEqual({ path: '/params', query: { p: '2024-02', co: '3', zone: 'p1', rule: '23' } })
  })
  it('periodOf:月补零;没有月只写年(损益附表 / 年表屏)', () => {
    expect(periodOf(2025, 6)).toBe('2025-06')
    expect(periodOf(2025, 12)).toBe('2025-12')
    expect(periodOf(2025, null)).toBe('2025')
  })
})

describe('parsePeriod 收链', () => {
  it('p=YYYY-MM(新格式)', () => {
    expect(parsePeriod({ p: '2025-06' })).toEqual({ year: 2025, month: 6, co: null })
    expect(parsePeriod({ p: '2025' })).toEqual({ year: 2025, month: null, co: null })
  })
  it('ym=YYYY-MM(出账链旧链)照认;月必须两位补零', () => {
    expect(parsePeriod({ ym: '2024-02' })).toEqual({ year: 2024, month: 2, co: null })
    expect(parsePeriod({ ym: '2024-2' })).toBe(null)
  })
  it('y&m(报表层 / 台账 / 附10 旧链);只有年也认', () => {
    expect(parsePeriod({ y: '2025', m: '9' })).toEqual({ year: 2025, month: 9, co: null })
    expect(parsePeriod({ y: '2025' })).toEqual({ year: 2025, month: null, co: null })
  })
  it('优先级 p > ym > y&m —— 混着来时只信最新的那一代', () => {
    expect(parsePeriod({ p: '2025-01', ym: '2024-02', y: '2023', m: '3' })?.year).toBe(2025)
    expect(parsePeriod({ ym: '2024-02', y: '2023', m: '3' })?.year).toBe(2024)
  })
  it('越界不信任地址栏:年 2000..2100 之外整个 null;y&m 的月越界只丢月;p 的月不合法整个 null', () => {
    expect(parsePeriod({ p: '1999-01' })).toBe(null)
    expect(parsePeriod({ y: '2101', m: '1' })).toBe(null)
    expect(parsePeriod({ y: 'abc' })).toBe(null)
    expect(parsePeriod({})).toBe(null)
    expect(parsePeriod({ y: '2025', m: '13' })?.month).toBe(null)
    expect(parsePeriod({ p: '2025-13' })).toBe(null)
  })
  it('co:id | all | 旧 company 名;都没有 → null;co 非法且无 company → null', () => {
    expect(parsePeriod({ p: '2025-06', co: '3' })?.co).toBe(3)
    expect(parsePeriod({ p: '2025-06', co: 'all' })?.co).toBe('all')
    expect(parsePeriod({ y: '2025', m: '1', company: '创显' })?.co).toBe('创显')
    expect(parsePeriod({ p: '2025-06', co: 'x' })?.co).toBe(null)
    expect(parsePeriod({ p: '2025-06', co: '3', company: '创显' })?.co, 'co 有值时不看 company').toBe(3)
  })
  it('数组型 query 值取第一个(?p=a&p=b 是用户能敲出来的地址)', () => {
    expect(parsePeriod({ p: ['2025-06', '2024-01'] })?.year).toBe(2025)
    expect(parsePeriod({ y: ['2025'], m: ['3'] })).toEqual({ year: 2025, month: 3, co: null })
  })
})

describe('旧解析器委托后:认 p,旧口径原样', () => {
  it('reportPeriod.parsePeriodQuery 认 p;company 名不落进 companyId(报表层没有公司名维度)', () => {
    expect(parsePeriodQuery({ p: '2025-09', co: 'all' })).toEqual({ year: 2025, month: 9, companyId: 'all' })
    expect(parsePeriodQuery({ y: '2025', m: '9', company: '创显' })?.companyId).toBe(null)
  })
})
