import { describe, it, expect } from 'vitest'
import { familySort } from './tenantsFamily'

const R = (companyName: string, parentName: string | null = null) => ({ companyName, parentName })

describe('familySort(家族聚合排序)', () => {
  it('两族按根名 zh 排序,子随父聚合', () => {
    const out = familySort([
      R('中恒宿舍', '中恒'),
      R('安达'),
      R('中恒'),
      R('安达饭堂', '安达'),
    ])
    expect(out.map(t => t.companyName)).toEqual(['安达', '安达饭堂', '中恒', '中恒宿舍'])
  })

  it('族内 root 在前、子按名称序', () => {
    const out = familySort([
      R('广联宿舍', '广联'),
      R('广联饭堂', '广联'),
      R('广联'),
    ])
    expect(out.map(t => t.companyName)).toEqual(['广联', '广联饭堂', '广联宿舍'])
  })

  it('无 parent → 全 root,退化为名称序', () => {
    const out = familySort([R('中恒'), R('安达'), R('广联')])
    expect(out.map(t => t.companyName)).toEqual(['安达', '广联', '中恒'])
  })

  it('子的 parentName 悬空(父被过滤)不崩,按族键落位', () => {
    const out = familySort([
      R('中恒'),
      R('广联宿舍', '广联'), // 父「广联」不在列表
      R('安达'),
    ])
    expect(out.map(t => t.companyName)).toEqual(['安达', '广联宿舍', '中恒'])
  })

  it('空列表 → 空数组', () => {
    expect(familySort([])).toEqual([])
  })
})
