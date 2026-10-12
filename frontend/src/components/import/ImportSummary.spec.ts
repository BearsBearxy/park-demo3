/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
// 导入弹窗 · 核对页的分段表(md-v2-secs):按钮在弹窗底栏,这里只验表和 picks / count。
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ImportSummary from './ImportSummary.vue'
import type { Section } from '@/utils/importSections'

const rec = (name: string) => ({ tenantName: name, factoryRent: 1 })
const recs = (n: number) => Array.from({ length: n }, (_, i) => rec('户' + i))
type Vm = { picks: { year?: number; month?: number; phase?: number; label?: string; records: unknown[] }[]; count: number }
const vmOf = (w: ReturnType<typeof mount>) => w.vm as unknown as Vm

const sections: Section[] = [
  { year: 2026, month: 9, phase: 1, title: '2026年9月 销售收入（一期）', layout: 'office', records: recs(96), rowCount: 97 },
  { year: 2026, month: 9, phase: 2, title: '2026年9月 销售收入（二期）', layout: 'factory', records: recs(88), rowCount: 89 },
  // 没标题的整表:年月期都没认出 → 年月用缺省值,期区没有缺省就要选
  { layout: 'office', records: recs(57), rowCount: 58 },
]

describe('ImportSummary', () => {
  // 破坏验证:needPhase 不数 → 摘要句少「1 段要选期区」红;缺期区的段默认勾上 → picks 多一段红
  it('❗一句「认出 N 段 M 行，K 段要选期区」;缺期区的段标橙、不勾、写原因;picks / count 只算勾上的', () => {
    const w = mount(ImportSummary, { props: { sections, defaultYear: 2026, defaultMonth: 9 } })
    expect(w.find('.isum-sum').text()).toBe('认出 3 段 241 行，1 段要选期区')
    expect(w.findAll('th').map(t => t.text())).toEqual(['', '文件里的标题', '月份', '期区', '行数'])
    const rows = w.findAll('.isum-row')
    expect(rows.map(r => r.find('.isum-t span').text())).toEqual(['2026年9月 销售收入（一期）', '2026年9月 销售收入（二期）', '没有标题'])
    expect(rows.map(r => (r.find('.isum-cb').element as HTMLInputElement).checked)).toEqual([true, true, false])
    expect(rows[2].find('.isum-why').text()).toBe('没有标题，看不出是哪个期区，选一下')
    expect(rows[2].find('.isum-sel').classes()).toContain('warn')
    expect(vmOf(w).picks.map(p => [p.year, p.month, p.phase, p.records.length])).toEqual([[2026, 9, 1, 96], [2026, 9, 2, 88]])
    expect(vmOf(w).count).toBe(184)
  })

  it('缺省期区(导入中心点期区胶囊带进来)预填:不用再选', () => {
    const w = mount(ImportSummary, { props: { sections, defaultYear: 2026, defaultMonth: 9, defaultPhase: 4 } })
    expect(w.find('.isum-sum').text()).toBe('认出 3 段 241 行')
    expect(vmOf(w).picks.map(p => p.phase)).toEqual([1, 2, 4])
  })

  it('选了期区就勾上', async () => {
    const w = mount(ImportSummary, { props: { sections, defaultYear: 2026, defaultMonth: 9 } })
    await w.findAll('.isum-row')[2].find('.ds-sel-trigger').trigger('click')
    await w.findAll('[role="option"]').find(o => o.text() === '宿舍')!.trigger('click')
    expect((w.findAll('.isum-cb')[2].element as HTMLInputElement).checked).toBe(true)
    expect(vmOf(w).picks.map(p => p.phase)).toEqual([1, 2, 4])
    expect(w.find('.isum-sum').text()).toBe('认出 3 段 241 行')
  })

  it('取消勾选:picks / count 跟着变;没数据的段勾不上', async () => {
    const w = mount(ImportSummary, { props: { sections: [...sections.slice(0, 2), { year: 2026, month: 9, phase: 3, layout: 'factory', records: [], rowCount: 1 }] } })
    expect((w.findAll('.isum-cb')[2].element as HTMLInputElement).disabled).toBe(true)
    await w.findAll('.isum-cb')[0].trigger('change')
    expect(vmOf(w).picks.map(p => p.phase)).toEqual([2])
    expect(vmOf(w).count).toBe(88)
  })

  it('工资(hidePhase):没有期区一列,picks 不带 phase', () => {
    const w = mount(ImportSummary, { props: { hidePhase: true, sections: [{ year: 2025, month: 8, title: '2025年8月工资表', layout: 'office', records: recs(2), rowCount: 3 }] } })
    expect(w.findAll('th').map(t => t.text())).toEqual(['', '文件里的标题', '月份', '行数'])
    expect(vmOf(w).picks).toEqual([{ year: 2025, month: 8, records: recs(2) }])
  })

  // 破坏验证:reason 段照样能勾 → 红
  it('❗labelOnly:只有标题和数量;导不了的段(reason)标橙、勾不上、写原因;checked:false 的段进来不勾', () => {
    const w = mount(ImportSummary, { props: { labelOnly: true, unit: '户', labelSections: [
      { label: '恒毅', records: recs(2) },
      { label: '叙丰(两份合同)', records: recs(1), checked: false },
      { label: '缴费单', records: recs(1), reason: '须先建合同' },
    ] } })
    expect(w.findAll('th').map(t => t.text())).toEqual(['', '文件里的标题', '户'])
    expect(w.find('.isum-sum').text()).toBe('认出 3 段 4 户，1 段导不了')
    const cbs = w.findAll('.isum-cb').map(c => c.element as HTMLInputElement)
    expect(cbs.map(c => [c.checked, c.disabled])).toEqual([[true, false], [false, false], [false, true]])
    expect(w.findAll('.isum-row')[2].find('.isum-why').text()).toBe('须先建合同')
    expect(vmOf(w).picks).toEqual([{ label: '恒毅', records: recs(2) }])
  })
})
