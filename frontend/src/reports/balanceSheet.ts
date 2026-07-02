// 资产负债表行模板 + 合计公式 — 1:1 文件行次 1–53(spec §2)。同 reports/incomeStatement.ts 约定。
// 合计不落库(spec B4),此处纯前端算;单列 field='end'(期末余额)。side: L=资产, R=负债和所有者权益。

export type BsRowType = 'normal' | 'label' | 'subtotal'
export interface BsRow {
  no: number | null // label 行无行次
  side: 'L' | 'R'
  label: string
  level: number
  type: BsRowType
}

// 行次 1–53,逐行照 spec §2。level: 0=顶层, 1=其中明细(10–13 信息行,不汇总)。
export const BS_ROWS: BsRow[] = [
  // ── 资产(side L) ──
  { no: null, side: 'L', label: '流动资产：',                          level: 0, type: 'label' },
  { no: 1,  side: 'L', label: '货币资金',                              level: 0, type: 'normal' },
  { no: 2,  side: 'L', label: '短期投资',                              level: 0, type: 'normal' },
  { no: 3,  side: 'L', label: '应收票据',                              level: 0, type: 'normal' },
  { no: 4,  side: 'L', label: '应收账款',                              level: 0, type: 'normal' },
  { no: 5,  side: 'L', label: '预付账款',                              level: 0, type: 'normal' },
  { no: 6,  side: 'L', label: '应收股利',                              level: 0, type: 'normal' },
  { no: 7,  side: 'L', label: '应收利息',                              level: 0, type: 'normal' },
  { no: 8,  side: 'L', label: '其他应收款',                            level: 0, type: 'normal' },
  { no: 9,  side: 'L', label: '存货',                                  level: 0, type: 'normal' },
  { no: 10, side: 'L', label: '其中：原材料',                          level: 1, type: 'normal' },
  { no: 11, side: 'L', label: '在产品',                                level: 1, type: 'normal' },
  { no: 12, side: 'L', label: '库存商品',                              level: 1, type: 'normal' },
  { no: 13, side: 'L', label: '周转材料',                              level: 1, type: 'normal' },
  { no: 14, side: 'L', label: '其他流动资产',                          level: 0, type: 'normal' },
  { no: 15, side: 'L', label: '流动资产合计',                          level: 0, type: 'subtotal' },
  { no: null, side: 'L', label: '非流动资产：',                        level: 0, type: 'label' },
  { no: 16, side: 'L', label: '长期债券投资',                          level: 0, type: 'normal' },
  { no: 17, side: 'L', label: '长期股权投资',                          level: 0, type: 'normal' },
  { no: 18, side: 'L', label: '固定资产原价',                          level: 0, type: 'normal' },
  { no: 19, side: 'L', label: '减：累计折旧',                          level: 0, type: 'normal' },
  { no: 20, side: 'L', label: '固定资产账面价值',                      level: 0, type: 'subtotal' },
  { no: 21, side: 'L', label: '在建工程',                              level: 0, type: 'normal' },
  { no: 22, side: 'L', label: '工程物资',                              level: 0, type: 'normal' },
  { no: 23, side: 'L', label: '固定资产清理',                          level: 0, type: 'normal' },
  { no: 24, side: 'L', label: '生产性生物资产',                        level: 0, type: 'normal' },
  { no: 25, side: 'L', label: '无形资产',                              level: 0, type: 'normal' },
  { no: 26, side: 'L', label: '开发支出',                              level: 0, type: 'normal' },
  { no: 27, side: 'L', label: '长期待摊费用',                          level: 0, type: 'normal' },
  { no: 28, side: 'L', label: '其他非流动资产',                        level: 0, type: 'normal' },
  { no: 29, side: 'L', label: '非流动资产合计',                        level: 0, type: 'subtotal' },
  { no: 30, side: 'L', label: '资产总计',                              level: 0, type: 'subtotal' },
  // ── 负债和所有者权益(side R) ──
  { no: null, side: 'R', label: '流动负债：',                          level: 0, type: 'label' },
  { no: 31, side: 'R', label: '短期借款',                              level: 0, type: 'normal' },
  { no: 32, side: 'R', label: '应付票据',                              level: 0, type: 'normal' },
  { no: 33, side: 'R', label: '应付账款',                              level: 0, type: 'normal' },
  { no: 34, side: 'R', label: '预收账款',                              level: 0, type: 'normal' },
  { no: 35, side: 'R', label: '应付职工薪酬',                          level: 0, type: 'normal' },
  { no: 36, side: 'R', label: '应交税费',                              level: 0, type: 'normal' },
  { no: 37, side: 'R', label: '应付利息',                              level: 0, type: 'normal' },
  { no: 38, side: 'R', label: '应付利润',                              level: 0, type: 'normal' },
  { no: 39, side: 'R', label: '其他应付款',                            level: 0, type: 'normal' },
  { no: 40, side: 'R', label: '其他流动负债',                          level: 0, type: 'normal' },
  { no: 41, side: 'R', label: '流动负债合计',                          level: 0, type: 'subtotal' },
  { no: null, side: 'R', label: '非流动负债：',                        level: 0, type: 'label' },
  { no: 42, side: 'R', label: '长期借款',                              level: 0, type: 'normal' },
  { no: 43, side: 'R', label: '长期应付款',                            level: 0, type: 'normal' },
  { no: 44, side: 'R', label: '递延收益',                              level: 0, type: 'normal' },
  { no: 45, side: 'R', label: '其他非流动负债',                        level: 0, type: 'normal' },
  { no: 46, side: 'R', label: '非流动负债合计',                        level: 0, type: 'subtotal' },
  { no: 47, side: 'R', label: '负债合计',                              level: 0, type: 'subtotal' },
  { no: null, side: 'R', label: '所有者权益（或股东权益）：',          level: 0, type: 'label' },
  { no: 48, side: 'R', label: '实收资本（或股本）',                    level: 0, type: 'normal' },
  { no: 49, side: 'R', label: '资本公积',                              level: 0, type: 'normal' },
  { no: 50, side: 'R', label: '盈余公积',                              level: 0, type: 'normal' },
  { no: 51, side: 'R', label: '未分配利润',                            level: 0, type: 'normal' },
  { no: 52, side: 'R', label: '所有者权益（或股东权益）合计',          level: 0, type: 'subtotal' },
  { no: 53, side: 'R', label: '负债和所有者权益（或股东权益）总计',    level: 0, type: 'subtotal' },
]

// 合计公式(spec §2):g=取该行值(会递归解析)。其中明细 10–13 不入 15。
export const BS_SUBTOTAL: Record<number, (g: (no: number) => number) => number> = {
  20: g => g(18) - g(19),
  15: g => [1, 2, 3, 4, 5, 6, 7, 8, 9, 14].reduce((s, n) => s + g(n), 0),
  29: g => [16, 17, 20, 21, 22, 23, 24, 25, 26, 27, 28].reduce((s, n) => s + g(n), 0),
  30: g => g(15) + g(29),
  41: g => [31, 32, 33, 34, 35, 36, 37, 38, 39, 40].reduce((s, n) => s + g(n), 0),
  46: g => [42, 43, 44, 45].reduce((s, n) => s + g(n), 0),
  47: g => g(41) + g(46),
  52: g => [48, 49, 50, 51].reduce((s, n) => s + g(n), 0),
  53: g => g(47) + g(52),
}

const ROW_TYPE = new Map(BS_ROWS.filter(r => r.no !== null).map(r => [r.no as number, r.type]))

/**
 * 单行取值(纯函数)。单列 end,无 field 参数。
 * - subtotal 行 → 走 BS_SUBTOTAL(其 g 递归 computeBsRow)。
 * - normal 行含自定义子类 → 子类求和。
 * - 否则 → 叶子录入值 getLeaf。
 * @param getLeaf 取常驻行录入值(rowKey=String(no))
 * @param customChildrenSum 取该行次自定义子类之和;无子类返回 null(表示回落叶子)
 */
export function computeBsRow(
  no: number,
  getLeaf: (no: number) => number,
  customChildrenSum: (no: number) => number | null,
): number {
  if (ROW_TYPE.get(no) === 'subtotal') {
    const formula = BS_SUBTOTAL[no]
    return formula(ref => computeBsRow(ref, getLeaf, customChildrenSum))
  }
  const childSum = customChildrenSum(no)
  if (childSum !== null) return childSum
  return getLeaf(no)
}
