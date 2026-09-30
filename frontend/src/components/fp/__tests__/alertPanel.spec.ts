// 入口胶囊 + 问题面板(十件 ②③,LAYOUT-STABILITY-SPEC §6,画布 06-B ②③ / 06-C 方案 A / 01-B)。
// 面板从右侧抽屉改成以胶囊为触发的 ds/Popover:贴着胶囊弹出、420 宽、页面不变暗;点外 / Esc 关;
// 组头可收起、件数、处理按钮;明细可点;问题多了面板里滚动;屏被 KeepAlive 停用时收起。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref, nextTick, KeepAlive } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import FPAlertPanel, { type AlertGroup } from '../FPAlertPanel.vue'
import FPAlertChip from '../FPAlertChip.vue'
import Popover from '@/components/ds/Popover.vue'

// 夹具照画布 06-C 公共电核算的三组:第一组带明细和「重算本月」,后两组收起
const recalc = vi.fn()
const jump = vi.fn()
const GROUPS: AlertGroup[] = [
  {
    key: 'stale', title: '待重算', desc: '参数在本月算出之后又改过，屏上的数还是改之前的。',
    items: [
      { text: 'A座 · 园区路灯', hint: '系数改过', onClick: jump },
      { text: 'A座 · 二楼西侧', hint: '分摊基数改过' },
    ],
    action: { label: '重算本月', icon: 'refresh-cw', run: recalc },
  },
  { key: 'gen', title: '本次生成告警', desc: '生成本月时有两个池没挂上表。', items: [{ text: '宿舍 · 路灯' }, { text: '三期 · 电梯' }] },
  { key: 'members', title: '池成员变动', desc: '池成员和上次生成时不一样。', items: [{ text: 'B座 · 新进 1 户' }] },
]

let w: VueWrapper | null = null
afterEach(() => { w?.unmount(); w = null; vi.clearAllMocks() })

/** 屏持有打开态(v-model:open),和四个调用点一样 */
function host(groups: AlertGroup[] = GROUPS, count = 5, slot?: () => unknown) {
  const open = ref(false)
  const Host = defineComponent({
    setup: () => () => h(FPAlertPanel, {
      open: open.value, 'onUpdate:open': (v: boolean) => { open.value = v }, groups, count,
    }, slot ? { default: slot } : undefined),
  })
  w = mount(Host, { attachTo: document.body })
  return { open, w: w! }
}
const panel = () => document.querySelector<HTMLElement>('.ds-popover-panel')

describe('FPAlertPanel 贴着胶囊弹出', () => {
  it('❗点胶囊 → 出 420 宽面板,页面不变暗(没有抽屉遮罩)', async () => {
    const { open, w } = host()
    expect(panel()).toBeNull()
    await w.find('button.fac').trigger('click')
    expect(open.value).toBe(true)
    expect(panel()!.style.width).toBe('420px')
    expect(panel()!.textContent).toContain('待重算')
    expect(document.querySelector('.fp-sdw-mask')).toBeNull()
    expect(document.querySelector('.fp-sdw')).toBeNull()
    // 胶囊告诉读屏它展开了
    expect(w.find('button.fac').attributes('aria-expanded')).toBe('true')
  })

  it('❗Esc 关、点面板外面关;点面板里面不关', async () => {
    const { open, w } = host()
    await w.find('button.fac').trigger('click')
    panel()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(open.value, '点面板里面不许关').toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(open.value).toBe(false)
    expect(panel()).toBeNull()

    await w.find('button.fac').trigger('click')
    expect(open.value).toBe(true)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(open.value).toBe(false)
  })

  it('❗默认只展开第一组;点组头收起,再点后面的组头展开', async () => {
    const { w } = host()
    await w.find('button.fac').trigger('click')
    const bodies = () => w.findAll('.fap-body').map(b => (b.element as HTMLElement).style.display)
    expect(bodies()).toEqual(['', 'none', 'none'])
    const heads = w.findAll('button.fap-tg')
    await heads[0].trigger('click')
    expect(bodies()).toEqual(['none', 'none', 'none'])
    await heads[2].trigger('click')
    expect(bodies()).toEqual(['none', 'none', ''])
    expect(heads[2].attributes('aria-expanded')).toBe('true')
  })

  it('❗组头带件数和处理按钮;按钮点了跑 run', async () => {
    const { w } = host()
    await w.find('button.fac').trigger('click')
    const head = w.findAll('.fap-gh')[0]
    expect(head.find('.n').text()).toBe('2')
    const btn = head.findAll('button').find(b => b.text() === '重算本月')!
    expect(btn, '处理按钮在组头上').toBeTruthy()
    await btn.trigger('click')
    expect(recalc).toHaveBeenCalledTimes(1)
  })

  it('❗明细可点:点一条调它的 onClick;没有 onClick 的那条点不动', async () => {
    const { w } = host()
    await w.find('button.fac').trigger('click')
    const items = w.findAll('.fap-item')
    expect(items[0].text()).toContain('系数改过')
    await items[0].trigger('click')
    expect(jump).toHaveBeenCalledTimes(1)
    expect(items[1].attributes('disabled')).toBeDefined()
  })

  it('❗问题多了在面板里滚动:面板封顶 70vh、overflow-y:auto', async () => {
    const many: AlertGroup[] = [{
      key: 'unbound', title: '未绑定', desc: '这些租户的行还没绑到台账户。',
      items: Array.from({ length: 21 }, (_, i) => ({ text: `S10-${String(i + 100).padStart(4, '0')}`, onClick: jump })),
    }]
    const { w } = host(many, 21)
    await w.find('button.fac').trigger('click')
    expect(w.findAll('.fap-item')).toHaveLength(21)
    expect(panel()!.style.overflowY).toBe('auto')
    expect(panel()!.style.maxHeight).toBe('70vh')
  })

  it('❗count=0:胶囊显「无待处理」(quiet、没有 ▾),点开是空态', async () => {
    const { w } = host([], 0)
    const chip = w.find('button.fac')
    expect(chip.text()).toBe('无待处理')
    expect(chip.classes()).toContain('quiet')
    expect(chip.find('.dd').exists()).toBe(false)
    await chip.trigger('click')
    expect(panel()!.textContent).toContain('本月没有待处理事项')
  })

  it('❗默认插槽:台账的未绑定清单放进来,不再出空态', async () => {
    const { w } = host([], 3, () => h('div', { class: 'slot-body' }, '未绑定 3 户'))
    await w.find('button.fac').trigger('click')
    expect(panel()!.querySelector('.slot-body')!.textContent).toBe('未绑定 3 户')
    expect(panel()!.textContent).not.toContain('本月没有待处理事项')
  })

  it('❗屏被 KeepAlive 停用(切页签)→ 面板收起', async () => {
    const open = ref(false)
    const on = ref(true)
    const Screen = defineComponent({
      setup: () => () => h(FPAlertPanel, {
        open: open.value, 'onUpdate:open': (v: boolean) => { open.value = v }, groups: GROUPS, count: 5,
      }),
    })
    w = mount(defineComponent({ setup: () => () => h(KeepAlive, null, [on.value ? h(Screen) : null]) }), { attachTo: document.body })
    await w.find('button.fac').trigger('click')
    expect(open.value).toBe(true)
    on.value = false
    await nextTick()
    expect(open.value).toBe(false)
  })
})

describe('FPAlertPanel 面板摆在屏内(对抗复查 regress-1:工具条折行后胶囊落到第二行最左边)', () => {
  // jsdom 不排版:胶囊的框、视口宽都要桩,不桩就是全 0 的退化夹具
  const iw = Object.getOwnPropertyDescriptor(window, 'innerWidth')!
  afterEach(() => { Object.defineProperty(window, 'innerWidth', iw) })

  /** 视口 vw 宽,胶囊在 [left, left+100],按 align 打开;返回面板相对胶囊左边的偏移 */
  async function openAt(vw: number, left: number, align?: 'start' | 'end') {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: vw })
    const open = ref(false)
    w = mount(defineComponent({
      setup: () => () => h(FPAlertPanel, {
        open: open.value, 'onUpdate:open': (v: boolean) => { open.value = v }, groups: GROUPS, count: 5, align,
      }),
    }), { attachTo: document.body })
    const chip = w.find('button.fac').element as HTMLElement
    chip.getBoundingClientRect = () => ({ left, right: left + 100, top: 100, bottom: 128, width: 100, height: 28, x: left, y: 100, toJSON() {} }) as DOMRect
    await w.find('button.fac').trigger('click')
    const p = panel()!
    expect(p.style.right, '左右只由 left 定').toBe('auto')
    expect(p.style.maxWidth).toBe('calc(100vw - 32px)')
    return p.style.left
  }

  it('❗align=end 放得下就照办:右边对齐胶囊往左展开(公共电核算 / 楼栋损耗胶囊在工具条右侧)', async () => {
    // 1440 宽,胶囊 600–700:往左 420 → 左边 280,相对胶囊 -320;照 start 摆会是 0
    expect(await openAt(1440, 600, 'end')).toBe('-320px')
  })

  it('❗手机 375:胶囊折到第二行最左边(16–116),align=end 放不下就换边,面板落在屏内 16–359', async () => {
    // 写死往左展开:左边在 116 - 343 = -227,2/3 出屏。换到右边展开 → 左边 16,相对胶囊 0
    expect(await openAt(375, 16, 'end')).toBe('0px')
  })

  it('❗1024 桌面编辑态:工具条整组折行,胶囊在 116,align=end 换边往右开(夹到屏边 16 会被主卡 overflow 裁掉)', async () => {
    expect(await openAt(1024, 116, 'end')).toBe('0px')
  })

  it('❗两边都放不下(手机 375,胶囊在 150–250):夹在屏内,左边 16', async () => {
    // 宽 min(420, 375-32)=343;往右 150+343 > 359,往左 250-343 < 16 → 夹到 16,相对胶囊 16-150
    expect(await openAt(375, 150)).toBe(`${16 - 150}px`)
  })
})

describe('FPAlertPanel 明细行尺寸(画布 06-C 1:1:明细 14px、右侧灰字 12px、行高 36)', () => {
  it('❗.fap-item 14px / 36 高;.hn 12px', async () => {
    const src = readFileSync(join(__dirname, '../FPAlertPanel.vue'), 'utf8')
    const st = document.createElement('style')
    st.textContent = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    document.head.appendChild(st)
    const { w } = host()
    await w.find('button.fac').trigger('click')
    const item = document.querySelector<HTMLElement>('.fap-item')!
    expect(getComputedStyle(item).fontSize).toBe('var(--fs-body)')
    expect(getComputedStyle(item).minHeight).toBe('36px')
    expect(getComputedStyle(item.querySelector('.hn')!).fontSize).toBe('var(--fs-label)')
    st.remove()
  })
})

describe('FPAlertChip 三态', () => {
  // 组件自己的 <style> 塞进 document 读 getComputedStyle(同 darkOverrides.spec 的做法)
  it('❗28 高,和工具条按钮(Button sm)同高', () => {
    const src = readFileSync(join(__dirname, '../FPAlertChip.vue'), 'utf8')
    const st = document.createElement('style')
    st.textContent = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    document.head.appendChild(st)
    const c = mount(FPAlertChip, { props: { count: 5 }, attachTo: document.body })
    expect(getComputedStyle(c.element).height).toBe('28px')
    c.unmount()
    st.remove()
  })

  it('❗有:「待处理 5」+ ▾', () => {
    const c = mount(FPAlertChip, { props: { count: 5 } })
    expect(c.text()).toBe('待处理 5')
    expect(c.classes()).not.toContain('quiet')
    expect(c.find('.dd').exists()).toBe(true)
    c.unmount()
  })

  it('❗筛选生效:实底 + ×;点 × 只 emit clear,不顺带开弹层', async () => {
    // 挂进 ds/Popover 的触发器里点(FPAlertPanel 就这么用它):Popover 在包住触发器的外壳上听 click 翻开合,
    // × 的 click 冒上去就会清筛选的同时把面板打开。单独 mount 胶囊时外面没人听,测不出来
    const onClear = vi.fn()
    const onOpenChange = vi.fn()
    const c = mount(Popover, {
      props: { open: false, onOpenChange },
      slots: { trigger: () => h(FPAlertChip, { count: 133, label: '缺起止日期', active: true, onClear }) },
    })
    const chip = c.find('.fac')
    expect(chip.classes()).toContain('on')
    expect(chip.text()).toContain('缺起止日期 133')
    expect(chip.find('.dd').exists(), '筛选生效时是 × 不是 ▾').toBe(false)
    await c.find('.x').trigger('click')
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onOpenChange, '点 × 不许顺带开面板').not.toHaveBeenCalled()
    // 对照:点胶囊本体能开 —— 证明上面的「没开」不是因为触发器没接上
    await c.find('.fac-b').trigger('click')
    expect(onOpenChange).toHaveBeenCalledWith(true)
    c.unmount()
  })

  it('❗筛选生效的 × 是和胶囊按钮并列的独立 button:不嵌在 button 里(否则读屏吞掉「清除筛选」)', () => {
    const c = mount(FPAlertChip, { props: { count: 133, label: '缺起止日期', active: true }, attrs: { 'aria-expanded': 'false' } })
    const x = c.find('.x').element
    expect(x.tagName).toBe('BUTTON')
    expect(x.getAttribute('aria-label')).toBe('清除筛选')
    expect(x.parentElement!.closest('button'), '× 的祖先里不许有 button').toBeNull()
    expect(c.findAll('button').map((b) => b.text())).toEqual(['缺起止日期 133', ''])
    // 透传属性(FPAlertPanel 给的 aria-expanded)落在开面板那颗上
    expect(c.findAll('button')[0].attributes('aria-expanded')).toBe('false')
    c.unmount()
  })
})
