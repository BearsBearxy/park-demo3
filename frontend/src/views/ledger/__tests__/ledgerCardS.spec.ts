// 月度台账 S 档(≤600)门禁 —— 响应式稿 WideCardPhone 板。
//
// 钉三件事:
//  ① 卡上 4 个字段各自的取值来源(ledgerColumns.ts 的 fixedLeft[0] / fixedRight[0..2]),
//    三种结余态各一行夹具 —— 夹具不许退化成「全是已结清」,那样 pill 写死 ok 也绿。
//  ② 应收为 0 的那行不许算出 NaN% / Infinity%。
//  ③ 抽屉的「有值」判据:负数口袋(抵减 / 退补)必须出现 —— 判据改回 `> 0` 这条就红。
// 宽档那条(不 stub matchMedia)保的是 RESPONSIVE-LAYOUT-SPEC §9「1440 零差异」:
// 渲染出来的仍是 <table>,卡片一张都没有。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import LedgerWideTable from '@/views/ledger/LedgerWideTable.vue'
import LedgerTenantDrawer from '@/views/ledger/LedgerTenantDrawer.vue'
import { _resetViewportForTest } from '@/composables/useViewport'
import type { Book, BookDef } from '@/types/book'
import type { LedgerMonthDTO, LedgerRowDTO } from '@/types/ledger'
import { FEE_KEYS } from '@/utils/ledgerColumns'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
    put: vi.fn(() => Promise.resolve({ users: [], evictions: [] })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 't'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

// S 档桩:只让 ≤600 命中(同 fpWideCards.spec.ts)
function asS() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 600px'), media: q,
    addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

const zeroFees = () => Object.fromEntries(FEE_KEYS.map(k => [k, 0])) as Record<string, number>
const mkRow = (o: Partial<LedgerRowDTO> & { tenantName: string }) => ({
  ...zeroFees(), id: null, tenantId: null, balancePrev: 0, totalCollected: 0,
  note: null, totalReceivable: 0, balanceEnd: 0, ...o,
} as unknown as LedgerRowDTO)

// 三种结余态各一行 + 一行应收为 0(除零那条的夹具)
const ROWS: LedgerRowDTO[] = [
  mkRow({ id: 1, tenantName: '鑫诚精密科技', totalReceivable: 148620, totalCollected: 148620, balanceEnd: 0 }),
  mkRow({ id: 2, tenantName: '瑞和智能装备', totalReceivable: 132500, totalCollected: 132500, balanceEnd: -8400 }),
  mkRow({ id: 3, tenantName: '嘉华新材料', totalReceivable: 96340, totalCollected: 60000, balanceEnd: 36340 }),
  mkRow({ id: 4, tenantName: '未记账户', totalReceivable: 0, totalCollected: 0, balanceEnd: 0 }),
]

const month: LedgerMonthDTO = {
  companyName: '一期公司', year: 2026, month: 8, prevMonth: 7, rows: ROWS,
  footer: { ...zeroFees(), balancePrev: 0, totalReceivable: 0, totalCollected: 0, balanceEnd: 0 } as LedgerMonthDTO['footer'],
  archivedCols: [],
}

function mk(props: Record<string, unknown> = {}) {
  return mount(LedgerWideTable, {
    props: {
      month, draft: ROWS, book: null, companyName: '一期公司',
      year: 2026, monthNo: 8, edit: false, saving: false, ...props,
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit']
})
afterEach(() => { vi.unstubAllGlobals(); _resetViewportForTest() })

describe('月度台账 · S 档卡片列表', () => {
  it('❗四个字段各自的取值来源 + 结余三态胶囊', () => {
    asS()
    const cards = mk().findAll('.fpwc-c')
    expect(cards, '一行一张卡').toHaveLength(4)

    // name = fixedLeft[0] tenantName
    expect(cards.map(c => c.find('.nm').text()))
      .toEqual(['鑫诚精密科技', '瑞和智能装备', '嘉华新材料', '未记账户'])
    // amount = fixedRight[0] totalReceivable(88 档独占第二行的那根 .amt)
    expect(cards.map(c => c.find('.amt').text()))
      .toEqual(['¥148,620', '¥132,500', '¥96,340', '¥0'])
    // sub = fixedRight[1] totalCollected + 收缴率
    expect(cards[2].find('.sub').text()).toBe('已收 ¥60,000 · 收缴 62%')
    // pill = fixedRight[2] balanceEnd 三态:=0 已结清 / <0 余(info)/ >0 欠(warn)
    expect(cards.map(c => c.find('.pill').text()))
      .toEqual(['已结清', '余 ¥8,400', '欠 ¥36,340', '已结清'])
    expect(cards.map(c => c.find('.pill').classes().filter(k => ['ok', 'warn', 'info'].includes(k)).join()))
      .toEqual(['ok', 'info', 'warn', 'ok'])
  })

  it('❗应收为 0 的行不出 NaN% / Infinity%', () => {
    asS()
    const sub = mk().findAll('.fpwc-c')[3].find('.sub').text()
    expect(sub).toBe('已收 ¥0 · 收缴 —')
    expect(sub).not.toMatch(/NaN|Infinity/)
  })

  it('❗S 档两行顶栏:屏名 + N 户 · 27 列 + 126 定宽日期;编辑锁在行内不进 ⋯', async () => {
    asS()
    const w = mk()
    expect(w.find('.lg-s-h1 .nm').text()).toBe('一期公司')
    expect(w.find('.lg-s-h1 .sub').text()).toBe('4 户 · 27 列')
    expect(w.find('.lg-s-date .v').text()).toBe('2026-08')
    // 桌面那颗 34x34 返回钮 / 换期 / 导出 / 账册模板按钮在 S 档都不出第二份
    expect(w.find('.lg-back').exists()).toBe(false)
    expect(w.find('.lg-lockbtn').exists(), '编辑锁不许出两颗').toBe(false)

    // 编辑锁留在第二行(规范 §11.2 不隐藏);⋯ 里只有三条,没有它
    expect(w.find('.lg-s-h2 .lg-s-lock').text()).toBe('编辑')
    await w.find('.lg-s-h2 .fp-more-btn').trigger('click')
    expect(w.findAll('.fp-more-item').map(i => i.text()))
      .toEqual(['导出 Excel', '账册模板', '按表格查看'])
  })

  it('❗⋯ 的「按表格查看」把横滚宽表调回来(稿 §3:表不删,降级成第二形态)', async () => {
    asS()
    const w = mk()
    expect(w.find('table').exists(), '默认是卡片').toBe(false)

    await w.find('.lg-s-h2 .fp-more-btn').trigger('click')
    await w.findAll('.fp-more-item')[2].trigger('click')
    expect(w.find('table').exists()).toBe(true)
    expect(w.findAll('.fpwc-c')).toHaveLength(0)

    await w.find('.lg-s-h2 .fp-more-btn').trigger('click')
    expect(w.findAll('.fp-more-item')[2].text()).toBe('按卡片查看')
  })

  it('❗整卡点击 = 桌面点租户名,同一个 tenant-click', async () => {
    asS()
    const w = mk()
    await w.findAll('.fpwc-c')[2].trigger('click')
    expect((w.emitted('tenant-click')?.[0]?.[0] as LedgerRowDTO).tenantName).toBe('嘉华新材料')
  })

  it('❗宽档零差异:仍是 <table>,卡片一张都没有,顶栏还是桌面那一套', () => {
    // 不 stub matchMedia → jsdom 恒 tier='xl'
    const w = mk()
    expect(w.find('table').exists()).toBe(true)
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
    expect(w.find('.lg-s-h1').exists()).toBe(false)
    expect(w.find('.lg-s-h2').exists()).toBe(false)
    expect(w.find('.lg-back').exists(), '桌面返回钮原样在').toBe(true)
    expect(w.find('.lg-lockbtn').exists(), '桌面编辑按钮原样在').toBe(true)
  })
})

// ── 抽屉:有值 / 全部 段控 + 负数口袋 ───────────────────────────────
const def: BookDef = {
  groups: [{
    id: 'g1', label: '租金', cols: [
      { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: 96 },
      { id: 'factoryMgmtFee', std: true, label: '厂房企业管理服务费', aliases: [], slot: 'mgmt', hidden: false, w: 130 },
      { id: 'shopRent', std: true, label: '商铺、宿舍租金', aliases: [], slot: 'rent', hidden: false, w: 112 },
      // 模板里有、本行 extraFees 没这个键 → row[c_x1] 是 undefined。`!== 0` 若不挡 NaN 就会把它当有值
      { id: 'c_x1', std: false, label: '自定义口袋', aliases: [], slot: 'other', hidden: false, w: 96 },
    ],
  }],
}
const book: Book = { id: 1, screen: 'ledger', companyId: 9, phase: null, name: '月度台账',
                     ver: 3, latestVer: 3, definition: def }
// 一正一负:负数是抵减 / 退补,改判据前它和空口袋一起被整条藏掉
const drawerRow = mkRow({
  id: 7, tenantName: '鑫诚精密科技', factoryRent: 86400, factoryMgmtFee: -5000,
  balancePrev: 0, totalReceivable: 81400, totalCollected: 81400, balanceEnd: 0,
  note: '本月按合同抵减一笔装修补贴,金额随附件,备注很长很长很长不许截断',
} as Partial<LedgerRowDTO> & { tenantName: string })

function mkDrawer() {
  return mount(LedgerTenantDrawer, {
    props: {
      row: drawerRow, book, companyName: '一期公司', year: 2026, monthNo: 8,
      prevMonth: 7, archived: [], canBind: false,
    },
  })
}
// FPDrawer 是 <Teleport to="body">,内容不在 wrapper 的 DOM 子树里 —— 只能从 document 上找
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)] as HTMLElement[]
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').trim()

describe('月度台账 · 抽屉「有值 / 全部」', () => {
  it('❗负数口袋在「有值」档就得出现(判据 > 0 时这条红)', async () => {
    asS()
    const w = mkDrawer()
    await flushPromises()
    const rows = $$('.lg-dw-row')
    // 末尾那行是稿 §3 屏样4 的「另 N 项无金额」:不写它就看不出这组还折了几个空口袋。
    // 它只在 S 档 + 「有值」档出(宽档无段控,没有「被折掉」这回事)。
    expect(rows.map(r => txt(r.querySelector('.fee'))))
      .toEqual(['厂房租金', '厂房企业管理服务费', '另 2 项无金额'])
    expect(rows[2].classList.contains('rest'), '折叠计数行不是一条明细,要带 .rest').toBe(true)
    expect(txt(rows[2].querySelector('.amt')), '折叠计数行没有金额位').toBe('')
    expect(txt(rows[1].querySelector('.amt'))).toContain('5,000.00')
    // 组内小计把负数算进去:86,400 − 5,000 = 81,400,与卡上的应收合计对得上
    expect(txt($$('.lg-dw-gt b')[0])).toBe('81,400.00')
    w.unmount()
  })

  it('❗段控默认「有值」,切「全部」后列出全部口袋,空的写「—」而不是 NaN', async () => {
    asS()
    const w = mkDrawer()
    await flushPromises()
    const segs = $$('.ds-seg-item')
    expect(segs.map(txt)).toEqual(['有值 2', '全部 4'])
    expect(segs[0].getAttribute('aria-selected')).toBe('true')

    segs[1].click()
    await flushPromises()
    const rows = $$('.lg-dw-row')
    expect(rows).toHaveLength(4)
    expect(rows.map(r => txt(r.querySelector('.fee'))))
      .toEqual(['厂房租金', '厂房企业管理服务费', '商铺、宿舍租金', '自定义口袋'])
    // 空口袋 & 模板里有但行上没这个键的口袋,都写「—」
    expect(txt(rows[2].querySelector('.amt'))).toBe('—')
    expect(txt(rows[3].querySelector('.amt'))).toBe('—')
    expect(txt($$('.fp-dwr')[0])).not.toMatch(/NaN/)
    w.unmount()
  })

  it('❗S 档一行上下文:上月结余 + 备注全文不截', async () => {
    asS()
    const w = mkDrawer()
    await flushPromises()
    const ctx = txt($$('.lg-dw-ctx .t')[0])
    expect(ctx).toContain('7 月结余')
    expect(ctx).toContain(drawerRow.note as string)   // 全文,不省略号
    w.unmount()
  })

  it('❗宽档零差异:没有段控、没有上下文行,结转与备注还是两个独立分区', async () => {
    const w = mkDrawer()   // 不 stub → tier='xl'
    await flushPromises()
    expect($$('.lg-dw-ctx')).toHaveLength(0)
    expect($$('.ds-seg-item')).toHaveLength(0)
    // 结转分区那一行 + 两条有值费用 = 3 行
    const rows = $$('.lg-dw-row')
    expect(rows).toHaveLength(3)
    expect(txt(rows[0].querySelector('.fee'))).toBe('7 月结余')
    expect(txt($$('.fp-dwr')[0])).toContain(drawerRow.note as string)
    w.unmount()
  })
})
