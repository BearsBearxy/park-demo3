// 即时落库的 5 张附表屏(附6 光伏 / 附7·8 充电桩 / 附11 电费 / 附13·14 水电 / 附12 工资):
// 页头的 dirty 传的是「抽屉 / 导入窗开着 ? 1 : 0」—— 只知道在改、不知道改了几处。
// 不标 dirty-approx 的话,关页签的离开确认会说「这页有 1 处改动还没保存。」,那是假话。
//
// 页头怎么用这个标在 components/sched/__tests__/schedHints.spec.ts,这里只钉「屏真的传了」。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import type { Component } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { askQueue } from '@/utils/ask'

const query: Record<string, string> = {}
const meta: Record<string, unknown> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, meta, get fullPath() { return '/x?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/review', () => ({
  reviewApi: {
    states: () => Promise.resolve([]), list: () => Promise.resolve([]),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(), recall: vi.fn(),
    closedMonths: () => Promise.resolve([]), pending: () => Promise.resolve([]),
  },
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
vi.mock('@/api/pv', () => ({ pvApi: { overview: vi.fn(), records: vi.fn(), phases: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))
vi.mock('@/api/elec', () => ({ elecApi: { phases: vi.fn(), overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))
vi.mock('@/api/charging', () => ({ chargingApi: { cats: vi.fn(), overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))
vi.mock('@/api/utilities', () => ({ utilitiesApi: { overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))
vi.mock('@/api/salary', () => ({ salaryApi: { overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))

import PvView from '@/views/pv/PvView.vue'
import ElecView from '@/views/elec/ElecView.vue'
import ChargingView from '@/views/charging/ChargingView.vue'
import UtilitiesView from '@/views/utilities/UtilitiesView.vue'
import SalaryView from '@/views/salary/SalaryView.vue'
import { pvApi } from '@/api/pv'
import { elecApi } from '@/api/elec'
import { chargingApi } from '@/api/charging'
import { utilitiesApi } from '@/api/utilities'
import { salaryApi } from '@/api/salary'

// 表体与抽屉整块 stub:这里只看页头登记的改动数标没标「数不准」
const STUBS = {
  Teleport: true, FpImportModal: true,
  PvTable: true, ElecTable: true, ChargingTable: true, UtilitiesTable: true, SalaryTable: true,
  PvRecordDrawer: true, ElecRecordDrawer: true, ChargingRecordDrawer: true, UtilitiesRecordDrawer: true, SalaryRecordDrawer: true,
}
const YEAR = (y: number) => Promise.resolve({ year: y, rows: [], total: {}, cats: [] } as never)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  askQueue.splice(0)
  for (const k of Object.keys(query)) delete query[k]
  for (const k of Object.keys(meta)) delete meta[k]
  Element.prototype.scrollIntoView = vi.fn()
  useAuthStore().permissions = ['entry:edit']
  vi.setSystemTime(new Date('2025-07-15T00:00:00'))
  vi.mocked(pvApi.phases).mockResolvedValue([] as never)
  vi.mocked(pvApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(pvApi.records).mockImplementation(YEAR)
  vi.mocked(elecApi.phases).mockResolvedValue([] as never)
  vi.mocked(elecApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(elecApi.records).mockImplementation(YEAR)
  vi.mocked(chargingApi.cats).mockResolvedValue([] as never)
  vi.mocked(chargingApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(chargingApi.records).mockImplementation((_no: number, y: number) => YEAR(y))
  vi.mocked(utilitiesApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(utilitiesApi.records).mockImplementation((_no: number, y: number) => YEAR(y))
  vi.mocked(salaryApi.overview).mockResolvedValue({ currentYear: 2025, years: [{ year: 2025, hasData: true, months: [4], netTotal: 0, count: 0 }] } as never)
  vi.mocked(salaryApi.records).mockImplementation((y: number, m: number) => Promise.resolve({ year: y, month: m, rows: [], total: {} } as never))
})

type Vm = { edit: boolean; drawer: boolean; importing: boolean }
/** 深链进表、进编辑态 */
async function openEditing(view: Component, p: string): Promise<VueWrapper> {
  query.p = p
  const w = mount(view, { global: { stubs: STUBS } })
  await flushPromises()
  ;(w.vm as unknown as Vm).edit = true
  await flushPromises()
  return w
}

const SCREENS = [
  { name: '附6 光伏', view: PvView, p: '2025' },
  { name: '附11 电费', view: ElecView, p: '2025' },
  { name: '附7 充电桩', view: ChargingView, p: '2025' },
  { name: '附13 水电', view: UtilitiesView, p: '2025' },
  { name: '附12 工资', view: SalaryView, p: '2025-04' },
]

describe('即时落库的附表屏:开着抽屉 / 导入窗只算「在改」,不报处数', () => {
  // 破坏验证:任一屏 <SchedHeader> 上删掉 dirty-approx → 那一屏红
  it.each(SCREENS)('❗$name:抽屉开着 → 登记成数不准', async ({ view, p }) => {
    const w = await openEditing(view, p)
    const auth = useAuthStore()
    expect(auth.dirtyTotal, '编辑态没开抽屉 = 0 处,关页签不该问').toBe(0)
    ;(w.vm as unknown as Vm).drawer = true
    await flushPromises()
    expect(auth.dirtyTotal).toBe(1)
    expect(auth.dirtyApproxOn(''), '开着就算 1,不报处数').toBe(true)
  })
})

describe('附12 工资 · 导入只换之前导入的行', () => {
  // 后端 SalaryService.importRows 只删本月 source='import' 的行,手工行不动。
  // 破坏验证:SalaryView 的 <SchedHeader> 上删掉 import-keeps-manual → 红(标题回到「整期替换」)
  it('❗有没保存的改动时点导入,确认标题说手工录的行不动', async () => {
    const w = await openEditing(SalaryView, '2025-04')
    ;(w.vm as unknown as Vm).drawer = true
    await flushPromises()
    await w.findAll('.lc-head button').find(b => b.text().includes('导入 Excel'))!.trigger('click')
    await flushPromises()
    expect(askQueue[0]?.title).toBe('导入会替换本期之前导入的行，手工录的行不动')
  })
})
