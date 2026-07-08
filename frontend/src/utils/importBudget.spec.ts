import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import * as XLSX from 'xlsx'
import { importBudget, BUDGET_SHEET_RE } from './importBudget'

// 样例取自真实工作簿实测(spec「数据源」节):千分位+尾随空格金额、前导空格子行、「其中：」前缀。
// 2025 文件:项目|2022~2024年发生额|2025年预算|备注
const m2025: string[][] = [
  ['2025年财务预算总表', '', '', '', '', ''],
  ['项目', '2022年发生额', '2023年发生额', '2024年发生额', '2025年预算', '备注'],
  ['收入总计', '43,845,828.54 ', '68,178,452.38 ', '82,867,520.26 ', '92,705,202.87 ', '详见《主营收入预算》'],
  ['    其中：租金收入', '27,195,163.93 ', '48,091,333.62 ', '58,900,178.86 ', '65,306,885.03 ', ''],
  ['         电费收入', '12,705,486.17 ', '13,648,161.71 ', '15,252,812.79 ', '15,252,812.79 ', ''],
  ['主营成本总计', '34,650,199.80 ', '41,543,218.66 ', '53,821,369.11 ', '54,324,229.69 ', '详见《主营成本预算》'],
  ['利润总额', '-1,630,670.37 ', '18,107,074.15 ', '22,593,088.17 ', '29,447,576.97 ', '（盈为正，亏为负）'],
]
// 2026 文件:多出 2025年发生额 列(单一事实源规则:跳过不导)
const m2026: string[][] = [
  ['2026年财务预算总表', '', '', '', '', '', ''],
  ['项目', '2022年发生额', '2023年发生额', '2024年发生额', '2025年发生额', '2026年预算', '备注'],
  ['收入总计', '43,845,828.54 ', '68,178,452.38 ', '82,867,520.26 ', '87,722,075.46 ', '103,620,434.53 ', '详见《主营收入预算》'],
  ['    其中：租金收入', '27,195,163.93 ', '48,091,333.62 ', '58,900,178.86 ', '56,914,614.29 ', '70,557,045.04 ', ''],
  ['利润总额', '-1,630,670.37 ', '18,107,074.15 ', '22,593,088.17 ', '22,900,947.15 ', '33,274,697.54 ', '（盈为正，亏为负）'],
]
const wb = (matrix: string[][], name = '2024年全面预算') => [{ name, matrix }]

describe('importBudget — 多年拆分与字段', () => {
  it('2025 文件 → 4 个年段(2022~2024 发生额 + 2025 预算),段标签按年计数', () => {
    const res = importBudget(wb(m2025))
    expect(res.error).toBeUndefined()
    expect(res.sections!.map(s => s.label)).toEqual([
      '2022 预算 0 条 / 发生额 5 条',
      '2023 预算 0 条 / 发生额 5 条',
      '2024 预算 0 条 / 发生额 5 条',
      '2025 预算 5 条 / 发生额 0 条',
    ])
  })

  it('千分位/尾随空格/负数解析;发生额年只有 actual,预算年只有 budget', () => {
    const secs = importBudget(wb(m2025)).sections!
    const y2022 = secs[0].records
    expect(y2022[0]).toMatchObject({ year: 2022, label: '收入总计', sub: false, actual: 43845828.54, sortOrder: 0 })
    expect(y2022[0].budget).toBeUndefined()
    expect(y2022[4]).toMatchObject({ label: '利润总额', actual: -1630670.37 })
    const y2025 = secs[3].records
    expect(y2025[0]).toMatchObject({ year: 2025, label: '收入总计', budget: 92705202.87 })
    expect(y2025[0].actual).toBeUndefined()
  })

  it('sub 识别:前导空格/「其中：」→ sub=true 且 label trim;顶级行 sub=false', () => {
    const y2025 = importBudget(wb(m2025)).sections![3].records
    expect(y2025[1]).toMatchObject({ label: '其中：租金收入', sub: true })
    expect(y2025[2]).toMatchObject({ label: '电费收入', sub: true })   // 无「其中」,靠前导空格
    expect(y2025[3]).toMatchObject({ label: '主营成本总计', sub: false })
  })

  it('note 只挂预算年行;sortOrder 跨年同行一致', () => {
    const secs = importBudget(wb(m2025)).sections!
    expect(secs[3].records[0].note).toBe('详见《主营收入预算》')
    expect(secs[0].records[0].note).toBeUndefined()   // 发生额年不挂
    for (const s of secs) expect(s.records.map(r => r.sortOrder)).toEqual([0, 1, 2, 3, 4])
  })

  it('空值跳过:某年单元格为空/短横线 → 该年不产该行', () => {
    const m = m2025.map(r => [...r])
    m[3][1] = ''      // 租金收入 2022 空
    m[4][2] = '-'     // 电费收入 2023 短横线
    const secs = importBudget(wb(m)).sections!
    expect(secs[0].records.map(r => r.label)).not.toContain('其中：租金收入')
    expect(secs[1].records.map(r => r.label)).not.toContain('电费收入')
    expect(secs[2].records).toHaveLength(5)   // 2024 不受影响
  })
})

describe('importBudget — 2025 发生额跳过与 pnl 交叉校验', () => {
  it('2026 文件:2025 年段整段消失(发生额列全跳),2026 预算照导', () => {
    const res = importBudget(wb(m2026, '2026年全面预算'))
    expect(res.sections!.map(s => s.label)).toEqual([
      '2022 预算 0 条 / 发生额 3 条',
      '2023 预算 0 条 / 发生额 3 条',
      '2024 预算 0 条 / 发生额 3 条',
      '2026 预算 3 条 / 发生额 0 条',
    ])
    expect(res.sections![3].records[0]).toMatchObject({ year: 2026, label: '收入总计', budget: 103620434.53 })
  })

  it('与 pnl 推算差 ≤1 元(真实锚点 0.08)→ 无提示;差 >1 元 → warning;无 pnl → 跳过校验', () => {
    const ok = importBudget(wb(m2026), new Map([[2025, 87722075.54]]))
    expect(ok.warning).toBeUndefined()
    const bad = importBudget(wb(m2026), new Map([[2025, 90000000]]))
    expect(bad.warning).toContain('2025')
    expect(bad.warning).toContain('收入总计')
    expect(importBudget(wb(m2026)).warning).toBeUndefined()
    expect(importBudget(wb(m2026), new Map()).warning).toBeUndefined()
  })
})

describe('importBudget — sheet 挑选与坏输入', () => {
  it('sheetMatch 正则命中「全面预算/财务预算总表」', () => {
    expect(BUDGET_SHEET_RE.test('2026年全面预算')).toBe(true)
    expect(BUDGET_SHEET_RE.test('收入预算')).toBe(false)
  })

  it('多 sheet:按名挑「全面预算」表,同名未命中的杂表被忽略', () => {
    const res = importBudget([
      { name: '收入预算', matrix: [['别的表头', 'x']] },
      { name: '2026年全面预算', matrix: m2026 },
    ])
    expect(res.error).toBeUndefined()
    expect(res.sections!.length).toBe(4)
  })

  it('粘贴路径(name 为空)→ 回退全部 sheet 解析', () => {
    const res = importBudget([{ name: '', matrix: m2025 }])
    expect(res.sections!.length).toBe(4)
  })

  it('无「项目」+双年列表头 → error', () => {
    expect(importBudget([{ name: '', matrix: [['a', 'b'], ['1', '2']] }]).error).toBeTruthy()
    expect(importBudget([{ name: '', matrix: [['项目', '2025年预算', '备注'], ['x', '1', '']] }]).error).toBeTruthy()   // 年列 <2
  })
})

// ── 真实文件集成回归(spec 验收锚点;文件不在时跳过,同台账 spec 惯例) ──
const REAL_DIR = 'C:/financial_dashboard/2025全年发生额、预算对比'
const F2025 = REAL_DIR + '/2025年年度预算（初稿）.xlsx'
const F2026 = REAL_DIR + '/2026年年度预算（2026.02.07）.xlsx'
// 与 FpImportModal 同参读取(cellDates + header:1/blankrows:false/defval:''/raw:false/dateNF)
const readWb = (f: string) => {
  const wb = XLSX.read(fs.readFileSync(f), { cellDates: true })
  return wb.SheetNames.map(name => ({
    name,
    matrix: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: '', raw: false, dateNF: 'yyyy-mm-dd' }) as string[][],
  }))
}

describe('importBudget — 真实预算工作簿(验收锚点)', () => {
  it.skipIf(!fs.existsSync(F2025))('2025 文件:4 年段×28 行;2025 预算收入 92,705,202.87;2024 发生额收入 82,867,520.26', () => {
    const res = importBudget(readWb(F2025))
    expect(res.error).toBeUndefined()
    expect(res.sections!.map(s => s.label)).toEqual([
      '2022 预算 0 条 / 发生额 28 条', '2023 预算 0 条 / 发生额 28 条',
      '2024 预算 0 条 / 发生额 28 条', '2025 预算 28 条 / 发生额 0 条',
    ])
    expect(res.sections![3].records.find(r => r.label === '收入总计')!.budget).toBe(92705202.87)
    expect(res.sections![2].records.find(r => r.label === '收入总计')!.actual).toBe(82867520.26)
  })

  it.skipIf(!fs.existsSync(F2026))('2026 文件:2025 发生额列整段跳过、与 pnl 推算差 0.08 无提示;2026 预算收入 103,620,434.53', () => {
    const res = importBudget(readWb(F2026), new Map([[2025, 87722075.54]]))
    expect(res.error).toBeUndefined()
    expect(res.warning).toBeUndefined()   // |87,722,075.46 − 87,722,075.54| = 0.08 ≤ 1
    expect(res.sections!.map(s => s.label.slice(0, 4))).toEqual(['2022', '2023', '2024', '2026'])
    expect(res.sections![3].records.find(r => r.label === '收入总计')!.budget).toBe(103620434.53)
  })
})
