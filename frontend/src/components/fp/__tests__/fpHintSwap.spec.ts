// S4 · T21 机械替换(fp 组件一):原生 title → v-tip、手写占位 → FPEmpty、选期门加载失败 = 一句 + 副句 + 重试。
// 出账链那道门(ChainMonthGate)要 mock 五个接口,它的失败态在 chainMonthGate.spec.ts。
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { h } from 'vue'

import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import FPSortableTable, { type SortableColumn } from '@/components/fp/FPSortableTable.vue'
import FPMonthGate from '@/components/fp/FPMonthGate.vue'
import type { GateRow } from '@/composables/useMonthGate'

type TipEl = HTMLElement & { _tip?: { text: string } }
const tipOf = (el: Element) => (el as TipEl)._tip?.text

/** 手工补的 2024 年:整年空、可移除(utils/matrixYears 组出来的形状) */
const YEARS: GateRow[] = [{
  year: 2024,
  sub: '手工年',
  removable: true,
  months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hasData: false })),
}]

beforeEach(() => { setActivePinia(createPinia()) })

describe('T21 · 原生 title 换成悬停说明', () => {
  // 破坏验证:FPEditModeButton 药丸上的 v-tip="reviewTip" 删掉 → 红
  it('审核药丸:「撤销审核找谁」在悬停说明里,元素上不再挂原生 title', () => {
    const w = mount(FPEditModeButton, {
      props: { edit: false, reviewNote: '已审核 · 李审 03-05', reviewTip: '撤销审核需审核员' },
    })
    const pill = w.get('.fp-emb-rv')
    expect(tipOf(pill.element)).toBe('撤销审核需审核员')
    expect(pill.attributes('title')).toBeUndefined()
  })

  // 破坏验证:BookMonthMatrix .bmm-rm 上的 v-tip 删掉 → 红
  it('矩阵行尾「移除」:仅本机这句在悬停说明里', () => {
    const w = mount(BookMonthMatrix, { props: { book: {}, years: YEARS } })
    const rm = w.get('.bmm-rm')
    expect(tipOf(rm.element)).toBe('移除 2024 年(仅本机,录入数据后自动转正)')
    expect(rm.attributes('title')).toBeUndefined()
  })

  // 破坏验证:FPSortableTable td 的 v-tip 改成恒 undefined → 红;去掉 c.render 判断 → 第二条红
  it('列表格:纯文本格悬停看全文,自带渲染的格不挂', () => {
    interface TenantRow { id: number; name: string; area: string; status: string }
    const cols: SortableColumn<TenantRow>[] = [
      { key: 'name', header: '租户' },
      { key: 'area', header: '面积', align: 'right', mono: true },
      { key: 'status', header: '状态', render: (r) => h('span', { class: 'st' }, r.status) },
    ]
    const rows: TenantRow[] = [{ id: 7, name: '苏州恒拓精密机械有限公司', area: '1,234.50', status: '在租' }]
    const w = mount(FPSortableTable, { props: { columns: cols, rows } })
    const tds = w.findAll('tbody td:not(.fp-fill)')
    expect(tds.map(td => tipOf(td.element))).toEqual(['苏州恒拓精密机械有限公司', '1,234.50', undefined])
    expect(tds.every(td => td.attributes('title') === undefined)).toBe(true)
  })
})

describe('T21 · 空状态与加载失败一种样子', () => {
  // 破坏验证:BookMonthMatrix 把 <FPEmpty v-else> 改回 <div v-else class="bmm-placeholder"> → 红
  it('没选账册:内容区是 FPEmpty,不是手写的灰字占位', () => {
    const w = mount(BookMonthMatrix, { props: { book: null, years: YEARS } })
    expect(w.find('.bmm-card').exists()).toBe(false)
    expect(w.get('.fp-empty.empty').text()).toBe('请选择账册')
  })

  // 破坏验证:FPMonthGate 的 :sub 删掉 → 红;@retry 不转发 → 红
  it('通用选期门读不到月份清单:一句 + 副句带原因 + 重试转出去,不给半张矩阵', async () => {
    const w = mount(FPMonthGate, {
      props: { title: '汽车分桩充电明细', icon: 'plug', rows: YEARS, error: '后端挂了' },
    })
    expect(w.find('.bmm-card').exists()).toBe(false)
    const box = w.get('.fp-empty.error')
    expect(box.get('.t').text()).toBe('月份清单没读到')
    expect(box.get('.sub').text()).toBe('后端挂了 · 不是这些月都没数据')
    await box.get('button').trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
  })
})
