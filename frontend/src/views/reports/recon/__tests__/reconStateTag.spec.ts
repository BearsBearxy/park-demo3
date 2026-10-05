// 收入核对工作台(横条盘点 ReconWorkbench:233,2026-10-03,第 4 级):
// 原来对照面板顶上一条 .rc-banner 横贯全宽(三选一,文案长短不一,换户时 1↔2 行把下面的对照顶来顶去);
// 现在状态是标题旁那颗页面状态签,处置按钮挪到标题行右端,那句说明(和底部配平条说的同一件事)删掉。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import ReconWorkbench from '../ReconWorkbench.vue'
import type { ReconEntity } from '@/types/recon'
import { useAuthStore } from '@/stores/auth'
import { ALL_VIEWS } from '@/test-utils/perms'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {}, meta: {} }) }))
vi.mock('@/api/recon', () => ({ reconApi: { mark: vi.fn(), unmark: vi.fn() } }))
vi.mock('@/api/perms', () => ({
  loadPermDict: () => Promise.resolve(),
  permLabel: (k: string) => (k === 'entry:view' ? '台账与附表 · 查看' : k),
}))

const ent = (over: Partial<ReconEntity> = {}): ReconEntity => ({
  tenantId: 1, tenantName: '甲公司', status: 'diff', ledgerTotal: 1000, s10Total: 900, diff: 100,
  marked: false, markNote: null,
  fees: [{ key: 'rent', label: '租金', ledgerAmt: 1000, s10Amt: 900, delta: 100, onlySide: null }],
  ledgerCards: [{ companyName: '物业公司', total: 1000, fees: { rent: 1000 } }],
  s10Cards: [{ phase: 1, total: 900, fees: { rent: 900 } }],
  ...over,
})
const open = (e: ReconEntity) => mount(ReconWorkbench, {
  props: { year: 2025, month: 3, entities: [e] }, global: { stubs: { Teleport: true } },
})
const tag = (w: ReturnType<typeof open>) => w.find('.rc-dtitle .fp-state')
const act = (w: ReturnType<typeof open>) => w.find('.rc-dtitle .bbtn')

beforeEach(() => setActivePinia(createPinia()))

describe('收入核对 · 标题旁状态签', () => {
  // 破坏验证:三个 FPStateTag 任一条的文案 / 条件改掉 → 对应那一段红;.rc-banner 加回来 → 首条红
  it('❗未配平:黄签「两本账未配平 · 差额 +¥100.00」+ 标题行右端「标记已核实」;没有横条、没有那句说明', () => {
    const w = open(ent())
    expect(w.find('.rc-banner').exists()).toBe(false)
    expect(tag(w).text()).toBe('两本账未配平 · 差额 +¥100.00')
    expect(tag(w).classes()).toContain('warn')
    expect(act(w).text()).toBe('标记已核实')
    expect(w.text()).not.toContain('橙色科目为两侧金额不符')
  })

  it('❗缺记:同一颗签换红', () => {
    const w = open(ent({ status: 'miss', ledgerCards: [], ledgerTotal: 0, diff: -900 }))
    expect(tag(w).classes()).toContain('miss')
    expect(w.text()).not.toContain('台账缺记:附表10 有申报')
  })

  it('❗已核实:灰签「差异已核实 · 备注」,按钮换「取消核实」', () => {
    const w = open(ent({ marked: true, markNote: '押金差' }))
    expect(tag(w).text()).toBe('差异已核实 · 押金差')
    expect(act(w).text()).toBe('取消核实')
  })

  it('❗配平:灰签「两本账配平」,不出处置按钮', () => {
    const w = open(ent({ status: 'ok', diff: 0, s10Total: 1000 }))
    expect(tag(w).text()).toBe('两本账配平')
    expect(act(w).exists()).toBe(false)
  })
})

/** v-tip 挂在元素上的那一句(directives/tip.ts 存在 el._tip) */
const tipOf = (el: Element) => (el as HTMLElement & { _tip?: { text: string } })._tip?.text

// RBAC v3:V134 给园区股东报表查看,收入核对在他的导航里;处置弹窗的两颗跳转原来直接把他送进「无权查看」页
describe('收入核对 · 处置弹窗的跳转按查看权', () => {
  const jumps = async (perms: string[]) => {
    useAuthStore().permissions = perms
    const w = open(ent())
    await act(w).trigger('click')
    return w.findAll('.rc-pop-btn')
  }

  // 破坏验证:两颗按钮的 :disabled 去掉 → 红
  it('❗只有分析与报表查看(园区股东):去改台账、去改附表10 置灰,悬停写缺哪一项', async () => {
    const [ledger, s10] = await jumps(['analysis:view', 'report:view'])
    expect(ledger.text()).toBe('去改台账')
    expect(ledger.attributes('disabled')).toBeDefined()
    expect(s10.attributes('disabled')).toBeDefined()
    expect(tipOf(ledger.element)).toBe('需要「台账与附表 · 查看」权限')
  })

  it('有台账与附表查看:两颗照常可点', async () => {
    const [ledger, s10] = await jumps([...ALL_VIEWS])
    expect(ledger.attributes('disabled')).toBeUndefined()
    expect(s10.attributes('disabled')).toBeUndefined()
  })
})
