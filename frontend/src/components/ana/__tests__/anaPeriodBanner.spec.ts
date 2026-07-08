// AnaPeriodBanner 文案(§五策略2「回退必须显式」)。
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AnaPeriodBanner from '../AnaPeriodBanner.vue'

describe('AnaPeriodBanner', () => {
  it('带 source:「所选 X 无{source}数据,当前显示 Y」', () => {
    const w = mount(AnaPeriodBanner, { props: { selected: '2025-03', used: '2025-10', source: '台账' } })
    expect(w.text()).toBe('所选 2025-03 无台账数据,当前显示 2025-10')
    expect(w.find('svg').exists()).toBe(true)   // alert-triangle 图标
  })

  it('不带 source:「所选 X 无数据,当前显示 Y」', () => {
    const w = mount(AnaPeriodBanner, { props: { selected: '2024-05', used: '2025-01' } })
    expect(w.text()).toBe('所选 2024-05 无数据,当前显示 2025-01')
  })
})
