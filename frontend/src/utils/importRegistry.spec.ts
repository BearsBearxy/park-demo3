/* Copyright (c) 2026 Junyang. All rights reserved. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import * as XLSX from 'xlsx'
vi.mock('@/api/importLog', () => ({ importLogApi: { record: vi.fn().mockResolvedValue({}) } }))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn(), create: vi.fn() },
  ledgerApi: { import: vi.fn(), month: vi.fn() },
}))
vi.mock('@/api/budget', () => ({ budgetApi: { import: vi.fn(), all: vi.fn() } }))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: vi.fn() } }))
vi.mock('@/api/building', () => ({ buildingApi: { list: vi.fn() } }))
vi.mock('@/analysis/anaData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/analysis/anaData')>()),
  fetchPnlSummary: vi.fn().mockResolvedValue({ revenue: [] }),
}))
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { fetchPnlSummary } from '@/analysis/anaData'
import { isKnownPerm } from '@/nav/navAccess'
import { deriveStatus, runImport, parserProps, IMPORT_TYPES, type ImportCtx } from './importRegistry'
import http from '@/api/index'
import { importLogApi } from '@/api/importLog'
import { companyApi, ledgerApi } from '@/api/ledger'
import { budgetApi } from '@/api/budget'
import { s10Api } from '@/api/s10'
import { reportApi } from '@/api/report'
import type { ImportLogDTO } from '@/types/importLog'
import { tenantApi } from '@/api/tenant'
import { buildingApi } from '@/api/building'

describe('deriveStatus', () => {
  it('rejected when nothing imported and rows were refused', () => expect(deriveStatus({ imported: 0, skipped: 2, errors: [] })).toBe('rejected'))
  // 科目余额表某家期末全为 0:cells 滤空、这一段写进 0 格也没有一条报错 —— 不是被拒
  it('complete (not rejected) when nothing imported and nothing refused', () => expect(deriveStatus({ imported: 0, skipped: 0, errors: [] })).toBe('complete'))
  it('partial when some skipped', () => expect(deriveStatus({ imported: 5, skipped: 1, errors: [] })).toBe('partial'))
  it('partial when some errors', () => expect(deriveStatus({ imported: 5, skipped: 0, errors: [{ rowIndex: 1, label: 'x', reason: 'y' }] })).toBe('partial'))
  it('complete when clean', () => expect(deriveStatus({ imported: 5, skipped: 0, errors: [] })).toBe('complete'))
})

describe('IMPORT_TYPES catalog', () => {
  it('has the 24 expected keys', () => {
    expect(IMPORT_TYPES.map(t => t.key).sort()).toEqual(
      ['billingTerms', 'budget', 'contractFull', 'charging_7', 'charging_8', 'cpMeter', 'elec', 'elecCost', 'ledger', 'meter', 'office_13', 'office_14',
       'pnl_s1', 'pnl_s2', 'pnl_s3', 'pnl_s4', 'pnl_s5',
       'pv', 'pvMeter', 'report_bs', 'report_is', 'report_tb', 's10', 'salary'].sort())
  })

  // 导入中心清单照 ix-v2-main:五组、组内顺序;行名跟侧栏一字不差(U2,损益附表用侧栏名)
  it('❗分组 + 组内顺序 + 名字照图', () => {
    expect(IMPORT_TYPES.map(t => `${t.group}|${t.name}`)).toEqual([
      '出账 · 每月工序|园区抄表', '出账 · 每月工序|光伏抄表', '出账 · 每月工序|充电桩抄表',
      '记账 · 按月|月度台账', '记账 · 按月|附表10 销售收入', '记账 · 按月|附表12 工资明细',
      '记账 · 按年|附表6 光伏发电', '记账 · 按年|附表7 汽车充电桩', '记账 · 按年|附表8 电动车充电桩', '记账 · 按年|附表11 电费成本',
      '记账 · 按年|园区电费模型', '记账 · 按年|附表13 办公水电', '记账 · 按年|附表14 三期水电',
      '账簿与报表|利润表', '账簿与报表|资产负债表', '账簿与报表|科目余额表',
      '账簿与报表|附表1 租金损益', '账簿与报表|附表2 用电损益', '账簿与报表|附表3 用水损益',
      '账簿与报表|附表4 运管损益', '账簿与报表|附表5 费用支出', '账簿与报表|年度预算',
      '档案|合同 · 汇总册', '档案|合同 · 月度租金工作簿',
    ])
  })

  it('每类都有说明、规矩、两行小样(每行和表头一样宽)、去处与单位', () => {
    for (const t of IMPORT_TYPES) {
      expect(t.desc && t.sub && t.landing, t.key).toBeTruthy()
      expect(t.rules.length, t.key).toBeGreaterThan(0)
      expect(t.sample.rows.length, t.key).toBe(2)
      for (const r of t.sample.rows) expect(r.length, t.key).toBe(t.sample.head.length)
    }
    const pv = IMPORT_TYPES.find(t => t.key === 'pvMeter')!
    expect(pv.sub).toBe('各栋光伏每天的发电读数，导进光伏分栋抄表')
    expect(IMPORT_TYPES.find(t => t.key === 'cpMeter')!.sub).toBe('各桩每天的充电明细，导进充电桩分桩明细')
    expect(pv.sample.head).toEqual(['期数', '楼栋', '日期', '发电总量 kWh', '自消纳 kWh', '上网 kWh', '备注'])
    expect(IMPORT_TYPES.find(t => t.key === 'meter')!.rules).toEqual(
      ['整本抄表册：每个区的电、水各一张表，标题写年月', '直接粘一块也行，下一步问是哪个月哪个区', '同表同月再导，新数盖掉旧数', '没抄到的表记成漏抄'])
    expect(Object.fromEntries(IMPORT_TYPES.filter(t => t.unit !== '行').map(t => [t.key, t.unit])))
      .toEqual({ meter: '块表', ledger: '家', contractFull: '户', billingTerms: '户' })
  })

  it('❗弹窗标题下那句只在 registry 一处:parserProps 带出 sub', () => {
    expect(parserProps('pvMeter').sub).toBe('各栋光伏每天的发电读数，导进光伏分栋抄表')
    expect(parserProps('ledger', { year: 2026, month: 9 }).sub).toBe('一家公司一个月的收款台账')
  })
})

// ── 台账解析共用样例与工具 ──────────────────────────────────
type Rec = Record<string, unknown>
type ParseOut = { records?: Rec[]; sections?: { label: string; records: Rec[] }[]; error?: string }
const pad = (n: number) => Array.from({ length: n }, () => '')
// parseWorkbook 取用:粘贴路径等价于单 sheet 包装(与 FpImportModal.mapMatrix 同)
const parseWB = (props: Record<string, unknown>) =>
  props.parseWorkbook as (sheets: { name: string; matrix: string[][] }[]) => ParseOut
const parse = (props: Record<string, unknown>) => (m: string[][]) => parseWB(props)([{ name: '', matrix: m }])

// 创显 1月真实表(24 列宽,3 行表头,前置公司标记列/合计行/空名行/派生列)
// 列:0创显标记|1租户|2 12月结余|3~19 17费用列(其他费用标签在分组行)|20应收合计|21本月收款|22本月结余|23备注
const janMatrix: string[][] = [
  ['', '2025年1月园区费用明细表①', ...pad(22)],
  ['', '租户', '12月结余', ...pad(17), '本月应收合计', '本月收款', '本月结余', '备注'],
  [...pad(9), '办公室、厂房费用', '', '', '宿舍费用', '', '其他费用', '12月电费', '', '', '12月水费', ...pad(5)],
  ['', '', '', '厂房租金', '厂房企业管理服务费', '商铺、宿舍租金', '商铺企业管理服务费', '厂房基础设施维护费',
   '商铺、宿舍基础设施维护费', '电梯维护费', '变压器维护费', '土地使用税', '网络通讯费', '门禁设施维护费', '',
   '基本用电费', '基准电费', '电维护费', '基准水费', '水维护费', '', '', '', ''],
  ['创显', '成吉', '102.94', '12,588.80', '-', '-', '-', '892.80', '-', '159.00', '159.00', '-', '-', '-', '-',
   '-', '464.98', '305.73', '48.80', '8.87', '14,627.98', '14,627.98', '102.94', '电梯费用未支付'],
  ['创显', '戎合', '2,499,022.41', ...pad(19), '2,499,022.41', ''],
  ['创显', '丁天伦（天域）', '-', ...pad(17), '-', '', '-', ''],
  ['创显', '', '-', ...pad(21)],
  ['', ' 合计： ', '15,023,595.26', '2,853,273.29', '136,488.21', '152,745.94', '1,064.56', '49,574.83',
   '22,426.30', '4,088.58', '2,561.58', '13,511.55', '400.00', '0.00', '38,400.00', '20,077.98', '188,066.85',
   '34,634.45', '13,861.79', '763.42', '3,531,939.33', '3,679,494.97', '14,876,039.62', ''],
]

// 10月真实表(26 列,无标题行,列名变体:商铺租金/宿舍配套设施费/商铺基础设施维护费 走别名)
// 列:0租户|1 9月结余|2~15 14费用列|16其他费用(标签在分组行)|17~21 电水费|22应收合计|23本月收款|24本月结余|25备注
const octMatrix: string[][] = [
  ['租户', '9月结余', ...pad(20), '本月应收合计', '本月收款', '本月结余', '备注'],
  [...pad(11), '办公室、厂房费用', '', '', '宿舍费用', '', '其他费用', '9月电费', '', '', '9月水费', ...pad(5)],
  ['', '', '厂房租金', '厂房企业管理服务费', '商铺租金', '宿舍租金', '宿舍配套设施费', '商铺企业管理服务费',
   '厂房基础设施维护费', '商铺基础设施维护费', '宿舍基础设施维护费', '电梯维护费', '变压器维护费', '土地使用税',
   '网络通讯费', '门禁设施维护费', '', '基本用电费', '基准电费', '电维护费', '基准水费', '水维护费', '', '', '', ''],
  ['张丽莉（建杭）', '-', '', '', '5,459.33', '', '', '', '', '859.80', ...pad(8),
   '791.79', '64.04', '', '1.67', '7,176.63', '7,176.63', '', ''],
  ['传齐商铺', '-', '', '', '19,620.00', ...pad(17), '19,620.00', '19,620.00', '', ''],
  ['戎合', '2,499,022.41', ...pad(22), '2,499,022.41', ''],
  ['康建清（鼎瑞）', '', '', '', '', '1,253.75', '147.50', ...pad(10), '1,069.52', '', '', '80.98', '', '2,749.25', '', '', ''],
  [' 合计： ', '26,680,568.77', '2,817,291.24', ...pad(23)],
]

// ── 台账 parseWorkbook 平铺回归(创显 1月样例,原 customParse 用例原样保留) ──
describe('ledger parseWorkbook (创显 1月样例)', () => {
  it('解析出 3 条记录,空名行/合计行被丢弃', async () => {
    const res = await parse(parserProps('ledger', { year: 2025, month: 1 }))(janMatrix)
    expect(res.error).toBeUndefined()
    expect(res.records!.map(r => r.tenantName)).toEqual(['成吉', '戎合', '丁天伦（天域）'])
  })

  it('成吉:按表头对位取值,派生列/文件没有的宿舍 4 列不出现', async () => {
    const [r] = (await parse(parserProps('ledger', { year: 2025, month: 1 }))(janMatrix)).records!
    expect(r).toMatchObject({
      tenantName: '成吉', balancePrev: 102.94, factoryRent: 12588.8, factoryInfraMaint: 892.8,
      elevatorMaint: 159, transformerMaint: 159, officeOtherFee: 0,
      standardElectricity: 464.98, electricityMaint: 305.73, standardWater: 48.8, waterMaint: 8.87,
      totalCollected: 14627.98, note: '电梯费用未支付',
    })
    // 旧位置映射 bug 特征反断言:水维护费/基准电费绝不能吃到错位列的值
    expect(r.waterMaint).toBe(8.87)             // 而不是 102.94(本月结余)
    expect(r.standardElectricity).toBe(464.98)  // 而不是水维护费错位值
    // 结余链(2026-08-25):balancePrev 照常解析上送(吃不吃由后端按链上位置定);派生列仍不吃
    for (const k of ['totalReceivable', 'balanceEnd', 'dormRent', 'dormFacilitiesFee', 'dormInfraMaint', 'dormOtherFee'])
      expect(r).not.toHaveProperty(k)
  })

  it('戎合:balancePrev 带千分位解析(首现月作期初,由后端定夺),17 个费用列全为 0', async () => {
    const r = (await parse(parserProps('ledger', { year: 2025, month: 1 }))(janMatrix)).records![1]
    expect(r.balancePrev).toBe(2499022.41)
    const feeKeys = ['factoryRent', 'factoryMgmtFee', 'shopRent', 'shopMgmtFee', 'factoryInfraMaint', 'shopInfraMaint',
      'elevatorMaint', 'transformerMaint', 'landUseTax', 'networkFee', 'accessCtrlMaint', 'officeOtherFee',
      'basicElectricity', 'standardElectricity', 'electricityMaint', 'standardWater', 'waterMaint']
    for (const k of feeKeys) expect(r[k]).toBe(0)
  })

  it('每条记录带标题识别的 __ymDetected', async () => {
    const recs = (await parse(parserProps('ledger', { year: 2026, month: 3 }))(janMatrix)).records!
    for (const r of recs) expect(r.__ymDetected).toEqual({ year: 2025, month: 1 })
  })

  it('templateCols 含上月结余动态标签(month=2 → 1月结余)', () => {
    expect(parserProps('ledger', { year: 2025, month: 2 }).templateCols).toContain('1月结余')
  })

  it('无表头矩阵(只给数据行)→ 返回 error', async () => {
    const res = await parse(parserProps('ledger', { year: 2025, month: 1 }))(janMatrix.slice(4, 7))
    expect(res.error).toBeTruthy()
  })
})

// ── 台账 parseWorkbook:10月 26 列样例(列名变体走别名,规范§一事故二回归) ──
describe('ledger parseWorkbook (10月 26 列样例)', () => {
  const P = () => parse(parserProps('ledger', { year: 2025, month: 10 }))

  it('4 条记录,合计行丢弃;无标题行 → 无 __ymDetected', async () => {
    const res = await P()(octMatrix)
    expect(res.error).toBeUndefined()
    expect(res.records!.map(r => r.tenantName)).toEqual(['张丽莉（建杭）', '传齐商铺', '戎合', '康建清（鼎瑞）'])
    for (const r of res.records!) expect(r.__ymDetected).toBeUndefined()
  })

  it('张丽莉:别名列(商铺租金/商铺基础设施维护费)与电水费按表头对位,派生列不出现', async () => {
    const [r] = (await P()(octMatrix)).records!
    expect(r).toMatchObject({
      shopRent: 5459.33, shopInfraMaint: 859.8, standardElectricity: 791.79,
      electricityMaint: 64.04, waterMaint: 1.67, totalCollected: 7176.63,
    })
    for (const k of ['totalReceivable', 'balanceEnd']) expect(r).not.toHaveProperty(k)
  })

  it('传齐商铺:修复前该行全零被跳,现 shopRent=19620', async () => {
    expect((await P()(octMatrix)).records![1].shopRent).toBe(19620)
  })

  it('戎合:balancePrev 捕获(9月结余列)', async () => {
    expect((await P()(octMatrix)).records![2].balancePrev).toBe(2499022.41)
  })

  it('康建清:宿舍租金主 label + 宿舍配套设施费别名', async () => {
    const r = (await P()(octMatrix)).records![3]
    expect(r).toMatchObject({ dormRent: 1253.75, dormFacilitiesFee: 147.5, basicElectricity: 1069.52, standardWater: 80.98 })
  })

  it('跨月 sheet:标题 2025年11月 + 表头「10月结余」→ balancePrev 按 sheet 年月动态标签捕获(复审②)', async () => {
    const nov = [
      ['2025年11月园区费用明细表', ...pad(25)],
      ...octMatrix.map(row => row.map(c => (c === '9月结余' ? '10月结余' : c))),
    ]
    const res = await P()(nov)   // 屏上下文 2025年10月(prev=9),不得影响该 sheet 的结余列
    const rong = res.records!.find(r => r.tenantName === '戎合')!
    expect(rong.balancePrev).toBe(2499022.41)
    expect(rong.__ymDetected).toEqual({ year: 2025, month: 11 })
  })
})

// ── 台账段内同名租户合并 + 垃圾行过滤(规范§八/§九 v4,事故四/五) ──
describe('ledger 段内同名合并与垃圾行过滤 (v4)', () => {
  const P = () => parse(parserProps('ledger', { year: 2025, month: 1 }))

  // B2 式段:行1=调整行(12月结余/本月收款均 -2,082.41,费用全空)+ 行2=同名费用行(收款 935.71)
  const dupMatrix: string[][] = [
    ['2025年1月园区费用明细表', ...pad(6)],
    ['租户', '12月结余', '商铺、宿舍租金', '商铺企业管理服务费', '基准电费', '本月收款', '备注'],
    ['万众宿舍', '-2,082.41', '', '', '', '-2,082.41', '结余调整'],
    ['万众宿舍', '', '621.01', '73.06', '131.50', '935.71', '陆续退租'],
    ['单行户', '', '100.00', '', '', '100.00', ''],
    [' 合计： ', '-2,082.41', '721.01', '73.06', '131.50', '-1,046.70', ''],
  ]

  it('万众宿舍双行 → 单条:数值逐列相加,note 拼接,单行租户不受影响', async () => {
    const res = await P()(dupMatrix)
    expect(res.error).toBeUndefined()
    expect(res.records!.map(r => r.tenantName)).toEqual(['万众宿舍', '单行户'])   // 首现位置保序
    const [wz, single] = res.records!
    expect(wz.balancePrev).toBe(-2082.41)   // 同名合并:结余列逐列相加
    expect(wz.totalCollected).toBeCloseTo(-1146.7, 2)   // = -2082.41 + 935.71
    expect(wz).toMatchObject({ shopRent: 621.01, shopMgmtFee: 73.06, standardElectricity: 131.5 })   // 费用 = 行2 值(行1 空=0)
    expect(wz.note).toBe('结余调整；陆续退租')
    expect(wz.__ymDetected).toEqual({ year: 2025, month: 1 })   // 年月识别在合并后照常挂行
    expect(single).toMatchObject({ tenantName: '单行户', shopRent: 100, totalCollected: 100 })
  })

  it('三行同名逐列加总', async () => {
    const m: string[][] = [
      ['租户', '商铺、宿舍租金', '本月收款'],
      ['甲', '1', '10'],
      ['甲', '2', '20'],
      ['甲', '3', '30'],
    ]
    const res = await P()(m)
    expect(res.records!.length).toBe(1)
    expect(res.records![0]).toMatchObject({ tenantName: '甲', shopRent: 6, totalCollected: 60 })
  })

  it('台账垃圾行被跳(「0」伪租户/「202510二期」合计行)', async () => {
    const m: string[][] = [
      ['租户', '商铺、宿舍租金', '本月收款'],
      ['甲', '1', '10'],
      ['0', '0', '0'],
      ['202510二期', '1', '10'],
    ]
    expect((await P()(m)).records!.map(r => r.tenantName)).toEqual(['甲'])
  })
})

// ── 台账 parseWorkbook 整册拆段(规范§二) ──────────────────────
describe('ledger parseWorkbook 整册拆段', () => {
  const ctx = { year: 2025, month: 1, companyName: '创显', companyNames: ['创显', '一泽'] }

  it('双 sheet → 两段:A 公司=创显(标记列)+__ym,B 公司=一泽(sheet名)+年月未识别标注', async () => {
    const res = await parseWB(parserProps('ledger', ctx))([
      { name: '①', matrix: janMatrix },
      { name: '一泽', matrix: octMatrix },
    ])
    expect(res.error).toBeUndefined()
    expect(res.records).toBeUndefined()
    expect(res.sections!.length).toBe(2)
    const [a, b] = res.sections!
    expect(a.label).toBe('创显 · 2025年1月')
    expect(a.records.map(r => r.tenantName)).toEqual(['成吉', '戎合', '丁天伦（天域）'])
    for (const r of a.records) {
      expect(r.__company).toBe('创显')
      expect(r.__ym).toEqual({ year: 2025, month: 1 })
    }
    expect(b.label).toBe('一泽 · 2025年1月(未识别,用当前)')
    for (const r of b.records) {
      expect(r.__company).toBe('一泽')
      expect(r.__ym).toBeUndefined()
    }
  })

  it('单 sheet(有记录的仅 1 个)→ 平铺 records,无 __company', async () => {
    const res = await parseWB(parserProps('ledger', { year: 2025, month: 10, companyNames: ['创显', '一泽'] }))([
      { name: '一泽', matrix: octMatrix },
    ])
    expect(res.sections).toBeUndefined()
    expect(res.records!.length).toBe(4)
    expect(res.records![0]).not.toHaveProperty('__company')
  })

  it('公司识别只扫租户列左侧:备注整列同文本不会被误判成公司(复审①)', async () => {
    const noted = octMatrix.map((row, i) => {
      if (i < 3 || i > 6) return [...row]
      const r = [...row]; r[25] = '欠费'; return r   // 4 条数据行备注全同文本
    })
    const res = await parseWB(parserProps('ledger', ctx))([
      { name: '①', matrix: janMatrix },
      { name: 'x', matrix: noted },
    ])
    const [, b] = res.sections!
    expect(b.label.startsWith('欠费')).toBe(false)
    expect(b.label.startsWith('创显')).toBe(true)   // 标记列/sheet 名都未命中 → 回退 ctx.companyName
    expect(b.records[0].__company).toBeUndefined()
  })
})

// ── 台账 parseWorkbook 同 sheet 多月纵向堆叠拆块(规范§五 v3,事故三) ──
describe('ledger parseWorkbook 同 sheet 多月堆叠', () => {
  // 2月块:标题「明细表」锚 + 与 janMatrix 同构表头,结余列名「1月结余」
  const febBlock: string[][] = [
    ['', '2025年2月园区费用明细表①', ...pad(22)],
    ['', '租户', '1月结余', ...pad(17), '本月应收合计', '本月收款', '本月结余', '备注'],
    [...pad(9), '办公室、厂房费用', '', '', '宿舍费用', '', '其他费用', '1月电费', '', '', '1月水费', ...pad(5)],
    janMatrix[3],
    ['创显', '甲', '100.50', '2,000.00', ...pad(16), '2,100.50', '2,000.00', '100.50', ''],
    ['创显', '乙', '-', ...pad(19), '-', ''],
    ['', ' 合计： ', '100.50', '2,000.00', ...pad(20)],
  ]

  it('单 sheet 双块(1月+2月堆叠)→ 2 段,2月段 balancePrev 按块年月从「1月结余」捕获', async () => {
    const res = await parse(parserProps('ledger', { year: 2025, month: 1, companyName: '创显' }))([...janMatrix, ...febBlock])
    expect(res.error).toBeUndefined()
    expect(res.records).toBeUndefined()
    expect(res.sections!.length).toBe(2)
    const [a, b] = res.sections!
    expect(a.label).toBe('创显 · 2025年1月')
    expect(a.records.map(r => r.tenantName)).toEqual(['成吉', '戎合', '丁天伦（天域）'])
    for (const r of a.records) expect(r.__ym).toEqual({ year: 2025, month: 1 })
    expect(b.label).toBe('创显 · 2025年2月')
    expect(b.records.map(r => r.tenantName)).toEqual(['甲', '乙'])
    expect(b.records[0]).toMatchObject({ balancePrev: 100.5, factoryRent: 2000, totalCollected: 2000 })
    for (const r of b.records) expect(r.__ym).toEqual({ year: 2025, month: 2 })
  })

  it('数据行备注引用「…明细表」不误切块(复审:标题式锚+行非空数≤3 双保险)', async () => {
    // 变体1:备注有前缀(不以年月开头)→ 锚① 拦;变体2:备注以年月开头 → 行非空数>3 的守卫② 拦
    for (const note of ['费用参见2024年12月园区费用明细表附页', '2024年12月园区费用明细表欠费']) {
      const noted = octMatrix.map((row, i) => {
        if (i !== 4) return [...row]              // 传齐商铺行(中部数据行)
        const r = [...row]; r[25] = note; return r
      })
      const res = await parse(parserProps('ledger', { year: 2025, month: 10 }))(noted)
      expect(res.error).toBeUndefined()
      expect(res.records!.length).toBe(4)         // 不被切块,零丢行
      expect(res.sections).toBeUndefined()
    }
  })

  // 真实文件集成回归(事故三原件):单 sheet 873 行,实测结构 = 6 公司块 × 2 个月(2025年1月/10月)
  // 纵向堆叠共 12 块(公司名取自各块前置标记列);修复前 matchByHeader 只解析最后一段 22 行,余者无告警丢弃
  const REAL_FILE = 'C:/financial_dashboard/2025全年发生额、预算对比/台账测试.xlsx'
  it.skipIf(!fs.existsSync(REAL_FILE))('真实文件 台账测试.xlsx → 12 块全解析、无丢段', async () => {
    // 与 FpImportModal 同参读取(cellDates + header:1/blankrows:false/defval:''/raw:false/dateNF)
    const wb = XLSX.read(fs.readFileSync(REAL_FILE), { cellDates: true })
    const sheets = wb.SheetNames.map(name => ({
      name,
      matrix: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: '', raw: false, dateNF: 'yyyy-mm-dd' }) as string[][],
    }))
    const res = await parseWB(parserProps('ledger', { year: 2025, month: 1 }))(sheets)
    expect(res.error).toBeUndefined()
    expect(res.sections!.length).toBe(12)
    for (const s of res.sections!) expect(s.label).toMatch(/^(创显|B2|帮管好|一泽|积前|创燊高) · 2025年(1|10)月$/)
    // 创显 10月 107 条 = 事故二真实导入行数,交叉印证块切分与表头对位无错位
    expect(res.sections!.find(s => s.label === '创显 · 2025年10月')!.records.length).toBe(107)
    // v4 同名合并:全文件唯一重名 = B2·1月万众宿舍双行并 1 条(789→788),调整行不再 last-wins 丢失(规范§八)
    expect(res.sections!.reduce((n, s) => n + s.records.length, 0)).toBe(788)
    const wz = res.sections!.find(s => s.label === 'B2 · 2025年1月')!.records.filter(r => r.tenantName === '万众宿舍')
    expect(wz.length).toBe(1)
    expect(wz[0].balancePrev).toBe(-2082.41)
    expect(wz[0].totalCollected as number).toBeCloseTo(-1146.7, 2)
  })
})

// ── 台账 run:Pick[] 段分支(逐段公司解析/新建、年月回退、聚合) ──
describe('ledger run — Pick[] 段分支', () => {
  const entry = IMPORT_TYPES.find(t => t.key === 'ledger')!
  beforeEach(() => vi.clearAllMocks())

  it('逐段:公司精确匹配/未匹配新建/无公司用 ctx,年月未识别回退 ctx,剥 __ 键,聚合结果', async () => {
    vi.mocked(companyApi.list).mockResolvedValue([{ id: 1, name: '创显' }] as never)
    vi.mocked(companyApi.create).mockResolvedValue({ id: 9, name: '一泽' } as never)
    vi.mocked(ledgerApi.import)
      .mockResolvedValueOnce({ imported: 2, skipped: 0, errors: [] })
      .mockResolvedValueOnce({ imported: 1, skipped: 1, errors: [{ rowIndex: 0, label: 'x', reason: 'r' }] })
      .mockResolvedValueOnce({ imported: 1, skipped: 0, errors: [] })
    const picks = [
      { label: '创显 · 2025年1月', records: [{ tenantName: '成吉', shopRent: 5, __company: '创显', __ym: { year: 2025, month: 1 } }] },
      { label: '一泽 · 2026年3月(未识别,用当前)', records: [{ tenantName: '张丽莉', dormRent: 3, __company: '一泽' }] },
      { label: '当前公司 · 2026年3月(未识别,用当前)', records: [{ tenantName: '甲' }] },   // 无 __company → ctx.companyId
    ]
    const res = await entry.run(picks, { companyId: 5, year: 2026, month: 3 })
    expect(companyApi.list).toHaveBeenCalledTimes(1)
    expect(companyApi.create).toHaveBeenCalledWith('一泽', true)   // 建公司也不出底部全局提示
    expect(ledgerApi.import).toHaveBeenNthCalledWith(1, 1, 2025, 1, { rows: [{ tenantName: '成吉', shopRent: 5 }] })
    expect(ledgerApi.import).toHaveBeenNthCalledWith(2, 9, 2026, 3, { rows: [{ tenantName: '张丽莉', dormRent: 3 }] })
    expect(ledgerApi.import).toHaveBeenNthCalledWith(3, 5, 2026, 3, { rows: [{ tenantName: '甲' }] })
    expect(res).toEqual({ imported: 4, skipped: 1, errors: [{ rowIndex: 0, label: 'x', reason: 'r' }] })
  })

  it('平铺 ImportRec[] 仍走单次 import(剥 __ymDetected,公司/年月用 ctx)', async () => {
    vi.mocked(ledgerApi.import).mockResolvedValue({ imported: 1, skipped: 0, errors: [] })
    await entry.run([{ tenantName: '甲', shopRent: 1, __ymDetected: { year: 2025, month: 1 } }], { companyId: 7, year: 2025, month: 2 })
    expect(companyApi.list).not.toHaveBeenCalled()
    expect(ledgerApi.import).toHaveBeenCalledWith(7, 2025, 2, { rows: [{ tenantName: '甲', shopRent: 1 }] })
  })
})

// ── budget run:勾选年段平铺成单 payload,一次 import 聚合(解析器单测见 importBudget.spec.ts) ──
// RBAC v4:每块导入磁贴挂它导进去的那一屏的写权(§15.7),键名打错字当场红
describe('导入类型的权限 = 目标屏的写权', () => {
  const mod = (key: string) => IMPORT_TYPES.find(t => t.key === key)!.module
  it('每条都非空,且都是认得的屏级写权', () => {
    for (const t of IMPORT_TYPES) {
      expect(t.module.length, t.key).toBeGreaterThan(0)
      for (const p of t.module) expect(isKnownPerm(p) && !p.endsWith(':view'), `${t.key} ${p}`).toBe(true)
    }
  })
  it('同族的几块各归各的屏', () => {
    expect([mod('charging_7'), mod('charging_8')]).toEqual([['car-charging:edit'], ['ebike-charging:edit']])
    expect(['pnl_s1', 'pnl_s2', 'pnl_s3', 'pnl_s4', 'pnl_s5'].map(mod)).toEqual(
      [['rent-pnl:edit'], ['elec-pnl:edit'], ['water-pnl:edit'], ['ops-pnl:edit'], ['expense-pnl:edit']])
    expect(['report_is', 'report_bs', 'report_tb'].map(mod)).toEqual(
      [['income-statement:edit'], ['balance-sheet:edit'], ['trial-balance:edit']])
    expect(mod('cpMeter')).toEqual(['car-charging:reading', 'ebike-charging:reading'])
    expect(mod('budget')).toEqual(['import:edit'])
  })
})

// 预算弹窗打开时预取五张损益附表的收入合计做核对(fetchPnlSummary 一次拉五张,缺一张整个失败)。
// 读规则不对导入中心放行 /api/pnl/**:少一张查看就不取,弹窗上说这次不核对(RBAC §15.7)。
describe('budget modalProps — 损益附表收入核对按查看权', () => {
  const entry = IMPORT_TYPES.find(t => t.key === 'budget')!
  const PNL_VIEWS = ['rent-pnl:view', 'elec-pnl:view', 'water-pnl:view', 'ops-pnl:view', 'expense-pnl:view']
  const NOTE = '有的损益附表你看不了，这次导入不拿它们的收入合计核对预算。'
  beforeEach(() => { setActivePinia(createPinia()); vi.mocked(fetchPnlSummary).mockClear() })

  const warnOf = (p: Record<string, unknown>) =>
    (p.parseWorkbook as (s: { name: string; matrix: string[][] }[]) => { warning?: string })([{ name: '', matrix: [['乱']] }]).warning ?? ''

  // 破坏验证:canPnl 恒真(不判查看就取)→ 第一条红;解析结果不拼那一句 → 第一条红
  it('❗少一张损益附表查看:不预取,核对页提示条说这次不核对', () => {
    useAuthStore().permissions = ['import:edit', ...PNL_VIEWS.slice(0, 4)]
    const p = entry.modalProps({})
    expect(fetchPnlSummary).not.toHaveBeenCalled()
    expect(warnOf(p)).toContain(NOTE)
  })

  it('五张都看得了:按年预取,提示条不多那一句', () => {
    useAuthStore().permissions = ['import:edit', ...PNL_VIEWS]
    const p = entry.modalProps({})
    expect(fetchPnlSummary).toHaveBeenCalled()
    expect(warnOf(p)).not.toContain(NOTE)
  })
})

describe('budget run — 年段平铺', () => {
  const entry = IMPORT_TYPES.find(t => t.key === 'budget')!
  beforeEach(() => vi.clearAllMocks())

  it('多年段 flatten 后单次调 budgetApi.import', async () => {
    vi.mocked(budgetApi.import).mockResolvedValue({ imported: 3, skipped: 0, errors: [] })
    const picks = [
      { label: '2024 预算 0 条 / 发生额 2 条', records: [
        { year: 2024, label: '收入总计', sub: false, actual: 82867520.26, sortOrder: 0 },
        { year: 2024, label: '利润总额', sub: false, actual: 22593088.17, sortOrder: 4 },
      ] },
      { label: '2025 预算 1 条 / 发生额 0 条', records: [
        { year: 2025, label: '收入总计', sub: false, budget: 92705202.87, note: '详见《主营收入预算》', sortOrder: 0 },
      ] },
    ]
    const res = await entry.run(picks, {})
    expect(budgetApi.import).toHaveBeenCalledTimes(1)
    expect(budgetApi.import).toHaveBeenCalledWith({ rows: [...picks[0].records, ...picks[1].records] })
    expect(res.imported).toBe(3)
  })

  it('空 picks → 不打 API,返回空聚合', async () => {
    const res = await entry.run([], {})
    expect(budgetApi.import).not.toHaveBeenCalled()
    expect(res).toEqual({ imported: 0, skipped: 0, errors: [] })
  })
})

// ── meter:v2 主数据接线(METER-SPEC §6.2/§6.3)——modalProps 预取模块缓存(带 id);视图喂的 ctx.tenantNames/buildings 作后备 ──
// 注意用例顺序:后备用例须先跑(预取失败缓存保持空);预取成功后模块缓存在位,后续解析走缓存
describe('meter v2 主数据接线', () => {
  beforeEach(() => vi.clearAllMocks())
  const sheet = { name: '一期园区水', matrix: [
    ['', '2025年3月一期园区水表抄表记录'],
    ['', '区域', '', '企业名称', '表类', '水表名称', '水表编码', '水表倍率', '上月行至', '本月行至', '备注'],
    ['力灏水', 'B座', '', '1-3楼（力灏）', '户内用水', '水表①', '', '1', '10', '20', ''],
  ] }

  it('预取失败 → 后备 ctx.tenantNames/buildings:按名拆分命中但 tenantId 空,楼栋照挂', async () => {
    vi.mocked(tenantApi.list).mockRejectedValue(new Error('net'))
    vi.mocked(buildingApi.list).mockRejectedValue(new Error('net'))
    const ctx: ImportCtx = { tenantNames: ['力灏'], buildings: [{ id: 2, name: '一期 B座' }] }
    const props = parserProps('meter', ctx)
    expect(tenantApi.list).toHaveBeenCalledTimes(1)
    await new Promise(r => setTimeout(r, 0))
    const res = parseWB(props)([sheet])
    expect(res.records![0]).toMatchObject({ tenantId: null, buildingId: 2, ownership: 'tenant', spot: '1-3楼' })
    expect(res.records![0].__preview).toEqual(['一期 B座', '1-3楼', '力灏', 1, 10, 20, 10])
  })

  // 账期降级接线(用户 2026-07-29 报障):补录条默认账期 = 屏上下文年月;裸数据块按补录值落库
  it('fallbackPicker 默认账期取 ctx.year/month;裸数据块按补录值解析', () => {
    const props = parserProps('meter', { year: 2099, month: 7 })
    expect(props.fallbackPicker).toMatchObject({ ym: '2099-07', zone: 'p1', kind: 'elec' })
    // 改前区选项写死 p1/p2/p3/dorm、识别用 ctx.zones,两边不同源:现在同一份(没给清单回落写死三区)
    expect((props.fallbackPicker as { zones: unknown[] }).zones).toEqual(
      [{ value: 'p1', label: '一期' }, { value: 'p2', label: '二期' }, { value: 'dorm', label: '宿舍' }])
    const bare = [
      ['区域', '', '企业名称', '表类', '电表名称', '电表编码', '电表倍率', '上月行至', '本月行至', '备注'],
      ['一车间', '101室', '力灏', '户内用电', '电表①', '230220001238', '1', '100', '160', ''],
    ]
    const wb = props.parseWorkbook as (s: { name: string; matrix: string[][] }[], fb?: { ym: string; zone: string; kind: string }) => ParseOut
    const res = wb([{ name: '', matrix: bare }], { ym: '2099-07', zone: 'p2', kind: 'elec' })
    expect(res.records![0]).toMatchObject({ ym: '2099-07', zone: 'p2', kind: 'elec' })
    expect(wb([{ name: '', matrix: bare }]).error).toContain('看不出是哪个月')
  })

  it('预取成功 → 模块缓存(带 id)优先,拆分挂 tenantId/buildingId', async () => {
    vi.mocked(tenantApi.list).mockResolvedValue([{ id: 11, companyName: '力灏' }] as never)
    vi.mocked(buildingApi.list).mockResolvedValue([{ id: 2, name: '一期 B座' }] as never)
    const props = parserProps('meter', {})
    await new Promise(r => setTimeout(r, 0))   // flush 预取微任务
    expect(parseWB(props)([sheet]).records![0]).toMatchObject({ tenantId: 11, buildingId: 2, ownership: 'tenant' })
  })

  // ── 端到端接线钉子(T8 fix round 1):ctx.zones 必须真的走到 parseMeterWorkbook,不能只是 meterExcel.ts
  //    自己的纯函数支持它——之前的漏洞正是「函数认得三期,但从没被喂过三期清单」。视图侧(MeterView/
  //    ImportCenterView)如何填 ctx.zones 各走各的 API,这里只钉 registry 这一段:ctx.zones 进→sheet 识别出。
  it('ctx.zones 透传到 parseMeterWorkbook:三期清单一给,三期 sheet 就认得出', () => {
    const t3Sheet = { name: '三期园区电', matrix: [
      ['', '2026年3月三期园区电表抄表记录'],
      ['', '区域', '', '企业名称', '表类', '电表名称', '电表编码', '电表倍率', '上月行至', '', '', '', '', '本月行至', '', '', '', '', '备注'],
      ['', '', '', '', '', '', '', '', '总', '尖', '峰', '平', '谷', '总', '尖', '峰', '平', '谷', ''],
      ['三期总电', '三车间', '', '', '总电表', '总电表', '230828010021', '80', '10', '', '', '', '', '12', '', '', '', '', ''],
    ] }
    const ctx: ImportCtx = { zones: [
      { code: 'p1', name: '一期' }, { code: 'p2', name: '二期' }, { code: 'p3', name: '三期' }, { code: 'dorm', name: '宿舍' },
    ] }
    const props = parserProps('meter', ctx)
    const res = parseWB(props)([t3Sheet])
    expect(res.records![0]).toMatchObject({ zone: 'p3', kind: 'elec', ym: '2026-03' })
    // ❗补问框的区选项与识别同一份清单:三期认得出,也选得到
    expect((props.fallbackPicker as { zones: { value: string }[] }).zones.map(z => z.value)).toEqual(['p1', 'p2', 'p3', 'dorm'])
  })

  it('ctx.zones 不给(未注入)/给空数组(接口拉取失败)都回落写死三区:一期/二期/宿舍零回归', () => {
    expect(parseWB(parserProps('meter', {}))([sheet]).records![0]).toMatchObject({ zone: 'p1', kind: 'water', ym: '2025-03' })
    expect(parseWB(parserProps('meter', { zones: [] }))([sheet]).records![0]).toMatchObject({ zone: 'p1', kind: 'water', ym: '2025-03' })
  })
})

// ── 解析时就交出导不了的行(T8):customParse 直接回 { records, bad },不再暂存 ctx;run 只发好行 ──
type Parsed = { records?: Rec[]; bad?: { row: number; cells: string[]; reason: string }[]; error?: string }
const customOf = (key: string, ctx: ImportCtx = {}) =>
  IMPORT_TYPES.find(t => t.key === key)!.modalProps(ctx).customParse as (m: string[][]) => Parsed

describe('平铺类 customParse:导不了的行解析时交 bad', () => {
  it('pvMeter:好行回后端契约字段,坏行进 bad(第几行 + 原因);无表头 → 整批 error', () => {
    const res = customOf('pvMeter')([
      ['期数', '楼栋', '日期', '发电总量(kWh)', '自消纳电量(kWh)', '上网电量(kWh)', '备注'],
      ['一期', 'B座', '2026-07-01', '1200', '800', '400', ''],
      ['一期', 'C、D座', '7月2日', '1', '1', '0', ''],
    ])
    expect(res.records![0]).toMatchObject({ station: 'B座', readDate: '2026-07-01', genTotal: 1200, selfUse: 800, gridFeed: 400 })
    expect(res.bad!.map(b => [b.row, b.reason])).toEqual([[3, '日期认不出']])
    expect(customOf('pvMeter')([['B座', '2026-07-01', '1', '1', '0']]).error).toBeTruthy()
  })

  it('cpMeter / elecCost 同款', () => {
    expect(customOf('cpMeter')([
      ['运营商', '桩名', '日期', '充电量(kWh)', '手续费(元)', '收益(元)', '备注'],
      ['小桔', '快充1', '2026-07-01', '850.5', '42.5', '680', ''],
      ['小桔', '慢充1', '2026-07-32', '1', '1', '0', ''],
    ]).bad!.map(b => [b.row, b.reason])).toEqual([[3, '没有 7月32日']])
    expect(customOf('elecCost')([
      ['电表', '费项', '拆分', '月份(YYYY-MM)', '金额(元)', '电量(kWh,可空)', '备注'],
      ['一期总表', '工业分时电价', '', '2025-01', '850000', '1200000', ''],
      ['一期总表', '不存在的费项', '', '2025-01', '1', '1', ''],
    ]).bad!.map(b => [b.row, b.reason])).toEqual([[3, '费项「不存在的费项」认不出']])
  })

  // 改前认不出月份的行到 run 里才记成错误(importRegistry.ts:883-885)
  it('❗办公水电:月份认不出的行解析时交 bad;认出的行带上 acctMonth / belongMonth', () => {
    const res = customOf('office_13')([
      ['月份', '用电量', '基准用电单价', '用水量', '基准用水单价', '所属月份'],
      ['2025-08', '3240', '0.92', '186', '4.1', '2025-07'],
      ['八月下', '3105', '0.92', '172', '4.1', ''],
      ['2025-09', '3105', '0.92', '172', '4.1', ''],
    ])
    expect(res.records!.map(r => [r.acctMonth, r.belongMonth])).toEqual([['2025-08', '2025-07'], ['2025-09', '2025-09']])
    expect(res.bad!.map(b => [b.row, b.reason, b.cells[0]])).toEqual([[3, '月份认不出', '八月下']])
  })
})

describe('run 只发好行(不再并入解析期错误)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pvMeter / cpMeter / elecCost:POST {rows}(不出底部全局提示);rows 空不打 API', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({ imported: 2, skipped: 0, errors: [] } as never)
    for (const [key, url] of [['pvMeter', '/pv-meter/import'], ['cpMeter', '/cp-meter/import'], ['elecCost', '/elec-cost/import']]) {
      const entry = IMPORT_TYPES.find(t => t.key === key)!
      const rows = [{ x: 1 }]
      expect(await entry.run(rows, {})).toEqual({ imported: 2, skipped: 0, errors: [] })
      expect(post).toHaveBeenLastCalledWith(url, { rows }, { silentNetError: true })
    }
    post.mockClear()
    expect(await IMPORT_TYPES.find(t => t.key === 'pvMeter')!.run([], {})).toEqual({ imported: 0, skipped: 0, errors: [] })
    expect(post).not.toHaveBeenCalled()
    post.mockRestore()
  })
})

// ── runImport:一个落点一条导入记录;被拒也记;带回 logIds ──
describe('runImport', () => {
  beforeEach(() => vi.clearAllMocks())
  const recorded = () => vi.mocked(importLogApi.record).mock.calls.map(c => c[0])

  it('runs entry then records log with resolved status, returns { res, logIds }', async () => {
    vi.mocked(importLogApi.record).mockResolvedValueOnce({ id: 41 } as never)
    const salary = IMPORT_TYPES.find(t => t.key === 'salary')!
    const spy = vi.spyOn(salary, 'run').mockResolvedValue({ imported: 9, skipped: 1, errors: [] })
    const { res, logIds } = await runImport('salary', [], { year: 2026, month: 5 }, 's.xlsx')
    expect(res).toEqual({ imported: 9, skipped: 1, errors: [] })
    expect(logIds).toEqual([41])
    expect(importLogApi.record).toHaveBeenCalledWith(expect.objectContaining({
      dataType: 'salary', typeLabel: '附表12 工资明细', fileName: 's.xlsx', rows: 10, ok: 9, warn: 1, status: 'partial',
    }))
    spy.mockRestore()
  })

  it('后端 skipped 就是 errors 条数:要核对的行不重复算', async () => {
    const pv = IMPORT_TYPES.find(t => t.key === 'pvMeter')!
    const err = { rowIndex: 0, label: 'x', reason: '站名不认识' }
    const spy = vi.spyOn(pv, 'run').mockResolvedValue({ imported: 9, skipped: 1, errors: [err] })
    await runImport('pvMeter', [{ readDate: '2026-09-01' }, { readDate: '2026-09-30' }], {}, '')
    expect(recorded()[0]).toMatchObject({ rows: 10, ok: 9, warn: 1, status: 'partial', fileName: '（粘贴）',
      periodFrom: '2026-09-01', periodTo: '2026-09-30', companyId: null, zone: null })
    spy.mockRestore()
  })

  it('核对页里导不了、没发的行(_run.bad)记进「要核对」', async () => {
    const spy = vi.spyOn(IMPORT_TYPES.find(t => t.key === 'pvMeter')!, 'run').mockResolvedValue({ imported: 9, skipped: 0, errors: [] })
    await runImport('pvMeter', [], { _run: { bad: 2, recording: () => {} } as never }, 'p.xlsx')
    expect(recorded()[0]).toMatchObject({ rows: 11, ok: 9, warn: 2, status: 'partial' })
    spy.mockRestore()
  })

  it('does not throw when log record fails', async () => {
    vi.mocked(importLogApi.record).mockRejectedValueOnce(new Error('net'))
    const pv = IMPORT_TYPES.find(t => t.key === 'pv')!
    const spy = vi.spyOn(pv, 'run').mockResolvedValue({ imported: 3, skipped: 0, errors: [] })
    await expect(runImport('pv', [], {}, 'p.xlsx')).resolves.toMatchObject({ res: { imported: 3 }, logIds: [] })
    spy.mockRestore()
  })

  it('throws on unknown type', async () => {
    await expect(runImport('bogus', [], {}, 'x.xlsx')).rejects.toThrow('unknown import type')
  })

  // 附表10 逐段:一段(一个期区一个月)一条,行数按段计
  it('❗附表10 每段一条记录:期区 + 月份 + 这一段的行数', async () => {
    const imp = vi.spyOn(s10Api, 'importRows')
      .mockResolvedValueOnce({ imported: 96, skipped: 0, errors: [] })
      .mockResolvedValueOnce({ imported: 86, skipped: 2, errors: [{ rowIndex: 1, label: 'x', reason: 'y' }, { rowIndex: 2, label: 'z', reason: 'y' }] })
    const picks = [
      { year: 2026, month: 9, phase: 1, records: [{ tenantName: '甲' }] },
      { year: 2026, month: 9, phase: 2, records: [{ tenantName: '乙' }] },
    ]
    const { res } = await runImport('s10', picks, {}, '附表10-9月.xlsx')
    expect(res.imported).toBe(182)
    expect(recorded().map(r => [r.periodFrom, r.periodTo, r.zone, r.rows, r.ok, r.warn, r.status])).toEqual([
      ['2026-09', '2026-09', '1', 96, 96, 0, 'complete'],
      ['2026-09', '2026-09', '2', 88, 86, 2, 'partial'],
    ])
    imp.mockRestore()
  })

  // 一次请求写几个区:按后端回的行号拆回各区,一个区一条(图 B46「园区抄表 · 9月 · 三期」那样)
  it('❗园区抄表一次请求三个区 → 一个区一条,errors 按行号归到所在的区', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({
      imported: 4, skipped: 1, errors: [{ rowIndex: 2, label: 'B-2', reason: '编码认到别的区' }],
    } as never)
    const rows = [
      { zone: 'p1', ym: '2026-09', name: 'A-1' }, { zone: 'p2', ym: '2026-09', name: 'B-1' },
      { zone: 'p2', ym: '2026-09', name: 'B-2' }, { zone: 'p3', ym: '2026-09', name: 'C-1' }, { zone: 'p1', ym: '2026-09', name: 'A-2' },
    ]
    await runImport('meter', rows, {}, '9月抄表.xlsx')
    expect(recorded().map(r => [r.zone, r.periodFrom, r.rows, r.ok, r.warn, r.status])).toEqual([
      ['p1', '2026-09', 2, 2, 0, 'complete'],
      ['p2', '2026-09', 2, 1, 1, 'partial'],
      ['p3', '2026-09', 1, 1, 0, 'complete'],
    ])
    post.mockRestore()
  })

  it('三大报表一次请求几家公司 → 一家一条,公司 id 由 run 认完(新建的也有)写回', async () => {
    vi.mocked(companyApi.list).mockResolvedValue([{ id: 1, name: '租赁' }] as never)
    vi.mocked(companyApi.create).mockResolvedValue({ id: 7, name: '水电' } as never)
    const imp = vi.spyOn(reportApi, 'import').mockResolvedValue({ imported: 6, skipped: 0, errors: [] })
    const picks = [
      { label: '租赁', records: [{ rowKey: 'r1', end: 1 }, { rowKey: 'r2', end: 2 }] },
      { label: '水电', records: [{ rowKey: 'r1', end: 3 }] },
    ]
    await runImport('report_bs', picks, { year: 2026, month: 9 }, 'bs.xlsx')
    expect(recorded().map(r => [r.companyId, r.periodFrom, r.ok])).toEqual([[1, '2026-09', 2], [7, '2026-09', 1]])
    imp.mockRestore()
  })

  // 破坏验证:deriveStatus 改回「imported 0 就 rejected」→ 第一句红;record 不从 errors 取原因 → 第二句的 note 红
  it('❗按段拆的记录:写进 0 格也没报错(科目余额表某家期末全为 0)不记被拒;一段的行全被后端拒掉 → 被拒 + 第一条原因', async () => {
    vi.mocked(companyApi.list).mockResolvedValue([{ id: 1, name: '租赁' }, { id: 2, name: '综合' }] as never)
    const imp = vi.spyOn(reportApi, 'import').mockResolvedValue({ imported: 2, skipped: 0, errors: [] })
    const acct = (k: string) => ({ rowKey: k, code: k, name: k })
    const picks = [
      { label: '租赁', records: [{ account: acct('1001'), amounts: { endDr: 5 } }, { account: acct('1002'), amounts: { endDr: 7 } }] },
      { label: '综合', records: [{ account: acct('1001'), amounts: { endDr: 0 } }] },   // 期末全为 0:cells 滤空
    ]
    await runImport('report_tb', picks, { year: 2026, month: 9 }, 'tb.xlsx')
    expect(recorded().map(r => [r.companyId, r.ok, r.warn, r.status])).toEqual([[1, 2, 0, 'complete'], [2, 0, 0, 'complete']])
    imp.mockRestore()

    vi.clearAllMocks()
    const post = vi.spyOn(http, 'post').mockResolvedValue({
      imported: 1, skipped: 2, errors: [{ rowIndex: 1, label: 'B-1', reason: '编码认到别的区' }, { rowIndex: 2, label: 'B-2', reason: '表名对不上' }],
    } as never)
    await runImport('meter', [
      { zone: 'p1', ym: '2026-09', name: 'A-1' }, { zone: 'p2', ym: '2026-09', name: 'B-1' }, { zone: 'p2', ym: '2026-09', name: 'B-2' },
    ], {}, '9月抄表.xlsx')
    expect(recorded().map(r => [r.zone, r.status, r.note])).toEqual([
      ['p1', 'complete', undefined], ['p2', 'rejected', '编码认到别的区 等 2 行'],
    ])
    post.mockRestore()
  })

  // 改前抛错就不记(importRegistry.ts:1091):整单被拒(4xx,含审核闸)记一条 rejected + 后端原因
  it('❗整单被拒(4xx 信封)→ 记一条 rejected,note 写后端 message,照样抛给弹窗', async () => {
    const gate = { code: 409, message: '9月已审核，不能再导入' }
    const spy = vi.spyOn(IMPORT_TYPES.find(t => t.key === 'salary')!, 'run').mockRejectedValue(gate)
    await expect(runImport('salary', [{ year: 2026, month: 9, records: [] }], { year: 2026, month: 9 }, 's.xlsx')).rejects.toBe(gate)
    expect(recorded()).toEqual([expect.objectContaining({
      dataType: 'salary', status: 'rejected', note: '9月已审核，不能再导入', ok: 0, periodFrom: '2026-09', periodTo: '2026-09',
    })])
    spy.mockRestore()
  })

  it('❗断网 / 5xx 不记被拒;断之前已经写进去的段照记', async () => {
    const imp = vi.spyOn(s10Api, 'importRows')
      .mockResolvedValueOnce({ imported: 96, skipped: 0, errors: [] })
      .mockRejectedValueOnce({ code: 500, message: '服务器内部错误' })
    const picks = [
      { year: 2026, month: 9, phase: 1, records: [{ tenantName: '甲' }] },
      { year: 2026, month: 9, phase: 2, records: [{ tenantName: '乙' }] },
    ]
    await expect(runImport('s10', picks, {}, 'x.xlsx')).rejects.toMatchObject({ code: 500 })
    expect(recorded().map(r => [r.zone, r.status])).toEqual([['1', 'complete']])
    imp.mockRestore()
  })

  it('前端自己抛的(不是后端拒的)不记被拒', async () => {
    const spy = vi.spyOn(IMPORT_TYPES.find(t => t.key === 'pv')!, 'run').mockRejectedValue(new Error('已退出编辑'))
    await expect(runImport('pv', [], {}, 'x.xlsx')).rejects.toThrow('已退出编辑')
    expect(importLogApi.record).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ── 导入记录「去看」:各屏已认的深链参数;被拒 / 旧记录(没有结构列)不出 ──
describe('viewLink', () => {
  const log = (dataType: string, o: Partial<ImportLogDTO> = {}): ImportLogDTO => ({
    id: 1, dataType, typeLabel: '', fileName: '', target: null, rows: 1, ok: 1, warn: 0, status: 'complete',
    operator: null, createdAt: '', periodFrom: null, periodTo: null, companyId: null, zone: null, note: null, ...o,
  })
  const link = (key: string, o: Partial<ImportLogDTO>) => IMPORT_TYPES.find(t => t.key === key)!.viewLink(log(key, o))

  it('❗各类落到自己的屏与期', () => {
    expect(link('ledger', { periodFrom: '2026-09', periodTo: '2026-09', companyId: 3 })).toEqual({ path: '/ledger', query: { p: '2026-09', co: '3' } })
    expect(link('s10', { periodFrom: '2026-09', periodTo: '2026-09', zone: '2' })).toEqual({ path: '/sales-income', query: { p: '2026-09', co: '2' } })
    expect(link('pvMeter', { periodFrom: '2026-10-01', periodTo: '2026-10-09' })).toEqual({ path: '/pv-income', query: { p: '2026-10', mode: 'meter' } })
    expect(link('cpMeter', { periodFrom: '2026-10-01', periodTo: '2026-10-09' })).toEqual({ path: '/car-charging', query: { p: '2026-10', mode: 'meter' } })
    expect(link('meter', { periodFrom: '2026-09', periodTo: '2026-09', zone: 'p3' })).toEqual({ path: '/meters', query: { p: '2026-09' } })
    expect(link('charging_8', { periodFrom: '2026-01', periodTo: '2026-08' })).toEqual({ path: '/ebike-charging', query: { p: '2026', mode: 'summary' } })
    expect(link('elecCost', { periodFrom: '2026-09', periodTo: '2026-09' })).toEqual({ path: '/elec-cost', query: { p: '2026-09', mode: 'cost' } })
    expect(link('office_14', { periodFrom: '2026-01', periodTo: '2026-09' })).toEqual({ path: '/utilities', query: { p: '2026', tab: 'phase3' } })
    expect(link('report_tb', { periodFrom: '2026-09', periodTo: '2026-09', companyId: 2 })).toEqual({ path: '/trial-balance', query: { p: '2026-09', co: '2' } })
    expect(link('pnl_s3', { periodFrom: '2026', periodTo: '2026' })).toEqual({ path: '/water-pnl', query: { p: '2026' } })
    expect(link('contractFull', {})).toEqual({ path: '/contracts', query: {} })
  })

  it('❗被拒的、旧记录(结构列全空)不出去看', () => {
    expect(link('ledger', { status: 'rejected', periodFrom: '2026-09', companyId: 3 })).toBeNull()
    expect(link('contractFull', { status: 'rejected' })).toBeNull()
    expect(link('ledger', {})).toBeNull()
    expect(link('meter', {})).toBeNull()
  })
})

// ── 台账进核对页先问一次:文件标题的月份、要导到的那个月会盖掉几家 ──
describe('ledger precheck', () => {
  const entry = IMPORT_TYPES.find(t => t.key === 'ledger')!
  beforeEach(() => vi.clearAllMocks())

  it('❗fileYm = 标题识别的月;existing = 那个月已有台账、文件里也有的家数(去重)', async () => {
    vi.mocked(ledgerApi.month).mockResolvedValue({ rows: [{ tenantName: '恒毅' }, { tenantName: '叙丰' }, { tenantName: '澜川' }] } as never)
    const recs = [
      { tenantName: '恒毅', __ymDetected: { year: 2026, month: 8 } }, { tenantName: '恒毅' }, { tenantName: '叙丰' }, { tenantName: '新户' },
    ]
    expect(await entry.precheck!({ companyId: 3, year: 2026, month: 9 }, { records: recs })).toEqual({ fileYm: '2026-08', existing: 2 })
    expect(ledgerApi.month).toHaveBeenCalledWith(3, 2026, 9)
  })

  it('分段台账不预检;拉不到本月数据不拦', async () => {
    expect(await entry.precheck!({ companyId: 3, year: 2026, month: 9 }, {})).toEqual({})
    vi.mocked(ledgerApi.month).mockRejectedValue(new Error('net'))
    expect(await entry.precheck!({ companyId: 3, year: 2026, month: 9 }, { records: [{ tenantName: '甲' }] })).toEqual({ fileYm: undefined })
  })
})

// ── contractFull:整册解析 → /contracts/import-full,到户报告并入后端匹配结果落 CSV(解析纯函数单测见 importContractSummary.spec.ts) ──
describe('contractFull run', () => {
  const entry = IMPORT_TYPES.find(t => t.key === 'contractFull')!
  const row = { tenantName: '金纳', tenantFullName: '佛山市金纳新材料有限公司', phase: 1, buildingHint: 'D座',
    startDate: '2023-07-14', endDate: '2026-07-13', termText: 'x', termType: 'explicit',
    tierPriceNote: null, remark: null, lines: [] }

  it('run:POST /contracts/import-full {rows},report 并入后端 action,结果原样返回', async () => {
    const dl = vi.fn(() => 'blob:x')   // jsdom 无 createObjectURL,直接挂桩
    URL.createObjectURL = dl as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const post = vi.spyOn(http, 'post').mockResolvedValue({
      result: { imported: 1, skipped: 0, errors: [] }, matched: 1, created: 0,
      report: [{ rowIndex: 0, contractNo: 'C2024M-001', action: 'matched', message: null }],
    } as never)
    const ctx: ImportCtx = {
      _cfReport: [{ phase: '一期', tenantName: '金纳', tenantFullName: '佛山市金纳新材料有限公司',
        lineCount: 5, segments: 1, term: '2023-07-14~2026-07-13', termType: 'explicit',
        detailTotal: 55000, summaryTotal: 55000, diff: 0, issues: '' }],
    }
    const res = await entry.run([row], ctx)
    expect(post).toHaveBeenCalledWith('/contracts/import-full', { rows: [row] }, { silentNetError: true })
    expect(ctx._cfReport![0].issues).toBe('匹配合同 C2024M-001')
    expect(dl).toHaveBeenCalled()
    expect(res).toEqual({ imported: 1, skipped: 0, errors: [] })
    vi.restoreAllMocks()
  })

  it('run:rows 空 → 不打 API', async () => {
    const post = vi.spyOn(http, 'post')
    expect(await entry.run([], {})).toEqual({ imported: 0, skipped: 0, errors: [] })
    expect(post).not.toHaveBeenCalled()
    post.mockRestore()
  })
})

describe('meter run', () => {
  it('run:后端 notices 透传到结果(换楼等「已导入、仅需知会」提示)', async () => {
    const notice = { rowIndex: 0, label: '表「A-1」', reason: '表「A-1」按编码认到了这一行,但这一行把它换了楼' }
    const post = vi.spyOn(http, 'post').mockResolvedValue({ imported: 1, skipped: 0, errors: [], matches: { code: 1 }, notices: [notice] } as never)
    const entry = IMPORT_TYPES.find(t => t.key === 'meter')!
    const res = await entry.run([{ kind: 'elec', name: 'A-1', code: 'X1', ym: '2024-02', curr: 10 }], {})
    expect(post).toHaveBeenCalledWith('/meters/import', expect.anything(), { silentNetError: true })
    expect(res.notices).toEqual([notice])
    post.mockRestore()
  })

  it('runImport:文件名随行送后端(进档案变更记录),batchId / changes / notices 原样透传', async () => {
    const change = { meterId: 7, label: 'A-1', field: 'tenant', before: '甲', after: '乙', from: '2024-02', until: null }
    const notice = { rowIndex: 0, label: 'A-1', reason: '表「A-1」本行企业名称为空' }
    const post = vi.spyOn(http, 'post').mockResolvedValue({
      imported: 1, skipped: 0, errors: [], matches: [], notices: [notice], batchId: 'b-1', changes: [change],
    } as never)
    const { res } = await runImport('meter', [{ kind: 'elec', name: 'A-1', ym: '2024-02', curr: 10 }], {}, '2024年2月抄表.xlsx')
    expect(post).toHaveBeenCalledWith('/meters/import',
      { rows: [expect.objectContaining({ name: 'A-1' })], fileName: '2024年2月抄表.xlsx' }, { silentNetError: true })
    expect(res.batchId).toBe('b-1')
    expect(res.changes).toEqual([change])
    expect(res.notices).toEqual([notice])
    post.mockRestore()
  })
})
