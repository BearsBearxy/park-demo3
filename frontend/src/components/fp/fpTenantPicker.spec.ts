import { describe, it, expect } from 'vitest'
import { filterTenants } from './fpTenantPicker'

const T = (id: number, name: string) => ({ id, name })

describe('filterTenants', () => {
  it('空 q → 全量,按名称 zh 升序', () => {
    const out = filterTenants([T(1, '中恒'), T(2, '安达'), T(3, '广联')], '')
    expect(out.map((t) => t.name)).toEqual(['安达', '广联', '中恒'])
  })

  it('子串命中,结果仍有序', () => {
    const out = filterTenants([T(1, '中联'), T(2, '广联'), T(3, '安达')], '联')
    expect(out.map((t) => t.name)).toEqual(['广联', '中联'])
  })

  it('大小写不敏感', () => {
    const out = filterTenants([T(1, 'abc科技'), T(2, '安达')], 'ABC')
    expect(out.map((t) => t.name)).toEqual(['abc科技'])
  })

  it('空列表 → 空数组', () => {
    expect(filterTenants([], '')).toEqual([])
    expect(filterTenants([], '广')).toEqual([])
  })

  // 回归(2026-07-11 用户报障):库内子租户名为全角括号「广联（宿舍）」,手输「广联宿舍」搜不到
  it('括号归一化:无括号/半角括号/带空格 的输入均命中全角括号名称', () => {
    const list = [T(1, '广联（宿舍）'), T(2, '广联（饭堂）'), T(3, '广联'), T(4, '安达')]
    expect(filterTenants(list, '广联宿舍').map((t) => t.name)).toEqual(['广联（宿舍）'])
    expect(filterTenants(list, '广联(宿舍)').map((t) => t.name)).toEqual(['广联（宿舍）'])
    expect(filterTenants(list, '广联 宿舍').map((t) => t.name)).toEqual(['广联（宿舍）'])
    // 反向:名称无括号、输入带括号也命中
    expect(filterTenants([T(5, '王柱宿舍')], '王柱（宿舍）').map((t) => t.name)).toEqual(['王柱宿舍'])
  })
})
