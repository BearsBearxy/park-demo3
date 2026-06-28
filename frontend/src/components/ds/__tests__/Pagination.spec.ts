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
