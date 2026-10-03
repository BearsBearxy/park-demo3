// useWideTable(LIST-PAGE-SPEC §9、画布 07-A/07-B/07-C):固定列退列、名称列封顶、数字列宽、表格高度分级,
// 以及什么时候重算(实现规范 §2 第 3 条)。断言钉 left/right 像素,不钉配置对象。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import {
  heightStage, numW, planFixed, textW, useWideTable,
  type FixPlan, type HeightDims, type HeightStage, type WideCol,
} from '../useWideTable'
import { _resetViewportForTest } from '../useViewport'
import { stubWideTable } from './wideTableStub'

// 月度台账夹具(计划 W1「验」):DOM 顺序 租户 · 上月结余 |中间费用列| 应收合计 · 收款 · 本月结余 · (备注不传)
const LEDGER: WideCol[] = [
  { key: 'tenant', side: 'L', w: 132, rank: 0, name: true },
  { key: 'balanceStart', side: 'L', w: 116, rank: 3 },
  { key: 'receivable', side: 'R', w: 116, rank: 2 },
  { key: 'received', side: 'R', w: 116, rank: 4 },
  { key: 'balanceEnd', side: 'R', w: 116, rank: 1 },
]
// 台账高度:分组表头 34 / 列名 38 / 行 34 / 合计 40
const LEDGER_H: HeightDims = { grpH: 34, leafH: 38, rowH: 34, footH: 40 }
const keptW = (p: FixPlan) => Object.keys(p.style).reduce((s, k) => s + p.w[k], 0)

describe('planFixed — 台账夹具', () => {
  it('1254 宽:收款先退,留 4 根合计 480;右组 offset 只累加仍固定的列', () => {
    const p = planFixed(1254, LEDGER)
    expect(Object.keys(p.style).sort()).toEqual(['balanceEnd', 'balanceStart', 'receivable', 'tenant'])
    expect(keptW(p)).toBe(480)
    expect(p.style.tenant.left).toBe('0px')
    expect(p.style.balanceStart.left).toBe('132px')
    expect(p.style.balanceEnd.right).toBe('0px')
    expect(p.style.receivable.right).toBe('116px')      // 收款退了,不占 offset
    expect(p.style.received).toBeUndefined()
  })

  it('700 宽:只留租户 + 本月结余 248,阴影挪到这两根上', () => {
    const p = planFixed(700, LEDGER)
    expect(Object.keys(p.style).sort()).toEqual(['balanceEnd', 'tenant'])
    expect(keptW(p)).toBe(248)
    expect(p.style.balanceEnd.right).toBe('0px')
    expect(p.edge).toEqual({ L: 'tenant', R: 'balanceEnd' })
    expect(p.style.tenant.boxShadow).toBe('1px 0 0 var(--border-subtle)')
    expect(p.style.balanceEnd.boxShadow).toBe('-1px 0 0 var(--border-subtle)')
  })

  it('593 宽:租户封顶 floor(593/5)=118,固定合计 ≤ 237', () => {
    const p = planFixed(593, LEDGER)
    expect(p.nameW).toBe(118)
    expect(p.w.tenant).toBe(118)
    expect(keptW(p)).toBe(234)
    expect(keptW(p)).toBeLessThanOrEqual(0.4 * 593)
  })

  it('visW=0(未布局):全留,名称列不封顶', () => {
    const p = planFixed(0, LEDGER)
    expect(Object.keys(p.style)).toHaveLength(5)
    expect(p.nameW).toBe(132)
    expect(p.style.balanceEnd.right).toBe('0px')
    expect(p.style.received.right).toBe('116px')
    expect(p.style.receivable.right).toBe('232px')
  })
})

describe('planFixed — 损益附表编辑态夹具(列宽各不相同)', () => {
  // 勾选 36(rank0,随科目细分) · 分组 118 · 科目细分 216(名称) |12 个月| 本年合计 120 · (备注不传) · 填入 56
  const PNL: WideCol[] = [
    { key: 'sel', side: 'L', w: 36, rank: 0 },
    { key: 'grp', side: 'L', w: 118, rank: 2 },
    { key: 'sub', side: 'L', w: 216, rank: 0, name: true },
    { key: 'ann', side: 'R', w: 120, rank: 1 },
    { key: 'fill', side: 'R', w: 56, rank: 3 },
  ]

  it('1400 宽全留:科目细分 left = 36 + 118,本年合计 right = 填入宽', () => {
    const p = planFixed(1400, PNL)
    expect(p.style.sel.left).toBe('0px')
    expect(p.style.grp.left).toBe('36px')
    expect(p.style.sub.left).toBe('154px')
    expect(p.style.fill.right).toBe('0px')
    expect(p.style.ann.right).toBe('56px')
  })

  it('1000 宽:填入、分组退掉,科目细分 left 只累加勾选列 = 36px', () => {
    const p = planFixed(1000, PNL)
    expect(p.style.grp).toBeUndefined()
    expect(p.style.fill).toBeUndefined()
    expect(p.style.sub.left).toBe('36px')
    expect(p.style.ann.right).toBe('0px')
    expect(p.edge).toEqual({ L: 'sub', R: 'ann' })
  })

  it('rank 0 永远不退:100 宽时勾选 + 科目细分超过 40% 也照样固定', () => {
    const p = planFixed(100, PNL)
    expect(Object.keys(p.style).sort()).toEqual(['sel', 'sub'])
    expect(p.style.sub.left).toBe('36px')
  })
})

describe('planFixed — 名称列封顶的下限 minW', () => {
  const nm = (w: number, minW?: number): WideCol[] => [{ key: 'n', side: 'L', w, rank: 0, name: true, minW }]
  it('358 宽 1/5 = 71 比下限 166 窄:按下限给 166,不把名字挤成 0 宽', () => {
    expect(planFixed(358, nm(300, 166)).nameW).toBe(166)
  })
  it('内容本身比下限窄:按内容 120,下限不把列撑宽', () => {
    expect(planFixed(358, nm(120, 166)).nameW).toBe(120)
  })
  it('1/5 比下限宽:照旧封顶 1/5', () => {
    expect(planFixed(1000, nm(300, 166)).nameW).toBe(200)
  })
})

describe('heightStage — 台账尺寸 34/38/34/40', () => {
  it.each([
    [384, 0], [383, 1], [338, 2], [310, 2], [309, 3], [0, 0],
  ] as Array<[number, HeightStage]>)('可用高 %i → %i 级', (h, stage) => {
    expect(heightStage(h, LEDGER_H)).toBe(stage)
  })
})

describe('numW / textW — 不量 DOM', () => {
  it('合计串最长时按合计算宽:13 字 → ceil(13×0.6×12)+2+16 = 112', () => {
    const rows = ['1,234.00', '98,765.43']
    expect(numW([...rows, '12,345,678.90'])).toBe(112)
    expect(numW(rows)).toBe(83)
  })
  it('汉字 1em、其余 0.6em:「A座」12px 无内边距 = ceil(19.2)+2 = 22', () => {
    expect(textW(['A座'], 12, 0)).toBe(22)
    expect(textW(['联塑精锢', 'ABC有限公司'], 12.5, 20)).toBe(95)   // 5.8em×12.5=72.5 → 73+2+20
  })
  // 2026-10-03 CI 红:电费成本「公式」列把一条缺 formulaText 的指标交进来,遍历 undefined 抛错,整张表渲染失败。
  // 接口数据缺一个字段不该炸表 —— 空值按空串量(68 处调用一处兜住)。破坏验证:去掉 `?? ''` → 本条红
  it('❗缺字段(null / undefined)按空串量,不抛错', () => {
    expect(textW(['A座', undefined, null], 12, 0)).toBe(22)
    expect(numW([null, '1,234.00', undefined])).toBe(numW(['1,234.00']))
  })
})

// ── composable:RO 桩(按元素登记)+ clientWidth/clientHeight 桩,断言渲染出来的 left/right ──
let ro: ReturnType<typeof stubWideTable>
const fireRO = (w: number, hgt: number) => ro.fire(w, hgt)

beforeEach(() => { ro = stubWideTable('wrap') })
afterEach(() => {
  ro.restore()
  delete (window as { matchMedia?: unknown }).matchMedia
  _resetViewportForTest()
})

interface Probe { fix: Ref<FixPlan>; hStage: Ref<HeightStage>; sbH: Ref<number> }
function harness(cols: () => WideCol[], dataKey: Ref<unknown>, show = ref(true)) {
  const out = {} as Probe
  const Comp = defineComponent({
    setup() {
      const wrap = ref<HTMLElement | null>(null)
      const { fix, hStage, sbH } = useWideTable(wrap, cols, LEDGER_H, dataKey)
      out.fix = fix
      out.hStage = hStage
      out.sbH = sbH
      return () => show.value
        ? h('div', { class: 'wrap', ref: wrap }, cols().map(c => h('span', { 'data-k': c.key, style: fix.value.style[c.key] })))
        : h('p', '加载中')
    },
  })
  const w = mount(Comp)
  const cell = (k: string) => w.get<HTMLElement>(`[data-k="${k}"]`).element.style
  return { w, out, cell }
}

describe('useWideTable — 什么时候重算', () => {
  it('RO 量到 700:只留租户和本月结余;拖到 1254:应收合计 right 116px,收款仍不固定', async () => {
    const { cell } = harness(() => LEDGER, ref('2023-08'))
    await fireRO(700, 600)
    expect(cell('balanceEnd').right).toBe('0px')
    expect(cell('receivable').position).toBe('')
    await fireRO(1254, 600)
    expect(cell('receivable').right).toBe('116px')
    expect(cell('received').position).toBe('')
  })

  it('wrap 在 v-else 里后出现也量得到', async () => {
    const show = ref(false)
    ro.size(700, 600)
    const { cell } = harness(() => LEDGER, ref('2023-08'), show)
    show.value = true
    await nextTick()
    await nextTick()
    expect(cell('receivable').position).toBe('')
    expect(cell('balanceEnd').right).toBe('0px')
  })

  // 「宽度变了才重算」全靠 observe:只在挂载时量一次的话,拖窗口、收侧栏都不再退列、不再分级
  it('挂载后 wrap 被 observe', async () => {
    const { w } = harness(() => LEDGER, ref('2023-08'))
    await nextTick()
    expect(ro.observed()).toEqual([w.get('.wrap').element])
  })

  it('v-else 里后出现的 wrap 被 observe;被换掉的旧 wrap 被 unobserve;卸载时 disconnect', async () => {
    const show = ref(false)
    const { w } = harness(() => LEDGER, ref('2023-08'), show)
    const flip = async (v: boolean) => { show.value = v; await nextTick(); await nextTick() }
    await flip(true)
    const first = w.get('.wrap').element
    expect(ro.observed()).toEqual([first])
    await flip(false)
    expect(ro.observed()).toEqual([])
    await flip(true)
    const second = w.get('.wrap').element
    expect(second).not.toBe(first)
    expect(ro.observed()).toEqual([second])
    w.unmount()
    expect(ro.disconnected()).toBe(1)
  })

  it('KeepAlive 摘下时量到 0:保持上次的退列,不回到全留', async () => {
    const { cell } = harness(() => LEDGER, ref('2023-08'))
    await fireRO(700, 600)
    await fireRO(0, 0)
    expect(cell('receivable').position).toBe('')
  })

  // 本月结余一列的值(含合计)是编辑草稿;应收合计在它左边,right = 本月结余列宽
  function editable() {
    const vals = ref(['1,234.00', '98,765.43', '12,345,678.90'])
    const key = ref<unknown>('2023-08')
    const cols = (): WideCol[] => [
      { key: 'tenant', side: 'L', w: 132, rank: 0, name: true },
      { key: 'receivable', side: 'R', w: 116, rank: 2 },
      { key: 'balanceEnd', side: 'R', w: numW(vals.value), rank: 1 },
    ]
    return { vals, key, ...harness(cols, key) }
  }

  it('编辑把最长的数改短:列宽不缩,应收合计仍在 112px', async () => {
    const { vals, cell } = editable()
    await fireRO(1254, 600)
    expect(cell('receivable').right).toBe('112px')
    vals.value = ['1,234.00', '98,765.43', '1.00']
    await nextTick()
    expect(cell('receivable').right).toBe('112px')
  })

  it('编辑把数改长、原宽放不下:重算,应收合计挪到 134px', async () => {
    const { vals, cell } = editable()
    await fireRO(1254, 600)
    vals.value = ['1,234.00', '98,765.43', '1,234,567,890.12']
    await nextTick()
    expect(cell('receivable').right).toBe('134px')
  })

  it('换月(dataKey 变了):按新数据重算,列宽可以缩', async () => {
    const { vals, key, cell } = editable()
    await fireRO(1254, 600)
    vals.value = ['1.00', '2.00']
    await nextTick()
    expect(cell('receivable').right).toBe('112px')
    key.value = '2023-09'
    await nextTick()
    expect(cell('receivable').right).toBe(numW(['1.00', '2.00']) + 'px')
  })

  it('编辑中宽度没变:fix 还是同一个对象(整表 style 引用不变)', async () => {
    const { vals, out } = editable()
    await fireRO(1254, 600)
    const before = out.fix.value
    vals.value = ['4,321.00', '98,765.43', '12,345,678.90']
    await nextTick()
    expect(out.fix.value).toBe(before)
  })
})

describe('useWideTable — 高度分级', () => {
  it('表格区 338 → 2 级;被自己的 min-height 撑到 310 仍留 3 级;真可用高 400 才回 0 级', async () => {
    const { out } = harness(() => LEDGER, ref('k'))
    await fireRO(1254, 338)
    expect(out.hStage.value).toBe(2)
    await fireRO(1254, 309)
    expect(out.hStage.value).toBe(3)
    await fireRO(1254, 310)
    expect(out.hStage.value).toBe(3)
    await fireRO(1254, 400)
    expect(out.hStage.value).toBe(0)
  })

  it('有横向滚动条:量出滚动条高 17,不含上下边框(3 级 min-height 要加上它,才露满 8 行)', async () => {
    const off = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('wrap') ? 309 + 17 + 2 : 0
    })
    try {
      const { w, out } = harness(() => LEDGER, ref('k'))
      ;(w.element as HTMLElement).style.border = '1px solid'
      await fireRO(1254, 309)
      expect(out.hStage.value).toBe(3)
      expect(out.sbH.value).toBe(17)
    } finally { off.mockRestore() }
  })

  it('S 档(≤600):表格区再矮也恒 0 级', async () => {
    ;(window as { matchMedia?: unknown }).matchMedia = (q: string) => ({
      media: q,
      matches: /max-width:\s*(\d+)px/.test(q) && 390 <= Number(q.match(/max-width:\s*(\d+)px/)![1]),
      addEventListener() {},
      removeEventListener() {},
    })
    _resetViewportForTest()
    const { out } = harness(() => LEDGER, ref('k'))
    await fireRO(360, 200)
    expect(out.hStage.value).toBe(0)
  })
})
