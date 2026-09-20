// PvQualityGrid 挂载测:L6 数据质量日历 + 缺抄榜。钉四态各自的图元(底色 / 划痕 / 虚线框)与格坐标、格内两行字、
// 悬停描边与气泡位置(含翻边)、缺抄榜的行序 / 零基条宽 / 行尾字、年档小格。
// 夹具 2025 年 8 月(8/1 是周五):全齐(前两天 10 栋、之后 11 栋)、缺 1 栋、缺 2 栋、整日剔除、还没到 五种格都有。
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PvQualityGrid from '../PvQualityGrid.vue'
import { resolvedTheme } from '@/stores/appearance'
import type { CalCell, CalKind, QualityCalendar } from '../pvAnaV4.logic'

const DAY = 86400000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

/** 从 start 起 n 天;第一天是周几由日期本身定,格位与 logic 同算法(周一开头) */
function calendar(start: string, n: number, kindOf: (date: string) => Partial<CalCell> & { kind: CalKind }): CalCell[] {
  const t0 = Date.parse(`${start}T00:00:00Z`)
  const dow0 = (new Date(t0).getUTCDay() + 6) % 7
  return Array.from({ length: n }, (_, i) => {
    const date = iso(t0 + i * DAY)
    const k = kindOf(date)
    return {
      date, day: Number(date.slice(8, 10)), col: Math.floor((i + dow0) / 7), row: (i + dow0) % 7,
      missNames: [], bornN: k.kind === 'todo' ? 0 : 11, readN: k.kind === 'todo' ? 0 : 11, ...k,
    }
  })
}

const AUG = calendar('2025-08-01', 31, date => {
  const d = Number(date.slice(8, 10))
  if (d <= 2) return { kind: 'full', bornN: 10, readN: 10 }
  if (d === 6) return { kind: 'miss', missNames: ['C座'], readN: 10 }
  if (d === 12) return { kind: 'drop', readN: 2 }
  if (d === 19) return { kind: 'miss', missNames: ['E座', 'G座'], readN: 9 }
  if (d === 20 || d === 21) return { kind: 'miss', missNames: ['E座'], readN: 10 }
  if (d >= 29) return { kind: 'todo' }
  return { kind: 'full' }
})
const MONTH: QualityCalendar = {
  cells: AUG, weeks: 5,
  missRows: [
    { id: 5, name: 'E座', phase: 1, kind: 'counted', missDays: 3 },
    { id: 3, name: 'C座', phase: 1, kind: 'counted', missDays: 1 },
    { id: 7, name: 'G座', phase: 1, kind: 'counted', missDays: 1 },
    { id: 8, name: '8栋', phase: 2, kind: 'counted', missDays: 0 },
    { id: 21, name: '工业大厦', phase: 3, kind: 'noModel', missDays: null },
    { id: 20, name: '创业大厦', phase: 3, kind: 'unborn', missDays: null },
  ],
  maxMiss: 3,
}

const mountIt = (data = MONTH, extra: { minStations?: number; tooFewStations?: boolean } = {}) =>
  mount(PvQualityGrid, { props: { data, ...extra } })
const g = (w: ReturnType<typeof mountIt>, date: string) => w.find(`g.pqg-cell[data-date="${date}"]`)
const px = (s: string | undefined, prop: string) => Number(new RegExp(`${prop}:\\s*(-?[\\d.]+)px`).exec(s ?? '')?.[1])

afterEach(() => { delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth })

describe('PvQualityGrid · 日历四态', () => {
  it('❗全齐:格 x = 28 + 列 × 63、y = 18 + 行 × 68,59×64 圆角 5,蓝 16%;格内只写日期,不写「N 栋全齐」', () => {
    const c = g(mountIt(), '2025-08-01')           // 周五 = 第 0 列第 4 行
    const bg = c.find('rect.pqg-bg')
    expect([bg.attributes('x'), bg.attributes('y'), bg.attributes('width'), bg.attributes('height'), bg.attributes('rx')])
      .toEqual(['28', '290', '59', '64', '5'])
    // 透明度并进 fill(换期底色过渡不闪),不另写 fill-opacity
    expect(bg.attributes('fill')).toBe('rgba(55,138,221,0.16)')
    expect(bg.attributes('fill-opacity')).toBeUndefined()
    expect(c.find('text.pqg-day').text()).toBe('1')
    expect([c.find('text.pqg-day').attributes('x'), c.find('text.pqg-day').attributes('y')]).toEqual(['36', '308'])
    expect(c.find('text.pqg-sub').exists()).toBe(false)
    expect(g(mountIt(), '2025-08-04').find('text.pqg-sub').exists()).toBe(false)
    expect(c.find('rect.pqg-hatchbox').exists()).toBe(false)
  })

  it('❗缺抄:琥珀 30% + 日期与「缺 N 栋」走琥珀深字', () => {
    const c = g(mountIt(), '2025-08-19')           // 周二 = 第 3 列第 1 行
    const bg = c.find('rect.pqg-bg')
    expect([bg.attributes('x'), bg.attributes('y')]).toEqual(['217', '86'])
    expect(bg.attributes('fill')).toBe('rgba(239,159,39,0.3)')
    expect(bg.attributes('fill-opacity')).toBeUndefined()
    expect(c.find('text.pqg-sub').text()).toBe('缺 2 栋')
    expect(c.find('text.pqg-day').attributes('style')).toContain('fill: #854F0B')
    expect(c.find('text.pqg-day').classes()).toContain('miss')
    expect(g(mountIt(), '2025-08-06').find('text.pqg-sub').text()).toBe('缺 1 栋')
  })

  it('❗整日剔除:墨 10% 底 + 同位置 45° 划痕层 + 「整日剔除」;全齐 / 缺抄格没有划痕', () => {
    const w = mountIt()
    const c = g(w, '2025-08-12')                   // 周二 = 第 2 列第 1 行
    const [bg, hatch] = [c.find('rect.pqg-bg'), c.find('rect.pqg-hatchbox')]
    expect([bg.attributes('x'), bg.attributes('y')]).toEqual(['154', '86'])
    expect(bg.attributes('fill')).toBe('rgba(28,28,28,.10)')
    expect([hatch.attributes('x'), hatch.attributes('y'), hatch.attributes('width'), hatch.attributes('height')]).toEqual(['154', '86', '59', '64'])
    const patId = w.find('pattern').attributes('id')
    expect(hatch.attributes('fill')).toBe(`url(#${patId})`)
    expect(w.find('pattern').attributes('patternTransform')).toBe('rotate(45)')
    expect(c.find('text.pqg-sub').text()).toBe('整日剔除')
    expect(w.findAll('rect.pqg-hatchbox')).toHaveLength(1)
  })

  it('❗切外观不用重挂载:整日剔除格的墨色跟着换(页签在 KeepAlive 里常驻)', async () => {
    const w = mountIt()
    const bg = () => g(w, '2025-08-12').find('rect.pqg-bg').attributes('fill')
    expect(bg()).toBe('rgba(28,28,28,.10)')
    resolvedTheme.value = 'dark'
    try {
      await nextTick()
      expect(bg(), '切成深色后格子还是浅色外观的墨色').toBe('rgba(236,236,238,.10)')
    } finally { resolvedTheme.value = 'light' }
  })

  it('❗还没到:透明底 + 墨 10% 虚线框,不写第二行字;没有底色', () => {
    const c = g(mountIt(), '2025-08-29')           // 周五 = 第 4 列第 4 行
    const bg = c.find('rect.pqg-bg')
    expect([bg.attributes('x'), bg.attributes('y')]).toEqual(['280', '290'])
    expect(bg.attributes('fill')).toBe('transparent')
    expect(bg.attributes('stroke')).toBe('rgba(28,28,28,.10)')
    expect(bg.attributes('stroke-dasharray')).toBe('3 3')
    expect(c.find('text.pqg-sub').exists()).toBe(false)
    expect(c.find('text.pqg-day').text()).toBe('29')
    // 对照:有数的格没有虚线
    expect(g(mountIt(), '2025-08-28').find('rect.pqg-bg').attributes('stroke-dasharray')).toBeUndefined()
  })

  it('画布 = 28 + 5 列 × 63 − 4 宽、18 + 7 行 × 68 − 4 高;列头「第 N 周」居中、行头周一到周日', () => {
    const w = mountIt()
    expect(w.find('svg.pqg-svg').attributes('width')).toBe('339')
    expect(w.find('svg.pqg-svg').attributes('height')).toBe('490')
    const ch = w.findAll('text.pqg-colh')
    expect(ch.map(t => t.text())).toEqual(['第 1 周', '第 2 周', '第 3 周', '第 4 周', '第 5 周'])
    expect(ch.map(t => t.attributes('x'))).toEqual(['57.5', '120.5', '183.5', '246.5', '309.5'])
    const rh = w.findAll('text.pqg-rowh')
    expect(rh.map(t => t.text())).toEqual(['一', '二', '三', '四', '五', '六', '日'])
    expect(rh.map(t => t.attributes('y'))).toEqual(['54', '122', '190', '258', '326', '394', '462'])
  })
})

describe('PvQualityGrid · 悬停', () => {
  it('❗悬停缺抄格:墨 2px 内描边 + 两行气泡,放在格右 8px、格顶上 8px', async () => {
    const w = mountIt()
    await g(w, '2025-08-19').find('rect.pqg-hit').trigger('mouseenter')
    const ring = g(w, '2025-08-19').find('rect.pqg-ring')
    expect([ring.attributes('x'), ring.attributes('y'), ring.attributes('width'), ring.attributes('height')]).toEqual(['218', '87', '57', '62'])
    expect(w.findAll('rect.pqg-ring')).toHaveLength(1)
    const tip = w.find('.cz-tip')
    expect(tip.findAll('span').map(s => s.text())).toEqual(['8 月 19 日', '缺抄 2 栋 · E座、G座'])
    expect(px(tip.attributes('style'), 'left')).toBe(217 + 59 + 8)
    expect(px(tip.attributes('style'), 'top')).toBe(86 - 8)
  })

  it('❗整日剔除的气泡写当天抄了几栋(取 readN,不从格子里数);全齐格写 N 栋都抄齐了', async () => {
    const w = mountIt()
    await g(w, '2025-08-12').find('rect.pqg-hit').trigger('mouseenter')
    expect(w.find('.cz-tip').findAll('span').map(s => s.text())).toEqual(['8 月 12 日', '整日剔除 · 全园当天读数不进判定', '当天抄了 2 栋'])
    await g(w, '2025-08-04').find('rect.pqg-hit').trigger('mouseenter')
    expect(w.find('.cz-tip').findAll('span').map(s => s.text())).toEqual(['8 月 4 日', '11 栋都抄齐了'])
  })

  // 430 而不是 400:< 420 是窄容器档(格 44×48),那儿的翻边坐标是另一套;这条钉的是桌面档
  it('❗卡内宽不够时气泡翻到格左 8px(宽 430:第 5 列格右放是 347 + 86 > 430)', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 430 })
    const w = mountIt()
    await g(w, '2025-08-31').find('rect.pqg-hit').trigger('mouseenter')
    const tip = w.find('.cz-tip')
    expect(tip.findAll('span').map(s => s.text())).toEqual(['8 月 31 日', '还没到'])
    // 气泡宽 =「8 月 31 日」2 × 12 + 6 × 6.6 = 63.6 → 64 + 22 = 86;280 − 8 − 86 = 186
    expect(px(tip.attributes('style'), 'left')).toBe(186)
    expect(px(tip.attributes('style'), 'top')).toBe(426 - 8)
  })

  it('移出日历 + 榜那一块就收起描边与气泡', async () => {
    const w = mountIt()
    await g(w, '2025-08-06').find('rect.pqg-hit').trigger('mouseenter')
    expect(w.find('.cz-tip').exists()).toBe(true)
    await w.find('.pqg-body').trigger('mouseleave')
    expect(w.find('.cz-tip').exists()).toBe(false)
    expect(w.findAll('rect.pqg-ring')).toHaveLength(0)
  })
})

describe('PvQualityGrid · 缺抄榜与图例', () => {
  it('❗已装表的栋全列,行序照传入;琥珀零基条宽 = 缺抄天数 ÷ 最多那栋', () => {
    const w = mountIt()
    const rows = w.findAll('.pqg-mrow')
    expect(rows.map(r => r.find('.n').text())).toEqual(['E座', 'C座', 'G座', '8栋', '工业大厦', '创业大厦'])
    expect(w.find('.pqg-rank-h').text()).toBe('这一段谁漏抄了6 栋全列')
    const barOf = (id: number) => w.find(`.pqg-mrow[data-id="${id}"] .bar i`)
    expect(barOf(5).attributes('style')).toContain('width: 100%')
    expect(px(barOf(3).attributes('style')?.replace('%', 'px'), 'width')).toBeCloseTo(100 / 3, 3)
    expect(barOf(8).attributes('style')).toContain('width: 0%')
    expect(barOf(5).attributes('style')).toContain('background: rgb(239, 159, 39)')
  })

  it('❗行尾:有缺抄琥珀深字、缺 0 天墨灰;没进模型「未录装机」、未投产「未投产」,两者都不画条', () => {
    const w = mountIt()
    const v = (id: number) => w.find(`.pqg-mrow[data-id="${id}"] .v`)
    expect(v(5).text()).toBe('缺 3 天')
    expect(v(5).attributes('style')).toContain('color: rgb(133, 79, 11)')
    expect(v(8).text()).toBe('缺 0 天')
    expect(v(8).attributes('style')).toBeUndefined()
    expect(v(21).text()).toBe('未录装机')
    expect(v(20).text()).toBe('未投产')
    for (const id of [20, 21]) expect(w.find(`.pqg-mrow[data-id="${id}"] .bar i`).exists()).toBe(false)
    expect(w.find('.pqg-mrow[data-id="20"]').classes()).toContain('unborn')
  })

  it('图例写全齐栋数与期间;在网不足时的那句只在 tooFewStations 时出现', () => {
    const w = mountIt()
    const leg = w.find('.pqg-leg').text()
    expect(leg).toContain('11 栋全抄了')
    expect(leg).toContain('有栋没抄')
    expect(leg).toContain('整日剔除')
    expect(leg).toContain('还没到')
    expect(w.find('.pqg-leg .per').text()).toBe('2025 年 8 月')
    // C5-11:这句常驻占一行,不过线时空着 —— 换期翻转不再把下方 L7 表推上推下
    expect(w.find('.ana-ref').text()).toBe('')
    expect(w.find('.ana-ref').classes()).toContain('hold')
    expect(mountIt(MONTH, { minStations: 3, tooFewStations: true }).find('.ana-ref').text()).toContain('全园在网不足 3 栋')
  })
})

describe('PvQualityGrid · 年档小格', () => {
  // 2025-01-01 是周三;1/1–3/31 共 90 天 → 14 列,超过 6 列走小格
  const Q1 = calendar('2025-01-01', 90, date =>
    date === '2025-02-10' ? { kind: 'miss', missNames: ['E座'] } : date >= '2025-03-30' ? { kind: 'todo' } : { kind: 'full' })
  const YEAR: QualityCalendar = { ...MONTH, cells: Q1, weeks: 14 }

  it('❗格 12×12 gap 2、不写字;列头按月标在含 1 号的那一列;还没到只留底边一条线', () => {
    const w = mountIt(YEAR)
    const jan1 = g(w, '2025-01-01').find('rect.pqg-bg')
    expect([jan1.attributes('x'), jan1.attributes('y'), jan1.attributes('width'), jan1.attributes('height'), jan1.attributes('rx')])
      .toEqual(['28', '46', '12', '12', '2'])           // 周三 = 第 2 行:18 + 2 × 14
    expect(w.findAll('text.pqg-day')).toHaveLength(0)
    const ch = w.findAll('text.pqg-colh')
    expect(ch.map(t => t.text())).toEqual(['1月', '2月', '3月'])
    expect(ch.map(t => t.attributes('x'))).toEqual(['28', '84', '140'])
    const mar31 = g(w, '2025-03-31')                     // 第 13 列第 0 行
    // 底色 rect 照样在(换期复用),透明、无框
    const mbg = mar31.find('rect.pqg-bg')
    expect([mbg.attributes('fill'), mbg.attributes('stroke'), mbg.classes('pqg-todo')]).toEqual(['transparent', undefined, false])
    const edge = mar31.find('line.pqg-todo-edge')
    expect([edge.attributes('x1'), edge.attributes('x2'), edge.attributes('y1')]).toEqual(['210', '222', '29.5'])
    expect(w.find('.pqg-leg .per').text()).toBe('2025 年')
  })
})

// PvCharts2 稿 §9:窄容器(手机 336、桌面 .av2-s4 窄栏)月档只缩格,不缩字、不整幅缩放、不换图种。
// 判据是容器宽 < 420,不是视口宽
describe('PvQualityGrid · 窄容器月档', () => {
  // useWidth 在 onMounted 里量宽,首帧还是初始宽 —— 读 DOM 前要等一拍
  const narrow = async (data = MONTH) => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 336 })
    const w = mountIt(data)
    await nextTick()
    return w
  }

  it('❗格 44×48、行头 22:画布 22 + 5 × 48 − 4 = 258 ≤ 336,横向不滚;字号一个都没动', async () => {
    const w = await narrow()
    expect(w.find('section.pqg').classes()).toContain('narrow')
    const svg = w.find('svg.pqg-svg')
    expect([svg.attributes('width'), svg.attributes('height')]).toEqual(['258', '378'])
    // 6 周满月也只有 22 + 6 × 48 − 4 = 306
    const bg = g(w, '2025-08-01').find('rect.pqg-bg')           // 周五 = 第 0 列第 4 行
    expect([bg.attributes('x'), bg.attributes('y'), bg.attributes('width'), bg.attributes('height'), bg.attributes('rx')])
      .toEqual(['22', '226', '44', '48', '5'])
    // 触点 = 格本身,44 × 48 ≥ 30
    const hit = g(w, '2025-08-01').find('rect.pqg-hit')
    expect([hit.attributes('width'), hit.attributes('height')]).toEqual(['44', '48'])
    const rh = w.findAll('text.pqg-rowh')
    expect(rh.map(t => t.text())).toEqual(['一', '二', '三', '四', '五', '六', '日'])
    expect(rh.map(t => t.attributes('x'))).toEqual(Array(7).fill('14'))     // 22 − 8,行头右缘贴着格
    expect(rh.map(t => t.attributes('y'))).toEqual(['46', '98', '150', '202', '254', '306', '358'])
    // 不许整幅缩放:渲染宽恒等于 viewBox 宽
    expect(svg.attributes('viewBox')).toBe('0 0 258 378')
    expect(svg.attributes('transform')).toBeUndefined()
    expect(svg.attributes('preserveAspectRatio')).toBeUndefined()
  })

  it('❗格内第二行去量词(44 宽放得下 4 个半角);日期与第二行还在原来的位置,不缩字', async () => {
    const w = await narrow()
    expect(g(w, '2025-08-19').find('text.pqg-sub').text()).toBe('缺 2')
    expect(g(w, '2025-08-06').find('text.pqg-sub').text()).toBe('缺 1')
    expect(g(w, '2025-08-12').find('text.pqg-sub').text()).toBe('剔除')
    // 划痕照旧在,与字两路
    expect(g(w, '2025-08-12').find('rect.pqg-hatchbox').exists()).toBe(true)
    const day = g(w, '2025-08-01').find('text.pqg-day')
    expect([day.attributes('x'), day.attributes('y')]).toEqual(['30', '244'])   // 22 + 8、226 + 18
    expect(day.attributes('font-size')).toBeUndefined()                         // 字号只走 CSS 阶梯
  })

  it('❗年档不受窄容器影响:还是 12×12 小格(换图种是下一轮)', async () => {
    const Q1 = calendar('2025-01-01', 90, () => ({ kind: 'full' }))
    const w = await narrow({ ...MONTH, cells: Q1, weeks: 14 })
    const jan1 = g(w, '2025-01-01').find('rect.pqg-bg')
    expect([jan1.attributes('x'), jan1.attributes('width'), jan1.attributes('height')]).toEqual(['28', '12', '12'])
  })
})

// 2026-09-16 行为矩阵:只经段控进来的日历 —— 挂载时视口内擦入 320;换期不重挂,同一格位的格子只过渡底色 200
describe('PvQualityGrid · 动效', () => {
  const inView = () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 0, bottom: 300, left: 0, right: 655, width: 655, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  }
  afterEach(() => { vi.restoreAllMocks() })

  it('❗切子屏挂上来、在视口内:数据区 first + hold;animationcancel / animationend 都摘;离屏不擦', async () => {
    inView()
    const w = mountIt()
    await nextTick()
    expect(w.find('.pqg-body').classes()).toEqual(['pqg-body', 'first', 'hold'])
    await w.find('.pqg-body').trigger('animationcancel')
    expect(w.find('.pqg-body').classes()).toEqual(['pqg-body'])
    const w2 = mountIt()
    await nextTick()
    await w2.find('.pqg-body').trigger('animationend')
    expect(w2.find('.pqg-body').classes()).toEqual(['pqg-body'])
    vi.restoreAllMocks()
    const off = mountIt()
    await nextTick()
    expect(off.find('.pqg-body').classes()).toEqual(['pqg-body'])
  })

  it('❗换月不重挂:同一格位(第 0 列第 4 行)的底色 rect 还是同一个元素,fill 换成新月那天的;四态共用这一个 rect', async () => {
    const w = mountIt()
    const bg = g(w, '2025-08-01').find('rect.pqg-bg').element
    expect(bg.getAttribute('fill')).toBe('rgba(55,138,221,0.16)')
    // 下一个月从周五开始、第一天整日剔除 —— 格位与 8/1 相同
    const nov = calendar('2024-11-01', 30, date => (date === '2024-11-01' ? { kind: 'drop', readN: 2 } : { kind: 'full' }))
    await w.setProps({ data: { ...MONTH, cells: nov } })
    const c = g(w, '2024-11-01')
    expect(c.find('rect.pqg-bg').element).toBe(bg)
    expect(bg.getAttribute('fill')).toBe('rgba(28,28,28,.10)')
    expect(c.find('rect.pqg-hatchbox').exists()).toBe(true)
    expect(c.findAll('rect.pqg-bg')).toHaveLength(1)
  })

  it('❗月历 ↔ 年历:同一格位不是同一天 —— 整批换新元素,不做跨日期的底色淡变', async () => {
    const w = mountIt()
    const bg = g(w, '2025-08-01').find('rect.pqg-bg').element
    // 年历里第 0 列第 4 行也是一个周五,格位与 8/1 相同
    const jan = calendar('2025-01-03', 98, () => ({ kind: 'full' }))
    await w.setProps({ data: { ...MONTH, cells: jan, weeks: 14 } })
    expect(g(w, '2025-01-03').find('rect.pqg-bg').element, '年历复用了月历那一格').not.toBe(bg)
  })

  it('❗只有底色 rect 过渡:scoped 样式里的 transition 只写 fill / stroke(格的几何、悬停描边不过渡)', () => {
    const src = readFileSync(join(__dirname, '../PvQualityGrid.vue'), 'utf8')
    const css = src.slice(src.indexOf('<style'))
    expect(css.match(/transition:[^;]*;/g)).toEqual([
      'transition: fill var(--dur-base) var(--ease-standard), stroke var(--dur-base) var(--ease-standard);',
      'transition: none;',
    ])
    expect(css).toContain('.pqg-bg { transition:')
  })
})
