/**
 * 首页手机版:「本月出账」入口条 + 搜索框快捷键提示(2026-09-20 响应式 HomePhone 板)。
 *
 * 钉三件事:
 *  1. 入口条在纵序里的**位置**(搜索之后、收藏之前)—— 不是「存在」。位置是稿画的那条,
 *     谁把它挪到收藏下面,这里就红。
 *  2. 整条是**一个**点击目标 —— 右端 › 是图标不是按钮。多一个 button 就是多一个 44 以下的点击靶。
 *  3. 副行的「已完成 N」跟着 chainStepsOf 的 done 数走,是实测数不是写死的。
 *     两份夹具的 done 数必须不同(3 与 1),否则写死也绿。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { mediaBlock } from '@/test-utils/mediaBlock'
import { join } from 'node:path'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import type { ChainCell } from '@/stores/billingPeriod'
import { chainStepsOf } from '@/nav/billingChain'

const r = vi.hoisted(() => ({ value: 'home', push: vi.fn() }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { value: r.value } }),
  useRouter: () => ({ push: r.push }),
}))
vi.mock('@/api', () => ({
  default: { get: vi.fn(() => Promise.resolve([])), post: vi.fn(() => Promise.resolve()), delete: vi.fn(() => Promise.resolve()) },
  readToken: vi.fn(() => 't'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

import HomeView from '../home/HomeView.vue'

const SRC = readFileSync(join(__dirname, '..', 'home', 'HomeView.vue'), 'utf8').replace(/\r\n/g, '\n')

const cell = (p: Partial<ChainCell>): ChainCell =>
  ({ meters: false, pool: false, loss: false, notices: false, stale: false, closed: false, ...p })

/** 抄表 + 池 → 参数/抄表/池 三道 done。 */
const THREE = cell({ meters: true, pool: true })
/** 全没做 → 只有恒 done 的计费参数一道。 */
const ONE = cell({})
/** 一道都没有:计费参数恒 done,只有 stale 时它才变橙 —— 这是 done===0 的唯一走法。
 *  稿逐字「工序没开始就写「未开始」,不写 0」,没有这份夹具那条分支走不到。 */
const ZERO = cell({ stale: true })

/** 装一份夹具:loaded 置真挡住 loadChain 的真实取数,免得回包把 cells 冲掉。 */
function mountWith(cells: [string, ChainCell][]) {
  const period = useBillingPeriodStore()
  period.pick(2026, 9)
  period.loaded = true
  period.cells = new Map(cells)
  return mount(HomeView)
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  r.value = 'home'
  r.push.mockReset()
})

describe('首页手机版入口条', () => {
  it('夹具没退化:两份 ChainCell 的 done 数是 3 与 1', () => {
    const done = (c: ChainCell) => chainStepsOf(c).filter(s => s.state === 'done').length
    expect(done(THREE)).toBe(3)
    expect(done(ONE)).toBe(1)
  })

  it('纵序:品牌 → 搜索 → 入口条 → 收藏 → 最近打开', () => {
    const w = mountWith([['2026-09', THREE]])
    const order = [...w.find('.hm').element.children].map(el => el.className.split(' ')[0])
    expect(order).toEqual(['hm-brand', 'hm-search', 'hm-entry', 'hm-sec'])
    // 有最近打开时它接在收藏后面,入口条仍在搜索与收藏之间
    expect(order.indexOf('hm-entry')).toBe(order.indexOf('hm-search') + 1)
    expect(order.indexOf('hm-entry')).toBeLessThan(order.indexOf('hm-sec'))
  })

  it('整条只有一个可点元素:› 不是 button', async () => {
    const w = mountWith([['2026-09', THREE]])
    const bar = w.find('.hm-entry')
    expect(bar.element.tagName).toBe('BUTTON')
    // 条内部没有第二个 button / a / role=button
    expect(bar.findAll('button, a, [role="button"]').length).toBe(0)
    expect(bar.find('.ec').element.tagName).not.toBe('BUTTON')
    await bar.trigger('click')
    expect(r.push).toHaveBeenCalledWith('/data-home')
  })

  it('副行是实测数:换一份 ChainCell,已完成 N 跟着变', () => {
    expect(mountWith([['2026-09', THREE]]).find('.hm-entry small').text()).toBe('5 道工序 · 已完成 3')
    setActivePinia(createPinia())
    expect(mountWith([['2026-09', ONE]]).find('.hm-entry small').text()).toBe('5 道工序 · 已完成 1')
  })

  it('一道没做:写「未开始」而不是「已完成 0」(稿点名)', () => {
    const sub = mountWith([['2026-09', ZERO]]).find('.hm-entry small').text()
    expect(sub).toBe('5 道工序 · 未开始')
    expect(sub, '「已完成 0」读着像出了错,而它只是还没干').not.toContain('已完成')
  })

  it('主行写「屏名 · 本月」,不是光一个屏名(稿:「本月出账 · 2026-09」)', () => {
    const b = mountWith([['2026-09', THREE]]).find('.hm-entry .et b')
    expect(b.text()).toBe('本月出账 · 2026-09')
    // 加了月份才可能顶到边:主行必须能截,不能把条撑高(整条定高 68)
    const blk = mediaBlock(SRC, '@media (max-width: 600px)')
    expect(blk.match(/\.hm-entry \.et b \{[^}]*\}/)![0]).toMatch(/text-overflow: ellipsis/)
  })

  it('取不到本月的 ChainCell:只写「5 道工序」,不冒充已完成 0', () => {
    const w = mountWith([['2026-08', THREE]])   // 库里只有别的月
    const sub = w.find('.hm-entry small').text()
    expect(sub).toBe('5 道工序')
    expect(sub).not.toContain('已完成')
  })

  it('副行不出定性词', () => {
    const sub = mountWith([['2026-09', THREE]]).find('.hm-entry small').text()
    for (const w of ['顺利', '还差', '即将', '正常', '异常']) expect(sub).not.toContain(w)
  })
})

describe('首页手机版样式门禁', () => {
  it('Ctrl K 提示在触屏藏起来:.hm-kbd 有 hover:none 判据', () => {
    expect(SRC).toMatch(/@media \(hover: none\) \{\s*\.hm-kbd \{ display: none; \}/)
  })

  it('入口条几何:min-height 68 / 圆角 16 / padding 12px 14px / gap 12 / margin-top 20', () => {
    const block = SRC.slice(SRC.indexOf('  .hm-entry {'), SRC.indexOf('.hm-entry .ei'))
    expect(block).toContain('min-height: 68px;')
    expect(block).toContain('border-radius: 16px;')
    expect(block).toContain('padding: 12px 14px;')
    expect(block).toContain('gap: 12px;')
    expect(block).toContain('margin-top: 20px;')
    expect(block).toContain('background: var(--accent-blue);')
  })

  it('入口条只在 S 档出:默认 display:none,展开写在 max-width:600 里(桌面零差异)', () => {
    expect(SRC).toContain('.hm-entry { display: none; }')
    // ⚠ 原写法是 slice 到文件尾 + 两条互不相干的 toContain:第二条命中的可以是同块里
    //   `.hm-entry .et { ... display: flex; }`,于是 `.hm-entry` 在 S 档不再是 flex 行也不红
    //   (2026-09-20 对抗复查实跑验证)。改成按块 + 按规则体取。
    const blk = mediaBlock(SRC, '@media (max-width: 600px)')
    expect(blk.match(/\.hm-entry \{[^}]*\}/)![0]).toMatch(/display: flex;/)
  })

  it('没有第四个断点:本文件的 max-width 只有 600', () => {
    expect([...SRC.matchAll(/max-width:\s*(\d+)px/g)].map(m => m[1])).toEqual(['600'])
  })
})
