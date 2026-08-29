import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
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
