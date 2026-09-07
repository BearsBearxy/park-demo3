import { describe, it, expect } from 'vitest'
import { CHAIN, chainStepsOf, pipsOf, chainLabel } from './billingChain'
import type { ChainCell } from '@/stores/billingPeriod'

const cell = (o: Partial<ChainCell> = {}): ChainCell =>
  ({ meters: false, pool: false, loss: false, notices: false, stale: false, closed: false, ...o })

describe('出账链', () => {
  it('五道工序，顺序即业务时序（BILL-FORWARD 出账链）', () => {
    expect(CHAIN.map(s => s.value))
      .toEqual(['params', 'meters', 'alloc', 'alloc-loss', 'bill-notices'])
  })

  it('屏名取自 fpNav —— 链路条上的字与侧栏逐字相同，否则用户对不上', () => {
    expect(CHAIN.map(s => s.label))
      .toEqual(['计费参数', '园区抄表', '公共电核算', '楼栋损耗', '催缴单'])
  })

  describe('链路条状态', () => {
    it('什么都没做的月：参数就绪，后四道待做', () => {
      expect(chainStepsOf(cell()).map(s => s.state))
        .toEqual(['done', 'todo', 'todo', 'todo', 'todo'])
    })

    it('做到一半：抄了表、生成了池，损耗与催缴还没有', () => {
      expect(chainStepsOf(cell({ meters: true, pool: true })).map(s => s.state))
        .toEqual(['done', 'done', 'done', 'todo', 'todo'])
    })

    it('stale 把已做的都染成橙 —— 它们全是同一批旧快照', () => {
      const s = chainStepsOf(cell({ meters: true, pool: true, loss: true, stale: true }))
      expect(s.map(x => x.state)).toEqual(['stale', 'done', 'stale', 'stale', 'todo'])
    })

    it('抄表不受 stale 影响 —— 读数是人抄的原始数据，不是参数派生的快照', () => {
      expect(chainStepsOf(cell({ meters: true, stale: true }))[1].state).toBe('done')
    })

    it('没做的那一步不会因为 stale 变橙 —— 没生成过就无所谓过期', () => {
      expect(chainStepsOf(cell({ stale: true })).map(s => s.state))
        .toEqual(['stale', 'todo', 'todo', 'todo', 'todo'])
    })
  })

  describe('矩阵格子的点', () => {
    it('四个点，不含计费参数 —— 它恒为「就绪」，一颗永远亮的灯不携带信息', () => {
      expect(pipsOf(cell())).toEqual([false, false, false, false])
    })

    it('点的顺序与链一致：抄表 / 公摊 / 损耗 / 催缴', () => {
      expect(pipsOf(cell({ meters: true, loss: true }))).toEqual([true, false, true, false])
    })
  })

  it('chainLabel 认得出每个路由值，认不出的原样返回', () => {
    expect(chainLabel('alloc')).toBe('公共电核算')
    expect(chainLabel('nope')).toBe('nope')
  })
})
