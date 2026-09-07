// 台账的审核闸(SIDEBAR-UX-REDESIGN §7.5,R2 T4)。
//
// ⚠ 这是编辑入口的**第三条路**。全仓只有三个地方持编辑态:
//   ① useEditMode(10 屏)② SchedHeader(附表族 7 屏)③ **LedgerWideTable**——
//   宿主 LedgerView 是裸的 `const edit = ref(false)`(见 LedgerWideTable.vue 的头注),
//   两条都不沾。spec §7.5 只写了 ①,照字面实现等于放过整个台账族(每公司每月一把键)。
//
// 挂载套 archivedCols.spec.ts 那份最小 props;这里只关心工具条上那颗编辑按钮。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import LedgerWideTable from '@/views/ledger/LedgerWideTable.vue'
import type { Book, BookDef } from '@/types/book'
import type { LedgerMonthDTO, LedgerRowDTO } from '@/types/ledger'
import { FEE_KEYS } from '@/utils/ledgerColumns'
import api from '@/api'

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

const zeroFees = () => Object.fromEntries(FEE_KEYS.map(k => [k, 0])) as Record<string, number>
const def: BookDef = {
  groups: [{ id: 'g1', label: '租金', cols: [
    { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: 96 },
  ] }],
}
const book: Book = { id: 1, screen: 'ledger', companyId: 9, phase: null, name: '甲公司',
                     ver: 3, latestVer: 3, definition: def }
const row = { ...zeroFees(), id: 5, tenantId: 5, tenantName: '张三', balancePrev: 0,
              totalCollected: 0, note: null, totalReceivable: 0, balanceEnd: 0 } as unknown as LedgerRowDTO
const month: LedgerMonthDTO = {
  companyName: '甲公司', year: 2026, month: 9, prevMonth: 8, rows: [row],
  footer: { ...zeroFees(), balancePrev: 0, totalReceivable: 0, totalCollected: 0, balanceEnd: 0 } as LedgerMonthDTO['footer'],
  archivedCols: [],
}

const KEY = 'ledger:9:2026-09'

function seedReview(status: string) {
  vi.mocked(api.get).mockImplementation((url: string) =>
    url === '/review'
      ? Promise.resolve([{
          key: KEY, kind: 'ledger', scope: '9', status,
          submittedBy: '张三', submittedAt: null,
          reviewedBy: '李审', reviewedAt: '2026-10-05T10:00:00',
          reason: null, blockedBy: [],
        }] as never)
      : (Promise.resolve([]) as never))
}

function mk(props: Record<string, unknown> = {}) {
  return mount(LedgerWideTable, {
    props: { month, draft: [row], book, companyName: '甲公司', year: 2026, monthNo: 9,
             edit: false, saving: false, lockScope: 'ledger:9:2026-09', ...props },
  })
}

const lockPosts = () => vi.mocked(api.post).mock.calls.filter(c => String(c[0]).startsWith('/locks'))

describe('台账审核闸(编辑入口的第三条路)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(api.get).mockImplementation(() => Promise.resolve([]) as never)
    vi.mocked(api.post).mockResolvedValue({ granted: true, holder: null } as never)
    useAuthStore().permissions = ['entry:edit']
  })

  // 破坏验证:删掉 onEnterEdit 开头那一行 → 红
  it('❗已审核的月进不了编辑模式,也不去占锁', async () => {
    seedReview('approved')
    const w = mk({ reviewKey: KEY })
    await flushPromises()
    expect(w.find('.lg-reviewpill').text()).toContain('已审核 · 李审 10-05')
    await w.find('.lg-reviewpill').trigger('click')
    await flushPromises()
    expect(w.emitted('enter-edit'), '药丸点不动').toBeUndefined()
    expect(lockPosts(), '已审核的台账上不该出现一次 acquire').toHaveLength(0)
  })

  // 破坏验证:把 LOCKING 改成只含 approved → 红
  it('❗待审核也锁(D17)', async () => {
    seedReview('submitted')
    const w = mk({ reviewKey: KEY })
    await flushPromises()
    expect(w.find('.lg-reviewpill').text()).toContain('待审核 · 已交审')
  })

  // 破坏验证:把 returned 加进 LOCKING → 红
  it('❗已退回照常能改', async () => {
    seedReview('returned')
    const w = mk({ reviewKey: KEY })
    await flushPromises()
    expect(w.find('.lg-reviewpill').exists()).toBe(false)
    await w.find('.lg-lockbtn').trigger('click')
    await flushPromises()
    expect(w.emitted('enter-edit')).toBeTruthy()
  })

  // 破坏验证:删掉 onTaken 里那一行 → 红。接管抽屉不能成为绕开审核闸的后门。
  it('❗接管成功也进不去', async () => {
    seedReview('approved')
    const w = mk({ reviewKey: KEY })
    await flushPromises()
    await w.findComponent({ name: 'FPTakeoverDrawer' }).vm.$emit('taken')
    await flushPromises()
    expect(w.emitted('enter-edit')).toBeUndefined()
    expect(lockPosts()).toHaveLength(0)
  })

  // 破坏验证:删掉 watch(reviewBlock, ...) 那一条 → 红
  it('❗编辑态里这一册这一月被审了 → 请父层退出', async () => {
    const w = mk({ reviewKey: KEY, edit: true })
    await flushPromises()
    expect(w.emitted('cancel'), '没审的月不该误伤').toBeUndefined()

    seedReview('approved')
    const { useReviewStore } = await import('@/stores/review')
    const rs = useReviewStore()
    rs.invalidate('2026-09')
    await rs.ensure('2026-09')
    await flushPromises()
    expect(w.emitted('cancel'), '在编辑态里被审了 → 退出').toBeTruthy()
  })

  // 破坏验证:把 watch 的 immediate 去掉 → 红
  it('❗不传 reviewKey 时一个字不改', async () => {
    const w = mk()
    await flushPromises()
    expect(w.find('.lg-reviewpill').exists()).toBe(false)
    expect(vi.mocked(api.get).mock.calls.filter(c => c[0] === '/review')).toHaveLength(0)
  })
})
