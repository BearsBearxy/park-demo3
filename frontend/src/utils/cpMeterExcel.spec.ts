import { describe, it, expect } from 'vitest'
import {
  parseCpMeterRows, buildCpMeterTemplateAoa, buildCpMeterMonthAoa, CP_METER_TEMPLATE_COLS,
} from './cpMeterExcel'

// 日期解析器复用 parsePvReadDate(pvMeterExcel.spec.ts 已锁定全格式),此处只验双格式经行解析通路

describe('parseCpMeterRows — 表头别名/导不了的行解析时交 bad,不整批拦', () => {
  const header = ['运营商', '桩名', '日期', '充电量(kWh)', '手续费(元)', '收益(元)', '备注']

  it('标准表头:解析出后端契约字段,运营商列不上传', () => {
    const { records, bad } = parseCpMeterRows([
      header,
      ['小桔', '快充1', '2026-07-01', '1,250.50', '62.5', '1,000', '正常'],
    ])
    expect(bad).toEqual([])
    expect(records.length).toBe(1)
    expect(records[0]).toMatchObject({ station: '快充1', readDate: '2026-07-01', chargeKwh: 1250.5, fee: 62.5, revenue: 1000, note: '正常' })
    expect(records[0]).not.toHaveProperty('operatorRaw')
    // __preview 与 templateCols 对齐(运营商在预览首列)
    expect(records[0].__preview).toEqual(['小桔', '快充1', '2026-07-01', 1250.5, 62.5, 1000, '正常'])
  })

  it('别名表头命中:平台/充电桩/时间/服务费/收入,日期吃 Excel 序列', () => {
    const { records, bad } = parseCpMeterRows([
      ['平台', '充电桩', '时间', '充电量', '服务费', '收入'],
      ['万城万', '万城万', '45658', '900', '45', '720'],
    ])
    expect(bad).toEqual([])
    expect(records[0]).toMatchObject({ station: '万城万', readDate: '2025-01-01', chargeKwh: 900, fee: 45, revenue: 720 })
  })

  it('别名表头命中:站点作关键列,手续费及服务费走前缀匹配', () => {
    const { records } = parseCpMeterRows([
      ['站点', '日期', '充电量', '手续费及服务费', '收益'],
      ['慢充1', '2026/7/15', '500', '25', '400'],
    ])
    expect(records[0]).toMatchObject({ station: '慢充1', readDate: '2026-07-15', fee: 25 })
  })

  it('❗导不了的行交 bad:行号 + 原样内容 + 原因;好行照常入列,合计行静默剔除不算导不了', () => {
    const { records, bad } = parseCpMeterRows([
      header,
      ['小桔', '快充1', '2026-09-01', '100', '5', '80', ''],
      ['小桔', '慢充1', '9月2日', '1', '1', '0', ''],
      ['小桔', '慢充2', '2026-09-31', '12', '0.6', '9.6', ''],
      ['万城万', '万城万', '2026-09-01', '-5', '0', '0', '退款'],
      ['', '合计', '', '108', '6.6', '89.6', ''],
      ['小桔', '快充1', '2026-09-02', '60', '', '', ''],   // 空金额 → 0,合法
    ])
    expect(records.map(r => [r.station, r.readDate])).toEqual([['快充1', '2026-09-01'], ['快充1', '2026-09-02']])
    expect(records[1]).toMatchObject({ chargeKwh: 60, fee: 0, revenue: 0 })
    expect(bad.map(b => [b.row, b.reason])).toEqual([[3, '日期认不出'], [4, '没有 9月31日'], [5, '充电量、手续费、收益不能是负数']])
    expect(bad[2].cells).toEqual(['万城万', '万城万', '2026-09-01', '-5', '0', '0', '退款'])
  })

  it('表头识别失败 → 整批 error,没有 bad', () => {
    const { records, bad, error } = parseCpMeterRows([['快充1', '2026-07-01', '1', '1', '0']])
    expect(records).toEqual([])
    expect(bad).toEqual([])
    expect(error).toBeTruthy()
  })
})

describe('buildCpMeterTemplateAoa — 模板结构', () => {
  it('表头 + 两行示例(桩 快充1/慢充1)', () => {
    const aoa = buildCpMeterTemplateAoa()
    expect(aoa.length).toBe(3)
    expect(aoa[0]).toEqual(CP_METER_TEMPLATE_COLS)
    expect(aoa[1][1]).toBe('快充1')
    expect(aoa[2][1]).toBe('慢充1')
  })
  it('模板回导自洽:AOA 直接喂解析器 → 2 条零错误', () => {
    const { records, bad } = parseCpMeterRows(buildCpMeterTemplateAoa().map(r => r.map(String)))
    expect(bad).toEqual([])
    expect(records.map(r => r.station)).toEqual(['快充1', '慢充1'])
  })
})

describe('buildCpMeterMonthAoa — 月度汇总(一行一桩)', () => {
  const stations = [
    { id: 1, name: '快充1', operator: '小桔' },
    { id: 2, name: '慢充1', operator: '小桔' },
  ]
  const rows = [
    { stationId: 1, chargeKwh: 100, fee: 5, revenue: 80 },
    { stationId: 1, chargeKwh: 200.005, fee: 10, revenue: 160 },
  ]

  it('按桩聚合三金额+条数,无数据桩零值仍出行(盯漏录),末行合计', () => {
    const aoa = buildCpMeterMonthAoa(rows, stations, 2026, 7)
    expect(aoa[0]).toEqual(['充电桩分桩明细汇总 · 2026年7月'])
    expect(aoa[1]).toEqual(['桩名', '运营商', '充电量(kWh)', '手续费(元)', '收益(元)', '记录条数'])
    expect(aoa[2]).toEqual(['快充1', '小桔', 300.01, 15, 240, 2])   // round2
    expect(aoa[3]).toEqual(['慢充1', '小桔', 0, 0, 0, 0])
    expect(aoa[4]).toEqual(['合计 · 2 桩', '', 300.01, 15, 240, 2])
  })
})
