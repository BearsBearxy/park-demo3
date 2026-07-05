import { describe, it, expect } from 'vitest'
import { suggestParent, stripKnownSuffix } from './tenantSuggest'

const T = (id: number, companyName: string, parentId: number | null = null) => ({ id, companyName, parentId })

describe('suggestParent', () => {
  it('王柱宿舍 → 王柱', () => {
    expect(suggestParent('王柱宿舍', [T(1, '王柱'), T(2, '李明')])).toEqual({ id: 1, companyName: '王柱' })
  })
  it('无候选 → null', () => {
    expect(suggestParent('王柱宿舍', [T(2, '李明')])).toBeNull()
    expect(suggestParent('王柱宿舍', [])).toBeNull()
  })
  it('最长优先:「王柱」「王柱宿」同在取王柱宿', () => {
    expect(suggestParent('王柱宿舍', [T(1, '王柱'), T(2, '王柱宿')])).toEqual({ id: 2, companyName: '王柱宿' })
  })
  it('子租户(parentId 非空)不作候选', () => {
    expect(suggestParent('王柱宿舍', [T(1, '王柱', 9)])).toBeNull()
  })
  it('同名不推荐(须严格更长)、单字名不作候选', () => {
    expect(suggestParent('王柱', [T(1, '王柱')])).toBeNull()
    expect(suggestParent('王宿舍', [T(1, '王')])).toBeNull()
  })
})

describe('stripKnownSuffix', () => {
  it('剥常见后缀', () => {
    expect(stripKnownSuffix('王柱宿舍')).toBe('王柱')
    expect(stripKnownSuffix('恒力办公室')).toBe('恒力')
  })
  it('不命中/整名即后缀 → 原样返回', () => {
    expect(stripKnownSuffix('王柱')).toBe('王柱')
    expect(stripKnownSuffix('宿舍')).toBe('宿舍')
  })
})
