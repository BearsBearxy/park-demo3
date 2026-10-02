// 园区抄表的固定列与表格高度(LIST-PAGE-SPEC §9;计划 W7,画布 07-C 园区抄表行)。
// 钉什么:先后 用途(名称列)→ 用量 → 位置 → 状态,按表格区可见宽退列(不按屏幕档);
// 读数、用量列按全量行估宽、不省略(窗口化只渲染可视行,量 DOM 会随滚动变);滚动不改列宽;
// 组头 / 合计的标签格只跨仍固定的列;表头一行 40、行 40、合计 40 分级。断言钉渲染出来的像素。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { rowsNotEndingInFill, stubWideTable } from '@/composables/__tests__/wideTableStub'
import { numW, textW } from '@/composables/useWideTable'
import MeterLedgerGrid from '@/views/meters/MeterLedgerGrid.vue'
import { buildRows, type WorkbenchRow } from '@/composables/useMeterWorkbench'
import type { MeterDTO, MeterReadingDTO } from '@/api/meters'

let seq = 0
function mkM(p: Partial<MeterDTO> = {}): MeterDTO {
  seq++
  return {
    id: seq, kind: 'elec', zone: 'p1', name: `m${seq}`, area: 'A座', spot: null,
    floorLabel: '四楼', side: '东侧', roomNo: null, locManual: 0,
    tenantName: '地下车库东侧照明', tenantId: null, buildingId: 11, buildingZone: 'p1', ownership: 'share', ownerManual: 0,
    meterType: null, deviceType: null, subName: '电表①', code: '220605000150', factor: 1,
    status: 'active', statusFrom: '2023-01', statusUntil: null, assignFrom: '2023-01', assignUntil: null,
    assignSrc: 'import', changedThisMonth: false, tenantManual: 0, bookSeen: true, bookFile: null, bookAt: null,
    suspect: null, sortNo: seq, readingCount: 3, ...p,
  }
}
function mkR(m: MeterDTO, prev: number | null, curr: number | null, usage: number | null): MeterReadingDTO {
  return {
    id: m.id * 100, meterId: m.id, ym: '2023-08', prevTotal: prev, currTotal: curr,
    prevSharp: null, prevPeak: null, prevFlat: null, prevValley: null,
    currSharp: null, currPeak: null, currFlat: null, currValley: null,
    factorSnap: m.factor, usageTotal: usage, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null,
    note: null, source: 'import',
  }
}
/** A座总电(04-A):用量 106,245.00;一块未抄 → 状态列有字 */
function rowsA(): WorkbenchRow[] {
  const ms = [mkM({ ownership: 'infra', tenantName: 'A座总电', floorLabel: null, side: null, factor: 1500 }), mkM(), mkM()]
  return buildRows(ms, [mkR(ms[0], 1138.26, 1209.09, 106245), mkR(ms[1], 452.02, 497.3, 45.28)], [], null)
}

let ro: ReturnType<typeof stubWideTable>
const mounted: VueWrapper[] = []
beforeEach(() => {
  ro = stubWideTable('mlg-scroll')
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  mounted.splice(0).forEach(w => w.unmount())
  ro.restore()                                  // 含 vi.unstubAllGlobals
})

async function open(rows: WorkbenchRow[], w: number, h: number) {
  ro.size(w, h)
  const wr = mount(MeterLedgerGrid, {
    props: {
      rows, viewKey: 'v1', editMode: false, kind: 'elec', zone: 'p1', draft: new Map(),
      buildingNameById: new Map([[11, 'A座']]), emptyText: '没有表',
    },
    attachTo: document.body,
  })
  mounted.push(wr)
  await flushPromises()
  return wr
}
const fixedHeads = (w: VueWrapper) => w.findAll('thead th.mlg-fix').map(th => th.text())
const colWidths = (w: VueWrapper) => w.findAll('colgroup col').map(c => (c.element as HTMLElement).style.width)

describe('园区抄表 · 固定列按可见宽退', () => {
  it('可见 700:只剩 用途 + 用量 固定(位置、状态原地变普通列);用途 left:0、用量 right:0', async () => {
    const w = await open(rowsA(), 700, 800)
    expect(fixedHeads(w)).toEqual(['用途', '用量'])
    const th = (t: string) => w.findAll<HTMLElement>('thead th').find(x => x.text() === t)!.element.style
    expect(th('用途').left).toBe('0px')
    expect(th('用量').right).toBe('0px')
    expect(th('位置').position).toBe('')
    expect(th('状态').position).toBe('')
  })

  it('可见 1600:四根都固定;宽度变回 700 按表格区宽重算退列(不按屏幕档)', async () => {
    const w = await open(rowsA(), 1600, 800)
    expect(fixedHeads(w)).toEqual(['位置', '用途', '用量', '状态'])
    await ro.fire(700, 800)
    expect(fixedHeads(w)).toEqual(['用途', '用量'])
  })

  it('组头 / 合计的标签格只跨仍固定的列:位置固定时跨两格;位置退了只钉在用途那一格', async () => {
    const wide = await open(rowsA(), 1600, 800)
    const lbl = (w: VueWrapper) => w.find('tr.mlg-ghead td.mlg-fix')
    expect(lbl(wide).attributes('colspan')).toBe('2')
    expect((lbl(wide).element as HTMLElement).style.left).toBe('0px')
    expect(wide.find('tfoot th.mlg-fix').attributes('colspan')).toBe('2')
    const narrow = await open(rowsA(), 700, 800)
    expect(lbl(narrow).attributes('colspan')).toBe('1')
    expect((lbl(narrow).element as HTMLElement).style.left).toBe('0px')
    expect(narrow.find('tfoot th.mlg-fix').attributes('colspan')).toBe('1')
  })
})

describe('园区抄表 · 读数列宽按全量算,不省略', () => {
  const SRC = readFileSync(join(__dirname, '../meters/MeterLedgerGrid.vue'), 'utf8')
  const css = (sel: string) => {
    const at = SRC.indexOf(`${sel} {`)
    return at < 0 ? '' : SRC.slice(at, SRC.indexOf('}', at))
  }

  it('一条 12,345.67 的读数:格里原样两位小数,列宽 ≥ numW,读数 / 用量格没有省略号', async () => {
    const [m] = [mkM()]
    const w = await open(buildRows([m], [mkR(m, 12000, 12345.67, 345.67)], [], null), 1600, 800)
    const cols = colWidths(w)
    const i = w.findAll('thead th').findIndex(th => th.text() === '本月行至')
    expect(w.findAll('tbody tr')[1].findAll('td')[i].text()).toBe('12,345.67')
    expect(parseFloat(cols[i])).toBeGreaterThanOrEqual(numW(['12,345.67'], 14, 16))
    expect(css('.mlg-nv')).not.toContain('text-overflow')
    expect(css('.mlg-sumc')).not.toContain('text-overflow')
  })

  it('滚动换窗口不改列宽:最长的数在窗口外也按它算宽', async () => {
    // 200 块表,本月行至逐块变大,最长的数(第 200 块 1,984,388.70,12 个字)首屏看不见;首屏最长只有 10 个字
    const ms = Array.from({ length: 200 }, () => mkM())
    const rows = buildRows(ms, ms.map((m, i) => mkR(m, 100, 100 + i * 9971.3, i * 9971.3)), [], null)
    const w = await open(rows, 1600, 400)
    const i = w.findAll('thead th').findIndex(th => th.text() === '本月行至')
    const before = colWidths(w)
    expect(parseFloat(before[i])).toBeGreaterThanOrEqual(numW(['1,984,388.70'], 14, 16))
    const first = () => w.findAll('tbody tr:not(.mlg-spacer):not(.mlg-ghead)')[0].findAll('td')[i].text()
    const top = first()
    const scroller = w.find('.mlg-scroll').element as HTMLElement
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: 6000 })
    await w.find('.mlg-scroll').trigger('scroll')
    await flushPromises()
    expect(first(), '前提:窗口真的换了').not.toBe(top)
    expect(colWidths(w)).toEqual(before)
  })
})

// 最右空列(LIST-PAGE §4 列宽铁律,2026-10-02 用户拍板):table-layout:fixed + colgroup,最后一根 <col> 不给宽,
// 表格区比各列合计宽时余宽全落在它身上;原来 min-width:100% 把余宽按比例摊到全部列
describe('园区抄表 · 最右空列', () => {
  // 破坏验证:colgroup 末尾那根 <col /> 删掉 → toHaveLength 那条红(12 根表头只剩 11 根 col)
  it('可见 3000:表头、组头、数据行、合计行的最右一格都是空列,colgroup 末尾一根不给宽;用途列 = 最长用途名估宽,不吃余宽', async () => {
    const w = await open(rowsA(), 3000, 800)
    expect(rowsNotEndingInFill(w.get('table.mlg-table').element)).toEqual([])
    const cols = colWidths(w)
    expect(cols).toHaveLength(w.findAll('thead th').length)
    expect(cols[cols.length - 1]).toBe('')
    expect(cols[1]).toBe(textW(['地下车库东侧照明'], 14, 20) + 'px')   // 8 个字 → 134
  })

  // 破坏验证:colCount 改回 6 + nMid + 尖峰平谷(不算空列)→ spacer 少跨一格 → 红
  it('窗口化的 spacer 行跨满整行(含最右空列)', async () => {
    const ms = Array.from({ length: 200 }, () => mkM())
    const w = await open(buildRows(ms, ms.map((m, i) => mkR(m, 100, 100 + i, i)), [], null), 3000, 400)
    const sp = w.find('tr.mlg-spacer td')
    expect(sp.exists(), '前提:200 行只渲染一窗,底下有 spacer').toBe(true)
    expect(Number(sp.attributes('colspan'))).toBe(w.findAll('thead th').length)
  })
})

describe('园区抄表 · 表格高度分级(表头 40 + 8 行 × 40 + 合计 50)', () => {
  // 合计行 50 高(04-A),0 级门槛 40 + 320 + 50 = 410
  // 破坏验证:GRID_H.footH 改回 40 → 409 也算够 → 第二条红
  it('够 410:合计贴底;409:合计不贴底;300:卡片撑到工具条 44 + 表格区 360 + 边框 2', async () => {
    const tall = await open(rowsA(), 1600, 410)
    expect(tall.find('table').classes()).not.toContain('hs-foot')
    expect((tall.element as HTMLElement).style.minHeight).toBe('')
    const mid = await open(rowsA(), 1600, 409)
    expect(mid.find('table').classes()).toContain('hs-foot')
    expect((mid.element as HTMLElement).style.minHeight).toBe('')
    const low = await open(rowsA(), 1600, 300)
    expect(low.find('table').classes()).toContain('hs-foot')
    expect((low.element as HTMLElement).style.minHeight).toBe('406px')
  })
})
