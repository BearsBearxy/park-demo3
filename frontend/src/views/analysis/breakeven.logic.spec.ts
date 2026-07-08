// breakeven.logic 纯函数单测(v2 抽出;CVP/敏感性/拆分口径=v1,含 dev 库锚点回算)
import { describe, expect, it } from 'vitest'
import type { AnalysisS10Row } from '@/api/analysis'
import { calcBe, cvpOption, s10UsedOf, splitData, tornadoItems, tornadoOption } from './breakeven.logic'

describe('calcBe', () => {
  it('常规:fixed=cost×fr,beRev=fixed/cm,bePct/safety 一位小数', () => {
    // 简数:rev 100、cost 80、fr 0.5 → fixed 40、vari 40、varRate .4、cm .6、beRev 66.67、bePct 66.7
    const b = calcBe(100, 80, 0.5)
    expect(b.fixed).toBe(40)
    expect(b.vari).toBe(40)
    expect(b.cm).toBeCloseTo(0.6)
    expect(b.beRev).toBeCloseTo(40 / 0.6)
    expect(b.bePct).toBe(66.7)
    expect(b.safety).toBe(33.3)
    expect(b.profit).toBe(20)
  })

  it('dev 库锚点(2025-10):rev 9,301,530.81 / cost 6,142,810.17 / fr 0.62 → 与 v1 公式一致', () => {
    const b = calcBe(9301530.81, 6142810.17, 0.62)
    expect(b.fixed).toBeCloseTo(6142810.17 * 0.62, 2)
    const varRate = (6142810.17 - 6142810.17 * 0.62) / 9301530.81
    expect(b.bePct).toBe(+((6142810.17 * 0.62 / (1 - varRate)) / 9301530.81 * 100).toFixed(1))
    expect(b.profit).toBeCloseTo(3158720.64, 2)
  })

  it('收入≤0:varRate=0、cm=1、bePct=null(v1 边界);fr 夹紧 0~1', () => {
    const b = calcBe(-636050.65, 5917279.67, 1.7)
    expect(b.fr).toBe(1)
    expect(b.varRate).toBe(0)
    expect(b.cm).toBe(1)
    expect(b.beRev).toBeCloseTo(5917279.67)
    expect(b.bePct).toBeNull()
    expect(b.safety).toBeNull()
  })
})

describe('s10UsedOf', () => {
  const row = (acctMonth: string, total: number, elec: number, water: number): AnalysisS10Row =>
    ({ acctMonth, phase: 1, tenantId: 1, tenantName: 'A', elec, water, total })
  it('口径月存在 → 汇总该月;缺失 → 退最新月', () => {
    const rows = [row('2025-09', 10, 1, 2), row('2025-10', 30, 3, 4), row('2025-10', 5, 1, 1)]
    expect(s10UsedOf(rows, '2025-10')).toEqual({ ym: '2025-10', total: 35, elec: 4, water: 5 })
    expect(s10UsedOf(rows, '2025-12')!.ym).toBe('2025-10')
    expect(s10UsedOf([], '2025-10')).toBeNull()
    expect(s10UsedOf(rows, null)).toBeNull()
  })
})

describe('option 构建', () => {
  const be = calcBe(100_0000, 80_0000, 0.5)

  it('cvpOption:13 采样点、保本 markPoint 坐标、盈利区 markArea 起点=保本达成率', () => {
    const opt = cvpOption(be) as {
      series: ({ name: string; data: [number, number][] } & {
        markPoint?: { data: { coord: [number | null, number | null] }[] }
        markArea?: { data: [{ xAxis: number | null }, { xAxis: number }][] }
      })[]
    }
    expect(opt.series[0].data).toHaveLength(13)                      // 0..120 步长 10
    expect(opt.series[0].data[10]).toEqual([100, 100_0000])          // 100% = 当月收入
    expect(opt.series[1].data[0]).toEqual([0, be.fixed])             // 成本线截距 = 固定成本
    expect(opt.series[0].markPoint!.data[0].coord).toEqual([be.bePct, be.beRev])
    expect(opt.series[0].markArea!.data[0][0].xAxis).toBe(be.bePct)
  })

  it('bePct>120 → 无 markPoint/markArea(不画出界标注)', () => {
    // rev 100、cost 200、fr 1 → beRev 200、bePct 200%
    const opt = cvpOption(calcBe(100, 200, 1)) as { series: { markPoint?: unknown }[] }
    expect(opt.series[0].markPoint).toBeUndefined()
  })

  it('tornadoItems 降序 + s10 因子;tornadoOption 红负蓝正对称', () => {
    const items = tornadoItems(be, { ym: '2025-10', total: 50_0000, elec: 20_0000, water: 1_0000 })
    expect(items.map((i) => i.name)).toEqual(['营业收入', '变动成本', '固定成本', '电费收入(s10)', '水费收入(s10)'])
    expect(items[0].delta).toBeCloseTo(0.1 * 100_0000 * be.cm / 10000)
    const opt = tornadoOption(items) as { series: { data: number[] }[]; yAxis: { data: string[] } }
    expect(opt.yAxis.data[opt.yAxis.data.length - 1]).toBe('营业收入')   // 倒序:最大在顶
    expect(opt.series[0].data.map((v) => -v)).toEqual(opt.series[1].data)
    expect(tornadoItems(be, null)).toHaveLength(3)
  })

  it('splitData:成本×系数折万一位小数(v1 口径)', () => {
    const d = splitData([1, 3], [10_0000, null, 20_0000, ...new Array(9).fill(null)], 0.62)
    expect(d.periods).toEqual(['1月', '3月'])
    expect(d.fixed).toEqual([6.2, 12.4])
    expect(d.vari).toEqual([3.8, 7.6])
  })
})
