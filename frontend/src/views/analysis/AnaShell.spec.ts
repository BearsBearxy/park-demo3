// 2026-08-20:年/月由原生 <select> 换成 ds/Select(下拉面板此前是 OS 渲染,与全站不一致),
// 包裹类 .anx-sel → .anx-selw。
// 2026-09-19:年下拉 + 月下拉合成一个 ds/DatePicker 期间字段(DATE-PICKER-SPEC §5 第 5 节):
// full=1 个字段(按月月份面板 / 按年年份面板)/ year=1 / none=0。
// AnaShell periodMode 三态渲染(§五期间语义):full 默认零变化 / year 隐月只年·不写穿粒度单例(复审) / none 隐控件显口径徽章。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { __resetPeriodForTest, usePeriod } from '@/analysis/usePeriod'

vi.mock('@/analysis/anaData', () => ({
  fetchAvailableMonths: () => Promise.resolve({ months: ['2025-01', '2025-06', '2025-10'], sources: {} }),
}))

import AnaShell from './AnaShell.vue'
import type { VueWrapper } from '@vue/test-utils'

// ds/DatePicker 是泛型组件,findComponent(组件) 的类型推不出 VueWrapper;按名字找
const picker = (w: VueWrapper) => w.findComponent({ name: 'DatePicker' })

beforeEach(() => {
  __resetPeriodForTest()
  localStorage.clear()
})

describe('AnaShell periodMode 三态', () => {
  it('默认(不传)= full:粒度切换 + 一个期间字段(月份面板)', async () => {
    const w = mount(AnaShell)
    await flushPromises()
    expect(w.find('.anx-seg').exists()).toBe(true)
    expect(w.text()).toContain('按月')
    expect(w.findAll('.anx-selw').length).toBe(1)
    const dp = picker(w)
    expect(dp.props('mode')).toBe('month')
    expect(dp.props('modelValue'), '默认落最新月').toBe('2025-10')
    expect(w.find('.anx-nav').exists()).toBe(true)
  })

  it('year:隐藏粒度切换与月下拉,不写穿全局粒度(复审:纯局部展示)', async () => {
    const w = mount(AnaShell, { props: { periodMode: 'year' } })
    await flushPromises()
    expect(w.find('.anx-seg').exists()).toBe(false)
    expect(w.text()).not.toContain('按月')
    expect(w.findAll('.anx-selw').length).toBe(1)   // 仅年份字段
    expect(picker(w).props('mode')).toBe('year')
    expect(picker(w).props('modelValue')).toBe('2025')
    expect(usePeriod().sel.value.gran).toBe('month')   // 单例粒度不被 year 屏改写
  })

  it('none:期间控件整体隐藏,scopeChip 渲染口径徽章', async () => {
    const w = mount(AnaShell, { props: { periodMode: 'none', scopeChip: '主数据快照' } })
    await flushPromises()
    expect(w.findAll('.anx-selw').length).toBe(0)
    expect(w.find('.anx-seg').exists()).toBe(false)
    expect(w.find('.anx-nav').exists()).toBe(false)
    expect(w.find('.ana-pill').text()).toBe('主数据快照')
    expect(w.text()).toContain('口径')
  })
})

// C5-01 ④ / C5-02 ④:工具条上两处零位移的形状。
describe('AnaShell 工具条:不插拔、不糊', () => {
  it('❗按年 / 按月只换面板:同一个 120 宽字段,右边步进钮不挪位', async () => {
    const w = mount(AnaShell)
    await flushPromises()
    usePeriod().setGran('year')
    await flushPromises()
    expect(w.findAll('.anx-selw').length, '换粒度插拔了字段').toBe(1)
    expect(w.find('.anx-selw').attributes('style')).toContain('width: 120px')
    expect(picker(w).props('mode')).toBe('year')
    usePeriod().setGran('month')
    await flushPromises()
    expect(w.findAll('.anx-selw').length).toBe(1)
    expect(picker(w).props('mode')).toBe('month')
  })

  it('❗期间面板只让点有数据的月:缺的月灰且点不动,点有数据的月写进期间单例', async () => {
    const w = mount(AnaShell, { attachTo: document.body })
    await flushPromises()
    await w.find('.anx-selw .dp-box').trigger('click')
    expect(w.find('[data-k="2025-03"]').attributes('disabled'), '2025-03 没数据却能点').toBeDefined()
    expect(w.find('[data-k="2025-11"]').attributes('disabled'), '晚于最新月却能点').toBeDefined()
    await w.find('[data-k="2025-03"]').trigger('click')
    expect(usePeriod().sel.value).toMatchObject({ gran: 'month', year: 2025, month: 10 })
    await w.find('[data-k="2025-06"]').trigger('click')
    expect(usePeriod().sel.value).toMatchObject({ gran: 'month', year: 2025, month: 6 })
    w.unmount()
  })

  it('❗busy:进度线挂在 sticky 工具条上 —— 是内容宿主的兄弟而不是子节点(原则 8)', async () => {
    const w = mount(AnaShell, { props: { busy: true }, slots: { default: '<div class="probe" />' } })
    await flushPromises()
    expect(w.find('.anx-tools > .fp-lb').exists(), '工具条上没有进度线').toBe(true)
    expect(w.find('.anx-body .fp-lb').exists(), '进度线跑进内容区了').toBe(false)
    await w.setProps({ busy: false })
    expect(w.find('.fp-lb').exists()).toBe(false)
  })
})

// C6-01 ①:壳不再拦内容 —— loaded 只表示 fetchAvailableMonths 完成,与各屏数据无关,
// 各屏 loading 初值 true 自己出骨架;壳转圈接力屏转圈是全站最大位移。
describe('AnaShell 首次进屏', () => {
  it('❗月份列表未到时 slot 已在 DOM 里,壳不出转圈(壳做不了屏专属骨架)', () => {
    const w = mount(AnaShell, { slots: { default: '<div class="probe" />' } })
    expect(w.find('.anx-body > .probe').exists(), 'slot 被 loaded 门挡住了').toBe(true)
    expect(w.find('.page-loading').exists(), '壳又出转圈了').toBe(false)
  })
})

// 首进 KPI 占位(2026-09-16 实测):只靠 min-height 兜一行,手机两列时真版式 3~5 行,数据一到整页下推 170~780px。
describe('AnaShell KPI 占位瓦', () => {
  const Host = (shown: { value: boolean }) => ({
    components: { AnaShell },
    setup: () => ({ shown }),
    template: `<AnaShell :kpi-hold="5"><template #kpis><template v-if="shown.value"><div class="real-tile" /><div class="real-tile" /></template></template></AnaShell>`,
  })

  it('❗槽还没渲染瓦片 → 摆 kpiHold 张占位瓦(与真瓦同一组件,换行行数一致);瓦一到占位全撤', async () => {
    const { reactive } = await import('vue')
    const shown = reactive({ value: false })
    const w = mount(Host(shown))
    await flushPromises()
    expect(w.findAll('.anx-kpis .anx-kpi-hold')).toHaveLength(5)
    expect(w.find('.anx-kpi-hold .d').exists(), '占位瓦要带副行,真瓦都有副行').toBe(true)
    shown.value = true
    await flushPromises()
    expect(w.findAll('.anx-kpi-hold')).toHaveLength(0)
    expect(w.findAll('.real-tile')).toHaveLength(2)
  })

  it('❗v-for 空列表(渲染出一个没有孩子的 Fragment)也算没瓦 —— 光伏屏的瓦片就是 v-for 出来的', async () => {
    const { ref } = await import('vue')
    const list = ref<string[]>([])
    const w = mount({ components: { AnaShell }, setup: () => ({ list }),
      template: `<AnaShell :kpi-hold="3"><template #kpis><i v-for="k in list" :key="k" class="real-tile" /></template></AnaShell>` })
    await flushPromises()
    expect(w.findAll('.anx-kpi-hold')).toHaveLength(3)
    list.value = ['a']
    await flushPromises()
    expect(w.findAll('.anx-kpi-hold')).toHaveLength(0)
  })

  it('❗占位瓦是加载态:数字位和副行是微光条,不写「—」(KPI-CARD-SPEC §3,稿 KpiA④「小卡 · 加载」);给副行字的旧写法照样按张数摆', async () => {
    const w = mount({ components: { AnaShell }, template: `<AnaShell :kpi-hold="['保本 ¥000.0万', '扣除随收入变动的成本后剩余(边际贡献率)']"><template #kpis><template v-if="false"><i /></template></template></AnaShell>` })
    await flushPromises()
    const tiles = w.findAll('.anx-kpi-hold')
    expect(tiles).toHaveLength(2)
    for (const t of tiles) {
      expect(t.find('.fp-shim.sk-v').exists(), '数字位不是微光条').toBe(true)
      expect(t.find('.d .fp-shim').exists(), '副行不是微光条').toBe(true)
      expect(t.text()).not.toContain('—')
    }
  })

  it('不传 kpiHold 的屏不出占位(瓦片本来就常渲染的屏)', async () => {
    const w = mount({ components: { AnaShell }, template: `<AnaShell><template #kpis><template v-if="false"><i /></template></template></AnaShell>` })
    await flushPromises()
    expect(w.findAll('.anx-kpi-hold')).toHaveLength(0)
  })
})
