import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useSchedScreen } from '@/composables/useSchedScreen'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve([])),
    put: vi.fn(() => Promise.resolve({ users: [] })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

/**
 * 附表族共用层的两条守卫(2026-08-30 收口复查):
 * 四屏的 onCreate 存到别的年会静默跳年而不清勾选;失锁翻 edit 不关写浮层。
 * 都修在这一层 = 现在和将来的全部屏一次到位。
 */
function host(opts: { keep?: boolean } = {}) {
  let api!: ReturnType<typeof useSchedScreen>
  const Host = defineComponent({
    setup() {
      api = useSchedScreen({
        load: async () => {},
        reloadOverview: async () => {},
        rows: () => [],
        clearData: () => {},
        onPickYear: () => {},
        batchDelete: async () => {},
        clear: { call: async () => {}, confirm: () => '确认?' },
        ...(opts.keep ? { keepSelectionOnNav: true } : {}),
      } as never)
      return () => null
    },
  })
  mount(Host)
  return api
}

describe('useSchedScreen 共用守卫', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('❗换年清勾选 —— 残留 id 会喂给「删除选中」批删另一年看不见的行', async () => {
    const s = host()
    s.year.value = 2025
    await nextTick()
    s.selectedIds.value = new Set([1, 2, 3])

    s.year.value = 2026          // onCreate 存到别的年 = 静默跳年,走的就是这一步
    await nextTick()
    expect(s.selectedIds.value.size, '后端按 id 裸删不校年份 —— 勾选必须随年清').toBe(0)
  })

  it('附表10 的 keepSelectionOnNav 照旧尊重 —— 跨年保留是它的故意行为', async () => {
    const s = host({ keep: true })
    s.year.value = 2025
    await nextTick()
    s.selectedIds.value = new Set([1])
    s.year.value = 2026
    await nextTick()
    expect(s.selectedIds.value.size).toBe(1)
  })

  it('❗编辑态转假 → 抽屉与导入窗一起关(失锁后它们是仅剩的无锁写入口)', async () => {
    const s = host()
    s.edit.value = true
    s.drawer.value = true
    s.importing.value = true
    await nextTick()

    s.edit.value = false         // 被接管/提权到期走的就是这一句
    await nextTick()
    expect(s.drawer.value, '新增抽屉没关').toBe(false)
    expect(s.importing.value, '导入窗没关').toBe(false)
  })
})

// ══════════ 按月份行上锁(SIDEBAR-UX-REDESIGN §7.1 D18,R2 T4b) ══════════
//
// 附表6/7/8/11 与附13/14 是**年表屏**:一屏 12 个月的行,而审核是一张表 × 一个月。
// 闸不能长在页头那颗编辑按钮上 —— 那会连没审的月一起锁死,人就没法接着录这一年剩下的月。
// 所以落到行上,判据在这一层,四张表共用。

import api from '@/api'

type LockRow = { id: number; source: 'manual'; acctMonth: string }

function lockHost(rows: LockRow[], kinds: string[], scope?: () => string | null) {
  let out!: ReturnType<typeof useSchedScreen>
  const Host = defineComponent({
    setup() {
      out = useSchedScreen({
        load: async () => {}, reloadOverview: async () => {},
        rows: () => rows, clearData: () => {},
        batchDelete: async () => {}, clear: { call: async () => {}, confirm: () => true },
        reviewKinds: kinds, ...(scope ? { reviewScope: scope } : {}),
      } as never)
      return () => null
    },
  })
  mount(Host)
  return out
}

/** 闸道(GET /api/review/states?year=)回这一年已落库的行。 */
function seedYear(rows: { key: string; kind: string; scope?: string | null; status: string }[]) {
  vi.mocked(api.get).mockImplementation((url: string) =>
    url === '/review/states'
      ? Promise.resolve(rows.map(r => ({
          scope: null, submittedBy: null, submittedAt: null,
          reviewedBy: '李审', reviewedAt: '2025-04-05T10:00:00',
          reason: null, blockedBy: [], ...r,
        })) as never)
      : (Promise.resolve([]) as never))
}

describe('年表屏按月份行上锁(D18)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(api.get).mockImplementation(() => Promise.resolve([]) as never)
  })

  const ROWS: LockRow[] = [
    { id: 1, source: 'manual', acctMonth: '2025-03' },   // 已审
    { id: 2, source: 'manual', acctMonth: '2025-04' },   // 待审
    { id: 3, source: 'manual', acctMonth: '2025-05' },   // 没审
  ]

  /**
   * ⚠ 这里**不许**自己去 `useReviewStore().ensureYear(2025)` —— 那会把组件自己那趟取数遮住,
   *   于是删掉 useSchedScreen 里的取数 watch 之后全部断言照样绿(头一版就是这么写的,实测假绿)。
   *   等的是组件进年时自己发的那一趟。
   */
  async function ready(kinds = ['pv'], scope?: () => string | null) {
    const s = lockHost(ROWS, kinds, scope)
    await s.pickYear(2025)
    await flushPromises()
    await nextTick()
    return s
  }

  // 破坏验证:把 useSchedScreen 里那句 `if (opts.reviewKinds && y != null) void review.ensureYear(y)` 删掉 → 红
  it('❗进年即取该年审核态,lockedMonths 是已审 + 待审两档', async () => {
    seedYear([{ key: 'pv:2025-03', kind: 'pv', status: 'approved' },
              { key: 'pv:2025-04', kind: 'pv', status: 'submitted' },
              { key: 'pv:2025-06', kind: 'pv', status: 'returned' }])
    const s = await ready()
    expect([...s.lockedMonths.value].sort((a, b) => a - b), 'returned 不锁').toEqual([3, 4])
  })

  // ❗这一条是 D18 的要害:锁住的是**行**不是**屏**。
  //   破坏验证:把 toggleSelect 里的 `if (isRowLocked(row)) return` 删掉 → 红。
  it('❗已审核 / 待审核的月不许进选中集,没审的月照常能选', async () => {
    seedYear([{ key: 'pv:2025-03', kind: 'pv', status: 'approved' },
              { key: 'pv:2025-04', kind: 'pv', status: 'submitted' }])
    const s = await ready()
    s.toggleSelect(ROWS[0] as never)
    s.toggleSelect(ROWS[1] as never)
    expect([...s.selectedIds.value], '两个锁月一个都不该进来').toEqual([])
    s.toggleSelect(ROWS[2] as never)
    expect([...s.selectedIds.value], '没审的月照常能选 —— 别把整屏锁死').toEqual([3])
  })

  // 破坏验证:把 selectAll 里的 `.filter(r => !isRowLocked(r))` 删掉 → 红。
  // 「全选」一键绕过闸,而且下一步是**批量**删除。
  it('❗全选跳过锁月', async () => {
    seedYear([{ key: 'pv:2025-03', kind: 'pv', status: 'approved' }])
    const s = await ready()
    s.selectAll(true)
    expect([...s.selectedIds.value].sort((a, b) => a - b), '3 月已审,不该被全选带走').toEqual([2, 3])
  })

  // 破坏验证:把 stores/review 的 lockedMonths 里 kinds 过滤删掉 → 红。
  // 附表7 与附表8 是两个 kind 同挂一屏组件,串了就会拿附表7 的锁去锁附表8 的行。
  it('❗只认本屏管的 kind', async () => {
    seedYear([{ key: 'charging-car:2025-03', kind: 'charging-car', status: 'approved' },
              { key: 'charging-ebike:2025-05', kind: 'charging-ebike', status: 'approved' }])
    const s = await ready(['charging-ebike'])
    expect([...s.lockedMonths.value], '附表7 的锁不该锁到附表8 的行上').toEqual([5])
  })

  // 破坏验证:把 lockedMonths 里的 scope 过滤删掉 → 红。附13 与附14 是同一个 kind 的两个 scope。
  it('❗附13 / 附14 各锁各的(同 kind 两个 scope)', async () => {
    seedYear([{ key: 'utilities:office:2025-03', kind: 'utilities', scope: 'office', status: 'approved' },
              { key: 'utilities:phase3:2025-07', kind: 'utilities', scope: 'phase3', status: 'approved' }])
    const s = await ready(['utilities'], () => 'phase3')
    expect([...s.lockedMonths.value], '办公的锁不该锁到三期的行上').toEqual([7])
  })

  // 破坏验证:把取数 watch 里的 `opts.reviewKinds &&` 去掉 → 红。
  // 承重的是**取数**那道闸:没取数就没有这一年的数据,lockedMonths 自然是空集。
  it('❗不是年表屏(没传 reviewKinds)时不取数也不锁', async () => {
    const s = lockHost(ROWS, undefined as never)
    await s.pickYear(2025)
    await nextTick()
    expect([...s.lockedMonths.value]).toEqual([])
    expect(vi.mocked(api.get).mock.calls.filter(c => String(c[0]).startsWith('/review'))).toHaveLength(0)
  })
})
