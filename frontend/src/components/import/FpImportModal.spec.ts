import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import FpImportModal, { type ImportRec } from './FpImportModal.vue'

// 模板列 + parseRow:租户 + 2 费用列;cells[0]=名(空跳过),cells[1..2]=数字。
const templateCols = ['租户', '厂房租金', '商铺租金']
function parseRow(c: string[]): ImportRec | null {
  const name = (c[0] || '').trim(); if (!name) return null
  const a = Number(c[1]) || 0, b = Number(c[2]) || 0
  return { tenantName: name, factoryRent: a, shopRent: b, __preview: [name, a || '', b || ''] }
}

function mountModal() {
  return mount(FpImportModal, { props: { title: '导入', templateCols, parseRow } })
}

describe('FpImportModal', () => {
  it('renders template columns in order', () => {
    const w = mountModal()
    const chips = w.findAll('.fpimp-col').map(c => c.text())
    expect(chips).toEqual(['1租户', '2厂房租金', '3商铺租金'])
  })

  it('parses pasted TSV, skips header + blank-name rows, previews first 6', async () => {
    const w = mountModal()
    await w.find('.fpimp-tab:nth-child(2)').trigger('click')   // → paste mode
    // 表头 + 7 数据行(第 4 行租户名空 → 跳过) → 6 条有效
    const lines = ['租户\t厂房租金\t商铺租金']
    for (let i = 1; i <= 7; i++) lines.push(i === 4 ? `\t${i}\t${i}` : `T${i}\t${i * 10}\t${i}`)
    await w.find('textarea').setValue(lines.join('\n'))
    await w.find('.fpimp-ta + div button').trigger('click')    // 解析粘贴内容

    // 条数提示
    expect(w.find('.fpimp-msg.ok').text()).toContain('6')
    // 预览只渲染前 6 行
    const bodyRows = w.findAll('.fpimp-pvtable tbody tr')
    expect(bodyRows.length).toBe(6)
    // 第一行预览 = T1 / 10 / 1
    expect(bodyRows[0].findAll('td').map(td => td.text())).toEqual(['T1', '10', '1'])
  })

  it('emits import payload with __preview stripped', async () => {
    const w = mountModal()
    await w.find('.fpimp-tab:nth-child(2)').trigger('click')
    await w.find('textarea').setValue('租户\t厂房租金\t商铺租金\nA\t100\t5')
    await w.find('.fpimp-ta + div button').trigger('click')
    // 底部「导入」确认
    await w.findAll('.fpimp-f button')[1].trigger('click')

    const ev = w.emitted('import')
    expect(ev).toBeTruthy()
    const payload = ev![0][0] as ImportRec[]
    expect(payload).toEqual([{ tenantName: 'A', factoryRent: 100, shopRent: 5 }])
    expect('__preview' in payload[0]).toBe(false)
  })

  it('shows error when no row matches template', async () => {
    const w = mountModal()
    await w.find('.fpimp-tab:nth-child(2)').trigger('click')
    // 仅一行表头 + 一行空名 → skipHeader 跳表头,空名跳过 → 0 有效
    await w.find('textarea').setValue('租户\t厂房租金\t商铺租金\n\t1\t2')
    await w.find('.fpimp-ta + div button').trigger('click')
    expect(w.find('.fpimp-msg.err').exists()).toBe(true)
  })

  it('customParse 返回 records → 复用预览 + import emit', async () => {
    const customParse = () => ({ records: [{ a: 1, __preview: ['x'] }] as ImportRec[] })
    const w = mount(FpImportModal, { props: { title: '导入', templateCols: ['A'], customParse } })
    await w.find('.fpimp-tab:nth-child(2)').trigger('click')
    await w.find('textarea').setValue('A\n1')
    await w.find('.fpimp-ta + div button').trigger('click')
    expect(w.find('.fpimp-pvtable tbody tr').exists()).toBe(true)
    await w.findAll('.fpimp-f button')[1].trigger('click')   // 底部「导入」
    expect((w.emitted('import')![0][0] as ImportRec[])[0]).toEqual({ a: 1 })
  })

  it('customParse 返回 sections → labelOnly 汇总,importSections emit 带 label', async () => {
    const customParse = () => ({ sections: [{ label: '一期', records: [{ a: 1, __preview: ['x'] }] as ImportRec[] }] })
    const w = mount(FpImportModal, { props: { title: '导入', templateCols: ['A'], customParse } })
    await w.find('.fpimp-tab:nth-child(2)').trigger('click')
    await w.find('textarea').setValue('A\n1')
    await w.find('.fpimp-ta + div button').trigger('click')
    expect(w.find('.isum-row.label-only').exists()).toBe(true)
    await w.find('.isum-foot button').trigger('click')
    const picks = w.emitted('importSections')![0][0] as { label: string; records: ImportRec[] }[]
    expect(picks[0].label).toBe('一期')
    expect(picks[0].records[0]).toEqual({ a: 1 })   // __preview 已剥
  })
})
