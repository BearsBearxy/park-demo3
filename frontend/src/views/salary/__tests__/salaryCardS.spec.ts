// src/views/salary/__tests__/salaryCardS.spec.ts
// 附表12 工资明细(18 列)的 S 档行→卡片门禁。
//
// 钉什么:稿 §3 给本表的四个字段**各自取哪一根 DTO 列**。18 根列里有 5 个「合计」味道的数
// (wageTotal / gross / deduct / net / 各组小计),取错一根屏上照样显得出一个像样的金额 ——
// 没有断言就没人发现卡上写的「应发」其实是「合计工资」。所以夹具让这几个数**两两不等**,
// 断言比对逐字全串,不比对「存在一个数字」。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SalaryTable from '../SalaryTable.vue'
import SalaryRowDrawer from '../SalaryRowDrawer.vue'
import { _resetViewportForTest } from '@/composables/useViewport'
import type { SalaryRecordDTO, SalaryTotal } from '@/types/salary'

function asS() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 600px'), media: q,
    addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

function row(over: Partial<SalaryRecordDTO>): SalaryRecordDTO {
  return {
    id: 1, acctMonth: '2026-03', empIdx: 1, name: '张三', role: '运维工程师',
    base: 4200, post: 1800, perf: 900, attend: 300, skill: 500, edu: 200, other: 100,
    lunch: 300, heat: 200, commission: 0,
    shouldDays: 22, leaveDays: 0,
    social: 980.25, tax: 120, otherDeduct: 1600,
    sign: false,
    wageTotal: 8000, gross: 8500, deduct: 2700.25, net: 5799.75,
    actualDays: 22, fullAttend: true, note: null, source: 'seed',
    ...over,
  }
}

// ⚠ 夹具不许退化:
//   张三 wageTotal 8,000 ≠ gross 8,500 ≠ net 5,799.75 ≠ deduct 2,700.25,四个数两两不等
//   李四 net 为负(扣款 1,000.50 > 应发 800.00)—— 钉住金额走 finMoney 的 U+2212 负号,
//         用 ASCII '-' 的实现会红
const ROWS: SalaryRecordDTO[] = [
  row({}),
  row({ id: 2, name: '李四', role: null, wageTotal: 700, gross: 800, deduct: 1000.5, net: -200.5, sign: true }),
]

const TOTAL: SalaryTotal = {
  base: 4900, post: 1800, perf: 900, attend: 300, skill: 500, edu: 200, other: 100,
  lunch: 300, heat: 200, commission: 0,
  wageTotal: 8700, gross: 9300, social: 1960.5, tax: 240, otherDeduct: 3200,
  deduct: 3700.75, net: 5599.25,
}

const props = { year: 2026, month: 3, rows: ROWS, total: TOTAL, edit: false }

afterEach(() => { vi.unstubAllGlobals(); _resetViewportForTest() })

describe('附表12 · S 档行→卡片', () => {
  beforeEach(asS)

  // 2026-09-20 对抗复查报的挡工:卡片分支原本只判 tier 不判 edit ——
  // S 档一进编辑模式就被只读卡顶掉,全选框 / 逐行勾选 / 备注直编 / 行删除四件整体不可达,
  // 而本屏没有台账那条「按表格查看」退路。同轮另外四屏都判了 !edit,只有这屏漏了。
  it('❗S 档编辑态回落原表:勾选框与行删除一个都不许被卡片顶掉', () => {
    const w = mount(SalaryTable, { props: { ...props, edit: true } })
    expect(w.findAll('.fpwc-c'), 'S 档编辑态不该出只读卡').toHaveLength(0)
    expect(w.findAll('table.s12-table')).toHaveLength(1)
    // 逐行勾选框数 = 行数;全选框 1 个;行删除钮 = 行数
    expect(w.findAll('tbody input[type=checkbox]')).toHaveLength(ROWS.length)
    expect(w.findAll('thead input[type=checkbox]')).toHaveLength(1)
  })

  it('❗一行一张标准 88 卡,不再有 <table>', () => {
    const w = mount(SalaryTable, { props })
    expect(w.findAll('table')).toHaveLength(0)
    const cards = w.findAll('.fpwc-c')
    expect(cards).toHaveLength(2)
    expect(cards.every(c => c.classes().includes('d88')), '密度不是稿判的 88 档').toBe(true)
  })

  it('❗四个字段逐个取对 DTO 列:name / gross / net / deduct', () => {
    const w = mount(SalaryTable, { props })
    const c0 = w.findAll('.fpwc-c')[0]

    // 姓名 = r.name
    expect(c0.find('.nm').text()).toBe('张三')
    // 应发合计 = r.gross(8,500),**不是** wageTotal(8,000)也不是 net(5,799.75)
    expect(c0.find('.amt').text()).toBe('¥8,500.00')
    // 实发 = r.net;扣款合计 = r.deduct(派生 social+tax+otherDeduct),两个数一句装
    expect(c0.find('.sub').text()).toBe('实发 ¥5,799.75 · 扣款 ¥2,700.25')

    // 负实发:finMoney 的 U+2212,不是 ASCII '-'
    const c1 = w.findAll('.fpwc-c')[1]
    expect(c1.find('.amt').text()).toBe('¥800.00')
    expect(c1.find('.sub').text()).toBe('实发 −¥200.50 · 扣款 ¥1,000.50')
    expect(c1.find('.sub').text()).not.toContain('-¥')
  })

  it('❗不画状态胶囊 —— 扣款是金额,不许伪装成 pill;签收也没被塞进这四个字段', () => {
    const w = mount(SalaryTable, { props })
    expect(w.findAll('.fpwc-c .pill')).toHaveLength(0)
    // 李四 sign:true / 张三 sign:false —— 卡上一个「已签/待签」都不该出现
    expect(w.text()).not.toContain('已签')
    expect(w.text()).not.toContain('待签')
  })

  it('❗整卡点击把**那一行 DTO** 交给父(父据此开只读明细抽屉)', async () => {
    const w = mount(SalaryTable, { props })
    await w.findAll('.fpwc-c')[1].trigger('click')
    // toBe(ROWS[1]) 不成立:rows 作为 prop 被 Vue 的 reactive 代理包过一层,
    // emit 出去的是代理对象,引用与夹具字面量不同(同一份数据)。改钉「整条 DTO 原样透出」
    // + 身份列,依然抓得住「emit 的是第 0 行」「emit 的是映射后的 WideCard 而非 DTO」两种错。
    expect(w.emitted('row')?.[0]?.[0]).toStrictEqual(ROWS[1])
    const payload = w.emitted('row')![0][0] as SalaryRecordDTO
    expect([payload.id, payload.name, payload.net]).toEqual([2, '李四', -200.5])
    expect(w.emitted('row')).toHaveLength(1)
  })

  it('❗空月仍走既有引导态,不画一张空卡', () => {
    const w = mount(SalaryTable, { props: { ...props, rows: [] } })
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
    expect(w.find('.s12-empty-t').text()).toBe('2026年3月 暂无工资记录')
  })
})

describe('附表12 · 宽档零差异', () => {
  beforeEach(() => { vi.unstubAllGlobals(); _resetViewportForTest() })   // jsdom 原生 matchMedia → tier='xl'

  it('❗宽档仍是 <table>:双级表头 + 27 根 thead th + sticky 左两列 + tfoot 合计,一张卡不出', () => {
    const w = mount(SalaryTable, { props })
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
    expect(w.findAll('table.s12-table')).toHaveLength(1)
    // 两级表头:g 行 12 个 th(含 rowspan 的序号/姓名/职务/招商提成/应发/实发/签收/备注)+ s 行 17 个子列
    expect(w.findAll('thead tr.g th')).toHaveLength(12)
    expect(w.findAll('thead tr.s th')).toHaveLength(17)
    // 左 sticky 两根(序号 + 姓名)仍在,S 档的收敛只写在 CSS 媒体块里,不改 DOM
    expect(w.findAll('tbody .s12-sticky1')).toHaveLength(2)
    expect(w.findAll('tbody .s12-sticky2')).toHaveLength(2)
    expect(w.find('.s12-foot-lbl').text()).toBe('合计 · 2 人')
    // 应发/实发仍由表体逐格显,格式是表内的 num()(无 ¥ 前缀),没被卡片的 finMoney 串味
    expect(w.findAll('tbody tr.s12-row')[0].findAll('.s12-c-strong')[1].text()).toBe('8,500.00')
    expect(w.findAll('tbody tr.s12-row')[0].find('.s12-c-net').text()).toBe('5,799.75')
  })

  it('❗宽档点行不发 row(桌面点行本来就什么都不做,这条动线只属于 S 档)', async () => {
    const w = mount(SalaryTable, { props })
    await w.findAll('tbody tr.s12-row')[0].trigger('click')
    expect(w.emitted('row')).toBeUndefined()
  })
})

// 卡片只放得下 4 个字段,宽表另外 14 根列在 S 档没有横滚可看 —— 抽屉是它们唯一的去处。
// 少画一根就是一根数据在手机上彻底不可达,所以逐根钉。
describe('附表12 · 点开抽屉看整行', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('❗卡上没有的 14 根列一根不少,取值逐个对到 DTO', () => {
    const w = mount(SalaryRowDrawer, { props: { row: ROWS[0] }, attachTo: document.body })
    const dl = [...document.querySelectorAll('.s12-rd-dl dt')].map((dt, i) =>
      [dt.textContent, document.querySelectorAll('.s12-rd-dl dd')[i].textContent].join('='))
    expect(dl).toEqual([
      '基本=¥4,200.00', '岗位=¥1,800.00', '绩效奖金=¥900.00', '全勤奖=¥300.00',
      '技能津贴=¥500.00', '学历津贴=¥200.00', '其它津贴=¥100.00', '合计工资=¥8,000.00',
      '午餐补助=¥300.00', '高温及其他=¥200.00', '招商提成=¥0.00',
      '应出勤=22 天', '请假=0 天', '实出勤=22 天', '全勤考核=全勤',
      '社保=¥980.25', '上月个税=¥120.00', '其他=¥1,600.00', '合计扣款=¥2,700.25',
    ])
    // 顶部复述卡上那两个数 + 签收态(签收是本行唯一的真状态列,卡上没位置,落在这里)
    const top = [...document.querySelectorAll('.s12-rd-top .v')].map(e => e.textContent)
    expect(top).toEqual(['¥8,500.00', '¥5,799.75', '待签'])
    w.unmount()
  })

  it('❗只读:除 FPDrawer 自带的关闭钮外没有第二个可交互件(锁与写口都不经这里)', () => {
    const w = mount(SalaryRowDrawer, { props: { row: ROWS[1] }, attachTo: document.body })
    expect(document.querySelectorAll('.fp-dwr input, .fp-dwr textarea, .fp-dwr select')).toHaveLength(0)
    const btns = [...document.querySelectorAll('.fp-dwr button')]
    expect(btns).toHaveLength(1)
    expect(btns[0].getAttribute('aria-label')).toBe('关闭')
    // 李四 role=null:标题/副标题不得出现 "null"
    expect(document.querySelector('.fp-dwr-hd')!.textContent).toContain('李四')
    expect(document.querySelector('.fp-dwr-hd')!.textContent).not.toContain('null')
    w.unmount()
  })
})
