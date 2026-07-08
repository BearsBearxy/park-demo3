import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DataHomeOverviewDTO } from '@/types/dataHome'

// go() 现走 tabs.openFresh(全新语义)→ 组件依赖 Pinia
beforeEach(() => setActivePinia(createPinia()))

// 路由 stub:DataHomeView 用 useRouter().push;断点点击直达。
const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

// api stub:返回固定 mock overview。
const mockOverview: DataHomeOverviewDTO = {
  period: { year: 2026, month: 6, label: '2026年6月' },
  progressDone: 7,
  progressTotal: 9,
  pct: 78,
  kpis: [
    { label: '数据完整度', value: '78%', sub: '7 / 9 项', tint: 'slate', icon: 'clipboard-check' },
    { label: '待处理事项', value: '3', sub: '本期待补', tint: 'sky', icon: 'list-todo' },
    { label: '本期记录数', value: '142', sub: '本期已录', tint: 'blue', icon: 'files' },
    { label: '最近更新', value: '11:59', sub: '6/3 · 月度台账', tint: 'cyan', icon: 'upload' },
  ],
  sources: [
    { name: '月度台账', tag: '凭证', status: 'missing', updated: '—', go: 'ledger' },
    { name: '销售收入', tag: '附10', status: 'done', updated: '6/2', go: 'sales-income' },
    { name: '工资明细', tag: '附12', status: 'done', updated: '6/3', go: 'salary' },
    { name: '办公水电', tag: '附13', status: 'done', updated: '6/4', go: 'utilities' },
    { name: '三期水电', tag: '附14', status: 'done', updated: '6/4', go: 'utilities' },
    { name: '光伏发电', tag: '附6', status: 'done', updated: '6/1', go: 'pv-income' },
    { name: '汽车充电桩', tag: '附7', status: 'done', updated: '6/1', go: 'car-charging' },
    { name: '电动车充电桩', tag: '附8', status: 'done', updated: '6/1', go: 'ebike-charging' },
    { name: '电费成本', tag: '附11', status: 'missing', updated: '—', go: 'elec-cost' },
  ],
  tasks: [
    { label: '月度台账 本期未录入', meta: '本期 2026年6月 暂无数据', cta: '去录入', go: 'ledger', sev: 'warning' },
    { label: '电费成本 本期未录入', meta: '本期 2026年6月 暂无数据', cta: '去录入', go: 'elec-cost', sev: 'warning' },
    { label: '2 份合同即将到期待续签', meta: '本月需关注续签', cta: '查看合同', go: 'contracts', sev: 'warning' },
  ],
  recent: [
    { source: '月度台账', period: '2026-05', time: '6/3 11:59' },
    { source: '工资明细', period: '2026-06', time: '6/3 09:12' },
    { source: '销售收入', period: '2026-06', time: '6/2 10:05' },
    { source: '办公水电', period: '2026-06', time: '6/1 15:20' },
    { source: '光伏发电', period: '2026', time: '6/1 08:00' },
    { source: '汽车充电桩', period: '2026', time: '6/1 07:30' },
  ],
}
vi.mock('@/api/dataHome', () => ({
  dataHomeApi: { getOverview: () => Promise.resolve(mockOverview) },
}))

import DataHomeView from './DataHomeView.vue'

describe('DataHomeView 数据中心首页', () => {
  it('overview 到达前显加载门,到达后渲三栏', async () => {
    const w = mount(DataHomeView)
    expect(w.find('.page-loading').exists()).toBe(true)
    await flushPromises()
    expect(w.find('.page-loading').exists()).toBe(false)
    expect(w.find('.dh').exists()).toBe(true)
    expect(w.text()).toContain('本期 · 2026年6月')
  })

  it('渲 4 KPI / 9 源 / 3 待办条 / 进度 pct', async () => {
    const w = mount(DataHomeView)
    await flushPromises()
    // 4 KPI:KpiCard 不带 class,以 sub 文案断言
    expect(w.text()).toContain('7 / 9 项')
    expect(w.text()).toContain('本期待补')
    expect(w.text()).toContain('本期已录')
    // 9 源行
    expect(w.findAll('.dh-src-row').length).toBe(9)
    // 待办条
    expect(w.findAll('.dh-task').length).toBe(3)
    // 进度 pct
    expect(w.find('.dh-progress-pct').text()).toBe('78%')
    expect(w.find('.dh-progress-fill').attributes('style')).toContain('width: 78%')
    // 最近动态 6 条
    expect(w.findAll('.dh-recent-row').length).toBe(6)
  })

  it('点待办/源行 → router.push("/"+go)', async () => {
    const w = mount(DataHomeView)
    await flushPromises()
    push.mockClear()
    await w.findAll('.dh-task')[1].trigger('click')
    expect(push).toHaveBeenCalledWith('/elec-cost')
    await w.findAll('.dh-src-row')[1].trigger('click')
    expect(push).toHaveBeenCalledWith('/sales-income')
  })
})
