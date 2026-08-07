import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { ContractDTO, ContractCreateReq, ContractDetailDTO } from '@/types/contract'

// CONTRACT-CARD-V2-SPEC §6:期限原文三件套(termText/termType/tierPriceNote)在编辑弹窗可录可存。
// 原文留档为参考,不参与计费(§1),此处只验「回填 → 提交」链路不丢字段。

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

describe('合同弹窗 · 期限原文三件套(V2-SPEC §6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()   // 调用记录逐用例归零(实现保留),否则 calls[0] 会串到上一用例
    vi.mocked(contractApi.detail).mockResolvedValue({
      contract: initial,
      tenant: { companyName: '周兴', contactName: '', contactPhone: '', businessType: '', status: 1 },
      billingLines: [],
      extraUnitIds: [],
    })
    vi.mocked(contractApi.update).mockResolvedValue(initial)
  })

  it('编辑态回填期限原文/类型/阶梯价原文', async () => {
    const w = mountEdit()
    await flushPromises()
    expect((w.find('textarea.ct-in').element as HTMLTextAreaElement).value)
      .toBe('自2023年8月10日起至2026年8月9日止')
  })

  it('提交带上期限原文三字段(termText/termType/tierPriceNote)', async () => {
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
  })
})

// 空地 infra 条件项(2026-08-07 旭化成消防通道 179.70㎡×1.80=323.46):per_sqm 形态填面积×单价;
// 存坏行(月额进 override 而 billMode=per_sqm→月额0)回读标「待定」,补齐面积×单价保存即清 override。
describe('合同弹窗 · per_sqm 条件项(空地基础设施维护费)', () => {
  const detail: ContractDetailDTO = {
    contract: initial,
    tenant: { companyName: '周兴', contactName: '', contactPhone: '', businessType: '', status: 1 },
    billingLines: [
      { id: 11, contractId: 7, propertyType: 'land', location: '消防通道', feeKey: 'rent_land', area: 179.7, unitPrice: 3, billMode: 'per_sqm_month', seq: 0 },
      { id: 12, contractId: 7, propertyType: 'land', location: '消防通道', feeKey: 'infra', amountOverride: 323.46, billMode: 'per_sqm_month', seq: 1 },
    ],
    extraUnitIds: [],
  }
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(contractApi.detail).mockResolvedValue(detail)
    vi.mocked(contractApi.update).mockResolvedValue(initial)
  })

  it('存坏行回读:勾选态+面积/单价两输入(非单月额),override 值标「待定」', async () => {
    const w = mountEdit()
    await flushPromises()
    const cond = w.find('.ct-bl-cond')   // land 条件项仅 infra,首个即是
    expect((cond.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
    expect(cond.findAll('input[type="number"]').length).toBe(2)
    expect(cond.find('.ct-bl-mo').text()).toBe('323.46 待定')
  })

  it('补面积×单价保存:月额实时=面积×单价,序列化 per_sqm 且清掉 override', async () => {
    const w = mountEdit()
    await flushPromises()
    const nums = w.find('.ct-bl-cond').findAll('input[type="number"]')
    await nums[0].setValue(179.7)
    await nums[1].setValue(1.8)
    expect(w.find('.ct-bl-cond .ct-bl-mo').text()).toBe('323.46')
    await w.findAll('.ct-dlg-f button')[1].trigger('click')
    await flushPromises()
    const [, req] = vi.mocked(contractApi.update).mock.calls[0] as [number, ContractCreateReq]
    const infra = req.billingLines!.find(l => l.feeKey === 'infra')!
    expect(infra.billMode).toBe('per_sqm_month')
    expect(infra.area).toBe(179.7)
    expect(infra.unitPrice).toBe(1.8)
    expect(infra.amountOverride).toBeNull()
  })

  it('重勾 infra 条件项:面积预填=该段租金行面积', async () => {
    const w = mountEdit()
    await flushPromises()
    const chk = w.find('.ct-bl-cond input[type="checkbox"]')
    await chk.setValue(false)
    await chk.setValue(true)
    const area = w.find('.ct-bl-cond').findAll('input[type="number"]')[0]
    expect((area.element as HTMLInputElement).value).toBe('179.7')
  })
})
