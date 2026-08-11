import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PaySlotGrid from './PaySlotGrid.vue'
import { buildPayMap, buildSlotCells } from '@/utils/payBookLogic'

const companies = [{ id: 3, name: '佛山一泽科技有限公司', short: '一泽' }, { id: 4, name: '积前', short: '积前' }]
const map = buildPayMap([{ tenantId: 7, feeKey: 'elecStd', companyId: 3 }])
const cells = buildSlotCells(
  7, { dorm: false, amounts: new Map([['elecStd', 1200], ['elecMaint', 80], ['waterStd', 30]]) }, map, companies)

const mk = (props: Record<string, unknown> = {}) =>
  mount(PaySlotGrid, { props: { cells, companies, ...props } })

describe('PaySlotGrid 方格多选', () => {
  it('逐格显槽名/费项名/公司,继承格显「继承自X」', () => {
    const t = mk().text()
    expect(t).toContain('基准电费')
    expect(t).toContain('楼层公共')       // elecStd 承接的六项之一
    expect(t).toContain('一泽')
    expect(t).toContain('继承自基准电费')  // elecMaint 未单独设,继承 elecStd
  })
  it('未设置的槽显「未设置」', () => {
    expect(mk().text()).toContain('未设置')   // waterStd 无映射
  })
  it('多选后指定公司应用 → emit save 带选中 colIds 与 companyId', async () => {
    const w = mk()
    const btns = w.findAll('button.psg-cell')
    await btns[0].trigger('click')
    await btns[2].trigger('click')
    // Select 组件内部 DOM 不稳定,直接驱动其 update:modelValue
    await w.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', '4')
    await w.findAll('.psg-bar button').at(-1)!.trigger('click')
    expect(w.emitted('save')).toEqual([[{ colIds: ['elecStd', 'waterStd'], companyId: 4 }]])
  })
  it('未选公司不发事件,应用后清空选中', async () => {
    const w = mk()
    await w.findAll('button.psg-cell')[0].trigger('click')
    await w.findAll('.psg-bar button').at(-1)!.trigger('click')
    expect(w.emitted('save')).toBeUndefined()
  })
  it('只读态点格不选中,也不出底部指定条', async () => {
    const w = mk({ canEdit: false })
    await w.findAll('button.psg-cell')[0].trigger('click')
    expect(w.find('.psg-cell.sel').exists()).toBe(false)
    expect(w.find('.psg-bar').exists()).toBe(false)
  })
  it('无格时给空态,不渲染指定条', () => {
    const w = mount(PaySlotGrid, { props: { cells: [], companies } })
    expect(w.text()).toContain('该户本月没有需要指定收款方的费用')
    expect(w.find('.psg-bar').exists()).toBe(false)
  })
})
