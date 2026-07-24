import type { RentTierDTO } from '@/types/contract'

// 租金阶梯期纯函数(CONTRACT-CARD-V2-SPEC §5)。阶梯=参考排程,不参与计费(§1)。

/** 按 feeKey 分组(null 归一组),组内按 seq 升序。 */
export function groupTiers(tiers: RentTierDTO[]): { feeKey: string | null; rows: RentTierDTO[] }[] {
  const map = new Map<string, { feeKey: string | null; rows: RentTierDTO[] }>()
  for (const t of tiers) {
    const k = t.feeKey ?? ''
    let g = map.get(k)
    if (!g) { g = { feeKey: t.feeKey ?? null, rows: [] }; map.set(k, g) }
    g.rows.push(t)
  }
  for (const g of map.values()) g.rows.sort((a, b) => a.seq - b.seq)
  return [...map.values()]
}

/** 当前段下标;仅当起止都非空时判定,闭区间。无法判定返回 -1(相对期限/区间外)。 */
export function currentTierIndex(rows: RentTierDTO[], today: string): number {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.startDate || !r.endDate) continue
    if (r.startDate <= today && today <= r.endDate) return i
  }
  return -1
}

/** 换档告警(§5.3):当前段单价 ≠ 合同现行单价(差 > 0.001)时返回详情,否则 null。仅提示,不改数。 */
export function tierMismatch(
  rows: RentTierDTO[], today: string, contractUnitPrice: number | null | undefined,
): { tier: RentTierDTO; expected: number; actual: number } | null {
  const i = currentTierIndex(rows, today)
  if (i < 0) return null
  const expected = rows[i].unitPrice
  if (expected == null || contractUnitPrice == null) return null
  if (Math.abs(expected - contractUnitPrice) <= 0.001) return null
  return { tier: rows[i], expected, actual: contractUnitPrice }
}
