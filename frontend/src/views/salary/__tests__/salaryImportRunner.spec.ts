// 附表12 工资 · 导入点下去之后(画布 11 ImportOne / ImportDone / ImportFail;UI-OVERLAY-SPEC §8):
// 弹窗不关,内容区换进度卡,写完跳到首段年月、重读,原地出结果卡;失败交给弹窗的失败卡(不走回执)。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { KeepAlive, defineComponent, h, ref } from 'vue'

import SalaryView from '@/views/salary/SalaryView.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import { salaryApi } from '@/api/salary'
import { useAuthStore } from '@/stores/auth'
import type { SalaryOverviewDTO, SalaryYearMonthDTO, SalaryTotal } from '@/types/salary'
import { receipts } from '@/utils/receipt'

vi.mock('@/api/salary', () => ({
  salaryApi: {
    overview: vi.fn(), records: vi.fn(),
    create: vi.fn(), updateNote: vi.fn(), remove: vi.fn(),
    importRows: vi.fn(), clearImported: vi.fn(), batchDelete: vi.fn(),
  },
}))
vi.mock('@/api/importLog', () => ({ importLogApi: { record: vi.fn(() => Promise.resolve()) } }))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))
vi.mock('@/api/review', () => ({
  reviewApi: {
    list: vi.fn(() => Promise.resolve([])), states: vi.fn(() => Promise.resolve([])),
    closedMonths: vi.fn(() => Promise.resolve([])), pending: vi.fn(() => Promise.resolve([])),
  },
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {}, fullPath: '/salary' }) }))

const TOTAL: SalaryTotal = {
  base: 0, post: 0, perf: 0, attend: 0, skill: 0, edu: 0, other: 0, lunch: 0, heat: 0,
  commission: 0, wageTotal: 0, gross: 0, social: 0, tax: 0, otherDeduct: 0, deduct: 0, net: 0,
}
const OVERVIEW: SalaryOverviewDTO = {
  currentYear: 2025,
  years: [{ year: 2025, hasData: true, count: 0, netTotal: 0, months: [1, 2, 3] }],
}
const monthOf = (m: number): SalaryYearMonthDTO => ({ year: 2025, month: m, rows: [], total: TOTAL })

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  useAuthStore().permissions = ['salary:edit']
  receipts.splice(0)
  vi.mocked(salaryApi.overview).mockResolvedValue(OVERVIEW)
  vi.mocked(salaryApi.records).mockImplementation((_y: number, m: number) => Promise.resolve(monthOf(m)))
})

/** 矩阵点 2025-03 进宽表 → 编辑模式 → 打开导入弹窗 */
async function openImport() {
  const w = mount(SalaryView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  await w.findAll('.bmm-card')[2].trigger('click')
  await flushPromises()
  await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
  await flushPromises()
  await w.findAll('button').find(b => b.text().includes('导入 Excel'))!.trigger('click')
  await flushPromises()
  expect(w.find('.fpimp-scrim').exists(), '前置:导入弹窗开着').toBe(true)
  return w
}
type ModalVm = { onSectionsConfirm: (p: unknown[]) => void }

describe('附表12 · 导入走弹窗的 runner', () => {
  // 锁按月(S.salary):一换月 SchedHeader 就退出编辑、收掉导入窗 —— 所以跳到首段年月挪到看完结果、关窗之后。
  // 破坏验证:FpImportModal 换回 @import-sections(不给 :runner)→ 弹窗当场关 → 「导入中弹窗不关」红;
  //          settle 的刷新不调 refresh → 「写完重读本月」红;跳期挪回 runner 里 → 结果卡被收走,「导入完成」红;
  //          @close 换回 importing = false → 「关窗后跳到 2 月」红
  it('❗点导入后弹窗不关;写完重读本月、原地出结果卡;点「知道了」才跳到首段年月(2 月)', async () => {
    let done!: (v: unknown) => void
    vi.mocked(salaryApi.importRows).mockReturnValueOnce(new Promise(r => { done = r }) as never)
    const w = await openImport()
    ;(w.findComponent(FpImportModal).vm as unknown as ModalVm).onSectionsConfirm([{ year: 2025, month: 2, records: [{ name: '王五' }] }])
    await flushPromises()
    expect(salaryApi.importRows).toHaveBeenCalledTimes(1)
    expect(w.find('.fpimp-scrim').exists(), '导入中弹窗不关').toBe(true)
    vi.mocked(salaryApi.records).mockClear()
    done({ imported: 1, skipped: 0, errors: [] })
    await flushPromises()
    expect(vi.mocked(salaryApi.records).mock.calls, '写完重读本月').toEqual([[2025, 3]])
    expect(w.find('.irc h4').text()).toBe('导入完成')
    expect(w.find('.irc-meta').text()).toContain('本页已刷新')

    await w.findAll('.fpimp button').find(b => b.text() === '知道了')!.trigger('click')
    await flushPromises()
    expect(w.find('.fpimp-scrim').exists()).toBe(false)
    expect(vi.mocked(salaryApi.records).mock.calls.at(-1), '关窗后跳到首段那一月').toEqual([2025, 2])
  })

  // 导入中关不掉(D14)不只是 ×/遮罩/Esc:屏自己收写浮层的两条路(编辑态转假、页签停用)也不许把在跑的导入窗收走。
  // 破坏验证:SalaryView 或 useSchedScreen 的 watch(edit) 去掉 importBusy 判断 → 弹窗被收、结果卡出不来 → 红
  it('❗导入中编辑态被收走(接管 / 授权到期):弹窗留着,跑完照样出结果卡', async () => {
    let done!: (v: unknown) => void
    vi.mocked(salaryApi.importRows).mockReturnValueOnce(new Promise(r => { done = r }) as never)
    const w = await openImport()
    ;(w.findComponent(FpImportModal).vm as unknown as ModalVm).onSectionsConfirm([{ year: 2025, month: 3, records: [{ name: '王五' }] }])
    await flushPromises()
    ;(w.vm as unknown as { edit: boolean }).edit = false
    await flushPromises()
    expect(w.find('.fpimp-scrim').exists(), '导入中弹窗不收').toBe(true)
    done({ imported: 1, skipped: 0, errors: [] })
    await flushPromises()
    expect(w.find('.irc h4').text()).toBe('导入完成')
  })

  // 破坏验证:SalaryView 的 onDeactivated 去掉 importBusy 判断 → 回到页签时弹窗没了 → 红
  it('❗导入中页签被停用(浏览器后退):回到本页签,结果卡还在', async () => {
    let done!: (v: unknown) => void
    vi.mocked(salaryApi.importRows).mockReturnValueOnce(new Promise(r => { done = r }) as never)
    const show = ref(true)
    const host = mount(defineComponent({ render: () => h(KeepAlive, null, { default: () => (show.value ? h(SalaryView) : null) }) }),
      { global: { stubs: { Teleport: true } } })
    await flushPromises()
    await host.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    await host.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
    await flushPromises()
    await host.findAll('button').find(b => b.text().includes('导入 Excel'))!.trigger('click')
    await flushPromises()
    ;(host.findComponent(FpImportModal).vm as unknown as ModalVm).onSectionsConfirm([{ year: 2025, month: 3, records: [{ name: '王五' }] }])
    await flushPromises()
    show.value = false   // KeepAlive 停用
    await flushPromises()
    done({ imported: 1, skipped: 0, errors: [] })
    await flushPromises()
    show.value = true
    await flushPromises()
    expect(host.find('.irc h4').exists() && host.find('.irc h4').text()).toBe('导入完成')
    host.unmount()
  })

  // 破坏验证:onImportSections 包回 guard('导入失败', …)(吞错 + 回执)→ 失败卡不出、回执多一条 → 红
  it('❗写失败 → 弹窗里出失败卡(原因照后端原句),不出回执', async () => {
    vi.mocked(salaryApi.importRows).mockRejectedValueOnce({ code: 409, message: '2025-03 工资 已审核,撤销审核后才能修改' })
    const w = await openImport()
    ;(w.findComponent(FpImportModal).vm as unknown as ModalVm).onSectionsConfirm([{ year: 2025, month: 3, records: [{ name: '王五' }] }])
    await flushPromises()
    expect(w.find('.fpimp-scrim').exists()).toBe(true)
    expect(w.text()).toContain('2025-03 工资 已审核,撤销审核后才能修改')
    expect(receipts).toHaveLength(0)
  })
})
