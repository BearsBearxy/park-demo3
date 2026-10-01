// 台账 / 附表10 的「未绑定」(计划 T17,画布 06-A 工具条入口行「未绑定 12」、06-C 方案 A、02-A):
//
//  · 入口 = 工具条上的入口胶囊,点开是贴着胶囊的问题面板 —— 不是右侧抽屉,页面不变暗。
//  · 切账册 / 换期会丢草稿:0 处改动直接走,有改动先问离开(askLeave)。
//  · 未绑定行名字旁是「● 未绑定」点 + 字,不靠悬停 title。
//  · 写失败走结果回执(带「重试」),删除走确认弹窗(删除类),空表是一种空状态。
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import LedgerView from '@/views/ledger/LedgerView.vue'
import LedgerWideTable from '@/views/ledger/LedgerWideTable.vue'
import FPLedgerTable from '@/components/fp/FPLedgerTable.vue'
import S10View from '@/views/sales-income/S10View.vue'
import S10Table from '@/views/sales-income/S10Table.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import BookRail from '@/components/fp/BookRail.vue'
import { booksApi } from '@/api/books'
import { ledgerApi } from '@/api/ledger'
import { runImport } from '@/utils/importRegistry'
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'
import type { Book, BookDef } from '@/types/book'
import type { LedgerMonthDTO, LedgerRowDTO } from '@/types/ledger'
import type { S10MonthDTO, S10RecordDTO, S10OverviewDTO } from '@/types/s10'
import { FEE_KEYS } from '@/utils/ledgerColumns'

// ── 夹具:每张表一行已绑定、一行未绑定(账面名「老王」) ──
const def: BookDef = {
  groups: [{ id: 'g1', label: '租金', cols: [
    { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: 96 },
  ] }],
}
const ledgerBooks: Book[] = [
  { id: 1, screen: 'ledger', companyId: 9, phase: null, name: '甲公司', ver: 1, latestVer: 1, definition: def },
  { id: 2, screen: 'ledger', companyId: 8, phase: null, name: '乙公司', ver: 1, latestVer: 1, definition: def },
]
const s10Books: Book[] = [
  { id: 7, screen: 's10', companyId: null, phase: 1, name: '一期', ver: 1, latestVer: 1, definition: def },
  { id: 8, screen: 's10', companyId: null, phase: 2, name: '二期', ver: 1, latestVer: 1, definition: def },
]

const zeroFees = () => Object.fromEntries(FEE_KEYS.map(k => [k, 0])) as Record<(typeof FEE_KEYS)[number], number>
const lgRow = (id: number, tenantId: number | null, tenantName: string): LedgerRowDTO => ({
  ...zeroFees(), factoryRent: 1200, id, tenantId, tenantName,
  balancePrev: 0, totalCollected: 0, note: null, totalReceivable: 1200, balanceEnd: 1200,
})
const ledgerMonth = (year: number, month: number): LedgerMonthDTO => ({
  companyName: '甲公司', year, month, prevMonth: month - 1,
  rows: [lgRow(5, 5, '甲户'), lgRow(6, null, '老王')],
  footer: { ...zeroFees(), factoryRent: 2400, balancePrev: 0, totalReceivable: 2400, totalCollected: 0, balanceEnd: 2400 },
  archivedCols: [],
})

// 附表10 行带 25 个物理费用列,夹具只给本表模板里那一列,其余列后端恒下发 0 —— 这里经 unknown 补形
const s10Row = (id: number, tenantId: number | null, tenantName: string, source: S10RecordDTO['source']): S10RecordDTO =>
  ({ id, tenantId, tenantName, phase: 1, profile: 'factory', note: null, source, total: 800, factoryRent: 800, extraFees: {} }) as unknown as S10RecordDTO
const s10Month = (year: number, month: number): S10MonthDTO => ({
  phase: 1, year, month, recorded: true,
  rows: [s10Row(11, 11, '甲户', 'manual'), s10Row(12, null, '老王', 'import')],
  columnTotals: { factoryRent: 1600 }, grandTotal: 1600, archivedCols: [],
})
const s10Overview: S10OverviewDTO = {
  years: [2026], currentYear: 2026, currentMonth: 9,
  summaries: [{ year: 2026, recordedMonths: 9, tenantCount: 2 }],
}

vi.mock('@/api/books', () => ({
  booksApi: { list: vi.fn(), templateAt: vi.fn(), versions: vi.fn(), pin: vi.fn(), saveTemplate: vi.fn() },
}))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: () => Promise.resolve([{ id: 9, name: '甲公司' }, { id: 8, name: '乙公司' }]) },
  ledgerApi: {
    years: () => Promise.resolve([{ year: 2026, months: 1 }]),
    overview: (_c: number, y: number) => Promise.resolve({
      companyName: '甲公司', year: y, monthsWithData: 1, ytdRecv: 0, avgRecv: 0, activeTenants: 1, months: [],
    }),
    month: (_c: number, y: number, m: number) => Promise.resolve(ledgerMonth(y, m)),
    save: vi.fn(),
    copyFromPrev: vi.fn(), bindTenant: vi.fn(), bindRow: vi.fn(), renameRow: vi.fn(),
  },
}))
// 导入落库那一步替身(解析器 parserProps 模板里要用,照原样)
vi.mock('@/utils/importRegistry', async (orig) => ({
  ...(await orig<typeof import('@/utils/importRegistry')>()),
  runImport: vi.fn(),
}))
// 宽表编辑按钮占锁(useEditLock)。别的用例直接 $emit('enter-edit') 绕开了锁,这里给一个恒批的锁服务
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null, acquiredAt: 1 }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))
vi.mock('@/api/s10', () => ({
  s10Api: {
    getOverview: () => Promise.resolve(s10Overview),
    getMonth: (_p: number, y: number, m: number) => Promise.resolve(s10Month(y, m)),
    batchDelete: () => Promise.resolve({ deleted: 0 }),
    clearImported: () => Promise.resolve({ deleted: 0 }),
  },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
// 深链直落 2026-09 表格态(台账读 company,附表10 读 phase);没选册那条把 query 清空
const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }))

const mounted: VueWrapper[] = []
/** 挂到 document 上:问题面板停用时「页面还在不在文档里」是判据,脱离文档的挂载测不到它 */
function mnt<T extends VueWrapper>(w: T): T { mounted.push(w); return w }
const mountLedger = () => mnt(mount(LedgerView, { attachTo: document.body }))
const mountS10 = () => mnt(mount(S10View, { attachTo: document.body }))

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit']
  route.query = { y: '2026', m: '9', company: '甲公司', phase: '1', tenant: '' }
  vi.mocked(booksApi.list).mockImplementation((screen: string) =>
    Promise.resolve(screen === 's10' ? s10Books : ledgerBooks))
  vi.mocked(booksApi.templateAt).mockImplementation((id: number) =>
    Promise.resolve([...ledgerBooks, ...s10Books].find(b => b.id === id)!))
  vi.mocked(ledgerApi.save).mockReset()
  askQueue.splice(0)
  receipts.splice(0)
})
afterEach(() => { while (mounted.length) mounted.pop()!.unmount() })

describe('月度台账 ·「未绑定」入口胶囊 + 问题面板', () => {
  it('点「未绑定 1」:清单贴着胶囊弹出,没有右侧抽屉的遮罩', async () => {
    const w = mountLedger()
    await flushPromises()
    const chip = w.find('.lg-toolbar .fac')
    expect(chip.text()).toBe('未绑定 1')
    await chip.trigger('click')
    await flushPromises()
    expect(w.find('.lg-toolbar .ds-popover-panel .tip-card').text()).toContain('老王')
    expect(document.querySelector('.fp-sdw-mask')).toBeNull()
  })

  it('面板开着切走(KeepAlive 停用)再切回:面板回到打开', async () => {
    const alive = ref(true)
    const w = mnt(mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(LedgerView) : null) }),
    }), { attachTo: document.body }))
    await flushPromises()
    await w.find('.lg-toolbar .fac').trigger('click')
    await flushPromises()
    alive.value = false
    await flushPromises()
    alive.value = true
    await flushPromises()
    expect(w.find('.lg-toolbar .ds-popover-panel .tip-card').exists()).toBe(true)
  })

  it('未绑定那一行名字旁是「● 未绑定」标记', async () => {
    const w = mountLedger()
    await flushPromises()
    const marks = w.findAll('tbody .lg-tname .fp-mark')
    expect(marks.map(m => [m.text(), m.element.closest('.lg-tname')!.querySelector('.lg-tname-txt')!.textContent]))
      .toEqual([['未绑定', '老王']])
  })

  it('没选册:内容区是一种空状态', async () => {
    route.query = {}
    vi.mocked(booksApi.list).mockResolvedValue([])
    const w = mountLedger()
    await flushPromises()
    expect(w.find('.lgw-main .fp-empty .t').text()).toBe('从左侧选择账册')
  })
})

describe('月度台账 · 会丢草稿的地方先问', () => {
  it('编辑中 0 处改动切账册:不弹,直接切', async () => {
    const w = mountLedger()
    await flushPromises()
    w.findComponent(LedgerWideTable).vm.$emit('enter-edit')
    await flushPromises()
    w.findComponent(BookRail).vm.$emit('select', 2)
    await flushPromises()
    expect(askQueue.length).toBe(0)
    expect(w.findComponent(LedgerWideTable).exists()).toBe(false)
  })

  it('编辑中改了 1 处再切账册:问离开;「继续编辑」留在原处,「放弃」才切', async () => {
    const w = mountLedger()
    await flushPromises()
    w.findComponent(LedgerWideTable).vm.$emit('enter-edit')
    await flushPromises()
    w.findComponent(FPLedgerTable).vm.$emit('cell-edit', { rowKey: 5, key: 'factoryRent', value: '1300' })
    w.findComponent(BookRail).vm.$emit('select', 2)
    await flushPromises()
    expect(askQueue.map(a => [a.title, a.body, a.action])).toEqual([
      ['离开「月度台账 · 甲公司 · 2026-09」？', '这页有 1 处改动还没保存。', '放弃改动并离开'],
    ])
    answer(false)
    await flushPromises()
    expect(w.findComponent(LedgerWideTable).exists()).toBe(true)

    w.findComponent(BookRail).vm.$emit('select', 2)
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(w.findComponent(LedgerWideTable).exists()).toBe(false)
  })

  it('宽表返回箭头(换期):有改动先问离开,0 处直接回矩阵', async () => {
    const w = mountLedger()
    await flushPromises()
    w.findComponent(LedgerWideTable).vm.$emit('enter-edit')
    await flushPromises()
    w.findComponent(FPLedgerTable).vm.$emit('cell-edit', { rowKey: 5, key: 'factoryRent', value: '1300' })
    await flushPromises()   // 改动数经父层重渲染传进宽表
    await w.find('.lg-back').trigger('click')
    await flushPromises()
    expect(askQueue.map(a => a.title)).toEqual(['离开「月度台账 · 甲公司 · 2026-09」？'])
    answer(false)
    await flushPromises()

    w.findComponent(LedgerWideTable).vm.$emit('cancel')   // 退出编辑 = 0 处改动
    await flushPromises()
    await w.find('.lg-back').trigger('click')
    await flushPromises()
    expect(askQueue.length).toBe(0)
    expect(w.findComponent(LedgerWideTable).exists()).toBe(false)
  })

  it('批量删除走删除类确认,确认后才从草稿里拿掉', async () => {
    const w = mountLedger()
    await flushPromises()
    w.findComponent(LedgerWideTable).vm.$emit('enter-edit')
    await flushPromises()
    w.findComponent(FPLedgerTable).vm.$emit('toggle-select', 6)
    await flushPromises()
    await w.findAll('button').find(b => b.text().startsWith('删除所选'))!.trigger('click')
    await flushPromises()
    expect(askQueue.map(a => [a.action, a.danger])).toEqual([['删除 1 行', true]])
    expect(document.querySelector('.lg-bulk-mask')).toBeNull()
    answer(true)
    await flushPromises()
    expect((w.vm as unknown as { draft: LedgerRowDTO[] }).draft.map(r => r.tenantName)).toEqual(['甲户'])
  })

  it('保存失败:失败回执带「重试」,点重试再存一次', async () => {
    vi.mocked(ledgerApi.save)
      .mockRejectedValueOnce(new Error('服务器没有响应'))
      .mockResolvedValueOnce(ledgerMonth(2026, 9))
    const w = mountLedger()
    await flushPromises()
    w.findComponent(LedgerWideTable).vm.$emit('enter-edit')
    await flushPromises()
    w.findComponent(LedgerWideTable).vm.$emit('save')
    await flushPromises()
    expect(receipts.map(r => [r.tone, r.text, r.action?.label])).toEqual([['fail', '服务器没有响应', '重试']])
    receipts[0].action!.run()
    await flushPromises()
    expect(vi.mocked(ledgerApi.save)).toHaveBeenCalledTimes(2)
  })
})

describe('附表10 ·「未绑定」入口胶囊 + 离开确认', () => {
  it('点「未绑定 1」:清单贴着胶囊弹出,没有右侧抽屉的遮罩', async () => {
    const w = mountS10()
    await flushPromises()
    const chip = w.find('.s10-toolbar .fac')
    expect(chip.text()).toBe('未绑定 1')
    await chip.trigger('click')
    await flushPromises()
    expect(w.find('.s10-toolbar .ds-popover-panel .tip-card').text()).toContain('老王')
    expect(document.querySelector('.fp-sdw-mask')).toBeNull()
  })

  it('编辑中 0 处改动切账册:不弹,直接回矩阵', async () => {
    const w = mountS10()
    await flushPromises()
    w.findComponent(SchedHeader).vm.$emit('toggle-edit')
    await flushPromises()
    w.findComponent(BookRail).vm.$emit('select', 8)
    await flushPromises()
    expect(askQueue.length).toBe(0)
    expect(w.findComponent(S10Table).exists()).toBe(false)
  })

  it('编辑中改了 1 处再切账册:问离开,「继续编辑」留在原处', async () => {
    const w = mountS10()
    await flushPromises()
    w.findComponent(SchedHeader).vm.$emit('toggle-edit')
    await flushPromises()
    const t = w.findComponent(S10Table)
    t.vm.$emit('cell', t.props('rows')[0], 'factoryRent', 900)
    w.findComponent(BookRail).vm.$emit('select', 8)
    await flushPromises()
    expect(askQueue.map(a => [a.title, a.body])).toEqual([
      ['离开「附表10 · 一期 · 2026-09」？', '这页有 1 处改动还没保存。'],
    ])
    answer(false)
    await flushPromises()
    expect(w.findComponent(S10Table).exists()).toBe(true)
  })
})

describe('附表10 · 返回箭头(切账期)先问离开', () => {
  // 画布 02-A:「切账期」会丢草稿,走离开确认。页头返回箭头就是回年月矩阵换期。
  // 破坏验证:S10View 的 @back 改回 goGate → 改了 1 处点返回不问、直接回矩阵 → 红
  it('❗改了 1 处点返回:问离开,「继续编辑」留在原处,「放弃」才回矩阵;0 处不问', async () => {
    const w = mountS10()
    await flushPromises()
    w.findComponent(SchedHeader).vm.$emit('toggle-edit')
    await flushPromises()
    const t = w.findComponent(S10Table)
    t.vm.$emit('cell', t.props('rows')[0], 'factoryRent', 900)
    await flushPromises()
    await w.find('.lc-back').trigger('click')
    await flushPromises()
    expect(askQueue.map(a => [a.title, a.body, a.action])).toEqual([
      ['离开「附表10 · 一期 · 2026-09」？', '这页有 1 处改动还没保存。', '放弃改动并离开'],
    ])
    answer(false)
    await flushPromises()
    expect(w.findComponent(S10Table).exists(), '答「继续编辑」还在原处').toBe(true)

    await w.find('.lc-back').trigger('click')
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(w.findComponent(S10Table).exists()).toBe(false)
  })

  it('浏览态点返回:不问,直接回矩阵', async () => {
    const w = mountS10()
    await flushPromises()
    await w.find('.lc-back').trigger('click')
    await flushPromises()
    expect(askQueue.length).toBe(0)
    expect(w.findComponent(S10Table).exists()).toBe(false)
  })
})

describe('附表10 · 导入前确认,答完再守编辑态', () => {
  // 破坏验证:S10View.onImportClick 去掉答完后的 `if (!edit.value) return` → 退出编辑后导入窗照开 → 红
  it('❗有 1 处改动点导入:问的途中被强制退出编辑,答「仍要导入」也不开导入窗', async () => {
    const w = mountS10()
    await flushPromises()
    w.findComponent(SchedHeader).vm.$emit('toggle-edit')
    await flushPromises()
    const t = w.findComponent(S10Table)
    t.vm.$emit('cell', t.props('rows')[0], 'factoryRent', 900)
    await flushPromises()
    await w.findAll('.s10-page button').find(b => b.text() === '导入 Excel')!.trigger('click')
    await flushPromises()
    expect(askQueue.map(a => [a.title, a.body])).toEqual([['导入会整期替换本期数据', '本期有 1 处改动还没保存，导入后会丢失。']])
    w.findComponent(SchedHeader).vm.$emit('toggle-edit', true)   // 被接管 / 提权到期 / 换期
    await flushPromises()
    answer(true)
    await flushPromises()
    expect((w.vm as unknown as { importing: boolean }).importing).toBe(false)
  })
})

describe('月度台账宽表 · 导入 / 从上月复制 / 取消先问', () => {
  const wide = (w: VueWrapper) => w.findComponent(LedgerWideTable)
  const btn = (w: VueWrapper, text: string) => wide(w).findAll('button').find(b => b.text() === text)!
  async function editing(edits: number) {
    const w = mountLedger()
    await flushPromises()
    wide(w).vm.$emit('enter-edit')
    await flushPromises()
    for (let i = 0; i < edits; i++)
      w.findComponent(FPLedgerTable).vm.$emit('cell-edit', { rowKey: 5 + i, key: 'factoryRent', value: String(1300 + i) })
    await flushPromises()
    return w
  }
  beforeEach(() => { vi.mocked(ledgerApi.copyFromPrev).mockReset() })

  // 破坏验证:LedgerWideTable.onImport 去掉答完后的 `if (!props.edit) return` → 第三段红
  it('❗2 处改动点导入:问「导入会重新载入本月数据」给 2 处;答取消不导;问的途中退出编辑,答「仍要导入」也不导', async () => {
    const w = await editing(2)
    await btn(w, '导入 Excel').trigger('click')
    await flushPromises()
    expect(askQueue.map(a => [a.title, a.body, a.action, !!a.danger])).toEqual([
      ['导入会重新载入本月数据', '本月有 2 处改动还没保存，导入后会丢失。', '仍要导入', false],
    ])
    answer(false)
    await flushPromises()
    expect(wide(w).emitted('import'), '答取消就不导').toBeUndefined()

    await btn(w, '导入 Excel').trigger('click')
    await flushPromises()
    wide(w).vm.$emit('cancel')   // 父层 cancelEdit:edit → false
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(wide(w).emitted('import'), '退出编辑后不该再导').toBeUndefined()
  })

  // 破坏验证:LedgerWideTable.onCopyPrev 去掉答完后的 `if (!props.edit) return` → 红
  it('❗从上月复制走删除类确认;问的途中退出编辑,答「复制并覆盖」也不复制', async () => {
    const w = await editing(0)
    await btn(w, '从上月复制').trigger('click')
    await flushPromises()
    expect(askQueue.map(a => [a.title, a.action, a.danger])).toEqual([['从 8 月复制到本月？', '复制并覆盖', true]])
    wide(w).vm.$emit('cancel')
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(wide(w).emitted('copy-from-prev')).toBeUndefined()
    expect(ledgerApi.copyFromPrev).not.toHaveBeenCalled()
  })

  // 破坏验证:LedgerWideTable.onCancel 不问直接 emit('cancel') → 红
  it('❗1 处改动点取消:问「退出编辑」;答「继续编辑」不退', async () => {
    const w = await editing(1)
    await btn(w, '取消').trigger('click')
    await flushPromises()
    expect(askQueue.map(a => [a.title, a.body, a.action])).toEqual([
      ['退出编辑「月度台账 · 甲公司 · 2026-09」？', '这页有 1 处改动还没保存。', '放弃改动并退出编辑'],
    ])
    answer(false)
    await flushPromises()
    expect(wide(w).emitted('cancel')).toBeUndefined()
    expect(wide(w).props('edit')).toBe(true)
  })
})

describe('月度台账 · 导入文件的两道确认', () => {
  type ImportVm = { onImport: (recs: Array<Record<string, unknown>>, fileName: string) => Promise<void> }
  beforeEach(() => { vi.mocked(runImport).mockReset() })

  // 破坏验证:LedgerView.onImport 的年月确认删掉 → 答 false 也导 → 红
  it('❗文件年月与目标不一致:问「导入到 2026 年 9 月？」;答取消不导', async () => {
    const w = mountLedger()
    await flushPromises()
    const done = (w.vm as unknown as ImportVm).onImport(
      [{ tenantName: '新户', factoryRent: 100, __ymDetected: { year: 2026, month: 8 } }], '台账.xlsx')
    await flushPromises()
    expect(askQueue.map(a => [a.title, a.body, a.action])).toEqual([[
      '导入到 2026 年 9 月？', '文件标题识别为 2026 年 8 月，当前导入目标是 2026 年 9 月。', '仍导入到本月',
    ]])
    answer(false)
    await done
    expect(runImport).not.toHaveBeenCalled()
  })

  // 破坏验证:runLedgerImport 的覆盖确认删掉 → 红
  it('❗文件里有本月已有台账的租户:问「导入会覆盖已有的台账数据」给 1 家;答取消不导', async () => {
    const w = mountLedger()
    await flushPromises()
    const done = (w.vm as unknown as ImportVm).onImport(
      [{ tenantName: '甲户', factoryRent: 100, __ymDetected: { year: 2026, month: 9 } }], '台账.xlsx')
    await flushPromises()
    expect(askQueue.map(a => [a.title, a.body])).toEqual([[
      '导入会覆盖已有的台账数据', '本月已有 1 家租户的台账数据，文件里提供的列会被覆盖。',
    ]])
    answer(false)
    await done
    expect(runImport).not.toHaveBeenCalled()
  })
})

describe('月度台账 · 绑定写失败的回执与重试', () => {
  type BindVm = {
    onBindRow: (rowId: number, tenantId: number | null) => Promise<void>
    onBindIssue: (name: string, tenantId: number) => Promise<void>
  }
  beforeEach(() => {
    vi.mocked(ledgerApi.bindRow).mockReset()
    vi.mocked(ledgerApi.bindTenant).mockReset()
  })

  // 破坏验证:onBindRow 开头的 `if (!edit.value) return` 删掉 → 退出编辑后点重试仍打出去 → 最后一段红
  it('❗行绑定失败:失败回执带「重试」;重试再打一次;退出编辑后再点重试不打', async () => {
    vi.mocked(ledgerApi.bindRow)
      .mockRejectedValueOnce(new Error('网络断了'))
      .mockResolvedValue(lgRow(6, 5, '老王'))
    const w = mountLedger()
    await flushPromises()
    w.findComponent(LedgerWideTable).vm.$emit('enter-edit')
    await flushPromises()
    await (w.vm as unknown as BindVm).onBindRow(6, 5)
    await flushPromises()
    expect(receipts.map(r => [r.tone, r.text, r.action?.label])).toEqual([['fail', '网络断了', '重试']])
    receipts[0].action!.run()
    await flushPromises()
    expect(ledgerApi.bindRow).toHaveBeenCalledTimes(2)

    w.findComponent(LedgerWideTable).vm.$emit('cancel')
    await flushPromises()
    receipts[0].action!.run()
    await flushPromises()
    expect(ledgerApi.bindRow, '浏览态下重试被打出去了').toHaveBeenCalledTimes(2)
  })

  // 破坏验证:onBindIssue 的 conflicts>0 分支改成 receipt.ok → 红
  it('❗按名绑定有冲突行:提醒回执(warn),写出跳过了几行', async () => {
    vi.mocked(ledgerApi.bindTenant).mockResolvedValue({ bound: 3, conflicts: 2 })
    const w = mountLedger()
    await flushPromises()
    w.findComponent(LedgerWideTable).vm.$emit('enter-edit')
    await flushPromises()
    await (w.vm as unknown as BindVm).onBindIssue('老王', 5)
    await flushPromises()
    expect(receipts.map(r => [r.tone, r.text])).toEqual([[
      'warn', '已绑定 3 行；另有 2 行因目标租户当月已有台账行而跳过，请到对应月份人工合并',
    ]])
  })
})

describe('月度台账 · 改动数登记给 auth(关页签 / 关浏览器按它问)', () => {
  // 宽表的锁(useEditLock)带的是父层算的改动数;不带就按缺省 1 算,0 处改动关页签也白问一句。
  // 破坏验证:LedgerWideTable 的 useEditLock 第三个参数删掉 → 第一个断言变 1 → 红
  it('❗点编辑按钮占锁进编辑:0 处改动登记 0;改一格登记 1', async () => {
    const w = mountLedger()
    await flushPromises()
    await w.find('.lg-lockbtn').trigger('click')
    await flushPromises()
    expect(w.findComponent(LedgerWideTable).props('edit'), '经锁进了编辑态').toBe(true)
    const auth = useAuthStore()
    expect(auth.dirtyTotal).toBe(0)
    w.findComponent(FPLedgerTable).vm.$emit('cell-edit', { rowKey: 5, key: 'factoryRent', value: '1300' })
    await flushPromises()
    expect(auth.dirtyTotal).toBe(1)
  })
})

describe('附表10 宽表 · 标记与空状态', () => {
  const base = { groups: [], phaseName: '一期', year: 2026, month: 9, edit: false }

  it('未绑定行名字旁是「● 未绑定」标记,点它开绑定', async () => {
    const rows = s10Month(2026, 9).rows
    const w = mnt(mount(S10Table, { props: { ...base, rows } }))
    const marks = w.findAll('.s10-c-name .fp-mark')
    expect(marks.map(m => m.text())).toEqual(['未绑定'])
    await marks[0].trigger('click')
    expect(w.emitted('bindRow')).toEqual([[rows[1]]])
  })

  it('没有行:内容区是一种空状态,编辑态的按钮是「新增租户」', async () => {
    const w = mnt(mount(S10Table, { props: { ...base, rows: [], edit: true } }))
    expect(w.find('.fp-empty .t').text()).toBe('2026 年 9 月 · 一期 暂无收款记录')
    const btn = w.find('.fp-empty button')
    expect(btn.text()).toBe('新增租户')
    await btn.trigger('click')
    expect(w.emitted('add')).toHaveLength(1)
  })
})
