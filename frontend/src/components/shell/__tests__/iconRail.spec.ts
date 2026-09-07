import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import IconRail from '@/components/shell/IconRail.vue'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { value: 'data-home' } }),
  useRouter: () => ({ push }),
}))

const mountRail = () => mount(IconRail, { global: { stubs: { Popover: true, PopoverItem: true, Avatar: true } } })
const layerBtn = (w: ReturnType<typeof mountRail>, short: string) =>
  w.findAll('button').find(b => b.text().includes(short))

describe('IconRail · 层切换语义(§4.1)', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); push.mockClear() })

  it('点当前层:不 push、不动页签', async () => {
    const w = mountRail()
    const tabs = useTabsStore()
    await layerBtn(w, '数据')!.trigger('click')
    expect(push).not.toHaveBeenCalled()
    expect(tabs.epochOf('data-home')).toBe(0)
  })

  it('换层 = openFresh(层首页)+ push(全新状态)', async () => {
    const w = mountRail()
    const tabs = useTabsStore()
    await layerBtn(w, '报表')!.trigger('click')
    expect(tabs.epochOf('reports-home')).toBe(1)
    expect(push).toHaveBeenCalledWith('/reports-home')
  })

  it('命令钮有 aria-label(屏读能念出它是干什么的)', () => {
    expect(mountRail().find('.fp-rail-cmd').attributes('aria-label')).toBeTruthy()
  })
})

// ══════════ 角色行(§6,P5) ══════════
describe('IconRail · 角色行(P5)', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear() })

  // Popover 默认整只被 stub 掉,槽内容不渲染 —— 这里放行槽,否则断言的是一个空串
  const openRail = () => mount(IconRail, {
    global: { stubs: { Popover: { template: '<div><slot name="trigger" /><slot /></div>' },
                       PopoverItem: true, Avatar: true } },
  })

  // ❗破坏验证:把模板改回常量三元 `auth.isReadonly ? '只读账号' : '管理员(可写)'` → 红。
  //   那个常量把财务专员 / 主管 / 审核员一律写成「管理员」,而后两种连用户管理都进不去。
  it('❗显后端给的真名,不是「管理员(可写)」那个二值常量', () => {
    useAuthStore().roleNames = ['财务专员']
    const t = openRail().find('.fp-user-role')
    expect(t.text()).toBe('财务专员')
    expect(t.text()).not.toContain('管理员')
  })
})
