import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

import FPStepStrip, { type Step } from '@/components/fp/FPStepStrip.vue'

/**
 * 链路条 / 期间条(2026-08-28 设计稿 §⑤)。
 *
 * 它存在的理由是**换屏不换期**:从园区抄表点到公共电核算,还是同一个月,不退回选期矩阵。
 * 出账链喂五道工序、报表层喂五张表(P3),同一个组件两组数据。
 */

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const STEPS: Step[] = [
  { value: 'params', label: '计费参数', state: 'done' },
  { value: 'meters', label: '园区抄表', state: 'done' },
  { value: 'alloc', label: '公共电核算', state: 'stale' },
  { value: 'alloc-loss', label: '楼栋损耗', state: 'todo' },
  { value: 'bill-notices', label: '催缴单', state: 'todo' },
]

function mk(current = 'alloc') {
  return mount(FPStepStrip, { props: { steps: STEPS, current, period: '2025-03' } })
}

describe('FPStepStrip', () => {
  beforeEach(() => vi.clearAllMocks())

  it('五道工序全都在条上 —— 链要完整,少一环就不是链', () => {
    const w = mk()
    const names = w.findAll('.fss-step').map(s => s.text())
    expect(names).toEqual(['计费参数', '园区抄表', '公共电核算', '楼栋损耗', '催缴单'])
  })

  it('当前屏标出来', () => {
    const w = mk('bill-notices')
    const on = w.findAll('.fss-step').filter(s => s.classes('on'))
    expect(on).toHaveLength(1)
    expect(on[0].text()).toBe('催缴单')
  })

  it('点别的工序 → 换屏不换期', async () => {
    const w = mk('alloc')
    await w.findAll('.fss-step')[1].trigger('click')
    expect(push).toHaveBeenCalledWith('/meters')
  })

  it('点当前屏不导航 —— 重进一次自己只会把浏览状态冲掉', async () => {
    const w = mk('alloc')
    await w.findAll('.fss-step')[2].trigger('click')
    expect(push).not.toHaveBeenCalled()
  })

  it('期写在条上 —— 用户任何时候都知道自己在哪个月', () => {
    expect(mk().find('.fss-period').text()).toBe('2025-03')
  })

  it('「换出账月」发事件,不自己动 store —— 报表层复用时清的是另一份期', async () => {
    const w = mk()
    await w.find('.fss-back').trigger('click')
    expect(w.emitted('back')).toHaveLength(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('状态点按 state 上色,todo 不给点也占位 —— 有点没点尺寸一样', () => {
    const w = mk()
    const pips = w.findAll('.fss-step .fss-pip')
    expect(pips, '每一步都有点位,包括 todo').toHaveLength(5)
    expect(pips[0].classes()).toContain('done')
    expect(pips[2].classes()).toContain('stale')
    expect(pips[3].classes()).toContain('todo')
  })

  it('不传 state 的步骤不画点 —— 报表层的表没有「做没做」这回事', () => {
    const w = mount(FPStepStrip, {
      props: {
        steps: [{ value: 'income-statement', label: '利润表' }, { value: 'balance-sheet', label: '资产负债表' }],
        current: 'income-statement',
        period: '2025-09 · 物业公司',
      },
    })
    expect(w.findAll('.fss-pip')).toHaveLength(0)
    expect(w.findAll('.fss-step')).toHaveLength(2)
  })

  // ── 报表层复用(P3):期靠 query 随导航一起走 ──
  it('带 query 时把整包期一起带过去 —— 目标屏认得几个用几个,不认的原样传回来', async () => {
    const w = mount(FPStepStrip, {
      props: {
        steps: STEPS, current: 'alloc', period: '2025-09',
        query: { y: '2025', m: '9', co: '1' },
      },
    })
    await w.findAll('.fss-step')[1].trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/meters', query: { y: '2025', m: '9', co: '1' } })
  })

  it('不带 query 就走裸路径 —— 出账链的期在 store 里,不进地址栏', async () => {
    const w = mk('alloc')
    await w.findAll('.fss-step')[1].trigger('click')
    expect(push).toHaveBeenCalledWith('/meters')
  })

  it('步骤可带 title —— 条上写「附表1」,悬停看全名', () => {
    const w = mount(FPStepStrip, {
      props: {
        steps: [{ value: 'rent-pnl', label: '附表1', title: '附表1 租金损益' }],
        current: 'x', period: '2025',
      },
    })
    expect(w.find('.fss-step').attributes('title')).toBe('附表1 租金损益')
  })

  it('hideBack:上面本来就没有一层时不画返回钮 —— 一个点了不动的按钮比没有按钮更坏', () => {
    const w = mount(FPStepStrip, {
      props: { steps: STEPS, current: 'alloc', period: '2025 年', hideBack: true },
    })
    expect(w.find('.fss-back').exists()).toBe(false)
    expect(w.findAll('.fss-step'), '步骤照常').toHaveLength(5)
    expect(w.find('.fss-period').text(), '期标照常').toBe('2025 年')
  })

  it('返回按钮文案可换 —— 出账链叫「换出账月」,报表层叫「换期」', () => {
    const w = mount(FPStepStrip, {
      props: { steps: STEPS, current: 'alloc', period: '2025-03', backLabel: '换期' },
    })
    expect(w.find('.fss-back').text()).toContain('换期')
  })
})
