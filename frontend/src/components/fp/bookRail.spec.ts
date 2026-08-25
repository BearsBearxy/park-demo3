import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BookRail from './BookRail.vue'
import BookMonthMatrix from './BookMonthMatrix.vue'
import type { Book } from '@/types/book'

const book = (id: number, name: string, ver = 1): Book => ({
  id, screen: 'ledger', companyId: id, phase: null, name, ver, latestVer: ver, definition: { groups: [] },
})

const books = [book(1, '一泽台账', 3), book(2, '积前台账')]

describe('BookRail 账册栏', () => {
  const mk = (props: Record<string, unknown> = {}) =>
    mount(BookRail, { props: { books, activeId: 1, canManage: true, ...props } })

  it('渲染账册名+版本徽标,active 项高亮', () => {
    const w = mk()
    const items = w.findAll('.br-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('一泽台账')
    expect(items[0].text()).toContain('v3')
    expect(items[0].classes()).toContain('on')
    expect(items[1].classes()).not.toContain('on')
  })

  it('点击项 emit select(id)', async () => {
    const w = mk()
    await w.findAll('.br-item')[1].trigger('click')
    expect(w.emitted('select')).toEqual([[2]])
  })

  it('canManage=true 渲染新增入口,点击 emit create', async () => {
    const w = mk()
    const btn = w.find('.br-create')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(w.emitted('create')).toHaveLength(1)
  })

  it('canManage=false 不渲染底部管理区(company:manage 门)', () => {
    const w = mk({ canManage: false })
    expect(w.find('.br-create').exists()).toBe(false)
    expect(w.find('.br-delete').exists()).toBe(false)
  })

  it('删除入口在底部管理区与新增并排,emit delete;行内无删除钮(不夹选册点击目标)', async () => {
    const w = mk({})
    expect(w.find('.br-item .br-del').exists()).toBe(false)   // 行内退场(用户拍板 2026-08-24)
    await w.find('.br-delete').trigger('click')
    expect(w.emitted('delete')).toHaveLength(1)
    expect(w.emitted('select')).toBeUndefined()
  })
})

describe('BookMonthMatrix 选期矩阵 v3(多年纵排)', () => {
  const mkMonths = (dataN: number) => Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    hasData: i < dataN,
    rowCount: i < dataN ? 90 + i : undefined,
    cur: false,
  }))
  const years = [
    { year: 2024, months: mkMonths(0), sub: '手工年', removable: true },
    { year: 2025, months: mkMonths(2) },
  ]
  const mk = (props: Record<string, unknown> = {}) =>
    mount(BookMonthMatrix, { props: { book: book(1, '一泽台账'), years, ...props } })

  it('全部年份纵排:每年一行 12 月卡;有数据卡实底+行数,无数据卡虚线「空」', () => {
    const w = mk()
    expect(w.findAll('.bmm-yrow:not(.bmm-addrow)')).toHaveLength(2)
    const cards = w.findAll('.bmm-card')
    expect(cards).toHaveLength(24)
    expect(cards[12].classes()).toContain('has')       // 2025-1
    expect(cards[12].text()).toContain('90 行')
    expect(cards[0].classes()).toContain('blank')      // 2024-1 空
    expect(w.text()).toContain('手工年')
  })

  it('点月卡 emit pick(该行年份, 月)', async () => {
    const w = mk()
    await w.findAll('.bmm-card')[14].trigger('click')   // 2025 行第 3 卡
    expect(w.emitted('pick')).toEqual([[2025, 3]])
  })

  it('增删年份:补更早/添加次年/移除手工空年', async () => {
    const w = mk()
    await w.find('.bmm-addy').trigger('click')
    expect(w.emitted('add-earlier')).toHaveLength(1)
    await w.find('.bmm-addbtn').trigger('click')
    expect(w.emitted('add-later')).toHaveLength(1)
    expect(w.find('.bmm-addbtn').text()).toContain('2026')   // 末年+1
    expect(w.findAll('.bmm-rm')).toHaveLength(1)             // 仅 removable 行有移除钮
    await w.find('.bmm-rm').trigger('click')
    expect(w.emitted('remove-year')).toEqual([[2024]])
  })

  it('book=null 显示占位,不渲染月卡与增删入口', () => {
    const w = mk({ book: null })
    expect(w.findAll('.bmm-card')).toHaveLength(0)
    expect(w.find('.bmm-addy').exists()).toBe(false)
    expect(w.text()).toContain('请选择账册')
  })
})
