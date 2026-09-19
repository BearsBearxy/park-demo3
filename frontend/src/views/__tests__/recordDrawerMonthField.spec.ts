import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Component } from 'vue'
import ElecRecordDrawer from '@/views/elec/ElecRecordDrawer.vue'
import ChargingRecordDrawer from '@/views/charging/ChargingRecordDrawer.vue'
import PvRecordDrawer from '@/views/pv/PvRecordDrawer.vue'
import SalaryRecordDrawer from '@/views/salary/SalaryRecordDrawer.vue'
import UtilitiesRecordDrawer from '@/views/utilities/UtilitiesRecordDrawer.vue'

// 记账抽屉 7 处「年下拉 + 月下拉」→ 一个 ds/DatePicker 月份字段(DATE-PICKER-SPEC §5 第 6 节)。
// 只换控件、不改谁能选什么:默认月照旧(1 月 / 光伏发生月 12 月 / 工资取调用方给的月),
// 可选范围 = overview 年份首年 1 月 … 末年 12 月(改前年下拉只列这些年),提交仍是 YYYY-MM。
const YEARS = [2024, 2025, 2026]
type Case = { name: string; comp: Component; props: Record<string, unknown>; fill: Record<string, unknown>; fields: [label: string, key: string, init: string][] }
const CASES: Case[] = [
  { name: '附表11 电费', comp: ElecRecordDrawer, props: { phases: [{ id: 'p1', name: '一期', short: '一期' }], initType: 'energy' },
    fill: { qty: '10', price: '1' }, fields: [['记账月份', 'acctMonth', '2026-01']] },
  { name: '附表7/8 充电桩', comp: ChargingRecordDrawer, props: { no: 7, cats: [{ catId: 'dc', catName: '直流' }], initCat: 'all' },
    fill: { kwh: '10', fee: '1' }, fields: [['记账月份', 'acctMonth', '2026-01']] },
  { name: '附表6 光伏', comp: PvRecordDrawer, props: { phases: [{ id: 'p1', name: '一期', short: '一期' }], initPhase: 'all' },
    fill: { sKwh: '10', sAmt: '1' }, fields: [['记账月份', 'acctMonth', '2026-01'], ['发生月份', 'occurMonth', '2026-12']] },
  { name: '附表12 工资', comp: SalaryRecordDrawer, props: { initMonth: 9 },
    fill: { name: '张三' }, fields: [['所属月份', 'acctMonth', '2026-09']] },
  { name: '办公·三期水电', comp: UtilitiesRecordDrawer, props: { no: 13, name: '办公水电', icon: 'droplets' },
    fill: { elecQty: '10' }, fields: [['记账月份', 'acctMonth', '2026-01'], ['所属月份', 'belongMonth', '2026-01']] },
]

const pickers = (w: VueWrapper) => w.findAllComponents({ name: 'DatePicker' }).filter((p) => p.props('mode') === 'month')

describe('记账抽屉 · 月份字段', () => {
  it.each(CASES)('$name:默认月、可选范围照旧,选的月以 YYYY-MM 提交', async (c) => {
    const w = mount(c.comp, { props: { ...c.props, initYear: 2026, years: YEARS }, global: { stubs: { teleport: true } } })
    await flushPromises()
    const ps = pickers(w)
    expect(ps.map((p) => p.props('ariaLabel'))).toEqual(c.fields.map((f) => f[0]))
    ps.forEach((p, i) => {
      expect(p.props('mode')).toBe('month')
      expect(p.props('modelValue'), `${c.fields[i][0]} 默认月变了`).toBe(c.fields[i][2])
      expect([p.props('min'), p.props('max')], '可选范围不是 overview 年份首年 1 月 … 末年 12 月').toEqual(['2024-01', '2026-12'])
    })
    ps.forEach((p, i) => p.vm.$emit('update:modelValue', `2025-0${i + 3}`))
    await flushPromises()
    const vm = w.vm as unknown as Record<string, unknown> & { f?: Record<string, string>; save: () => void }
    for (const [k, v] of Object.entries(c.fill)) {
      if (k === 'name' && vm.f) { vm.name = v; vm.f.base = '100' } else vm[k] = v
    }
    await flushPromises()
    vm.save()
    const req = (w.emitted('save') ?? [])[0]?.[0] as Record<string, unknown> | undefined
    expect(req, '保存没发出去').toBeTruthy()
    c.fields.forEach(([, key], i) => expect(req![key]).toBe(`2025-0${i + 3}`))
  })

  it('附表11 开票日期:原生日期框 → 日期字段,可清空,选的日以 YYYY-MM-DD 提交(没选 = null)', async () => {
    const w = mount(ElecRecordDrawer, { props: { phases: [{ id: 'p1', name: '一期', short: '一期' }], initType: 'energy', initYear: 2026, years: YEARS }, global: { stubs: { teleport: true } } })
    const inv = w.findAllComponents({ name: 'DatePicker' }).find((p) => p.props('ariaLabel') === '开票日期')!
    expect([inv.props('mode'), inv.props('clearable'), inv.props('min'), inv.props('max')]).toEqual(['date', true, undefined, undefined])
    const vm = w.vm as unknown as Record<string, unknown> & { save: () => void }
    vm.qty = '10'; vm.price = '1'
    vm.save()
    expect((w.emitted('save')![0][0] as Record<string, unknown>).invDate).toBeNull()
    inv.vm.$emit('update:modelValue', '2026-09-05')
    await flushPromises()
    vm.save()
    expect((w.emitted('save')![1][0] as Record<string, unknown>).invDate).toBe('2026-09-05')
  })
})
