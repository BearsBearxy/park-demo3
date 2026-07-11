import { describe, it, expect } from 'vitest'
import { buildFamilyMap, familyRootOf } from './anaFamily'

describe('anaFamily — 名称→家族根名映射', () => {
  const map = buildFamilyMap([
    { companyName: '广联', parentName: null },
    { companyName: '广联（宿舍）', parentName: '广联' },
    { companyName: '广联（饭堂）', parentName: '广联' },
    { companyName: '安达', parentName: null },
  ])

  it('子租户归根,root 归自身', () => {
    expect(familyRootOf(map, '广联（宿舍）')).toBe('广联')
    expect(familyRootOf(map, '广联（饭堂）')).toBe('广联')
    expect(familyRootOf(map, '广联')).toBe('广联')
    expect(familyRootOf(map, '安达')).toBe('安达')
  })

  it('不在主数据的名称自成一族(台账历史租户)', () => {
    expect(familyRootOf(map, '已注销租户')).toBe('已注销租户')
  })
})
