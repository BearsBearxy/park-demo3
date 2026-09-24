import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PaySlotGrid from './PaySlotGrid.vue'
import { buildPayMap, buildSlotCells } from '@/utils/payBookLogic'

const companies = [{ id: 3, name: '佛山一泽科技有限公司', short: '一泽' }, { id: 4, name: '积前', short: '积前' }]
const map = buildPayMap([{ tenantId: 7, feeKey: 'elecStd', companyId: 3 }])
// elecStd 已设(一泽)、elecMaint 继承 elecStd、waterStd 没设 —— 三态都在这一组里
const cells = buildSlotCells(
  7, { dorm: false, amounts: new Map([['elecStd', 1200], ['elecMaint', 80], ['waterStd', 30]]) }, map, companies)
// 全部设好的一组:收起条要报公司分布
const allSet = buildSlotCells(
  7, { dorm: false, amounts: new Map([['elecStd', 1200], ['waterStd', 30]]) },
  buildPayMap([{ tenantId: 7, feeKey: 'elecStd', companyId: 3 }, { tenantId: 7, feeKey: 'waterStd', companyId: 4 }]),
  companies)

const mk = (props: Record<string, unknown> = {}) =>
  mount(PaySlotGrid, { props: { cells, companies, ...props } })

const openIt = async (w: ReturnType<typeof mk>) => { await w.find('button.psg-bar').trigger('click'); return w }

describe('PaySlotGrid 收起条', () => {
  // ⚠ 这一条是整块的形状判据(2026-09-23 照稿):默认收起成一条,不再铺卡片墙。
  //   破坏验证:把 open 的初值改成 true → 本行红。
  it('默认收起:只出一条,槽名与金额都不在屏上', () => {
    const w = mk()
    expect(w.find('.psg-rows').exists()).toBe(false)
    expect(w.text()).not.toContain('基准电费')
  })
  it('有待指定:条上报数,动作写「展开指定」', () => {
    const t = mk().text()
    expect(t).toContain('收款公司')
    expect(t).toContain('1 项待指定')     // 三个槽里只有 waterStd 没归属(elecMaint 继承)
    expect(t).toContain('展开指定')
  })
  it('全部已指定:报条数与公司分布,动作只写「展开」', () => {
    const t = mount(PaySlotGrid, { props: { cells: allSet, companies } }).text()
    expect(t).toContain('2 项已全部指定')
    expect(t).toContain('一泽 1')
    expect(t).toContain('积前 1')
    expect(t).not.toContain('展开指定')
  })
  // ⚠ 「设好了」≠「本月的单已按它拆」:单是生成那一刻的快照。
  //   这句话原来长在方格下面单独一行(payHint),换户时有无不定 —— 现在收进条里。
  //   破坏验证:把 .psg-stale 那一段删掉 → 本行红。
  it('stale:全设好但本月单还没跟上,条上补一句,不另起一行', () => {
    const w = mount(PaySlotGrid, { props: { cells: allSet, companies, stale: true } })
    expect(w.text()).toContain('重新生成本月后,单才按新归属拆')
    expect(w.findAll('.psg-bar').length).toBe(1)
  })
  // ⚠ 稿上「换户时费项表不移动」钉的就是这条:空态也出条。
  //   整块撤掉,下面的费项表会跳上去。破坏验证:给 .psg-bar 加 v-if="cells.length" → 本行红。
  it('这户没有需要指定的费用:条还在,只是不能点', () => {
    const w = mount(PaySlotGrid, { props: { cells: [], companies } })
    expect(w.find('.psg-bar').exists()).toBe(true)
    expect(w.text()).toContain('本户本月没有需要指定收款公司的费用')
    expect((w.find('button.psg-bar').element as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('PaySlotGrid 展开后的行表', () => {
  it('一行一槽:槽名、承接的费项、金额、公司', async () => {
    const t = (await openIt(mk())).text()
    expect(t).toContain('基准电费')
    expect(t).toContain('楼层公共')          // elecStd 承接的六项之一
    expect(t).toContain('继承自基准电费')     // elecMaint 未单独设
    expect(t).toContain('¥1,200')             // 金额照出(fpMoney)
  })
  // ⚠ 三步变一步:选完即落库,没有「勾选 → 底部选公司 → 应用」。
  //   破坏验证:把 pick() 改成只记 state 不 emit → 本行红。
  it('行内选公司即 emit save,只带这一个槽', async () => {
    const w = await openIt(mk())
    const sels = w.findAllComponents({ name: 'Select' })
    expect(sels.length).toBe(3)
    await sels[2].vm.$emit('update:modelValue', '4')   // 第三行 = waterStd
    expect(w.emitted('save')).toEqual([[{ colIds: ['waterStd'], companyId: 4 }]])
  })
  it('清空选择不发事件', async () => {
    const w = await openIt(mk())
    await w.findAllComponents({ name: 'Select' })[2].vm.$emit('update:modelValue', '')
    expect(w.emitted('save')).toBeUndefined()
  })
  it('只读态:不出下拉,公司显胶囊、没设的显「未设置」', async () => {
    const w = await openIt(mk({ canEdit: false }))
    expect(w.findAllComponents({ name: 'Select' }).length).toBe(0)
    expect(w.text()).toContain('一泽')
    expect(w.text()).toContain('未设置')
  })
})
