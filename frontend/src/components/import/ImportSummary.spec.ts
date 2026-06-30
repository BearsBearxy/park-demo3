import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ImportSummary from './ImportSummary.vue'
import type { Section } from '@/utils/importSections'

const rec = (name: string) => ({ tenantName: name, factoryRent: 1 })

const sections: Section[] = [
  { year: 2025, month: 1, phase: 2, layout: 'factory', records: [rec('火炬'), rec('锂朋')], rowCount: 3 },
  // 无标题段:年月期 undefined → 用默认填
  { layout: 'office', records: [rec('宿舍甲')], rowCount: 2 },
]

function mountSummary(secs = sections) {
  return mount(ImportSummary, {
    props: { sections: secs, defaultYear: 2026, defaultMonth: 6, defaultPhase: 4 },
  })
}

describe('ImportSummary', () => {
  it('每段一行,识别户数显示', () => {
    const w = mountSummary()
    const rows = w.findAll('.isum-row')
    expect(rows.length).toBe(2)
    expect(rows[0].find('.isum-col-n').text()).toContain('2')
    expect(rows[1].find('.isum-col-n').text()).toContain('1')
  })

  it('识别到的预填年/月,缺的用当前槽默认填', () => {
    const w = mountSummary()
    const rows = w.findAll('.isum-row')
    // 段1:2025/1
    expect((rows[0].find('.isum-col-y input').element as HTMLInputElement).value).toBe('2025')
    expect((rows[0].find('.isum-col-m input').element as HTMLInputElement).value).toBe('1')
    // 段2:无标题 → 默认 2026/6
    expect((rows[1].find('.isum-col-y input').element as HTMLInputElement).value).toBe('2026')
    expect((rows[1].find('.isum-col-m input').element as HTMLInputElement).value).toBe('6')
  })

  it('全部导入 emit confirm,载合法勾选段', async () => {
    const w = mountSummary()
    await w.find('.isum-foot button').trigger('click')
    const ev = w.emitted('confirm')
    expect(ev).toBeTruthy()
    const picks = ev![0][0] as { year: number; month: number; phase: number; records: unknown[] }[]
    expect(picks.length).toBe(2)
    expect(picks[0]).toMatchObject({ year: 2025, month: 1, phase: 2 })
    expect(picks[1]).toMatchObject({ year: 2026, month: 6, phase: 4 })
    expect(picks[0].records.length).toBe(2)
  })

  it('空记录段禁勾,不进 confirm', async () => {
    const w = mountSummary([
      { year: 2025, month: 1, phase: 2, layout: 'factory', records: [rec('甲')], rowCount: 1 },
      { year: 2025, month: 2, phase: 3, layout: 'factory', records: [], rowCount: 1 },
    ])
    await w.find('.isum-foot button').trigger('click')
    const picks = w.emitted('confirm')![0][0] as unknown[]
    expect(picks.length).toBe(1)
  })

  it('非法年份(留空)→ 该段不可导', async () => {
    const w = mountSummary()
    const yInput = w.findAll('.isum-row')[0].find('.isum-col-y input')
    await yInput.setValue('')   // 清空年 → 非法
    await w.find('.isum-foot button').trigger('click')
    const picks = w.emitted('confirm')![0][0] as { year: number }[]
    // 只剩段2合法
    expect(picks.length).toBe(1)
    expect(picks[0].year).toBe(2026)
  })

  it('labelOnly:按段标签显示,空段禁勾,labelConfirm 只载非空勾选段', async () => {
    const w = mount(ImportSummary, {
      props: {
        labelOnly: true,
        labelSections: [
          { label: '一期光伏', records: [rec('1月'), rec('2月')] },
          { label: '二期光伏', records: [] },
        ],
      },
    })
    const rows = w.findAll('.isum-row.label-only')
    expect(rows.length).toBe(2)
    expect(rows[0].find('.isum-col-label').text()).toBe('一期光伏')
    expect(rows[0].find('.isum-col-n').text()).toContain('2')
    await w.find('.isum-foot button').trigger('click')
    const picks = w.emitted('labelConfirm')![0][0] as { label: string; records: unknown[] }[]
    expect(picks.length).toBe(1)
    expect(picks[0].label).toBe('一期光伏')
    expect(picks[0].records.length).toBe(2)
  })
})
