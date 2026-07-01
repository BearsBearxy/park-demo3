// 利润表行模板 + 小计公式 — 1:1 文件行次 1–32(spec §2)。前端 config,类似 views/sales-income/layout.ts。
// 小计不落库(spec R7),此处纯前端算;field='cur'(本月)|'ytd'(本年累计)。

export type RowType = 'normal' | 'label' | 'subtotal'
export interface IsRow {
  no: number
  label: string
  level: number
  type: RowType
}

// 行次 1–32,逐行照 spec §2 表。level: 0=顶层, 1=其中明细。
export const IS_ROWS: IsRow[] = [
  { no: 1,  label: '一、营业收入',                                     level: 0, type: 'normal' },
  { no: 2,  label: '减：营业成本',                                     level: 0, type: 'normal' },
  { no: 3,  label: '营业税金及附加',                                   level: 0, type: 'normal' },
  { no: 4,  label: '其中：',                                          level: 1, type: 'label' },
  { no: 5,  label: '营业税',                                          level: 1, type: 'normal' },
  { no: 6,  label: '城市维护建设税',                                   level: 1, type: 'normal' },
  { no: 7,  label: '资源税',                                          level: 1, type: 'normal' },
  { no: 8,  label: '土地增值税',                                       level: 1, type: 'normal' },
  { no: 9,  label: '城镇土地使用税、房产税、车船税、印花税',            level: 1, type: 'normal' },
  { no: 10, label: '教育费附加、矿产资源补偿费、排污费',               level: 1, type: 'normal' },
  { no: 11, label: '销售费用',                                        level: 0, type: 'normal' },
  { no: 12, label: '其中：中介费',                                     level: 1, type: 'normal' },
  { no: 13, label: '广告费和业务宣传费',                               level: 1, type: 'normal' },
  { no: 14, label: '管理费用',                                        level: 0, type: 'normal' },
  { no: 15, label: '其中：开办费',                                     level: 1, type: 'normal' },
  { no: 16, label: '业务招待费',                                       level: 1, type: 'normal' },
  { no: 17, label: '研究费用',                                        level: 1, type: 'normal' },
  { no: 18, label: '财务费用',                                        level: 0, type: 'normal' },
  { no: 19, label: '其中：利息费用（收入以"-"号填列）',                level: 1, type: 'normal' },
  { no: 20, label: '加：投资收益（损失以"-"号填列）',                  level: 0, type: 'normal' },
  { no: 21, label: '二、营业利润（亏损以"-"号填列）',                  level: 0, type: 'subtotal' },
  { no: 22, label: '加：营业外收入',                                   level: 0, type: 'normal' },
  { no: 23, label: '其中：政府补助',                                   level: 1, type: 'normal' },
  { no: 24, label: '减：营业外支出',                                   level: 0, type: 'normal' },
  { no: 25, label: '其中：坏账损失',                                   level: 1, type: 'normal' },
  { no: 26, label: '无法收回的长期债券投资损失',                       level: 1, type: 'normal' },
  { no: 27, label: '无法收回的长期股权投资损失',                       level: 1, type: 'normal' },
  { no: 28, label: '自然灾害等不可抗力因素造成的损失',                 level: 1, type: 'normal' },
  { no: 29, label: '税收滞纳金',                                       level: 1, type: 'normal' },
  { no: 30, label: '三、利润总额（亏损总额以"-"号填列）',              level: 0, type: 'subtotal' },
  { no: 31, label: '减：所得税费用',                                   level: 0, type: 'normal' },
  { no: 32, label: '四、净利润（净亏损以"-"号填列）',                  level: 0, type: 'subtotal' },
]

// 小计公式(spec §2):g=取该行值(会递归解析)。仅 21/30/32。
export const IS_FORMULA: Record<number, (g: (no: number) => number) => number> = {
  21: g => g(1) - g(2) - g(3) - g(11) - g(14) - g(18) + g(20),
  30: g => g(21) + g(22) - g(24),
  32: g => g(30) - g(31),
}

const ROW_TYPE = new Map(IS_ROWS.map(r => [r.no, r.type]))

/**
 * 单行取值(纯函数)。
 * - subtotal 行 → 走 IS_FORMULA(其 g 递归 computeRow)。
 * - normal 行含自定义子类 → 子类求和(customChildrenSum>0 或有子类时以其为准)。
 * - 否则 → 叶子录入值 getLeaf。
 * @param getLeaf 取常驻行录入值(rowKey=String(no))
 * @param customChildrenSum 取该行次自定义子类之和;无子类返回 null(表示回落叶子)
 */
export function computeRow(
  no: number,
  field: string,
  getLeaf: (no: number, field: string) => number,
  customChildrenSum: (no: number, field: string) => number | null,
): number {
  if (ROW_TYPE.get(no) === 'subtotal') {
    const formula = IS_FORMULA[no]
    return formula(ref => computeRow(ref, field, getLeaf, customChildrenSum))
  }
  const childSum = customChildrenSum(no, field)
  if (childSum !== null) return childSum
  return getLeaf(no, field)
}
