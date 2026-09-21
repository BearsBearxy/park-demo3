// src/components/fin/__tests__/finStickyS.spec.ts —— 报表表 S 档首列 sticky 的门禁
// (稿 ReportPhone §1 右栏 box2 / 规范 RESPONSIVE-LAYOUT-SPEC §5.3)。
//
// 为什么钉这些:三大报表不卡片化(§5.3 名单),手机上就是横滚看,滚到最右还能认出行 ——
// 全靠「项目」那一根粘住。规范同一句还写死「sticky 只留一根首列」:S10 左右两根 316px、
// PnlTable 370px 是实测教训,两根在 390 上就把视口吃光。所以这里同时钉住
// **有一根** 和 **只有一根**,以及 **宽档一条规则都不落**(1440 零差异)。
//
// CSS 侧的三条只能读源码断言:jsdom 不做布局、不跑 @media,computed style 永远读不到这些。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { mediaBlock } from '@/test-utils/mediaBlock'
import { join } from 'node:path'
import FinReportTable, { type FinTableRow, type FinTableColumn } from '../FinReportTable.vue'

const SRC = readFileSync(join(__dirname, '../FinReportTable.vue'), 'utf8')
// 注释先剥掉:下面要数「块外还有没有 .fin-c1 的规则」,而注释里成段地在讲 .fin-c1,
// 注释不产生任何规则,留着只会让这条断言恒红。
const STYLE = SRC.slice(SRC.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '')

const S_BLOCK = mediaBlock(STYLE, '@media (max-width: 600px)')
const OUTSIDE = STYLE.replace(S_BLOCK, '')

// 利润表的真列口径(IncomeStatementTable.vue IS_COLUMNS 逐字);资产负债表是它的 1 列版。
const COLUMNS: FinTableColumn[] = [
  { key: 'cur', label: '本月金额' },
  { key: 'ytd', label: '本年累计金额' },
]
// ⚠ 夹具不退化:两行分属 normal / subtotal(两种行底色都写在 td 上,粘住的格子跟着换色),
// 数值四格互不相同且含一个负数 —— 值写死成同一个数的话,「哪一格是项目列」就无从分辨。
const ROWS: FinTableRow[] = [
  { key: 1, no: 1, label: '一、营业收入', level: 0, type: 'normal' },
  { key: 21, no: 21, label: '三、营业利润', level: 0, type: 'subtotal', strong: true },
]
const VALUES: Record<string, number> = { '1|cur': 120000, '1|ytd': 380000, '21|cur': -4500, '21|ytd': 26000 }
const valueOf = (k: string | number, f: string) => VALUES[`${k}|${f}`] ?? 0

const open = (selectable = false) =>
  mount(FinReportTable, { props: { rows: ROWS, columns: COLUMNS, valueOf, editable: false, selectable } })

describe('FinReportTable · S 档首列 sticky', () => {
  it('❗S 档给「项目」列一根 sticky —— 而且只有这一根(§5.3「只留一根首列」)', () => {
    expect(S_BLOCK, '≤600 块整个没了').not.toBe('')
    // 体内 sticky 列有且仅有一根:多一根就是 390 上又少一块可读宽度
    expect(S_BLOCK.match(/position:\s*sticky/g) ?? [], 'S 档粘住的列不是一根').toHaveLength(1)
    expect(S_BLOCK).toMatch(/\.fin-table\s+tbody\s+td\.fin-c1\s*\{[^}]*position:\s*sticky/)
    expect(S_BLOCK).toMatch(/\.fin-table\s+tbody\s+td\.fin-c1\s*\{[^}]*left:\s*0/)
    // 复选列 / 行次列 / 数值列一根都不许粘
    expect(S_BLOCK).not.toMatch(/fin-ckcell|fin-no|fin-nv/)
  })

  it('❗编辑态那根 34px 复选列的偏移与 colgroup 同源(两处分叉 = 项目列压在复选框上)', () => {
    const colWidth = SRC.match(/<col v-if="selectable" style="width:(\d+)px"/)?.[1]
    expect(colWidth, '复选列的 colgroup 宽没了').toBe('34')
    const offsets = [...S_BLOCK.matchAll(/\.fin-table\.has-ck\s+\w+\s+\w+\.fin-c1\s*\{[^}]*left:\s*(\d+)px/g)].map(m => m[1])
    // 表头一条 + 表体一条,都等于复选列宽
    expect(offsets).toEqual([colWidth, colWidth])
  })

  it('❗宽档零差异:.fin-c1 / .has-ck 在 ≤600 块外没有任何一条规则', () => {
    expect(OUTSIDE, '窄档规则漏在了媒体块外面').not.toMatch(/fin-c1|has-ck/)
    // 块外原有的 sticky 只剩表头那一条(thead th 顶部吸附,是改前就有的)
    expect(OUTSIDE.match(/position:\s*sticky/g) ?? []).toHaveLength(1)
    expect(OUTSIDE).toMatch(/\.fin-table\s+thead\s+th\s*\{[^}]*position:\s*sticky;\s*top:\s*0/)
    // 断点只许 600(§1 唯一事实源);本文件另一个媒体块是 hover:none,不是宽度档
    expect([...STYLE.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map(m => m[1])).toEqual(['600'])
  })

  it('❗浏览态:每行恰好一格 .fin-c1,就是「项目」那格(首格),表上不挂 has-ck', () => {
    const w = open(false)
    expect(w.find('table.fin-table').classes()).not.toContain('has-ck')
    const heads = w.findAll('thead th')
    expect(heads).toHaveLength(2 + COLUMNS.length)          // 项目 + 行次 + 两根数值列
    expect(w.findAll('thead th.fin-c1')).toHaveLength(1)
    expect(heads[0].classes()).toContain('fin-c1')
    expect(heads[0].text()).toBe('项　目')

    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(ROWS.length)
    for (const [i, tr] of rows.entries()) {
      const tds = tr.findAll('td')
      expect(tds, '列数变了(colgroup 根数任何档位都不许变)').toHaveLength(2 + COLUMNS.length)
      expect(tr.findAll('td.fin-c1'), '一行粘两格').toHaveLength(1)
      expect(tds[0].classes()).toContain('fin-c1')
      expect(tds[0].text()).toContain(ROWS[i].label)
    }
    // 值仍落在原来的格子里:项目 / 行次 / 本月 / 本年累计
    expect(rows[0].findAll('td')[2].text()).toBe('120,000.00')
    expect(rows[1].findAll('td')[3].text()).toBe('26,000.00')
  })

  it('❗编辑态:首格是复选列,.fin-c1 退到第二格,表上挂 has-ck(左偏移靠它)', () => {
    const w = open(true)
    expect(w.find('table.fin-table').classes()).toContain('has-ck')
    const heads = w.findAll('thead th')
    expect(heads).toHaveLength(3 + COLUMNS.length)
    expect(heads[1].classes()).toContain('fin-c1')
    for (const tr of w.findAll('tbody tr')) {
      const tds = tr.findAll('td')
      expect(tds).toHaveLength(3 + COLUMNS.length)
      expect(tds[0].classes()).toContain('fin-ckcell')
      expect(tds[1].classes()).toContain('fin-c1')
      expect(tr.findAll('td.fin-c1')).toHaveLength(1)
    }
  })
})
