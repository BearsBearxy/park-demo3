// src/views/reports/pnl/__tests__/pnlCardS.spec.ts
// 损益附表(年度矩阵,17 列)的 S 档卡片化门禁 —— 响应式稿 WideCardVariants 板 §3 那一行分派:
// 「损益附表 / 17 列 / 紧凑 64 / 科目细分 · 本年合计 ·(分组名作小字)」。
//
// 为什么钉这些:
//  · 64 档 —— 稿给这张表的是紧凑档(几十条科目,密度优先)。档位一旦被改成 88,
//    每屏少看三行,而且 64 档「金额贴第一行右端」的画法会连带变成第二行大字,是静默退版式。
//  · 字段来源 —— name 必须是 label(科目细分)不是 groupLabel。两者在真数据里都是中文短词,
//    错接了屏上照样有字、不报错,只有断言拦得住(夹具里 r1/r4 同名不同组,专为此设)。
//  · 分组行处理 —— 本表行是**平铺**的:分组是一根列,不是分组行;每行(含小计/损益/合计)
//    都自带 12 个月原值,所以全部出卡、全部可点,不画小节头。卡数 === 行数把这条钉死。
//  · 12 个月进抽屉 —— 卡面只剩三个字段,12 根月列全靠抽屉兜底;抽屉空了等于这张表在手机上没了数。
//  · 宽档零差异 —— 桌面 1440 必须还是那张 <table>(RESPONSIVE-LAYOUT-SPEC §9)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PnlTable from '../PnlTable.vue'
import { _resetViewportForTest } from '@/composables/useViewport'
import type { PnlRowDTO } from '@/types/pnl'

// S 档桩:只让 ≤600 命中(jsdom 原生 matchMedia 恒 matches:false = 非 S → 走表格分支)
function asS() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 600px'), media: q,
    addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

// 夹具不许退化:
//  · r1 有 null 月(未录)+ 两段不同月值 → 本年合计不是「某个月 ×12」,写死一个数不会绿;
//  · r2 全负 → 钉住负号是 U+2212 不是 ASCII '-';
//  · r3 是 subtotal(母册原值行)→ 钉住它照样出卡、照样点得开;
//  · r4 整行 null → 合计 '–'(未录)与真 0 区分;且与 r1 同名不同组 → 钉住 name/sub 各取各的字段。
const ROWS: PnlRowDTO[] = [
  { rowKey: 'r1', groupLabel: '一期厂房', label: '租金收入', kind: 'detail', note: null, sortOrder: 0,
    m: [12000, 12000, 12000, null, 9000, 9000, 9000, 9000, 9000, 9000, 9000, 9000] },
  { rowKey: 'r2', groupLabel: '一期厂房', label: '物业成本', kind: 'detail', note: null, sortOrder: 1,
    m: [-3000, -3000, -3000, -3000, -3000, -3000, -3000, -3000, -3000, -3000, -3000, -3000] },
  { rowKey: 'r3', groupLabel: '一期厂房', label: '租金损益小计', kind: 'subtotal', note: null, sortOrder: 2,
    m: [9000, 9000, 9000, null, 6000, 6000, 6000, 6000, 6000, 6000, 6000, 6000] },
  { rowKey: 'r4', groupLabel: '二期厂房', label: '租金收入', kind: 'detail', note: null, sortOrder: 3,
    m: Array(12).fill(null) },
]

const mountTable = (edit = false) =>
  mount(PnlTable, { props: { year: 2025, rows: ROWS, groupCol: '区域', edit } })

const drawerRows = () => [...document.querySelectorAll('.pmd-r')]

beforeEach(asS)
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); _resetViewportForTest() })

describe('损益附表 · S 档卡片化(稿 WideCardVariants §3)', () => {
  it('❗S 档读态出 64 紧凑卡,不是 88/96;金额贴第一行右端,没有第二行大字', () => {
    const w = mountTable()
    const cards = w.findAll('.fpwc-c')
    expect(cards).toHaveLength(ROWS.length)
    expect(cards.every(c => c.classes().includes('d64')), '档位不是 64').toBe(true)
    expect(w.findAll('.fpwc-c > .amt'), '64 档不该有独占第二行的大字金额').toHaveLength(0)
    expect(w.findAll('.r1 .amt.sm')).toHaveLength(ROWS.length)
    // 稿给这张表「pill 不给」(本表没有状态)——胶囊与它在 64 档的替身 .bal 都不许出现
    expect(w.findAll('.fpwc-c .pill, .fpwc-c .bal')).toHaveLength(0)
    w.unmount()
  })

  it('❗字段来源:name=科目细分 / amount=本年合计(未录 – ,负号 U+2212)/ sub=分组名', () => {
    const w = mountTable()
    const cards = w.findAll('.fpwc-c')
    // r1 与 r4 同为「租金收入」但分属两个区域:name 若错接成 groupLabel,这条立刻红
    expect(cards.map(c => c.find('.nm').text()))
      .toEqual(['租金收入', '物业成本', '租金损益小计', '租金收入'])
    expect(cards.map(c => c.find('.amt.sm').text())).toEqual([
      '108,000.00',            // 12000×3 + 9000×8,跨过 4 月那个 null
      '−' + '36,000.00',  // 负号是 U+2212(稿硬条件④),不是 ASCII '-'
      '75,000.00',             // 9000×3 + 6000×8
      '–',                     // 整行未录 → 不显 0
    ])
    expect(cards.map(c => c.find('.sub').text()))
      .toEqual(['一期厂房', '一期厂房', '一期厂房', '二期厂房'])
    w.unmount()
  })

  it('❗行是平铺的(分组=列不是行):四行全部出卡、全部可点,不画小节头', async () => {
    const w = mountTable()
    // 卡列直接子节点只有卡 —— 多一个分组小节头 / 少一行汇总行,这条都红
    expect(w.find('.fpwc').element.children).toHaveLength(ROWS.length)
    // subtotal 行(母册原值行)也点得开,且抽屉里同样是 12 个月 + 合计
    await w.findAll('.fpwc-c')[2].trigger('click')
    expect(drawerRows()).toHaveLength(13)
    expect(document.querySelector('.fp-dwr-hd h3')!.textContent).toBe('租金损益小计')
    w.unmount()
  })

  it('❗点卡片开抽屉:12 个月逐月列 + 末行本年合计,未录显 –', async () => {
    const w = mountTable()
    expect(document.querySelector('.fp-dwr'), '没点之前不该有抽屉').toBeNull()
    await w.findAll('.fpwc-c')[0].trigger('click')

    const rows = drawerRows()
    expect(rows).toHaveLength(12 + 1)
    expect(rows.map(r => r.querySelector('dt')!.textContent!.trim())).toEqual(
      [...Array(12)].map((_, i) => `${i + 1}月`).concat('本年合计'),
    )
    expect(rows.map(r => r.querySelector('dd')!.textContent!.trim())).toEqual([
      '12,000.00', '12,000.00', '12,000.00', '–',
      '9,000.00', '9,000.00', '9,000.00', '9,000.00',
      '9,000.00', '9,000.00', '9,000.00', '9,000.00',
      '108,000.00',
    ])
    expect(rows[12].classList.contains('is-total')).toBe(true)
    // 抬头带的是这一行的身份:科目细分 + 分组列名/分组名 + 年
    expect(document.querySelector('.fp-dwr-hd h3')!.textContent).toBe('租金收入')
    expect(document.querySelector('.fp-dwr-hd p')!.textContent).toContain('区域 一期厂房 · 2025年')

    // 关闭走 FPDrawer 自带的 × ,抽屉整个消失(不是只藏内容)
    ;(document.querySelector('.fp-dwr-x') as HTMLButtonElement).click()
    await w.vm.$nextTick()
    expect(document.querySelector('.fp-dwr')).toBeNull()
    w.unmount()
  })

  it('❗S 档编辑态不卡片化:照旧横滚表 + 48 个月格 input(小屏录入不许被卡片吃掉)', async () => {
    const w = mountTable(true)
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
    expect(w.find('table.pt-table').exists()).toBe(true)
    expect(w.findAll('input.pt-in')).toHaveLength(ROWS.length * 12)

    // 读态开着抽屉时切进编辑 → 抽屉跟着卡列一起下线,不会在退出编辑后自己弹回来
    const r = mountTable()
    await r.findAll('.fpwc-c')[0].trigger('click')
    expect(document.querySelector('.fp-dwr')).not.toBeNull()
    await r.setProps({ edit: true })
    expect(document.querySelector('.fp-dwr')).toBeNull()
    await r.setProps({ edit: false })
    expect(document.querySelector('.fp-dwr'), '退出编辑后抽屉自己弹回来了').toBeNull()
    w.unmount(); r.unmount()
  })

  it('❗宽档(桌面 1440)一个像素不动:还是那张 <table>,12 根月列 + 本年合计,不挂抽屉', () => {
    vi.unstubAllGlobals(); _resetViewportForTest()   // jsdom 原生 matchMedia → tier='xl'
    const w = mountTable()
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
    expect(w.find('table.pt-table').exists()).toBe(true)
    expect(w.findAll('thead th.pt-h-num').map(t => t.text()))
      .toEqual([...Array(12)].map((_, i) => `${i + 1}月`))
    expect(w.find('thead th.pt-h-ann').text()).toBe('本年合计')
    expect(w.findAll('tbody tr')).toHaveLength(ROWS.length)
    expect(document.querySelector('.fp-dwr-backdrop')).toBeNull()
    w.unmount()
  })
})
