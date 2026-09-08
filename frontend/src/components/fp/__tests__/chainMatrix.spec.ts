import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'

/**
 * 选期矩阵的工序点（2026-08-28 设计稿 §①）。
 *
 * 出账链共用这张矩阵，格子里的点回答的是「这个月这几道工序走到哪了」——
 * 「不直接落表格」多的那一次点击，换回来的就是这一屏信息。
 * 台账 / 附表10 / 三大报表不传 pips，行为与改前逐字相同。
 */

const BOOK = {}   // 组件只读它的真假值,见 BookMonthMatrix 的 book prop 注释

function months(over: Partial<Record<number, Record<string, unknown>>> = {}) {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, hasData: false, ...(over[i + 1] ?? {}),
  }))
}

function mk(cells: ReturnType<typeof months>) {
  setActivePinia(createPinia())
  return mount(BookMonthMatrix, {
    props: { book: BOOK, years: [{ year: 2025, months: cells }] },
  })
}

describe('选期矩阵 · 工序点', () => {
  it('传了 pips 就画点，四个点位一个不少', () => {
    const w = mk(months({ 3: { hasData: true, pips: [true, true, false, false] } }))
    const card = w.findAll('.bmm-card')[2]
    const pips = card.findAll('.bmm-pip')
    expect(pips).toHaveLength(4)
    expect(pips[0].classes()).toContain('on')
    expect(pips[1].classes()).toContain('on')
    expect(pips[2].classes()).not.toContain('on')
    expect(pips[3].classes()).not.toContain('on')
  })

  it('没做过的月不画点 —— 它是空月，走原来的虚线卡 + 「空」', () => {
    const w = mk(months({ 5: { hasData: false, pips: [false, false, false, false] } }))
    const card = w.findAll('.bmm-card')[4]
    expect(card.classes()).toContain('blank')
    expect(card.findAll('.bmm-pip')).toHaveLength(0)
    expect(card.text()).toContain('空')
  })

  it('stale 只换底色，不加边框不改尺寸 —— 布局稳定铁律', () => {
    const w = mk(months({ 3: { hasData: true, pips: [true, true, true, false], stale: true } }))
    const card = w.findAll('.bmm-card')[2]
    expect(card.classes()).toContain('stale')
    expect(card.attributes('title'), '得说清楚橙的是什么意思').toContain('重算')
  })

  it('不传 pips 时行为与改前逐字相同 —— 台账 / 附表10 / 三大报表这条路不许受影响', () => {
    const w = mk(months({ 3: { hasData: true, rowCount: 12 } }))
    const card = w.findAll('.bmm-card')[2]
    expect(card.findAll('.bmm-pip')).toHaveLength(0)
    expect(card.find('.bmm-count').text()).toBe('12 行')
    expect(card.classes()).not.toContain('stale')
  })

  it('badge 是自由文案 —— 三大报表要在同一个位置显本期净额,不是「N 行」', () => {
    const w = mk(months({ 3: { hasData: true, badge: '141,255' } }))
    const card = w.findAll('.bmm-card')[2]
    expect(card.find('.bmm-count').text()).toBe('141,255')
  })

  it('badge 压过 rowCount —— 传了就用它,不拼「行」字', () => {
    const w = mk(months({ 3: { hasData: true, rowCount: 12, badge: '¥0.00' } }))
    expect(w.findAll('.bmm-card')[2].find('.bmm-count').text()).toBe('¥0.00')
  })

  it('pips 与行数不并存 —— 一个格子只讲一件事', () => {
    const w = mk(months({ 3: { hasData: true, rowCount: 12, pips: [true, false, false, false] } }))
    const card = w.findAll('.bmm-card')[2]
    expect(card.findAll('.bmm-pip')).toHaveLength(4)
    expect(card.find('.bmm-count').exists()).toBe(false)
  })

  it('审核角标是独立角标:同传 pips 与 review 时两者都在 DOM 里', () => {
    const w = mk(months({ 3: { hasData: true, pips: [true, false, false, false], review: 'approved' } }))
    const card = w.findAll('.bmm-card')[2]
    expect(card.findAll('.bmm-pip')).toHaveLength(4)
    expect(card.find('.bmm-rv').exists(), '角标若写进 pips/badge/rowCount 那条 v-else-if 链就永远画不出来').toBe(true)
  })

  // 四档的颜色只在 scoped 样式里,jsdom 不跑它 —— 能断的只有「哪一档给哪个类」这条映射,
  // 以及只有 approved 出锁图标。类名与 .bmm-rv.rv-* 那四行 CSS 一一对应,断了类就断了颜色。
  it.each([
    ['entered', 'rv-entered', '未交审 · 该你交了', false],
    ['submitted', 'rv-submitted', '待审核 · 在审核员手上', false],
    ['approved', 'rv-approved', '已审核 · 锁了', true],
    ['returned', 'rv-returned', '已退回 · 该你改了', false],
  ] as const)('审核态 %s → 角标 .%s,title 说人话', (review, cls, title, isLock) => {
    const w = mk(months({ 3: { hasData: true, rowCount: 12, review } }))
    const rv = w.findAll('.bmm-card')[2].find('.bmm-rv')
    expect(rv.exists()).toBe(true)
    expect(rv.classes(), '颜色靠这个类,换了名字四档就全成一个色').toContain(cls)
    expect(rv.attributes('title'), '屏上只有一个点,除了 title 没第二处能讲它是什么意思').toBe(title)
    // 已审核是「锁了」,画锁;另外三档是「还没完」,画点 —— 两者不能混
    expect(rv.find('svg').exists()).toBe(isLock)
    expect(rv.find('.bmm-rvdot').exists()).toBe(!isLock)
  })

  it.each([[undefined], [null]])('review 为 %s 不画角标 —— 拿不准就不画', (review) => {
    const w = mk(months({ 3: { hasData: true, rowCount: 12, review } }))
    expect(w.findAll('.bmm-card')[2].find('.bmm-rv').exists()).toBe(false)
  })

  it('空月不画角标 —— 它本来就没有东西可交,一片虚线卡长满灰点是纯噪音', () => {
    const w = mk(months({ 5: { hasData: false, review: 'entered' } }))
    const card = w.findAll('.bmm-card')[4]
    expect(card.classes()).toContain('blank')
    expect(card.find('.bmm-rv').exists()).toBe(false)
    expect(card.text()).toContain('空')
  })

  // LAYOUT-STABILITY:角标是 absolute 的,不进 flex 流。加它 = 卡片子元素数不变、首元素仍是 .bmm-month。
  // 断类名不断像素(jsdom 不跑 scoped 样式),position:absolute 那一行查源码钉死。
  it('加角标不改月卡结构 —— absolute 角标,不进 flex 流', () => {
    const withRv = mk(months({ 3: { hasData: true, rowCount: 12, review: 'submitted' } }))
    const without = mk(months({ 3: { hasData: true, rowCount: 12 } }))
    const a = withRv.findAll('.bmm-card')[2].element
    const b = without.findAll('.bmm-card')[2].element
    expect(a.children.length, '角标是绝对定位的,不该多占一个流内子元素位').toBe(b.children.length + 1)
    expect(a.children[0].classList.contains('bmm-month')).toBe(true)
    expect(withRv.findAll('.bmm-card')[2].find('.bmm-count').text(), '角标与行数徽标并存').toBe('12 行')
    const src = readFileSync(join(__dirname, '..', 'BookMonthMatrix.vue'), 'utf8')
    expect(src, '.bmm-rv 一旦不是 absolute,四档角标就会把月卡顶高').toMatch(/\.bmm-rv\s*\{[^}]*position:\s*absolute/)
  })

  it('manageYears=false 时三处年份管理入口都不渲染', () => {
    setActivePinia(createPinia())
    const w = mount(BookMonthMatrix, {
      props: { book: BOOK, years: [{ year: 2025, months: months(), removable: true }], manageYears: false },
    })
    expect(w.find('.bmm-addy').exists()).toBe(false)     // ＋ 补更早年份
    expect(w.find('.bmm-addrow').exists()).toBe(false)   // ＋ 添加 {次年} 年
    expect(w.find('.bmm-rm-slot').exists()).toBe(false)  // 行尾移除槽
  })

  // F7:年份条是首屏唯一一个「先渲染无 pips、几百毫秒后长出 pips」的部件 —— min-height 一旦失守,
  // 链数据到达那一瞬四行月卡各长一截,底下整块两栏板子被顶下去。
  it('结构稳定:不传 pips 时卡片子元素只少 .bmm-pips 一个,.bmm-month 仍是第一个子元素', () => {
    // hasData 已经为真(年份条恒如此,取自 ov.months),但链数据还没到 —— pips/badge/rowCount 都不传,
    // 正是这屏进屏那几百毫秒的真实形状。
    const withPips = mk(months({ 3: { hasData: true, pips: [true, false, false, false] } }))
    const withoutPips = mk(months({ 3: { hasData: true } }))
    const cardWith = withPips.findAll('.bmm-card')[2].element
    const cardWithout = withoutPips.findAll('.bmm-card')[2].element
    expect(cardWithout.children.length, '只少 .bmm-pips 这一个子元素').toBe(cardWith.children.length - 1)
    expect(cardWithout.children[0].classList.contains('bmm-month')).toBe(true)
    expect(cardWith.children[0].classList.contains('bmm-month')).toBe(true)
  })

  it('卡片高度钉进源码:min-height: 62px 不许丢(jsdom 不跑 scoped 样式,查源码)', () => {
    const src = readFileSync(join(__dirname, '..', 'BookMonthMatrix.vue'), 'utf8')
    expect(src).toContain('min-height: 62px')
  })

  // F11:hasData 为 true 但 pips/badge/rowCount 都没给 —— 这是 T4 新造出来的一种卡片状态
  // (链数据未到的那几百毫秒),组件里从来没有过。:118-123 那条 v-else-if 链在这种输入下
  // 四个分支全不命中,要确认它不会掉进 .bmm-none「空」。
  it('hasData 为 true 但没给 pips/badge/rowCount 时不掉进 .bmm-none', () => {
    const w = mk(months({ 3: { hasData: true } }))
    const card = w.findAll('.bmm-card')[2]
    expect(card.find('.bmm-none').exists(), 'hasData 为真的格子不该显示「空」').toBe(false)
    expect(card.findAll('.bmm-pip')).toHaveLength(0)
    expect(card.find('.bmm-count').exists()).toBe(false)
    expect(card.find('.bmm-month').exists()).toBe(true)
  })
})
