// src/utils/deepLink.spec.ts — 核对跳转深链 query 解析(spec 2026-07-07 §三)
import { describe, it, expect } from 'vitest'
import { parseLedgerDeepLink, parseS10DeepLink } from './deepLink'

describe('parseLedgerDeepLink', () => {
  it('解析完整 query', () => {
    expect(parseLedgerDeepLink({ y: '2025', m: '1', company: '创显', tenant: '万众宿舍' }))
      .toEqual({ y: 2025, m: 1, company: '创显', tenant: '万众宿舍' })
  })

  it('缺 y 或 m → null(普通打开不受影响)', () => {
    expect(parseLedgerDeepLink({})).toBeNull()
    expect(parseLedgerDeepLink({ y: '2025' })).toBeNull()
    expect(parseLedgerDeepLink({ m: '3', tenant: 'x' })).toBeNull()
  })

  it('y/m 非法(非数字/月份越界)→ null', () => {
    expect(parseLedgerDeepLink({ y: 'abc', m: '1' })).toBeNull()
    expect(parseLedgerDeepLink({ y: '2025', m: '0' })).toBeNull()
    expect(parseLedgerDeepLink({ y: '2025', m: '13' })).toBeNull()
  })

  it('company/tenant 缺省空串;数组值取第一个', () => {
    expect(parseLedgerDeepLink({ y: '2025', m: '2' }))
      .toEqual({ y: 2025, m: 2, company: '', tenant: '' })
    expect(parseLedgerDeepLink({ y: '2025', m: '2', tenant: ['甲', '乙'] }))
      .toMatchObject({ tenant: '甲' })
  })
})

describe('parseS10DeepLink', () => {
  it('解析完整 query', () => {
    expect(parseS10DeepLink({ y: '2025', m: '10', phase: '2', tenant: '张丽莉' }))
      .toEqual({ y: 2025, m: 10, phase: 2, tenant: '张丽莉' })
  })

  it('phase 缺失或越界(1..4)→ 回落 1', () => {
    expect(parseS10DeepLink({ y: '2025', m: '3' })!.phase).toBe(1)
    expect(parseS10DeepLink({ y: '2025', m: '3', phase: '9' })!.phase).toBe(1)
    expect(parseS10DeepLink({ y: '2025', m: '3', phase: 'x' })!.phase).toBe(1)
  })

  it('缺 y/m → null', () => {
    expect(parseS10DeepLink({ phase: '2', tenant: 'x' })).toBeNull()
  })
})
