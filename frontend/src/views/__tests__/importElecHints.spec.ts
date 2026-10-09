// 导入中心 / 附表11 电费的软件内确认与回执(S4 T25,画布 02-B 左 / 02-B 右 / 02-C):
// 原生 window.confirm / alert → ask / receipt.fail;没有导入权限的空格子 → FPEmpty。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'
import type { ImportCtx } from '@/utils/importRegistry'
import type { LedgerMonthDTO } from '@/types/ledger'

const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, meta: {}, get fullPath() { return '/x?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/importLog', () => ({ importLogApi: { overview: vi.fn(), record: vi.fn() } }))
vi.mock('@/api/ledger', () => ({ companyApi: { list: vi.fn() }, ledgerApi: { month: vi.fn() } }))
vi.mock('@/api/books', () => ({ booksApi: { list: vi.fn() } }))
vi.mock('@/api/charging', () => ({ chargingApi: { cats: vi.fn() } }))
vi.mock('@/utils/importRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/importRegistry')>()),
  runImport: vi.fn(),
}))
vi.mock('@/api/elec', () => ({ elecApi: { phases: vi.fn(), overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() } }))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

import ImportCenterView from '@/views/import-center/ImportCenterView.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ElecView from '@/views/elec/ElecView.vue'
import { importLogApi } from '@/api/importLog'
import { ledgerApi } from '@/api/ledger'
import { runImport } from '@/utils/importRegistry'
import { elecApi } from '@/api/elec'

const NEVER = () => new Promise(() => {}) as never
const mounted: VueWrapper[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  for (const k of Object.keys(query)) delete query[k]
  askQueue.splice(0)
  receipts.splice(0)
  useAuthStore().permissions = ['elec-cost:edit']
  vi.mocked(importLogApi.overview).mockResolvedValue({ latestByType: [], history: [] })
  // 目标月已有两家:文件里有其中一家 → 覆盖 1 家
  vi.mocked(ledgerApi.month).mockResolvedValue({
    rows: [{ tenantName: '甲科技' }, { tenantName: '乙物流' }],
  } as unknown as LedgerMonthDTO)
  vi.mocked(runImport).mockResolvedValue({ imported: 2, skipped: 0, errors: [] })
  vi.mocked(elecApi.phases).mockResolvedValue([] as never)
  vi.mocked(elecApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(elecApi.records).mockReturnValue(NEVER())
})
afterEach(() => {
  while (askQueue.length) answer(false)
  while (mounted.length) mounted.pop()!.unmount()
})

interface ImVm {
  activeKey: string | null
  ctx: ImportCtx
  importing: boolean
}
// 2026-10-03 起导入走弹窗自己的「点导入」:开跑前的两问是弹窗 confirm,失败在弹窗原地出失败卡(UI-OVERLAY-SPEC §8)
async function openImport() {
  const w = mount(ImportCenterView, { global: { stubs: { Teleport: true } } })
  mounted.push(w)
  await flushPromises()
  const vm = w.vm as unknown as ImVm
  vm.activeKey = 'ledger'
  vm.ctx = { companyId: 9, companyName: '甲公司', year: 2025, month: 6 }
  vm.importing = true
  await flushPromises()
  const modal = w.findComponent(FpImportModal).vm as unknown as { start: (p: unknown[], f: string) => Promise<void> }
  return { w, vm, start: modal.start }
}
const RECS = [{ tenantName: '甲科技', rent: 100 }, { tenantName: '丁新户', rent: 50 }]

describe('导入中心', () => {
  it('❗台账目标月已有数据:导入前问「会覆盖」(02-B 左),取消就不导', async () => {
    const { start } = await openImport()
    const p = start(RECS, '台账.xlsx')
    await flushPromises()
    expect(askQueue[0]).toMatchObject({
      title: '导入会覆盖 2025 年 6 月 1 家租户的台账', body: '这 1 家已有台账数据,文件里提供的列会被覆盖。', action: '仍要导入',
    })
    answer(false)
    await p
    expect(runImport).not.toHaveBeenCalled()
  })

  it('❗文件标题的年月和目标不一致:先问,取消就不导', async () => {
    const { start } = await openImport()
    const p = start([{ ...RECS[0], __ymDetected: { year: 2025, month: 5 } }], '台账五月.xlsx')
    await flushPromises()
    expect(askQueue[0]?.title).toBe('仍导入到 2025 年 6 月？')
    expect(askQueue[0]?.body).toContain('文件标题识别为 2025 年 5 月')
    answer(false)
    await p
    expect(runImport).not.toHaveBeenCalled()
    expect(ledgerApi.month, '第一问就退了,不去做覆盖预检').not.toHaveBeenCalled()
  })

  it('❗导入失败:弹窗原地出失败卡写原因,不弹浏览器框,也不再另出底部回执', async () => {
    vi.mocked(runImport).mockRejectedValueOnce(new Error('模板列对不上:缺「租户」'))
    const { w, start } = await openImport()
    const p = start(RECS, '台账.xlsx')
    await flushPromises()
    answer(true)
    await p
    await flushPromises()
    expect(w.find('.ipf-h h4').text()).toBe('导入失败，这次一条都没写进去')
    expect(w.find('.ipf-box').text()).toContain('模板列对不上:缺「租户」')
    expect(receipts).toHaveLength(0)
  })

  it('❗没有任何导入权限:格子那块是 FPEmpty', async () => {
    useAuthStore().permissions = []
    const w = mount(ImportCenterView, { global: { stubs: { Teleport: true } } })
    mounted.push(w)
    await flushPromises()
    expect(w.find('.fp-empty').text()).toContain('当前账号没有任何导入权限')
    expect(w.find('.im-grid').exists()).toBe(false)
  })
})

describe('附表11 电费 · 清空本年导入', () => {
  it('❗清空前用软件内确认(删除类 danger);取消不清,确认才清', async () => {
    query.p = '2025'
    const w = mount(ElecView, { global: { stubs: { Teleport: true } } })
    mounted.push(w)
    await flushPromises()
    const vm = w.vm as unknown as { edit: boolean; onClearImported: () => Promise<void> }
    vm.edit = true
    await flushPromises()
    void vm.onClearImported()
    await flushPromises()
    expect(askQueue[0]).toMatchObject({ title: '清空本年的全部导入数据？', action: '清空本年导入', danger: true })
    answer(false)
    await flushPromises()
    expect(elecApi.clearImported).not.toHaveBeenCalled()

    void vm.onClearImported()
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(elecApi.clearImported).toHaveBeenCalledWith(2025)
  })
})
