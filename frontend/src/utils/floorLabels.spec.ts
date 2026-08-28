import { describe, it, expect } from 'vitest'
import { floorLabels } from './floorLabels'

// 楼层候选按该楼栋的 floorCount 派生 —— 三期两栋大厦现在 floor_count=1,
// 用户去楼栋管理改成真实层数,这里就自动出那么多个选项。
describe('floorLabels', () => {
  it('按层数生成,十二层就出十二个', () => {
    const f = floorLabels(12, [])
    expect(f).toContain('一楼')
    expect(f).toContain('十楼')
    expect(f).toContain('十一楼')
    expect(f).toContain('十二楼')
    expect(f.filter(x => x.endsWith('楼'))).toHaveLength(12)
  })

  it('天面与负一层恒在(不属于 floorCount 的计数)', () => {
    const f = floorLabels(1, [])
    expect(f).toEqual(expect.arrayContaining(['一楼', '负一层', '天面']))
  })

  it('库里已有的楼层并进来,不丢存量池的定位', () => {
    // 存量池写着「夹层」这类非常规楼层 —— 派生清单里没有,但不能让它选不回来
    expect(floorLabels(3, ['夹层', '一楼', null, ''])).toContain('夹层')
  })

  it('去重:已有值与派生值重合时只出一个', () => {
    expect(floorLabels(3, ['二楼']).filter(x => x === '二楼')).toHaveLength(1)
  })

  it('floorCount 缺失或为 0 时只出特殊层,不炸', () => {
    expect(floorLabels(0, [])).toEqual(['负一层', '天面'])
  })
})
