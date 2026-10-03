import { mount, enableAutoUnmount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import type { BillingLineDTO, ContractDTO, ContractCreateReq, ContractDetailDTO, ContractRenewReq } from '@/types/contract'

// CONTRACT-CARD-V2-SPEC §6:期限原文三件套(termText/termType/tierPriceNote)在编辑弹窗可录可存。
// 原文留档为参考,不参与计费(§1),此处只验「回填 → 提交」链路不丢字段。

vi.mock('@/api/contract', () => ({
  contractApi: { detail: vi.fn(), update: vi.fn(), create: vi.fn(), renew: vi.fn() },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: vi.fn(async () => []) } }))
vi.mock('@/api/building', () => ({
  buildingApi: { list: vi.fn(async () => []), detail: vi.fn(async () => ({ units: [] })) },
}))

import ContractNewDialog from './ContractNewDialog.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import FPUnitPicker from '@/components/fp/FPUnitPicker.vue'
import { contractApi } from '@/api/contract'
import { tenantApi } from '@/api/tenant'
import { askQueue, answer } from '@/utils/ask'

// 弹窗填过东西会登记进 auth.editors(TAB-BAR-SPEC §2),要有 Pinia
beforeEach(() => setActivePinia(createPinia()))
// 弹窗在 window 上听 Esc:上一条用例没卸掉的弹窗会接着听,有改动的还会各问一遍 —— 每条用例后统一卸
enableAutoUnmount(afterEach)

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

  it('❗填过东西 = 在编辑:登记进 auth.editors(页签条不换掉这一格、关浏览器先问);关弹窗就撤', async () => {
    const w = mountEdit()
    await flushPromises()
    const auth = useAuthStore()
    const end = vi.spyOn(auth, 'endElevation').mockResolvedValue()
    expect(auth.editing).toBe(false)
    await w.find('textarea.ct-in').setValue('改一下期限原文')
    expect(auth.editing).toBe(true)
    w.unmount()
    expect(auth.editing).toBe(false)
    expect(end, '撤登记顺带结束授权(最后一个编辑态时)').toHaveBeenCalled()
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

// 日期字段 2026-09-19 由原生日期框换成 ds/DatePicker(DATE-PICKER-SPEC §5 第 1 节)。
describe('合同弹窗 · 日期字段', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(contractApi.detail).mockResolvedValue({
      contract: initial,
      tenant: { companyName: '周兴', contactName: '', contactPhone: '', businessType: '', status: 1 },
      billingLines: [],
      extraUnitIds: [],
    })
    vi.mocked(contractApi.update).mockResolvedValue(initial)
  })
  const pickerOf = (w: ReturnType<typeof mountEdit>, label: string) =>
    w.findAllComponents({ name: 'DatePicker' }).find((c) => c.props('ariaLabel') === label)!

  it('❗免租期起止合成一个区间字段:下限 = 合同开始日、上限 = 结束日,选完两头一起进提交', async () => {
    const w = mountEdit()
    await flushPromises()
    await w.findAll('button').find((b) => b.text().includes('添加免租期'))!.trigger('click')
    const rf = pickerOf(w, '免租期起止')
    expect(rf.props('mode')).toBe('range')
    expect([rf.props('min'), rf.props('max')]).toEqual(['2023-08-10', '2026-08-09'])
    rf.vm.$emit('update:modelValue', ['2023-08-10', '2023-10-31'])
    await flushPromises()
    await w.findAll('.ct-dlg-f button')[1].trigger('click')
    await flushPromises()
    const [, req] = vi.mocked(contractApi.update).mock.calls[0] as [number, ContractCreateReq]
    expect(req.rentFree).toEqual([{ start: '2023-08-10', end: '2023-10-31' }])
  })

  it('❗合同起止倒着填(开始晚于结束)时免租期不设上下限:不然 42 格全灰、打字全红,又没有提示', async () => {
    const w = mountEdit()
    await flushPromises()
    pickerOf(w, '开始日期').vm.$emit('update:modelValue', '2026-10-01')
    pickerOf(w, '结束日期').vm.$emit('update:modelValue', '2026-09-01')
    await w.findAll('button').find((b) => b.text().includes('添加免租期'))!.trigger('click')
    const rf = () => pickerOf(w, '免租期起止')
    expect([rf().props('min'), rf().props('max')]).toEqual([undefined, undefined])
    pickerOf(w, '结束日期').vm.$emit('update:modelValue', '2026-12-31')
    await flushPromises()
    expect([rf().props('min'), rf().props('max')], '起止正常后照旧收在合同期内').toEqual(['2026-10-01', '2026-12-31'])
    w.unmount()
  })

  it('❗点格子选日期也算「在编辑」(格子是按钮,收不进弹窗的 @input.capture),选的值进提交', async () => {
    const w = mountEdit()
    await flushPromises()
    const auth = useAuthStore()
    expect(auth.editing).toBe(false)
    pickerOf(w, '签订日期').vm.$emit('update:modelValue', '2023-07-30')
    await flushPromises()
    expect(auth.editing, '选了日期却没登记在编辑').toBe(true)
    await w.findAll('.ct-dlg-f button')[1].trigger('click')
    await flushPromises()
    const [, req] = vi.mocked(contractApi.update).mock.calls[0] as [number, ContractCreateReq]
    expect(req.signDate).toBe('2023-07-30')
    expect([req.startDate, req.endDate]).toEqual(['2023-08-10', '2026-08-09'])
    w.unmount()
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

// 续签对话框二选一(ESCALATION-SPLIT-SPEC §1 link_type):续签换约 / 递增段,默认续签;选的值进请求体。
describe('合同弹窗 · 续签时选续签或递增', () => {
  const from = { ...initial, id: 9, contractNo: 'S10-0204' } as ContractDTO
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(contractApi.renew).mockResolvedValue(from)
  })
  const mountRenew = () => mount(ContractNewDialog, {
    props: { renewFrom: from },
    global: { stubs: { teleport: true } },
  })
  async function submitWithNo(w: ReturnType<typeof mountRenew>) {
    await w.find('input.ct-in').setValue('S10-0204#2')
    await w.findAll('.ct-dlg-f button')[1].trigger('click')
    await flushPromises()
    return vi.mocked(contractApi.renew).mock.calls[0] as [number, ContractRenewReq]
  }

  it('两个选项,默认选中续签;不动它提交 linkType=renew', async () => {
    const w = mountRenew()
    await flushPromises()
    const opts = w.findAll('.ct-link')
    expect(opts.map((o) => o.text())).toEqual(['续签（换新约）', '递增（同一份合同到年限涨价）'])
    expect(opts.map((o) => (o.find('input').element as HTMLInputElement).checked)).toEqual([true, false])
    const [id, req] = await submitWithNo(w)
    expect(id).toBe(9)
    expect(req.linkType).toBe('renew')
  })

  it('选递增:请求体 linkType=escalation,其余字段照旧', async () => {
    const w = mountRenew()
    await flushPromises()
    await w.findAll('.ct-link input')[1].setValue()
    const [, req] = await submitWithNo(w)
    expect(req.linkType).toBe('escalation')
    expect(req.contractNo).toBe('S10-0204#2')
    expect(req.monthlyRent).toBe(5570)
  })

  // 对抗复查 F3/F6:选了递增,标题、说明、按钮都不能再说「续签」;整户跳过要在选的地方说;单选组要有名字
  // 破坏验证:把标题/按钮的三元去掉、删掉 ct-link-note、删掉 aria-labelledby → 各自那行红
  it('选递增:标题/按钮换成递增,说明不说「提交后原合同标已续签」,选项下写明整户跳过导入', async () => {
    const w = mountRenew()
    await flushPromises()
    const head = () => w.find('.ct-dlg-h').text()
    const btn = () => w.findAll('.ct-dlg-f button')[1].text()
    expect(head()).toContain('续签合同')
    expect(btn()).toBe('续签')
    expect(w.find('.ct-link-note').exists()).toBe(false)
    await w.findAll('.ct-link input')[1].setValue()
    expect(head()).toContain('合同递增')
    expect(head()).not.toContain('续签合同')
    expect(head()).toContain('不算续签')
    expect(head()).toContain('新一期起租日不晚于今天的,原合同标记为已递增;晚于今天的,原合同照常在租')
    expect(head()).not.toContain('已续签')
    expect(head()).not.toContain('提交后原合同将标记为已续签')
    expect(btn()).toBe('递增')
    expect(w.find('.ct-link-note').text()).toBe('选递增后，这户再导合同汇总册会整户跳过，这户别的合同也不再被导入更新。')
    const g = w.find('[role=radiogroup]')
    const lab = w.find('#' + g.attributes('aria-labelledby'))
    expect(lab.text()).toBe('这一期记成')
  })

  it('编辑态没有这两个选项', async () => {
    vi.mocked(contractApi.detail).mockResolvedValue({
      contract: initial,
      tenant: { companyName: '周兴', contactName: '', contactPhone: '', businessType: '', status: 1 },
      billingLines: [],
      extraUnitIds: [],
    })
    const w = mountEdit()
    await flushPromises()
    expect(w.findAll('.ct-link')).toHaveLength(0)
  })
})

// 关闭(画布 02-A 离开确认):遮罩误点 / Esc 有改动先问,0 处直接关;改动数 = 碰过几个字段(同一字段改几遍算一处),
// 同一个数登记进 auth.editors(页签橙点、关页签、关浏览器都读它)
describe('合同弹窗 · 关闭走离开确认 + 改动数', () => {
  const DETAIL = {
    contract: initial,
    tenant: { companyName: '周兴', contactName: '', contactPhone: '', businessType: '', status: 1 },
    billingLines: [],
    extraUnitIds: [],
  }
  beforeEach(() => {
    vi.clearAllMocks()
    askQueue.splice(0)
    vi.mocked(contractApi.detail).mockResolvedValue(DETAIL as ContractDetailDTO)
    vi.mocked(contractApi.update).mockResolvedValue(initial)
  })
  const pickerOf = (w: ReturnType<typeof mountEdit>, label: string) =>
    w.findAllComponents({ name: 'DatePicker' }).find((c) => c.props('ariaLabel') === label)!

  // 破坏验证:tryClose 不走 askLeave、直接 emit close → 红;askLeave 的 count 传死 1 → 「2 处」红;
  //           onNative 不按字段记(每次事件都 touch(Symbol()))→ 同一字段改两遍变 3 处 → 红
  it('❗有改动点遮罩:问「关闭「编辑合同」？」并写改动数;继续编辑不关,放弃改动才关', async () => {
    const w = mountEdit()
    await flushPromises()
    await w.find('textarea.ct-in').setValue('改一下期限原文')
    await w.find('textarea.ct-in').setValue('又改一下')          // 同一个字段:还是一处
    pickerOf(w, '签订日期').vm.$emit('update:modelValue', '2023-07-30')
    await flushPromises()
    expect(useAuthStore().dirtyTotal, '登记进 editors 的就是这个数').toBe(2)
    await w.find('.ct-mask').trigger('mousedown')
    expect(askQueue).toHaveLength(1)
    expect(askQueue[0]).toMatchObject({ title: '关闭「编辑合同」？', body: '这页有 2 处改动还没保存。', cancel: '继续编辑', danger: true })
    answer(false)
    await flushPromises()
    expect(w.emitted('close'), '点「继续编辑」不许关').toBeUndefined()
    await w.find('.ct-mask').trigger('mousedown')
    answer(true)
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  // 破坏验证:askLeave 的 count<=0 放行被改成照样问 → askQueue 有一条 → 红
  it('❗没碰过任何字段:点遮罩直接关,不问', async () => {
    const w = mountEdit()
    await flushPromises()
    await w.find('.ct-mask').trigger('mousedown')
    await flushPromises()
    expect(askQueue).toHaveLength(0)
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  // 破坏验证:onKey 改回直接 emit('close') → 有改动按 Esc 也直接关 → 红
  it('❗有改动按 Esc 也先问', async () => {
    const w = mountEdit()
    await flushPromises()
    await w.find('textarea.ct-in').setValue('改一下')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(askQueue).toHaveLength(1)
    expect(w.emitted('close')).toBeUndefined()
    answer(true)
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  // 加载失败(十件 ⑦):换掉整张表单,带重试;重试成功才回到表单。保存钮失败时点不动
  // 新增态:没有计费明细要等,保存钮点不动只能是失败态挡的
  // 破坏验证:load 的 catch 不设 loadErr → 没有失败态 → 红;FPLoadError 的 @retry 不接 load → 重试后还在失败态 → 红;
  //           保存钮的 :disabled 去掉 !!loadErr → 红
  it('❗租户/楼栋清单没读到:表单换成「没读到 + 重试」,保存点不动;重试成功回到表单', async () => {
    vi.mocked(tenantApi.list).mockRejectedValueOnce(new Error('503'))
    const w = mount(ContractNewDialog, { global: { stubs: { teleport: true } } })
    await flushPromises()
    const err = w.find('.ct-dlg-b .fp-empty.error')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('租户和楼栋清单没读到')
    expect(w.find('.ct-grid').exists(), '失败态和表单互斥').toBe(false)
    expect(w.findAll('.ct-dlg-f button')[1].attributes('disabled'), '失败态下保存点不动').toBeDefined()
    await err.find('button').trigger('click')
    await flushPromises()
    expect(w.find('.fp-empty').exists()).toBe(false)
    expect(w.find('.ct-grid').exists()).toBe(true)
    expect(w.findAll('.ct-dlg-f button')[1].attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  // 详情两趟叠着发(首载 + 重试 / 再开)只认后发的那趟:先发的晚到,旧计费行不盖新的,失败不冒失败件、保存照常能点。
  // 破坏验证:load 里详情回来后的 `if (my !== loadSeq) return` 删掉 → 段位置被旧数盖成「旧位置」→ 红;
  //           详情 catch 的 `my === loadSeq` 判断删掉 → 冒失败件、保存点不动 → 红
  it('❗计费明细先发的晚到:旧明细不盖新明细,失败不冒失败件,保存照常能点', async () => {
    const line = (location: string): BillingLineDTO =>
      ({ id: 31, contractId: 7, propertyType: 'factory', location, feeKey: 'rent_factory', area: 390, unitPrice: 14.282, seq: 1 })
    let lateOk!: (d: ContractDetailDTO) => void, lateFail!: (e: Error) => void
    vi.mocked(contractApi.detail)
      .mockImplementationOnce(() => new Promise((_, rej) => { lateFail = rej }))
      .mockImplementationOnce(() => new Promise((res) => { lateOk = res }))
      .mockResolvedValueOnce({ ...DETAIL, billingLines: [line('新位置')] } as ContractDetailDTO)
    const w = mountEdit()
    await flushPromises()                     // 第一趟:清单到了,详情挂住
    const vm = w.vm as unknown as { load: () => Promise<void> }
    void vm.load(); await flushPromises()     // 第二趟:详情挂住
    await vm.load(); await flushPromises()    // 第三趟:详情到
    const loc = () => (w.find('.ct-bl-loc').element as HTMLInputElement).value
    expect(loc()).toBe('新位置')
    lateOk({ ...DETAIL, billingLines: [line('旧位置')] } as ContractDetailDTO)
    await flushPromises()
    expect(loc(), '先发的旧明细盖了上来').toBe('新位置')
    lateFail(new Error('timeout'))
    await flushPromises()
    expect(w.find('.fp-empty.error').exists(), '先发的失败冒了出来').toBe(false)
    expect(w.findAll('.ct-dlg-f button')[1].attributes('disabled'), '保存照常能点').toBeUndefined()
    w.unmount()
  })

  // 破坏验证:detail 的 catch 不设 loadErr('detail') → 表单照出、只是没有计费行 → 红
  it('❗计费明细没读到:同样换掉表单(这时保存会清空计费行),重试成功才放行保存', async () => {
    vi.mocked(contractApi.detail).mockRejectedValueOnce(new Error('timeout'))
    const w = mountEdit()
    await flushPromises()
    expect(w.find('.fp-empty.error').text()).toContain('这份合同的计费明细没读到')
    expect(w.findAll('.ct-dlg-f button')[1].attributes('disabled')).toBeDefined()
    await w.find('.fp-empty.error button').trigger('click')
    await flushPromises()
    expect(w.find('.ct-grid').exists()).toBe(true)
    expect((w.find('textarea.ct-in').element as HTMLTextAreaElement).value, '重试后照常回填').toBe(initial.termText)
    expect(w.findAll('.ct-dlg-f button')[1].attributes('disabled')).toBeUndefined()
    w.unmount()
  })
})

// 改动数的另几条来源:不是原生输入框的那几处(选租户 / 选单元 / 段上的单元 chip / 加删段 / 删遗留行 / 加删免租期)。
// 以前点遮罩直接丢录入的正是这几条 —— 每条只做那一步,改动数就得是 1,点遮罩问「1 处」。
// 破坏验证:逐一删掉对应函数里的 touch(…) → 那一条红(选租户 touch('tenant') / onUnitSelChange touch('units') /
//           toggleSegUnit touch(seg.unitIds) / addSegment / removeSegment / removeRow / addRentFreeRow / removeRentFreeRow)
describe('合同弹窗 · 改动数:非原生控件那几条路', () => {
  type TipEl = HTMLElement & { _tip?: { text: string } }
  const delBtn = (w: ReturnType<typeof mount>, tip: string) =>
    w.findAll('.ct-rf-del').find(b => (b.element as TipEl)._tip?.text === tip)!
  const EDIT_INIT = { ...initial, unitId: 11, rentFree: [{ start: '2023-08-10', end: '2023-09-09', note: '装修期' }] } as ContractDTO
  const LINES: BillingLineDTO[] = [
    { id: 31, contractId: 7, propertyType: 'factory', location: 'E座', feeKey: 'rent_factory', area: 390, unitPrice: 14.282, seq: 1 },
    // 段内 other = 存量导入的遗留费项(可见可删)
    { id: 32, contractId: 7, propertyType: 'factory', location: 'E座', feeKey: 'other', amountOverride: 120, seq: 2 },
  ]
  beforeEach(() => {
    vi.clearAllMocks()
    askQueue.splice(0)
    vi.mocked(contractApi.detail).mockResolvedValue({
      contract: EDIT_INIT,
      tenant: { companyName: '周兴', contactName: '', contactPhone: '', businessType: '', status: 1 },
      billingLines: LINES, extraUnitIds: [],
    } as ContractDetailDTO)
  })
  const STEPS: Array<[string, 'new' | 'edit', (w: ReturnType<typeof mount>) => Promise<unknown> | void]> = [
    ['选租户', 'new', (w) => w.findComponent(FPTenantPicker).vm.$emit('update:modelValue', 5)],
    ['选单元', 'new', (w) => w.findComponent(FPUnitPicker).vm.$emit('update:modelValue', [11])],
    ['添加标的段', 'new', async (w) => {
      await w.findAll('button').find(b => b.text() === '添加标的段')!.trigger('click')
      await w.find('.ct-seg-menu-item').trigger('click')
    }],
    ['添加免租期', 'new', (w) => w.findAll('button').find(b => b.text() === '添加免租期')!.trigger('click')],
    ['点段上的单元 chip', 'edit', (w) => w.find('.ct-bl-uchip').trigger('click')],
    ['删除标的段', 'edit', (w) => delBtn(w, '删除标的段').trigger('click')],
    ['删除遗留费项', 'edit', (w) => delBtn(w, '删除该遗留费项').trigger('click')],
    ['删除免租期', 'edit', (w) => delBtn(w, '删除该段').trigger('click')],
  ]
  it.each(STEPS)('❗只做「%s」:改动数 1,点遮罩问「1 处」', async (_, mode, step) => {
    const w = mount(ContractNewDialog, {
      props: mode === 'edit' ? { initial: EDIT_INIT } : {},
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    expect(useAuthStore().dirtyTotal, '前置:没碰过任何东西').toBe(0)
    await step(w)
    await flushPromises()
    expect(useAuthStore().dirtyTotal).toBe(1)
    await w.find('.ct-mask').trigger('mousedown')
    expect(askQueue.map(a => a.body)).toEqual(['这页有 1 处改动还没保存。'])
    w.unmount()
  })
})
