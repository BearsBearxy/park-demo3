// 表格卡工具条(画布 03-A「分时用量 · 列 · 2 列隐藏」、04-A「分时列 · 列」;实现规范 §1.9)
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import FPTableTools, { type ToolColumn } from '../FPTableTools.vue'

// 03-A 注:实收 / 盈亏默认隐藏,收进列菜单
const columns: ToolColumn[] = [
  { key: 'std', label: '分摊标准' }, { key: 'paid', label: '实收' }, { key: 'pl', label: '盈亏' },
]

let w: VueWrapper | null = null
afterEach(() => { w?.unmount(); w = null })

describe('FPTableTools', () => {
  it('row + 两列隐藏:写「2 列隐藏」,出一个开关', () => {
    w = mount(FPTableTools, { props: { mode: 'row', switchLabel: '分时用量', hidden: ['paid', 'pl'], columns } })
    expect(w.text()).toContain('列 · 2 列隐藏')
    expect(w.findAll('[role=switch]').length).toBe(1)
    expect(w.find('[role=switch]').text()).toBe('分时用量')
  })
  it('mode=none 不出开关', () => {
    w = mount(FPTableTools, { props: { mode: 'none', hidden: ['paid', 'pl'], columns } })
    expect(w.findAll('[role=switch]').length).toBe(0)
  })
  it('没有隐藏列时只写「列」(04-A)', () => {
    w = mount(FPTableTools, { props: { mode: 'cols', switchLabel: '分时列', hidden: [], columns } })
    expect(w.find('.fp-tt-cols').text()).toBe('列')
  })
  it('开关受控:aria-checked 跟 tou,点一下 emit 取反', async () => {
    w = mount(FPTableTools, { props: { mode: 'cols', tou: true, columns } })
    const sw = w.find('[role=switch]')
    expect(sw.attributes('aria-checked')).toBe('true')
    await sw.trigger('click')
    expect(w.emitted('update:tou')).toEqual([[false]])
  })
  it('列菜单:隐藏的列不打勾,点它放回来;点显示的列把它藏起来', async () => {
    w = mount(FPTableTools, { props: { hidden: ['paid', 'pl'], columns } })
    await w.find('.fp-tt-cols').trigger('click')
    const items = w.findAll('[role=menuitemcheckbox]')
    expect(items.map(i => [i.text(), i.attributes('aria-checked')]))
      .toEqual([['分摊标准', 'true'], ['实收', 'false'], ['盈亏', 'false']])
    await items[1].trigger('click')
    await items[0].trigger('click')
    expect(w.emitted('update:hidden')).toEqual([[['pl']], [['paid', 'pl', 'std']]])
  })
  it('默认插槽放在条里(05-A「批量确认」)', () => {
    w = mount(FPTableTools, { slots: { default: '<button class="bulk">批量确认</button>' } })
    expect(w.find('.fp-tt .bulk').text()).toBe('批量确认')
    expect(w.find('.fp-tt-cols').exists()).toBe(false)
  })
})
