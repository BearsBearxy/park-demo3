// 园区抄表表格按画布 04-A / 04-B / 04-C 重排(计划 P4-C4 / P4-C6 / P4-C7 / T19 表格那一半)。
// 钉什么:列 = 位置/用途/房号/租户/表号/编码/倍率/上月行至/本月行至/用量/状态,尖峰平谷按比例出列(04-C);
// 状态列只写不正常的;组头兼小计、组尾停用行;row 模式点开分时段行、编辑态回车 总→峰→平→谷;
// 倒走红框 +「比上月少 X」;缺底数行「底数」输入格保住;读数两位小数;行高 40 / 正文 14 / 表头 12 / 钱列样式;
// 「本月册子没有」是 FPMark、悬停走 v-tip,表里没有原生 title。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import MeterLedgerGrid from '@/views/meters/MeterLedgerGrid.vue'
import FPTableTools from '@/components/fp/FPTableTools.vue'
import { buildRows, type MeterDraft, type WorkbenchRow } from '@/composables/useMeterWorkbench'
import type { MeterDTO, MeterReadingDTO } from '@/api/meters'

let seq = 0
function mkM(p: Partial<MeterDTO> = {}): MeterDTO {
  seq++
  return {
    id: seq, kind: 'elec', zone: 'p1', name: `m${seq}`, area: 'A座', spot: null,
    floorLabel: '一楼', side: null, roomNo: null, locManual: 0,
    tenantName: `公共照明${seq}`, tenantId: null, buildingId: 11, buildingZone: 'p1', ownership: 'share', ownerManual: 0,
    meterType: null, deviceType: null, subName: '电表①', code: '220605000150', factor: 1,
    status: 'active', statusFrom: '2023-01', statusUntil: null, assignFrom: '2023-01', assignUntil: null,
    assignSrc: 'import', changedThisMonth: false, tenantManual: 0, bookSeen: true, bookFile: '八月抄表.xlsx',
    bookAt: '2023-09-02T10:00:00', suspect: null, sortNo: seq, readingCount: 3, ...p,
  }
}
function mkR(m: MeterDTO, p: Partial<MeterReadingDTO> = {}): MeterReadingDTO {
  return {
    id: m.id * 100, meterId: m.id, ym: '2023-08', prevTotal: null, currTotal: null,
    prevSharp: null, prevPeak: null, prevFlat: null, prevValley: null,
    currSharp: null, currPeak: null, currFlat: null, currValley: null,
    factorSnap: m.factor, usageTotal: null, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null,
    note: null, source: 'import', ...p,
  }
}
/** 一块已抄的平价表:上月 452.02 → 本月 497.3(画布 04-A 地下车库东侧照明) */
const flat = (m: MeterDTO) => mkR(m, { prevTotal: 452.02, currTotal: 497.3, usageTotal: 45.28 })
/** 一块分时表:A座总电 峰/平/谷有数、尖空(04-A) */
const tou = (m: MeterDTO) => mkR(m, {
  prevTotal: 1138.26, currTotal: 1209.09, usageTotal: 106245,
  prevPeak: 335.88, currPeak: 357.5, prevFlat: 586.78, currFlat: 625.15, prevValley: 215.59, currValley: 226.43,
  usagePeak: 32430, usageFlat: 57555, usageValley: 16260,
})

const NAMES = new Map([[11, 'A座'], [12, 'B座']])
interface Opts {
  edit?: boolean; draft?: Map<number, MeterDraft>; zone?: string; kind?: string
  touBase?: WorkbenchRow[]; retiredOpen?: boolean
}
const mounted: VueWrapper[] = []
async function mountGrid(rows: WorkbenchRow[], o: Opts = {}) {
  const w = mount(MeterLedgerGrid, {
    props: {
      rows, viewKey: 'v1', editMode: o.edit ?? false, kind: o.kind ?? 'elec', zone: o.zone ?? 'p1',
      draft: o.draft ?? new Map(), buildingNameById: NAMES, emptyText: '没有表',
      touBase: o.touBase, retiredOpen: o.retiredOpen,
    },
    attachTo: document.body,
  })
  mounted.push(w)
  await flushPromises()                              // onMounted 建窗口后才渲染行
  return w
}
beforeEach(() => { localStorage.clear() })
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()) })

const heads = (w: VueWrapper) => w.findAll('thead th').map(th => th.text())
const dataRows = (w: VueWrapper) => w.findAll('tbody tr').filter(tr =>
  !tr.classes().some(c => ['mlg-ghead', 'mlg-segr', 'mlg-retr', 'mlg-spacer'].includes(c)))
/** 某一行某一列的格(列名按表头找) */
function cell(w: VueWrapper, tr: ReturnType<typeof dataRows>[number], col: string) {
  const i = heads(w).indexOf(col)
  expect(i, `表头里有「${col}」`).toBeGreaterThanOrEqual(0)
  return tr.findAll('td')[i]
}
type TipEl = HTMLElement & { _tip?: { text: string } }

describe('P4-C4 · 列:位置合列、分时按比例、状态只写不正常', () => {
  it('没有分时表(04-C 宿舍):11 列,表头不出尖峰平谷,卡内也没有分时开关', async () => {
    const ms = [mkM(), mkM(), mkM()]
    const w = await mountGrid(buildRows(ms, ms.map(flat), [], null))
    expect(heads(w)).toEqual(['位置', '用途', '房号', '租户', '表号', '编码', '倍率', '上月行至', '本月行至', '用量', '状态'])
    expect(w.findAll('[role="switch"]')).toHaveLength(0)
    expect(w.find('.fp-tt-cols').exists(), '列菜单照出').toBe(true)
  })

  it('过半是分时表(04-C 二期 63/69):默认在「本月行至」后出 尖/峰/平/谷,值是本月各段行至', async () => {
    const ms = [mkM(), mkM(), mkM(), mkM()]
    const w = await mountGrid(buildRows(ms, [tou(ms[0]), tou(ms[1]), tou(ms[2]), flat(ms[3])], [], null))
    const h = heads(w)
    expect(h.slice(h.indexOf('本月行至'), h.indexOf('用量') + 1)).toEqual(['本月行至', '尖', '峰', '平', '谷', '用量'])
    expect(w.find('[role="switch"]').attributes('aria-checked')).toBe('true')
    const tr = dataRows(w)[0]
    expect(cell(w, tr, '峰').text()).toBe('357.50')
    expect(cell(w, tr, '尖').text()).toBe('–')
  })

  it('少数是分时表(04-C 一期 49/184):默认不出列;开关打开出列并记住', async () => {
    const ms = [mkM(), mkM(), mkM(), mkM()]
    const w = await mountGrid(buildRows(ms, [tou(ms[0]), flat(ms[1]), flat(ms[2]), flat(ms[3])], [], null))
    expect(heads(w)).not.toContain('尖')
    const sw = w.find('[role="switch"]')
    expect(sw.attributes('aria-checked')).toBe('false')
    await sw.trigger('click')
    expect(heads(w)).toContain('尖')
    expect(localStorage.getItem('fp-tou-meter')).toBe('1')
  })

  it('状态列:已抄留空,未抄写「未抄」', async () => {
    const [a, b] = [mkM({ ownership: 'tenant', tenantId: 5 }), mkM({ ownership: 'tenant', tenantId: 6 })]
    const w = await mountGrid(buildRows([a, b], [flat(a)], [], null, new Map([[5, '旭化成'], [6, '联塑精铟']])))
    const [ra, rb] = dataRows(w)
    expect(cell(w, ra, '状态').text()).toBe('')
    expect(cell(w, rb, '状态').text()).toBe('未抄')
  })

  it('位置 = 楼层·方位(不再有「区域」列);「新表」拆成小签;归属写成签;合计不写已抄 / 未抄', async () => {
    const a = mkM({ floorLabel: '四楼', side: '东侧', subName: '电表①新表', ownership: 'infra' })
    const w = await mountGrid(buildRows([a], [flat(a)], [], null))
    const tr = dataRows(w)[0]
    expect(cell(w, tr, '位置').text()).toBe('四楼东侧')
    expect(cell(w, tr, '表号').find('.mlg-tag').text()).toBe('新表')
    expect(cell(w, tr, '表号').text().replace('新表', '')).toBe('电表①')
    expect(cell(w, tr, '租户').find('.mlg-tag').text()).toBe('配电总表')
    const foot = w.find('tfoot').text()
    expect(foot).toContain('合计')
    expect(foot).toContain('45.28')
    expect(foot).not.toMatch(/已抄|未抄/)
  })

  it('缺底数的行编辑态「上月行至」是「底数」输入格,有底数的行不开', async () => {
    const [a, b] = [mkM(), mkM()]
    const w = await mountGrid(buildRows([a, b], [flat(a), mkR(b, { currTotal: 120 })], [], null), { edit: true })
    const base = w.findAll('input[data-pi="0"]')
    expect(base).toHaveLength(1)
    expect(base[0].attributes('placeholder')).toBe('底数')
    expect(base[0].element.closest('tr')!.textContent).toContain(b.tenantName!)
  })
})

describe('对抗复查 · 按比例出列的分母、停用表、租户列(regress-2 / regress-3 / asserts-1)', () => {
  // 破坏验证:tm 改回只按 props.rows 算(去掉 `props.touBase ??`)→ 两块平价表 → 'none' → 不出列、没有开关 → 红
  it('分母按 touBase 算:rows 只剩 2 块平价表(切到「未抄」),touBase 5 块里 3 块分时 → 照样出尖峰平谷、开关开着', async () => {
    const ms = [mkM(), mkM(), mkM(), mkM(), mkM()]
    const all = buildRows(ms, [tou(ms[0]), tou(ms[1]), tou(ms[2]), flat(ms[3]), flat(ms[4])], [], null)
    const w = await mountGrid(all.slice(3), { touBase: all })
    expect(heads(w)).toContain('尖')
    expect(w.find('[role="switch"]').attributes('aria-checked')).toBe('true')
  })

  // 破坏验证:flattenGroups 不认 retiredOpen(停用的表照样收进组尾)→ 数据行 0 → 红
  it('筛选本身在找停用表(retiredOpen):停用的表直接排进组里、算进块数,没有组尾「另有 N 块已停用」', async () => {
    const offs = [mkM({ status: 'retired', statusFrom: '2023-05' }), mkM({ status: 'retired', statusFrom: '2023-06' })]
    const w = await mountGrid(buildRows(offs, offs.map(flat), [], null), { retiredOpen: true })
    expect(dataRows(w)).toHaveLength(2)
    expect(w.find('tr.mlg-ghead').text()).toContain('2 块')
    expect(w.find('tr.mlg-retr').exists()).toBe(false)
  })

  // 破坏验证:toolCols 不剔 'ten' → 列菜单里有「租户」→ 第一条红;show.ten 不恒真 → 藏了以后点不开 → 第二条红
  it('「租户」不进列菜单、藏不掉:其余四列全藏,点租户格照样开详情抽屉', async () => {
    const a = mkM({ ownership: 'tenant', tenantId: 5 })
    const w = await mountGrid(buildRows([a], [flat(a)], [], null, new Map([[5, '旭化成']])))
    const tools = w.findComponent(FPTableTools)
    expect((tools.props('columns') as { label: string }[]).map(c => c.label)).toEqual(['房号', '表号', '编码', '倍率'])
    tools.vm.$emit('update:hidden', ['room', 'sub', 'code', 'fac', 'ten'])
    await flushPromises()
    expect(heads(w)).toEqual(['位置', '用途', '租户', '上月行至', '本月行至', '用量', '状态'])
    await w.find('.mlg-tname').trigger('click')
    expect(w.emitted('open')).toEqual([[a.id]])
  })
})

describe('P4-C5 · 组头兼小计、组尾停用行(表格接线)', () => {
  it('组头写「A座 N 块」+ 组用量;点它收起;组尾点「显示」停用的表才进来', async () => {
    const a = mkM({ ownership: 'tenant', tenantId: 5 })
    const b = mkM()
    const off = mkM({ status: 'retired', statusFrom: '2023-05' })
    const w = await mountGrid(buildRows([a, b, off], [flat(a), flat(b)], [], null))
    const gh = w.find('tr.mlg-ghead')
    expect(gh.text()).toContain('A座')
    expect(gh.text()).toContain('2 块')
    expect(gh.find('.mlg-sumc').text()).toBe('90.56')          // 45.28 × 2
    expect(dataRows(w)).toHaveLength(2)
    expect(w.find('tr.mlg-retr').text()).toContain('另有 1 块已停用')
    await w.find('tr.mlg-retr button').trigger('click')
    await flushPromises()
    expect(dataRows(w)).toHaveLength(3)
    await gh.find('button').trigger('click')
    await flushPromises()
    expect(dataRows(w)).toHaveLength(0)
    expect(w.find('tr.mlg-retr').exists()).toBe(false)
  })

  it('row 模式:分时表那一行 › 点开出 峰段 / 平段 / 谷段,值是各段上月 / 本月 / 用量', async () => {
    const ms = [mkM(), mkM(), mkM()]
    const w = await mountGrid(buildRows(ms, [tou(ms[0]), flat(ms[1]), flat(ms[2])], [], null))
    expect(w.findAll('.mlg-exp')).toHaveLength(1)
    await w.find('.mlg-exp').trigger('click')
    await flushPromises()
    const segs = w.findAll('tr.mlg-segr')
    expect(segs.map(s => s.find('.mlg-seglbl').text())).toEqual(['峰段', '平段', '谷段'])
    expect(segs[0].findAll('.mlg-nv').map(c => c.text())).toEqual(['335.88', '357.50'])
    expect(segs[0].find('.mlg-sumc').text()).toBe('32,430.00')
  })
})

describe('P4-C6 · 编辑态分时录入与倒走', () => {
  it('分时表总格回车 → 同表峰段 → 平段 → 谷段 → 下一块表的总', async () => {
    const ms = [mkM(), mkM(), mkM()]
    const w = await mountGrid(buildRows(ms, [tou(ms[0]), flat(ms[1]), flat(ms[2])], [], null), { edit: true })
    await w.find('.mlg-exp').trigger('click')
    await flushPromises()
    const totals = () => w.findAll('input[data-si="0"]')
    const [tot, peak, flatSeg, valley, next] = totals()
    expect(peak.element.closest('tr')!.textContent).toContain('峰段')
    await tot.trigger('keydown', { key: 'Enter' })
    expect(document.activeElement).toBe(peak.element)
    await peak.trigger('keydown', { key: 'Enter' })
    expect(document.activeElement).toBe(flatSeg.element)
    await flatSeg.trigger('keydown', { key: 'Enter' })
    expect(document.activeElement, '平段 → 谷段').toBe(valley.element)
    await valley.trigger('keydown', { key: 'Enter' })
    expect(document.activeElement).toBe(next.element)
    expect(next.element.closest('tr')!.textContent).toContain(ms[1].tenantName!)
  })

  // 破坏验证:touCols 的输入格 data-si 写成 0(不按列序)→ 总格回车直接跳下一块表 → 红
  it('按比例出列打开时(过半是分时表):同一行 总 → 尖 → 峰 → 平 → 谷,再到下一块表的总(P4-C6)', async () => {
    const ms = [mkM(), mkM(), mkM(), mkM()]
    const w = await mountGrid(buildRows(ms, [tou(ms[0]), tou(ms[1]), tou(ms[2]), flat(ms[3])], [], null), { edit: true })
    const [r0, r1] = dataRows(w)
    const cells = r0.findAll('input.mlg-ni')
    expect(cells.map(c => heads(w)[c.element.closest('td')!.cellIndex]), '前提:这一行的输入格').toEqual(['本月行至', '尖', '峰', '平', '谷'])
    for (let i = 0; i < 4; i++) {
      await cells[i].trigger('keydown', { key: 'Enter' })
      expect(document.activeElement, `第 ${i} 格回车`).toBe(cells[i + 1].element)
    }
    await cells[4].trigger('keydown', { key: 'Enter' })
    expect(document.activeElement, '谷 → 下一块表的总').toBe(r1.find('input.mlg-ni').element)
  })

  it('草稿本月比上月少 1.43(04-B 联塑精铟 101.23 → 99.8):本月格红框、用量 −28.60、状态「比上月少 1.43」', async () => {
    const a = mkM({ factor: 20 })
    const draft = new Map<number, MeterDraft>([[a.id, { currTotal: '99.8' }]])
    const w = await mountGrid(buildRows([a], [mkR(a, { prevTotal: 101.23, currTotal: 104.88, usageTotal: 73 })], [], null),
      { edit: true, draft })
    const tr = dataRows(w)[0]
    expect(cell(w, tr, '状态').text()).toBe('比上月少 1.43')
    expect(cell(w, tr, '本月行至').find('input').classes()).toContain('bad')
    expect(cell(w, tr, '用量').text()).toBe('-28.60')
  })
})

describe('P4-C7 · 字距与行(03-C 同一套)', () => {
  it('上月 452.02 / 本月 497.3 → 本月格「497.30」,读数两位小数', async () => {
    const a = mkM()
    const w = await mountGrid(buildRows([a], [flat(a)], [], null))
    const tr = dataRows(w)[0]
    expect(cell(w, tr, '上月行至').text()).toBe('452.02')
    expect(cell(w, tr, '本月行至').text()).toBe('497.30')
    expect(cell(w, tr, '用量').text()).toBe('45.28')
  })

  describe('样式(把组件自己的 <style> 塞进 document 读 getComputedStyle)', () => {
    const SRC = readFileSync(join(__dirname, '../meters/MeterLedgerGrid.vue'), 'utf8')
    const TOKENS = readFileSync(join(__dirname, '../../styles/tokens.css'), 'utf8')
    let style: HTMLStyleElement
    beforeEach(() => {
      style = document.createElement('style')
      style.textContent = [...SRC.matchAll(/^<style[^>]*>([\s\S]*?)^<\/style>/gm)].map(m => m[1]).join('\n')
      document.head.appendChild(style)
    })
    afterEach(() => style.remove())

    // 破坏验证(逐条):数据格底改回 --info-soft 那一式 / 表头字改回 muted / 组头钱格去掉混灰底 / 组小计改回加粗正文色 /
    //   合计行改回 40 高、合计数不设 16 / 竖线 .vl 删掉 → 各自那条红
    it('行高 40、正文 14、表头 12、无字距;钱列加粗、字不用蓝、浅底、表头下蓝线(03-A / 04-A / 05-A 同形)', async () => {
      const a = mkM()
      const w = await mountGrid(buildRows([a], [flat(a)], [], null))
      const cs = (sel: string) => getComputedStyle(w.find(sel).element)
      expect(TOKENS).toMatch(/--fs-body:\s*14px/)
      expect(TOKENS).toMatch(/--fs-label:\s*12px/)
      expect(cs('.mlg-table').fontSize).toBe('var(--fs-body)')
      expect(cs('.mlg-table').letterSpacing).toBe('0')
      expect(cs('thead th').fontSize).toBe('var(--fs-label)')
      const td = dataRows(w)[0].find('td').element
      expect(getComputedStyle(td).height).toBe('40px')
      const money = dataRows(w)[0].find('td.mlg-money')
      expect(getComputedStyle(money.element).getPropertyValue('background')).toBe('var(--money-cell)')
      expect(cs('.mlg-table').getPropertyValue('--money-cell').trim()).toBe('color-mix(in srgb, var(--accent-blue) 60%, var(--surface-white))')
      const sumc = getComputedStyle(money.find('.mlg-sumc').element)
      expect(sumc.fontWeight).toBe('var(--fw-semibold)')
      expect(sumc.color).toBe('var(--text-primary)')
      expect(cs('thead th.mlg-money').getPropertyValue('border-bottom-color')).toBe('var(--hue-blue)')
      expect(cs('thead th.mlg-money').getPropertyValue('border-bottom-width')).toBe('2px')
      expect(cs('thead th.mlg-money').color, '钱列表头字 = 次要色').toBe('var(--text-secondary)')
      // 组头:钱格混灰底,组小计常规字重 + 次要色
      expect(cs('tr.mlg-ghead td.mlg-money').getPropertyValue('background')).toBe('var(--money-cell-grp)')
      expect(cs('.mlg-table').getPropertyValue('--money-cell-grp').trim()).toBe('color-mix(in srgb, var(--money-cell) 40%, var(--surface-card))')
      expect([cs('tr.mlg-ghead .mlg-sumc').fontWeight, cs('tr.mlg-ghead .mlg-sumc').color]).toEqual(['var(--fw-regular)', 'var(--text-secondary)'])
      // 合计行 50 高、合计数 16,合计钱格同数据格(04-A)
      expect(cs('tfoot th').height).toBe('50px')
      expect(cs('tfoot .mlg-foot-v').fontSize).toBe('16px')
      expect(cs('tfoot th.mlg-money').getPropertyValue('background')).toBe('var(--money-cell)')
      // 列组竖线(规范 §2-28):上月行至 / 本月行至 两列左边
      const vl = dataRows(w)[0].findAll('td.vl').map(t => heads(w)[(t.element as HTMLTableCellElement).cellIndex])
      expect(vl.slice(0, 2)).toEqual(["上月行至", "本月行至"])
      expect(cs('tbody td.vl').borderLeftWidth + ' ' + cs('tbody td.vl').borderLeftColor).toBe('1px var(--divider)')
    })
  })
})

describe('T19 · 表格里的提示件', () => {
  it('「本月册子没有」是就地标记 FPMark(橙点 + 字),悬停走 v-tip;整张表没有原生 title', async () => {
    const [a, b] = [mkM({ bookSeen: false, assignSrc: 'migrate', assignFrom: '1900-01' }), mkM()]
    const w = await mountGrid(buildRows([a, b], [flat(a), flat(b)], [], null))
    const mark = w.find('.mlg-book')
    expect(mark.classes()).toContain('fp-mark')
    expect(mark.find('.dot').exists()).toBe(true)
    expect(mark.text()).toBe('本月册子没有')
    expect((mark.element as TipEl)._tip?.text).toBe('这个月导入的册子里没有这块表;显示的是最早那一行(按旧档案补记)')
    expect(w.findAll('[title]')).toHaveLength(0)
  })
})
