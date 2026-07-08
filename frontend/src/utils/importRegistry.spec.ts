import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import * as XLSX from 'xlsx'
vi.mock('@/api/importLog', () => ({ importLogApi: { record: vi.fn().mockResolvedValue({}) } }))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn(), create: vi.fn() },
  ledgerApi: { import: vi.fn() },
}))
vi.mock('@/api/budget', () => ({ budgetApi: { import: vi.fn(), all: vi.fn() } }))
import { deriveStatus, runImport, parserProps, IMPORT_TYPES } from './importRegistry'
import { importLogApi } from '@/api/importLog'
import { companyApi, ledgerApi } from '@/api/ledger'
import { budgetApi } from '@/api/budget'

describe('deriveStatus', () => {
  it('rejected when nothing imported', () => expect(deriveStatus({ imported: 0, skipped: 0, errors: [] })).toBe('rejected'))
  it('partial when some skipped', () => expect(deriveStatus({ imported: 5, skipped: 1, errors: [] })).toBe('partial'))
  it('partial when some errors', () => expect(deriveStatus({ imported: 5, skipped: 0, errors: [{ rowIndex: 1, label: 'x', reason: 'y' }] })).toBe('partial'))
  it('complete when clean', () => expect(deriveStatus({ imported: 5, skipped: 0, errors: [] })).toBe('complete'))
})

describe('IMPORT_TYPES catalog', () => {
  it('has the 18 expected keys', () => {
    expect(IMPORT_TYPES.map(t => t.key).sort()).toEqual(
      ['budget', 'charging_7', 'charging_8', 'elec', 'ledger', 'office_13', 'office_14',
       'pnl_s1', 'pnl_s2', 'pnl_s3', 'pnl_s4', 'pnl_s5',
       'pv', 'report_bs', 'report_is', 'report_tb', 's10', 'salary'].sort())
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
  it('解析出 3 条记录,空名行/合计行被丢弃', () => {
    const res = parse(parserProps('ledger', { year: 2025, month: 1 }))(janMatrix)
    expect(res.error).toBeUndefined()
    expect(res.records!.map(r => r.tenantName)).toEqual(['成吉', '戎合', '丁天伦（天域）'])
  })

  it('成吉:按表头对位取值,派生列/文件没有的宿舍 4 列不出现', () => {
    const [r] = parse(parserProps('ledger', { year: 2025, month: 1 }))(janMatrix).records!
    expect(r).toMatchObject({
      tenantName: '成吉', balancePrev: 102.94, factoryRent: 12588.8, factoryInfraMaint: 892.8,
      elevatorMaint: 159, transformerMaint: 159, officeOtherFee: 0,
      standardElectricity: 464.98, electricityMaint: 305.73, standardWater: 48.8, waterMaint: 8.87,
      totalCollected: 14627.98, note: '电梯费用未支付',
    })
    // 旧位置映射 bug 特征反断言:水维护费/基准电费绝不能吃到错位列的值
    expect(r.waterMaint).toBe(8.87)             // 而不是 102.94(本月结余)
    expect(r.standardElectricity).toBe(464.98)  // 而不是水维护费错位值
    for (const k of ['totalReceivable', 'balanceEnd', 'dormRent', 'dormFacilitiesFee', 'dormInfraMaint', 'dormOtherFee'])
      expect(r).not.toHaveProperty(k)
  })

  it('戎合:balancePrev 带千分位解析,17 个费用列全为 0', () => {
    const r = parse(parserProps('ledger', { year: 2025, month: 1 }))(janMatrix).records![1]
    expect(r.balancePrev).toBe(2499022.41)
    const feeKeys = ['factoryRent', 'factoryMgmtFee', 'shopRent', 'shopMgmtFee', 'factoryInfraMaint', 'shopInfraMaint',
      'elevatorMaint', 'transformerMaint', 'landUseTax', 'networkFee', 'accessCtrlMaint', 'officeOtherFee',
      'basicElectricity', 'standardElectricity', 'electricityMaint', 'standardWater', 'waterMaint']
    for (const k of feeKeys) expect(r[k]).toBe(0)
  })

  it('每条记录带标题识别的 __ymDetected', () => {
    const recs = parse(parserProps('ledger', { year: 2026, month: 3 }))(janMatrix).records!
    for (const r of recs) expect(r.__ymDetected).toEqual({ year: 2025, month: 1 })
  })

  it('templateCols 含上月结余动态标签(month=2 → 1月结余)', () => {
    expect(parserProps('ledger', { year: 2025, month: 2 }).templateCols).toContain('1月结余')
  })

  it('无表头矩阵(只给数据行)→ 返回 error', () => {
    const res = parse(parserProps('ledger', { year: 2025, month: 1 }))(janMatrix.slice(4, 7))
    expect(res.error).toBeTruthy()
  })
})

// ── 台账 parseWorkbook:10月 26 列样例(列名变体走别名,规范§一事故二回归) ──
describe('ledger parseWorkbook (10月 26 列样例)', () => {
  const P = () => parse(parserProps('ledger', { year: 2025, month: 10 }))

  it('4 条记录,合计行丢弃;无标题行 → 无 __ymDetected', () => {
    const res = P()(octMatrix)
    expect(res.error).toBeUndefined()
    expect(res.records!.map(r => r.tenantName)).toEqual(['张丽莉（建杭）', '传齐商铺', '戎合', '康建清（鼎瑞）'])
    for (const r of res.records!) expect(r.__ymDetected).toBeUndefined()
  })

  it('张丽莉:别名列(商铺租金/商铺基础设施维护费)与电水费按表头对位,派生列不出现', () => {
    const [r] = P()(octMatrix).records!
    expect(r).toMatchObject({
      shopRent: 5459.33, shopInfraMaint: 859.8, standardElectricity: 791.79,
      electricityMaint: 64.04, waterMaint: 1.67, totalCollected: 7176.63,
    })
    for (const k of ['totalReceivable', 'balanceEnd']) expect(r).not.toHaveProperty(k)
  })

  it('传齐商铺:修复前该行全零被跳,现 shopRent=19620', () => {
    expect(P()(octMatrix).records![1].shopRent).toBe(19620)
  })

  it('戎合:balancePrev 捕获(9月结余列)', () => {
    expect(P()(octMatrix).records![2].balancePrev).toBe(2499022.41)
  })

  it('康建清:宿舍租金主 label + 宿舍配套设施费别名', () => {
    const r = P()(octMatrix).records![3]
    expect(r).toMatchObject({ dormRent: 1253.75, dormFacilitiesFee: 147.5, basicElectricity: 1069.52, standardWater: 80.98 })
  })

  it('跨月 sheet:标题 2025年11月 + 表头「10月结余」→ balancePrev 按 sheet 年月动态标签捕获(复审②)', () => {
    const nov = [
      ['2025年11月园区费用明细表', ...pad(25)],
      ...octMatrix.map(row => row.map(c => (c === '9月结余' ? '10月结余' : c))),
    ]
    const res = P()(nov)   // 屏上下文 2025年10月(prev=9),不得影响该 sheet 的结余列
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

  it('万众宿舍双行 → 单条:数值逐列相加,note 拼接,单行租户不受影响', () => {
    const res = P()(dupMatrix)
    expect(res.error).toBeUndefined()
    expect(res.records!.map(r => r.tenantName)).toEqual(['万众宿舍', '单行户'])   // 首现位置保序
    const [wz, single] = res.records!
    expect(wz.balancePrev).toBe(-2082.41)
    expect(wz.totalCollected).toBeCloseTo(-1146.7, 2)   // = -2082.41 + 935.71
    expect(wz).toMatchObject({ shopRent: 621.01, shopMgmtFee: 73.06, standardElectricity: 131.5 })   // 费用 = 行2 值(行1 空=0)
    expect(wz.note).toBe('结余调整；陆续退租')
    expect(wz.__ymDetected).toEqual({ year: 2025, month: 1 })   // 年月识别在合并后照常挂行
    expect(single).toMatchObject({ tenantName: '单行户', shopRent: 100, totalCollected: 100 })
  })

  it('三行同名逐列加总', () => {
    const m: string[][] = [
      ['租户', '商铺、宿舍租金', '本月收款'],
      ['甲', '1', '10'],
      ['甲', '2', '20'],
      ['甲', '3', '30'],
    ]
    const res = P()(m)
    expect(res.records!.length).toBe(1)
    expect(res.records![0]).toMatchObject({ tenantName: '甲', shopRent: 6, totalCollected: 60 })
  })

  it('台账垃圾行被跳(「0」伪租户/「202510二期」合计行)', () => {
    const m: string[][] = [
      ['租户', '商铺、宿舍租金', '本月收款'],
      ['甲', '1', '10'],
      ['0', '0', '0'],
      ['202510二期', '1', '10'],
    ]
    expect(P()(m).records!.map(r => r.tenantName)).toEqual(['甲'])
  })
})

// ── 台账 parseWorkbook 整册拆段(规范§二) ──────────────────────
describe('ledger parseWorkbook 整册拆段', () => {
  const ctx = { year: 2025, month: 1, companyName: '创显', companyNames: ['创显', '一泽'] }

  it('双 sheet → 两段:A 公司=创显(标记列)+__ym,B 公司=一泽(sheet名)+年月未识别标注', () => {
    const res = parseWB(parserProps('ledger', ctx))([
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

  it('单 sheet(有记录的仅 1 个)→ 平铺 records,无 __company', () => {
    const res = parseWB(parserProps('ledger', { year: 2025, month: 10, companyNames: ['创显', '一泽'] }))([
      { name: '一泽', matrix: octMatrix },
    ])
    expect(res.sections).toBeUndefined()
    expect(res.records!.length).toBe(4)
    expect(res.records![0]).not.toHaveProperty('__company')
  })

  it('公司识别只扫租户列左侧:备注整列同文本不会被误判成公司(复审①)', () => {
    const noted = octMatrix.map((row, i) => {
      if (i < 3 || i > 6) return [...row]
      const r = [...row]; r[25] = '欠费'; return r   // 4 条数据行备注全同文本
    })
    const res = parseWB(parserProps('ledger', ctx))([
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

  it('单 sheet 双块(1月+2月堆叠)→ 2 段,2月段 balancePrev 按块年月从「1月结余」捕获', () => {
    const res = parse(parserProps('ledger', { year: 2025, month: 1, companyName: '创显' }))([...janMatrix, ...febBlock])
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

  it('数据行备注引用「…明细表」不误切块(复审:标题式锚+行非空数≤3 双保险)', () => {
    // 变体1:备注有前缀(不以年月开头)→ 锚① 拦;变体2:备注以年月开头 → 行非空数>3 的守卫② 拦
    for (const note of ['费用参见2024年12月园区费用明细表附页', '2024年12月园区费用明细表欠费']) {
      const noted = octMatrix.map((row, i) => {
        if (i !== 4) return [...row]              // 传齐商铺行(中部数据行)
        const r = [...row]; r[25] = note; return r
      })
      const res = parse(parserProps('ledger', { year: 2025, month: 10 }))(noted)
      expect(res.error).toBeUndefined()
      expect(res.records!.length).toBe(4)         // 不被切块,零丢行
      expect(res.sections).toBeUndefined()
    }
  })

  // 真实文件集成回归(事故三原件):单 sheet 873 行,实测结构 = 6 公司块 × 2 个月(2025年1月/10月)
  // 纵向堆叠共 12 块(公司名取自各块前置标记列);修复前 matchByHeader 只解析最后一段 22 行,余者无告警丢弃
  const REAL_FILE = 'C:/financial_dashboard/2025全年发生额、预算对比/台账测试.xlsx'
  it.skipIf(!fs.existsSync(REAL_FILE))('真实文件 台账测试.xlsx → 12 块全解析、无丢段', () => {
    // 与 FpImportModal 同参读取(cellDates + header:1/blankrows:false/defval:''/raw:false/dateNF)
    const wb = XLSX.read(fs.readFileSync(REAL_FILE), { cellDates: true })
    const sheets = wb.SheetNames.map(name => ({
      name,
      matrix: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: '', raw: false, dateNF: 'yyyy-mm-dd' }) as string[][],
    }))
    const res = parseWB(parserProps('ledger', { year: 2025, month: 1 }))(sheets)
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
