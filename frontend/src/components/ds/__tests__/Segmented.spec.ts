import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Segmented from '../Segmented.vue'

// 2026-08-09 催缴单抽屉报障:胶囊被 flex column 父拉满整行 + 切 tab 时宽度/位置抖动。
// 三条护栏:①根不撑满(fit-content)②不被压扁(flex-shrink:0)③选中/未选中字重恒定(文本宽度不跳)。
const OPTS = [
  { value: 'rent', label: '场地租金' },
  { value: 'util', label: '水电费' },
]

describe('Segmented 不变形护栏', () => {
  it('根按内容宽且不被压缩', () => {
    const style = mount(Segmented, { props: { options: OPTS, modelValue: 'rent', size: 'sm' } })
      .attributes('style') ?? ''
    expect(style).toContain('width: fit-content')
    expect(style).toContain('flex-shrink: 0')
  })

  it('选中态只换底色/阴影,字重不变(切换不改文本宽度)', () => {
    const w = mount(Segmented, { props: { options: OPTS, modelValue: 'rent', size: 'sm' } })
    const weight = (i: number) =>
      /font-weight:\s*([^;]+)/.exec(w.findAll('button')[i].attributes('style') ?? '')?.[1]
    expect(weight(0)).toBe(weight(1))
    // 按钮自身不参与拉伸(无 flex-grow),整行宽只可能来自根被 stretch
    expect(w.findAll('button').every(b => !/flex(-grow)?:/.test(b.attributes('style') ?? ''))).toBe(true)
  })
})
