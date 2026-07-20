import { describe, it, expect } from 'vitest'
import {
  parseElecCostRows, buildElecCostTemplateAoa, buildElecCostMonthAoa, buildElecCostMetricsAoa,
  elecFeeLabel, ELEC_FEE_BY_LABEL, ELEC_SUB_BY_LABEL, ELEC_COST_TEMPLATE_COLS,
} from './elecCostExcel'

const header = ELEC_COST_TEMPLATE_COLS

describe('费项/拆分映射 — 前端单一事实源(镜像后端 ElecCostService)', () => {
  it('7 费项 + 别名(功率因素错别字/电表费用=用电费用同 key)', () => {
    expect(ELEC_FEE_BY_LABEL['工业分时电价']).toBe('tou_industrial')
    expect(ELEC_FEE_BY_LABEL['功率因素奖励']).toBe('pf_reward')   // 用户树状图原文错别字别名
    expect(ELEC_FEE_BY_LABEL['功率因数奖励']).toBe('pf_reward')
    expect(ELEC_FEE_BY_LABEL['电表费用']).toBe('usage')
    expect(ELEC_FEE_BY_LABEL['用电费用']).toBe('usage')
    expect(new Set(Object.values(ELEC_FEE_BY_LABEL)).size).toBe(7)
  })
  it('4 拆分名;elecFeeLabel:usage 按表类型出「电表费用/用电费用」', () => {
    expect(ELEC_SUB_BY_LABEL).toEqual({ 'B-G座': 'bg', 三期工业大厦: 't3_industry', A座: 'a', 三期创业大厦: 't3_chuangye' })
    expect(elecFeeLabel('usage', 'ops')).toBe('电表费用')
    expect(elecFeeLabel('usage', 'dorm')).toBe('用电费用')
    expect(elecFeeLabel('tou_industrial')).toBe('工业分时电价')
  })
})

describe('parseElecCostRows — 映射命中/月份双格式/行级错误不整批拦', () => {
  it('标准表头:后端契约字段 {meter,fee,split,month,amount,qty,note},中文名原样透传', () => {
    const { records, errors } = parseElecCostRows([
      header,
      ['一期总表', '工业分时电价', '', '2025-01', '850,000.50', '1,200,000', '电费单'],
    ])
    expect(errors).toEqual([])
    expect(records.length).toBe(1)
    expect(records[0]).toMatchObject({
      meter: '一期总表', fee: '工业分时电价', split: '', month: '2025-01',
      amount: 850000.5, qty: 1200000, note: '电费单',
    })
    // __preview 与 templateCols 对齐
    expect(records[0].__preview).toEqual(['一期总表', '工业分时电价', '', '2025-01', 850000.5, 1200000, '电费单'])
  })

  it('别名/直传 key 兼容:功率因素奖励(错别字)、电表费用、直传 fee_key/sub_key 都放行', () => {
    const { records, errors } = parseElecCostRows([
      header,
      ['二期总表', '功率因素奖励', '', '2025-02', '4200', '', ''],
      ['水泵房', '电表费用', '', '2025-02', '8000', '', ''],
      ['一期总表', 'commercial', 'a', '2025-02', '120000', '150000', ''],
    ])
    expect(errors).toEqual([])
    expect(records.map(r => r.fee)).toEqual(['功率因素奖励', '电表费用', 'commercial'])
    expect(records[2].split).toBe('a')
  })

  it('拆分行:中文拆分名命中;月份兼容 YYYY-MM 变体与 Excel 序列', () => {
    const { records, errors } = parseElecCostRows([
      header,
      ['一期总表', '商业用电', 'A座', '2025年3月', '120000', '', ''],
      ['一期总表', '工业分时电价', 'B-G座', '45658', '500000', '700000', ''],   // 序列号 2025-01-01
      ['一期总表', '工业基本电费', '三期工业大厦', '2025/4/1', '30000', '', ''],
    ])
    expect(errors).toEqual([])
    expect(records.map(r => [r.split, r.month])).toEqual([
      ['A座', '2025-03'], ['B-G座', '2025-01'], ['三期工业大厦', '2025-04'],
    ])
  })

  it('电量可空 → qty undefined(区别于 0);金额 0 合法', () => {
    const { records, errors } = parseElecCostRows([
      header,
      ['宿舍电表', '用电费用', '', '2025-01', '0', '', ''],
    ])
    expect(errors).toEqual([])
    expect(records[0].amount).toBe(0)
    expect(records[0].qty).toBeUndefined()
  })

  it('行级错误逐行报告(费项/拆分/月份/金额/电量),好行照常入列;合计行静默剔除', () => {
    const { records, errors } = parseElecCostRows([
      header,
      ['一期总表', '工业分时电价', '', '2025-01', '850000', '1200000', ''],
      ['一期总表', '乱费项', '', '2025-01', '1', '', ''],
      ['一期总表', '商业用电', '乱拆分', '2025-01', '1', '', ''],
      ['一期总表', '商业用电', '', '不是月份', '1', '', ''],
      ['一期总表', '商业用电', '', '2025-01', '', '', ''],          // 金额缺失
      ['一期总表', '商业用电', '', '2025-02', '-5', '', ''],        // 金额为负
      ['一期总表', '商业用电', '', '2025-03', '1', '乱电量', ''],
      ['合计', '', '', '', '851', '', ''],
      ['宿舍电表', '用电费用', '', '2025-01', '30000', '45000', ''],
    ])
    expect(records.map(r => r.meter)).toEqual(['一期总表', '宿舍电表'])
    expect(errors.map(e => e.reason)).toEqual([
      expect.stringContaining('费项无法识别'),
      expect.stringContaining('拆分无法识别'),
      expect.stringContaining('月份无法识别'),
      '金额缺失或为负',
      '金额缺失或为负',
      '电量无法识别(可留空)',
    ])
    expect(errors.every(e => e.rowIndex >= 0)).toBe(true)   // 均为行级,不整批拦
  })

  it('表头识别失败 → rowIndex=-1 整批错误', () => {
    const { records, errors } = parseElecCostRows([['一期总表', '工业分时电价', '2025-01', '1']])
    expect(records).toEqual([])
    expect(errors.length).toBe(1)
    expect(errors[0].rowIndex).toBe(-1)
  })
})

describe('buildElecCostTemplateAoa — 模板结构与回导自洽', () => {
  it('表头 + 示例行(真实种子表名),覆盖合计行/拆分行/电量可空', () => {
    const aoa = buildElecCostTemplateAoa()
    expect(aoa[0]).toEqual(ELEC_COST_TEMPLATE_COLS)
    const meters = aoa.slice(1).map(r => r[0])
    expect(meters).toContain('一期总表')
    expect(meters).toContain('宿舍电表')
    expect(meters).toContain('水泵房')
    expect(aoa.slice(1).some(r => r[2] !== '')).toBe(true)   // 至少一行拆分示例
  })
  it('模板回导自洽:AOA 直接喂解析器 → 全行零错误', () => {
    const { records, errors } = parseElecCostRows(buildElecCostTemplateAoa().map(r => r.map(String)))
    expect(errors).toEqual([])
    expect(records.length).toBe(buildElecCostTemplateAoa().length - 1)
  })
})

describe('buildElecCostMonthAoa — sheet1 电表分区镜像(含拆分行+来源标注列)', () => {
  const meters = [
    { id: 1, name: '一期总表', kind: 'master' },
    { id: 2, name: '宿舍电表', kind: 'dorm' },
    { id: 3, name: '水泵房', kind: 'ops' },
  ]
  const entries = [
    // 乱序给入:水泵房分摊在前,一期拆分行在前 → 断言按 表序→费项序→合计先拆分后 重排
    { meterId: 3, feeKey: 'allocated', amount: 4000, qty: null, note: null, source: 'simulated' },
    { meterId: 1, feeKey: 'commercial', subKey: 'a', amount: 120000, qty: 150000, note: null, source: 'import' },
    { meterId: 1, feeKey: 'tou_industrial', subKey: '', amount: 850000.456, qty: 1200000, note: '电费单', source: 'manual' },
    { meterId: 1, feeKey: 'commercial', subKey: 't3_chuangye', amount: 60000, qty: null, note: null, source: 'import' },
    { meterId: 3, feeKey: 'usage', subKey: '', amount: 8000, qty: null, note: '模拟:办公用电×0.8(假设)', source: 'simulated' },
    { meterId: 2, feeKey: 'usage', subKey: '', amount: 30000, qty: 45000, note: null, source: 'manual' },
  ]

  it('表头=模板七列+来源;行序=表序→费项序→拆分序;费项/拆分/来源出中文,ops usage 显示「电表费用」', () => {
    const aoa = buildElecCostMonthAoa(entries, meters, 2025, 1)
    expect(aoa[0]).toEqual(['电费成本 · 2025年1月'])
    expect(aoa[1]).toEqual([...ELEC_COST_TEMPLATE_COLS, '来源'])
    expect(aoa.slice(2)).toEqual([
      ['一期总表', '工业分时电价', '', '2025-01', 850000.46, 1200000, '电费单', '手工'],
      ['一期总表', '商业用电', 'A座', '2025-01', 120000, 150000, '', '导入'],
      ['一期总表', '商业用电', '三期创业大厦', '2025-01', 60000, '', '', '导入'],
      ['宿舍电表', '用电费用', '', '2025-01', 30000, 45000, '', '手工'],
      ['水泵房', '电表费用', '', '2025-01', 8000, '', '模拟:办公用电×0.8(假设)', '模拟'],
      ['水泵房', '分摊额度', '', '2025-01', 4000, '', '', '模拟'],
    ])
  })

  it('无费项行的电表不出行(占位行回导必报错)', () => {
    const aoa = buildElecCostMonthAoa([], meters, 2025, 1)
    expect(aoa.length).toBe(2)   // 仅标题+表头
  })

  it('回导自洽(导出→改→重导闭环):sheet1 AOA 直接喂解析器 → 全行零错误,尾缀来源列被忽略', () => {
    const { records, errors } = parseElecCostRows(buildElecCostMonthAoa(entries, meters, 2025, 1).map(r => r.map(String)))
    expect(errors).toEqual([])
    expect(records.length).toBe(entries.length)
    expect(records[0]).toMatchObject({ meter: '一期总表', fee: '工业分时电价', split: '', month: '2025-01', amount: 850000.46 })
    expect(records[0]).not.toHaveProperty('来源')
    // 拆分行往返:中文拆分名解析零损
    expect(records[1]).toMatchObject({ fee: '商业用电', split: 'A座' })
  })
})

describe('buildElecCostMetricsAoa — sheet2 派生指标', () => {
  it('一行一指标:数值空=缺源,missing 以「；」拼接', () => {
    const aoa = buildElecCostMetricsAoa([
      { key: 'parkElecProfit', label: '园区电费收益', value: 123456.789, formulaText: '收入−支出−光伏两项', missing: [] },
      { key: 'sellAgreementPnl', label: '售电协议损益', value: null, formulaText: '(公告价−执行价)×购电量', missing: ['缺电网公告电价,去参数配置', '缺第三方售电执行电价,去参数配置'] },
    ], 2025, 1)
    expect(aoa[0]).toEqual(['派生指标 · 2025年1月'])
    expect(aoa[1]).toEqual(['指标', '数值', '公式', '缺失源'])
    expect(aoa[2]).toEqual(['园区电费收益', 123456.79, '收入−支出−光伏两项', ''])
    expect(aoa[3]).toEqual(['售电协议损益', '', '(公告价−执行价)×购电量', '缺电网公告电价,去参数配置；缺第三方售电执行电价,去参数配置'])
  })
})
