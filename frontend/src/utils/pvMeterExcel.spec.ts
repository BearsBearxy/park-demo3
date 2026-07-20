import { describe, it, expect } from 'vitest'
import {
  parsePvReadDate, parsePvMeterRows, buildPvMeterTemplateAoa, buildPvMeterMonthAoa,
  buildPvMeterDetailAoa, PV_METER_TEMPLATE_COLS,
} from './pvMeterExcel'

describe('parsePvReadDate — YYYY-MM-DD 与 Excel 序列双格式', () => {
  it('标准/变体日期串', () => {
    expect(parsePvReadDate('2026-07-01')).toBe('2026-07-01')
    expect(parsePvReadDate('2026/7/1')).toBe('2026-07-01')
    expect(parsePvReadDate('2026年7月1日')).toBe('2026-07-01')
    expect(parsePvReadDate('2026.7.31')).toBe('2026-07-31')
  })
  it('Excel 日期序列(数字与数字串)', () => {
    expect(parsePvReadDate(45658)).toBe('2025-01-01')     // 序列号 2025-01-01
    expect(parsePvReadDate('45658')).toBe('2025-01-01')
    expect(parsePvReadDate('46203')).toBe('2026-06-30')
  })
  it('非法输入 → null', () => {
    expect(parsePvReadDate('乱码')).toBeNull()
    expect(parsePvReadDate('2026-13-01')).toBeNull()      // 越界月
    expect(parsePvReadDate('2026-02-30')).toBeNull()      // 假日期(Date 溢出判非法)
    expect(parsePvReadDate('1999-01-01')).toBeNull()      // 越界年
    expect(parsePvReadDate('')).toBeNull()
    expect(parsePvReadDate(null)).toBeNull()
    expect(parsePvReadDate('7')).toBeNull()               // 裸月号非日期
  })
})

describe('parsePvMeterRows — 表头别名/行级错误不整批拦', () => {
  const header = ['期数', '楼栋', '日期', '发电总量(kWh)', '自消纳电量(kWh)', '上网电量(kWh)', '备注']

  it('标准表头:解析出后端契约字段,期数列不上传', () => {
    const { records, errors } = parsePvMeterRows([
      header,
      ['一期', 'B座', '2026-07-01', '1,250.50', '800', '450.5', '晴'],
    ])
    expect(errors).toEqual([])
    expect(records.length).toBe(1)
    expect(records[0]).toMatchObject({ station: 'B座', readDate: '2026-07-01', genTotal: 1250.5, selfUse: 800, gridFeed: 450.5, note: '晴' })
    expect(records[0]).not.toHaveProperty('phaseRaw')
    // __preview 与 templateCols 对齐(期数在预览首列)
    expect(records[0].__preview).toEqual(['一期', 'B座', '2026-07-01', 1250.5, 800, 450.5, '晴'])
  })

  it('别名表头命中:自销纳电量/上网量,日期吃 Excel 序列', () => {
    const { records, errors } = parsePvMeterRows([
      ['楼栋', '日期', '发电总量', '自销纳电量', '上网量'],
      ['8栋', '45658', '900', '700', '200'],
    ])
    expect(errors).toEqual([])
    expect(records[0]).toMatchObject({ station: '8栋', readDate: '2025-01-01', genTotal: 900, selfUse: 700, gridFeed: 200 })
  })

  it('别名表头命中:消纳电量(无「自」前缀变体)', () => {
    const { records } = parsePvMeterRows([
      ['楼栋', '抄表日期', '发电总量', '消纳电量', '上网电量'],
      ['创业大厦', '2026-07-15', '500', '400', '100'],
    ])
    expect(records[0]).toMatchObject({ station: '创业大厦', readDate: '2026-07-15', selfUse: 400 })
  })

  it('行级错误(非法日期/负电量)逐行报告,好行照常入列;合计行静默剔除', () => {
    const { records, errors } = parsePvMeterRows([
      header,
      ['一期', 'B座', '2026-07-01', '100', '80', '20', ''],
      ['一期', 'C、D座', '不是日期', '1', '1', '0', ''],
      ['二期', '8栋', '2026-07-01', '-5', '0', '0', ''],
      ['', '合计', '', '101', '81', '20', ''],
      ['三期', '工业大厦', '2026-07-02', '60', '', '', ''],   // 空量 → 0,合法
    ])
    expect(records.map(r => r.station)).toEqual(['B座', '工业大厦'])
    expect(records[1]).toMatchObject({ genTotal: 60, selfUse: 0, gridFeed: 0 })
    expect(errors.length).toBe(2)
    expect(errors[0].reason).toContain('日期无法识别')
    expect(errors[1].reason).toBe('电量不能为负')
    expect(errors.every(e => e.rowIndex >= 0)).toBe(true)   // 均为行级,不整批拦
  })

  it('表头识别失败 → rowIndex=-1 整批错误', () => {
    const { records, errors } = parsePvMeterRows([['B座', '2026-07-01', '1', '1', '0']])
    expect(records).toEqual([])
    expect(errors.length).toBe(1)
    expect(errors[0].rowIndex).toBe(-1)
  })
})

describe('buildPvMeterTemplateAoa — 模板结构', () => {
  it('表头 + 两行示例(真实种子站 B座/8栋),示例日期能被自家解析器吃下', () => {
    const aoa = buildPvMeterTemplateAoa()
    expect(aoa.length).toBe(3)
    expect(aoa[0]).toEqual(PV_METER_TEMPLATE_COLS)
    expect(aoa[1][1]).toBe('B座')
    expect(aoa[2][1]).toBe('8栋')
    for (const row of aoa.slice(1)) expect(parsePvReadDate(row[2])).toBeTruthy()
  })
  it('模板回导自洽:AOA 直接喂解析器 → 2 条零错误', () => {
    const { records, errors } = parsePvMeterRows(buildPvMeterTemplateAoa().map(r => r.map(String)))
    expect(errors).toEqual([])
    expect(records.map(r => r.station)).toEqual(['B座', '8栋'])
  })
})

describe('buildPvMeterMonthAoa — 月度汇总(一行一电站含收益)', () => {
  const stations = [
    { id: 1, name: 'B座', phase: 1, capacityKwp: 320.5, priceYuan: 0.65 },
    { id: 2, name: '8栋', phase: 2, capacityKwp: null, priceYuan: null },
  ]
  const rows = [
    { stationId: 1, genTotal: 100, selfUse: 80, gridFeed: 20, priceSnap: 0.65, revenue: 52 },
    { stationId: 1, genTotal: 200, selfUse: 100, gridFeed: 100, priceSnap: 0.5, revenue: null },  // revenue 缺省 → selfUse×priceSnap 兜底
  ]

  it('按站聚合三量+收益+条数,无数据站零值仍出行,末行合计', () => {
    const aoa = buildPvMeterMonthAoa(rows, stations, 2026, 7)
    expect(aoa[0]).toEqual(['光伏分栋抄表汇总 · 2026年7月'])
    expect(aoa[1]).toEqual(['期数', '电站', '装机容量(kWp)', '消纳单价(元/kWh)', '发电总量(kWh)', '自消纳电量(kWh)', '上网电量(kWh)', '消纳收益(元)', '抄表条数'])
    // B座:收益 = 52 + 100×0.5 = 102
    expect(aoa[2]).toEqual(['一期', 'B座', 320.5, 0.65, 300, 180, 120, 102, 2])
    // 8栋无数据:容量/单价空串,量全 0(盯漏抄)
    expect(aoa[3]).toEqual(['二期', '8栋', '', '', 0, 0, 0, 0, 0])
    expect(aoa[4]).toEqual(['合计 · 2 站', '', '', '', 300, 180, 120, 102, 2])
  })
})

describe('buildPvMeterDetailAoa — 明细 sheet(导入模板七列,可直接重导)', () => {
  const stations = [
    { id: 1, name: 'B座', phase: 1 },
    { id: 2, name: '8栋', phase: 2 },
  ]
  const rows = [
    { stationId: 2, readDate: '2026-07-31', genTotal: 900, selfUse: 700, gridFeed: 200, note: '月抄' },
    { stationId: 1, readDate: '2026-07-02', genTotal: 200, selfUse: 100, gridFeed: 100, note: null },
    { stationId: 1, readDate: '2026-07-01', genTotal: 100, selfUse: 80, gridFeed: 20, note: '晴' },
  ]

  it('表头=导入模板七列;行序=站序→日期升序;一行一记录', () => {
    const aoa = buildPvMeterDetailAoa(rows, stations)
    expect(aoa[0]).toEqual(PV_METER_TEMPLATE_COLS)
    expect(aoa.length).toBe(4)
    expect(aoa[1]).toEqual(['一期', 'B座', '2026-07-01', 100, 80, 20, '晴'])
    expect(aoa[2]).toEqual(['一期', 'B座', '2026-07-02', 200, 100, 100, ''])
    expect(aoa[3]).toEqual(['二期', '8栋', '2026-07-31', 900, 700, 200, '月抄'])
  })

  it('重导自洽(错价修正回路):明细 AOA 直接喂解析器 → 全行零错误,契约字段对齐', () => {
    const { records, errors } = parsePvMeterRows(buildPvMeterDetailAoa(rows, stations).map(r => r.map(String)))
    expect(errors).toEqual([])
    expect(records.map(r => r.station)).toEqual(['B座', 'B座', '8栋'])
    expect(records[0]).toMatchObject({ station: 'B座', readDate: '2026-07-01', genTotal: 100, selfUse: 80, gridFeed: 20, note: '晴' })
  })
})
