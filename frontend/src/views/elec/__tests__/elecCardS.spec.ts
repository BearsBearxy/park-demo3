// src/views/elec/__tests__/elecCardS.spec.ts — 附表11 电费成本 S 档行→卡片的门禁
// (响应式稿 WideCardVariants 板 §3 行5 + RESPONSIVE-LAYOUT-SPEC §5.3 卡片名单「电量」)。
//
// 这一组断言要钉住三件事:
//  ① 宽档(tier !== 's')渲染的还是那张 <table>,列数与 min-width 一根不动(§9「1440 与现状零差异」);
//  ② S 档查看态换成卡列,卡面三行逐字是什么 —— 名字带行身份、金额是价税合计、次级句只写测量;
//  ③ 稿画的那根 96 档损耗条**故意没有**:ElecRecordDTO 取不到供电侧电量,算不出损耗率,
//     所以降 88 不画条。这条写成断言而不是注释 —— 将来谁想「顺手补一根条」,得先解释数据从哪来。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ElecTable from '../ElecTable.vue'
import ElecRowDrawer from '../ElecRowDrawer.vue'
import { _resetViewportForTest } from '@/composables/useViewport'
import type { ElecPhaseDTO, ElecRecordDTO, ElecTotal } from '@/types/elec'

// S 档桩:只让 ≤600 命中(jsdom 原生 matchMedia 一律 matches:false = xl 档)
function asS() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 600px'), media: q,
    addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

const PHASES: ElecPhaseDTO[] = [
  { id: 'p1', name: '一期厂房', short: '一期' },
  { id: 'p2', name: '二期厂房', short: '二期' },
  { id: 'p3', name: '三期厂房', short: '三期' },
]

const base = {
  type: 'energy' as const, invDate: '2026-02-08', cat: '大工业用电', unit: '度',
  demand: null, rate: 0.13, note: null, source: 'seed' as const,
}

// ⚠ 夹具不许退化:三行分属三个期、三个月、三个时段,电量/金额两两不同 ——
//   任何一条「把 name 写死成月份」「把 sub 写死成某一行」的实现都会红。
//   第三行是脏数据行:qty=null、amount/total=0(真实库里「开了票但电量没录」的月),
//   钉住它渲染出的是 0 而不是 NaN/Infinity/-(稿的 96 档条被降掉了,分母为 0 的位置就在这里)。
const ROWS: ElecRecordDTO[] = [
  { ...base, id: 1, phase: 'p1', phaseName: '一期厂房', acctMonth: '2026-01', period: '峰',
    qty: 128400, price: 0.7231, amount: 92846.04, tax: 12069.99, total: 104916.03 },
  { ...base, id: 2, phase: 'p2', phaseName: '二期厂房', acctMonth: '2026-03', period: '谷',
    qty: 45120, price: 0.3512, amount: 15846.14, tax: 2059.99, total: 17906.13 },
  { ...base, id: 3, phase: 'p3', phaseName: '三期厂房', acctMonth: '2026-05', period: '平',
    qty: null, price: 0, amount: 0, tax: 0, total: 0 },
]
const TOTAL: ElecTotal = { qty: 173520, demand: 0, amount: 108692.18, tax: 14129.98, total: 122822.16 }

const BASIC_ROWS: ElecRecordDTO[] = [
  { ...base, id: 4, type: 'basic', phase: 'p1', phaseName: '一期厂房', acctMonth: '2026-02',
    period: null, cat: null, unit: null, qty: null, demand: 2400, price: 42.5,
    amount: 102000, tax: 13260, total: 115260 },
  { ...base, id: 5, type: 'basic', phase: 'p2', phaseName: '二期厂房', acctMonth: '2026-04',
    period: null, cat: null, unit: null, qty: null, demand: 1850, price: 42.5,
    amount: 78625, tax: 10221.25, total: 88846.25 },
]

function mountTable(over: Record<string, unknown> = {}) {
  return mount(ElecTable, {
    props: {
      year: 2026, type: 'energy', phases: PHASES, rows: ROWS, total: TOTAL, edit: false, ...over,
    },
  })
}

afterEach(() => { vi.unstubAllGlobals(); _resetViewportForTest() })

describe('附表11 · 宽档(现状零差异)', () => {
  beforeEach(() => { _resetViewportForTest() })   // jsdom 原生 matchMedia → tier='xl'

  it('❗宽档还是 <table>,一张卡都不出', () => {
    const w = mountTable()
    expect(w.findAll('table.e11-table')).toHaveLength(1)
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
  })

  it('❗列数与 min-width 一根不动(§5.4 定宽表:窄了横滚,不改列)', () => {
    // energy 查看态 11 根:记账月份/开票日期/时段/用电类别/电量/不含税单价/不含税金额/税率/税额/价税合计/备注
    expect(mountTable().findAll('thead th')).toHaveLength(11)
    // 编辑态多一根操作列
    expect(mountTable({ edit: true }).findAll('thead th')).toHaveLength(12)
    // basic 查看态 9 根
    expect(mountTable({ type: 'basic', rows: BASIC_ROWS }).findAll('thead th')).toHaveLength(9)
    const src = readFileSync(join(__dirname, '../ElecTable.vue'), 'utf8')
    expect(src).toMatch(/\.e11-table\s*\{[^}]*min-width:\s*1040px/)
  })
})

describe('附表11 · S 档行→卡片', () => {
  beforeEach(asS)

  it('❗S 档查看态出卡不出表,一行一张,密度 88', () => {
    const w = mountTable()
    expect(w.findAll('table.e11-table')).toHaveLength(0)
    const cards = w.findAll('.fpwc-c')
    expect(cards).toHaveLength(ROWS.length)
    expect(cards.every(c => c.classes().includes('d88'))).toBe(true)
  })

  it('❗稿画的 96 档损耗条故意没有 —— 供电侧电量在 ElecRecordDTO 里取不到,不虚构', () => {
    const w = mountTable()
    expect(w.findAll('.fpwc-c.d96')).toHaveLength(0)
    expect(w.findAll('.fpwc-c .bar')).toHaveLength(0)
    // 屏上一个字的「损耗 / 异常 / 偏高」都不许出现(screen-measures-not-verdicts)
    expect(w.text()).not.toMatch(/损耗|异常|偏高|污染/)
  })

  it('❗卡面三行逐字:身份 = 月 · 期 · 时段,金额 = 价税合计,次级句 = 电量 + 不含税', () => {
    const w = mountTable()
    const cards = w.findAll('.fpwc-c')
    expect(cards.map(c => c.find('.nm').text())).toEqual([
      '2026年1月 · 一期厂房 · 峰',
      '2026年3月 · 二期厂房 · 谷',
      '2026年5月 · 三期厂房 · 平',
    ])
    expect(cards.map(c => c.find('.amt').text())).toEqual([
      '¥104,916.03', '¥17,906.13', '¥0.00',
    ])
    expect(cards.map(c => c.find('.sub').text())).toEqual([
      '电量 128,400 度 · 不含税 ¥92,846.04',
      '电量 45,120 度 · 不含税 ¥15,846.14',
      '电量 0 度 · 不含税 ¥0.00',
    ])
  })

  it('❗第三行(qty=null、金额 0)渲染成 0,不是 NaN / Infinity / 空', () => {
    const t = mountTable().findAll('.fpwc-c')[2].text()
    expect(t).not.toMatch(/NaN|Infinity|undefined|null/)
    expect(t).toContain('电量 0 度')
    expect(t).toContain('¥0.00')
  })

  it('❗basic 换需量口径(kVA),不拿电量硬套', () => {
    const w = mountTable({ type: 'basic', rows: BASIC_ROWS })
    const cards = w.findAll('.fpwc-c')
    // basic 行无时段 → 身份只有两段,不留下「· 」这样的空尾巴
    expect(cards.map(c => c.find('.nm').text())).toEqual([
      '2026年2月 · 一期厂房', '2026年4月 · 二期厂房',
    ])
    expect(cards.map(c => c.find('.sub').text())).toEqual([
      '需量 2,400 kVA · 不含税 ¥102,000.00',
      '需量 1,850 kVA · 不含税 ¥78,625.00',
    ])
    // 只看卡列:工具行的 Segmented 上本来就印着「电量电费 / 基本电费」两个档名
    expect(w.findAll('.fpwc-c').map(c => c.text()).join('')).not.toContain('电量')
  })

  it('❗S 档编辑态回落原表:勾选框与行删除钮在卡上没有位置,不能因为换形态就没了', () => {
    const w = mountTable({ edit: true })
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
    expect(w.findAll('table.e11-table')).toHaveLength(1)
    // §5.4:同一张表在 S 档也是 12 根列,一根不许按档位增删(上面那条 11/12/9 跑在 xl 档,
    // 拦不住「S 档少画一列」这种写法,所以这里补一次同表跨档的对照)
    expect(w.findAll('thead th')).toHaveLength(12)
    expect(w.findAll('.e11-cb').length).toBeGreaterThan(0)          // 全选 + 逐行勾选
    expect(w.findAll('.e11-actbtn.del')).toHaveLength(ROWS.length)  // 每行一个删除钮
  })

  it('❗空年引导态不被卡列抢走(S 档也要能看见「暂无记录」和入口按钮)', () => {
    const w = mountTable({ rows: [] })
    expect(w.find('.e11-empty').exists()).toBe(true)
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
    expect(w.text()).toContain('2026 年暂无电量电费记录')
  })
})

// ── 点开抽屉看整行(§5.3 逐字)──────────────────────────────────────────
// 为什么必须有这一组:FPWideCards 的 .fpwc-c 写死了 cursor:pointer 与 :active 反馈。
// 不接 @row-click 的话,卡按下去有视觉反应、什么都不发生;而开票日期 / 时段 / 用电类别 /
// 不含税单价 / 税率 / 税额 / 价税合计 / 备注这几列在 S 档没有第二个地方能读到
// (本屏没有台账那条「按表格查看」退路)。2026-09-20 对抗复查报的就是这一条。
describe('附表11 · S 档整卡点击 → 只读行抽屉', () => {
  beforeEach(asS)

  it('❗整卡点击 emit row,载荷是那一行本身', async () => {
    const w = mountTable()
    await w.findAll('.fpwc-c')[1].trigger('click')
    expect(w.emitted('row')?.[0]?.[0]).toEqual(ROWS[1])
    // 宽档不该有这条动线:桌面点行本来就没有行为
    vi.unstubAllGlobals(); _resetViewportForTest()
    const d = mountTable()
    await d.findAll('tr.e11-row')[1].trigger('click')
    expect(d.emitted('row')).toBeUndefined()
  })

  it('❗抽屉里把卡上装不下的那几列补齐,且一个 NaN 都不出', () => {
    const w = mount(ElecRowDrawer, { props: { row: ROWS[0] }, attachTo: document.body })
    const dl = [...document.querySelectorAll('.e11-rd-dl dt')]
      .map((dt, i) => dt.textContent + '=' + document.querySelectorAll('.e11-rd-dl dd')[i].textContent)
    expect(dl).toEqual([
      '开票日期=2026-02-08', '时段=峰', '用电类别=大工业用电', '电量=128,400 度',
      '不含税单价=0.7231 元', '不含税金额=92,846.04 元', '税率=13%',
      '税额=12,069.99 元', '价税合计=104,916.03 元',
    ])
    expect(document.querySelector('.fp-dwr')!.textContent).not.toMatch(/NaN|Infinity|undefined|null/)
    w.unmount()
  })

  it('❗basic 行换成「计费需量」,不画 energy 专属的三列', () => {
    const w = mount(ElecRowDrawer, { props: { row: BASIC_ROWS[0] }, attachTo: document.body })
    const dt = [...document.querySelectorAll('.e11-rd-dl dt')].map(e => e.textContent)
    expect(dt).toEqual(['开票日期', '计费需量', '不含税单价', '不含税金额', '税率', '税额', '价税合计'])
    expect(dt).not.toContain('时段')
    w.unmount()
  })

  it('❗脏数据行(qty=null、金额全 0)不写出 NaN,也不假装有值', () => {
    const w = mount(ElecRowDrawer, { props: { row: ROWS[2] }, attachTo: document.body })
    const txt = document.querySelector('.fp-dwr')!.textContent!
    expect(txt).not.toMatch(/NaN|Infinity/)
    expect(txt).toContain('0 度')
    expect(document.querySelector('.e11-rd-note')!.textContent).toBe('—')   // note=null → 破折号不是 "null"
    w.unmount()
  })

  it('❗只读:除 FPDrawer 自带的关闭钮外没有第二个可交互件', () => {
    const w = mount(ElecRowDrawer, { props: { row: ROWS[0] }, attachTo: document.body })
    expect(document.querySelectorAll('.fp-dwr input, .fp-dwr textarea, .fp-dwr select')).toHaveLength(0)
    expect(document.querySelectorAll('.fp-dwr button')).toHaveLength(1)
    w.unmount()
  })
})
