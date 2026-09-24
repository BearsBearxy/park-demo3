import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h, ref, KeepAlive } from 'vue'

import MeterView from '@/views/meters/MeterView.vue'
import MeterDetailDrawer from '@/views/meters/MeterDetailDrawer.vue'
import {
  metersApi,
  type MeterDTO, type MeterReadingDTO, type MeterBindingDTO,
  type MeterDeleteDTO, type MeterImportRow,
} from '@/api/meters'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { exportMeterMonth } from '@/utils/meterExcel'
import Select from '@/components/ds/Select.vue'
import api from '@/api'

/**
 * 园区抄表 · 编辑态被就地打假之后,写口必须自守(MeterView.vue 2026-08-29 那一版的 6 处)。
 *
 * 共同的根:`editMode` 会**就地**转假 —— 别人走接管(presence.handleEviction → useEditMode.exit())
 * 或 30 分钟提权到期,组件不卸载、不跳路由。屏幕退回浏览态,而三个弹窗的 v-if 只判自己那个 ref,
 * 里面的按钮照样可点、照样打请求 —— 写的还是一把已经归别人的期锁,后端写口不校验锁,拦不住。
 *
 * 最狠的是「批量删除本期」:确认框连账期都已经打好,一下打出整月读数 + 该月派生快照 +
 * 删完零读数的表档案的**不可逆**删除。
 *
 * 三层各测各的,别混:
 *   ① watch(editMode) 转假 → 三个弹窗一起关(MeterView.vue:162-169)
 *   ② 写函数自己那道 `if (!editMode || !canXxx) return` —— 弹窗关掉只挡住**已知**那条入口,
 *      守在发请求这一层才不漏(autoLink:406 / confirmDelete:458 / onImport:482 / submitMeter:532)
 *   ③ 「完成」按钮不许被 readErr 一起禁掉(MeterView.vue:626 的 `!editMode &&`)
 */

// jsdom 没有 ResizeObserver,而 MeterLedgerGrid 的 onMounted 直接 new 它 ——
// 不补桩的话组件挂载当场抛,w.vm 恒 null,下面每条都死在 `vm.editMode = true`。
class ROStub {
  constructor(_cb: ResizeObserverCallback) { void _cb }
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ROStub

vi.mock('@/api/meters', () => ({
  metersApi: {
    list: vi.fn(), readings: vi.fn(), binding: vi.fn(), months: vi.fn(),
    meterReadings: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
    createReading: vi.fn(), updateReading: vi.fn(), deleteReading: vi.fn(),
    deletePreview: vi.fn(), batchDelete: vi.fn(), autoLinkByName: vi.fn(),
    bind: vi.fn(), importRows: vi.fn(), usageSummary: vi.fn(),
  },
}))
// 导出只桩掉写文件那一下(xlsx 在 jsdom 里写不出来);解析 / 生成 aoa 的纯函数照用原件
vi.mock('@/utils/meterExcel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/meterExcel')>()),
  exportMeterMonth: vi.fn(),
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/building', () => ({ buildingApi: { list: () => Promise.resolve([]) } }))
// billingPeriod.fetchAll 的另外三个来源(reloadAll 写后重取矩阵会走到)
vi.mock('@/api/alloc', () => ({
  allocApi: { poolMonths: () => Promise.resolve([]), lossMonths: () => Promise.resolve([]) },
}))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: () => Promise.resolve([]) } }))
// billingPeriod.fetchAll 的第 5 个来源(R2 T10:整月已审核 → 月格 ✓)。
// 与另外四个一样必须 mock:不 mock 的话走真 axios,而它在 Promise.all 里,
// 整个矩阵要等这一趟在 jsdom 里超时才渲染 —— 表现是「格子一个都找不到」。
vi.mock('@/api/review', () => ({
  reviewApi: {
    closedMonths: vi.fn().mockResolvedValue([]),
    states: vi.fn().mockResolvedValue([]),     // 编辑闸走这条(闸道,按年)
    list: vi.fn().mockResolvedValue([]),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { status: () => Promise.resolve(null) } }))
// FPStepStrip 里点链路条要 router.push;query 可变 —— 期间深链那条要在切回之间换掉 ?p=
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  // fullPath 走 getter:useRoute() 的返回对象只建一次,写成普通字段的话切回时读到的还是旧地址
  useRoute: () => ({ query, get fullPath() { return '/meters?' + new URLSearchParams(query).toString() } }),
}))
// 编辑锁不 mock 的话 locksApi 走真 axios,jsdom 里抛错 → 被「拿不准就不进」兜住 → 编辑态永远进不去。
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

const YM = '2025-03'

/** 一块真实形状的租户电表。字段按 MeterDTO 声明 —— 字面量 + as never 会把漏字段悄悄放过去。 */
const METERS: MeterDTO[] = [
  {
    id: 1, kind: 'elec', zone: 'p1', name: '一车间总电', area: 'A座', spot: '一楼东侧',
    floorLabel: '一楼', side: '东侧', roomNo: '101室',
    tenantName: '力灏电子', tenantId: null, buildingId: 13, ownership: 'tenant',
    meterType: null, deviceType: 'three', subName: '电表①', code: 'E-001', factor: 500,
    sortNo: 1, readingCount: 1,
    status: 'active', statusFrom: '1900-01', statusUntil: null,
    assignFrom: '1900-01', assignUntil: null, assignSrc: 'migrate', changedThisMonth: false,
  },
]

const READINGS: MeterReadingDTO[] = [
  {
    id: 11, meterId: 1, ym: YM,
    prevTotal: 100, currTotal: 180,
    prevSharp: null, prevPeak: null, prevFlat: null, prevValley: null,
    currSharp: null, currPeak: null, currFlat: null, currValley: null,
    factorSnap: 500, usageTotal: 40000,
    usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null,
    note: null, source: 'manual',
  },
]

const BINDING: MeterBindingDTO = {
  summary: { pending: 1 },
  rows: [{ meterId: 1, status: 'pending', bucket: null, contractId: null, contractNo: null, locations: [], hasReading: true }],
}

/** 「批量删除本期」确认框里复述的那套数字 —— 账期已经打好了的那一张。 */
const DEL_PREVIEW: MeterDeleteDTO = {
  ym: YM, readings: 137, meters: 137, metersEmptied: 3, derived: 412,
  manualKept: [], meterDeleted: ['测试表A', '测试表B', '测试表C'], meterBlocked: [],
}
const DEL_DONE: MeterDeleteDTO = { ...DEL_PREVIEW }

/** 整册导入解析出来的行(registry 'meter' 的 run 收的就是这个形状)。 */
const IMPORT_ROWS: MeterImportRow[] = [
  { kind: 'elec', zone: 'p1', name: '一车间总电', ym: YM, prevTotal: 180, currTotal: 260 },
]

/** 新增表弹窗填好的那份表单(submitMeter 自己的早退分支要求 name 非空、factor 可解析)。 */
const M_FORM = {
  kind: 'elec', zone: 'p1', building: '', spot: '三楼西侧', tenantId: null as number | null,
  ownership: 'share', name: '三车间总电', subName: '电表③', code: 'E-003', factor: '200',
  area: 'C座', floorLabel: '三楼', side: '西侧', roomNo: '301室', fromYm: YM,
}

interface MeterVm {
  editMode: boolean
  importing: boolean
  meterDlg: boolean
  delPreview: MeterDeleteDTO | null
  delTyped: string
  okMsg: string
  mForm: typeof M_FORM
  loadReadings: () => Promise<void>
  confirmDelete: () => Promise<void>
  onImport: (payload: never, fileName: never) => Promise<void>
  submitMeter: () => Promise<void>
  autoLink: () => Promise<void>
  dirtyIds: number[]
  onCellEdit: (p: { meterId: number; field: 'currTotal' | 'prevTotal'; value: string }) => void
  // METER-TIMELINE-SPEC(C1)那一组用到的
  meters: MeterDTO[] | null
  status: string
  openMeterDlg: () => void
  onSaveChanges: () => Promise<void>
  onExport: () => Promise<void>
  loadMeters: () => Promise<void>
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['meter-reading:edit', 'meter-master:edit']
  useBillingPeriodStore().pick(2025, 3)          // 期由出账月矩阵选定,这里直接落到 2025-03
  for (const k of Object.keys(query)) delete query[k]
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(metersApi.list).mockResolvedValue(METERS)
  vi.mocked(metersApi.readings).mockResolvedValue(READINGS)
  vi.mocked(metersApi.binding).mockResolvedValue(BINDING)
  vi.mocked(metersApi.months).mockResolvedValue([YM])
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

async function open() {
  const w = mount(MeterView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
const vmOf = (w: { vm: unknown }) => w.vm as MeterVm

/** 三个弹窗一起摆开(编辑态里的真实状态)。 */
async function openAllDialogs(vm: MeterVm) {
  vm.editMode = true
  await flushPromises()
  vm.importing = true
  vm.meterDlg = true
  vm.delPreview = { ...DEL_PREVIEW }
  vm.delTyped = YM
  await flushPromises()
}

describe('园区抄表 · 编辑态被接管走之后写口自守', () => {
  it('❗编辑态就地转假 → 导入/新增表/批量删除三个弹窗一起关', async () => {
    // 钉 MeterView.vue:162-169 那个 watch(editMode)。改前它只有
    // `if (!v) { draft.clear(); saveConfirm.value = false }` —— 删掉 importing/meterDlg/delPreview
    // 那三行里的任意一行,这条就红。
    const w = await open()
    const vm = vmOf(w)
    await openAllDialogs(vm)

    expect(w.findAll('.mt-dlg h3').map(h => h.text()), '前提:两个自绘弹窗确实开着')
      .toEqual(['新增表', `批量删除本期 · ${YM}`])
    expect(w.find('.fpimp-scrim').exists(), '前提:导入弹窗确实开着').toBe(true)

    vm.editMode = false            // ← 接管 / 提权到期走的正是这一句(不卸载、不跳路由)
    await flushPromises()

    expect(w.findAll('.mt-dlg h3').map(h => h.text()),
      '新增表 / 批量删除本期 的确认框还挂在浏览态上 —— 按钮照样可点').toEqual([])
    expect(w.find('.fpimp-scrim').exists(), '导入弹窗还挂在浏览态上').toBe(false)
  })

  it('❗浏览态下逐个直呼四个写函数 —— 一个 API 都不许打出去', async () => {
    // 钉四道 `if (!editMode.value || !canXxx.value) return`:
    //   autoLink:406 / confirmDelete:458 / onImport:482 / submitMeter:532
    // 删掉其中任意一行,对应那条 expect 立刻红。
    //
    // ⚠ 前置状态必须做足,否则这些函数在**自己原有的**早退分支就 return 了,守卫删掉照样绿:
    //   · confirmDelete 要 delPreview 真有值、delTyped 真等于 p.ym、delBusy 为假
    //   · submitMeter 要 mForm.name 非空且 factor 可解析成正数
    //   · onImport 的 payload 要有行(registry 的 run 里 `if (!rows.length) return`)
    //   · autoLink 要 linking 为假、confirm() 返回 true
    //   下面那条「编辑态里同样的状态照打」的孪生用例就是这几个前置的自检。
    const w = await open()
    const vm = vmOf(w)
    // 浏览态(从没进过编辑态),但状态摆得跟接管前一模一样
    vm.delPreview = { ...DEL_PREVIEW }
    vm.delTyped = YM
    vm.mForm = { ...M_FORM }
    await flushPromises()

    // ⚠ 导入走的是 importRegistry 里的 `http.post('/meters/import')`,**不经 metersApi**
    //   (registry:637)。只断言 metersApi.* 的话 onImport 那道守卫删掉照样绿。
    const post = vi.spyOn(api, 'post').mockResolvedValue({ imported: 1, skipped: 0, errors: [] } as never)

    await vm.confirmDelete()
    await vm.onImport(IMPORT_ROWS as never, 'meters-2025-03.xlsx' as never)
    await vm.submitMeter()
    await vm.autoLink()
    await flushPromises()

    expect(metersApi.batchDelete, '浏览态下整月不可逆删除被打出去了').not.toHaveBeenCalled()
    expect(metersApi.create, '浏览态下新增表被打出去了').not.toHaveBeenCalled()
    expect(metersApi.autoLinkByName, '浏览态下一键挂被打出去了').not.toHaveBeenCalled()
    expect(post.mock.calls.map(c => c[0]), '浏览态下整册导入被打出去了').not.toContain('/meters/import')
  })

  it('编辑态里同样的状态照打得出去 —— 上一条不是被早退分支放绿的', async () => {
    // 这条不钉守卫,钉的是上一条的**前置状态够不够**:任何一个前置摆漏了,这里立刻红。
    const w = await open()
    const vm = vmOf(w)
    vi.mocked(metersApi.batchDelete).mockResolvedValue(DEL_DONE)
    vi.mocked(metersApi.create).mockResolvedValue(METERS[0])
    vi.mocked(metersApi.autoLinkByName).mockResolvedValue({ linked: 2, skipped: 0 })
    const post = vi.spyOn(api, 'post').mockResolvedValue({ imported: 1, skipped: 0, errors: [] } as never)

    vm.editMode = true
    await flushPromises()
    vm.delPreview = { ...DEL_PREVIEW }
    vm.delTyped = YM
    vm.mForm = { ...M_FORM }
    await flushPromises()

    await vm.confirmDelete()
    await vm.onImport(IMPORT_ROWS as never, 'meters-2025-03.xlsx' as never)
    await vm.submitMeter()
    await vm.autoLink()
    await flushPromises()

    expect(metersApi.batchDelete).toHaveBeenCalledWith(YM, { cascade: true, dropEmptyMeters: true, dropDraftNotices: false })
    expect(metersApi.create).toHaveBeenCalled()
    expect(metersApi.autoLinkByName).toHaveBeenCalled()
    expect(post.mock.calls.map(c => c[0])).toContain('/meters/import')
  })

  // 四道守卫里 `|| !canReading` / `|| !canMaster` 那一半这里**测不了**,故意不写:
  // useEditMode 的铁律 ①(watch([editMode, missing]) → exit())让「在编辑态里权限却不齐」
  // 这个状态一拍都活不下来 —— 只发一把权限进去,editMode 当场被打回 false。
  // 那一半是纵深,不是这一屏够得着的路径;硬造出来的用例钉的只会是测试自己。

  it('❗编辑态里取数挂了,「完成」仍点得动 —— 退得出去,锁才交得回去', async () => {
    // 钉 MeterView.vue:626 `:disabled="saving || (!editMode && !!readErr)"` 里的 `!editMode &&`。
    // FPEditModeButton 的 :disabled 不分 edit 态:去掉这一句,正在编辑时取数挂一次,
    // 唯一的出口「完成」当场变灰 —— 人退不出编辑态,期锁也还不回去,只能刷新整个页面。
    const w = await open()
    const vm = vmOf(w)
    vm.editMode = true
    await flushPromises()

    vi.mocked(metersApi.readings).mockRejectedValue(new Error('后端挂了'))
    await vm.loadReadings()
    await flushPromises()
    expect(w.find('.fp-lderr').exists(), '前提:失败条已经上屏').toBe(true)

    const done = w.find('button.fp-emb')
    expect(done.text(), '前提:按钮此刻是编辑态的那颗「完成」').toContain('完成')
    expect(done.attributes('disabled'), '编辑态的「完成」被 readErr 一起禁掉了 —— 退不出去').toBeUndefined()

    await done.trigger('click')
    await flushPromises()
    expect(vm.editMode, '点了「完成」还留在编辑态').toBe(false)

    // 另一半照旧:浏览态 + 取数失败 = 不许进编辑态(在伪造的空读数列上录入 = 覆盖旧月或凭空补条)
    expect(w.find('button.fp-emb').attributes('disabled'),
      '`!!readErr` 那一半丢了 —— 失败态下又能进编辑模式了').toBeDefined()
  })
})

describe('园区抄表 · 深链遇上草稿', () => {
  it('❗带草稿时切回、地址栏换了月 → 期不动,草稿还在,deepNote 说清楚(dirty 闸在屏上真接住了)', async () => {
    // 钉 MeterView.vue 的 `useChainDeepPeriod(() => dirtyIds.value.length)`:
    // 把 dirty 探针改成 `() => 0`,期当场被切到 2025-04、watch(ym) 顺手 draft.clear() —— 一屏未保存的读数没了。
    // 本屏是链上唯一有草稿的屏,这道闸只在这里有靶子。
    query.p = '2025-03'
    const alive = ref(true)
    const w = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(MeterView) : null) }),
    }), { global: { stubs: { Teleport: true } } })
    await flushPromises()
    const vm = w.findComponent(MeterView).vm as unknown as MeterVm

    vm.editMode = true
    await flushPromises()
    vm.onCellEdit({ meterId: 1, field: 'currTotal', value: '260' })   // 服务器值 180 → 真脏
    await flushPromises()
    expect(vm.dirtyIds.length, '前提:草稿真的算脏了').toBeGreaterThan(0)

    alive.value = false                       // 切去别的页签(KeepAlive 停用,不卸载)
    await flushPromises()
    query.p = '2025-04'                       // 侧栏/深链在别处把地址栏换成了下个月
    alive.value = true
    await flushPromises()

    expect(useBillingPeriodStore().ym, '有草稿 → 不切期').toBe('2025-03')
    expect(vm.dirtyIds.length, '草稿没被 watch(ym) 清掉').toBeGreaterThan(0)
    expect(w.find('.fpt--warning').text()).toContain('地址栏要求 2025-04 期，本期有')
    w.unmount()
  })
})

// 没选期时主区是选期矩阵,ym 是 ''。首载 / 换月早就判了 period.picked,漏的是「切回页签」那条刷新 ——
// 拿 '' 去打接口,后端按月份格式校验直接 400(2026-09-19 开发日志里 14 次),.catch 吞掉,屏上看不出来。
describe('园区抄表 · 没选期时切回页签', () => {
  it('❗切走再切回:不拿空月份去拉绑定', async () => {
    useBillingPeriodStore().clear()
    vi.mocked(metersApi.binding).mockClear()
    const alive = ref(true)
    const w = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(MeterView) : null) }),
    }), { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(w.find('.cmg').exists(), '前提:没选期,主区是选期矩阵').toBe(true)
    alive.value = false                       // 切去别的页签(KeepAlive 停用,不卸载)
    await flushPromises()
    alive.value = true                        // 切回来 → onReactivated
    await flushPromises()
    expect(metersApi.binding).not.toHaveBeenCalledWith('')
    w.unmount()
  })
})

// ─────────────────────────────────────────────────────────────
// METER-TIMELINE-SPEC(C1):抄表屏按月取档案、按状态段说话、新表自 M 起在册、缺底数、导入结果列档案变化
// ─────────────────────────────────────────────────────────────

/** 同一块表站在别的月份的样子(档案按月:4 月起换了户)。 */
const APR: MeterDTO[] = [{ ...METERS[0], tenantName: '锂朋科技', assignFrom: '2025-04', changedThisMonth: true }]
/** 一块本月还不在册的表(第一条状态晚于本月)+ 一块在册、本月没读数也没底数的新表。 */
const NOT_YET: MeterDTO = { ...METERS[0], id: 2, name: '四车间新电', status: null, statusFrom: null, readingCount: 0 }
const FRESH: MeterDTO = { ...METERS[0], id: 3, name: '五车间新电', tenantName: '五车间', tenantId: 5, statusFrom: YM, readingCount: 0 }

/** 一个手动结算的 promise:切月途中「上个月那一趟还没回来」要靠它摆出来。 */
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('园区抄表 · 档案按月(METER-TIMELINE-SPEC §2 / §6)', () => {
  it('❗站在本月拉档案;切月重拉,带上新月份', async () => {
    await open()
    expect(metersApi.list).toHaveBeenLastCalledWith(undefined, undefined, YM)
    useBillingPeriodStore().pick(2025, 4)
    await flushPromises()
    expect(metersApi.list).toHaveBeenLastCalledWith(undefined, undefined, '2025-04')
  })

  it('❗连切两个月,慢的那一趟后到也不许盖掉新月的档案', async () => {
    const w = await open()
    const apr = deferred<MeterDTO[]>()
    vi.mocked(metersApi.list).mockImplementation((_k, _z, ym) =>
      (ym === '2025-04' ? apr.promise : Promise.resolve(METERS)))
    useBillingPeriodStore().pick(2025, 4)
    await flushPromises()
    useBillingPeriodStore().pick(2025, 5)
    await flushPromises()
    apr.resolve(APR)                 // 4 月那趟最后才回来
    await flushPromises()
    expect(vmOf(w).meters![0].tenantName, '4 月的档案盖掉了 5 月的').toBe('力灏电子')
  })

  it('❗切了月又没拉到档案:不拿上个月的档案冒充本月,整页给失败态', async () => {
    const w = await open()
    vi.mocked(metersApi.list).mockRejectedValue(new Error('后端挂了'))
    useBillingPeriodStore().pick(2025, 4)
    await flushPromises()
    expect(vmOf(w).meters, '3 月的档案还挂在 4 月上').toBeNull()
    expect(w.find('.mt-gate-fail').exists()).toBe(true)
  })

  it('❗导出:本月档案还没到手不导(不导半新半旧的册子);到手后照导本月', async () => {
    const w = await open()
    const apr = deferred<MeterDTO[]>()
    vi.mocked(metersApi.list).mockImplementation(() => apr.promise)
    useBillingPeriodStore().pick(2025, 4)
    await flushPromises()
    await vmOf(w).onExport()
    expect(exportMeterMonth, '4 月的读数配 3 月的档案导出去了').not.toHaveBeenCalled()
    expect(window.alert).toHaveBeenCalled()
    apr.resolve(APR)
    await flushPromises()
    await vmOf(w).onExport()
    expect(exportMeterMonth).toHaveBeenCalledWith('2025-04', APR, READINGS, expect.anything())
  })

  it('❗状态下拉有「本月有变化」「期区对不上」「缺底数」,不在册两项改叫「已拆」「未在册」', async () => {
    const w = await open()
    const labels = w.findAllComponents(Select)
      .map(s => (s.props('options') as { value: string; label: string }[]))
      .find(o => o.some(x => x.value === 'changed'))!.map(x => x.label)
    expect(labels).toEqual(expect.arrayContaining(['本月有变化', '期区对不上', '缺底数', '已拆', '未在册']))
    expect(labels).not.toContain('已退场')
  })

  it('❗已拆 / 未在册的说明条按状态段说话,不再教人清空账期', async () => {
    const w = await open()
    for (const s of ['removed', 'notYet']) {
      vmOf(w).status = s
      await flushPromises()
      const t = w.find('.mt-hidbar').text()
      expect(t).toContain('在册状态')
      expect(t).not.toContain('账期')
    }
  })
})

describe('园区抄表 · 新增表自 M 起在册(SPEC §3.4)', () => {
  it('❗弹窗默认自本月起在册,提交带上这个月', async () => {
    const w = await open()
    const vm = vmOf(w)
    vi.mocked(metersApi.create).mockResolvedValue(METERS[0])
    vm.editMode = true
    await flushPromises()
    vm.openMeterDlg()
    await flushPromises()
    expect(vm.mForm.fromYm).toBe(YM)
    expect(w.find('.mt-dlg').text()).toContain('自这个月起在册')
    vm.mForm = { ...vm.mForm, name: '六车间新电', fromYm: '2025-05' }
    await vm.submitMeter()
    expect(metersApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: '六车间新电', fromYm: '2025-05' }))
  })
})

describe('园区抄表 · 缺底数与自愈(SPEC §3.4)', () => {
  beforeEach(() => {
    vi.mocked(metersApi.list).mockResolvedValue([...METERS, NOT_YET, FRESH])
    vi.mocked(metersApi.createReading).mockResolvedValue(READINGS[0])
  })

  it('❗没有底数的行在编辑态开放「上月行至」;有底数的行不开', async () => {
    const w = await open()
    vmOf(w).editMode = true
    await flushPromises()
    const base = w.findAll('input[data-pi="0"]')
    expect(base, '只有 3 号新表没有底数').toHaveLength(1)
    await base[0].setValue('90')
    vmOf(w).onCellEdit({ meterId: 3, field: 'currTotal', value: '120' })
    await vmOf(w).onSaveChanges()
    await flushPromises()
    expect(metersApi.createReading).toHaveBeenCalledWith(expect.objectContaining({ meterId: 3, prevTotal: 90, currTotal: 120 }))
  })

  it('❗只录本月、不录底数 → 行状态「缺底数」', async () => {
    vi.mocked(metersApi.readings).mockResolvedValue([...READINGS,
      { ...READINGS[0], id: 13, meterId: 3, prevTotal: null, currTotal: 120, usageTotal: null }])
    const w = await open()
    expect(w.findAll('.mlg-st').map(b => b.text())).toContain('缺底数')
  })

  it('❗未在册的表录了本月读数:保存前点名「将从本月起在册」,取消就一条不存', async () => {
    const w = await open()
    const vm = vmOf(w)
    vm.editMode = true
    await flushPromises()
    vm.onCellEdit({ meterId: 2, field: 'currTotal', value: '50' })
    vi.mocked(window.confirm).mockReturnValue(false)
    await vm.onSaveChanges()
    await flushPromises()
    expect(vi.mocked(window.confirm).mock.calls.at(-1)?.[0]).toContain(`将从 ${YM} 起在册`)
    expect(metersApi.createReading, '取消了还存').not.toHaveBeenCalled()
    expect(vm.dirtyIds, '取消后草稿还在').toEqual([2])

    vi.mocked(window.confirm).mockReturnValue(true)
    await vm.onSaveChanges()
    await flushPromises()
    expect(metersApi.createReading).toHaveBeenCalledWith(expect.objectContaining({ meterId: 2, currTotal: 50 }))
  })

  it('❗浏览态直呼保存:一条读数都不许写(写口自守)', async () => {
    const w = await open()
    const vm = vmOf(w)
    vm.onCellEdit({ meterId: 1, field: 'currTotal', value: '260' })
    await vm.onSaveChanges()
    await flushPromises()
    expect(metersApi.updateReading).not.toHaveBeenCalled()
    expect(metersApi.createReading).not.toHaveBeenCalled()
  })
})

describe('园区抄表 · 导入结果与批删预览报档案改动(SPEC §3.2 / §3.5)', () => {
  it('❗导入结果逐条列「表 · 字段 · 旧 → 新 · 影响哪几个月」', async () => {
    const w = await open()
    const vm = vmOf(w)
    vi.spyOn(api, 'post').mockResolvedValue({
      imported: 1, skipped: 0, errors: [], batchId: 'b-1',
      changes: [
        { meterId: 1, label: '一车间总电', field: 'tenant', before: '力灏电子', after: '锂朋科技', from: YM, until: null },
        { meterId: 1, label: '一车间总电', field: 'status', before: null, after: 'retired', from: YM, until: '2025-05' },
      ],
    } as never)
    vm.editMode = true
    await flushPromises()
    await vm.onImport(IMPORT_ROWS as never, 'meters-2025-03.xlsx' as never)
    await flushPromises()
    const box = w.find('.ir-chg')
    expect(box.text()).toContain('2 处表档案改动')
    await box.find('.ir-errs-toggle').trigger('click')
    const lines = box.findAll('li').map(li => li.text())
    expect(lines[0]).toContain(`企业名称 力灏电子 → 锂朋科技 · 影响 ${YM} 起`)
    expect(lines[1]).toContain(`状态 不在册 → 停用 · 影响 ${YM} ~ 2025-05`)
  })

  it('❗批量删除本期的预览报出连带删掉的档案记录条数', async () => {
    const w = await open()
    const vm = vmOf(w)
    vm.editMode = true
    await flushPromises()
    vm.delPreview = { ...DEL_PREVIEW, assignRows: 4, statusRows: 1 }
    await flushPromises()
    const t = w.find('.mt5-del-list').text()
    expect(t).toContain('本期导入写下的表档案记录')
    expect(t).toContain('归属 4 · 状态 1')
    expect(t, '没有册子记录要删时不该多出这一条').not.toContain('册子记录')
  })

  it('❗批量删除本期:预览和删完的提示都报出连带删掉的本月册子记录(SPEC §10.2)', async () => {
    const w = await open()
    const vm = vmOf(w)
    vi.mocked(metersApi.batchDelete).mockResolvedValue({ ...DEL_DONE, bookRows: 9 })
    vm.editMode = true
    await flushPromises()
    vm.delPreview = { ...DEL_PREVIEW, bookRows: 9 }
    vm.delTyped = YM
    await flushPromises()
    expect(w.find('.mt5-del-list').text()).toContain('连带删除本月册子记录 9 条,删后这个月算作没导入过册子')
    await vm.confirmDelete()
    await flushPromises()
    expect(vm.okMsg).toContain('、9 条本月册子记录。')
  })

  // ── 该月的催缴单(用户 2026-09-24「想批量删除,结果也是删不了」):三种形状各一条 ──
  const confirmBtn = (w: Awaited<ReturnType<typeof open>>) =>
    w.findAll('.mt-dlg-f button').find(b => b.text().includes('确认删除'))!

  it('❗批量删除本期 · 该月没有催缴单:不出第三个勾选项,确认键照常放行', async () => {
    const w = await open()
    const vm = vmOf(w)
    vm.editMode = true
    await flushPromises()
    vm.delPreview = { ...DEL_PREVIEW, draftNotices: 0, voidNotices: 0, lockedNotices: 0, lockedTenants: [] }
    vm.delTyped = YM
    await flushPromises()
    expect(w.findAll('.mt5-del-ck')).toHaveLength(2)
    expect(w.find('.mt-dlg').text()).not.toContain('草稿催缴单')
    expect(w.find('.mt-dlg').text()).not.toContain('已确认/已导出')
    expect(confirmBtn(w).attributes('disabled')).toBeUndefined()
  })

  it('❗批量删除本期 · 只有草稿/已作废的单:出勾选项报张数,勾上才带 dropDraftNotices,删完报删了几张单', async () => {
    useAuthStore().permissions = ['meter-reading:edit', 'meter-master:edit', 'billing-run:edit']
    const w = await open()
    const vm = vmOf(w)
    const notices = { draftNotices: 245, voidNotices: 3, lockedNotices: 0, lockedTenants: [] }
    vi.mocked(metersApi.batchDelete).mockResolvedValue({ ...DEL_DONE, ...notices })
    vm.editMode = true
    await flushPromises()
    vm.delPreview = { ...DEL_PREVIEW, ...notices }
    vm.delTyped = YM
    await flushPromises()
    const cks = w.findAll('.mt5-del-ck')
    expect(cks).toHaveLength(3)
    expect(cks[2].text()).toContain('同时删除该月的草稿催缴单(248 张,含已作废 3 张)')
    expect(cks[2].text()).toContain('删的是这个月全部的草稿,删后可在催缴单屏重新生成')
    expect((cks[2].find('input').element as HTMLInputElement).checked, '默认不勾').toBe(false)
    expect(confirmBtn(w).attributes('disabled'), '只有草稿单不禁确认键').toBeUndefined()
    await cks[2].find('input').setValue(true)
    await vm.confirmDelete()
    await flushPromises()
    expect(metersApi.batchDelete).toHaveBeenCalledWith(YM, { cascade: true, dropEmptyMeters: true, dropDraftNotices: true })
    expect(vm.okMsg).toContain('、248 张草稿催缴单')
  })

  it('❗批量删除本期 · 有已确认/已导出的单:列户名(最多 5 户,余者等 N 户),确认键禁用', async () => {
    useAuthStore().permissions = ['meter-reading:edit', 'meter-master:edit', 'billing-run:edit']
    const w = await open()
    const vm = vmOf(w)
    vm.editMode = true
    await flushPromises()
    vm.delPreview = {
      ...DEL_PREVIEW, draftNotices: 2, voidNotices: 0, lockedNotices: 7,
      lockedTenants: ['力灏电子', '锂朋科技', '南盛物流', '次生代', '翔海', '汇川'],
    }
    vm.delTyped = YM
    await flushPromises()
    const t = w.find('.mt5-del-list').text()
    expect(t).toContain('该月有 7 张已确认/已导出的催缴单(力灏电子、锂朋科技、南盛物流、次生代、翔海 等 6 户)')
    expect(t).toContain('先在催缴单屏作废这些单')
    expect(confirmBtn(w).attributes('disabled'), '有锁定单还能点确认').toBeDefined()
    // 同一份数字只去掉锁定单 → 放行:上面那一下是锁定单禁的,不是别的条件
    vm.delPreview = { ...vm.delPreview!, lockedNotices: 0, lockedTenants: [] }
    await flushPromises()
    expect(confirmBtn(w).attributes('disabled')).toBeUndefined()
  })

  // 对抗复查 R-F5:连带删草稿单后端另要 billing-run:edit(提权 / 自定义角色只拿得到抄表两项)
  it('❗批量删除本期 · 有草稿单但没有出账权限:不给勾,写明要出账权限,确认键禁用', async () => {
    const w = await open()
    const vm = vmOf(w)
    vm.editMode = true
    await flushPromises()
    vm.delPreview = { ...DEL_PREVIEW, draftNotices: 4, voidNotices: 0, lockedNotices: 0, lockedTenants: [] }
    vm.delTyped = YM
    await flushPromises()
    expect(w.findAll('.mt5-del-ck'), '没有出账权限还出了勾选项').toHaveLength(2)
    expect(w.find('.mt5-del-nobill').text()).toBe('该月有 4 张草稿催缴单,连带删除要出账权限;请有出账权限的人来删,或先到催缴单屏处理')
    expect(confirmBtn(w).attributes('disabled'), '勾不了还能点确认,点了只会 409').toBeDefined()
    // 同一份预览只补上出账权限 → 勾选项回来、确认键放行:上面那几下是权限禁的
    useAuthStore().permissions = ['meter-reading:edit', 'meter-master:edit', 'billing-run:edit']
    await flushPromises()
    expect(w.findAll('.mt5-del-ck')).toHaveLength(3)
    expect(w.find('.mt5-del-nobill').exists()).toBe(false)
    expect(confirmBtn(w).attributes('disabled')).toBeUndefined()
  })

  // 对抗复查 R-F4:弹窗开着时别人生成了这个月 → 执行 409 让人勾,弹窗得跟着重拉,不然没有框可勾
  it('❗批量删除本期 · 执行被 409 退回:重拉预览,新出现的草稿单勾选项跟上', async () => {
    useAuthStore().permissions = ['meter-reading:edit', 'meter-master:edit', 'billing-run:edit']
    const w = await open()
    const vm = vmOf(w)
    vm.editMode = true
    await flushPromises()
    vm.delPreview = { ...DEL_PREVIEW, draftNotices: 0, voidNotices: 0, lockedNotices: 0, lockedTenants: [] }
    vm.delTyped = YM
    await flushPromises()
    expect(w.findAll('.mt5-del-ck')).toHaveLength(2)
    vi.mocked(metersApi.batchDelete).mockRejectedValueOnce({ message: '该月有 245 张草稿催缴单,读数删了单还在。' })
    vi.mocked(metersApi.deletePreview).mockResolvedValueOnce(
      { ...DEL_PREVIEW, draftNotices: 245, voidNotices: 0, lockedNotices: 0, lockedTenants: [] })
    await vm.confirmDelete()
    await flushPromises()
    expect(metersApi.deletePreview).toHaveBeenCalledWith(YM, { cascade: true, dropEmptyMeters: true, dropDraftNotices: false })
    const cks = w.findAll('.mt5-del-ck')
    expect(cks, '409 之后弹窗还是旧预览,没有框可勾').toHaveLength(3)
    expect(cks[2].text()).toContain('同时删除该月的草稿催缴单(245 张)')
  })

  // 对抗复查:不勾「删派生快照」时后端回 derived=0,旧句「该月已生成的派生快照 0 条」把「不删」说成「没有」
  it('❗批量删除本期 · 派生快照那一行说「将删除 N 条」,不说「已生成 N 条」', async () => {
    const w = await open()
    const vm = vmOf(w)
    vm.editMode = true
    await flushPromises()
    vm.delPreview = { ...DEL_PREVIEW, derived: 0 }
    await flushPromises()
    const t = w.find('.mt5-del-list').text()
    expect(t).toContain('将删除该月派生快照 0 条')
    expect(t).not.toContain('已生成')
  })
})

// ─────────────────────────────────────────────────────────────
// E 修补:档案重拉失败时抽屉也锁、切回页签重拉档案、已有读数的未在册表不承诺在册
// ─────────────────────────────────────────────────────────────

describe('园区抄表 · 档案失败态与切回(E 修补)', () => {
  it('❗表档案重拉失败:编辑态里抽屉也退回只读(失败条写着编辑已锁,抽屉不能拿旧档案写)', async () => {
    const w = await open()
    const vm = vmOf(w)
    vm.editMode = true
    await flushPromises()
    expect(w.findComponent(MeterDetailDrawer).props('editMode'), '前提:编辑态里抽屉可写').toBe(true)
    vi.mocked(metersApi.list).mockRejectedValue(new Error('后端挂了'))
    await vm.loadMeters()
    await flushPromises()
    expect(vm.editMode, '编辑态本身没退').toBe(true)
    expect(w.findComponent(MeterDetailDrawer).props('editMode')).toBe(false)
  })

  it('❗切走再切回:表档案重拉(合同终止会写解约次月起的空置行)', async () => {
    const alive = ref(true)
    const w = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(MeterView) : null) }),
    }), { global: { stubs: { Teleport: true } } })
    await flushPromises()
    const n = vi.mocked(metersApi.list).mock.calls.length
    alive.value = false
    await flushPromises()
    alive.value = true
    await flushPromises()
    expect(vi.mocked(metersApi.list).mock.calls.length).toBe(n + 1)
    expect(metersApi.list).toHaveBeenLastCalledWith(undefined, undefined, YM)
    w.unmount()
  })

  it('❗未在册但本月已有读数的表:改读数不弹「将从本月起在册」(后端改读数不补在册),说明条也不这么承诺', async () => {
    vi.mocked(metersApi.list).mockResolvedValue([...METERS, NOT_YET])
    vi.mocked(metersApi.readings).mockResolvedValue([...READINGS, { ...READINGS[0], id: 14, meterId: 2, currTotal: 30 }])
    vi.mocked(metersApi.updateReading).mockResolvedValue(READINGS[0])
    const w = await open()
    const vm = vmOf(w)
    vm.status = 'notYet'
    await flushPromises()
    expect(w.find('.mt-hidbar').text()).toContain('已有本月读数的,改读数不会让它在册')
    vm.editMode = true
    await flushPromises()
    vm.onCellEdit({ meterId: 2, field: 'currTotal', value: '50' })
    await vm.onSaveChanges()
    await flushPromises()
    expect(vi.mocked(window.confirm).mock.calls.some(c => String(c[0]).includes('起在册'))).toBe(false)
    expect(metersApi.updateReading).toHaveBeenCalledWith(14, expect.objectContaining({ meterId: 2, currTotal: 50 }))
  })
})
