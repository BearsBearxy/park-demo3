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
import { pnlApi } from '@/api/pnl'
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
  useAuthStore().permissions = ['report:edit']
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
    expect(pnlApi.save).toHaveBeenCalledWith('s1', 2025, { rows: GEN.rows })
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
