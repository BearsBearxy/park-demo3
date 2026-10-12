/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
// 导入中心(ix-v2 六张图 + 动效板 ⑤;实现规范 2026-10-10 T6 / T9):
// 缺计数与组头、「还差 N 样」问题面板、都齐、只读态、状态→颜色、宽屏「上次导入」单列、导入记录分页与页签、
// 台账小窗、胶囊直接导、导完关窗换数 + 行高亮的设与清、KeepAlive 切回重读。
// 弹窗另有人在重写:这里把 FpImportModal 换成桩,只经它的 props(runner / go / 缺省值)和 close / go 事件跟它打交道。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useAuthStore } from '@/stores/auth'
import type { ImportCoverageDTO, ImportLogDTO, ImportLogPageDTO } from '@/types/importLog'

const query: Record<string, string> = {}
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query, meta: {}, get fullPath() { return '/import?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/importLog', () => ({ importLogApi: { coverage: vi.fn(), page: vi.fn(), record: vi.fn() } }))
vi.mock('@/api/ledger', () => ({ companyApi: { list: vi.fn() }, ledgerApi: { month: vi.fn() } }))
vi.mock('@/api/books', () => ({ booksApi: { list: vi.fn() } }))
vi.mock('@/api/charging', () => ({ chargingApi: { cats: vi.fn() } }))
vi.mock('@/api/zones', () => ({ zonesApi: { list: vi.fn() } }))
vi.mock('@/utils/importRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/importRegistry')>()),
  runImport: vi.fn(),
}))

import ImportCenterView from '@/views/import-center/ImportCenterView.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import { importLogApi } from '@/api/importLog'
import { companyApi, ledgerApi } from '@/api/ledger'
import { useTabsStore } from '@/stores/tabs'
import { booksApi } from '@/api/books'
import { zonesApi } from '@/api/zones'
import { IMPORT_TYPES, runImport } from '@/utils/importRegistry'
import { receipts } from '@/utils/receipt'

// ── 夹具:照 ix-v2-main 那一屏(9 月,还差 5 样:园区抄表宿舍、台账水电、附表12、附表8 到 8月、科目余额表综合) ──
const CO = (miss?: string) => [
  { label: '租赁', code: '1', done: miss !== '1' }, { label: '综合', code: '2', done: miss !== '2' }, { label: '水电', code: '3', done: miss !== '3' },
]
const ZONES = (miss?: string) => ['p1:一期', 'p2:二期', 'p3:三期', 'dorm:宿舍'].map(s => { const [code, label] = s.split(':'); return { label, code, done: code !== miss } })
const S10 = (miss?: string) => ['一期', '二期', '三期', '宿舍'].map((label, i) => ({ label, code: String(i + 1), done: String(i + 1) !== miss }))
const last = (at: string, operator: string, rows: number) => ({ at, operator, rows })
function covFixture(o: { meterMiss?: string; ledgerMiss?: string; tbMiss?: string; s10Miss?: string; salary?: boolean; c8?: string } = {}): ImportCoverageDTO[] {
  const { meterMiss = 'dorm', ledgerMiss = '3', tbMiss = '2', s10Miss, salary = false, c8 = '2026-08' } = o
  const month = (key: string, upTo: string, lastAt = '2026-10-07T10:00:00') =>
    ({ key, kind: 'month' as const, upTo, missing: upTo < '2026-09', last: last(lastAt, '张敏', 27) })
  return [
    { key: 'meter', kind: 'chips', chips: ZONES(meterMiss), missing: !!meterMiss, last: last('2026-10-08T16:43:00', '李工', 55) },
    { key: 'pvMeter', kind: 'day', upTo: '2026-09-30', missing: false, last: last('2026-10-09T18:02:00', '李工', 117) },
    { key: 'cpMeter', kind: 'day', upTo: '2026-09-30', missing: false, last: last('2026-10-09T17:55:00', '李工', 486) },
    { key: 'ledger', kind: 'chips', chips: CO(ledgerMiss), missing: !!ledgerMiss, last: last('2026-10-10T23:27:00', '张敏', 65) },
    { key: 's10', kind: 'chips', chips: S10(s10Miss), missing: !!s10Miss, last: last('2026-10-06T09:12:00', '张敏', 97) },
    { key: 'salary', kind: 'has', has: salary, missing: !salary, last: last('2026-09-02T09:00:00', '张敏', 62) },
    month('pv', '2026-09'), month('charging_7', '2026-09'), month('charging_8', c8, '2026-09-05T10:00:00'),
    month('elec', '2026-09'), month('elecCost', '2026-09'), month('office_13', '2026-09'), month('office_14', '2026-09'),
    { key: 'report_is', kind: 'chips', chips: CO(), missing: false, last: last('2026-10-09T10:00:00', '张敏', 336) },
    { key: 'report_bs', kind: 'chips', chips: CO(), missing: false, last: last('2026-10-09T10:00:00', '张敏', 264) },
    { key: 'report_tb', kind: 'chips', chips: CO(tbMiss), missing: !!tbMiss, last: last('2026-10-09T10:00:00', '张敏', 5828) },
    month('pnl_s1', '2026-09'), month('pnl_s2', '2026-09'), month('pnl_s3', '2026-09'), month('pnl_s4', '2026-09'), month('pnl_s5', '2026-09'),
    { key: 'budget', kind: 'year', has: true, missing: false, last: last('2026-01-06T10:00:00', '张敏', 112) },
    { key: 'contractFull', kind: 'na', missing: false, last: last('2026-09-14T10:00:00', '张敏', 225) },
    { key: 'billingTerms', kind: 'na', missing: false },
  ]
}
const LOG = (o: Partial<ImportLogDTO> & { id: number; dataType: string }): ImportLogDTO => ({
  typeLabel: '', fileName: 'a.xlsx', target: null, rows: 0, ok: 0, warn: 0, status: 'complete', operator: '张敏',
  createdAt: '2026-10-10T10:00:00', periodFrom: null, periodTo: null, companyId: null, zone: null, note: null, ...o,
})
const ROWS: ImportLogDTO[] = [
  LOG({ id: 101, dataType: 'ledger', fileName: '（粘贴）', ok: 65, rows: 65, createdAt: '2026-10-10T23:27:00', periodFrom: '2026-09', periodTo: '2026-09', companyId: 1 }),
  LOG({ id: 100, dataType: 'ledger', fileName: '9月综合台账.xlsx', ok: 32, warn: 4, rows: 36, status: 'partial', createdAt: '2026-10-10T23:23:00', periodFrom: '2026-09', periodTo: '2026-09', companyId: 2 }),
  LOG({ id: 99, dataType: 'pvMeter', fileName: '光伏日报1009.xlsx', ok: 117, rows: 117, operator: '李工', periodFrom: '2026-10-01', periodTo: '2026-10-09' }),
  LOG({ id: 98, dataType: 'report_tb', fileName: '综合科目余额表9月.xls', status: 'rejected', note: '表头和模板对不上', periodFrom: '2026-09', periodTo: '2026-09', companyId: 2 }),
  LOG({ id: 97, dataType: 'meter', fileName: '9月抄表.xlsx', ok: 288, warn: 4, status: 'partial', operator: '李工', periodFrom: '2026-09', periodTo: '2026-09', zone: 'p2' }),
  LOG({ id: 96, dataType: 's10', fileName: '附表10-9月.xlsx', ok: 24, warn: 2, status: 'partial', periodFrom: '2026-09', periodTo: '2026-09', zone: '2' }),
  LOG({ id: 95, dataType: 'elec', fileName: '旧记录.xlsx', ok: 72 }),   // 0.33 以前的旧记录:没有结构列
]
const PAGE = (rows = ROWS, counts = { all: 67, partial: 31, rejected: 1 }): ImportLogPageDTO => ({ total: counts.all, rows, counts })

// 每类导入那一屏的编辑 + 查看(去看 / 去 X 看要查看权),再加导入中心查看与本月出账查看
const screen = (p: string) => p.split(':')[0]
const ALL = [...new Set(IMPORT_TYPES.flatMap(t => t.module).flatMap(p => [p, `${screen(p)}:view`]))]
  .concat(['import:view', 'data-home:view', 'meters:view', 'ledger:view', 'trial-balance:view', 'sales-income:view', 'pv-income:view'])

// ResizeObserver 桩:按被观察的元素记回调,宽屏用例对清单那一块喂宽度
const roByEl = new Map<Element, (es: { contentRect: { width: number } }[]) => void>()
class RO {
  constructor(private cb: (es: { contentRect: { width: number } }[]) => void) {}
  observe(el: Element) { roByEl.set(el, this.cb) }
  unobserve(el: Element) { roByEl.delete(el) }
  disconnect() {}
}

const mounted: VueWrapper[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  for (const k of Object.keys(query)) delete query[k]
  receipts.splice(0)
  roByEl.clear()
  vi.stubGlobal('ResizeObserver', RO)
  vi.setSystemTime(new Date('2026-10-11T09:00:00'))
  useAuthStore().permissions = [...ALL]
  vi.mocked(importLogApi.coverage).mockResolvedValue(covFixture())
  vi.mocked(importLogApi.page).mockResolvedValue(PAGE())
  vi.mocked(companyApi.list).mockResolvedValue([
    { id: 1, name: '某某租赁有限公司', short: '租赁', sortNo: 1 }, { id: 2, name: '某某综合服务公司', short: '综合', sortNo: 2 },
    { id: 3, name: '某某水电公司', short: '水电', sortNo: 3 },
  ] as never)
  vi.mocked(booksApi.list).mockResolvedValue([])
  vi.mocked(zonesApi.list).mockResolvedValue([
    { code: 'p1', name: '一期' }, { code: 'p2', name: '二期' }, { code: 'p3', name: '三期' }, { code: 'dorm', name: '宿舍' },
  ] as never)
  vi.mocked(runImport).mockResolvedValue({ res: { imported: 3, skipped: 0, errors: [] }, logIds: [201] })
})
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const STUBS = { Teleport: true, FpImportModal: true }
async function open() {
  const w = mount(ImportCenterView, { global: { stubs: STUBS } })
  mounted.push(w)
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof open>>
const rowOf = (w: W, key: string) => w.find(`.ix-row[data-key="${key}"]`)
const ghs = (w: W) => w.findAll('.ix-gh').map(g => g.text())
const modal = (w: W) => w.findComponent(FpImportModal)
const chipOf = (w: W, key: string, label: string) => rowOf(w, key).findAll('.ix-chip').find(c => c.text() === label)!

describe('导入中心 · 清单(ix-v2-main)', () => {
  // 破坏验证:missCount 不按 missing 数(如数全部 visibleTypes)→ 红;unit 不传 → 「还差 5」少了「样」→ 红
  it('❗页头「还差 5 样」= 有权导的类里 missing 的个数;组头 n/m = 齐的 / 全部', async () => {
    const w = await open()
    expect(importLogApi.coverage).toHaveBeenCalledWith('2026-09')   // 缺省 = 上个月
    expect(w.find('.fac').text()).toBe('还差 5 样')
    expect(ghs(w)).toEqual(['出账 · 每月工序2/3', '记账 · 按月1/3', '记账 · 按年6/7', '账簿与报表8/9', '档案2/2'])
    // 两列:左三组、右两组
    const cols = w.findAll('.ix-col')
    expect(cols).toHaveLength(2)
    expect(cols[1].findAll('.ix-gh').map(g => g.text().replace(/[\d/]+$/, ''))).toEqual(['账簿与报表', '档案'])
    // 行:名 + 一句 + 上次
    expect(rowOf(w, 'pvMeter').find('.ix-name').text()).toBe('光伏抄表')
    expect(rowOf(w, 'pvMeter').find('.ix-desc').text()).toBe('各栋光伏每天的发电读数')
    expect(rowOf(w, 'meter').find('.ix-lst').text()).toBe('上次 10月8日')
    expect(rowOf(w, 'billingTerms').find('.ix-lst').text()).toBe('从没导过')
  })

  // 破坏验证:.ix-chip 的 miss 类按 done 反着挂 → 红;dot 的 data-k 不看 missing(写死 ok)→ 附表8 那条红
  it('❗状态 → 颜色:缺的胶囊橙、齐的灰;「到 N月」落后于所选月的点橙,其余蓝;不按月无点', async () => {
    const w = await open()
    expect(chipOf(w, 'meter', '宿舍').classes()).toContain('miss')
    expect(chipOf(w, 'meter', '一期').classes()).not.toContain('miss')
    expect(chipOf(w, 'ledger', '水电').classes()).toContain('miss')
    const dot = (key: string) => rowOf(w, key).find('.ix-dot')
    expect([dot('pvMeter').text(), dot('pvMeter').attributes('data-k')]).toEqual(['到 9月30日', 'ok'])
    expect([dot('charging_7').text(), dot('charging_7').attributes('data-k')]).toEqual(['到 9月', 'ok'])
    expect([dot('charging_8').text(), dot('charging_8').attributes('data-k')]).toEqual(['到 8月', 'miss'])
    expect([dot('salary').text(), dot('salary').attributes('data-k')]).toEqual(['没有', 'miss'])
    expect([dot('budget').text(), dot('budget').attributes('data-k')]).toEqual(['2026年已有', 'ok'])
    expect([dot('contractFull').text(), dot('contractFull').attributes('data-k')]).toEqual(['不按月', 'na'])
    // 颜色本身钉在样式上:缺 = 警示色,齐 = 蓝点
    const css = readFileSync(join(__dirname, '../ImportCenterView.vue'), 'utf8')
    expect(css).toMatch(/\.ix-chip\.miss \{ border-color:var\(--status-warning\); background:var\(--warn-soft\); color:var\(--warn-text\); \}/)
    expect(css).toMatch(/\.ix-dot\[data-k="miss"\]::before \{ background:var\(--status-warning\); \}/)
  })

  it('胶囊一个都没有(新园区还没建启用公司):写「没有」、标橙', async () => {
    vi.mocked(importLogApi.coverage).mockResolvedValue(covFixture().map(c => (c.key === 'ledger' ? { ...c, chips: [], missing: true } : c)))
    const w = await open()
    const d = rowOf(w, 'ledger').find('.ix-dot')
    expect([d.text(), d.attributes('data-k')]).toEqual(['没有', 'miss'])
  })

  // 破坏验证:ym 的 ‹ › 不走 addMonth(写成字符串拼)→ 跨年那步红
  it('‹ › 换月重问一次;12 月往后是下一年 1 月', async () => {
    const w = await open()
    const [prev, next] = w.findAll('.ix-nav')
    await next.trigger('click'); await next.trigger('click'); await next.trigger('click'); await next.trigger('click')
    await flushPromises()
    expect(vi.mocked(importLogApi.coverage).mock.calls.at(-1)).toEqual(['2027-01'])
    await prev.trigger('click')
    await flushPromises()
    expect(vi.mocked(importLogApi.coverage).mock.calls.at(-1)).toEqual(['2026-12'])
  })

  // 用户 2026-10-11 定:点「还差 N 样」弹问题面板(原稿 ix-v2-filter 的筛选态作废),清单不动
  // 破坏验证:面板 hint 不按 kind 写(都写「没有」)→ 台账 / 附表8 / 科目余额表那几句红;点开就筛清单 → 24 行那句红;
  //           点一行不带只缺的那一个 code → 台账小窗公司那句红
  it('❗点「还差 5 样」弹面板:标题写哪个月,一样一行写缺什么;清单 24 行不动;点一行直接导(只缺一家就带上那家)', async () => {
    const w = await open()
    expect(w.find('.fap').exists(), '没点不出').toBe(false)
    await w.find('.fac').trigger('click')
    expect(w.find('.fap-tg .t').text()).toBe('9月还差这几样')
    expect(w.findAll('.fap-item').map(i => [i.find('.tx').text(), i.find('.hn').text()])).toEqual([
      ['园区抄表', '宿舍没有'], ['月度台账', '水电没有'], ['附表12 工资明细', '没有'],
      ['附表8 电动车充电桩', '9月没有'], ['科目余额表', '综合没有'],
    ])
    expect(w.findAll('.ix-row'), '清单不筛').toHaveLength(24)
    expect(w.find('.fac.on').exists(), '没有筛选态').toBe(false)
    await w.findAll('.fap-item')[1].trigger('click')
    await flushPromises()
    expect(w.find('.fap').exists(), '点了收起面板').toBe(false)
    expect((w.vm as unknown as { lf: unknown }).lf).toEqual({ companyId: 3, ym: '2026-09' })
  })

  it('面板:几家全缺写「N 家都没有」;选的不是今年带年;光伏抄表录到的日子早于月底写「只到 X」', async () => {
    vi.mocked(importLogApi.coverage).mockResolvedValue(covFixture().map(c =>
      c.key === 'report_is' ? { ...c, chips: CO().map(x => ({ ...x, done: false })), missing: true }
      : c.key === 'pvMeter' ? { ...c, upTo: '2025-01-20', missing: true } : c))
    query.p = '2025-01'
    const w = await open()
    await w.find('.fac').trigger('click')
    expect(w.find('.fap-tg .t').text()).toBe('2025年1月还差这几样')
    const hint = (name: string) => w.findAll('.fap-item').find(i => i.find('.tx').text() === name)!.find('.hn').text()
    expect(hint('利润表')).toBe('3 家都没有')
    expect(hint('光伏抄表')).toBe('只到 2025年1月20日')
    expect(hint('附表8 电动车充电桩')).toBe('2025年1月没有')
  })

  // 破坏验证:rowOf 的 month 分支去掉 gap 判断 → 写回「到 12月」→ 红
  it('❗清单:录到的月不早于所选月却还缺(所选月那一行没有)写「9月没有」标橙,不写「到 12月」', async () => {
    vi.mocked(importLogApi.coverage).mockResolvedValue(covFixture().map(c => (c.key === 'charging_7' ? { ...c, upTo: '2026-12', missing: true } : c)))
    const w = await open()
    const d = rowOf(w, 'charging_7').find('.ix-dot')
    expect([d.text(), d.attributes('data-k')]).toEqual(['9月没有', 'miss'])
  })

  // 破坏验证:watch(ym) 改回先把 cov 置 null → 「胶囊还在」红
  it('❗换月:新数没到之前胶囊、记录里的公司名都留着,状态格空着;到了一次换上', async () => {
    const w = await open()
    let done!: (v: ImportCoverageDTO[]) => void
    vi.mocked(importLogApi.coverage).mockReturnValueOnce(new Promise(r => { done = r }))
    await w.findAll('.ix-nav')[0].trigger('click')
    await flushPromises()
    expect(w.find('.fac').text(), '入口胶囊常驻').toBe('还差 5 样')
    expect(rowOf(w, 'meter').findAll('.ix-chip'), '状态格空着,不拿上个月的顶').toHaveLength(0)
    expect(w.findAll('.ix-card tbody tr')[0].find('td:nth-child(2)').text(), '导入记录不按月筛,公司名不掉').toBe('月度台账 · 9月 · 租赁')
    done(covFixture({ tbMiss: '' }))
    await flushPromises()
    expect(w.find('.fac').text()).toBe('还差 4 样')
  })

  it('换月取数失败:记录里的公司名、期区名照写(名字攒着不清)', async () => {
    const w = await open()
    vi.mocked(importLogApi.coverage).mockRejectedValueOnce(new Error('net'))
    await w.findAll('.ix-nav')[0].trigger('click')
    await flushPromises()
    expect((w.vm as unknown as { covErr: boolean }).covErr, '前提:这个月的数没取到').toBe(true)
    const trs = w.findAll('.ix-card tbody tr')
    expect(trs[0].find('td:nth-child(2)').text()).toBe('月度台账 · 9月 · 租赁')
    expect(trs[4].find('td:nth-child(2)').text()).toBe('园区抄表 · 9月 · 二期')
  })

  // 破坏验证:FPAlertChip 不传 :disabled → 「不可点」那句红
  it('❗都齐了(ix-v2-allok):灰「无待导入」、不可点、组头全满', async () => {
    vi.mocked(importLogApi.coverage).mockResolvedValue(covFixture({ meterMiss: '', ledgerMiss: '', tbMiss: '', salary: true, c8: '2026-09' }))
    const w = await open()
    const fac = w.find('.fac')
    expect(fac.classes()).toContain('quiet')
    expect(fac.text()).toBe('无待导入')
    expect(fac.attributes('disabled')).toBeDefined()
    expect(ghs(w)).toEqual(['出账 · 每月工序3/3', '记账 · 按月3/3', '记账 · 按年7/7', '账簿与报表9/9', '档案2/2'])
    expect(w.findAll('.ix-chip.miss')).toHaveLength(0)
    expect(rowOf(w, 'salary').find('.ix-dot').text()).toBe('有')
  })

  // 破坏验证:readOnly 判据改成 false → 清单照出、空态卡没有 → 红;页头不按 readOnly 收 → 月份控件还在 → 红
  it('❗只读态(没有任何可导的类,ix-v2-ro):页头只剩标题,清单换成锁头空态卡 + 去本月出账,导入记录照常', async () => {
    useAuthStore().permissions = ['import:view', 'data-home:view']
    const w = await open()
    expect(w.find('.ix-head').text()).toBe('导入中心')
    expect(w.find('.ix-nav').exists()).toBe(false)
    expect(w.find('.ix-cols').exists()).toBe(false)
    expect(w.find('.ix-et').text()).toBe('这个账号只能看导入记录')
    expect(w.find('.ix-es').text()).toBe('要导数据，请管理员在角色里勾上那一屏的「编辑」')
    const btn = w.find('.ix-empty button')
    expect(btn.text()).toBe('去本月出账看进度')
    await btn.trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/data-home', query: {} })
    expect(w.findAll('.ix-card tbody tr')).toHaveLength(ROWS.length)
  })

  it('只读、也看不了本月出账:空态卡不出那颗钮', async () => {
    useAuthStore().permissions = ['import:view']
    const w = await open()
    expect(w.find('.ix-empty button').exists()).toBe(false)
  })

  // 破坏验证:WIDE_AT 判据反过来 / 宽屏仍渲染 .ix-lst → 红
  it('❗宽屏(ix-v2-wide):清单宽 ≥ 1400 时「上次导入」单独一列(日期 / 谁 · N 行,合同写户,从没导过一行),窄回去收回状态下面', async () => {
    const w = await open()
    const cols = w.find('.ix-cols').element
    roByEl.get(cols)!([{ contentRect: { width: 1500 } }])
    await flushPromises()
    expect(w.find('.ix-cols').classes()).toContain('is-wide')
    expect(w.findAll('.ix-last')).toHaveLength(24)
    expect(w.findAll('.ix-lst')).toHaveLength(0)
    expect(rowOf(w, 'meter').find('.ix-last').text()).toBe('10月8日李工 · 55 行')
    expect(rowOf(w, 'contractFull').find('.ix-last').text()).toBe('9月14日张敏 · 225 户')
    expect(rowOf(w, 'billingTerms').find('.ix-last').text()).toBe('从没导过')
    // 「上次」列在状态列前面(版式顺序:名 | 上次 | 状态 | 导入)
    const kids = [...rowOf(w, 'meter').element.children].map(e => e.className)
    expect(kids).toEqual(['ix-ico', 'ix-nm', 'ix-last', 'ix-st', 'ix-act'])

    roByEl.get(cols)!([{ contentRect: { width: 1020 } }])
    await flushPromises()
    expect(w.find('.ix-cols').classes()).not.toContain('is-wide')
    expect(w.findAll('.ix-last')).toHaveLength(0)
    expect(rowOf(w, 'meter').find('.ix-lst').text()).toBe('上次 10月8日')
  })
})

describe('导入中心 · 导入记录', () => {
  // 破坏验证:counts 不接到页签 → 页签没数 → 红;pageCount 用 rows.length 算 → 「第 1 / 1 页」→ 红
  it('❗页签带数、近 30 天、共 N 条与页数按每页 8 行算', async () => {
    const w = await open()
    expect(vi.mocked(importLogApi.page).mock.calls[0][0]).toEqual({ page: 1, size: 8, status: undefined, dataType: undefined })
    expect(w.findAll('.fp-phasetab').map(t => t.text())).toEqual(['全部 67', '要核对 31', '被拒 1'])
    expect(w.find('.ix-30').text()).toBe('近 30 天')
    expect(w.find('.fp-pager-total').text()).toBe('共 67 条')
    expect(w.find('.fp-jump-trigger').text()).toBe('第 1 / 9 页')
    expect(w.findAll('.ix-card thead th').map(t => t.text())).toEqual(['时间', '导到哪', '来源', '结果', '谁导的', '', ''])
  })

  // 破坏验证:watch([tab, dest]) 不把 page 拨回 1 → 第二句红;去处没合并同一屏(只发 elec)→ 第三句红
  it('❗切「要核对」按状态重拉第一页;去处按屏合并(附表11 电费成本 = 附表11 + 园区电费模型)', async () => {
    const w = await open()
    const pager = w.findComponent({ name: 'FPPager' })
    pager.vm.$emit('page', 3)
    await flushPromises()
    expect(vi.mocked(importLogApi.page).mock.calls.at(-1)![0]).toMatchObject({ page: 3 })
    await w.findAll('.fp-phasetab')[1].trigger('click')
    await flushPromises()
    expect(vi.mocked(importLogApi.page).mock.calls.at(-1)![0]).toEqual({ page: 1, size: 8, status: 'partial', dataType: undefined })
    const sel = w.findComponent({ name: 'Select' })
    const opt = (sel.props('options') as { value: string; label: string }[]).find(o => o.label === '附表11 电费成本')!
    sel.vm.$emit('update:modelValue', opt.value)
    await flushPromises()
    expect(vi.mocked(importLogApi.page).mock.calls.at(-1)![0]).toEqual({ page: 1, size: 8, status: 'partial', dataType: ['elec', 'elecCost'] })
    expect((sel.props('options') as { label: string }[])[0].label).toBe('全部去处')
  })

  // 破坏验证:被拒行也出去看 → 红;结果列把 warn 当 ok → 红;粘贴不换成「粘贴」→ 红
  it('❗记录行:导到哪(期 · 公司 / 期区)、粘贴、要核对琥珀、被拒红且没有去看、旧记录没有去看', async () => {
    const w = await open()
    const trs = w.findAll('.ix-card tbody tr')
    const cell = (i: number, sel: string) => trs[i].find(sel)
    expect(trs[0].text()).toContain('10-10 23:27')
    expect(trs[0].find('td:nth-child(2)').text()).toBe('月度台账 · 9月 · 租赁')
    expect(cell(0, '.ix-src').classes()).toContain('paste')
    expect(cell(0, '.ix-src').text()).toBe('粘贴')
    expect(cell(0, '.ix-res').text()).toBe('65 行')
    expect(cell(1, '.ix-res').text()).toBe('32 行 · 4 行要核对')
    expect(cell(1, '.ix-w').exists()).toBe(true)
    expect(trs[2].find('td:nth-child(2)').text()).toBe('光伏抄表 · 10月1日–9日')
    expect(trs[3].find('td:nth-child(2)').text()).toBe('科目余额表 · 9月 · 综合')
    expect(cell(3, '.ix-res').text()).toBe('被拒 · 表头和模板对不上')
    expect(cell(3, '.ix-res').classes()).toContain('bad')
    expect(cell(3, '.ix-go').exists()).toBe(false)
    expect(trs[4].find('td:nth-child(2)').text()).toBe('园区抄表 · 9月 · 二期')
    expect(trs[5].find('td:nth-child(2)').text()).toBe('附表10 销售收入 · 9月 · 二期')
    expect(trs[6].find('td:nth-child(2)').text()).toBe('附表11 电费成本')
    expect(cell(6, '.ix-go').exists()).toBe(false)
    // 去看:贴右(空列在它前面),点了去那一屏那一期
    const tds = trs[0].findAll('td')
    expect(tds.at(-2)!.classes()).toContain('fp-fill')
    expect(tds.at(-1)!.text()).toBe('去看')
    await cell(0, '.ix-go').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/ledger', query: { p: '2026-09', co: '1' } })
  })
})

describe('导入中心 · 打开导入', () => {
  // 破坏验证:openLedgerForm 用深链 / 首家公司兜底 → 公司不空 → 红;lfNote 判反 → 红
  it('❗台账「导入」开选目标小窗:公司空着、月份 = 页头月;选了公司写有没有台账', async () => {
    const w = await open()
    await rowOf(w, 'ledger').find('.ix-act button').trigger('click')
    await flushPromises()
    expect(w.find('.ix-dlg h3').text()).toBe('导入月度台账：哪家公司、哪个月？')
    const vm = w.vm as unknown as { lf: { companyId: number | null; ym: string } }
    expect(vm.lf).toEqual({ companyId: null, ym: '2026-09' })
    expect(w.find('.ix-dlgn').exists()).toBe(false)
    const next = w.findAll('.ix-dlgf button').find(b => b.text() === '下一步：选文件')!
    expect(next.attributes('disabled')).toBeDefined()
    vm.lf.companyId = 1
    await flushPromises()
    expect(w.find('.ix-dlgn').text(), '台账按列盖,不是整本盖掉').toBe('租赁 9月已有台账，文件里有的列会盖掉旧数。')
    vm.lf.companyId = 3
    await flushPromises()
    expect(w.find('.ix-dlgn').text()).toBe('水电 9月还没有台账。')
    await w.findAll('.ix-dlgf button').find(b => b.text() === '下一步：选文件')!.trigger('click')
    await flushPromises()
    expect(w.find('.ix-dlg').exists()).toBe(false)
    expect(modal(w).exists()).toBe(true)
    expect((w.vm as unknown as { ctx: Record<string, unknown> }).ctx).toMatchObject({ companyId: 3, year: 2026, month: 9 })
  })

  // 破坏验证:onLfKey 不认 Escape → 小窗还在 → 红
  it('❗台账选目标小窗按 Esc 关掉', async () => {
    const w = await open()
    await rowOf(w, 'ledger').find('.ix-act button').trigger('click')
    await flushPromises()
    expect(w.find('.ix-dlg').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('.ix-dlg').exists()).toBe(false)
  })

  // 破坏验证:胶囊 @click 不带 code → 公司空 → 红
  it('❗台账橙胶囊「水电」:同一个小窗,公司、月份预填;灰胶囊点了不开', async () => {
    const w = await open()
    await chipOf(w, 'ledger', '租赁').trigger('click')
    await flushPromises()
    expect(w.find('.ix-dlg').exists()).toBe(false)
    await chipOf(w, 'ledger', '水电').trigger('click')
    await flushPromises()
    expect((w.vm as unknown as { lf: unknown }).lf).toEqual({ companyId: 3, ym: '2026-09' })
    expect(w.find('.ix-dlgn').text()).toBe('水电 9月还没有台账。')
  })

  // 破坏验证:modalBind 不接 openArgs.zone → 补问框区仍是 p1 → 红
  it('❗园区抄表橙胶囊「宿舍」直接开导入弹窗,期区、月份当缺省值;附表10 胶囊带期区号;科目余额表胶囊带页头月', async () => {
    vi.mocked(importLogApi.coverage).mockResolvedValue(covFixture({ s10Miss: '3' }))
    const w = await open()
    await chipOf(w, 'meter', '宿舍').trigger('click')
    await flushPromises()
    expect(modal(w).props('fallbackPicker')).toMatchObject({ ym: '2026-09', zone: 'dorm' })
    expect(modal(w).props('sub')).toBe('各期区水表、电表的本月读数')
    modal(w).vm.$emit('close')
    await flushPromises()

    await chipOf(w, 's10', '三期').trigger('click')
    await flushPromises()
    expect(modal(w).props()).toMatchObject({ defaultYear: 2026, defaultMonth: 9, defaultPhase: 3, segmented: true })
    modal(w).vm.$emit('close')
    await flushPromises()

    await chipOf(w, 'report_tb', '综合').trigger('click')
    await flushPromises()
    expect(w.find('.ix-dlg').exists(), '三大报表不过小窗,公司从文件里认').toBe(false)
    expect((w.vm as unknown as { ctx: Record<string, unknown> }).ctx).toMatchObject({ year: 2026, month: 9 })
    expect((modal(w).props() as unknown as Record<string, unknown>).confirm, 'confirm 这条路删了').toBeUndefined()
  })

  // 破坏验证:modalBind 改回 e.modalProps(ctx) + sub(不经 parserProps)→ 标题 / 单位 / precheck / 规矩 / 小样表那几句红;
  //           runEntry 不认 p.ym → 「按 8 月导」那句红;不给 retarget → 最后三句红
  it('❗台账:弹窗拿到标题、单位「家」、规矩、小样表和绑好公司 / 月的 precheck;选了文件里的月 → 按那个月导、去那个月看;「改」回小窗', async () => {
    const w = await open()
    await chipOf(w, 'ledger', '水电').trigger('click')
    await flushPromises()
    await w.findAll('.ix-dlgf button').find(b => b.text() === '下一步：选文件')!.trigger('click')
    await flushPromises()
    const p = modal(w).props() as unknown as Record<string, unknown>
    const ledger = IMPORT_TYPES.find(t => t.key === 'ledger')!
    expect(p.title).toBe('导入月度台账')
    expect(p.unit).toBe('家')
    expect(p.rules).toEqual(ledger.rules)
    expect(p.sample).toEqual(ledger.sample)
    vi.mocked(ledgerApi.month).mockResolvedValue({ rows: [] } as never)
    const pre = await (p.precheck as (x: unknown, ym?: string) => Promise<Record<string, unknown>>)(
      { records: [{ tenantName: '甲', __ymDetected: { year: 2026, month: 8 } }] })
    expect(pre).toMatchObject({ fileYm: '2026-08', ym: '2026-09', existing: 0 })
    expect(ledgerApi.month).toHaveBeenCalledWith(3, 2026, 9)

    const runner = p.runner as (x: unknown[], f: string, pr?: unknown) => Promise<unknown>
    await runner([{ tenantName: '甲' }], '8月台账.xlsx', { ym: '2026-08', refreshing: () => {} })
    await flushPromises()
    expect(vi.mocked(runImport).mock.calls.at(-1)![2], '核对页选了文件里的 8 月:按 8 月导').toMatchObject({ companyId: 3, year: 2026, month: 8 })
    modal(w).vm.$emit('go')
    await flushPromises()
    expect(push).toHaveBeenLastCalledWith({ path: '/ledger', query: { p: '2026-08', co: '3' } })

    await chipOf(w, 'ledger', '水电').trigger('click')
    await flushPromises()
    await w.findAll('.ix-dlgf button').find(b => b.text() === '下一步：选文件')!.trigger('click')
    await flushPromises()
    ;(modal(w).props('retarget') as () => void)()
    await flushPromises()
    expect(modal(w).exists()).toBe(false)
    expect(w.find('.ix-dlg').exists(), '「改」回到选公司 / 月份的小窗').toBe(true)
    expect((w.vm as unknown as { lf: unknown }).lf).toEqual({ companyId: 3, ym: '2026-09' })
  })

  it('园区抄表:标题「导入园区抄表」、单位「块表」、四条规矩(和抄表页里点导入同一份)', async () => {
    const w = await open()
    await rowOf(w, 'meter').find('.ix-act button').trigger('click')
    await flushPromises()
    expect(modal(w).props()).toMatchObject({ title: '导入园区抄表', unit: '块表' })
    expect(modal(w).props('rules')).toHaveLength(4)
    expect(modal(w).props('retarget'), '只有台账有「改」').toBeUndefined()
    expect(modal(w).props('doneNote'), '结果卡右上只写「用时」(md-v2-done)').toBeUndefined()
  })

  // 破坏验证:deep 不进 ym 初值 → coverage 问的是 2026-09 → 红
  it('深链 ?p=2025-03&co=2:页头是那个月,台账小窗缺省那家', async () => {
    query.p = '2025-03'; query.co = '2'
    const w = await open()
    expect(importLogApi.coverage).toHaveBeenCalledWith('2025-03')
    await rowOf(w, 'ledger').find('.ix-act button').trigger('click')
    await flushPromises()
    expect((w.vm as unknown as { lf: unknown }).lf).toEqual({ companyId: 2, ym: '2025-03' })
  })
})

describe('导入中心 · 导完回来(动效板 ⑤)', () => {
  async function runMeter(w: W) {
    await rowOf(w, 'meter').find('.ix-act button').trigger('click')
    await flushPromises()
    vi.mocked(importLogApi.coverage).mockResolvedValue(covFixture({ meterMiss: '' }))
    vi.mocked(importLogApi.page).mockResolvedValue(PAGE([
      LOG({ id: 201, dataType: 'meter', fileName: '宿舍抄表.xlsx', ok: 3, rows: 3, periodFrom: '2026-09', periodTo: '2026-09', zone: 'dorm' }), ...ROWS,
    ], { all: 68, partial: 31, rejected: 1 }))
    const runner = modal(w).props('runner') as (p: unknown[], f: string, pr?: unknown) => Promise<unknown>
    await runner([{ zone: 'dorm', ym: '2026-09', meterName: '电表①' }], '宿舍抄表.xlsx', undefined)
    await flushPromises()
  }

  // 破坏验证:runEntry 里直接把新数换上(不等关窗)→ 「关窗前还是 5 样」红;
  //           onModalClose 不调 flash → 两处高亮类都没有 → 红;flash 用了旧 key → data-key 那句红
  it('❗关窗那一刻:计数、组头瞬间换,导进去的那一行 + 新记录行挂上 fp-row-flash;胶囊同一个元素从橙变灰', async () => {
    const w = await open()
    const dorm = chipOf(w, 'meter', '宿舍').element
    await runMeter(w)
    expect(w.find('.fac').text(), '弹窗还开着:新数取好放着,不换').toBe('还差 5 样')
    expect(modal(w).props('go')).toBe('去园区抄表看')
    modal(w).vm.$emit('close')
    await flushPromises()
    expect(w.find('.fac').text()).toBe('还差 4 样')
    expect(ghs(w)[0]).toBe('出账 · 每月工序3/3')
    expect(chipOf(w, 'meter', '宿舍').element, '同一个元素(才有 320ms 过渡)').toBe(dorm)
    expect(chipOf(w, 'meter', '宿舍').classes()).not.toContain('miss')
    expect(w.findAll('.ix-row.fp-row-flash').map(r => r.attributes('data-key'))).toEqual(['meter'])
    const trs = w.findAll('.ix-card tbody tr')
    expect(trs[0].classes()).toContain('fp-row-flash')
    expect(trs.filter(t => t.classes().includes('fp-row-flash'))).toHaveLength(1)
    expect(w.find('.fp-pager-total').text()).toBe('共 68 条')
  })

  // 破坏验证:onRowFlashEnd 不认 animationName(任何动画结束都摘)→ 胶囊过渡那句红;flashEnd 不清 → 记录行那句红
  it('❗2 秒动画跑完摘掉高亮(只认 fp-row-flash 那个动画)', async () => {
    const w = await open()
    await runMeter(w)
    modal(w).vm.$emit('close')
    await flushPromises()
    const row = rowOf(w, 'meter')
    row.element.dispatchEvent(Object.assign(new Event('animationend', { bubbles: true }), { animationName: 'fp-pop-in' }))
    await flushPromises()
    expect(rowOf(w, 'meter').classes()).toContain('fp-row-flash')
    row.element.dispatchEvent(Object.assign(new Event('animationend', { bubbles: true }), { animationName: 'fp-row-flash' }))
    const tr = w.find('.ix-card tbody tr.fp-row-flash')
    tr.element.dispatchEvent(Object.assign(new Event('animationend', { bubbles: true }), { animationName: 'fp-row-flash' }))
    await flushPromises()
    expect(w.findAll('.fp-row-flash')).toHaveLength(0)
  })

  // 破坏验证:去掉 onDeactivated 清 → 回来还挂着类 → 红;onReactivated 不重读 → 调用次数那句红
  it('❗KeepAlive 停用时清掉高亮;切回来重读清单和记录', async () => {
    const show = ref(true)
    const Other = defineComponent({ render: () => h('div') })
    const Host = defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => h(show.value ? ImportCenterView : Other) }) })
    const w = mount(Host, { global: { stubs: STUBS } })
    mounted.push(w)
    await flushPromises()
    await runMeter(w as unknown as W)
    modal(w as unknown as W).vm.$emit('close')
    await flushPromises()
    expect(w.findAll('.fp-row-flash').length).toBeGreaterThan(0)
    const nCov = vi.mocked(importLogApi.coverage).mock.calls.length
    const nPage = vi.mocked(importLogApi.page).mock.calls.length
    show.value = false
    await flushPromises()
    show.value = true
    await flushPromises()
    expect(w.findAll('.fp-row-flash')).toHaveLength(0)
    expect(vi.mocked(importLogApi.coverage).mock.calls.length).toBe(nCov + 1)
    expect(vi.mocked(importLogApi.page).mock.calls.length).toBe(nPage + 1)
  })

  // 破坏验证:flash 不看记录画没画出来(改前直接挂)→ null 那句红
  it('❗要亮的记录这次没画出来就不挂(不留到以后不相干的时候亮)', async () => {
    const w = await open()
    await w.findAll('.fp-phasetab')[2].trigger('click')                 // 记录停在「被拒」
    await flushPromises()
    await rowOf(w, 'meter').find('.ix-act button').trigger('click')
    await flushPromises()
    vi.mocked(importLogApi.coverage).mockResolvedValue(covFixture({ meterMiss: '' }))
    vi.mocked(importLogApi.page).mockResolvedValue(PAGE(ROWS.filter(r => r.status === 'rejected')))
    const runner = modal(w).props('runner') as (p: unknown[], f: string, pr?: unknown) => Promise<unknown>
    await runner([{ zone: 'dorm', ym: '2026-09', meterName: '电表①' }], '宿舍抄表.xlsx', undefined)
    modal(w).vm.$emit('close')
    await flushPromises()
    const vm = w.vm as unknown as { flashRow: string | null; flashLogs: number[] | null }
    expect(vm.flashRow, '清单不筛,导进去的那一行照亮').toBe('meter')
    expect(vm.flashLogs, '新记录不在「被拒」这一页').toBeNull()
  })

  // 破坏验证:go 改回 tabs.open(复用活着的页签,?mode= 不再被读)→ 红
  it('❗「去看」开全新实例:附表6 的 ?mode=meter、办公水电的 ?tab= 只在 setup 读一次', async () => {
    const w = await open()
    const spy = vi.spyOn(useTabsStore(), 'openDeep')
    await w.findAll('.ix-card tbody tr')[2].find('.ix-go').trigger('click')
    expect(spy).toHaveBeenCalledWith('pv-income')
    expect(push).toHaveBeenLastCalledWith({ path: '/pv-income', query: { p: '2026-10', mode: 'meter' } })
  })

  // 破坏验证:goView 不 push / 不关弹窗 → 红
  it('「去 X 看」:从这次的落点拼深链,点了关窗去那一屏', async () => {
    const w = await open()
    await runMeter(w)
    modal(w).vm.$emit('go')
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ path: '/meters', query: { p: '2026-09' } })
    expect(modal(w).exists()).toBe(false)
  })

  // 破坏验证:失败后关窗不重读(ran 只在成功时置)→ 调用次数那句红
  it('导入失败:弹窗自己出失败卡,本屏不另出底部回执;关窗后照样重读(断之前写进去的段要看得见)', async () => {
    const w = await open()
    await rowOf(w, 's10').find('.ix-act button').trigger('click')
    await flushPromises()
    vi.mocked(runImport).mockRejectedValueOnce(new Error('第 2 段没导进去'))
    const runner = modal(w).props('runner') as (p: unknown[], f: string, pr?: unknown) => Promise<unknown>
    await expect(runner([{ year: 2026, month: 9, phase: 2, records: [] }], 's10.xlsx', undefined)).rejects.toThrow('第 2 段没导进去')
    expect(receipts).toHaveLength(0)
    const n = vi.mocked(importLogApi.coverage).mock.calls.length
    modal(w).vm.$emit('close')
    await flushPromises()
    expect(vi.mocked(importLogApi.coverage).mock.calls.length).toBe(n + 1)
    expect(w.findAll('.fp-row-flash')).toHaveLength(0)
  })
})

describe('导入中心 · 版式', () => {
  const src = readFileSync(join(__dirname, '../ImportCenterView.vue'), 'utf8').replace(/\r\n/g, '\n')
  // 破坏验证:.ix-tw 的 basis 改回 auto(内容撑高)→ 红 —— 那样每页行数就成了「行数 → 高 → 行数」的回路
  it('❗定高布局链:页根 min-height:100% → 记录卡 flex:1 → 表格区定 basis 不由行撑(至少放下 8 行)', () => {
    expect(src).toMatch(/\.ix \{[^}]*min-height:100%;/)
    expect(src).toMatch(/\.ix-card \{ flex:1 0 auto;/)
    expect(src).toMatch(/\.ix-tw \{ flex:1 0 490px; min-height:490px; overflow:hidden;/)
    expect(src).toContain('useFitRows(recWrap, 56, 8, 8)')
  })
  it('1920 铺满整宽,不封顶居中(ix-v2-wide B49)', () => {
    expect(src).not.toMatch(/\.ix \{[^}]*max-width/)
  })
  it('胶囊变齐 320ms 标准曲线(动效板 ⑤)', () => {
    expect(src).toMatch(/\.ix-chip \{[^}]*transition:background-color var\(--dur-slow\) var\(--ease-standard\)/)
  })
})
