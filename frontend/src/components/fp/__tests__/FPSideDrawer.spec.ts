import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import FPSideDrawer from '../FPSideDrawer.vue'

// 第七次审计 C1 的教训:关闭态的浮层组件绝不能在 document capture 阶段吞 Esc。
// 这个回归测试钉死 FPSideDrawer 的两条纪律:开着才拦,关着放行。
describe('FPSideDrawer Esc 纪律', () => {
  it('关闭态:document 上的宿主 Esc 监听照常收到事件(不拦不吞)', () => {
    const host = vi.fn()
    document.addEventListener('keydown', host)
    mount(FPSideDrawer, { props: { open: false, title: '测试' } })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', host)
  })

  it('打开态:Esc 关自己并 stopPropagation(不连坐 window 层宿主)', async () => {
    // 本仓宿主弹窗(FPDrawer/FinDialogs)监听 window keydown;抽屉在 document 冒泡层
    // stopPropagation,事件到不了 window —— 内层浮层(元素级监听)则先于 document 冒泡,能自保
    const host = vi.fn()
    window.addEventListener('keydown', host)
    const w = mount(FPSideDrawer, { props: { open: true, title: '测试' } })
    await nextTick()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(w.emitted('close')).toBeTruthy()      // 自己关了
    expect(host).not.toHaveBeenCalled()          // window 层宿主没收到
    window.removeEventListener('keydown', host)
    w.unmount()
  })

  it('卸载后监听摘除:再按 Esc 宿主正常收到', async () => {
    const host = vi.fn()
    const w = mount(FPSideDrawer, { props: { open: true, title: '测试' } })
    await nextTick()
    w.unmount()
    document.addEventListener('keydown', host)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', host)
  })
})
