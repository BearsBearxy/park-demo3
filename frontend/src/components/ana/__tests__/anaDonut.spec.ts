// AnaDonut 冒烟(独立文件,G4 追加;规约同 anaCharts.spec.ts):mount 不炸 + 扇区/中心值存在。
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AnaDonut from '../AnaDonut.vue'

describe('AnaDonut 环形图', () => {
  it('正值段各一扇区 + 中心值/标签', () => {
    const w = mount(AnaDonut, { props: {
      data: [
        { label: '货币资金', value: 720, color: 'var(--fill-blue)' },
        { label: '应收账款', value: 3156, color: 'var(--fill-sky)' },
        { label: '在建工程', value: 8351, color: 'var(--fill-cyan)' },
      ],
      centerValue: '4.0亿', centerLabel: '资产总计',
    } })
    expect(w.findAll('path').length).toBe(3)
    expect(w.text()).toContain('4.0亿')
    expect(w.text()).toContain('资产总计')
  })

  it('负值/零值段跳过(环图不表达负数)', () => {
    const w = mount(AnaDonut, { props: { data: [
      { label: '正', value: 100, color: 'red' },
      { label: '零', value: 0, color: 'blue' },
      { label: '负', value: -50, color: 'green' },
    ] } })
    expect(w.findAll('path').length).toBe(1)
  })
})
