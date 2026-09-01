import { describe, expect, it } from 'vitest'
import { parseObsTime, parseWeatherRows, WEATHER_TEMPLATE_COLS } from './weatherExcel'

// 逐小时天气 CSV 解析(PV-ANALYSIS-SPEC §04)。关键列是**时间**,不是天气 ——
// 时间进 nameLabels 而不是 columnMap,否则 matchByHeader 会退到「天气」列当关键列,
// 天气为空的整点行会被静默丢掉(importHeaderMatch.ts:167 `if (!name) continue`)。

const HEAD = ['日期时间', '天气', '温度', '降水量', '湿度', '短波太阳辐射', '直射辐射', '散射太阳辐射']

describe('parseObsTime', () => {
  it('收 YYYY-MM-DD HH:mm 与带秒 / 斜杠 / T 分隔', () => {
    expect(parseObsTime('2026-08-01 09:00')).toBe('2026-08-01 09:00')
    expect(parseObsTime('2026-08-01 09:00:00')).toBe('2026-08-01 09:00')
    expect(parseObsTime('2026/8/1 9:00')).toBe('2026-08-01 09:00')
    expect(parseObsTime('2026-08-01T09:00')).toBe('2026-08-01 09:00')
  })
  it('Excel 日期序列带小数 = 当日的小时', () => {
    // 46235 = 2026-08-01;0.5 = 12:00
    expect(parseObsTime('46235.5')).toBe('2026-08-01 12:00')
  })
  it('非法与空 → null', () => {
    expect(parseObsTime('08/01/2026 09:00')).toBeNull()
    expect(parseObsTime('')).toBeNull()
    expect(parseObsTime(null)).toBeNull()
    expect(parseObsTime('2026-13-01 09:00')).toBeNull()   // 13 月
  })
})

describe('parseWeatherRows', () => {
  it('标准表头 → 8 个字段齐全', () => {
    const { records, errors } = parseWeatherRows([
      HEAD,
      ['2026-08-01 09:00', '晴', '31.5', '0', '62', '480.25', '300', '180.25'],
    ])
    expect(errors).toEqual([])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      obsTime: '2026-08-01 09:00', weatherTxt: '晴',
      tempC: 31.5, precipMm: 0, humidity: 62, ghi: 480.25, dni: 300, dhi: 180.25,
    })
  })

  it('别名命中:太阳辐射→ghi、气温→tempC、观测时间→关键列', () => {
    const { records, errors } = parseWeatherRows([
      ['观测时间', '天气现象', '气温', '降水', '相对湿度', '太阳辐射', 'DNI', 'DHI'],
      ['2026-08-01 10:00', '多云', '30', '1.2', '70', '400', '250', '150'],
    ])
    expect(errors).toEqual([])
    expect(records[0]).toMatchObject({ obsTime: '2026-08-01 10:00', weatherTxt: '多云', tempC: 30, ghi: 400 })
  })

  it('单位后缀被前缀匹配吃掉:短波太阳辐射(W/m²) / 温度(℃)', () => {
    const { records, errors } = parseWeatherRows([
      ['日期时间', '天气', '温度(℃)', '降水量(mm)', '湿度(%)', '短波太阳辐射(W/m²)', '直射辐射(W/m²)', '散射太阳辐射(W/m²)'],
      ['2026-08-01 11:00', '晴', '33', '0', '55', '620', '410', '210'],
    ])
    expect(errors).toEqual([])
    expect(records[0]).toMatchObject({ tempC: 33, ghi: 620, dni: 410, dhi: 210 })
  })

  it('非法时间 / 负辐射 = 行级错误(rowIndex≥0),合法行照收', () => {
    const { records, errors } = parseWeatherRows([
      HEAD,
      ['2026-08-01 12:00', '晴', '34', '0', '50', '700', '500', '200'],
      ['08/01/2026 13:00', '晴', '34', '0', '50', '700', '500', '200'],   // 非法时间
      ['2026-08-01 14:00', '晴', '34', '0', '50', '-5', '500', '200'],    // 负辐射
    ])
    expect(records).toHaveLength(1)
    expect(errors.map(e => e.rowIndex)).toEqual([1, 2])
    expect(errors[0].reason).toContain('时间')
    expect(errors[1].reason).toContain('负')
  })

  it('表头识别失败 = 整批错误 rowIndex=-1', () => {
    const { records, errors } = parseWeatherRows([
      ['甲', '乙', '丙'],
      ['1', '2', '3'],
    ])
    expect(records).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].rowIndex).toBe(-1)
  })

  // 关键列必须是时间:天气列留空的整点行**不能**消失。
  // 时间若误放进 columnMap,关键列会退到「天气」,这三行只剩 1 行(importHeaderMatch:167)
  it('天气列为空的行不丢 —— 关键列是时间不是天气', () => {
    const { records, errors } = parseWeatherRows([
      HEAD,
      ['2026-08-01 00:00', '', '26', '0', '80', '0', '0', '0'],
      ['2026-08-01 01:00', '', '25', '0', '82', '0', '0', '0'],
      ['2026-08-01 02:00', '', '25', '0', '83', '0', '0', '0'],
    ])
    expect(errors).toEqual([])
    expect(records).toHaveLength(3)
    expect(records.map(r => r.obsTime)).toEqual([
      '2026-08-01 00:00', '2026-08-01 01:00', '2026-08-01 02:00'])
  })

  // 上一条的加强版,也是真正危险的那条:导出常多带 风速/气压/能见度。
  // 时间若进了 columnMap,「风速」会被选成关键列,风速为空的行**静默消失**(不报错、不留痕)。
  it('多一列没映射的(风速)也不抢关键列 —— 风速与天气都为空的行仍在', () => {
    const { records, errors } = parseWeatherRows([
      [...HEAD, '风速'],
      ['2026-08-01 00:00', '', '26', '0', '80', '0', '0', '0', ''],
      ['2026-08-01 01:00', '', '25', '0', '82', '0', '0', '0', ''],
      ['2026-08-01 02:00', '晴', '25', '0', '83', '0', '0', '0', '2.1'],
    ])
    expect(errors).toEqual([])
    expect(records).toHaveLength(3)
  })

  it('模板列 = 8 列,时间在首列(与 __preview 的 name-first 对齐)', () => {
    expect(WEATHER_TEMPLATE_COLS).toHaveLength(8)
    expect(WEATHER_TEMPLATE_COLS[0]).toBe('日期时间')
  })
})
