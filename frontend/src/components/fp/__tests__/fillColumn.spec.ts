// 表格最右空列(列宽铁律,2026-10-02 用户拍板,画布 09/10;LIST-PAGE-SPEC §4)—— 共享组件门禁。
//
// 规则:各列按内容定宽、挨在一起;表格比内容宽出来的余宽统一落进每行末尾一格空列
// (<td|th class="fp-fill" aria-hidden="true">,base.css 给它 width:100%),不再交给某一列文字列吸收,
// 也不再按比例摊进各列。auto 布局里有这一列时,别的列的 width / <col> px 宽会被压回内容宽 ——
// 要锁宽的列得写 min-width(Chrome 实测:th width:200 → 58,min-width:120 → 照给)。
//
// jsdom 不做表格布局,「余宽落在哪」量不出来;这里钉的是让浏览器这样排的三样东西:
//   ① 空列在每一种行的最末、只有一格、读屏读不到;② base.css 那条规则;③ 定宽列的宽写在 min-width 上。
// .ak-tbl 这一族用 tr::after 生成同一格(不进 DOM),只能读 CSS 源码断言。
import { describe, it, expect } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaBlock } from '@/test-utils/mediaBlock'
import FPSortableTable from '../FPSortableTable.vue'
import FinReportTable, { type FinTableRow } from '@/components/fin/FinReportTable.vue'
import TbTable from '@/views/reports/trial-balance/TbTable.vue'
import { TB_FIELDS, type TbFieldKey } from '@/reports/trialBalance'

const SRC = join(__dirname, '../../..')
const read = (p: string) => readFileSync(join(SRC, p), 'utf8').replace(/\r\n/g, '\n')
const styleOf = (sfc: string) => sfc.slice(sfc.indexOf('<style scoped>'), sfc.lastIndexOf('</style>'))

/** 每一行(表头 / 表体 / 表尾)最后一格是空列,且整行只有这一格。 */
function expectFillerLast(w: VueWrapper, rowSel = 'tr') {
  const trs = w.findAll(rowSel)
  expect(trs.length).toBeGreaterThan(0)
  for (const tr of trs) {
    const cells = tr.findAll('th, td')
    const last = cells.at(-1)!
    expect(last.classes(), `「${tr.text().slice(0, 12)}」这一行末尾不是空列`).toContain('fp-fill')
    expect(last.attributes('aria-hidden')).toBe('true')
    expect(last.text()).toBe('')
    expect(tr.findAll('.fp-fill')).toHaveLength(1)
  }
}

describe('base.css .fp-fill', () => {
  // 破坏验证:width:100% 删掉 → 红(空列不吃余宽,余宽又按比例摊回各列)
  it('❗空列吃掉全部余宽、自己不带内边距和最小宽(scoped 的 td/th 规则特异度更高,要 !important)', () => {
    const rule = read('styles/base.css').match(/\.fp-fill\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/width:\s*100%/)
    expect(rule).toMatch(/padding:\s*0\s*!important/)
    expect(rule).toMatch(/min-width:\s*0\s*!important/)
  })
})

describe('FPSortableTable(楼栋 / 租户 / 账号 / 导入中心)', () => {
  const COLS = [
    { key: 'name', header: '楼栋' },                                  // 名称列:不给宽 = 按内容
    { key: 'area', header: '面积', width: '104px', align: 'right' as const, mono: true },
  ]
  const ROWS = [{ id: 1, name: '2 号厂房', area: '9,000' }, { id: 2, name: '5 号厂房', area: '6,000' }]
  const open = () => mount(FPSortableTable, { props: { columns: COLS, rows: ROWS, skeletonRows: 1 } })

  // 破坏验证:删掉表头 / 骨架行 / 数据行三处 <… class="fp-fill"> 任一处 → 红
  it('❗表头、骨架行、数据行末尾各一格空列', () => {
    const w = open()
    expect(w.findAll('tbody tr')).toHaveLength(3)                     // 骨架 1 + 数据 2
    expectFillerLast(w)
  })

  // 破坏验证:th 的 minWidth: c.width 删掉 → 红(有空列时 width 会被压回内容宽,定宽列就不定了)
  it('❗定宽列的宽同时写在 min-width 上;名称列不给宽(按内容,不吸收余宽)', () => {
    const ths = open().findAll('thead th:not(.fp-fill)').map(th => (th.element as HTMLElement).style)
    expect(ths[1].width).toBe('104px')
    expect(ths[1].minWidth).toBe('104px')
    expect(ths[0].width).toBe('')
    expect(ths[0].minWidth).toBe('')
  })
})

describe('FinReportTable(资产负债表左右两张 + 利润表)', () => {
  const ROWS: FinTableRow[] = [
    { key: 1, no: 1, label: '一、营业收入', level: 0, type: 'normal' },
    { key: 'isc-1', label: '一期租户', level: 1, type: 'normal', custom: true, canAddChild: true },
    { key: 21, no: 21, label: '二、营业利润', level: 0, type: 'subtotal', strong: true },
  ]
  const COLUMNS = [{ key: 'cur', label: '本月金额' }, { key: 'ytd', label: '本年累计金额' }]
  const open = (editable: boolean) => mount(FinReportTable, {
    props: { rows: ROWS, columns: COLUMNS, valueOf: () => 0, editable, selectable: editable, selected: new Set<string | number>() },
  })
  const SFC = read('components/fin/FinReportTable.vue')
  const STYLE = styleOf(SFC)

  // 破坏验证:删掉表头或行里的 .fp-fill → 红
  it('❗查看态、编辑态(多一根勾选列)每一行末尾都是空列', () => {
    expectFillerLast(open(false))
    expectFillerLast(open(true))
  })

  // 破坏验证:任一条 min-width 改掉或删掉 → 红;colgroup 改了宽没跟上 → 红
  it('❗定宽列(勾选 / 行次 / 金额)的宽写在表头 min-width 上,与 colgroup 同一个数', () => {
    const colW = (re: RegExp) => SFC.match(re)?.[1]
    const minW = (cls: string) => STYLE.match(new RegExp(`\\.fin-table thead th\\.${cls}\\s*\\{\\s*min-width:\\s*(\\d+)px`))?.[1]
    expect(minW('fin-ckcell')).toBe(colW(/<col v-if="selectable" style="width:(\d+)px"/))
    expect(minW('fin-noh')).toBe(colW(/<col style="width:(\d+)px" \/>\n\s*<col v-for/))
    expect(minW('fin-amt')).toBe(colW(/<col v-for="c in columns" :key="c.key" style="width:(\d+)px"/))
    // 项目列 col 是 auto —— 按最长的行名定宽,不吸收余宽
    expect(SFC).toMatch(/<col style="width:auto" \/>/)
  })

  // 破坏验证:+/× 改回 display:none ↔ display:grid 切换 → 红(悬停那一行会把项目列撑宽、整表右移)
  it('❗行内 +/× 平时占位不显形(visibility),悬停不改列宽', () => {
    expect(STYLE).toMatch(/\.fin-rowlabel \.custom-x \{[^}]*display:grid;\s*visibility:hidden/)
    expect(STYLE).toMatch(/\.fin-rowlabel \.addchild \{[^}]*display:grid;\s*visibility:hidden/)
    expect(STYLE).toMatch(/tr:hover \.fin-rowlabel \.custom-x \{\s*visibility:visible;\s*\}/)
    expect(STYLE).not.toMatch(/\.custom-x[^{]*\{[^}]*display:none/)
  })
})

describe('TbTable(科目余额表)', () => {
  const ROWS = [
    { rowKey: 'a', parentKey: null, code: '1001', label: '库存现金', level: 0, sortOrder: 1 },
    { rowKey: 'b', parentKey: null, code: '1002', label: '银行存款', level: 0, sortOrder: 2 },
  ]
  const totals = Object.fromEntries(TB_FIELDS.map(f => [f.key, 0])) as Record<TbFieldKey, number>
  const open = () => mount(TbTable, {
    props: { rows: ROWS, expanded: new Set<string>(), parents: new Set<string>(), totals, valueOf: () => 0, editable: false },
  })
  const STYLE = styleOf(read('views/reports/trial-balance/TbTable.vue'))

  // 破坏验证:删掉表体或合计行的 .fp-fill → 红;表头那格去掉 rowspan / h1 → 红(滚动时它不吸顶)
  it('❗表体、合计尾行末尾各一格空列;表头那格跨两行、跟着吸顶', () => {
    const w = open()
    expectFillerLast(w, 'tbody tr')
    expectFillerLast(w, 'tfoot tr')
    const head = w.find('thead tr').findAll('th').at(-1)!
    expect(head.classes()).toEqual(expect.arrayContaining(['fp-fill', 'h1']))
    expect(head.attributes('rowspan')).toBe('2')
    expect(head.attributes('aria-hidden')).toBe('true')
    expect(w.findAll('thead tr')[1].findAll('.fp-fill')).toHaveLength(0)
  })

  // 破坏验证:min-width:1240 加回 → 红(窄屏横滚时空列还占着 1240 − 内容宽);金额列 min-width 删掉 → 红
  it('❗表不再给 min-width:1240;代码 / 金额列宽写在表头 min-width 上', () => {
    expect(STYLE).not.toMatch(/min-width:\s*1240px/)
    expect(STYLE).toMatch(/\.fin-table thead th\.tb-codeh \{ min-width:96px; \}/)
    expect(STYLE).toMatch(/\.fin-table thead th\.h2 \{ min-width:128px; \}/)
    expect(STYLE).toMatch(/\.tb-x \{[^}]*display:grid;\s*visibility:hidden/)
  })
})

describe('附表水电 / 充电 / 光伏 / 电费(定宽表)', () => {
  const FILES = [
    ['views/utilities/UtilitiesTable.vue', 'ut'],
    ['views/charging/ChargingTable.vue', 'ch'],
    ['views/pv/PvTable.vue', 's6'],
    ['views/elec/ElecTable.vue', 'e11'],
  ] as const

  // 破坏验证:任一张表的 min-width:880 / 900 / 1040 加回 → 红(表格比内容宽、要横滚时,多出来的那段全是空列)
  it.each(FILES)('❗%s:表格不给 px 保底宽', (f, cls) => {
    const rule = styleOf(read(f)).match(new RegExp(`\\.${cls}-table \\{([^}]*)\\}`))?.[1] ?? ''
    expect(rule).toMatch(/width:100%/)
    expect(rule).not.toMatch(/min-width/)
  })

  // 破坏验证:任一张表的 :deep(.lc-note-in) 那条删掉 → 红(width:100% 的输入框不撑列,编辑态备注列缩回表头的 150)
  it.each(FILES)('❗%s:编辑态备注框按自身默认宽撑列', (f, cls) => {
    expect(styleOf(read(f))).toContain(`.${cls}-table :deep(.lc-note-in) { width:auto; min-width:100%; }`)
  })
})

describe('.ak-tbl(分析层 17 张表,ana.css)', () => {
  const ANA = read('components/ana/ana.css')

  // 破坏验证:tr::after 那条删掉或 width 改掉 → 红;hover 那条删掉 → 第二段红
  it('❗每一行用 tr::after 生成行末空列:table-cell、吃满余宽、带行线;悬停同底色', () => {
    const rule = ANA.match(/\.ak-tbl tr::after \{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/content:\s*''/)
    expect(rule).toMatch(/display:\s*table-cell/)
    expect(rule).toMatch(/width:\s*100%/)
    expect(rule).toMatch(/border-bottom:\s*1px solid var\(--divider\)/)
    expect(ANA).toMatch(/\.ak-tbl tbody tr:hover::after \{ background:var\(--surface-card\); \}/)
  })

  // 破坏验证:ChurnView / ExpiryView 吸顶规则去掉 thead tr::after → 红;Expiry S 档 content:none 删掉 → 红(行卡多出一格网格项)
  it('❗表头吸顶的两屏,空列那格跟着吸顶;Expiry 窄档行卡把它撤掉', () => {
    const churn = read('views/analysis/ChurnView.vue')
    const expiry = read('views/analysis/ExpiryView.vue')
    expect(churn).toMatch(/\.churn-scroll thead th, \.churn-scroll thead tr::after \{ position: sticky; top: 0;/)
    expect(expiry).toMatch(/\.exp-scroll thead th, \.exp-scroll thead tr::after \{ position: sticky; top: 0;/)
    expect(mediaBlock(styleOf(expiry), '@media (max-width: 600px)')).toMatch(/\.exp-rc tr::after \{ content: none; \}/)
  })

  // 破坏验证:FinBalanceView 的 .fb-flash::after 删掉 → 红(点环图扇区定位的那一行,高亮在最后一列右边断开)
  it('❗资产负债表定位闪烁:行末空列那格跟着行一起闪', () => {
    expect(styleOf(read('views/analysis/FinBalanceView.vue')))
      .toMatch(/\.fb-flash td, \.fb-flash::after \{ animation: fbflash /)
  })
})
