import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import IconRail from '@/components/shell/IconRail.vue'
import { useTabsStore } from '@/stores/tabs'

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
