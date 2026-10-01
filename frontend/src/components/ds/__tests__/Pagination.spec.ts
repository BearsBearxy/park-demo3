import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Pagination from '../Pagination.vue'
import Select from '../Select.vue'

// 2026-10-01 悬停说明(十件 ⑩)走 v-tip,挂在元素的 _tip 上;不再用浏览器 title
describe('Pagination 每页条数的悬停说明', () => {
  it('挂在下拉上、走 v-tip,不是浏览器 title', () => {
    const w = mount(Pagination, { props: { pageCount: 3, total: 50 } })
    const sel = w.findComponent(Select).element as HTMLElement & { _tip?: { text: string } }
    expect(sel._tip?.text).toBe('每页显示多少条')
    expect(w.element.querySelector('[title]')).toBeNull()
  })
})

describe('Pagination (uncontrolled)', () => {
  it('clicking page 2 emits "page" with 2 and activates the pill', async () => {
    const wrapper = mount(Pagination, {
      props: { pageCount: 3 },
    })

    // find the button with text "2"
    const buttons = wrapper.findAll('button')
    const page2 = buttons.find(b => b.text() === '2')
    expect(page2).toBeTruthy()

    await page2!.trigger('click')

    expect(wrapper.emitted('page')).toBeTruthy()
    expect(wrapper.emitted('page')![0]).toEqual([2])

    // active pill has var(--bg-sunken) background — check via font-weight semibold style
    // The pillStyle sets fontWeight to var(--fw-semibold) for the active pill
    const style = page2!.attributes('style') ?? ''
    expect(style).toContain('var(--fw-semibold)')
  })
})

describe('Pagination windowing', () => {
  const pillNums = (w: ReturnType<typeof mount>) =>
    w.findAll('button').map(b => b.text()).filter(t => /^\d+$/.test(t))
  const ellipses = (w: ReturnType<typeof mount>) =>
    w.findAll('span').filter(s => s.text() === '…')

  it('caps pills with … ellipsis when pageCount > maxPills', () => {
    const w = mount(Pagination, { props: { pageCount: 20, modelValue: 10, maxPills: 7, showMeta: false } })
    // first + window(9,10,11) + last, with two ellipses for the gaps
    expect(pillNums(w)).toEqual(['1', '9', '10', '11', '20'])
    expect(ellipses(w).length).toBe(2)
  })

  it('windows near the start (only a trailing ellipsis)', () => {
    const w = mount(Pagination, { props: { pageCount: 20, modelValue: 2, maxPills: 7, showMeta: false } })
    expect(pillNums(w)).toEqual(['1', '2', '3', '20'])
    expect(ellipses(w).length).toBe(1)
  })

  it('shows all pages when pageCount <= maxPills (no ellipsis)', () => {
    const w = mount(Pagination, { props: { pageCount: 5, modelValue: 1, maxPills: 7, showMeta: false } })
    expect(pillNums(w)).toEqual(['1', '2', '3', '4', '5'])
    expect(ellipses(w).length).toBe(0)
  })
})
