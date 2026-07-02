import { describe, it, expect } from 'vitest'
import { TB_FIELDS, tbTotals, tbBalanceDiff, visibleRows, type TbAccount, type TbFieldKey } from './trialBalance'

// 合成科目树:1001 现金(L0)、1002 银行(L0)、100201 农商行(L1←1002)、10020101 分户(L2←100201)、1122 应收(L0)、r6 租户(L1←1122,无code)
const ACCOUNTS: TbAccount[] = [
  { rowKey: '1001', parentKey: null, code: '1001', label: '库存现金', level: 0, sortOrder: 1 },
  { rowKey: '1002', parentKey: null, code: '1002', label: '银行存款', level: 0, sortOrder: 2 },
  { rowKey: '100201', parentKey: '1002', code: '100201', label: '农商行', level: 1, sortOrder: 3 },
  { rowKey: '10020101', parentKey: '100201', code: '10020101', label: '农商行分户', level: 2, sortOrder: 4 },
  { rowKey: '1122', parentKey: null, code: '1122', label: '应收账款', level: 0, sortOrder: 5 },
  { rowKey: 'r6', parentKey: '1122', code: null, label: '某租户', level: 1, sortOrder: 6 },
]

const keys = (rows: TbAccount[]) => rows.map(r => r.rowKey)

describe('TB_FIELDS 模板', () => {
  it('8 项:4 组 × 借/贷,键序固定', () => {
    expect(TB_FIELDS.map(f => f.key)).toEqual([
      'openDr', 'openCr', 'periodDr', 'periodCr', 'ytdDr', 'ytdCr', 'endDr', 'endCr',
    ])
    expect(TB_FIELDS.map(f => f.group)).toEqual([
      '期初余额', '期初余额', '本期发生额', '本期发生额',
      '本年累计发生额', '本年累计发生额', '期末余额', '期末余额',
    ])
    expect(TB_FIELDS.map(f => f.side)).toEqual(['借方', '贷方', '借方', '贷方', '借方', '贷方', '借方', '贷方'])
  })
})

describe('tbTotals', () => {
  it('只加 level 0 行,下级明细不重复计入', () => {
    const amounts: Record<string, Partial<Record<TbFieldKey, number>>> = {
      '1001': { endDr: 100, openDr: 10 },
      '1002': { endDr: 200 },
      '100201': { endDr: 150 }, // level1,不计
      '1122': { endCr: 300 },
      r6: { endCr: 999 }, // level1,不计
    }
    const t = tbTotals(ACCOUNTS, amounts)
    expect(t.endDr).toBe(300)
    expect(t.endCr).toBe(300)
    expect(t.openDr).toBe(10)
    expect(t.periodDr).toBe(0)
  })

  it('缺行/缺字段按 0', () => {
    const t = tbTotals(ACCOUNTS, {})
    for (const f of TB_FIELDS) expect(t[f.key]).toBe(0)
  })
})

describe('tbBalanceDiff', () => {
  it('= endDr − endCr;已平为 0', () => {
    const balanced = tbTotals(ACCOUNTS, { '1001': { endDr: 300 }, '1122': { endCr: 300 } })
    expect(tbBalanceDiff(balanced)).toBe(0)
    const off = tbTotals(ACCOUNTS, { '1001': { endDr: 300 }, '1122': { endCr: 250 } })
    expect(tbBalanceDiff(off)).toBe(50)
  })
})

describe('visibleRows 折叠', () => {
  it('默认(空 expanded 空 query)只显 level 0', () => {
    expect(keys(visibleRows(ACCOUNTS, new Set(), ''))).toEqual(['1001', '1002', '1122'])
  })

  it('展开父显其直接子;孙辈仍隐藏', () => {
    expect(keys(visibleRows(ACCOUNTS, new Set(['1002']), ''))).toEqual(['1001', '1002', '100201', '1122'])
  })

  it('递归:父与祖父都在 expanded 时孙辈可见', () => {
    expect(keys(visibleRows(ACCOUNTS, new Set(['1002', '100201']), ''))).toEqual([
      '1001', '1002', '100201', '10020101', '1122',
    ])
  })

  it('只展开中间层不展开顶层 → 孙辈不可见', () => {
    expect(keys(visibleRows(ACCOUNTS, new Set(['100201']), ''))).toEqual(['1001', '1002', '1122'])
  })
})

describe('visibleRows 搜索', () => {
  it('命中 label 的行 + 全部祖先可见,无视 expanded;未命中行隐藏', () => {
    expect(keys(visibleRows(ACCOUNTS, new Set(), '分户'))).toEqual(['1002', '100201', '10020101'])
  })

  it('命中 code 同样生效;code 为 null 的行按 label 匹配', () => {
    expect(keys(visibleRows(ACCOUNTS, new Set(), '1122'))).toEqual(['1122'])
    expect(keys(visibleRows(ACCOUNTS, new Set(), '租户'))).toEqual(['1122', 'r6'])
  })

  it('无命中返回空', () => {
    expect(visibleRows(ACCOUNTS, new Set(), '不存在')).toEqual([])
  })
})

describe('visibleRows 序稳定', () => {
  it('输入乱序仍按 sortOrder 输出', () => {
    const shuffled = [...ACCOUNTS].reverse()
    expect(keys(visibleRows(shuffled, new Set(['1002', '100201', '1122']), ''))).toEqual([
      '1001', '1002', '100201', '10020101', '1122', 'r6',
    ])
    expect(keys(visibleRows(shuffled, new Set(), '农商行'))).toEqual(['1002', '100201', '10020101'])
  })
})
