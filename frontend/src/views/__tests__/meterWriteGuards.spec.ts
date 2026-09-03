import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h, ref, KeepAlive } from 'vue'

import MeterView from '@/views/meters/MeterView.vue'
import {
  metersApi,
  type MeterDTO, type MeterReadingDTO, type MeterBindingDTO,
  type MeterDeleteDTO, type MeterImportRow,
} from '@/api/meters'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
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
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/building', () => ({ buildingApi: { list: () => Promise.resolve([]) } }))
// billingPeriod.fetchAll 的另外三个来源(reloadAll 写后重取矩阵会走到)
vi.mock('@/api/alloc', () => ({
  allocApi: { poolMonths: () => Promise.resolve([]), lossMonths: () => Promise.resolve([]) },
}))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: () => Promise.resolve([]) } }))
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
    retiredYm: null, activeFromYm: null, removedYm: null, sortNo: 1, readingCount: 1,
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
  area: 'C座', floorLabel: '三楼', side: '西侧', roomNo: '301室',
}

interface MeterVm {
  editMode: boolean
  importing: boolean
  meterDlg: boolean
  delPreview: MeterDeleteDTO | null
  delTyped: string
  mForm: typeof M_FORM
  loadReadings: () => Promise<void>
  confirmDelete: () => Promise<void>
  onImport: (payload: never, fileName: never) => Promise<void>
  submitMeter: () => Promise<void>
  autoLink: () => Promise<void>
  dirtyIds: number[]
  onCellEdit: (p: { meterId: number; field: 'currTotal'; value: string }) => void
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

    expect(metersApi.batchDelete).toHaveBeenCalledWith(YM, { cascade: true, dropEmptyMeters: true })
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
