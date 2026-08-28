import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

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

  it('pips 与行数不并存 —— 一个格子只讲一件事', () => {
    const w = mk(months({ 3: { hasData: true, rowCount: 12, pips: [true, false, false, false] } }))
    const card = w.findAll('.bmm-card')[2]
    expect(card.findAll('.bmm-pip')).toHaveLength(4)
    expect(card.find('.bmm-count').exists()).toBe(false)
  })
})
