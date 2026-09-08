import { describe, it, expect } from 'vitest'
import { worstReview } from '@/components/fp/monthReview'

/**
 * 一格多把键时角标取哪一档(SIDEBAR-UX-REDESIGN §9.2-4)。
 *
 * 月格回答的是「这个月还有没有我的事」,所以取最未完成的那一档:
 * returned > entered > submitted > approved。判据只有这一份,宿主一律调它,不在模板里三元判。
 */
describe('月卡审核角标 · 多键聚合', () => {
  it('单把键原样回传 —— 一格一把的六个宿主走的就是这条', () => {
    expect(worstReview(['entered'])).toBe('entered')
    expect(worstReview(['submitted'])).toBe('submitted')
    expect(worstReview(['approved'])).toBe('approved')
    expect(worstReview(['returned'])).toBe('returned')
  })

  it('全审过才画绿锁 —— 出账链五把键都 approved', () => {
    expect(worstReview(['approved', 'approved', 'approved', 'approved', 'approved'])).toBe('approved')
  })

  it('退回压过其余三档 —— 一把被打回来,这个月就还得回来改', () => {
    expect(worstReview(['approved', 'submitted', 'entered', 'returned'])).toBe('returned')
  })

  it('未交审压过待审核与已审核 —— 还没交的那把才是要我动手的', () => {
    expect(worstReview(['approved', 'submitted', 'entered'])).toBe('entered')
  })

  it('待审核压过已审核 —— 四把审了三把,别画成锁了', () => {
    expect(worstReview(['approved', 'approved', 'submitted'])).toBe('submitted')
  })

  it('顺序无关 —— 聚合序不许被数组顺序左右', () => {
    expect(worstReview(['returned', 'approved'])).toBe(worstReview(['approved', 'returned']))
    expect(worstReview(['entered', 'submitted'])).toBe(worstReview(['submitted', 'entered']))
  })

  // ⚠ 「有一把不知道就整格不画」是故意的:未知那把若按 entered 算,取最未完成会让它压过其余全部,
  // 取数落地前整张矩阵先刷成一片假灰点「该你交了」再翻牌 —— 比什么都不画坏得多。
  it('任何一把还没到手就整格不画 —— 拿不准就不画', () => {
    expect(worstReview(['approved', null])).toBe(null)
    expect(worstReview(['approved', undefined])).toBe(null)
    expect(worstReview([null, 'returned'])).toBe(null)
  })

  it('空表回 null —— 没有键的格子(白名单屏)一格不画', () => {
    expect(worstReview([])).toBe(null)
  })
})
