// 横条收尾(2026-10-03,实现规范 §2「横条盘点」FPTenantIssuePanel:66):
// 浏览态清单上方那条满宽蓝条「进入「编辑」模式后可在此绑定;浏览态仅查看。」撤掉 ——
// 进编辑态它一消失,下面的卡片整体上移。改成每张卡在「绑定」那个位置写一句 actHint。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FPTenantIssuePanel from '@/components/fp/FPTenantIssuePanel.vue'

const GROUPS = [
  { name: '老王', count: 2, total: 1200, where: '1月 · 3月' },
  { name: '鑫诚精密', count: 1, total: 800, where: '2月' },
]
const TENANTS = [{ id: 1, companyName: '鑫诚精密科技', status: 1 }]
const mk = (canAct: boolean, actHint?: string) => mount(FPTenantIssuePanel, {
  props: { groups: GROUPS, tenants: TENANTS, canAct, actHint, onBind: () => Promise.resolve() },
})

describe('未绑定清单 · 浏览态怎么绑', () => {
  // 破坏验证:.tip-ro 删掉 / 满宽 FPNote 加回来 → 红
  it('❗浏览态:每张卡在绑定位写「编辑模式下可绑定」,清单上方没有满宽提示', () => {
    const w = mk(false, '编辑模式下可绑定')
    const cards = w.findAll('.tip-card')
    expect(cards).toHaveLength(2)
    expect(cards.map(c => c.find('.tip-ro').text())).toEqual(['编辑模式下可绑定', '编辑模式下可绑定'])
    expect(w.find('.fp-note').exists()).toBe(false)
    expect(w.findAll('button').map(b => b.text()), '浏览态没有绑定按钮').not.toContain('绑定')
  })

  it('编辑态:绑定位是真的绑定入口,不写那句', () => {
    const w = mk(true, '编辑模式下可绑定')
    expect(w.find('.tip-ro').exists()).toBe(false)
    expect(w.findAll('.tip-card')[0].find('.tip-manual').exists()).toBe(true)
  })

  it('没传 actHint:浏览态什么都不写', () => {
    expect(mk(false).find('.tip-ro').exists()).toBe(false)
  })
})
