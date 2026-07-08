// AnaShell periodMode 三态渲染(§五期间语义):full 默认零变化 / year 隐月只年·不写穿粒度单例(复审) / none 隐控件显口径徽章。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { __resetPeriodForTest, usePeriod } from '@/analysis/usePeriod'

vi.mock('@/analysis/anaData', () => ({
  fetchAvailableMonths: () => Promise.resolve({ months: ['2025-01', '2025-06', '2025-10'], sources: {} }),
}))

import AnaShell from './AnaShell.vue'

beforeEach(() => {
  __resetPeriodForTest()
  localStorage.clear()
})

describe('AnaShell periodMode 三态', () => {
  it('默认(不传)= full:粒度切换 + 年月双下拉齐全', async () => {
    const w = mount(AnaShell)
    await flushPromises()
    expect(w.find('.anx-seg').exists()).toBe(true)
    expect(w.text()).toContain('按月')
    expect(w.findAll('.anx-sel').length).toBe(2)   // 年 + 月(默认落最新月,月粒度)
    expect(w.find('.anx-nav').exists()).toBe(true)
  })

  it('year:隐藏粒度切换与月下拉,不写穿全局粒度(复审:纯局部展示)', async () => {
    const w = mount(AnaShell, { props: { periodMode: 'year' } })
    await flushPromises()
    expect(w.find('.anx-seg').exists()).toBe(false)
    expect(w.text()).not.toContain('按月')
    expect(w.findAll('.anx-sel').length).toBe(1)   // 仅年下拉
    expect(usePeriod().sel.value.gran).toBe('month')   // 单例粒度不被 year 屏改写
  })

  it('none:期间控件整体隐藏,scopeChip 渲染口径徽章', async () => {
    const w = mount(AnaShell, { props: { periodMode: 'none', scopeChip: '主数据快照' } })
    await flushPromises()
    expect(w.findAll('.anx-sel').length).toBe(0)
    expect(w.find('.anx-seg').exists()).toBe(false)
    expect(w.find('.anx-nav').exists()).toBe(false)
    expect(w.find('.ana-pill').text()).toBe('主数据快照')
    expect(w.text()).toContain('口径')
  })
})
