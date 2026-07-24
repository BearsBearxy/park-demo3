import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { ContractDTO, ContractCreateReq } from '@/types/contract'

// CONTRACT-CARD-V2-SPEC §6:期限原文三件套 + 租金阶梯段在编辑弹窗可录可存。
// 阶梯=参考排程,不参与计费(§1),此处只验「回填 → 提交」链路不丢字段。

vi.mock('@/api/contract', () => ({
  contractApi: { detail: vi.fn(), update: vi.fn(), create: vi.fn() },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: vi.fn(async () => []) } }))
vi.mock('@/api/building', () => ({
  buildingApi: { list: vi.fn(async () => []), detail: vi.fn(async () => ({ units: [] })) },
}))

import ContractNewDialog from './ContractNewDialog.vue'
import { contractApi } from '@/api/contract'

const initial = {
  id: 7, contractNo: 'S10-0074',
  tenantId: 1, tenantName: '周兴', buildingId: 2, buildingName: 'E座', unitId: null, floorInfo: '',
  rentArea: 390, monthlyRent: 5570, deposit: 0,
  startDate: '2023-08-10', endDate: '2026-08-09', signDate: null,
  termText: '自2023年8月10日起至2026年8月9日止', termType: 'explicit', tierPriceNote: '首年12.231,次年起14.282',
  status: 'active', termMonths: 36, daysToEnd: 100, remark: null,
} as ContractDTO

function mountEdit() {
  return mount(ContractNewDialog, {
    props: { initial },
    global: { stubs: { teleport: true } },
  })
}

describe('合同弹窗 · 期限原文三件套 + 阶梯段(V2-SPEC §6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()   // 调用记录逐用例归零(实现保留),否则 calls[0] 会串到上一用例
    vi.mocked(contractApi.detail).mockResolvedValue({
      contract: initial,
      tenant: { companyName: '周兴', contactName: '', contactPhone: '', businessType: '', status: 1 },
      billingLines: [],
      rentTiers: [
        { id: 11, contractId: 7, seq: 1, startDate: '2023-08-10', endDate: '2024-08-09', unitPrice: 12.231, monthlyAmount: 4770 },
        { id: 12, contractId: 7, seq: 2, startDate: '2024-08-10', endDate: '2026-08-09', unitPrice: 14.282, monthlyAmount: 5570 },
      ],
    })
    vi.mocked(contractApi.update).mockResolvedValue(initial)
  })

  it('编辑态回填期限原文/类型/阶梯价原文与阶梯段', async () => {
    const w = mountEdit()
    await flushPromises()
    expect((w.find('textarea.ct-in').element as HTMLTextAreaElement).value)
      .toBe('自2023年8月10日起至2026年8月9日止')
    expect(w.findAll('.ct-tier-row')).toHaveLength(2)
  })

  it('提交带上四字段(termText/termType/tierPriceNote/rentTiers)', async () => {
    const w = mountEdit()
    await flushPromises()
    await w.findAll('.ct-dlg-f button')[1].trigger('click')
    await flushPromises()

    expect(contractApi.update).toHaveBeenCalledTimes(1)
    const [id, req] = vi.mocked(contractApi.update).mock.calls[0] as [number, ContractCreateReq]
    expect(id).toBe(7)
    expect(req.termText).toBe('自2023年8月10日起至2026年8月9日止')
    expect(req.termType).toBe('explicit')
    expect(req.tierPriceNote).toBe('首年12.231,次年起14.282')
    expect(req.rentTiers).toHaveLength(2)
    expect(req.rentTiers![1]).toMatchObject({ seq: 2, startDate: '2024-08-10', unitPrice: 14.282 })
  })

  it('可增删阶梯段,删空后提交为空列表(整组清空)', async () => {
    const w = mountEdit()
    await flushPromises()
    await w.find('.ct-tier-add').trigger('click')
    expect(w.findAll('.ct-tier-row')).toHaveLength(3)
    // 逐次删首档(每删一次索引重排,不能拿旧快照批量点)
    while (w.findAll('.ct-tier-row').length) await w.find('.ct-tier-row .ct-rf-del').trigger('click')
    expect(w.findAll('.ct-tier-row')).toHaveLength(0)

    await w.findAll('.ct-dlg-f button')[1].trigger('click')
    await flushPromises()
    const req = vi.mocked(contractApi.update).mock.calls[0][1]
    expect(req.rentTiers).toEqual([])
  })
})
