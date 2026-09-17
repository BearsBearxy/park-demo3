// PvAlphaBars 挂载测:L1 α 排序条 + L5 脚注一行。钉的是渲染出来的像素位置、色与文字,不钉中间对象。
// 夹具:5 栋三期别、有正有负、一栋区间跨 0、一栋没进排序、一栋因台账被踢;宽 = useWidth 在 jsdom 的初值 496。
import { afterEach, describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PvAlphaBars from '../PvAlphaBars.vue'
import type { AlphaBars, PolishStability } from '../pvAnaV4.logic'

const DATA: AlphaBars = {
  rows: [
    { id: 8, name: '8栋', phase: 2, alphaPct: 12.2, ciLo: 5.2, ciHi: 19.2, rank: 1, crossesZero: false },
    { id: 5, name: 'E座', phase: 1, alphaPct: 11.0, ciLo: 8.5, ciHi: 13.5, rank: 2, crossesZero: false },
    { id: 9, name: '9栋', phase: 2, alphaPct: 3.1, ciLo: -2.0, ciHi: 8.4, rank: 3, crossesZero: true },
    { id: 12, name: '12栋', phase: 2, alphaPct: -8.8, ciLo: -12.4, ciHi: -5.2, rank: 4, crossesZero: false },
    { id: 6, name: 'F座', phase: 1, alphaPct: -38.0, ciLo: -41.6, ciHi: -34.4, rank: 5, crossesZero: false },
  ],
  rest: [{ id: 20, name: '创业大厦', phase: 3 }],
  short: [{ id: 21, name: '工业大厦', phase: 3, days: 31 }],
  excluded: ['13栋'],
}
const STAB: PolishStability = {
  n: 5, sameN: 3,
  moved: [{ name: '9栋', from: 3, to: 5 }, { name: '12栋', from: 4, to: 2 }],
  sameShift: 2,
}

const mountIt = (over: Partial<{ data: AlphaBars; stability: PolishStability; selId: number | null }> = {}) =>
  mount(PvAlphaBars, { props: { data: DATA, stability: STAB, selId: 6, ...over } })

const px = (s: string | undefined, prop: string) => {
  const m = new RegExp(`${prop}:\\s*(-?[\\d.]+)px`).exec(s ?? '')
  return m ? Number(m[1]) : NaN
}
const row = (w: ReturnType<typeof mountIt>, id: number) => w.find(`.pab-row[data-id="${id}"]`)

describe('PvAlphaBars · L1 条的几何', () => {
  // 横轴端点:区间最小 −41.6 → floor((−43.6)/10)·10 = −50;最大 19.2 → ceil(21.2/10)·10 = 30
  // AX(v) = 66 + (v + 50) / 80 × (496 − 10 − 66),取 1 位小数
  it('❗正值条从 0 线往右画到 α,淡带 = 区间两端,数值标在带右 6px', () => {
    const r = row(mountIt(), 8)
    const bar = r.find('.pab-bar').attributes('style')
    expect(px(bar, 'left')).toBe(328.5)          // 0 线
    expect(px(bar, 'width')).toBe(64.1)          // AX(12.2) = 392.6
    // 画面上的条 / 淡带是裁出来的 [--x, --x + --w](换期过渡裁剪);按钮是透明点击框,left / width 与条一致
    expect([px(r.find('.pab-fill').attributes('style'), '--x'), px(r.find('.pab-fill').attributes('style'), '--w')]).toEqual([328.5, 64.1])
    const band = r.find('.pab-band').attributes('style')
    expect(px(band, '--x')).toBe(355.8)         // AX(5.2)
    expect(px(band, '--w')).toBe(73.5)         // AX(19.2) − AX(5.2)
    const val = r.find('.pab-val')
    expect(px(val.attributes('style'), '--x')).toBe(435.3)
    expect(val.text()).toBe('+12.2%')
    expect(val.classes()).not.toContain('neg')
  })

  it('❗负值条从 α 画到 0 线,数值标在带左 6px 并整体左移(右对齐)', () => {
    const r = row(mountIt(), 6)
    const bar = r.find('.pab-bar').attributes('style')
    expect(px(bar, 'left')).toBe(129)            // AX(−38)
    expect(px(bar, 'width')).toBe(199.5)         // 328.5 − 129
    expect([px(r.find('.pab-fill').attributes('style'), '--x'), px(r.find('.pab-fill').attributes('style'), '--w')]).toEqual([129, 199.5])
    const band = r.find('.pab-band').attributes('style')
    expect(px(band, '--x')).toBe(110.1)
    expect(px(band, '--w')).toBe(37.8)
    const val = r.find('.pab-val')
    expect(px(val.attributes('style'), '--x')).toBe(104.1)
    expect(val.text()).toBe('−38.0%')
    expect(val.classes()).toContain('neg')
  })

  it('竖网格每 10% 一条,从 −50% 到 +30%;0 线单独一条墨阶', () => {
    const w = mountIt()
    const labels = w.findAll('.pab-tick').map(t => t.text())
    expect(labels).toEqual(['-50%', '-40%', '-30%', '-20%', '-10%', '0%', '+10%', '+20%', '+30%'])
    expect(px(w.findAll('.pab-tick')[0].attributes('style'), 'left')).toBe(66)
    expect(px(w.findAll('.pab-tick')[8].attributes('style'), 'left')).toBe(486)
    const zero = w.find('.pab-zero').attributes('style')
    expect(px(zero, 'left')).toBe(328.5)
    expect(zero).toContain('rgba(28, 28, 28, 0.35)')
  })

  it('画布高 = 行数 × 22 + 14(含没进排序的与在网不足的那两行)', () => {
    expect(px(mountIt().find('.pab-plot').attributes('style'), 'height')).toBe(7 * 22 + 14)
  })
})

describe('PvAlphaBars · 色与选中', () => {
  it('❗条按期别三色;选中栋 1.5px 墨描边 + 栋名加粗,其余没有', () => {
    const w = mountIt()
    expect(row(w, 8).find('.pab-fill').attributes('style')).toContain('background: rgb(93, 202, 165)')  // 二期
    expect(row(w, 5).find('.pab-fill').attributes('style')).toContain('background: rgb(55, 138, 221)')  // 一期
    // 选中描边 = 条后面大一圈的墨块(CSS 在 .pab-ring),与条同一对 --x / --w
    const ring = row(w, 6).find('.pab-ring').attributes('style')
    expect([px(ring, '--x'), px(ring, '--w')]).toEqual([129, 199.5])
    expect(row(w, 6).find('.pab-name').classes()).toContain('on')
    expect(row(w, 8).find('.pab-ring').exists()).toBe(false)
    expect(row(w, 8).find('.pab-name').classes()).not.toContain('on')
  })

  it('没进排序的栋占行写字、不画条', () => {
    const r = row(mountIt(), 20)
    expect(r.find('.pab-name').text()).toBe('创业大厦')
    expect(r.find('.pab-bar').exists()).toBe(false)
    expect(r.find('.pab-band').exists()).toBe(false)
    expect(r.find('.pab-val').text()).toBe('无 α')
    expect(px(r.find('.pab-val').attributes('style'), 'left')).toBe(72)
  })

  it('点条 = pick 这一栋', async () => {
    const w = mountIt()
    await row(w, 12).find('.pab-bar').trigger('click')
    expect(w.emitted('pick')).toEqual([[12]])
  })
})

describe('PvAlphaBars · 读数句与脚注', () => {
  // C5-11:「不出句」现在是**句空而不是节点没了** —— 节点常驻占一行,卡高不再 ±1 行。
  it('读数句跟选中栋走;区间不跨 0 / 跨 0 两种写法;选中栋不在排序里句子空但占位还在', () => {
    expect(mountIt().find('.ana-read').text()).toBe('F座 α −38.0%，5 栋里第 5 位（1 = 最高）；区间 −41.6% ~ −34.4%，不跨 0')
    expect(mountIt({ selId: 9 }).find('.ana-read').text()).toBe('9栋 α +3.1%，5 栋里第 3 位（1 = 最高）；区间 −2.0% ~ +8.4%，跨 0')
    const gone = mountIt({ selId: 20 }).find('.ana-read')
    expect(gone.text()).toBe('')
    expect(gone.classes(), '空着也要占住那一行').toContain('hold')
  })

  it('❗L5 一句按名次挪动写:各挪 k 位 / 只一栋挪 / 挪的位数不一样 / 都没变', () => {
    const tx = (s: Partial<PolishStability>) => mountIt({ stability: { ...STAB, ...s } }).find('.pab-stab .tx').text()
    expect(tx({})).toBe('这份排名换一种算法顺序重算了一遍：5 栋里 3 栋名次没变，2 栋各挪了 2 位（9栋 3→5 · 12栋 4→2）。')
    expect(tx({ sameN: 4, moved: [{ name: '9栋', from: 3, to: 4 }], sameShift: 1 }))
      .toBe('这份排名换一种算法顺序重算了一遍：5 栋里 4 栋名次没变，1 栋挪了 1 位（9栋 3→4）。')
    expect(tx({ moved: [{ name: '9栋', from: 3, to: 4 }, { name: '12栋', from: 4, to: 1 }], sameShift: null }))
      .toBe('这份排名换一种算法顺序重算了一遍：5 栋里 3 栋名次没变，2 栋挪了位（9栋 3→4 · 12栋 4→1）。')
    expect(tx({ sameN: 5, moved: [], sameShift: null })).toBe('这份排名换一种算法顺序重算了一遍：5 栋名次都没变。')
  })

  it('❗参照系:95% 区间的大白话 + 被踢出的名单;不写「块自助」「90%」', () => {
    const w = mountIt()
    const ref = w.find('.ana-ref').text()
    expect(ref).toBe('n = 5 栋 · 全年逐日残差 · 相对全园中位，% · 淡带 = 这栋水平大概落在哪一段（95% 区间） · 台账差超线不进排序：13栋')
    expect(w.find('.hint').text()).toContain('淡带 = 95% 区间')
    expect(w.text()).not.toMatch(/块自助|90%/)
    expect(mountIt({ data: { ...DATA, excluded: [] } }).find('.ana-ref').text()).not.toContain('台账差')
  })
})

describe('PvAlphaBars · 刻度、标签避让、在网不足、对数轴', () => {
  it('❗在网不足 90 天的栋占行写天数,不画条也不进名次', () => {
    const w = mountIt()
    const r = row(w, 21)
    expect(r.find('.pab-bar').exists()).toBe(false)
    expect(r.find('.pab-val').text()).toBe('在网 31 天，不排')
    expect(w.find('.ana-read').text()).toContain('5 栋里第 5 位')
  })

  it('❗跨度大时刻度按 1/2/5 步长取,不再每 10% 一条:−45…+60 → 步长 20,8 条、相邻 ≥ 40px', () => {
    const wide: AlphaBars = { ...DATA, rows: [
      { id: 1, name: '甲', phase: 1, alphaPct: 55, ciLo: 50, ciHi: 60, rank: 1, crossesZero: false },
      { id: 2, name: '乙', phase: 2, alphaPct: -40, ciLo: -45, ciHi: -35, rank: 2, crossesZero: false },
    ] }
    const w = mountIt({ data: wide, selId: 1 })
    const labels = w.findAll('.pab-tick').map(t => t.text())
    expect(labels).toEqual(['-60%', '-40%', '-20%', '0%', '+20%', '+40%', '+60%', '+80%'])
    const xs = w.findAll('.pab-tick').map(t => px(t.attributes('style'), 'left'))
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(40)
    expect(w.find('.pab-leg').text()).not.toContain('对数刻度')
  })

  it('❗跨度超过 3 倍改对数轴:0→+100% 与 −50%→0 等宽,图例写对数刻度', () => {
    const huge: AlphaBars = { ...DATA, rows: [
      { id: 1, name: '甲', phase: 3, alphaPct: 700, ciLo: 650, ciHi: 760, rank: 1, crossesZero: false },
      { id: 2, name: '乙', phase: 2, alphaPct: 2, ciLo: -1, ciHi: 5, rank: 2, crossesZero: true },
      { id: 3, name: '丙', phase: 1, alphaPct: -36, ciLo: -45, ciHi: -25, rank: 3, crossesZero: false },
    ] }
    const w = mountIt({ data: huge, selId: 1 })
    const tick = (label: string) => px(w.findAll('.pab-tick').find(t => t.text() === label)!.attributes('style'), 'left')
    const d1 = tick('+100%') - tick('0%')
    const d2 = tick('0%') - tick('-50%')
    expect(Math.abs(d1 - d2)).toBeLessThan(0.3)
    // 右端 = 8.6 × 1.1 = 9.46 倍,×10 那条出界
    expect(w.findAll('.pab-tick').map(t => t.text())).toEqual(['-50%', '0%', '+100%', '+400%'])
    expect(w.find('.pab-leg').text()).toContain('对数刻度')
  })

  it('❗负值标签会压进栋名列时挪到 0 线右侧、左对齐', () => {
    const tight: AlphaBars = { ...DATA, rows: [
      { id: 1, name: '甲', phase: 2, alphaPct: 10, ciLo: 8, ciHi: 12, rank: 1, crossesZero: false },
      { id: 2, name: '乙', phase: 1, alphaPct: -46, ciLo: -48, ciHi: -44, rank: 2, crossesZero: false },
    ] }
    const w = mountIt({ data: tight, selId: 1 })
    const zero = px(w.find('.pab-zero').attributes('style'), 'left')
    const val = row(w, 2).find('.pab-val')
    expect(val.classes()).not.toContain('neg')
    expect(px(val.attributes('style'), '--x')).toBe(+(zero + 6).toFixed(1))
    // 对照:同一栋放在有地方的位置(甲)时标签照常在带右侧
    expect(px(row(w, 1).find('.pab-val').attributes('style'), '--x')).toBeGreaterThan(zero + 6)
  })
})

// 2026-09-16 行为矩阵:只经段控进来的 DOM 条 —— 挂载时视口内擦入 320;换期不重挂,条走 clip-path(--x / --w)200 形变,
// 名次变了整行 translateY 滑过去;宽度 / left 不过渡(CSS 在 scoped 里,jsdom 不算样式 → 钉类、变量与元素身份)
describe('PvAlphaBars · 动效', () => {
  const inView = () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 0, bottom: 300, left: 0, right: 496, width: 496, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  }
  afterEach(() => { vi.restoreAllMocks() })
  const ty = (s: string | undefined) => Number(/translateY\((-?[\d.]+)px\)/.exec(s ?? '')?.[1])

  it('❗切子屏挂上来、在视口内:行容器 first + hold;animationcancel / animationend 都摘;离屏不擦', async () => {
    inView()
    const w = mountIt()
    await nextTick()
    expect(w.find('.pab-rows').classes()).toEqual(['pab-rows', 'first', 'hold'])
    await w.find('.pab-rows').trigger('animationcancel')
    expect(w.find('.pab-rows').classes()).toEqual(['pab-rows'])
    const w2 = mountIt()
    await nextTick()
    await w2.find('.pab-rows').trigger('animationend')
    expect(w2.find('.pab-rows').classes()).toEqual(['pab-rows'])
    vi.restoreAllMocks()
    const off = mountIt()
    await nextTick()
    expect(off.find('.pab-rows').classes()).toEqual(['pab-rows'])
  })

  it('❗行按名次 translateY(22 一行),没进排序的两行接在后面', () => {
    const w = mountIt()
    expect([8, 5, 9, 12, 6, 21, 20].map(id => ty(row(w, id).attributes('style')))).toEqual([0, 22, 44, 66, 88, 110, 132])
  })

  it('❗换期名次变了不挪 DOM:同一栋的行 / 条还是同一个元素、DOM 顺序不动;translateY 换到新名次,--x / --w 换成新值', async () => {
    const w = mountIt()
    const r6 = row(w, 6).element
    const fill = row(w, 6).find('.pab-fill').element
    const rows = [...DATA.rows]
    rows.unshift({ ...rows.splice(4, 1)[0], alphaPct: 20, ciLo: 15, ciHi: 25, rank: 1 })
    await w.setProps({ data: { ...DATA, rows } })
    expect(row(w, 6).element).toBe(r6)
    expect(row(w, 6).find('.pab-fill').element).toBe(fill)
    expect(w.findAll('.pab-row').map(r => Number(r.attributes('data-id')))).toEqual([8, 5, 9, 12, 6, 21, 20])
    expect([ty(row(w, 6).attributes('style')), ty(row(w, 8).attributes('style'))]).toEqual([0, 22])
    const s = row(w, 6).find('.pab-fill').attributes('style')
    expect(px(s, '--w')).toBeGreaterThan(0)
    expect(px(s, '--x')).not.toBe(129)
  })
})
