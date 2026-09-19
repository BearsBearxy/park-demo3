// KPI 卡三件(KPI-CARD-SPEC §3,稿 KpiA 方向 A):列表大卡 KpiCard / 分析屏小卡 AnaKpiTile / 抽屉小卡 FPStat。
//
// jsdom 不量版式、vitest 也不注入 SFC 的 <style>:这里把组件自己的 <style> 块原样塞进 document,
// 再读 getComputedStyle —— 断言落在「这个元素最后吃到的样式」上,不落在 props 或源码字符串上。
// 令牌(var(--x))jsdom 不求值,判据就是令牌名本身。
import { mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import KpiCard, { splitUnit } from '../KpiCard.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import FPStat from '@/components/fp/FPStat.vue'
import LedgerTenantDrawer from '@/views/ledger/LedgerTenantDrawer.vue'

const SRC = join(__dirname, '..', '..', '..')
function injectStyle(rel: string): void {
  const src = readFileSync(join(SRC, rel), 'utf8')
  const css = /<style[^>]*>([\s\S]*?)<\/style>/.exec(src)![1].replace(/:deep\(([^)]*)\)/g, '$1')
  const el = document.createElement('style')
  el.textContent = css
  document.head.appendChild(el)
}
beforeAll(() => {
  injectStyle('components/ds/KpiCard.vue')
  injectStyle('components/ana/AnaKpiTile.vue')
  injectStyle('components/fp/FPStat.vue')
})

const live: { unmount(): void }[] = []
function put<T>(c: T, props: Record<string, unknown> = {}, slots: Record<string, () => unknown> = {}) {
  const w = mount(c as never, { props: props as never, slots: slots as never, attachTo: document.body })
  live.push(w)
  return w
}
afterEach(() => { live.splice(0).forEach((w) => w.unmount()) })

const css = (el: Element) => getComputedStyle(el)

// 「放不下就降一档」按真宽度判(对抗复查 2026-09-20:原来按字数判,390 宽两列时 11 位的钱就被省略号截掉、还没有悬停)。
// jsdom 不排版:把数字位的宽度假装成 mono 字宽 0.6em × 字数(连单位),给它的宽 = BOX;字号从吃到的样式读。
const PX: Record<string, number> = { 'var(--fs-h1)': 24, 'var(--fs-h2)': 20, 'var(--fs-h3)': 16 }
let BOX = 0
function fakeLayout(): () => void {
  const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return Math.round((this.textContent ?? '').length * 0.6 * (PX[getComputedStyle(this).fontSize] ?? 14))
  })
  const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => BOX)
  return () => { sw.mockRestore(); cw.mockRestore() }
}
const settle = async () => { for (let i = 0; i < 4; i++) await nextTick() }
const row = (comp: unknown, n: number, props: (i: number) => Record<string, unknown>) =>
  put(defineComponent({ render: () => h('div', Array.from({ length: n }, (_, i) => h(comp as never, props(i)))) }))

describe('splitUnit:值 → 数 + 单位', () => {
  it('单位是数后面的非数字尾巴;以数字或 % 收尾的、没有数字的整串都是数', () => {
    expect(splitUnit('−¥655.3万')).toEqual(['−¥655.3', '万'])
    expect(splitUnit('−13.5万/月')).toEqual(['−13.5', '万/月'])
    expect(splitUnit('385 户')).toEqual(['385', ' 户'])
    expect(splitUnit('87.6%')).toEqual(['87.6%', ''])
    expect(splitUnit('18/21')).toEqual(['18/21', ''])
    expect(splitUnit('—')).toEqual(['—', ''])
  })
})

describe('列表大卡 KpiCard', () => {
  it('❗传 tint:整卡浅底,无色点;plain 是灰底', () => {
    const w = put(KpiCard, { label: '楼栋总数', value: '13', tint: 'cyan' })
    expect(css(w.element).background).toBe('var(--accent-cyan)')
    expect(w.attributes('style'), '整卡无边框(原来是白卡细边)').not.toMatch(/border/)
    // 标签行只剩标签本身(原来的 7px 色点删掉了)
    expect(w.find('.kc-h').element.children).toHaveLength(1)
    expect(css(put(KpiCard, { label: '已停用', value: '2', tint: 'plain' }).element).background).toBe('var(--surface-card)')
  })

  it('❗不传 tint:按在排里的位置 slate → blue → sky → cyan,第 5 张回到 slate', () => {
    const w = row(KpiCard, 5, (i) => ({ label: 'k' + i, value: String(i) }))
    expect(w.findAll('.kc').map((c) => css(c.element).background)).toEqual([
      'var(--accent-slate)', 'var(--accent-blue)', 'var(--accent-sky)', 'var(--accent-cyan)', 'var(--accent-slate)',
    ])
  })

  it('❗尺寸照稿:圆角 16、内边距 20、行距 12;标签 14 主色;图标 18 次色;数 mono 24、单位 16 sans', () => {
    const w = put(KpiCard, { label: '可租面积', value: '8.43 万㎡', tint: 'sky' }, { icon: () => h('svg', { width: 16, height: 16 }) })
    const s = css(w.element)
    expect([s.borderRadius, s.padding, s.gap]).toEqual(['var(--radius-lg)', '20px', '12px'])
    expect([css(w.find('.kc-l').element).fontSize, css(w.find('.kc-l').element).color]).toEqual(['var(--fs-body)', 'var(--text-primary)'])
    expect(css(w.find('.kc-i').element).color).toBe('var(--text-secondary)')
    expect([css(w.find('.kc-i svg').element).width, css(w.find('.kc-i svg').element).height]).toEqual(['18px', '18px'])
    const n = w.find('.kc-n')
    expect([css(n.element).fontSize, css(n.element).fontFamily]).toEqual(['var(--fs-h1)', 'var(--font-mono)'])
    expect(n.text()).toBe('8.43 万㎡')
    expect(w.find('.kc-n .u').text()).toBe('万㎡')
    expect([css(w.find('.kc-n .u').element).fontSize, css(w.find('.kc-n .u').element).fontFamily]).toEqual(['var(--fs-h3)', 'var(--font-sans)'])
  })

  it('❗放不下 24 按卡的真宽度判:降到 20 放得下就不给悬停;20 还放不下才省略号 + 悬停看全', async () => {
    const undo = fakeLayout()
    try {
      BOX = 137                               // 390 宽两列的 S 档卡:177 − 内边距 40
      const a = put(KpiCard, { label: '营业收入', value: '¥123,456.78' }).find('.kc-n')   // 24 → 158,20 → 132
      await settle()
      expect(css(a.element).fontSize, '11 位在窄卡里放不下 24,原来按字数判不降').toBe('var(--fs-h2)')
      expect(a.attributes('title')).toBeUndefined()
      const b = put(KpiCard, { label: '营业收入', value: '¥1,234,567.89' }).find('.kc-n')  // 20 → 156
      await settle()
      expect([css(b.element).fontSize, b.attributes('title')], '20 还放不下却没有悬停').toEqual(['var(--fs-h2)', '¥1,234,567.89'])
      BOX = 400
      const c = put(KpiCard, { label: '营业收入', value: '¥1,234,567.89' }).find('.kc-n')
      await settle()
      expect([css(c.element).fontSize, c.attributes('title')], '宽卡放得下就照旧 24').toEqual(['var(--fs-h1)', undefined])
    } finally { undo() }
  })

  it('❗数从插槽给(科目余额表 / 资产负债表「平衡差」)一样量:放不下降 20', async () => {
    const undo = fakeLayout()
    try {
      BOX = 195                               // 1366 宽四列卡
      const w = put(KpiCard, { label: '试算平衡差', tint: 'cyan' }, { default: () => h('span', '−¥1,234,567.89') })
      await settle()
      expect(css(w.find('.kc-n').element).fontSize).toBe('var(--fs-h2)')
    } finally { undo() }
  })

  it('❗字体换入后重新量(先用回退字体排的放得下,Roboto Mono 到了就放不下了;浏览器实测踩过)', async () => {
    let onDone: (() => void) | null = null
    Object.defineProperty(document, 'fonts', { configurable: true, value: {
      ready: new Promise(() => {}), addEventListener: (_: string, f: () => void) => { onDone = f }, removeEventListener() {},
    } })
    const undo = fakeLayout()
    try {
      BOX = 400
      const w = put(KpiCard, { label: '营业收入', value: '¥123,456.78' })
      await settle()
      expect(css(w.find('.kc-n').element).fontSize).toBe('var(--fs-h1)')
      BOX = 137                                // 换入的字更宽 = 同一个盒子放不下了
      onDone!()
      await settle()
      expect(css(w.find('.kc-n').element).fontSize, '字体到了没重新量').toBe('var(--fs-h2)')
    } finally { undo(); delete (document as { fonts?: unknown }).fonts }
  })

  it('❗卡变窄(窗口 / 侧栏收放)重新量:ResizeObserver 回调后降档', async () => {
    const cbs: ResizeObserverCallback[] = []
    vi.stubGlobal('ResizeObserver', class { constructor(cb: ResizeObserverCallback) { cbs.push(cb) } observe() {} unobserve() {} disconnect() {} })
    const undo = fakeLayout()
    try {
      BOX = 400
      const w = put(KpiCard, { label: '营业收入', value: '¥123,456.78' })
      await settle()
      expect(css(w.find('.kc-n').element).fontSize).toBe('var(--fs-h1)')
      BOX = 137
      cbs.forEach((cb) => cb([{ contentRect: { width: 137 } } as ResizeObserverEntry], {} as ResizeObserver))
      await settle()
      expect(css(w.find('.kc-n').element).fontSize, '变窄后没重新量').toBe('var(--fs-h2)')
    } finally { undo(); vi.unstubAllGlobals() }
  })

  it('❗利润类为负标红;利润类为正、收入类为负都不标', () => {
    const color = (p: Record<string, unknown>) => css(put(KpiCard, { label: 'x', ...p }).find('.kc-n').element).color
    expect(color({ value: '−¥12.40', profit: true })).toBe('var(--delta-down-text)')
    expect(color({ value: '¥143.10', profit: true })).toBe('var(--text-primary)')
    expect(color({ value: '−¥63.60' })).toBe('var(--text-primary)')
  })

  it('❗涨跌在数右边同一行:↗/↘ 跟符号走,颜色跟好坏走,成本类反转;「环比」灰字', () => {
    const d = (p: Record<string, unknown>) => {
      const w = put(KpiCard, { label: 'x', value: '¥1', kind: '环比', ...p })
      const dl = w.find('.kc-v .kc-d .dl')
      return [dl.text(), dl.find('svg').classes().join(' '), css(dl.element).color, css(w.find('.kc-d .dk').element).color]
    }
    const [t1, i1, c1, k1] = d({ delta: 11 })
    expect([t1, c1, k1]).toEqual(['+11.0%', 'var(--delta-up-text)', 'var(--text-muted-tint)'])
    expect(i1).toContain('arrow-up-right')
    const [t2, i2, c2] = d({ delta: -0.7, invert: true })
    expect([t2, c2]).toEqual(['−0.7%', 'var(--delta-up-text)'])
    expect(i2).toContain('arrow-down-right')
    expect(d({ delta: -0.7 })[2]).toBe('var(--delta-down-text)')
  })

  it('❗说明行(「2 栋停用」「待招商」)不带箭头:灰字 muted-tint,警示用 --warn-text', () => {
    const w = put(KpiCard, { label: '空置单元', value: '37', sub: '待招商' })
    const s = w.find('.kc-s')
    expect(s.text()).toBe('待招商')
    expect(s.find('svg').exists()).toBe(false)
    expect(w.text()).not.toMatch(/[↗↘]/)
    expect(w.find('.kc-d').exists()).toBe(false)
    expect(css(s.element).color).toBe('var(--text-muted-tint)')
    expect(css(put(KpiCard, { label: 'x', value: '37', sub: '其中 5 间', subTone: 'warn' }).find('.kc-s').element).color).toBe('var(--warn-text)')
  })

  it('❗加载中盒子不变:数行定高 30,只有数字位 / 说明位换成微光条', () => {
    const w = put(KpiCard, { label: '楼栋总数', value: '', loading: true, sub: '0 栋停用' })
    expect(w.find('.kc-l').text()).toBe('楼栋总数')
    expect(w.find('.kc-n').exists()).toBe(false)
    expect(css(w.find('.kc-v').element).height).toBe('30px')
    const sk = w.find('.kc-v .fp-shim')
    expect([css(sk.element).width, css(sk.element).height]).toEqual(['96px', '24px'])
    expect(w.find('.kc-s .fp-shim').exists()).toBe(true)
    expect(w.find('.kc-s').text()).toBe('')
  })
})

describe('分析屏小卡 AnaKpiTile', () => {
  it('❗按在排里的位置 sky / slate 交替,无边框', () => {
    const w = row(AnaKpiTile, 4, (i) => ({ label: 'k' + i, value: String(i) }))
    const tiles = w.findAll('.av2-kpi')
    expect(tiles.map((t) => css(t.element).background)).toEqual(['var(--accent-sky)', 'var(--accent-slate)', 'var(--accent-sky)', 'var(--accent-slate)'])
    expect(css(tiles[0].element).borderRadius).toBe('var(--radius-md)')
  })

  it('❗不画趋势线:传了 trend 也没有 svg(涨跌箭头之外)', () => {
    const w = put(AnaKpiTile, { label: '营收', value: '¥1万', trend: [3, 5, 4, 6, 2, 7], note: '1-8 月' })
    expect(w.findAll('svg')).toHaveLength(0)
    expect(w.find('path').exists()).toBe(false)
  })

  it('❗高 108 = 12 + 标签 18 + 4 + 数 26 + 4 + 副行 32 + 12;涨跌 / 说明 / 空副行 / 加载 四种都是这个盒子', () => {
    const box = (p: Record<string, unknown>) => {
      const w = put(AnaKpiTile, { label: '收缴率', value: '81.3%', ...p })
      const r = css(w.element)
      const num = w.find('.v').exists() ? css(w.find('.v').element).height
        : `${parseFloat(css(w.find('.sk-v').element).height) + 2 * parseFloat(css(w.find('.sk-v').element).marginTop)}px`
      return [r.height, r.boxSizing, r.padding, r.gap, css(w.find('.l').element).height, num, css(w.find('.d').element).height]
    }
    const want = ['108px', 'border-box', '12px', '4px', '18px', '26px', '32px']
    expect(box({ delta: -14.7, unit: 'pt', kind: '距目标96%' })).toEqual(want)
    expect(box({ note: '在租合同 205 份' })).toEqual(want)
    expect(box({})).toEqual(want)
    expect(box({ loading: true })).toEqual(want)
  })

  it('❗副行固定两行高:超过两行截断,不撑高瓦', () => {
    const d = put(AnaKpiTile, { label: 'x', value: '1', note: '一段很长很长的说明文字会折到第三行第四行也不许撑高' }).find('.d')
    const s = css(d.element) as CSSStyleDeclaration & { webkitLineClamp?: string }
    expect([s.height, s.overflow, s.getPropertyValue('-webkit-line-clamp')]).toEqual(['32px', 'hidden', '2'])
  })

  it('❗利润类为负标红;收入为负不标', () => {
    const color = (p: Record<string, unknown>) => css(put(AnaKpiTile, { label: 'x', ...p }).find('.v').element).color
    expect(color({ value: '−¥655.3万', profit: true })).toBe('var(--delta-down-text)')
    expect(color({ value: '¥655.3万', profit: true })).toBe('var(--text-primary)')
    expect(color({ value: '−¥63.6万' })).toBe('var(--text-primary)')
  })

  it('❗涨跌:箭头跟符号、颜色跟好坏,成本类 invert 反转;「环比」灰字', () => {
    const w = put(AnaKpiTile, { label: '成本费用', value: '¥591.7万', delta: -0.7, kind: '环比', invert: true })
    const dl = w.find('.d .dl')
    expect(dl.text()).toBe('−0.7%')
    expect(dl.find('svg').classes().join(' ')).toContain('arrow-down-right')
    expect(css(dl.element).color).toBe('var(--delta-up-text)')
    expect(css(w.find('.d .dk').element).color).toBe('var(--text-muted-tint)')
    const rev = put(AnaKpiTile, { label: '营业收入', value: '−¥63.6万', delta: -106.8, kind: '环比' }).find('.d .dl')
    expect(css(rev.element).color).toBe('var(--delta-down-text)')
  })

  it('❗只有说明:灰字不给箭头;警示说明用 --warn-text', () => {
    const d = put(AnaKpiTile, { label: '在租租户', value: '385 户', note: '在租合同 205 份' }).find('.d')
    expect(d.find('svg').exists()).toBe(false)
    expect([css(d.element).color, css(d.element).fontFamily]).toEqual(['var(--text-muted-tint)', 'var(--font-sans)'])
    const warn = put(AnaKpiTile, { label: '缺抄条数', value: '3 条', note: '3号楼 2', noteTone: 'warn' }).find('.d')
    expect(css(warn.element).color).toBe('var(--warn-text)')
  })

  it('❗字号:标签 12 主色、数 mono 20 单位 14', () => {
    const w = put(AnaKpiTile, { label: '在租租户', value: '385 户' })
    expect([css(w.find('.l').element).fontSize, css(w.find('.l').element).color]).toEqual(['var(--fs-label)', 'var(--text-primary)'])
    expect(css(w.find('.v').element).fontSize).toBe('var(--fs-h2)')
    expect([w.find('.v .u').text(), css(w.find('.v .u').element).fontSize]).toEqual(['户', 'var(--fs-body)'])
  })

  it('❗放不下 20 按瓦的真宽度判(连单位「万/月」一起量):降 16;16 还放不下才省略号 + 悬停看全', async () => {
    const undo = fakeLayout()
    try {
      BOX = 126                               // 150 宽瓦 − 内边距 24
      const a = put(AnaKpiTile, { label: '当前合约租金', value: '¥1,234.5万/月' }).find('.v')   // 20 → 132,16 → 106
      await settle()
      expect([css(a.element).fontSize, a.attributes('title')], '数只有 8 位、单位把它撑出去了').toEqual(['var(--fs-h3)', undefined])
      BOX = 60
      const b = put(AnaKpiTile, { label: '年度收入', value: '¥12,345.6万' }).find('.v')
      await settle()
      expect([css(b.element).fontSize, b.attributes('title')]).toEqual(['var(--fs-h3)', '¥12,345.6万'])
      BOX = 200
      const c = put(AnaKpiTile, { label: '园区利润', value: '−¥655.3万' }).find('.v')
      await settle()
      expect(css(c.element).fontSize).toBe('var(--fs-h2)')
    } finally { undo() }
  })
})

describe('抽屉小卡 FPStat', () => {
  it('❗有 tint 用 tint、没有用 --surface-card;圆角 16 内边距 12×14', () => {
    const t = put(FPStat, { label: '出租率', value: '91.2%', tint: 'blue' })
    expect(css(t.element).background).toBe('var(--accent-blue)')
    expect([css(t.element).borderRadius, css(t.element).padding]).toEqual(['var(--radius-lg)', '12px 14px'])
    expect(css(put(FPStat, { label: '总面积', value: '8,120' }).element).background).toBe('var(--surface-card)')
  })

  it('❗字号:标签 12(原 11)、数 mono 20(原 19)单位 14、说明 11 muted-tint(原 --text-disabled)', () => {
    const w = put(FPStat, { label: '月租金', value: '¥42.6万', sub: '16 户在租', tint: 'sky' })
    expect(css(w.find('.fs-l').element).fontSize).toBe('var(--fs-label)')
    expect([css(w.find('.fs-n').element).fontSize, css(w.find('.fs-n').element).fontFamily]).toEqual(['var(--fs-h2)', 'var(--font-mono)'])
    expect([w.find('.fs-n .u').text(), css(w.find('.fs-n .u').element).fontSize]).toEqual(['万', 'var(--fs-body)'])
    expect([css(w.find('.fs-s').element).fontSize, css(w.find('.fs-s').element).color]).toEqual(['var(--fs-micro)', 'var(--text-muted-tint)'])
  })

  it('❗放不下 20 按卡的真宽度判:降 16;16 还放不下给悬停', async () => {
    const undo = fakeLayout()
    try {
      BOX = 110
      const a = put(FPStat, { label: '月租金', value: '¥123,456.78' }).find('.fs-n')          // 20 → 132,16 → 106
      await settle()
      expect([css(a.element).fontSize, a.attributes('title')]).toEqual(['var(--fs-h3)', undefined])
      BOX = 80
      const b = put(FPStat, { label: '月租金', value: '¥123,456.78' }).find('.fs-n')
      await settle()
      expect(b.attributes('title')).toBe('¥123,456.78')
    } finally { undo() }
  })

  it('❗加载中:数字位换微光条(20 高 + 上下 3 = 数行 26),说明照常', () => {
    const w = put(FPStat, { label: '出租率', value: '', sub: '6,840 / 7,500 ㎡', tint: 'blue', loading: true })
    const sk = css(w.find('.fs-sk').element)
    expect([sk.height, sk.marginTop, sk.marginBottom]).toEqual(['20px', '3px', '3px'])
    // 数行定高 26(mono 数 + CJK 单位混排浏览器实测会撑到 27.8,到数那一下就跳 1.8px)
    expect(css(put(FPStat, { label: 'x', value: '¥42.6万' }).find('.fs-n').element).height).toBe('26px')
    expect(w.find('.fs-n').exists()).toBe(false)
    expect(w.find('.fs-s').text()).toBe('6,840 / 7,500 ㎡')
  })

  it('❗台账抽屉「本月结余」换成 FPStat:负红 --delta-down-text、正橙 --hue-orange、零主色,灰底', () => {
    const bal = (v: number) => {
      const w = mount(LedgerTenantDrawer, {
        props: {
          row: { tenantName: '甲', totalReceivable: 5000, totalCollected: 2000, balanceEnd: v, fees: {} } as never,
          companyName: '甲公司', year: 2026, monthNo: 8, prevMonth: 7,
        },
        global: { stubs: { FPDrawer: { template: '<div><slot /></div>' }, FPTenantPicker: true } },
        attachTo: document.body,
      })
      live.push(w)
      const card = w.findAll('.fs').find((c) => c.find('.fs-l').text() === '本月结余')!
      expect(card, '本月结余不是 FPStat').toBeTruthy()
      expect(css(card.element).background).toBe('var(--surface-card)')
      return css(card.find('.fs-n').element).color
    }
    expect(bal(-3280)).toBe('var(--delta-down-text)')
    expect(bal(1460)).toBe('var(--hue-orange)')
    expect(bal(0)).toBe('var(--text-primary)')
  })
})
