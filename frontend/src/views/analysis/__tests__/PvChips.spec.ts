// PvChips 挂载测:芯片四态的底色 / 边 / 徽标、点芯片发 pick、「其余 N 栋」浮层的开关(UI-OVERLAY-SPEC)。
// 分组与排序是 pvAnaV4.logic.ts chipGroups 的事(那边有单测),这里喂一份手写的分组,只看长相与交互。
// 夹具四态俱全:连续低于 / 连续高于 / 读不出 ×2 / 选中(没有连续段)/ 收起的普通栋 / 未投产。
import { describe, it, expect, afterEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import PvChips from '../PvChips.vue'
import type { ChipGroups, ChipItem } from '../pvAnaV4.logic'

const chip = (id: number, name: string, phase: number, kind: ChipItem['kind'], outDays: number, dir: -1 | 1 | null = null, selected = false): ChipItem =>
  ({ id, name, phase, kind, outDays, hasRun: kind === 'hit', dir, selected, clickable: kind !== 'unborn' })

const GROUPS: ChipGroups = {
  shown: [
    chip(4, 'F座', 1, 'hit', 25, -1),
    chip(5, 'G座', 1, 'hit', 5, 1),
    chip(1, 'B座', 1, 'plain', 1, null, true),
    chip(7, '9栋', 2, 'unreadable', 0),
    chip(8, '10栋', 2, 'unreadable', 0),
  ],
  folded: [
    chip(2, 'C、D座', 1, 'plain', 2),
    chip(3, 'E座', 1, 'plain', 1),
    chip(6, '8栋', 2, 'plain', 0),
    chip(11, '创业大厦', 3, 'unborn', 0),
  ],
  unit: '天',
}

const live: VueWrapper[] = []
afterEach(() => { while (live.length) live.pop()!.unmount() })

const mk = (groups = GROUPS) => mount(PvChips, { props: { groups } })
const css = (w: { element: Element }) => (w.element as HTMLElement).style

describe('PvChips', () => {
  it('常显芯片按分组顺序出,徽标 = 出范围天数;读不出的徽标写「读不出」', () => {
    const btns = mk().findAll('.pvc > button.chip')
    expect(btns.map(b => b.text())).toEqual(['F座25 天', 'G座5 天', 'B座1 天', '9栋读不出', '10栋读不出'])
  })

  it('底色:连续低于 = 红 10% 底,连续高于 = 琥珀 10% 底 + 琥珀字,无边;选中 = --control-solid 实底 600', () => {
    const [f, g, b] = mk().findAll('.pvc > button.chip')
    expect([css(f).background, css(f).borderColor]).toEqual(['rgba(226, 75, 74, 0.1)', 'transparent'])
    expect(css(f.find('.bd')).background).toBe('rgba(226, 75, 74, 0.16)')
    expect([css(g).background, css(g).color]).toEqual(['rgba(239, 159, 39, 0.1)', 'rgb(133, 79, 11)'])
    expect(css(g.find('.bd')).background).toBe('rgba(239, 159, 39, 0.2)')
    expect([css(b).background, css(b).fontWeight]).toEqual(['var(--control-solid)', '600'])
    expect(css(f).fontWeight).toBe('500')
  })

  it('读不出:灰虚线边;对照 —— 其余态都是实线边', () => {
    const btns = mk().findAll('.pvc > button.chip')
    expect(btns.map(b => css(b).borderStyle)).toEqual(['solid', 'solid', 'solid', 'dashed', 'dashed'])
    expect(css(btns[3]).borderColor).toBe('var(--border-strong)')
  })

  it('期别点按期别三色;点芯片发 pick(id),读不出的也能点', async () => {
    const w = mk()
    const btns = w.findAll('.pvc > button.chip')
    expect(btns.map(b => css(b.find('.dot')).background)).toEqual(['rgb(55, 138, 221)', 'rgb(55, 138, 221)', 'rgb(55, 138, 221)', 'rgb(93, 202, 165)', 'rgb(93, 202, 165)'])
    await btns[1].trigger('click')
    await btns[3].trigger('click')
    expect(w.emitted('pick')).toEqual([[5], [7]])
  })

  it('❗年档徽标单位跟着 unit 写「个月」(对照:月档写「天」)', () => {
    const btns = mk({ ...GROUPS, unit: '个月' }).findAll('.pvc > button.chip')
    expect(btns.map(b => b.text()).slice(0, 3)).toEqual(['F座25 个月', 'G座5 个月', 'B座1 个月'])
    expect(btns[3].text()).toBe('9栋读不出')
  })

  it('❗常显一行放不下(1366 卡内 951):从末尾起挪进浮层,选中那枚留下;挪出的排在浮层最前', async () => {
    // 12 枚连续段栋(每枚按字估 103 宽 + 间距 6),第 12 枚选中;浮层里原有一枚未投产
    const many: ChipGroups = {
      shown: Array.from({ length: 12 }, (_, i) => chip(20 + i, `${i + 10}栋`, 2, 'hit', 25, -1, i === 11)),
      folded: [chip(11, '创业大厦', 3, 'unborn', 0)],
      unit: '天',
    }
    const w = mount(PvChips, { props: { groups: many }, attachTo: document.body })
    live.push(w)
    // 7 枚 = 6 × 109 + 选中 109 + 「其余 6 栋 ▾」88 = 851 ≤ 951;再多一枚 960 > 951
    expect(w.findAll('.pvc > button.chip').map(b => b.findAll('span')[1].text())).toEqual(['10栋', '11栋', '12栋', '13栋', '14栋', '15栋', '21栋'])
    expect(w.find('button.more').text()).toBe('其余 6 栋 ▾')
    await w.find('button.more').trigger('click')
    expect(w.findAll('.pvc-pop button.chip').map(b => b.findAll('span')[1].text())).toEqual(['16栋', '17栋', '18栋', '19栋', '20栋', '创业大厦'])
    // 触发钮已靠右(7 枚 763 + 280 > 951):浮层右对齐往左展开,不越出右缘
    expect(w.find('.ds-popover-panel').attributes('style')).toContain('right: 0')
  })

  it('❗常显只有一枚时浮层左对齐往右展开 —— 右对齐 280 宽会越出主卡左缘被裁', async () => {
    const one: ChipGroups = { shown: [chip(1, 'B座', 1, 'plain', 1, null, true)], folded: GROUPS.folded, unit: '天' }
    const w = mount(PvChips, { props: { groups: one }, attachTo: document.body })
    live.push(w)
    await w.find('button.more').trigger('click')
    const style = w.find('.ds-popover-panel').attributes('style')
    expect(style).toContain('left: 0')
    expect(style).not.toContain('right: 0')
  })

  it('「其余 N 栋 ▾」数的是收起的栋;没有可收的就不出这个按钮', () => {
    expect(mk().find('button.more').text()).toBe('其余 4 栋 ▾')
    expect(mk({ ...GROUPS, folded: [] }).find('button.more').exists()).toBe(false)
  })

  it('点开浮层列出收起的栋;点其中一栋 = 发 pick 并关浮层;未投产灰字禁用、点了不发', async () => {
    const w = mount(PvChips, { props: { groups: GROUPS }, attachTo: document.body })
    live.push(w)
    expect(w.find('.ds-popover-panel').exists()).toBe(false)
    await w.find('button.more').trigger('click')
    const panel = w.find('.ds-popover-panel')
    expect(panel.findAll('button.chip').map(b => b.text())).toEqual(['C、D座2 天', 'E座1 天', '8栋', '创业大厦'])
    const unborn = panel.findAll('button.chip')[3]
    expect([unborn.attributes('disabled'), css(unborn).color, css(unborn).fontWeight]).toEqual(['', 'var(--text-disabled)', '400'])
    await unborn.trigger('click')
    expect(w.emitted('pick')).toBeUndefined()
    await panel.findAll('button.chip')[1].trigger('click')
    expect(w.emitted('pick')).toEqual([[3]])
    expect(w.find('.ds-popover-panel').exists()).toBe(false)
  })

  it('浮层层级走 --z-popover', async () => {
    const w = mount(PvChips, { props: { groups: GROUPS }, attachTo: document.body })
    live.push(w)
    await w.find('button.more').trigger('click')
    expect(w.find('.ds-popover-panel').attributes('style')).toContain('z-index: var(--z-popover)')
  })

  it('点外面就关 —— 宿主容器 @mousedown.stop 也挡不住(capture 阶段);对照:点浮层里面不关', async () => {
    const Host = defineComponent({
      setup: () => () => h('div', { onMousedown: (e: Event) => e.stopPropagation() }, [
        h(PvChips, { groups: GROUPS }), h('span', { class: 'outside' }, '别处'),
      ]),
    })
    const w = mount(Host, { attachTo: document.body })
    live.push(w)
    await w.find('button.more').trigger('click')
    await nextTick()
    w.find('.pvc-pop').element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(w.find('.ds-popover-panel').exists(), '点浮层里面').toBe(true)
    w.find('.outside').element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(w.find('.ds-popover-panel').exists(), '点外面').toBe(false)
  })

  it('Esc 只关浮层,不冒到 window(宿主抽屉听 window keydown);对照:别的键照常冒上去', async () => {
    const w = mount(PvChips, { props: { groups: GROUPS }, attachTo: document.body })
    live.push(w)
    const got: string[] = []
    const onWin = (e: KeyboardEvent) => got.push(e.key)
    window.addEventListener('keydown', onWin)
    try {
      await w.find('button.more').trigger('click')
      await nextTick()
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
      await nextTick()
      expect(w.find('.ds-popover-panel').exists()).toBe(true)
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await nextTick()
      expect(w.find('.ds-popover-panel').exists()).toBe(false)
      expect(got).toEqual(['a'])
    } finally {
      window.removeEventListener('keydown', onWin)
    }
  })
})
