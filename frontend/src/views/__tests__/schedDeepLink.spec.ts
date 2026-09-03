// src/views/__tests__/schedDeepLink.spec.ts — 年表屏消费期间深链(SIDEBAR-UX-REDESIGN §4.2「年表屏 p 只取年」/ §5.1 extra.tab · extra.mode)。
// 附6 的挂载测在 twoBooksRail.spec;这里钉另三屏各自的那一处差异:附13/14 的 tab、附表8 的 route.meta、附表11 的第二本叫 cost。
// 年表 DTO 的形状不是这里要钉的:records 一律在途(屏落在转圈分支),断言只看门与请求。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const query: Record<string, string> = {}
const meta: Record<string, unknown> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, meta, get fullPath() { return '/x?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/utilities', () => ({ utilitiesApi: { overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))
vi.mock('@/api/charging', () => ({ chargingApi: { cats: vi.fn(), overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))
vi.mock('@/api/elec', () => ({ elecApi: { phases: vi.fn(), overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))

import UtilitiesView from '@/views/utilities/UtilitiesView.vue'
import ChargingView from '@/views/charging/ChargingView.vue'
import ElecView from '@/views/elec/ElecView.vue'
import { utilitiesApi } from '@/api/utilities'
import { chargingApi } from '@/api/charging'
import { elecApi } from '@/api/elec'

const NEVER = () => new Promise(() => {}) as never

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(query)) delete query[k]
  for (const k of Object.keys(meta)) delete meta[k]
  vi.mocked(utilitiesApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(utilitiesApi.records).mockReturnValue(NEVER())
  vi.mocked(chargingApi.cats).mockResolvedValue([] as never)
  vi.mocked(chargingApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(chargingApi.records).mockReturnValue(NEVER())
  vi.mocked(elecApi.phases).mockResolvedValue([] as never)
  vi.mocked(elecApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(elecApi.records).mockReturnValue(NEVER())
})

async function open(C: typeof UtilitiesView | typeof ChargingView | typeof ElecView) {
  const w = mount(C, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

describe('年表屏 · 期间深链', () => {
  it('❗附13/14:?tab=phase3 先落子表再落年 —— records 只拉一次,拉的是附表14', async () => {
    // 红线:UtilitiesView.vue 的 tab 初值不读 route.query.tab → 拉的是 (13, 2025);
    //      tab 改在 apply 里 pickYear 之后才置 → 先拉 (13, 2025) 再补 (14, 2025),两趟
    query.p = '2025'; query.tab = 'phase3'
    const w = await open(UtilitiesView)
    expect(w.find('.sm-gate').exists(), '门该被深链跳过').toBe(false)
    expect(utilitiesApi.records).toHaveBeenCalledWith(14, 2025)
    expect(utilitiesApi.records).toHaveBeenCalledTimes(1)
  })

  it('附13/14:tab 认不出退回办公水电', async () => {
    query.p = '2025'; query.tab = 'nonsense'
    await open(UtilitiesView)
    expect(utilitiesApi.records).toHaveBeenCalledWith(13, 2025)
  })

  it('❗附表8:带 p 进屏直落该年 —— schedule no 仍从 route.meta 来', async () => {
    // 红线:ChargingView.vue 的 useDeepPeriod 删掉 → 门出现
    meta.kind = 'schedule8'
    query.p = '2025'
    const w = await open(ChargingView)
    expect(w.find('.sm-gate').exists()).toBe(false)
    expect(chargingApi.records).toHaveBeenCalledWith(8, 2025)
    expect(chargingApi.records).toHaveBeenCalledTimes(1)
  })

  it('❗附表11:?mode=summary 盖过本机记住的园区电费模型(第二本 id 是 cost 不是 meter)', async () => {
    // 红线:ElecView.vue 的 mode 初值不读 route.query.mode → 落到园区电费模型,年表不拉
    localStorage.setItem('fp-view-mode:elec-cost', 'cost')
    query.p = '2025'; query.mode = 'summary'
    const w = await open(ElecView)
    expect(w.findAll('.br-item')[0].classes()).toContain('on')
    expect(elecApi.records).toHaveBeenCalledWith(2025, 'energy')
    expect(elecApi.records).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('fp-view-mode:elec-cost'), '深链不改记忆').toBe('cost')
  })
})
