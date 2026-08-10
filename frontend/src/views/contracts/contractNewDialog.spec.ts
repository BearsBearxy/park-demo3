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

// ── S15 §3:面积分类拆分——租赁面积(非宿舍)/宿舍面积两行;提交 rentArea=非宿舍Σ(后端新口径) ──
type W = ReturnType<typeof mountEdit>
const fieldByLab = (w: W, kw: string) =>
  w.findAll('.ct-field').find((f) => f.find('.lab').exists() && f.find('.lab').text().includes(kw))

describe('合同弹窗 · 面积分类(非宿舍/宿舍拆分)', () => {
  const detail: ContractDetailDTO = {
    contract: initial,
    tenant: { companyName: '周兴', contactName: '', contactPhone: '', businessType: '', status: 1 },
    billingLines: [
      { id: 21, contractId: 7, propertyType: 'factory', location: 'E座', feeKey: 'rent_factory', area: 390, unitPrice: 10, billMode: 'per_sqm_month', seq: 0 },
      { id: 22, contractId: 7, propertyType: 'dorm', location: '宿舍楼', feeKey: 'rent_dorm', area: 120, unitPrice: 8, billMode: 'per_sqm_month', seq: 0 },
    ],
    extraUnitIds: [],
  }
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(contractApi.detail).mockResolvedValue(detail)
    vi.mocked(contractApi.update).mockResolvedValue(initial)
  })

  it('两行分类:租赁面积(非宿舍)=Σ非rent_dorm行,宿舍面积=Σrent_dorm行', async () => {
    const w = mountEdit()
    await flushPromises()
    const nonDorm = fieldByLab(w, '租赁面积(非宿舍)')!
    expect((nonDorm.find('input').element as HTMLInputElement).value).toBe('390')
    const dorm = fieldByLab(w, '宿舍面积')!
    expect((dorm.find('input').element as HTMLInputElement).value).toBe('120')
  })

  it('提交 rentArea=非宿舍Σ(宿舍面积不计入);建筑面积提示=非宿舍Σ×0.8', async () => {
    const w = mountEdit()
    await flushPromises()
    const bld = fieldByLab(w, '建筑面积')!
    expect((bld.find('input').element as HTMLInputElement).placeholder).toContain('312')   // 390×0.8
    await w.findAll('.ct-dlg-f button')[1].trigger('click')
    await flushPromises()
    const [, req] = vi.mocked(contractApi.update).mock.calls[0] as [number, ContractCreateReq]
    expect(req.rentArea).toBe(390)
  })

  it('无宿舍行时不出现宿舍面积字段', async () => {
    vi.mocked(contractApi.detail).mockResolvedValue({ ...detail, billingLines: [detail.billingLines[0]] })
    const w = mountEdit()
    await flushPromises()
    expect(fieldByLab(w, '宿舍面积')).toBeUndefined()
    expect((fieldByLab(w, '租赁面积(非宿舍)')!.find('input').element as HTMLInputElement).value).toBe('390')
  })
})

// ── S15 §2:FPUnitPicker 单元多选(首个=主单元)——payload 结构不动:unitId=主,extraUnitIds=其余 ──
describe('合同弹窗 · 单元多选(FPUnitPicker)', () => {
  const withUnit = { ...initial, unitId: 30 } as ContractDTO
  const mountUnit = () => mount(ContractNewDialog, { props: { initial: withUnit }, global: { stubs: { teleport: true } } })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(contractApi.detail).mockResolvedValue({
      contract: withUnit,
      tenant: { companyName: '周兴', contactName: '', contactPhone: '', businessType: '', status: 1 },
      billingLines: [],
      extraUnitIds: [31, 32],
    })
    vi.mocked(contractApi.update).mockResolvedValue(withUnit)
  })

  it('回填 chips 全部可见(候选缺档也出「未知单元」chip——隐形id炸弹回归)', async () => {
    const w = mountUnit()
    await flushPromises()
    const chips = w.findAll('.fp-up-chip')
    expect(chips.length).toBe(3)
    expect(chips[0].classes()).toContain('main')       // 首个=主单元
    expect(chips[0].classes()).toContain('missing')    // 候选空(buildingApi mock 无单元)仍可见
  })

  it('提交回带 unitId=主 / extraUnitIds=其余,缺档 id 不丢', async () => {
    const w = mountUnit()
    await flushPromises()
    await w.findAll('.ct-dlg-f button')[1].trigger('click')
    await flushPromises()
    const [, req] = vi.mocked(contractApi.update).mock.calls[0] as [number, ContractCreateReq]
    expect(req.unitId).toBe(30)
    expect(req.extraUnitIds).toEqual([31, 32])
  })

  it('chip 星标换主:☆点击后该单元升主,提交 unitId 随之切换', async () => {
    const w = mountUnit()
    await flushPromises()
    await w.findAll('.fp-up-chip .star')[1].trigger('click')
    await w.findAll('.ct-dlg-f button')[1].trigger('click')
    await flushPromises()
    const [, req] = vi.mocked(contractApi.update).mock.calls[0] as [number, ContractCreateReq]
    expect(req.unitId).toBe(31)
    expect(req.extraUnitIds).toEqual([30, 32])
  })
})
