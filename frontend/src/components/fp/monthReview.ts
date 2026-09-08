import type { ReviewStatus } from '@/types/review'

// 一个月格对多把审核键时,角标画哪一档(SIDEBAR-UX-REDESIGN §9.2-4)。
//
// 月格回答的是「这个月还有没有我的事」,所以取**最未完成**的那一档 ——
// 五把键里只要有一把被退回,这个月就还得回来改,不能因为另外四把审过了就画成绿锁。
// 判据只许有这一份:塞进宿主的模板三元里,ChainMonthGate 与后来的宿主会各写一遍并漂移(这仓栽过三次)。
const RANK: readonly ReviewStatus[] = ['returned', 'entered', 'submitted', 'approved']

/**
 * 多把键 → 一枚角标。空表、或任何一把键的态还没到手(null/undefined)一律回 null =「不画」。
 *
 * ⚠ 「有一把不知道就整格不画」是故意的,不是偷懒:未知那一把要是被当成
 * `entered` 混进来,取最未完成会让它压过其余四把,整格画成灰点「该你交了」——
 * 取数落地前先刷一片假灰点再翻牌,比什么都不画坏得多。
 * 与 stores/review.ts `blockOf`「拿不准就不挡」同一条口径。
 */
export function worstReview(
  list: readonly (ReviewStatus | null | undefined)[],
): ReviewStatus | null {
  if (!list.length) return null
  let best = RANK.length
  for (const s of list) {
    if (!s) return null
    const i = RANK.indexOf(s)
    if (i >= 0 && i < best) best = i
  }
  return RANK[best] ?? null
}
