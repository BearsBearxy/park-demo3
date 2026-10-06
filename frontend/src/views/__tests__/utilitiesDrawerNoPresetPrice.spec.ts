// 附表13/14「新增记账」不预填单价(2026-10-04 用户拍板产品卖给别的园区,复查 LEAK-L3):
// 原来电/水单价预填我园的 0.8123/4.15、0.7965/3.85,客户只填量就会按我们的价落库。
// 现在单价取本年最近一条记录的价,本年没有记录就空着;填了哪样的量就得填哪样的价,否则保存按钮不让点 —— 不然会按 0 元落库。
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import UtilitiesRecordDrawer from '@/views/utilities/UtilitiesRecordDrawer.vue'

const mountDrawer = (no: number, lastPrice?: { elec?: number; water?: number }) => mount(UtilitiesRecordDrawer, {
  props: { no, name: no === 13 ? '办公水电' : '临时水电', icon: 'droplets', initYear: 2026, years: [2026], lastPrice },
  global: { stubs: { teleport: true } },
})
type Vm = Record<string, unknown> & { save: () => void; valid: boolean }

describe('办公水电 · 新增记账不预填单价', () => {
  it.each([13, 14])('附表%i:两个单价框是空的,不带任何园区的价', (no) => {
    const prices = mountDrawer(no).findAll('input.ut-input').filter((i) => i.attributes('placeholder')?.startsWith('基准单价'))
    expect(prices).toHaveLength(2)
    for (const p of prices) expect((p.element as HTMLInputElement).value).toBe('')
  })

  it('本年有记录:单价预填最近一条的价,不是写死的数', () => {
    const prices = mountDrawer(13, { elec: 1.23, water: 5.6 }).findAll('input.ut-input').filter((i) => i.attributes('placeholder')?.startsWith('基准单价'))
    expect(prices.map((p) => (p.element as HTMLInputElement).value)).toEqual(['1.23', '5.6'])
  })

  it('只填量不填价:存不了;补上价才发出去', async () => {
    const w = mountDrawer(13)
    const vm = w.vm as unknown as Vm
    vm.elecQty = '100'
    await flushPromises()
    expect(vm.valid).toBe(false)
    vm.save()
    expect(w.emitted('save')).toBeUndefined()
    vm.elecPrice = '0.9'
    await flushPromises()
    vm.save()
    expect(w.emitted('save')![0][0]).toMatchObject({ elecQty: 100, elecPrice: 0.9, waterQty: 0 })
  })
})
