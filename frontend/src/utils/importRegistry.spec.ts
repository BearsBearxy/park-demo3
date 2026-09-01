import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import * as XLSX from 'xlsx'
vi.mock('@/api/importLog', () => ({ importLogApi: { record: vi.fn().mockResolvedValue({}) } }))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn(), create: vi.fn() },
  ledgerApi: { import: vi.fn() },
}))
vi.mock('@/api/budget', () => ({ budgetApi: { import: vi.fn(), all: vi.fn() } }))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: vi.fn() } }))
vi.mock('@/api/building', () => ({ buildingApi: { list: vi.fn() } }))
import { deriveStatus, runImport, parserProps, IMPORT_TYPES, type ImportCtx } from './importRegistry'
import http from '@/api/index'
import { importLogApi } from '@/api/importLog'
import { companyApi, ledgerApi } from '@/api/ledger'
import { budgetApi } from '@/api/budget'
import { tenantApi } from '@/api/tenant'
import { buildingApi } from '@/api/building'

describe('deriveStatus', () => {
  it('rejected when nothing imported', () => expect(deriveStatus({ imported: 0, skipped: 0, errors: [] })).toBe('rejected'))
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
  it('ledger + report_bs + report_is + report_tb need context (year/month)', () => {
    expect(IMPORT_TYPES.filter(t => t.context === 'ledger').map(t => t.key).sort()).toEqual(['ledger', 'report_bs', 'report_is', 'report_tb'])
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
    expect(companyApi.create).toHaveBeenCalledWith('一泽')
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
    expect(res.records![0].__preview).toEqual(['一期', '一期 B座', '1-3楼', '力灏', '租户', 1, 10, 20, ''])
  })

  // 账期降级接线(用户 2026-07-29 报障):补录条默认账期 = 屏上下文年月;裸数据块按补录值落库
  it('fallbackPicker 默认账期取 ctx.year/month;裸数据块按补录值解析', () => {
    const props = parserProps('meter', { year: 2099, month: 7 })
    expect(props.fallbackPicker).toMatchObject({ ym: '2099-07', zone: 'p1', kind: 'elec' })
    const bare = [
      ['区域', '', '企业名称', '表类', '电表名称', '电表编码', '电表倍率', '上月行至', '本月行至', '备注'],
      ['一车间', '101室', '力灏', '户内用电', '电表①', '230220001238', '1', '100', '160', ''],
    ]
    const wb = props.parseWorkbook as (s: { name: string; matrix: string[][] }[], fb?: { ym: string; zone: string; kind: string }) => ParseOut
    const res = wb([{ name: '', matrix: bare }], { ym: '2099-07', zone: 'p2', kind: 'elec' })
    expect(res.records![0]).toMatchObject({ ym: '2099-07', zone: 'p2', kind: 'elec' })
    expect(wb([{ name: '', matrix: bare }]).error).toContain('请在上方选择账期')
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
    const res = parseWB(parserProps('meter', ctx))([t3Sheet])
    expect(res.records![0]).toMatchObject({ zone: 'p3', kind: 'elec', ym: '2026-03' })
  })

  it('ctx.zones 不给(未注入)/给空数组(接口拉取失败)都回落写死三区:一期/二期/宿舍零回归', () => {
    expect(parseWB(parserProps('meter', {}))([sheet]).records![0]).toMatchObject({ zone: 'p1', kind: 'water', ym: '2025-03' })
    expect(parseWB(parserProps('meter', { zones: [] }))([sheet]).records![0]).toMatchObject({ zone: 'p1', kind: 'water', ym: '2025-03' })
  })
})

// ── pvMeter:customParse 行级错误暂存 + run 契约(解析纯函数单测见 pvMeterExcel.spec.ts) ──
describe('pvMeter customParse + run', () => {
  const entry = IMPORT_TYPES.find(t => t.key === 'pvMeter')!
  const header = ['期数', '楼栋', '日期', '发电总量(kWh)', '自消纳电量(kWh)', '上网电量(kWh)', '备注']

  it('customParse:好行返回后端契约字段,坏行(非法日期)暂存 ctx._parseErrors 不整批拦', () => {
    const ctx: ImportCtx = {}
    const props = entry.modalProps(ctx)
    const res = (props.customParse as (m: string[][]) => { records?: Rec[]; error?: string })([
      header,
      ['一期', 'B座', '2026-07-01', '1200', '800', '400', ''],
      ['一期', 'C、D座', '乱码', '1', '1', '0', ''],
    ])
    expect(res.error).toBeUndefined()
    expect(res.records!.length).toBe(1)
    expect(res.records![0]).toMatchObject({ station: 'B座', readDate: '2026-07-01', genTotal: 1200, selfUse: 800, gridFeed: 400 })
    expect(ctx._parseErrors!.length).toBe(1)
  })

  it('customParse:无表头 → 整批 error', () => {
    const props = entry.modalProps({})
    const res = (props.customParse as (m: string[][]) => { error?: string })([['B座', '2026-07-01', '1', '1', '0']])
    expect(res.error).toBeTruthy()
  })

  it('run:POST /pv-meter/import {rows},解析期错误并入 skipped/errors', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({ imported: 2, skipped: 0, errors: [] } as never)
    const rows = [{ station: 'B座', readDate: '2026-07-01', genTotal: 1, selfUse: 1, gridFeed: 0 }]
    const res = await entry.run(rows, { _parseErrors: [{ rowIndex: 1, label: 'x', reason: 'r' }] })
    expect(post).toHaveBeenCalledWith('/pv-meter/import', { rows })
    expect(res).toEqual({ imported: 2, skipped: 1, errors: [{ rowIndex: 1, label: 'x', reason: 'r' }] })
    post.mockRestore()
  })

  it('run:全行错误(rows 空)→ 不打 API,只返回解析错误', async () => {
    const post = vi.spyOn(http, 'post')
    const res = await entry.run([], { _parseErrors: [{ rowIndex: 0, label: 'x', reason: 'r' }] })
    expect(post).not.toHaveBeenCalled()
    expect(res).toEqual({ imported: 0, skipped: 1, errors: [{ rowIndex: 0, label: 'x', reason: 'r' }] })
    post.mockRestore()
  })
})

// ── cpMeter:customParse 行级错误暂存 + run 契约(解析纯函数单测见 cpMeterExcel.spec.ts,同构 pvMeter) ──
describe('cpMeter customParse + run', () => {
  const entry = IMPORT_TYPES.find(t => t.key === 'cpMeter')!

  it('customParse:好行返回后端契约字段,坏行(非法日期)暂存 ctx._parseErrors 不整批拦;无表头 → 整批 error', () => {
    const ctx: ImportCtx = {}
    const props = entry.modalProps(ctx)
    const cp = props.customParse as (m: string[][]) => { records?: Rec[]; error?: string }
    const res = cp([
      ['运营商', '桩名', '日期', '充电量(kWh)', '手续费(元)', '收益(元)', '备注'],
      ['小桔', '快充1', '2026-07-01', '850.5', '42.5', '680', ''],
      ['小桔', '慢充1', '乱码', '1', '1', '0', ''],
    ])
    expect(res.error).toBeUndefined()
    expect(res.records!.length).toBe(1)
    expect(res.records![0]).toMatchObject({ station: '快充1', readDate: '2026-07-01', chargeKwh: 850.5, fee: 42.5, revenue: 680 })
    expect(ctx._parseErrors!.length).toBe(1)
    expect(cp([['快充1', '2026-07-01', '1', '1', '0']]).error).toBeTruthy()
  })

  it('run:POST /cp-meter/import {rows},解析期错误并入 skipped/errors;rows 空不打 API', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({ imported: 2, skipped: 0, errors: [] } as never)
    const rows = [{ station: '快充1', readDate: '2026-07-01', chargeKwh: 1, fee: 1, revenue: 0 }]
    const res = await entry.run(rows, { _parseErrors: [{ rowIndex: 1, label: 'x', reason: 'r' }] })
    expect(post).toHaveBeenCalledWith('/cp-meter/import', { rows })
    expect(res).toEqual({ imported: 2, skipped: 1, errors: [{ rowIndex: 1, label: 'x', reason: 'r' }] })
    post.mockClear()
    const empty = await entry.run([], { _parseErrors: [{ rowIndex: 0, label: 'x', reason: 'r' }] })
    expect(post).not.toHaveBeenCalled()
    expect(empty).toEqual({ imported: 0, skipped: 1, errors: [{ rowIndex: 0, label: 'x', reason: 'r' }] })
    post.mockRestore()
  })
})

// ── elecCost:customParse 行级错误暂存 + run 契约(解析纯函数单测见 elecCostExcel.spec.ts,同构 pvMeter) ──
describe('elecCost customParse + run', () => {
  const entry = IMPORT_TYPES.find(t => t.key === 'elecCost')!

  it('customParse:好行返回后端契约字段,坏行(费项非法)暂存 ctx._parseErrors 不整批拦;无表头 → 整批 error', () => {
    const ctx: ImportCtx = {}
    const props = entry.modalProps(ctx)
    const cp = props.customParse as (m: string[][]) => { records?: Rec[]; error?: string }
    const res = cp([
      ['电表', '费项', '拆分', '月份(YYYY-MM)', '金额(元)', '电量(kWh,可空)', '备注'],
      ['一期总表', '工业分时电价', '', '2025-01', '850000', '1200000', ''],
      ['一期总表', '不存在的费项', '', '2025-01', '1', '1', ''],
    ])
    expect(res.error).toBeUndefined()
    expect(res.records!.length).toBe(1)
    expect(res.records![0]).toMatchObject({ meter: '一期总表', fee: '工业分时电价', split: '', month: '2025-01', amount: 850000, qty: 1200000 })
    expect(ctx._parseErrors!.length).toBe(1)
    expect(cp([['一期总表', '工业分时电价', '2025-01', '1']]).error).toBeTruthy()
  })

  it('run:POST /elec-cost/import {rows},解析期错误并入 skipped/errors;rows 空不打 API', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({ imported: 2, skipped: 0, errors: [] } as never)
    const rows = [{ meter: '一期总表', fee: '工业分时电价', split: '', month: '2025-01', amount: 1 }]
    const res = await entry.run(rows, { _parseErrors: [{ rowIndex: 1, label: 'x', reason: 'r' }] })
    expect(post).toHaveBeenCalledWith('/elec-cost/import', { rows })
    expect(res).toEqual({ imported: 2, skipped: 1, errors: [{ rowIndex: 1, label: 'x', reason: 'r' }] })
    post.mockClear()
    const empty = await entry.run([], { _parseErrors: [{ rowIndex: 0, label: 'x', reason: 'r' }] })
    expect(post).not.toHaveBeenCalled()
    expect(empty).toEqual({ imported: 0, skipped: 1, errors: [{ rowIndex: 0, label: 'x', reason: 'r' }] })
    post.mockRestore()
  })
})

describe('runImport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs entry then records log with resolved status, returns result', async () => {
    const salary = IMPORT_TYPES.find(t => t.key === 'salary')!
    const spy = vi.spyOn(salary, 'run').mockResolvedValue({ imported: 9, skipped: 1, errors: [] })
    const res = await runImport('salary', [], { year: 2026, month: 5 }, 's.xlsx')
    expect(res).toEqual({ imported: 9, skipped: 1, errors: [] })
    expect(importLogApi.record).toHaveBeenCalledWith(expect.objectContaining({
      dataType: 'salary', fileName: 's.xlsx', ok: 9, warn: 1, status: 'partial',
    }))
    spy.mockRestore()
  })

  it('does not throw when log record fails', async () => {
    vi.mocked(importLogApi.record).mockRejectedValueOnce(new Error('net'))
    const pv = IMPORT_TYPES.find(t => t.key === 'pv')!
    const spy = vi.spyOn(pv, 'run').mockResolvedValue({ imported: 3, skipped: 0, errors: [] })
    await expect(runImport('pv', [], {}, 'p.xlsx')).resolves.toMatchObject({ imported: 3 })
    spy.mockRestore()
  })

  it('throws on unknown type', async () => {
    await expect(runImport('bogus', [], {}, 'x.xlsx')).rejects.toThrow('unknown import type')
  })
})

// ── contractFull:整册解析 → /contracts/import-full,到户报告并入后端匹配结果落 CSV(解析纯函数单测见 importContractSummary.spec.ts) ──
describe('contractFull run', () => {
  const entry = IMPORT_TYPES.find(t => t.key === 'contractFull')!
  const row = { tenantName: '金纳', tenantFullName: '佛山市金纳新材料有限公司', phase: 1, buildingHint: 'D座',
    startDate: '2023-07-14', endDate: '2026-07-13', termText: 'x', termType: 'explicit',
    tierPriceNote: null, remark: null, lines: [] }

  it('run:POST /contracts/import-full {rows},report 并入后端 action,解析错误并入 skipped', async () => {
    const dl = vi.fn(() => 'blob:x')   // jsdom 无 createObjectURL,直接挂桩
    URL.createObjectURL = dl as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const post = vi.spyOn(http, 'post').mockResolvedValue({
      result: { imported: 1, skipped: 0, errors: [] }, matched: 1, created: 0,
      report: [{ rowIndex: 0, contractNo: 'C2024M-001', action: 'matched', message: null }],
    } as never)
    const ctx: ImportCtx = {
      _parseErrors: [{ rowIndex: 3, label: '李富全', reason: '收费项目为空,跳过' }],
      _cfReport: [{ phase: '一期', tenantName: '金纳', tenantFullName: '佛山市金纳新材料有限公司',
        lineCount: 5, segments: 1, term: '2023-07-14~2026-07-13', termType: 'explicit',
        detailTotal: 55000, summaryTotal: 55000, diff: 0, issues: '' }],
    }
    const res = await entry.run([row], ctx)
    expect(post).toHaveBeenCalledWith('/contracts/import-full', { rows: [row] })
    expect(ctx._cfReport![0].issues).toBe('匹配合同 C2024M-001')
    expect(dl).toHaveBeenCalled()
    expect(res).toEqual({ imported: 1, skipped: 1, errors: [{ rowIndex: 3, label: '李富全', reason: '收费项目为空,跳过' }] })
    vi.restoreAllMocks()
  })

  it('run:rows 空 → 不打 API', async () => {
    const post = vi.spyOn(http, 'post')
    expect(await entry.run([], { _parseErrors: [{ rowIndex: 0, label: 'x', reason: 'r' }] }))
      .toEqual({ imported: 0, skipped: 1, errors: [{ rowIndex: 0, label: 'x', reason: 'r' }] })
    expect(post).not.toHaveBeenCalled()
    post.mockRestore()
  })
})
