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
import FPReviewActions from '@/components/fp/FPReviewActions.vue'
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
    url === '/review/states'
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
    await rs.ensureYear(2026)
    await flushPromises()
    expect(w.emitted('cancel'), '在编辑态里被审了 → 退出').toBeTruthy()
  })

  // ── 交审动作簇(per-screen-review §03-B2) ───────────────────────────
  // 簇内「哪个态画哪几颗」的断言在 components/fp/__tests__/FPReviewActions.spec.ts 写过一次,
  // 这里只验**这一屏喂进去的是什么**:哪一把键、哪个人话名、什么时候不喂。

  // 破坏验证:把 :keys 改成 `[reviewKey, 'ledger:8:2026-09']`(冒充「一次交全部公司」)→
  //   keys 断言红;把 :label 里的 companyName 去掉 → label 断言红。
  it('❗动作簇只作用于当前这一册这一月那一把键,弹卡标题带公司名', async () => {
    const w = mk({ reviewKey: KEY })
    await flushPromises()
    const a = w.findComponent(FPReviewActions)
    expect(a.props('keys'), '一次只交看得见的那一把 —— 交全部公司是本月出账清单的活').toEqual([KEY])
    expect(a.props('label')).toBe('月度台账 · 甲公司 · 2026-09')
    expect(w.findAll('button').map(b => b.text()).join('|'), '未交审 ⇒ 画「交审」').toContain('交审')
  })

  // 编辑态一颗动作按钮不画,但整簇**要挂着** —— 「已退回」那颗 chip 归它管,人正是照着理由在改。
  // 判据收在组件里(FPReviewActions 的 edit prop),这一屏只负责把自己的编辑态告诉它:
  // 改前是靠「整簇长在 v-else 分支里」实现的,那是第二份判据,顺手把 chip 也藏了。
  //
  // 破坏验证①:把 <FPReviewActions> 上的 :edit 删掉 → props('edit') 那条红(默认 false = 当成浏览态)
  // 破坏验证②:把它挪回浏览态那个 v-else 分支里 → exists() 那条红
  it('❗编辑态:整簇仍挂着(chip 要留),但「交审」一颗不画', async () => {
    const w = mk({ reviewKey: KEY, edit: true })
    await flushPromises()
    const a = w.findComponent(FPReviewActions)
    expect(a.exists(), '整簇被藏掉的话「已退回 · 理由」那颗 chip 跟着没了').toBe(true)
    expect(a.props('edit'), '不传 :edit 的话组件按浏览态画,编辑态照样出「交审」').toBe(true)
    expect(w.findAll('button').map(b => b.text()).join('|'),
           '交审交的是**库里那一份**,而编辑态手上是没保存的草稿').not.toContain('交审')
  })

  // 破坏验证:把 :can-edit 改成写死 true → 红
  it('❗无 entry:edit 的账号整簇不画 —— 与旁边那颗编辑按钮同一道门', async () => {
    useAuthStore().permissions = []
    const w = mk({ reviewKey: KEY })
    await flushPromises()
    expect(w.findComponent(FPReviewActions).props('canEdit')).toBe(false)
    expect(w.findAll('button').map(b => b.text()).join('|')).not.toContain('交审')
  })

  // 破坏验证:把 watch 的 immediate 去掉 → 红
  it('❗不传 reviewKey 时一个字不改', async () => {
    const w = mk()
    await flushPromises()
    expect(w.find('.lg-reviewpill').exists()).toBe(false)
    expect(vi.mocked(api.get).mock.calls.filter(c => String(c[0]).startsWith('/review'))).toHaveLength(0)
  })
})
