// 月度台账固定列与表格高度(LIST-PAGE-SPEC §9.1/§9.2,画布 07-A 三行改后、07-B 改后两块;计划 S2 W2「验」)。
// RO 桩把 .lg-wrap 的 clientWidth/clientHeight 设成画布上的宽高,断言钉渲染出来的 left/right/width 像素。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import FPLedgerTable from '../FPLedgerTable.vue'
import { stubWideTable } from '@/composables/__tests__/wideTableStub'
import { FEE_KEYS, lgColumns } from '@/utils/ledgerColumns'
import type { LedgerFees, LedgerRowDTO } from '@/types/ledger'

const zeroFees = () => Object.fromEntries(FEE_KEYS.map(k => [k, 0])) as unknown as LedgerFees

// 列宽(不量 DOM):租户 8 字 → 100+2+38 = 140;上月结余按合计 103,765.43 → 90;应收合计按表头「本月应收合计」87;
// 收款 1,000,000.00 → 105;本月结余 12,345,678.90 → 112。五根合计 534。
const R1: LedgerRowDTO = {
  ...zeroFees(), id: 1, tenantId: 1, tenantName: '联塑精锢有限公司',
  balancePrev: 98765.43, totalReceivable: 1234.56, totalCollected: 1000000, balanceEnd: 12345678.9, note: '按季度付',
}
const R2: LedgerRowDTO = {
  ...zeroFees(), id: 2, tenantId: 2, tenantName: '顺达物流',
  balancePrev: 5000, totalReceivable: 2000, totalCollected: 0, balanceEnd: -5000, note: null,
}
const LONG = '深圳市宝安区联塑精锢科技发展有限公司'

enableAutoUnmount(afterEach)

let ro: ReturnType<typeof stubWideTable>
beforeEach(() => { ro = stubWideTable('lg-wrap') })
afterEach(() => {
  vi.useRealTimers()
  ro.restore()
})

async function mountAt(w: number, h: number, props: Partial<{ rows: LedgerRowDTO[]; edit: boolean; selected: Set<number> }> = {}) {
  ro.size(w, h)
  const wr = mount(FPLedgerTable, {
    props: { columns: lgColumns(8), rows: [R1, R2], edit: false, ...props },
    attachTo: document.body,
  })
  await nextTick()
  return wr
}
type Wr = Awaited<ReturnType<typeof mountAt>>
const th = (w: Wr, label: string) => {
  const t = w.findAll('thead tr')[0].findAll('th').find(x => x.text() === label)
  expect(t, `表头没有「${label}」`).toBeTruthy()
  return t!
}
const fixed = (w: Wr, label: string) => th(w, label).classes().includes('lg-fix')
const st = (w: Wr, label: string) => (th(w, label).element as HTMLElement).style

// 组件自己的 <style> 塞进 document 读 getComputedStyle(同 hintFoundation.spec)
const injectCss = () => ro.injectCss('components/fp/FPLedgerTable.vue')

// jsdom 的 getComputedStyle 既不认 !important 也不比权重,只取源码里最后一条。这里照真浏览器的层叠挑
// padding-bottom(含简写 padding)的赢家:!important 先,再比权重(id / 类·属性·伪类 / 标签),再比先后。不管 @media
const weight = (sel: string) => [/#[\w-]+/g, /\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g, /(?:^|[\s>+~])[a-z][\w-]*/gi]
  .map(re => sel.match(re)?.length ?? 0)
const cmp = (a: number[], b: number[]) => a.map((x, i) => x - b[i]).find(d => d !== 0) ?? 0
function paddingBottomWinner(el: Element): string | undefined {
  let win: { key: number[]; v: string } | undefined
  let order = 0
  for (const sheet of Array.from(document.styleSheets)) for (const r of Array.from(sheet.cssRules) as CSSStyleRule[]) {
    const sels = (r.selectorText ?? '').split(',').filter(s => { try { return el.matches(s) } catch { return false } })
    if (!sels.length) continue
    const w = sels.map(weight).reduce((a, b) => (cmp(a, b) >= 0 ? a : b))
    for (let i = 0; i < r.style.length; i++) {
      const p = r.style[i]
      if (p !== 'padding' && p !== 'padding-bottom') continue
      const vs = r.style.getPropertyValue(p).trim().split(/\s+/)
      const key = [r.style.getPropertyPriority(p) === 'important' ? 1 : 0, ...w, order++]
      if (!win || cmp(key, win.key) > 0) win = { key, v: p === 'padding' ? vs[vs.length > 2 ? 2 : 0] : vs[0] }
    }
  }
  return win?.v
}

describe('月度台账固定列 · 按表格可见宽度退(07-A)', () => {
  it('700(1366 侧栏展开):只留租户 + 本月结余,其余原地变普通列', async () => {
    const w = await mountAt(700, 600)
    expect(st(w, '本月结余').position).toBe('sticky')
    expect(st(w, '本月结余').right).toBe('0px')
    expect(fixed(w, '本月结余')).toBe(true)
    expect(fixed(w, '租户')).toBe(true)
    expect(['8月结余', '本月应收合计', '本月收款', '备注'].filter(l => fixed(w, l))).toEqual([])
    expect(st(w, '本月应收合计').position).toBe('')
  })

  it('1254(1920 宽屏):收款先退;应收合计 right = 本月结余宽,收款、备注仍不固定', async () => {
    const w = await mountAt(1254, 600)
    expect(st(w, '本月结余').width).toBe('112px')
    expect(st(w, '本月应收合计').right).toBe(st(w, '本月结余').width)
    expect(st(w, '8月结余').left).toBe('140px')
    expect(fixed(w, '本月收款')).toBe(false)
    expect(fixed(w, '备注')).toBe(false)
  })

  it('3000 宽放得下:五根全固定,备注照样不固定', async () => {
    const w = await mountAt(3000, 600)
    expect(['租户', '8月结余', '本月应收合计', '本月收款', '本月结余'].filter(l => !fixed(w, l))).toEqual([])
    expect(fixed(w, '备注')).toBe(false)
    expect(st(w, '备注').position).toBe('')
  })

  it('编辑态勾选列跟租户绑在一起:租户 left = 32px,上月结余 left = 32 + 140', async () => {
    const w = await mountAt(1254, 600, { edit: true, selected: new Set() })
    expect(st(w, '租户').left).toBe('32px')
    expect(st(w, '8月结余').left).toBe('172px')
  })
})

describe('月度台账列宽 · 数字不省略、名称列封顶 1/5', () => {
  it('12,345,678.90 的结余格没有省略号,列宽 ≥ numW(112)', async () => {
    injectCss()
    const w = await mountAt(1254, 600)
    const cell = w.findAll('.lg-sumc').find(s => s.text() === '12,345,678.90')!
    expect(cell).toBeTruthy()
    expect(getComputedStyle(cell.element).textOverflow).not.toBe('ellipsis')
    const td = cell.element.closest('td') as HTMLElement
    expect(parseFloat(td.style.width)).toBeGreaterThanOrEqual(112)
  })

  it('593(1024 平板):长名字的租户列收到 floor(593/5)=118,名字本身也封在 118', async () => {
    const w = await mountAt(593, 600, { rows: [{ ...R1, tenantName: LONG }, R2] })
    expect(st(w, '租户').width).toBe('118px')
    expect((w.find('.lg-tname').element as HTMLElement).style.maxWidth).toBe('118px')
  })

  it('合计比每一行都长:上月结余按合计 103,765.43 定宽 90', async () => {
    const w = await mountAt(3000, 600)
    expect(st(w, '8月结余').width).toBe('90px')
  })

  it('整列的数都比表头短:按表头「本月应收合计」定宽 87,不窄成一条', async () => {
    const w = await mountAt(3000, 600)
    expect(st(w, '本月应收合计').width).toBe('87px')   // 数最长 3,234.56 → 76;表头 6 字×11.5 → 69+2+16
  })

  it('有未绑定行:租户列给圆点多留 8 + 间距 5', async () => {
    const w = await mountAt(3000, 600, { rows: [R1, { ...R2, tenantId: null }] })
    expect(st(w, '租户').width).toBe('153px')
  })

  it('名字省略后悬停看全称:停 500ms 出深色气泡,不用 title', async () => {
    vi.useFakeTimers()
    const w = await mountAt(593, 600, { rows: [{ ...R1, tenantName: LONG }, R2] })
    const name = w.find('.lg-tname')
    expect(name.attributes('title')).toBeUndefined()
    await name.trigger('mouseenter')
    vi.advanceTimersByTime(500)
    expect(document.querySelector('.fp-vtip')?.textContent).toContain(LONG)
  })

  it('同一张表里筛掉长数的行:列宽不缩;换月(新列模型)按新数据重算', async () => {
    const w = await mountAt(1254, 600)
    expect(st(w, '本月结余').width).toBe('112px')
    await w.setProps({ rows: [R2] })
    expect(st(w, '本月结余').width).toBe('112px')
    await w.setProps({ columns: lgColumns(9), rows: [R2] })
    expect(st(w, '本月结余').width).toBe('83px')   // -5,000.00 → ceil(9×0.6×12)+2+16
  })
})

describe('月度台账表格高度 · 不够 8 行按顺序让(07-B)', () => {
  const wrapCls = (w: Wr) => w.find('.lg-wrap').classes()

  it('表格区 400 够 8 行:什么都不让', async () => {
    const w = await mountAt(1254, 400)
    expect(wrapCls(w)).not.toContain('lg-grp-free')
    expect(wrapCls(w)).not.toContain('lg-foot-free')
  })

  it('383:只让第 2 步——分组表头不贴顶,合计照旧贴底', async () => {
    const w = await mountAt(1254, 383)
    expect(wrapCls(w)).toContain('lg-grp-free')
    expect(wrapCls(w)).not.toContain('lg-foot-free')
  })

  it('338(1366×768 露约 8.8 行):分组行和跨两行的固定表头 top:-34px、列名行 top:0、合计 bottom:auto', async () => {
    injectCss()
    const w = await mountAt(1254, 338)
    expect(wrapCls(w)).toEqual(expect.arrayContaining(['lg-grp-free', 'lg-foot-free']))
    expect(getComputedStyle(th(w, '租户').element).top).toBe('-34px')
    expect(getComputedStyle(th(w, '租金').element).top).toBe('-34px')
    expect(getComputedStyle(w.findAll('thead tr')[1].find('th').element).top).toMatch(/^0(px)?$/)
    expect(getComputedStyle(w.find('tfoot th').element).bottom).toBe('auto')
    expect((w.find('.lg-wrap').element as HTMLElement).style.minHeight).toBe('')
  })

  // 跨两行的格高 34 + 38,贴在 -34 只露下面 38:字按 middle 落在 36 上下,字顶会被切掉约 6px(07-B 列名行 38 整行可读)
  it('分组表头不贴顶时,跨两行的表头格(固定列、没固定的备注、全选框)字挪到下半格:vertical-align bottom + 下内边距 11', async () => {
    injectCss()
    const w = await mountAt(1254, 383, { edit: true, selected: new Set() })
    for (const cell of [th(w, '租户'), th(w, '本月结余'), th(w, '备注'), w.get('thead th.lg-selc')]) {
      const cs = getComputedStyle(cell.element)
      expect([cs.verticalAlign, cs.paddingBottom], cell.text() || '全选框').toEqual(['bottom', '11px'])
    }
  })

  // 上一条在 jsdom 里测不出全选框:它身上有 .lg-selc 的 padding:0 !important,th[rowspan] 那条不带 !important 就输
  it('全选框表头格按真浏览器层叠,下内边距也是 11(th[rowspan] 那条压过 .lg-selc 的 padding:0 !important)', async () => {
    injectCss()
    const w = await mountAt(1254, 383, { edit: true, selected: new Set() })
    expect(paddingBottomWinner(w.get('thead th.lg-selc').element)).toBe('11px')
  })

  it('表格区 400 贴着的时候,跨两行的表头格照旧居中', async () => {
    injectCss()
    const w = await mountAt(1254, 400)
    expect(getComputedStyle(th(w, '租户').element).verticalAlign).toBe('middle')
  })

  it('309 连 8 行都不够:表格区最少 列名 38 + 8×34 = 310 高,整页往下滚;前两步照样让着', async () => {
    const w = await mountAt(1254, 309)
    expect((w.find('.lg-wrap').element as HTMLElement).style.minHeight).toBe('310px')
    expect(wrapCls(w)).toEqual(expect.arrayContaining(['lg-grp-free', 'lg-foot-free']))
  })

  it('有 17 高的横向滚动条:最少高再加 17 = 327,滚动条不占那 8 行', async () => {
    const off = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('lg-wrap') ? 309 + 17 : 0
    })
    try {
      const w = await mountAt(1254, 309)
      expect((w.find('.lg-wrap').element as HTMLElement).style.minHeight).toBe('327px')
    } finally { off.mockRestore() }
  })
})
