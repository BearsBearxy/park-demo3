import type { ContractDTO } from '@/types/contract'

// 续签链聚合(CONTRACT-CARD-SPEC §5.3,前端本地做,无 /chain 端点)。
// 叶子(最新一期)= 不被任何其他合同当作 parentContractId 的合同。列表默认只显叶子。

/** 叶子合同 id 集合:list 中未被任何合同引用为 parentContractId 者。 */
export function leafIds(list: ContractDTO[]): Set<number> {
  const parents = new Set<number>()
  for (const c of list) if (c.parentContractId != null) parents.add(c.parentContractId)
  return new Set(list.filter(c => !parents.has(c.id)).map(c => c.id))
}

/** 列表默认显示的合同 id:每链优先取**当前生效段**(起止日覆盖今天且非草稿/已终止),
 *  没有生效段(整链已过期或全是未来期)时退回原链尾规则(2026-07-28 拍板)。
 *  today 传 'YYYY-MM-DD',与 DTO 的日期字符串按字典序直接比较。 */
export function displayIds(list: ContractDTO[], today = new Date().toLocaleDateString('sv')): Set<number> {
  const byId = new Map(list.map(c => [c.id, c]))
  const out = new Set<number>()
  for (const leafId of leafIds(list)) {
    const chain = [byId.get(leafId)!, ...ancestorsOf(list, leafId)]
    const cur = chain.find(c =>
      c.startDate && c.endDate && c.startDate <= today && today <= c.endDate
      && c.status !== 'draft' && c.status !== 'terminated')
    out.add((cur ?? chain[0]).id)
  }
  return out
}

/** 沿 parentContractId 上溯的历史各期(近→远,不含自身);环/悬空自动止步。 */
export function ancestorsOf(list: ContractDTO[], id: number): ContractDTO[] {
  const byId = new Map(list.map(c => [c.id, c]))
  const out: ContractDTO[] = []
  const guard = new Set<number>()
  let cur = byId.get(id)?.parentContractId ?? null
  while (cur != null && byId.has(cur) && !guard.has(cur)) {
    guard.add(cur)
    const p = byId.get(cur)!
    out.push(p)
    cur = p.parentContractId ?? null
  }
  return out
}

/** 沿 parentContractId 向下找后代(远→近,不含自身);分叉取 id 最大者并告警;环/悬空自动止步。 */
export function descendantsOf(list: ContractDTO[], id: number): ContractDTO[] {
  const childrenOf = new Map<number, ContractDTO[]>()
  for (const c of list) {
    if (c.parentContractId == null) continue
    const arr = childrenOf.get(c.parentContractId) ?? []
    arr.push(c); childrenOf.set(c.parentContractId, arr)
  }
  const out: ContractDTO[] = []
  const guard = new Set<number>([id])
  let cur = id
  for (;;) {
    const kids = childrenOf.get(cur)
    if (!kids || kids.length === 0) break
    if (kids.length > 1)
      console.warn(`[chain] 合同 ${cur} 存在 ${kids.length} 份续签分叉,取最新一条(CONTRACT-CARD-V2-SPEC §12)`)
    const next = kids.reduce((a, b) => (b.id > a.id ? b : a))
    if (guard.has(next.id)) break
    guard.add(next.id); out.push(next); cur = next.id
  }
  return out
}

/** 整条续签链(祖先+自身+后代),按期序返回并标期号 seq(从 1 起,用户拍板用 1,2,3)。 */
export function chainOf(list: ContractDTO[], id: number): { c: ContractDTO; seq: number }[] {
  const self = list.find(x => x.id === id)
  if (!self) return []
  const ordered = [...ancestorsOf(list, id).slice().reverse(), self, ...descendantsOf(list, id)]
  // 环形数据下祖先段与后代段会重叠(如 1↔2 互指),按 id 去重保证链上每份合同只出现一次
  const seen = new Set<number>()
  const uniq = ordered.filter(c => {
    if (seen.has(c.id)) return false
    seen.add(c.id); return true
  })
  return uniq.map((c, i) => ({ c, seq: i + 1 }))
}
