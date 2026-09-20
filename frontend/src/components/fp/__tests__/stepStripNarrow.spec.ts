// 链路条 / 期间条的窄档收法(RESPONSIVE-LAYOUT-SPEC §5.9)。
//
// 为什么这条必须自己有收法:报表族九颗胶囊每颗 `padding:5px 11px`,合计 653px。
// 就算左轨收完、主区回到 358,在 334 可用宽里 `flex-wrap:wrap` 仍折 2 行(112px)。
// 所以 M 换横滑 + 尾标、S 换「当前 + n/N + 前后箭头」(54px)。
//
// 档位走 useViewport 的 tier(S 档换的是 DOM 结构,@media 改不了渲染哪一支),
// 故这里照 useViewport.spec.ts 的可控 matchMedia mock 模式手写。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import FPStepStrip, { type Step } from '@/components/fp/FPStepStrip.vue'
import { _resetViewportForTest } from '@/composables/useViewport'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

// ── 可控视口 ──
let widthPx = 1440
function mockMatchMedia(width: number) {
  widthPx = width
  ;(window as any).matchMedia = (media: string) => ({
    media,
    get matches() {
      const mw = media.match(/max-width:\s*(\d+)px/)
      return mw ? widthPx <= Number(mw[1]) : false
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  _resetViewportForTest()
}

// ── 两组真实形状的夹具(不退化:标签各不相同、状态有 done/stale/todo 三种) ──
/** 出账链五颗(nav/billingChain.ts:26-34 的形状:每步带 state) */
const CHAIN5: Step[] = [
  { value: 'params', label: '计费参数', state: 'done' },
  { value: 'meters', label: '园区抄表', state: 'done' },
  { value: 'alloc', label: '公共电核算', state: 'stale' },
  { value: 'alloc-loss', label: '楼栋损耗', state: 'todo' },
  { value: 'bill-notices', label: '催缴单', state: 'todo' },
]
/** 报表族九颗(nav/reportPeriod.ts:26-38 的形状:无 state,附表只写短名、全名进 title) */
const REPORT9: Step[] = [
  { value: 'income-statement', label: '利润表' },
  { value: 'balance-sheet', label: '资产负债表' },
  { value: 'trial-balance', label: '科目余额表' },
  { value: 'rent-pnl', label: '附表1', title: '附表1 租金损益' },
  { value: 'elec-pnl', label: '附表2', title: '附表2 电费损益' },
  { value: 'water-pnl', label: '附表3', title: '附表3 水费损益' },
  { value: 'ops-pnl', label: '附表4', title: '附表4 运管损益' },
  { value: 'expense-pnl', label: '附表5', title: '附表5 费用损益' },
  { value: 'reconciliation', label: '收入核对' },
]

const LABELS9 = REPORT9.map(s => s.label)
const LABELS5 = CHAIN5.map(s => s.label)

let live: VueWrapper<any>[] = []
function mk(steps: Step[], current: string, period = '2025-09') {
  const w = mount(FPStepStrip, { props: { steps, current, period } })
  live.push(w)
  return w
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  localStorage.clear()
})
afterEach(() => {
  live.forEach(w => w.unmount())
  live = []
  document.body.innerHTML = ''      // FPDrawer Teleport 到 body,不清会串到下一条
  _resetViewportForTest()
})

// ─────────────────────────────── 三档 ───────────────────────────────

describe('§5.9 三档形态', () => {
  it('XL(1440):全条 —— 九颗胶囊一颗不少,期标在条上,没有窄档那些件', () => {
    mockMatchMedia(1440)
    const w = mk(REPORT9, 'income-statement')
    expect(w.find('.fss').classes()).toEqual(['fss'])        // 宽档两个 tier 类都不挂 = 零差异
    expect(w.findAll('.fss-step').map(s => s.text())).toEqual(LABELS9)
    expect(w.find('.fss-period').text()).toBe('2025-09')
    expect(w.find('.fss-nav').exists(), 'XL 不出窄档那一支').toBe(false)
    expect(w.find('.fss-tail').exists(), 'XL 不出尾标').toBe(false)
  })

  it('M(800):全条横滑 + 尾标 —— 胶囊一颗不删,折行换成滚动', () => {
    mockMatchMedia(800)
    const w = mk(REPORT9, 'income-statement')
    expect(w.find('.fss').classes(), 'M 档挂 fss--m').toContain('fss--m')
    expect(w.findAll('.fss-step').map(s => s.text()), '横滑不删内容').toEqual(LABELS9)
    const tail = w.find('.fss-tail')
    expect(tail.exists(), '尾标钉在滚动区外').toBe(true)
    expect(tail.text()).toBe('1/9')
    expect(w.find('.fss-nav').exists(), 'M 还不收成单颗').toBe(false)
  })

  it('S(390):当前 + n/N + 前后箭头 —— 胶囊条整个换掉', () => {
    mockMatchMedia(390)
    const w = mk(REPORT9, 'income-statement')
    expect(w.find('.fss').classes()).toContain('fss--s')
    const nav = w.find('.fss-nav')
    expect(nav.exists(), 'S 档出窄档那一支').toBe(true)
    expect(w.find('.fss-steps').exists(), 'S 档不再渲染九颗胶囊').toBe(false)
    expect(w.findAll('.fss-step')).toHaveLength(0)
    expect(w.find('.fss-cur-label').text()).toBe('利润表')
    expect(w.find('.fss-nn').text()).toBe('1/9')
    expect(w.find('.fss-prev').exists()).toBe(true)
    expect(w.find('.fss-next').exists()).toBe(true)
  })
})

// ─────────────────────────── S 档:n/N 与期标 ───────────────────────────

describe('§5.9 S 档 n/N 写成字', () => {
  it('九颗:第 1 步与第 5 步读数不同 —— 不靠数胶囊', () => {
    mockMatchMedia(390)
    const first = mk(REPORT9, 'income-statement')
    expect(first.find('.fss-nn').text()).toBe('1/9')
    expect(first.find('.fss-cur-label').text()).toBe('利润表')

    const fifth = mk(REPORT9, 'elec-pnl')
    expect(fifth.find('.fss-nn').text()).toBe('5/9')
    expect(fifth.find('.fss-cur-label').text()).toBe('附表2')

    expect(fifth.find('.fss-nn').text()).not.toBe(first.find('.fss-nn').text())
    expect(fifth.find('.fss-cur-label').text()).not.toBe(first.find('.fss-cur-label').text())
  })

  it('五颗:第 1 步与第 5 步读数不同 —— 分母跟着这组走', () => {
    mockMatchMedia(390)
    const first = mk(CHAIN5, 'params')
    const fifth = mk(CHAIN5, 'bill-notices')
    expect(first.find('.fss-nn').text()).toBe('1/5')
    expect(fifth.find('.fss-nn').text()).toBe('5/5')
    expect(first.find('.fss-cur-label').text()).toBe('计费参数')
    expect(fifth.find('.fss-cur-label').text()).toBe('催缴单')
  })

  it('S 档条上没有期标 —— 标题行里已经写着同一个期(§5.10 判据四)', () => {
    mockMatchMedia(390)
    for (const [steps, cur] of [[REPORT9, 'income-statement'], [CHAIN5, 'params']] as const) {
      const w = mk(steps as Step[], cur, '2025-09')
      expect(w.find('.fss-nav').exists(), '先确认 S 档那一支真的渲染了').toBe(true)
      expect(w.find('.fss-period').exists(), '期标不在条上').toBe(false)
      expect(w.find('.fss').text(), '条上任何位置都不写这个期').not.toContain('2025-09')
    }
  })
})

// ─────────────────────── S 档:首尾箭头变灰不消失 ───────────────────────

describe('§5.9 S 档首尾箭头', () => {
  it('首步:「上一步」在 DOM 里且是灰的,「下一步」不灰', () => {
    mockMatchMedia(390)
    const w = mk(REPORT9, 'income-statement')
    const prev = w.find('.fss-prev')
    expect(prev.exists(), '不渲染会挪版 —— 必须在 DOM 里').toBe(true)
    expect(prev.classes()).toContain('off')
    expect(prev.attributes('disabled')).toBeDefined()
    const next = w.find('.fss-next')
    expect(next.exists()).toBe(true)
    expect(next.classes(), '另一头不许也灰,否则这条断言恒真').not.toContain('off')
    expect(next.attributes('disabled')).toBeUndefined()
  })

  it('末步:「下一步」灰,「上一步」不灰', () => {
    mockMatchMedia(390)
    const w = mk(REPORT9, 'reconciliation')
    expect(w.find('.fss-nn').text(), '确认真落在末步').toBe('9/9')
    const next = w.find('.fss-next')
    expect(next.exists()).toBe(true)
    expect(next.classes()).toContain('off')
    expect(next.attributes('disabled')).toBeDefined()
    const prev = w.find('.fss-prev')
    expect(prev.classes()).not.toContain('off')
    expect(prev.attributes('disabled')).toBeUndefined()
  })

  it('首尾两头的箭头个数恒为 2 —— 位移零,不靠 v-if 抹掉一个', () => {
    mockMatchMedia(390)
    for (const cur of ['params', 'alloc', 'bill-notices']) {
      const w = mk(CHAIN5, cur)
      expect(w.findAll('.fss-arrow'), `current=${cur}`).toHaveLength(2)
    }
  })

  it('点「下一步」走到下一颗;首步点「上一步」不导航', async () => {
    mockMatchMedia(390)
    const w = mk(CHAIN5, 'params')
    await w.find('.fss-prev').trigger('click')
    expect(push, '首步没有上一步').not.toHaveBeenCalled()
    await w.find('.fss-next').trigger('click')
    expect(push).toHaveBeenCalledWith('/meters')
  })
})

// ──────────────────── S 档:点中间那颗 → 全部步骤面板 ────────────────────

describe('§5.9 S 档面板', () => {
  async function openSheet(steps: Step[], current: string) {
    const w = mk(steps, current)
    await w.find('.fss-cur').trigger('click')
    await nextTick()
    return w
  }

  it('九颗:面板里步骤数 = 全部步骤数,顺序与桌面一致', async () => {
    mockMatchMedia(390)
    expect(document.querySelectorAll('.fss-sheet-item'), '开之前没有').toHaveLength(0)
    await openSheet(REPORT9, 'income-statement')
    const items = Array.from(document.querySelectorAll('.fss-sheet-item'))
    expect(items).toHaveLength(9)
    expect(items.map(el => el.querySelector('.fss-sheet-label')!.textContent))
      .toEqual(['利润表', '资产负债表', '科目余额表', '附表1 租金损益', '附表2 电费损益',
                '附表3 水费损益', '附表4 运管损益', '附表5 费用损益', '收入核对'])
    expect(items.filter(el => el.classList.contains('on')).map(el => el.textContent?.trim()))
      .toEqual(['利润表'])
  })

  it('五颗:面板里五条,状态点按 state 上色 —— 条上收掉了,面板里补回来', async () => {
    mockMatchMedia(390)
    await openSheet(CHAIN5, 'alloc')
    const items = Array.from(document.querySelectorAll('.fss-sheet-item'))
    expect(items).toHaveLength(5)
    expect(items.map(el => el.querySelector('.fss-sheet-label')!.textContent)).toEqual(LABELS5)
    const pips = Array.from(document.querySelectorAll('.fss-sheet-item .fss-pip'))
    expect(pips, '每一步都有点位,包括 todo').toHaveLength(5)
    expect(pips[0].classList.contains('done')).toBe(true)
    expect(pips[2].classList.contains('stale')).toBe(true)
    expect(pips[3].classList.contains('todo')).toBe(true)
  })

  it('面板里点一条 → 导航并关闭', async () => {
    mockMatchMedia(390)
    const w = await openSheet(CHAIN5, 'alloc')
    const target = Array.from(document.querySelectorAll('.fss-sheet-item'))
      .find(el => el.textContent?.includes('催缴单')) as HTMLElement
    expect(target, '选到了那一条').toBeTruthy()
    target.click()
    await nextTick()
    expect(push).toHaveBeenCalledWith('/bill-notices')
    expect(document.querySelectorAll('.fss-sheet-item'), '面板关掉').toHaveLength(0)
    expect(w.find('.fss-nav').exists(), '条还在').toBe(true)
  })

  it('宽档不挂这个面板 —— 桌面点胶囊直接走,没有中间一层', async () => {
    mockMatchMedia(1440)
    const w = mk(REPORT9, 'income-statement')
    expect(w.find('.fss-cur').exists()).toBe(false)
    await w.findAll('.fss-step')[1].trigger('click')
    expect(push).toHaveBeenCalledWith('/balance-sheet')
    expect(document.querySelectorAll('.fss-sheet-item')).toHaveLength(0)
  })
})
