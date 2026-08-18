import { describe, it, expect } from 'vitest'
import { fpSortRows } from './fpSort'

// 立此测试的原因:全站 4 个消费方共用这一个排序,但一直没有断言锁住空值方向。
// occRate 改可空(METRIC-SOURCE-SPEC §3)后,楼栋屏默认 occRate desc,
// 「算不出来」的栋若浮到第一页最前,比显示 0% 还误导。
const R = (name: string, occRate: number | null) => ({ name, occRate })
const COLS = [{ key: 'occRate', sortValue: (r: { occRate: number | null }) => r.occRate }]
const ROWS = [R('a', 40), R('b', null), R('c', 90), R('d', null)]

describe('fpSortRows — 空值一律沉底,不随 dir 翻面', () => {
  it('desc:非空按大到小,null 仍在末尾', () => {
    expect(fpSortRows(ROWS, { key: 'occRate', dir: 'desc' }, COLS).map(r => r.name)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('asc:非空按小到大,null 仍在末尾', () => {
    expect(fpSortRows(ROWS, { key: 'occRate', dir: 'asc' }, COLS).map(r => r.name)).toEqual(['a', 'c', 'b', 'd'])
  })
})
