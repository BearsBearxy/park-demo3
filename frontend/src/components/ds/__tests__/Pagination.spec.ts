import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Pagination from '../Pagination.vue'

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
