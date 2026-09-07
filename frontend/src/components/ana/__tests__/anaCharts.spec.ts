// 分析图表冒烟:mount 不炸 + 关键 SVG 元素存在(jsdom 无 ResizeObserver → useWidth 回退初始宽)。
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import AnaBullet from '../AnaBullet.vue'
import AnaTrend from '../AnaTrend.vue'
import AnaEmpty from '../AnaEmpty.vue'
import { peakTag, trendTag } from '../anaFmt'

// AnaEmpty 自 P5 起要看「这个人看不看得见目标屏所在的层」→ 需要 auth store
beforeEach(() => setActivePinia(createPinia()))

describe('图表原语冒烟', () => {
  it('AnaBullet:每行底轨 + 值条 + 目标线', () => {
    const w = mount(AnaBullet, { props: { rows: [{ name: 'A', value: 88 }], target: 90, max: 100 } })
    expect(w.findAll('rect').length).toBe(2)
    expect(w.findAll('line').length).toBe(1)
    expect(w.text()).toContain('目标线')
  })

  it('AnaTrend:今年实线 + 去年虚线 + 图例', () => {
    const w = mount(AnaTrend, { props: { labels: ['1月', '2月', '3月'], cur: [1, 2, 3], prev: [1, 1, 2] } })
    expect(w.findAll('path').length).toBe(3)   // prev + area + cur
    expect(w.text()).toContain('去年同期')
  })

  const emptyCard = () => mount(AnaEmpty, {
    props: { label: '合同日期未录入', hint: '去补录', to: '/contracts', toText: '去合同管理' },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })

  it('AnaEmpty:空态卡带深链', () => {
    const w = emptyCard()
    expect(w.text()).toContain('合同日期未录入')
    expect(w.text()).toContain('去合同管理')
  })

  // ❗§6:园区股东只有经营分析层,/contracts 在数据层 —— 给他这条链接等于把他送进一个
  //   侧边栏没有入口的屏。破坏验证:把 canGo 改成 `!!props.to` → 红。
  it('❗看不见目标屏所在层的人不给「去录入」链接,但缺什么数照说', () => {
    useAuthStore().navLayers = ['analysis']
    const w = emptyCard()
    expect(w.find('a').exists(), '股东进不去合同屏').toBe(false)
    expect(w.text(), '说明文字不该跟着链接一起消失').toContain('合同日期未录入')
    expect(w.text()).toContain('去补录')
  })
})

describe('动态标签', () => {
  it('peakTag/trendTag 由数据算出', () => {
    expect(peakTag([1, 2, 5])!.text).toContain('新高')
    expect(peakTag([5, 2, 1])!.tone).toBe('risk')
    expect(trendTag([1, 2, 3, 4])!.text).toContain('上行')
    expect(trendTag([1, 2])).toBeNull()
  })
})
