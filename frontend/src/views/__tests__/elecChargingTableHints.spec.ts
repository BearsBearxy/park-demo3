// 附表11 电费台账表 / 附表7·8 充电台账表 —— S4 提示件替换(T27):
//  · 空年 / 空类的手写引导态换成全站一种空状态(十件 ⑦,画布 06-B ⑦):一句 + 副句 + 至多一个按钮;
//  · 原生 title 一律换悬停说明(十件 ⑩):表里不许再有浏览器自带小框,图标钮靠 v-tip 补 aria-label。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ElecTable from '@/views/elec/ElecTable.vue'
import ChargingTable from '@/views/charging/ChargingTable.vue'
import type { ElecPhaseDTO, ElecRecordDTO, ElecTotal } from '@/types/elec'
import type { ChargingCatDTO, ChargingRecordDTO, ChargingTotal } from '@/types/charging'

// 夹具按真实 DTO 声明(types/elec.ts、types/charging.ts)。两行分属两个月:一行在已审核的月(出锁标),一行可删(出删除钮)。
const PHASES: ElecPhaseDTO[] = [{ id: 'p1', name: '一期厂房', short: '一期' }]
const E_ROWS: ElecRecordDTO[] = [
  { id: 1, type: 'energy', phase: 'p1', phaseName: '一期厂房', acctMonth: '2026-01', invDate: '2026-02-08', period: '峰',
    cat: '大工业用电', unit: '度', qty: 128400, demand: null, price: 0.7231, amount: 92846.04, rate: 0.13, tax: 12069.99,
    total: 104916.03, note: null, source: 'seed' },
  { id: 2, type: 'energy', phase: 'p1', phaseName: '一期厂房', acctMonth: '2026-03', invDate: '2026-04-08', period: '谷',
    cat: '大工业用电', unit: '度', qty: 45120, demand: null, price: 0.3512, amount: 15846.14, rate: 0.13, tax: 2059.99,
    total: 17906.13, note: '三月票', source: 'manual' },
]
const E_TOTAL: ElecTotal = { qty: 173520, demand: 0, amount: 108692.18, tax: 14129.98, total: 122822.16 }

const CATS: ChargingCatDTO[] = [
  { catId: 'dc', name: '直流快充', short: '直流', tint: 'blue' },
  { catId: 'ac', name: '交流慢充', short: '交流', tint: 'cyan' },
]
const C_ROWS: ChargingRecordDTO[] = [
  { id: 11, scheduleNo: 7, cat: 'dc', catName: '直流快充', acctMonth: '2026-01', kwh: 3200, fee: 480, cost: 1900,
    profit: -1420, note: null, source: 'seed' },
  { id: 12, scheduleNo: 7, cat: 'ac', catName: '交流慢充', acctMonth: '2026-03', kwh: 860.5, fee: 120.3, cost: 99.8,
    profit: 20.5, note: '补录', source: 'manual' },
]
const C_TOTAL: ChargingTotal = { kwh: 4060.5, fee: 600.3, cost: 1999.8, profit: -1399.5 }

const elec = (over: Record<string, unknown> = {}) => mount(ElecTable, {
  props: { year: 2026, type: 'energy', phases: PHASES, rows: E_ROWS, total: E_TOTAL, edit: false, ...over },
})
const charging = (over: Record<string, unknown> = {}) => mount(ChargingTable, {
  props: { year: 2026, icon: 'plug', cats: CATS, rows: C_ROWS, total: C_TOTAL, cat: 'all', edit: false, ...over },
})

describe('附表11 电费台账表 · 空状态与悬停说明', () => {
  it('❗空年浏览态:全站同一种空状态,按钮是「编辑表格」、点了要进编辑', async () => {
    const w = elec({ rows: [] })
    const empty = w.find('.fp-empty')
    expect(empty.exists(), '空年要换成 FPEmpty').toBe(true)
    expect(empty.text()).toContain('2026 年暂无电量电费记录')
    expect(empty.find('.sub').text()).toContain('进入编辑模式可手动新增')
    const b = empty.findAll('button')
    expect(b.map(x => x.text()), '浏览态只有一个按钮').toEqual(['编辑表格'])
    await b[0].trigger('click')
    expect(w.emitted('edit'), '浏览态的按钮要请父屏进编辑').toHaveLength(1)
    expect(w.emitted('add')).toBeUndefined()
  })

  it('❗空年编辑态:按钮换成「新增记账」、点了发 add', async () => {
    const w = elec({ rows: [], edit: true })
    const b = w.find('.fp-empty').findAll('button')
    expect(b.map(x => x.text())).toEqual(['新增记账'])
    await b[0].trigger('click')
    expect(w.emitted('add')).toHaveLength(1)
  })

  it('❗编辑态表里没有一个原生 title:勾选框 / 锁标 / 删除钮都走悬停说明', () => {
    const w = elec({ edit: true, lockedMonths: new Set([1]) })
    expect(w.find('.e11-actlock').exists(), '前提:1 月已审核,行上是锁标').toBe(true)
    expect(w.find('.e11-actbtn.del').exists(), '前提:3 月可删,行上是删除钮').toBe(true)
    expect(w.findAll('[title]').map(e => e.html().slice(0, 80)), '还有原生 title').toEqual([])
    // 图标钮没有可读的字,v-tip 给它补 aria-label —— 删掉悬停说明(不是换成 v-tip)这条就红
    expect(w.find('.e11-actbtn.del').attributes('aria-label')).toBe('删除')
    expect(w.find('thead .e11-cb').attributes('aria-label')).toBe('全选')
  })
})

describe('附表7/8 充电台账表 · 空状态与悬停说明', () => {
  it('❗空年浏览态:全站同一种空状态,没有按钮(浏览态不给写入口)', () => {
    const w = charging({ rows: [] })
    const empty = w.find('.fp-empty')
    expect(empty.exists(), '空年要换成 FPEmpty').toBe(true)
    expect(empty.text()).toContain('2026 年暂无记账记录')
    expect(empty.findAll('button'), '浏览态不该有按钮').toHaveLength(0)
  })

  it('❗空类别编辑态:标题带类别简称,按钮「新增记账」点了发 add', async () => {
    const w = charging({ rows: [], cat: 'ac', edit: true })
    const empty = w.find('.fp-empty')
    expect(empty.text()).toContain('2026 年（交流）暂无记账记录')
    const b = empty.findAll('button')
    expect(b.map(x => x.text())).toEqual(['新增记账'])
    await b[0].trigger('click')
    expect(w.emitted('add')).toHaveLength(1)
  })

  it('❗编辑态表里没有一个原生 title:勾选框 / 锁标 / 删除钮都走悬停说明', () => {
    const w = charging({ edit: true, lockedMonths: new Set([1]) })
    expect(w.find('.ch-actlock').exists(), '前提:1 月已审核,行上是锁标').toBe(true)
    expect(w.find('.ch-actbtn.del').exists(), '前提:3 月可删,行上是删除钮').toBe(true)
    expect(w.findAll('[title]').map(e => e.html().slice(0, 80)), '还有原生 title').toEqual([])
    expect(w.find('.ch-actbtn.del').attributes('aria-label')).toBe('删除')
    expect(w.find('thead .ch-cb').attributes('aria-label')).toBe('全选')
  })
})
