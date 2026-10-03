import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import IconRail from '@/components/shell/IconRail.vue'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { useUpdateStore } from '@/stores/update'
import MobileNavDrawer from '@/components/shell/mobile/MobileNavDrawer.vue'

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

  // ══════════ 外观(DARK-MODE-SPEC §3,稿 Main 第 1 节) ══════════
  it('❗外观一行在「版本更新」上面:三格 浅色 / 深色 / 跟随系统,默认浅色选中', () => {
    const w = openRail()
    const menu = w.find('.fp-user-menu').html()
    expect(menu.indexOf('外观')).toBeGreaterThan(-1)
    expect(menu.indexOf('外观')).toBeLessThan(menu.indexOf('版本更新'))
    const seg = w.findAll('.fp-appr-seg button')
    expect(seg.map((b) => b.text())).toEqual(['浅色', '深色', '跟随系统'])
    expect(seg.map((b) => b.attributes('aria-checked'))).toEqual(['true', 'false', 'false'])
  })

  it('❗点「深色」立刻生效(写 data-theme、按账号存),菜单还在', async () => {
    useAuthStore().me = 'zhou'
    const w = openRail()
    await w.findAll('.fp-appr-seg button')[1].trigger('click')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('fp-appearance:zhou')).toBe('dark')
    expect(w.findAll('.fp-appr-seg button')[1].classes()).toContain('on')
    expect(w.find('.fp-user-menu').exists()).toBe(true)
    await w.findAll('.fp-appr-seg button')[0].trigger('click')   // 还原,不串到别的用例
  })

  it('❗账号菜单用 fixed 贴在头像正上方(左对齐、隔 8px):导航卡 overflow:hidden,窄屏只剩 66 宽图标栏时 absolute 会被裁', async () => {
    const w = mount(IconRail, { attachTo: document.body, global: { stubs: { PopoverItem: true, Avatar: true } } })
    const btn = w.find('.fp-rail-user').element as HTMLElement
    btn.getBoundingClientRect = () => ({ left: 17, top: 900, width: 32, height: 32, right: 49, bottom: 932, x: 17, y: 900, toJSON() {} }) as DOMRect
    await w.find('.fp-rail-user').trigger('click')
    const panel = w.find('.ds-popover-panel').element as HTMLElement
    expect(panel.style.position).toBe('fixed')
    expect(panel.style.left).toBe('17px')
    expect(panel.style.bottom).toBe(`${window.innerHeight - 900 + 8}px`)
    w.unmount()
  })

  describe('头像的说明气泡', () => {
    afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

    // v-tip 触屏按下就出、翻到头像上方,正好盖住向上弹的账号菜单最下面「版本更新 / 退出登录」;
    // tip.ts 文件头也写着图标轨继续用 ShellTip(它没有触屏分支)
    it('❗触屏点头像不出气泡;鼠标停 500ms 照样出名字', async () => {
      vi.useFakeTimers()
      useAuthStore().displayName = '周明'
      const w = mount(IconRail, { attachTo: document.body, global: { stubs: { PopoverItem: true, Avatar: true } } })
      const btn = w.find('.fp-rail-user').element
      const e = new MouseEvent('pointerdown', { bubbles: true })
      Object.defineProperty(e, 'pointerType', { value: 'touch' })
      btn.dispatchEvent(e)
      await nextTick()
      expect(document.querySelector('.fp-tip')).toBeNull()

      btn.closest('.fp-tipw')!.dispatchEvent(new MouseEvent('mouseenter'))
      vi.advanceTimersByTime(500)
      await nextTick()
      expect(document.querySelector('.fp-tip b')?.textContent).toBe('周明')
      w.unmount()
    })
  })

})

// ══════════ 记号只挂在铃铛上(06-G 规则表「只挂在铃铛上」,S5 FE-DOT) ══════════
describe('没看过的更新:账号菜单与手机抽屉不再挂点', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear() })

  /** 登进来、这一版没看过 —— 改前这时三处各亮一颗蓝点 */
  function unreadUser() {
    useAuthStore().me = 'zhou'
    const upd = useUpdateStore()
    upd.loadSeen()
    expect(upd.unread, '前置:真有没看过的更新').toBe(true)
    return upd
  }

  // 破坏验证:版本号后面加回 `<span v-if="upd.unread" class="dot" />` → 红
  it('❗账号菜单「版本更新」一行:有没看过的更新也不带 .dot', () => {
    const upd = unreadUser()
    const w = mount(IconRail, {
      global: { stubs: { Popover: { template: '<div><slot name="trigger" /><slot /></div>' }, PopoverItem: true, Avatar: true } },
    })
    const row = w.findAll('.fp-user-row').find((b) => b.text().includes('版本更新'))!
    expect(row.text(), '行本身还在,版本号照写').toContain(`v${upd.version}`)
    expect(row.find('.dot').exists()).toBe(false)
  })

  // 破坏验证:加回 `:class="{ unread: upd.unread }"` 或版本号后的 .dot → 红
  it('❗手机抽屉「版本更新」一行:没有 .dot,也不换未读底色', () => {
    const upd = unreadUser()
    const w = mount(MobileNavDrawer, { props: { open: true }, global: { stubs: { teleport: true } } })
    const row = w.findAll('.mnav-row').find((b) => b.text().includes('版本更新'))!
    expect(row.text(), '行本身还在,版本号照写').toContain(`v${upd.version}`)
    expect(row.find('.dot').exists()).toBe(false)
    expect(row.classes()).not.toContain('unread')
  })
})
