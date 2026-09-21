/**
 * 选期矩阵的横滚档 `scrollRow`(2026-09-21 用户拍板:「首页矩阵改成横滚」)。
 *
 * 由来:4 列 × 3 行每年 226px,库里 4 年 = 976px,而手机内容带只有 ~848px ——
 * 首页这条年份条把它下面的出账链 7 行与附表 8 行整块挤出屏,点了月份看不见任何变化。
 * §5.8 当初否掉横滚时就留了回头条件「库里年数 ≥ 3」,现在真库上成立了。
 *
 * 钉四件事:
 *   ① **只有传了 scrollRow 的宿主变**。这个组件 9 个屏共用,另外 8 处是「进正文前必经的门」,
 *      门后没有别的东西要让位 —— 它们必须一字不动。所以这里的重头是**反向**断言。
 *   ② 宽档零差异(§9):横滚规则只许待在 600 块里,基础层与 960 块都不许沾。
 *   ③ `grid-template-columns: none` 不能省。同一个 600 块里上面就是 `repeat(4, …)`,
 *      不清掉的话轨道还是 4 条、第 5 格换行,横滚一格都滚不动 —— 而这种错**不报任何警告**。
 *   ④ 当前月要滚进视野。不做这一下横滚就是纯退步(本月常落第 9 格,每次进门先滑)。
 *      而且**必须用 scrollLeft 不能用 scrollIntoView**:后者的 block:'nearest' 会去滚页面,
 *      四个年行各滚一次,首屏当场跳到最后一年。
 *
 * jsdom 不做布局(offsetLeft / clientWidth / scrollWidth 恒 0),所以 ④ 的几何量是显式喂进去的,
 * 喂的数就是真机上的数(格 76 + 间距 8 = 84 一格,内容带 358)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaBlock } from '@/test-utils/mediaBlock'

import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'

const SRC = readFileSync(join(__dirname, '..', 'BookMonthMatrix.vue'), 'utf8').replace(/\r\n/g, '\n')
const Q960 = '@media (max-width: 960px)'
const Q600 = '@media (max-width: 600px)'
/** 媒体块外的**样式**规则 = 宽档(L/XL)看到的那一份。
 *  ⚠ 必须先切到 <style> 再剥媒体块:整文件剥的话 <template> 里那句
 *  `:class="{ 'bmm-scroll': scrollRow }"` 也会留在里面,下面那条「基础层不提 bmm-scroll」
 *  就会被模板的字面量顶成恒假(实测红过一次)。 */
const STYLE = SRC.slice(SRC.indexOf('<style'))
const OUTSIDE = STYLE.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')

/** 两年 × 12 格;当前月钉在 2024-09(下标 **8**)。
 *  为什么不是下标 6:12 格时 6 正好是正中,`offsetLeft` 与 `scrollWidth / 2` 同为一个数,
 *  把公式写成「用 scrollWidth 代 clientWidth」也照样得到期望值 —— 退化夹具。8 不对称,四种写错法
 *  各得一个不同的数(见下面居中那条用例里逐个算过的清单)。 */
const CUR = 8
const YEARS = [
  {
    year: 2024,
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, hasData: true, rowCount: 7 + i * 13, cur: i === CUR,
    })),
  },
  {
    year: 2025,
    months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hasData: i < 3 })),
  },
]

const mk = (scrollRow: boolean) =>
  mount(BookMonthMatrix, { props: { book: {}, years: YEARS, manageYears: false, scrollRow } })

/** ⚠ **完全不传** scrollRow —— 另外 8 个宿主走的是这条路,不是 `scrollRow: false` 那条。
 *  唯一护着它们的就是 withDefaults 里那一行默认值;用 mk(false) 冒充等于那行零覆盖,
 *  把它改成 true 都不会有任何断言变红。 */
const mkDefault = () =>
  mount(BookMonthMatrix, { props: { book: {}, years: YEARS, manageYears: false } })

beforeEach(() => setActivePinia(createPinia()))

// ── ① 只有传了 scrollRow 的宿主变 ────────────────────────────────────────
describe('scrollRow ① 别的 8 个宿主一字不动', () => {
  it('❗**整个不传** scrollRow:默认值那一行是 8 个宿主唯一的保险,必须自己有覆盖', () => {
    const w = mkDefault()
    const cells = w.findAll('.bmm-cells')
    expect(cells, '一个 .bmm-cells 都没选到,下面的否定断言会恒真').toHaveLength(2)
    for (const c of cells) expect(c.classes(), 'withDefaults 里的 scrollRow 默认值不是 false').not.toContain('bmm-scroll')
    // 连着把「真的用了默认值」这件事本身钉住:prop 读出来必须是 false,不是 undefined
    expect(w.findComponent(BookMonthMatrix).props('scrollRow')).toBe(false)
  })

  it('显式传 false:与不传一致', () => {
    const cells = mk(false).findAll('.bmm-cells')
    expect(cells).toHaveLength(2)
    for (const c of cells) expect(c.classes()).not.toContain('bmm-scroll')
  })

  it('传了 scrollRow:每个年行的格子容器都挂上 bmm-scroll(不是只挂第一行)', () => {
    const cells = mk(true).findAll('.bmm-cells')
    expect(cells).toHaveLength(2)
    for (const c of cells) expect(c.classes()).toContain('bmm-scroll')
  })

  it('❗两种模式的月卡 DOM 完全一样 —— 横滚是纯 CSS,不许少画/多画格子', () => {
    const off = mk(false)
    const on = mk(true)
    const cardsOf = (w: VueWrapper) => w.findAll('.bmm-card').map((c) => c.text())
    expect(cardsOf(off)).toHaveLength(24)
    expect(cardsOf(on)).toEqual(cardsOf(off))
    // 当前月那一格两边都认得出来(下面 ④ 要靠它)
    expect(on.findAll('.bmm-card')[CUR].classes()).toContain('cur')
    expect(off.findAll('.bmm-card')[CUR].classes()).toContain('cur')
  })
})

// ── ② 宽档零差异 ────────────────────────────────────────────────────────
describe('scrollRow ② 横滚规则只许待在 600 块里', () => {
  it('❗基础层(宽档看到的那份)完全不提 bmm-scroll —— 写外面 = 桌面也横滚', () => {
    expect(OUTSIDE, '基础层里出现了横滚规则,1440 上的 9 个屏会一起变').not.toContain('bmm-scroll')
    expect(OUTSIDE).not.toContain('grid-auto-flow: column')
    expect(OUTSIDE).not.toContain('overflow-x: auto')
  })

  it('❗960 块(M 档)也不提 —— 平板保持 6 列 × 2 行,本轮不动它', () => {
    const block = mediaBlock(SRC, Q960)
    expect(block, '960 块整个不见了,下面的否定断言会恒真').not.toBe('')
    expect(block).toContain('grid-template-columns: repeat(6, minmax(0, 1fr));')  // 前提:选到的确实是 M 档那块
    expect(block).not.toContain('bmm-scroll')
  })

  it('600 块里有完整的一套:列换成自动轨、能横滚、手势不外传、吸附', () => {
    const block = mediaBlock(SRC, Q600)
    expect(block, '600 块整个不见了').not.toBe('')
    expect(block).toContain('.bmm-cells.bmm-scroll {')
    expect(block).toContain('grid-auto-flow: column;')
    expect(block, '格宽回到了 76 —— 那是照 358 倒推的,而年份条在 .dh 里只有 310').toContain('grid-auto-columns: 68px;')
    expect(block).toContain('overflow-x: auto;')
    // 横向甩到头会往外传:iOS 上是「返回上一页」,Android 上是整页横移
    expect(block).toContain('overscroll-behavior-x: contain;')
    expect(block).toContain('scroll-snap-type: x proximity;')
    expect(block).toContain('.bmm-cells.bmm-scroll .bmm-card { scroll-snap-align: center; }')
  })
})

// ── ③ grid-template-columns: none 不能省 ────────────────────────────────
describe('scrollRow ③ 轨道必须显式清掉', () => {
  it('❗600 块里 .bmm-scroll 那条写了 grid-template-columns: none', () => {
    const block = mediaBlock(SRC, Q600)
    const at = block.indexOf('.bmm-cells.bmm-scroll {')
    expect(at, '选不到横滚那条规则,下面就是恒真').toBeGreaterThan(-1)
    const rule = block.slice(at, block.indexOf('}', at))
    expect(rule,
      '省了它的话同块里上面那条 repeat(4,…) 还在管轨道:第 5 格起换行,横滚一格都滚不动,而且不报任何警告',
    ).toContain('grid-template-columns: none;')
  })

  it('两个类的特异度压过单类那条 —— 靠的不是源序(顺序改了也得赢)', () => {
    const block = mediaBlock(SRC, Q600)
    // 单类那条仍在(4 列是不传 scrollRow 的 8 个宿主要用的),两条同时存在才有「谁压谁」这回事
    expect(block).toContain('.bmm-cells { grid-template-columns: repeat(4, minmax(0, 1fr)); }')
    expect(block).toContain('.bmm-cells.bmm-scroll {')
  })
})

// ── ④ 当前月滚进视野 ────────────────────────────────────────────────────
// ── 真机几何(390 视口,全部为浏览器实测值)────────────────────────────────
// 盒链:390 − .fp-content 16×2(AppShell M↓ 块) − .dh 24×2(DataHomeView,窄档没覆盖) = 310。
// ⚠ 可视宽**不是** 358。358 是 .fp-content 的内容带,而年份条还在 .dh 里面再收 48 ——
//   第一版按 358 定的 76px 格宽放进 310 只露 3 个整月,正是 §5.8 否掉横滚时记的那条代价。
const BOX_W = 310        // .bmm-cells 可视宽
const CARD_W = 68        // grid-auto-columns
const PITCH = 76         // 68 + gap 8
const SCROLL_W = 904     // 12 × 68 + 11 × 8
// ⚠ 容器**自己**也有 offsetLeft。offsetLeft 相对的是最近的已定位祖先(首页是 .dh,padding 24),
//   不是滚动容器 —— 喂 0 的话「漏减 box.offsetLeft」这个错永远测不出来(第一版就是这么瞎的)。
const BOX_OFF = 24
/** 把上面这组数喂进 jsdom(它不做布局,这些量恒为 0)。卡的 offsetLeft 与浏览器同源:BOX_OFF + i×PITCH。 */
function feedGeometry(w: VueWrapper) {
  for (const box of w.findAll('.bmm-cells')) {
    const el = box.element as HTMLElement
    Object.defineProperty(el, 'scrollWidth', { value: SCROLL_W, configurable: true })
    Object.defineProperty(el, 'clientWidth', { value: BOX_W, configurable: true })
    Object.defineProperty(el, 'offsetLeft', { value: BOX_OFF, configurable: true })
    el.scrollLeft = 0
    box.findAll('.bmm-card').forEach((c, i) => {
      Object.defineProperty(c.element, 'offsetLeft', { value: BOX_OFF + i * PITCH, configurable: true })
      Object.defineProperty(c.element, 'offsetWidth', { value: CARD_W, configurable: true })
    })
  }
}
/** 期望落点:(卡相对容器 = 8×76) − (容器可视 − 卡宽)/2 = 608 − 121 = 487。浏览器实测同为 487。 */
const CENTERED = CUR * PITCH - (BOX_W - CARD_W) / 2
/** 挂载那一拍 jsdom 宽度全是 0(组件按「没溢出」跳过),喂完几何换一份 years 把 effect 再踢一次 */
async function retrigger(w: VueWrapper) {
  await w.setProps({ years: YEARS.map((y) => ({ ...y })) })
  await nextTick()
}

describe('scrollRow ④ 当前月滚进视野', () => {
  it('❗把当前月居中:scrollLeft = 8×76 − (310 − 68) / 2 = 487(浏览器实测同值)', async () => {
    const w = mk(true)
    feedGeometry(w)
    await retrigger(w)
    const boxes = w.findAll('.bmm-cells').map((c) => (c.element as HTMLElement).scrollLeft)
    // 2024 有当前月(下标 8,offsetLeft = 24 + 8×76 = 632);2025 没有,停在 1 月不动
    expect(CENTERED, '期望值本身算错了').toBe(487)
    expect(boxes[0], '当前月没被滚进视野 —— 横滚档本月常落第 9 格,不滚就是纯退步').toBe(CENTERED)
    expect(boxes[1], '没有当前月的年被一起滚了').toBe(0)
  })

  // 夹具不退化的证明:把公式写错的四种常见写法,在这组数下各得一个**不同**的数。
  // 第一版夹具(cur 在下标 6、box.offsetLeft 喂 0)里有两种写错法照样得期望值,等于没测。
  it('❗四种写错的公式在这组夹具下都得不到 487 —— 证明它钉得住', () => {
    const curOff = BOX_OFF + CUR * PITCH            // 632,浏览器实测同值
    expect(curOff - (BOX_W - CARD_W) / 2, '漏减 box.offsetLeft').toBe(511)
    expect(curOff - BOX_OFF - (BOX_W - CARD_W), '漏掉 /2').toBe(366)
    expect(curOff - BOX_OFF - (SCROLL_W - CARD_W) / 2, '把 clientWidth 写成 scrollWidth').toBe(190)
    expect(curOff - BOX_OFF, '只对齐左边不居中').toBe(608)
    // 四个都 ≠ 487
    expect(new Set([511, 366, 190, 608]).has(CENTERED)).toBe(false)
  })

  it('❗**整个不传** scrollRow 时一下都不滚(另外 8 个宿主不许被这段碰到)', async () => {
    const w = mkDefault()
    feedGeometry(w)
    await retrigger(w)
    for (const c of w.findAll('.bmm-cells')) expect((c.element as HTMLElement).scrollLeft).toBe(0)
  })

  it('❗从头到尾没调过 scrollIntoView —— 它的 block:nearest 会去滚页面,首屏当场跳到最后一年', async () => {
    // jsdom 根本没实现 scrollIntoView,直接 spyOn 会抛「does not exist」——
    // 先按上去再监视,否则这条测不了「没调过」,只能测出「一调就崩」。
    const spy = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: spy, configurable: true, writable: true })
    const w = mk(true)
    feedGeometry(w)
    await retrigger(w)
    expect((w.findAll('.bmm-cells')[0].element as HTMLElement).scrollLeft, '前提:这一趟真的居中了').toBe(CENTERED)
    expect(spy).not.toHaveBeenCalled()
    delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView
  })

  it('❗只居中一次:之后点月份不许把手指底下的格子再挪一遍', async () => {
    const w = mk(true)
    feedGeometry(w)
    await retrigger(w)
    const box = w.findAll('.bmm-cells')[0].element as HTMLElement
    expect(box.scrollLeft).toBe(CENTERED)
    box.scrollLeft = 900                        // 用户自己滑到了年底
    await w.findAll('.bmm-card')[10].trigger('click')   // 点 11 月
    await retrigger(w)
    expect(box.scrollLeft, '又居中了一次 —— 用户滑到哪该留在哪').toBe(900)
  })

  it('❗宽档(没溢出)照样落锁 —— 不落锁的话后续任何一次重跑都会把年份条自己横移', async () => {
    const w = mk(true)
    // 按「宽档」喂:scrollWidth == clientWidth
    for (const box of w.findAll('.bmm-cells')) {
      const el = box.element as HTMLElement
      Object.defineProperty(el, 'scrollWidth', { value: BOX_W, configurable: true })
      Object.defineProperty(el, 'clientWidth', { value: BOX_W, configurable: true })
    }
    await retrigger(w)
    expect(w.findAll('.bmm-cells').every((c) => (c.element as HTMLElement).scrollLeft === 0)).toBe(true)
    // 再喂窄档几何并重跑:**不许**再居中。落了锁就是落了锁。
    // ⚠ 这条**不是**在测「缩窗后补居中」—— 那条路生产里不存在(effect 没有视口依赖,
    //   setProps 只能冒充 resize)。这里测的是相反那件事:锁必须真的锁住。
    feedGeometry(w)
    await retrigger(w)
    expect((w.findAll('.bmm-cells')[0].element as HTMLElement).scrollLeft,
      '已落锁却又滚了一次 —— 上层每重算一次 years,年份条就会在用户眼皮底下横移').toBe(0)
  })
})
