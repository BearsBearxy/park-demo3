// ds/Select 的 S 档底部面板(RESPONSIVE-LAYOUT-SPEC §4.4;壳同 ds/DatePicker 的 .dp-sheet)。
//
// 起因:贴附 popover 在 390 上会出屏 —— 字段落在右半屏时(工具条里的「全部状态」就是),
// 面板宽 220 从 left 214 起算 = 右缘 434 > 视口 390,右边 44px 看不见也点不着。
//
// 两档都断:S 出底部面板、XL 仍出贴附 popover。只断一档的话,把贴附分支写坏也是绿的。
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Select from '../Select.vue'
import { _resetViewportForTest } from '@/composables/useViewport'

const OPTS = ['全部状态', '执行中', '即将到期', '已终止']
const SRC = readFileSync(join(__dirname, '..', 'Select.vue'), 'utf8')
const TOKENS = readFileSync(join(__dirname, '..', '..', '..', 'styles', 'tokens.css'), 'utf8')

let w: VueWrapper | null = null

/**
 * 档位靠 matchMedia 喂(同 DatePicker.spec:285)。
 * ⚠ 必须有 'm' 这一档:只喂 S 与 XL 两头的话,Select 的判据可以悄悄放宽成「非 XL」,
 *   平板 768 上每个下拉都变成底部升起面板 —— 正好推翻「平板 = 小桌面」那条拍板,
 *   而全部断言照样绿(2026-09-20 对抗复查实跑验证)。
 */
function setTier(tier: 's' | 'm' | 'xl') {
  const hit = (q: string) =>
    tier === 's' ? q.includes('max-width')
      : tier === 'm' ? (q.includes('960') || q.includes('1280'))
        : false
  vi.stubGlobal('matchMedia', (q: string) => ({
    media: q,
    matches: hit(q),
    addEventListener() {},
    removeEventListener() {},
  }))
  _resetViewportForTest()
}

async function openAt(tier: 's' | 'm' | 'xl', props: Record<string, unknown> = {}) {
  setTier(tier)
  w = mount(Select, { props: { options: OPTS, label: '状态', ...props }, attachTo: document.body })
  await w.find('button.ds-sel-trigger').trigger('click')
  await nextTick()
  return document.body.querySelector<HTMLElement>('.ds-sel-panel')!
}

afterEach(() => {
  w?.unmount(); w = null
  _resetViewportForTest()
  vi.unstubAllGlobals()
})

describe('ds/Select · S 档出底部面板', () => {
  it('❗S 档:面板带 .ds-sel-sheet、把手在、遮罩在,且 teleport 到了 body 下', async () => {
    const panel = await openAt('s')
    expect(panel.classList.contains('ds-sel-sheet'), 'S 档要走 sheet 分支').toBe(true)
    expect(document.body.querySelector('.ds-sel-hdl'), '把手 36×5').not.toBeNull()
    expect(document.body.querySelector('.ds-sel-scrim'), '底部面板要有自己的遮罩').not.toBeNull()
    // teleport 到 body:面板不再嵌在字段容器里,否则宿主的 overflow 会把它裁掉
    expect(panel.parentElement).toBe(document.body)
  })

  it('❗XL 档:仍是贴附 popover —— 没有 sheet 类、没有把手、没有遮罩,内联定位还在', async () => {
    const panel = await openAt('xl')
    expect(panel.classList.contains('ds-sel-sheet')).toBe(false)
    expect(document.body.querySelector('.ds-sel-hdl')).toBeNull()
    expect(document.body.querySelector('.ds-sel-scrim')).toBeNull()
    expect(panel.getAttribute('style') ?? '').toContain('position: absolute')
  })

  it('❗S 档标题行:左边是字段标签、右边是 44×44 的 ✕,高度 52', async () => {
    await openAt('s')
    const head = document.body.querySelector<HTMLElement>('.ds-sel-sh')!
    expect(head.querySelector('span')!.textContent).toBe('状态')
    expect(head.querySelector('button.ds-sel-shx')!.getAttribute('aria-label')).toBe('关闭')
    expect(SRC).toMatch(/\.ds-sel-sh\s*\{[^}]*height:\s*52px/)
    expect(SRC).toMatch(/\.ds-sel-shx\s*\{[^}]*width:\s*44px;\s*height:\s*44px/)
  })

  it('❗点 ✕ 关面板', async () => {
    await openAt('s')
    document.body.querySelector<HTMLButtonElement>('.ds-sel-shx')!.click()
    await nextTick()
    expect(document.body.querySelector('.ds-sel-panel')).toBeNull()
  })

  it('❗S 档选项点得中 —— mousedown 先到 document capture,不能把面板先卸载掉', async () => {
    await openAt('s')
    const opt = [...document.body.querySelectorAll<HTMLElement>('.ds-sel-opt')]
      .find((o) => o.textContent?.trim() === '已终止')!
    // 面板已 teleport 出 containerRef:onDoc 少了 panelRef 这一判,这一下 mousedown 就会关掉面板,
    // 后面的 click 派到一个已卸载的节点上 —— 一项都选不中。
    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    // ⚠ 这一条才是判据:mousedown 之后面板必须还在。只断「选中值发出来了」是挡不住的 ——
    // Vue 的 click 监听挂在元素自己身上,节点被卸载后对它派 click 照样会跑 handler,恒绿。
    expect(document.body.querySelector('.ds-sel-panel'), 'mousedown 不许把面板关掉').not.toBeNull()
    opt.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(w!.emitted('update:modelValue')?.[0]).toEqual(['已终止'])
    expect(document.body.querySelector('.ds-sel-panel'), '选完要关').toBeNull()
  })

  it('❗Esc 只关自己:阻断传播,宿主弹窗不跟着关(UI-OVERLAY-SPEC §2)', async () => {
    await openAt('s')
    let reachedWindow = false
    const spy = () => { reachedWindow = true }
    window.addEventListener('keydown', spy)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    window.removeEventListener('keydown', spy)
    await nextTick()
    expect(document.body.querySelector('.ds-sel-panel')).toBeNull()
    expect(reachedWindow, 'Esc 不许冒到宿主 window').toBe(false)
  })

  it('❗S 档选中项右端有勾(勾还在选项里的最后一个元素上)', async () => {
    await openAt('s', { modelValue: '即将到期' })
    const picked = [...document.body.querySelectorAll<HTMLElement>('.ds-sel-opt')]
      .find((o) => o.getAttribute('aria-selected') === 'true')!
    const last = picked.lastElementChild!
    expect(last.tagName.toLowerCase()).toBe('svg')
    expect(last.querySelector('polyline')!.getAttribute('points')).toBe('20 6 9 17 4 12')
  })
})

describe('ds/Select · S 档壳的尺寸(CSS 字面量)', () => {
  it('❗选项行高 52、字号 16', () => {
    const rule = SRC.match(/\.ds-sel-sheet \.ds-sel-opt\s*\{[^}]*\}/)![0]
    expect(rule).toMatch(/height:\s*52px\s*!important/)
    expect(rule).toMatch(/font-size:\s*var\(--fs-input-m\)\s*!important/)
    // 16 不是写在这儿而是在令牌里,顺着钉一道,免得令牌改了这条还绿着
    expect(TOKENS).toMatch(/--fs-input-m:\s*16px/)
  })

  it('❗面板贴底、最高 60dvh、底部 34 安全区', () => {
    const rule = SRC.match(/\.ds-sel-panel\.ds-sel-sheet\s*\{[^}]*\}/)![0]
    expect(rule).toMatch(/position:\s*fixed/)
    expect(rule).toMatch(/bottom:\s*0/)
    expect(rule).toMatch(/max-height:\s*60dvh/)
    expect(rule).toMatch(/overflow-y:\s*auto/)
    expect(rule).toMatch(/padding:\s*0 8px 34px/)
  })

  it('❗把手 36×5', () => {
    expect(SRC).toMatch(/\.ds-sel-hdl\s*\{[^}]*width:\s*36px;\s*height:\s*5px/)
  })

  it('❗贴附分支的内联定位一条没动(桌面零差异 §9)', () => {
    const rule = SRC.match(/const popStyle = computed<CSSProperties>\(\(\) => \(\{[\s\S]*?\}\)\)/)![0]
    for (const frag of [
      'position: "absolute"', 'top: "calc(100% + 6px)"', 'left: "0"',
      'minWidth: "100%"', 'width: "max-content"', 'maxWidth: "280px"',
      'zIndex: "var(--z-popover)"', 'padding: "6px"', 'maxHeight: "456px"',
      'overflowY: "auto"', 'boxSizing: "border-box"',
    ]) expect(rule, frag).toContain(frag)
  })

  it('❗字号桥没被重复做:≤600 的媒体查询只此一条', () => {
    expect(SRC.match(/@media \(max-width:\s*600px\)/g)?.length ?? 0).toBe(1)
  })

  it('❗M 档(平板 768)仍是贴附 popover —— 「平板 = 小桌面」那条拍板', async () => {
    // 只断 S 与 XL 两头的话,判据可以悄悄放宽成「非 XL」:平板上每个下拉都变成底部升起面板,
    // 而全部断言照样绿(2026-09-20 对抗复查实跑验证)。中间这一档必须自己有人管。
    const panel = await openAt('m')
    expect(panel.classList.contains('ds-sel-sheet'), 'M 档不该走 sheet 分支').toBe(false)
    expect(document.body.querySelector('.ds-sel-hdl'), 'M 档不该有把手').toBeNull()
    expect(document.body.querySelector('.ds-sel-scrim'), 'M 档不该有底部面板的遮罩').toBeNull()
    expect(panel.getAttribute('style') ?? '').toContain('position: absolute')
    // 源码侧再钉一次判据本身:只有 's' 走 sheet,不是 !== 'xl'
    expect(SRC).toMatch(/const sheet = computed\(\(\) => vp\.tier\.value === ["']s["']\)/)
  })
})
