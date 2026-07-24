import { describe, it, expect } from 'vitest'
import { groupMeterBlocks, blockNameOf, blockLoss, spotKey, type GroupableMeter, type MeterUsageLike } from './meterGroup'

// METER-SPEC §7 v3 锁定:区块归属 / 排序(期区→区块→区块内) / 汇总数值(tenant+share 口径)。

let seq = 0
function mk(p: Partial<GroupableMeter> & { zone: string }): GroupableMeter {
  seq++
  return { id: seq, area: null, name: `m${seq}`, ownership: 'tenant', spot: null, sortNo: seq, ...p }
}
const u = (usageTotal: number | null, segs?: [number, number, number, number]): MeterUsageLike => ({
  usageTotal,
  usageSharp: segs?.[0] ?? null, usagePeak: segs?.[1] ?? null,
  usageFlat: segs?.[2] ?? null, usageValley: segs?.[3] ?? null,
})

describe('blockNameOf — 区块归属', () => {
  it('区块 = area 原文;area 空 = 未分区域', () => {
    expect(blockNameOf({ area: '一车间', name: '锂朋电' })).toBe('一车间')
    expect(blockNameOf({ area: null, name: '消防水池' })).toBe('未分区域')
    expect(blockNameOf({ area: '  ', name: 'x' })).toBe('未分区域')
  })
  it('「连接X车间」馈线表随 X车间 区块(标识名或企业名称原文判定,area 不同也归入)', () => {
    expect(blockNameOf({ area: '二期园区变压器', name: '连接一车间' })).toBe('一车间')
    expect(blockNameOf({ area: null, name: '连接 五车间馈线' })).toBe('五车间')
    // 真实形态:name=三至二铝缆 / area=铝缆 / 企业名称原文=连接二车间 → 二车间 区块
    expect(blockNameOf({ area: '铝缆', name: '三至二铝缆', tenantName: '连接二车间' })).toBe('二车间')
  })
})

describe('spotKey — 方位楼层房号自然序', () => {
  it('楼层:中文/数字/负层', () => {
    expect(spotKey('一楼101室', 1)[0]).toBe(1)
    expect(spotKey('7楼701室', 1)[0]).toBe(7)
    expect(spotKey('负一层', 1)[0]).toBe(-1)
    expect(spotKey('十楼', 1)[0]).toBe(10)
  })
  it('房号 = 首个≥2位数字;无方位 → 楼层/房号沉底、按原序', () => {
    expect(spotKey('一楼商铺 2103', 1)[1]).toBe(2103)
    expect(spotKey('东侧', 5)).toEqual([9999, 999999, 5])
    expect(spotKey(null, 7)).toEqual([9999, 999999, 7])
  })
})

describe('groupMeterBlocks — 排序', () => {
  it('期区序 p1→p2→dorm;区块序 = 区块内最小 sortNo(Excel 原序)', () => {
    const g = groupMeterBlocks([
      mk({ zone: 'dorm', area: '一栋', sortNo: 900 }),
      mk({ zone: 'p2', area: '二车间', sortNo: 30 }),
      mk({ zone: 'p2', area: '一车间', sortNo: 10 }),
      mk({ zone: 'p1', area: 'A座', sortNo: 500 }),
    ])
    expect(g.map(z => z.zone)).toEqual(['p1', 'p2', 'dorm'])
    expect(g[1].blocks.map(b => b.name)).toEqual(['一车间', '二车间'])
    expect(g[1].blocks[0].key).toBe('p2|一车间')
  })
  it('区块内:head=infra;body=share/ops(Excel 序)在前、tenant(方位自然序)在后', () => {
    const g = groupMeterBlocks([
      mk({ zone: 'p2', area: '一车间', name: '飞浪电', spot: '二楼201室', sortNo: 9 }),
      mk({ zone: 'p2', area: '一车间', name: '一车间总电', ownership: 'infra', sortNo: 2 }),
      mk({ zone: 'p2', area: '一车间', name: '一车间电梯', ownership: 'share', sortNo: 4 }),
      mk({ zone: 'p2', area: '一车间', name: '一车间消防', ownership: 'share', sortNo: 3 }),
      mk({ zone: 'p2', area: '一车间', name: '园区充电桩', ownership: 'ops', sortNo: 8 }),
      mk({ zone: 'p2', area: '一车间', name: '锂朋电', spot: '一楼102室', sortNo: 99 }),
      mk({ zone: 'p2', area: '一车间', name: '恩科电', spot: '一楼101室', sortNo: 98 }),
    ])
    const b = g[0].blocks[0]
    expect(b.head.map(m => m.name)).toEqual(['一车间总电'])
    expect(b.body.map(m => m.name)).toEqual(['一车间消防', '一车间电梯', '园区充电桩', '恩科电', '锂朋电', '飞浪电'])
  })
})

describe('groupMeterBlocks — 汇总数值(tenant+share 口径)', () => {
  it('infra/ops 不计入;null 用量跳过;总/尖/峰/平/谷各列都汇;期区 = Σ区块', () => {
    const usage = new Map<number, MeterUsageLike>()
    const infra = mk({ zone: 'p2', area: '一车间', ownership: 'infra', sortNo: 1 })
    const sh = mk({ zone: 'p2', area: '一车间', ownership: 'share', sortNo: 2 })
    const ops = mk({ zone: 'p2', area: '一车间', ownership: 'ops', sortNo: 3 })
    const t1 = mk({ zone: 'p2', area: '一车间', sortNo: 4 })
    const t2 = mk({ zone: 'p2', area: '一车间', sortNo: 5 })     // 漏抄:无读数
    const t3 = mk({ zone: 'p2', area: '二车间', sortNo: 6 })
    usage.set(infra.id, u(35170))
    usage.set(sh.id, u(100, [10, 20, 30, 40]))
    usage.set(ops.id, u(777))
    usage.set(t1.id, u(200.005, [1, 2, 3, 4]))
    usage.set(t3.id, u(50))
    const g = groupMeterBlocks([infra, sh, ops, t1, t2, t3], m => usage.get(m.id))
    const [b1, b2] = g[0].blocks
    expect(b1.sums).toEqual({ usageTotal: 300.01, usageSharp: 11, usagePeak: 22, usageFlat: 33, usageValley: 44, count: 3 })
    expect(b2.sums).toEqual({ usageTotal: 50, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null, count: 1 })
    expect(g[0].sums).toEqual({ usageTotal: 350.01, usageSharp: 11, usagePeak: 22, usageFlat: 33, usageValley: 44, count: 4 })
  })
  it('区块无 tenant/share 表 → count=0(视图不出汇总行);usageOf 缺省 → 各列 null 只分组', () => {
    const g = groupMeterBlocks([mk({ zone: 'p2', area: '二期园区变压器', ownership: 'infra' })])
    expect(g[0].blocks[0].sums.count).toBe(0)
    expect(g[0].blocks[0].sums.usageTotal).toBeNull()
  })
})

describe('真实锚点 — 2024-05 二期一车间(库内数值)', () => {
  // 总表(infra)用量 35170 不入合计;tenant+share 合计 34476.23,与 Excel 34478.6 同量级
  // (差 2.37 = Excel 各行用量四舍五入后再加总的累计差;库内为原始读数差×倍率快照)
  it('总表行 35170 在 head;区块合计 = 34476.23', () => {
    const rows: [string, string, number | null][] = [
      ['一车间总电', 'infra', 35170],
      ['一车间消防', 'share', 233.7], ['一车间电梯', 'share', 1543.2],
      ['锂朋电', 'tenant', 3972], ['新疆三林电', 'tenant', 0], ['恩科电', 'tenant', 656.1],
      ['飞浪电', 'tenant', 4370], ['魏杰瑜电', 'tenant', 736], ['苏明东电', 'tenant', 3215.1],
      ['谢福兵电', 'tenant', 1056], ['铂超电', 'tenant', 194.25], ['张炳南电', 'tenant', 3288.9],
      ['驰鸿电', 'tenant', 8949.6], ['达博普电', 'tenant', 435.8], ['保奔路电', 'tenant', 315.8],
      ['何育平电', 'tenant', 4812.8], ['黎镇源电', 'tenant', 144.8], ['中科华贸电', 'tenant', 552.18],
    ]
    const usage = new Map<number, MeterUsageLike>()
    const ms = rows.map(([name, ownership, ut]) => {
      const m = mk({ zone: 'p2', area: '一车间', name, ownership })
      usage.set(m.id, u(ut))
      return m
    })
    const b = groupMeterBlocks(ms, m => usage.get(m.id))[0].blocks[0]
    expect(b.head.map(m => m.name)).toEqual(['一车间总电'])
    expect(b.sums.count).toBe(17)
    expect(b.sums.usageTotal).toBeCloseTo(34476.23, 2)
  })
})

describe('blockLoss — 区块损耗行(PB-ALLOCATION-SPEC:总表vs分表勾稽,读时派生)', () => {
  it('损耗量=分表Σ−总表(负=有损耗);率=损耗/总表;2024-05 二期一车间锚点', () => {
    const l = blockLoss([35170], 34476.23)!
    expect(l.headQty).toBe(35170)
    expect(l.lossQty).toBeCloseTo(-693.77, 2)
    expect(l.lossRate).toBeCloseTo(-0.0197, 4)
    expect(l.warn).toBe(false)   // -1.97% 未超 -5% 阈
  })
  it('多总表求和;负超阈黄标;分表>总表为正不警', () => {
    expect(blockLoss([100, 100, null], 180)!.lossQty).toBe(-20)
    expect(blockLoss([100, 100, null], 180)!.warn).toBe(true)    // -10% 超阈
    expect(blockLoss([100], 180.67)!.warn).toBe(false)           // B座型分表>总表,正值不警
  })
  it('无总表读数=null 不出损耗行;总表 0 率=null', () => {
    expect(blockLoss([], 100)).toBeNull()
    expect(blockLoss([null], 100)).toBeNull()
    expect(blockLoss([0], 100)!.lossRate).toBeNull()
  })
})
