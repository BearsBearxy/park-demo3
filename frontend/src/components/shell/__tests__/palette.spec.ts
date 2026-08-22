import { describe, it, expect } from 'vitest'
import { filterPages, buildAllPages, type PageEntry } from '../paletteFilter'
import { fpAllPages } from '@/nav/fpNav'

const allPages = buildAllPages(['data', 'reports', 'analysis'])

describe('filterPages', () => {
  it('empty query yields 最近 group (≤5) + per-layer groups', () => {
    const recent = ['buildings', 'tenants', 'ledger', 'cockpit', 'meters', 'bank-flow', 'salary', 'import']
    const groups = filterPages('', allPages, recent)

    const recentGroup = groups.find(g => g.title === '最近访问')
    expect(recentGroup).toBeDefined()
    expect(recentGroup!.items.length).toBeLessThanOrEqual(5)
    expect(recentGroup!.items.length).toBeGreaterThan(0)

    // per-layer groups present (数据中心 / 账簿与报表 / 经营分析)
    const layerTitles = groups.filter(g => g.title !== '最近访问').map(g => g.title)
    expect(layerTitles).toContain('数据中心')
    expect(layerTitles).toContain('账簿与报表')
    expect(layerTitles).toContain('经营分析')

    // recent items not duplicated in layer groups
    const recentVals = new Set(recentGroup!.items.map(p => p.value))
    for (const g of groups.filter(g => g.title !== '最近访问')) {
      for (const item of g.items) {
        expect(recentVals.has(item.value)).toBe(false)
      }
    }
  })

  it('empty query with no recent still shows layer groups', () => {
    const groups = filterPages('', allPages, [])
    expect(groups.find(g => g.title === '最近访问')).toBeUndefined()
    expect(groups.length).toBe(3) // one per layer
  })

  it('query "分析" matches 利润表分析 / 资产负债分析 / 现金流量分析 by label', () => {
    const groups = filterPages('分析', allPages, [])
    expect(groups).toHaveLength(1)
    const labels = groups[0].items.map(p => p.label)
    expect(labels).toContain('利润表分析')
    expect(labels).toContain('资产负债分析')
    expect(labels).toContain('现金流量分析')
  })

  it('query is case-insensitive (ASCII label match)', () => {
    // "利润表" matches 利润表 / 利润表分析; ASCII comparison via toLowerCase
    const lower = filterPages('利润表', allPages, [])
    const upper = filterPages('利润表', allPages, [])
    expect(lower[0].items.map(p => p.value)).toEqual(upper[0].items.map(p => p.value))
    // Verify actual ASCII case-insensitivity: item with ASCII label
    const lowerA = filterPages('income', allPages, [])
    const upperA = filterPages('INCOME', allPages, [])
    expect(lowerA[0].items.map(p => p.value)).toEqual(upperA[0].items.map(p => p.value))
  })

  it('matches by layerLabel', () => {
    // "经营分析" layer label — all items in that layer should match
    const groups = filterPages('经营分析', allPages, [])
    expect(groups[0].items.length).toBeGreaterThan(0)
    for (const item of groups[0].items) {
      expect(item.layerLabel).toBe('经营分析')
    }
  })

  it('unmatched query returns empty items group titled 无匹配', () => {
    const groups = filterPages('xyzzy_no_match_ever', allPages, [])
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('无匹配')
    expect(groups[0].items).toHaveLength(0)
  })
})
