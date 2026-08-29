// 催缴单屏(views/bills/BillNoticesView.vue)的写守卫挂载证明 —— 钉三处:
//   ① watch(editMode)(:288)转假时 `noteEditKey.value = null` —— 已展开的备注编辑行必须随编辑态收起。
//      备注编辑行那个 `v-if="noteEditKey === noteKeyId(...)"` **不看 canRun**(:848 / :947 / :985),
//      所以编辑态就地转假(被接管 / 提权到期)时若没人把 key 清掉,输入框与 ✓ 会原地留在浏览态的抽屉里。
//   ② saveNoteEdit(:498)开头 `if (!canRun.value) return` —— 本文件曾经唯一漏判的写函数
//      (兄弟 startNoteEdit :492 / restoreNote :515 都判了)。①收起的是入口,②堵的是函数本身。
//   ③ canRun / canIssue(:79-80)把 editMode 编进权限计算式 —— 权限齐但在浏览态时,
//      页头「重新生成」与工具条「批量确认」都不该存在。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import {
  billNoticesApi,
  type BillNoticeDTO, type BillNoticeDetailDTO, type BillNoticeLineDTO,
} from '@/api/billNotices'
import { paramsApi, type ParamStatusDTO } from '@/api/params'
import { contractApi } from '@/api/contract'
import { buildingApi } from '@/api/building'
import { companyBookApi, type CompanyFullDTO } from '@/api/billDelivery'
import { billsApi } from '@/api/bills'
import { lineNoteKey, type NoteKey } from '@/utils/billNoticeLogic'
import BillNoticesView from '@/views/bills/BillNoticesView.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))

// 本屏 API 面大,按它**实际 import 的那几个**逐个挡住(漏一个就是一发真 axios,
// jsdom 里只会变成一条被 .catch 吞掉的失败,看起来像"数据就是空的")。
vi.mock('@/api/billNotices', () => ({
  billNoticesApi: {
    list: vi.fn(), months: vi.fn(), detail: vi.fn(),
    notes: vi.fn(), saveNote: vi.fn(), deleteNote: vi.fn(),
    generate: vi.fn(), issue: vi.fn(), void: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { status: vi.fn(), list: vi.fn(), put: vi.fn() } }))
vi.mock('@/api/contract', () => ({ contractApi: { list: vi.fn() } }))
vi.mock('@/api/building', () => ({ buildingApi: { list: vi.fn() } }))
vi.mock('@/api/bills', () => ({ billsApi: { paymap: vi.fn(), setPaymap: vi.fn() } }))
// 收款公司模块还导出 ACCOUNT_KINDS / ACCOUNT_KIND_LABEL(CompanyBookWindow 常挂着要用),
// 只换两个 api 对象,其余原样透传。
vi.mock('@/api/billDelivery', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/billDelivery')>(),
  companyBookApi: { list: vi.fn() },
  billDeliveryApi: { confirm: vi.fn(), markExported: vi.fn() },
}))
// 本屏进编辑态要先占到 billing-chain 那把月锁(CONCURRENCY-SPEC §3.2)。
// 不 mock 的话 locksApi 走真 axios,jsdom 里抛错 → 被「拿不准就不进」兜住 → 编辑态永远进不去。
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

// ── 夹具:按真实 DTO 声明(字面量 + as never 会把漏字段悄悄放过去) ──
const RENT_LINE: BillNoticeLineDTO = {
  lineNo: 1, feeKey: 'rent_factory', premise: '一期 A座602室',
  meterId: null, meterLabel: null, contractId: 77, seg: null,
  prevRead: null, currRead: null, factorSnap: null,
  qty: 1528, priceSnap: 8.08, priceKey: null, priceScope: null, priceMonth: null,
  ruleBranch: null, poolRuleId: null, poolName: null, shareSrc: null, baseSnap: 1986,
  amount: 12345.6, note: '按天折算 1130÷31×26', feeGroup: 'rent',
}
const NOTICES: BillNoticeDTO[] = [{
  id: 91, ym: '2026-08', tenantId: 5, tenantName: '力灏',
  payCompanyId: 3, payCompanyName: '甲公司', noticeKind: 'combined',
  premiseText: '一期 A座602室', totalAmount: 12345.6, prevDue: 0,
  status: 'draft', warn: null, lineCount: 1,
}]
const DETAIL: BillNoticeDetailDTO = {
  id: 91, ym: '2026-08', tenantId: 5, tenantName: '力灏',
  payCompanyId: 3, payCompanyName: '甲公司', noticeKind: 'combined',
  premiseText: '一期 A座602室', totalAmount: 12345.6, prevDue: 0,
  status: 'draft', warn: null, lines: [RENT_LINE],
}
const STATUS: ParamStatusDTO = {
  priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
  poolSnapshotAt: '2026-08-16T16:37:51', billBatchAt: '2026-08-20T13:41:34',
  stale: false, otherMonthsAffected: [],
}
const COMPANIES: CompanyFullDTO[] = []

/** 备注行键 = 该租金行的业务键(与屏上 lineNoteKey(l) 同一份纯函数) */
const KEY: NoteKey = lineNoteKey(RENT_LINE)

interface Vm {
  editMode: boolean
  dlgRow: { tenantId: number } | null
  noteDraft: string
  noteSaving: boolean
  saveNoteEdit: (k: NoteKey) => Promise<void>
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  // 两扇门都给齐 —— 本组用例要证的是「有权限但在浏览态」,不是「没权限」
  useAuthStore().permissions = ['billing-run:edit', 'billing-issue:edit']
  vi.mocked(billNoticesApi.list).mockResolvedValue(NOTICES as never)
  vi.mocked(billNoticesApi.detail).mockResolvedValue(DETAIL as never)
  vi.mocked(billNoticesApi.notes).mockResolvedValue([] as never)
  vi.mocked(billNoticesApi.saveNote).mockResolvedValue(undefined as never)
  vi.mocked(billNoticesApi.deleteNote).mockResolvedValue(undefined as never)
  vi.mocked(paramsApi.status).mockResolvedValue(STATUS as never)
  vi.mocked(contractApi.list).mockResolvedValue([] as never)
  vi.mocked(buildingApi.list).mockResolvedValue([] as never)
  vi.mocked(companyBookApi.list).mockResolvedValue(COMPANIES as never)
  vi.mocked(billsApi.paymap).mockResolvedValue([] as never)
})

/** 期是组级的(stores/billingPeriod):先选期再挂,否则撞出账月矩阵 */
async function open() {
  useBillingPeriodStore().pick(2026, 8)
  const w = mount(BillNoticesView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
type Wrapper = Awaited<ReturnType<typeof open>>

/** 编辑模式按钮 = 全站唯一那颗 FPEditModeButton(.fp-emb);点一次进,再点一次出 */
async function clickEditBtn(w: Wrapper) {
  await w.find('.fp-emb').trigger('click')
  await flushPromises()
}

/** 开明细抽屉(整行点击);常态(非批量)下 = openDetail */
async function openDrawer(w: Wrapper) {
  const tr = w.findAll('.bn-table tbody tr').find(r => r.find('.bn-tname').exists())
  expect(tr, '列表里该有那一户').toBeTruthy()
  await tr!.trigger('click')
  await flushPromises()
}

/** 在场地租金 tab 里把那一行的备注展开成行内输入,并写进草稿 */
async function startNote(w: Wrapper, draft: string) {
  await w.find('.bn-npen').trigger('click')
  await w.find('.bn-nin').setValue(draft)
}

describe('催缴单 · 写操作的编辑态守卫', () => {
  it('❗编辑态就地转假 → 已展开的备注编辑行当场收起', async () => {
    const w = await open()
    await clickEditBtn(w)
    await openDrawer(w)
    await startNote(w, '人工改写的备注')
    expect(w.find('.bn-nin').exists(), '前置:备注编辑行已展开').toBe(true)

    await clickEditBtn(w)   // 编辑态转假(被接管 / 提权到期走的是同一个 watch)

    expect((w.vm as unknown as Vm).editMode).toBe(false)
    // 抽屉没关 —— 输入框消失只能是 watch(editMode) 把 noteEditKey 清了,
    // 删掉 :288 那句 `noteEditKey.value = null` 这条当场红(v-if 只比对 key,不看 canRun)
    expect(w.find('.fp-dwr').exists(), '抽屉还开着').toBe(true)
    expect(w.find('.bn-nin').exists(), '备注编辑行必须随编辑态收起').toBe(false)
  })

  it('编辑态下点 ✓ 真的打得出 PUT —— 下一条负向用例的对照', async () => {
    const w = await open()
    await clickEditBtn(w)
    await openDrawer(w)
    await startNote(w, '人工改写的备注')

    await w.find('.bn-nop.ok').trigger('click')
    await flushPromises()

    // 夹具确实走到了写入口:键=行业务键,月=开抽屉那一刻的快照月
    expect(billNoticesApi.saveNote).toHaveBeenCalledWith({
      ym: '2026-08', tenantId: 5, ...KEY, note: '人工改写的备注',
    })
  })

  it('❗浏览态下直呼 saveNoteEdit → 备注 API 一次都没被打出去', async () => {
    const w = await open()
    await clickEditBtn(w)
    await openDrawer(w)
    await startNote(w, '人工改写的备注')
    await clickEditBtn(w)   // 回浏览态:noteEditKey 被清,但 dlgRow / noteDraft 都还在
    vi.mocked(billNoticesApi.saveNote).mockClear()

    const vm = w.vm as unknown as Vm
    // 前置全部落实,否则会在 saveNoteEdit 自己原有的早退分支 return,守卫删掉照样绿
    expect(vm.editMode, '人在浏览态').toBe(false)
    expect(vm.dlgRow?.tenantId, '抽屉开着且 dlgRow 有值').toBe(5)
    expect(vm.noteDraft, '草稿非空').toBe('人工改写的备注')
    expect(vm.noteSaving, '没有正在保存').toBe(false)

    await vm.saveNoteEdit(KEY)

    // 删掉 :498 那句 `if (!canRun.value) return` → 这里当场打出 PUT /bill-notices/notes
    expect(billNoticesApi.saveNote, '浏览态不许写备注').not.toHaveBeenCalled()
    // 清空草稿走的是 DELETE 那一支,同一句守卫也管着它
    expect(billNoticesApi.deleteNote).not.toHaveBeenCalled()
  })

  it('❗canRun / canIssue 把 editMode 编进权限计算式 —— 浏览态没有写入口', async () => {
    const w = await open()
    // 权限齐但在浏览态:两个写入口都不该在。
    // 把 :79 canRun 的 `&& editMode.value` 删掉 → 「重新生成」这条红;
    // 把 :80 canIssue 的删掉 → 「批量确认」这条红。
    expect(w.find('.bn-actions').text(), '页头没有重新生成').not.toContain('重新生成')
    expect(w.find('.bn-toolbar').text(), '工具条没有批量确认').not.toContain('批量确认')

    await clickEditBtn(w)

    // 反向也钉住:这两颗按钮本身还在(否则上面两条会变成永远为真的空断言)
    expect(w.find('.bn-actions').text()).toContain('重新生成')
    expect(w.find('.bn-toolbar').text()).toContain('批量确认')
  })
})
