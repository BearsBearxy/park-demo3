/* Copyright (c) 2026 Junyang. All rights reserved. */
// 附表11 电费的软件内确认与回执(S4 T25,画布 02-B 右 / 02-C):原生 window.confirm / alert → ask / receipt.fail。
// 导入中心那半(台账覆盖 / 月份不一致两问、失败卡、没权限的空格子)2026-10-10 改稿后不在这里了:
// 两问并进导入弹窗的核对页(T7 删掉 confirm 这条路),失败与只读态见 views/import-center/__tests__/importCenter.spec.ts。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'
import type { LedgerMonthDTO } from '@/types/ledger'

const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, meta: {}, get fullPath() { return '/x?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/importLog', () => ({ importLogApi: { record: vi.fn() } }))
vi.mock('@/api/ledger', () => ({ companyApi: { list: vi.fn() }, ledgerApi: { month: vi.fn(), preview: vi.fn().mockRejectedValue(new Error('not stubbed')) } }))
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
  // 目标月已有两家:文件里有其中一家 → 覆盖 1 家
  vi.mocked(ledgerApi.month).mockResolvedValue({
    rows: [{ tenantName: '甲科技' }, { tenantName: '乙物流' }],
  } as unknown as LedgerMonthDTO)
  vi.mocked(runImport).mockResolvedValue({ res: { imported: 2, skipped: 0, errors: [] }, logIds: [] })
  vi.mocked(elecApi.phases).mockResolvedValue([] as never)
  vi.mocked(elecApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(elecApi.records).mockReturnValue(NEVER())
})
afterEach(() => {
  while (askQueue.length) answer(false)
  while (mounted.length) mounted.pop()!.unmount()
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
