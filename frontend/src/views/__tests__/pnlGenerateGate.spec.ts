// 损益附表进年自动补缺失映射行(tryGenerate → 整年 PUT):只在我园补(2026-10-05 用户拍板「按你建议修改」)。
// 补出来的行名是我园母册的科目名(pnlDerive DERIVE_MAP),客户园区(parkTools=false)不许写进客户的库。
// 破坏验证:tryGenerate 删掉 `if (!appCfg.parkTools) return` → 客户、拉失败两条红;
//          把那一句挪到 generatedYears.add 之后 → 「拉失败」那条红;删掉等配置的 `await appCfg.ensure()` → 「晚到」那条红。
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const query: Record<string, string> = {}
const meta: Record<string, unknown> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, meta, get fullPath() { return '/x?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/pnl', () => ({ pnlApi: { overview: vi.fn(), year: vi.fn(), save: vi.fn(), import: vi.fn() } }))
// 整月锁账的月(默认没有);不桩的话「配置晚到 / 拉失败」两条里别的 GET 一律挂起,补行永远等不到它
vi.mock('@/api/review', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/api/review')>()
  return { reviewApi: { ...orig.reviewApi, closedMonths: vi.fn(() => Promise.resolve([] as string[])) } }
})
// 派生数据换成空对象;生成器回一行(真生成器要六个 api 的数,不是这里测的事)
const GEN = { rows: [{ rowKey: 'r1', groupLabel: '组', label: '补出来的行', kind: 'detail', note: null, m: Array(12).fill(1), sortOrder: 0 }], added: 1 }
vi.mock('@/reports/pnlDerive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/reports/pnlDerive')>()),
  loadDeriveData: vi.fn().mockResolvedValue({}),
  generateMissingRows: vi.fn(() => GEN),
}))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

import PnlScheduleView from '@/views/reports/pnl/PnlScheduleView.vue'
import PnlTable from '@/views/reports/pnl/PnlTable.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import { pnlApi } from '@/api/pnl'
import { reviewApi } from '@/api/review'
import { generateMissingRows } from '@/reports/pnlDerive'
import { useAuthStore } from '@/stores/auth'
import { ourPark, customerPark } from '@/test-utils/appConfig'
import http from '@/api'

async function open() {
  const w = mount(PnlScheduleView, { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } } })
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['rent-pnl:view', 'rent-pnl:edit']   // RBAC v4:附表1 本屏的编辑
  vi.clearAllMocks()
  localStorage.clear()
  query.p = '2025-06'   // 深链直落 2025 年表 → pickYear → tryGenerate
  meta.value = 'rent-pnl'
  vi.mocked(pnlApi.overview).mockResolvedValue({ years: [{ year: 2025, hasData: true, rowCount: 0 }] } as never)
  vi.mocked(pnlApi.year).mockImplementation((_s: string, y: number) => Promise.resolve({ year: y, rows: [] }) as never)
  vi.mocked(pnlApi.save).mockImplementation((_s: string, y: number) => Promise.resolve({ year: y, rows: [] }) as never)
})
let getSpy: MockInstance | undefined
afterEach(() => { getSpy?.mockRestore(); getSpy = undefined })
/** 部署配置接口:按 cfg 回(Promise 由用例控制);别的 GET 一律挂起 */
function configGet(cfg: () => Promise<unknown>) {
  getSpy = vi.spyOn(http, 'get').mockImplementation(((url: string) => (url === '/app/config' ? cfg() : new Promise(() => {}))) as never)
}

describe('损益附表自动补行只在我园', () => {
  it('我园:进年补行并整年保存', async () => {
    ourPark()
    await open()
    expect(pnlApi.save).toHaveBeenCalledWith('s1', 2025, { rows: GEN.rows }, true)
    expect(generateMissingRows).toHaveBeenCalledTimes(1)   // 没有锁账月:不重算
  })

  // 用户 2026-10-05 拍板「2按你建议，3，4一起做」第 3 条:后端改到整月锁账的月整次拒 —— 补行跳过那几个月,开着的月照补
  // 破坏验证:tryGenerate 不传 skip → 红;不按年筛(2024-12 混进来)→ 红;月份不减 1 → 红
  it('❗这一年有整月锁账的月:那几个月不补,开着的月照补', async () => {
    ourPark()
    vi.mocked(reviewApi.closedMonths).mockResolvedValueOnce(['2024-12', '2025-03', '2025-11'])
    await open()
    expect(vi.mocked(generateMissingRows).mock.calls.at(-1)?.[3]).toEqual(new Set([2, 10]))
    expect(pnlApi.save).toHaveBeenCalledWith('s1', 2025, { rows: GEN.rows }, true)
  })

  // 编辑态把这一年的锁账月交给表格(那几列只读、「填入」跳过);进编辑态才取,换别的年不算。破坏验证:toggleEdit 不调 loadLocked → 红
  it('❗进编辑态取这一年的锁账月交给表格', async () => {
    customerPark('0.29.0')
    const w = await open()
    vi.mocked(reviewApi.closedMonths).mockResolvedValueOnce(['2024-04', '2025-03'])
    w.findComponent(SchedHeader).vm.$emit('toggle-edit')
    await flushPromises()
    expect([...(w.findComponent(PnlTable).props('lockedMonths') as Set<number>)]).toEqual([2])
  })

  it('❗客户园区:进年不补、不保存', async () => {
    customerPark('0.29.0')
    await open()
    expect(pnlApi.year).toHaveBeenCalledWith('s1', 2025)
    expect(pnlApi.save).not.toHaveBeenCalled()
  })

  // 我园刷新后深链直落这一年:配置比年表和派生数慢到,等它到了当场补,不用切走再回来
  it('❗部署配置晚到(我园):等它到了照常补', async () => {
    let arrive!: (v: unknown) => void
    configGet(() => new Promise((r) => { arrive = r }))
    await open()
    expect(pnlApi.save, '配置没到不许先补').not.toHaveBeenCalled()
    arrive({ parkTools: true, releaseBaseline: '0.0.0' })
    await flushPromises()
    expect(pnlApi.save).toHaveBeenCalledTimes(1)
  })

  it('❗部署配置拉失败:不补;配置到了(我园)再进这一年照常补 —— 失败那次不算「试过」', async () => {
    configGet(() => Promise.reject(new Error('断网')))
    const w = await open()
    expect(pnlApi.save).not.toHaveBeenCalled()
    ourPark()
    await (w.vm as unknown as { pickYear: (y: number) => Promise<void> }).pickYear(2025)
    await flushPromises()
    expect(pnlApi.save).toHaveBeenCalledTimes(1)
  })
})

// RBAC v4(2026-10-09,RBAC-SPEC §15.7):补行是整年 PUT,要本屏的编辑。只看得了的人进年也发,后端拒了静默,白跑一趟。
// 夹具不退化:有别的附表(附表2)的编辑、唯独没有本屏的 —— 只给查看分不出「按屏判」和「有任一报表编辑就行」。
// 破坏验证:tryGenerate 去掉 can(editPerm) 那一行 → 这两条红(第二条前半段也断言没补);
//          把这一行挪到 generatedYears.add 之后 → 只有第二条红(借到编辑权后这一年再也不补)
describe('损益附表自动补行要本屏的编辑', () => {
  it('❗只有附表1 查看(另有附表2 编辑):进年不补、不保存', async () => {
    ourPark()
    useAuthStore().permissions = ['rent-pnl:view', 'elec-pnl:view', 'elec-pnl:edit']
    await open()
    expect(pnlApi.year).toHaveBeenCalledWith('s1', 2025)
    expect(pnlApi.save).not.toHaveBeenCalled()
  })

  it('❗没有编辑时那次不算「试过」:借到本屏编辑后再进这一年照常补', async () => {
    ourPark()
    useAuthStore().permissions = ['rent-pnl:view']
    const w = await open()
    expect(pnlApi.save).not.toHaveBeenCalled()
    useAuthStore().permissions = ['rent-pnl:view', 'rent-pnl:edit']
    await (w.vm as unknown as { pickYear: (y: number) => Promise<void> }).pickYear(2025)
    await flushPromises()
    expect(pnlApi.save).toHaveBeenCalledTimes(1)
  })
})
