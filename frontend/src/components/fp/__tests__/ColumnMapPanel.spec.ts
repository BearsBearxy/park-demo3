import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import ColumnMapPanel from '../ColumnMapPanel.vue'
import Segmented from '@/components/ds/Segmented.vue'
import Select from '@/components/ds/Select.vue'
import Input from '@/components/ds/Input.vue'
import Button from '@/components/ds/Button.vue'

// 未匹配列处置面板(SPEC §4):三种 decision 的 emit 形状 + 未拍板前不许应用。纯受控,不发请求。
const UNMATCHED = [
  { header: '宿舍区租金', sample: '290000' },   // 29 万事故列
  { header: '备注' },
]
const EXISTING = [
  { id: 'factoryRent', label: '厂房租金' },
  { id: 'otherFee', label: '其他费用' },
]

const mountPanel = (canChangeTemplate = true) => mount(ColumnMapPanel, {
  props: { open: true, unmatched: UNMATCHED, existingCols: EXISTING, canChangeTemplate },
  global: { stubs: { teleport: true } },
})

const applyBtn = (w: ReturnType<typeof mountPanel>) =>
  w.findAllComponents(Button).find(b => b.text().includes('应用并继续导入'))!

// 映射到现有列、新建自定义列都会升一版模板(后端要「月度台账 · 账册模板」);只有「月度台账 · 编辑」的人
// 以前三种都能选,点「应用」就 403、导入卡住(RBAC §15.7)
describe('ColumnMapPanel — 没有账册模板权', () => {
  it('每列默认「本次忽略」,应用直接放行,emit 全是 ignore', async () => {
    const w = mountPanel(false)
    expect(w.findAllComponents(Segmented).map(s => s.props('modelValue'))).toEqual(['ignore', 'ignore'])
    expect(applyBtn(w).props('disabled')).toBe(false)
    await applyBtn(w).trigger('click')
    expect(w.emitted('apply')![0][0]).toEqual([
      { header: '宿舍区租金', action: 'ignore' }, { header: '备注', action: 'ignore' }])
  })
  it('点「映射到现有列」「新建自定义列」不动', async () => {
    const w = mountPanel(false)
    const vals = () => w.findAllComponents(Segmented).map(s => s.props('modelValue'))
    const before = vals()
    w.findAllComponents(Segmented)[0].vm.$emit('update:modelValue', 'map')
    w.findAllComponents(Segmented)[1].vm.$emit('update:modelValue', 'create')
    await nextTick()
    expect(vals()).toEqual(before)
    expect(w.findAllComponents(Input)).toHaveLength(0)
  })
})

describe('ColumnMapPanel — 未匹配列处置', () => {
  it('每个未匹配表头一行,默认「映射到现有列」且未选目标 → 应用按钮禁用', () => {
    const w = mountPanel()
    expect(w.findAllComponents(Segmented)).toHaveLength(2)
    expect(w.findAllComponents(Select)).toHaveLength(2)   // 两行都是 map 态,各带一个下拉
    expect(w.text()).toContain('宿舍区租金')
    expect(w.text()).toContain('示例:290000')
    expect(applyBtn(w).props('disabled')).toBe(true)
  })

  it('map 决策:选中目标列后应用,emit 形状 {header, action:map, targetColId}', async () => {
    const w = mountPanel()
    w.findAllComponents(Select)[0].vm.$emit('update:modelValue', 'factoryRent')
    w.findAllComponents(Segmented)[1].vm.$emit('update:modelValue', 'ignore')
    await nextTick()
    expect(applyBtn(w).props('disabled')).toBe(false)
    await applyBtn(w).trigger('click')
    expect(w.emitted('apply')).toHaveLength(1)
    expect(w.emitted('apply')![0][0]).toEqual([
      { header: '宿舍区租金', action: 'map', targetColId: 'factoryRent' },
      { header: '备注', action: 'ignore' },
    ])
  })

  it('create 决策:显示名预填原表头,emit {header, action:create, newLabel}', async () => {
    const w = mountPanel()
    w.findAllComponents(Segmented)[0].vm.$emit('update:modelValue', 'create')
    w.findAllComponents(Segmented)[1].vm.$emit('update:modelValue', 'ignore')
    await nextTick()
    // 预填 = 原表头,不改也能直接应用
    expect(w.findAllComponents(Input)[0].props('modelValue')).toBe('宿舍区租金')
    await applyBtn(w).trigger('click')
    expect(w.emitted('apply')![0][0]).toEqual([
      { header: '宿舍区租金', action: 'create', newLabel: '宿舍区租金' },
      { header: '备注', action: 'ignore' },
    ])
  })

  it('create 但显示名被清空 → 该行未拍板,应用禁用', async () => {
    const w = mountPanel()
    w.findAllComponents(Segmented)[0].vm.$emit('update:modelValue', 'create')
    w.findAllComponents(Segmented)[1].vm.$emit('update:modelValue', 'ignore')
    await nextTick()
    w.findAllComponents(Input)[0].vm.$emit('update:modelValue', '   ')
    await nextTick()
    expect(applyBtn(w).props('disabled')).toBe(true)
    await applyBtn(w).trigger('click')
    expect(w.emitted('apply')).toBeUndefined()
  })

  it('重新打开按新 unmatched 重置(上一轮决策不残留)', async () => {
    const w = mountPanel()
    w.findAllComponents(Segmented)[0].vm.$emit('update:modelValue', 'ignore')
    await nextTick()
    await w.setProps({ open: false })
    await w.setProps({ open: true, unmatched: [{ header: '停车费' }] })
    expect(w.findAllComponents(Segmented)).toHaveLength(1)
    expect(w.findAllComponents(Select)).toHaveLength(1)   // 回到默认 map 态,而不是残留 ignore
    expect(w.text()).toContain('停车费')
  })

  it('取消按钮 emit close,不 emit apply', async () => {
    const w = mountPanel()
    await w.findAllComponents(Button).find(b => b.text() === '取消')!.trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
    expect(w.emitted('apply')).toBeUndefined()
  })
})
