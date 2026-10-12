/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
import { describe, it, expect } from 'vitest'
import {
  parsePvReadDate, parsePvMeterRows, readDateReason, buildPvMeterTemplateAoa, buildPvMeterMonthAoa,
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

describe('parsePvMeterRows — 表头别名/导不了的行解析时交 bad,不整批拦', () => {
  const header = ['期数', '楼栋', '日期', '发电总量(kWh)', '自消纳电量(kWh)', '上网电量(kWh)', '备注']

  it('标准表头:解析出后端契约字段,期数列不上传', () => {
    const { records, bad } = parsePvMeterRows([
      header,
      ['一期', 'B座', '2026-07-01', '1,250.50', '800', '450.5', '晴'],
    ])
    expect(bad).toEqual([])
    expect(records.length).toBe(1)
    expect(records[0]).toMatchObject({ station: 'B座', readDate: '2026-07-01', genTotal: 1250.5, selfUse: 800, gridFeed: 450.5, note: '晴' })
    expect(records[0]).not.toHaveProperty('phaseRaw')
    // __preview 与 templateCols 对齐(期数在预览首列)
    expect(records[0].__preview).toEqual(['一期', 'B座', '2026-07-01', 1250.5, 800, 450.5, '晴'])
  })

  it('别名表头命中:自销纳电量/上网量,日期吃 Excel 序列', () => {
    const { records, bad } = parsePvMeterRows([
      ['楼栋', '日期', '发电总量', '自销纳电量', '上网量'],
      ['8栋', '45658', '900', '700', '200'],
    ])
    expect(bad).toEqual([])
    expect(records[0]).toMatchObject({ station: '8栋', readDate: '2025-01-01', genTotal: 900, selfUse: 700, gridFeed: 200 })
  })

  it('别名表头命中:消纳电量(无「自」前缀变体)', () => {
    const { records } = parsePvMeterRows([
      ['楼栋', '抄表日期', '发电总量', '消纳电量', '上网电量'],
      ['创业大厦', '2026-07-15', '500', '400', '100'],
    ])
    expect(records[0]).toMatchObject({ station: '创业大厦', readDate: '2026-07-15', selfUse: 400 })
  })

  // 核对页逐行列出:row = 读进来的第几行(表头是第 1 行),cells 对齐预览列,原因用大白话(md-v2-flat 那两行)
  it('❗导不了的行交 bad:行号 + 原样内容 + 原因;好行照常入列,合计行静默剔除不算导不了', () => {
    const { records, bad, error } = parsePvMeterRows([
      header,
      ['一期', '1栋', '2026-09-10', '780.0', '600.0', '180.0', ''],
      ['二期', '7栋', '9月19', '640.2', '512.0', '128.2', ''],
      ['二期', '8栋', '2026/9/31', '588.0', '470.1', '117.9', '表计更换'],
      ['二期', '9栋', '2026-09-11', '-5', '0', '0', ''],
      ['', '合计', '', '2008.2', '1582.1', '426.1', ''],
      ['三期', '工业大厦', '2026-09-12', '60', '', '', ''],   // 空量 → 0,合法
    ])
    expect(error).toBeUndefined()
    expect(records.map(r => r.station)).toEqual(['1栋', '工业大厦'])
    expect(records[1]).toMatchObject({ genTotal: 60, selfUse: 0, gridFeed: 0 })
    expect(bad.map(b => [b.row, b.reason])).toEqual([[3, '日期认不出'], [4, '没有 9月31日'], [5, '电量不能是负数']])
    expect(bad[1].cells).toEqual(['二期', '8栋', '2026/9/31', '588', '470.1', '117.9', '表计更换'])
  })

  it('表头识别失败 → 整批 error,没有 bad', () => {
    const { records, bad, error } = parsePvMeterRows([['B座', '2026-07-01', '1', '1', '0']])
    expect(records).toEqual([])
    expect(bad).toEqual([])
    // md-v2-err:点名缺哪两列(弹窗再在前面带上文件名);不写「本期版面」「关键列(租户/姓名/月份)」
    expect(error).toBe('没找到「楼栋」和「日期」这两列。对照下面的样子改好表头，再选一次。')
  })
})

describe('readDateReason — 日期为什么认不出', () => {
  it('格式对、这一天不存在 → 没有 X月X日;其余 → 日期认不出 / 日期没填', () => {
    expect(readDateReason('2026/9/31')).toBe('没有 9月31日')
    expect(readDateReason('2026-02-30')).toBe('没有 2月30日')
    expect(readDateReason('9月19')).toBe('日期认不出')
    expect(readDateReason('2026-13-01')).toBe('日期认不出')
    expect(readDateReason('1999-01-01')).toBe('日期认不出')
    expect(readDateReason('')).toBe('日期没填')
  })
})

describe('buildPvMeterTemplateAoa — 模板结构', () => {
  it('表头 + 两行示例(站名 1号楼/2号楼),示例日期能被自家解析器吃下', () => {
    const aoa = buildPvMeterTemplateAoa()
    expect(aoa.length).toBe(3)
    expect(aoa[0]).toEqual(PV_METER_TEMPLATE_COLS)
    expect(aoa[1][1]).toBe('1号楼')
    expect(aoa[2][1]).toBe('2号楼')
    for (const row of aoa.slice(1)) expect(parsePvReadDate(row[2])).toBeTruthy()
  })
  it('模板回导自洽:AOA 直接喂解析器 → 2 条零错误', () => {
    const { records, bad } = parsePvMeterRows(buildPvMeterTemplateAoa().map(r => r.map(String)))
    expect(bad).toEqual([])
    expect(records.map(r => r.station)).toEqual(['1号楼', '2号楼'])
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
    const { records, bad } = parsePvMeterRows(buildPvMeterDetailAoa(rows, stations).map(r => r.map(String)))
    expect(bad).toEqual([])
    expect(records.map(r => r.station)).toEqual(['B座', 'B座', '8栋'])
    expect(records[0]).toMatchObject({ station: 'B座', readDate: '2026-07-01', genTotal: 100, selfUse: 80, gridFeed: 20, note: '晴' })
  })
})
