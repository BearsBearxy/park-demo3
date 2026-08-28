import { cnNumeral } from './zoneLabel'

// 天面与负一层不在 floorCount 的计数里(floor_count 数的是地上标准层),恒列出来。
const SPECIAL = ['负一层', '天面']

/**
 * 池定位的楼层候选 = 该楼栋 1..floorCount 生成中文 ∪ 特殊层 ∪ 库里已有值。
 * 用 floorCount 而不是 unit 表:三期两栋大厦现在 0 单元,但可以先设层数。
 * 保持 Select(而非自由输入):floor_label 参与 poolCandidates 与楼层分桶的字符串匹配。
 */
export function floorLabels(floorCount: number, existing: (string | null | undefined)[]): string[] {
  const derived = Array.from({ length: Math.max(0, floorCount | 0) }, (_, i) => cnNumeral(i + 1) + '楼')
  const extra = existing.map(s => (s ?? '').trim()).filter(s => s !== '')
  return [...new Set([...derived, ...SPECIAL, ...extra])]
}
