import { describe, it, expect } from 'vitest'
import { importChargingRows, type ChargingCatLite } from './importChargingRows'

const c = (a: (string | number)[]) => a.map(String)

const cats8: ChargingCatLite[] = [
  { catId: 'dingding', name: '叮叮充' },
  { catId: 'dianxin', name: '电信' },
]
const cats7: ChargingCatLite[] = [
  { catId: 'wancheng', name: '万城万' },
  { catId: 'xiaoju', name: '小桔' },
]

// 仿真实附表8(电动车):标题 + 单行表头,「充电桩类别」合并下填,「充电金额收入」已扣手续费。
const ebike: string[][] = [
  c(['', '2025年电动车充电桩损益明细']),
  c(['', '充电桩类别', '月份', '充电电量（千瓦时）', '充电金额收入（元，已扣除手续费）', '充电成本（元）', '充电利润（元）', '备注']),
  c(['', '叮叮充', '2025-01-01', '1205.49', '3872.23', '895.01', '2977.22']),
  c(['', '', '2025-02-01', '1404.15', '4329.03', '1013.49', '3315.54']),
  c(['', '', '小计', '32612.02', '92916', '23830.69', '69085.31']),
  c(['', '电信', '2025-01-01', '839.63', '2367.91', '699.41', '1668.5', '电信只剩两个充电桩']),
  c(['', '总计', '', '39882.44', '112023.6', '29985.2', '82038.4']),
]

// 仿真实附表7(汽车):标题 + 单行表头,期间异构(年/年范围/单月/小计),收入未扣手续费(需减「手续费及服务费金额」)。
const car: string[][] = [
  c(['汽车充电桩收益汇总']),
  c(['充电桩类别', '期间', '充电电量（千瓦时）', '充电收入金额（元）', '手续费及服务费金额（元）', '充电成本金额（元）', '利润（元）', '备注']),
  c(['万城万', '2024年', '73740.252', '82762.54', '1801.41', '46889.12', '34072.01']),
  c(['', '2025年1-9月', '63362.287', '68550.61', '1386.21', '40290.10', '26874.30']),
  c(['', '2025-10-01', '8484.576', '9076.52', '162.74', '5395.08', '3518.70']),
  c(['', '2025-11-01', '5168.415', '5289.49', '140.01', '3286.43', '1863.05']),
  c(['', '小计', '150755.53', '165679.16', '3490.37', '95860.73', '66328.06']),
  c(['小桔', '2025-10-01', '17144.756', '19331.49', '1149.85', '10901.81', '7279.83']),
  c(['总计', '', '447603.614', '493838.93', '21824.19', '284617.15', '187397.59']),
]

describe('importChargingRows — 充电桩单表逐行解析', () => {
  it('电动车(no=8):fee 直取充电金额收入(已扣手续费),运营商下填,聚合行跳过', () => {
    const { records, errors } = importChargingRows(ebike, 8, cats8)
    // 叮叮充 2 月 + 电信 1 月 = 3 条;小计/总计行(parseYearMonth → null)跳过
    expect(records.map(r => [r.cat, r.acctMonth])).toEqual([
      ['dingding', '2025-01'], ['dingding', '2025-02'], ['dianxin', '2025-01'],
    ])
    // fee 直取 incomeRaw(无手续费扣减)
    expect(records[0]).toMatchObject({ cat: 'dingding', acctMonth: '2025-01', kwh: 1205.49, fee: 3872.23, cost: 895.01 })
    // 小计/总计(matchByHeader 识别为 isSubtotal)静默跳过,不入 records 也不报错
    expect(errors.length).toBe(0)
  })

  it('汽车(no=7):fee = 充电收入金额 − 手续费及服务费金额,聚合(年/范围/小计/总计)跳过', () => {
    const { records, errors } = importChargingRows(car, 7, cats7)
    // 万城万 单月 10/11 + 小桔 10 = 3 条;2024年/2025年1-9月/小计/总计 跳过
    expect(records.map(r => [r.cat, r.acctMonth])).toEqual([
      ['wancheng', '2025-10'], ['wancheng', '2025-11'], ['xiaoju', '2025-10'],
    ])
    // 万城万 2025-10:fee = 9076.52 − 162.74 = 8913.78
    expect(records[0].fee).toBeCloseTo(8913.78, 2)
    expect(records[0].cost).toBeCloseTo(5395.08, 2)
    // 年/年范围(2024年 / 2025年1-9月)非 subtotal → 进 loop 报告跳过;小计/总计被 matchByHeader 静默跳过。
    expect(errors.length).toBe(2)
    expect(errors.every(e => /非单月行/.test(e.reason))).toBe(true)
  })

  it('未知运营商 → errors 跳过', () => {
    const m: string[][] = [
      c(['充电桩类别', '月份', '充电电量', '充电金额收入', '充电成本']),
      c(['未知商', '2025-01-01', '100', '300', '80']),
    ]
    const { records, errors } = importChargingRows(m, 8, cats8)
    expect(records.length).toBe(0)
    expect(errors.length).toBe(1)
    expect(errors[0].reason).toContain('未知运营商')
  })
})
