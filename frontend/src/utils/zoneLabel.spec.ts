import { describe, it, expect } from 'vitest'
import { zoneLabel } from './zoneLabel'

// 与后端 ZoneService.label 同口径。前端这份是纯函数,给 meterExcel/poolLedgerLogic 注入用 ——
// 那两档 spec 零 mock,字典一旦改成异步拉取,127 个用例的写法要全部推倒。
describe('zoneLabel', () => {
  it('p{n} → 中文数字 + 期', () => {
    expect(zoneLabel('p1')).toBe('一期')
    expect(zoneLabel('p3')).toBe('三期')
    expect(zoneLabel('p10')).toBe('十期')
    expect(zoneLabel('p11')).toBe('十一期')
  })

  it('dorm → 宿舍', () => expect(zoneLabel('dorm')).toBe('宿舍'))

  // 兜底不是可选项:tsconfig 没开 noUncheckedIndexedAccess,
  // 放宽类型后字典下标读返回 undefined 编译器不报,会印进导出文件名
  it('认不出的原样返回,绝不返回 undefined', () => {
    expect(zoneLabel('px')).toBe('px')
    expect(zoneLabel('')).toBe('')
  })
})
