// src/views/__tests__/contractsDeepLink.spec.ts — 合同屏 ?contractNo=(到期墙「临期 90 天」点行,SIDEBAR-UX-REDESIGN §4.2 · P0c)。
// 合同没有期维度,不接 useDeepPeriod;这里钉的是同一套口径:首载预填搜索框、切回按 fullPath 去重再读、没 query 不重置。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRoute: () => ({ query, get fullPath() { return '/contracts?' + new URLSearchParams(query).toString() } }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))
vi.mock('@/api/contract', () => ({
  contractApi: { list: vi.fn(), summary: vi.fn(), detail: vi.fn(() => Promise.resolve(null)) },
}))

import ContractsView from '@/views/contracts/ContractsView.vue'
import { contractApi } from '@/api/contract'

type Vm = { q: string }
const OPTS = { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } } }

/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(ContractsView) : null) }),
  }), OPTS)
  await flushPromises()
  return { alive, vm: () => w.findComponent(ContractsView).vm as unknown as Vm }
}

describe('合同屏 · 合同号深链', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    for (const k of Object.keys(query)) delete query[k]
    vi.mocked(contractApi.list).mockResolvedValue([] as never)
    vi.mocked(contractApi.summary).mockResolvedValue({ total: 0, active: 0, expiring: 0, terminated: 0 } as never)
  })

  it('?contractNo=HT-2025-001 → 搜索框预填该合同号', async () => {
    query.contractNo = 'HT-2025-001'
    const { vm } = await keptAlive()
    expect(vm().q).toBe('HT-2025-001')
  })

  it('切回时地址栏没有合同号 → 不重置用户改过的搜索;列表照常重拉', async () => {
    query.contractNo = 'HT-2025-001'
    const { alive, vm } = await keptAlive()
    vm().q = '创显'
    alive.value = false; await flushPromises()
    delete query.contractNo
    alive.value = true; await flushPromises()
    expect(vm().q).toBe('创显')
    expect(contractApi.list).toHaveBeenCalledTimes(2)
  })

  it('❗切回时地址栏换了合同号 → 跟着换(到期墙点了第二行)', async () => {
    query.contractNo = 'HT-2025-001'
    const { alive, vm } = await keptAlive()
    alive.value = false; await flushPromises()
    query.contractNo = 'HT-2025-002'
    alive.value = true; await flushPromises()
    expect(vm().q).toBe('HT-2025-002')
  })

  it('同一地址切回不重复覆盖:用户清空了搜索,切回还是空', async () => {
    query.contractNo = 'HT-2025-001'
    const { alive, vm } = await keptAlive()
    vm().q = ''
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(vm().q).toBe('')
  })
})
