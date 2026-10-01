// 催缴单页五个簿 / 导出窗口的提示件(S4 T25,画布 02-A / 02-B / 06-B ①④⑤⑦⑨):
// 原生 confirm / alert → ask / askLeave / 回执 / 字段报错;加载失败 → FPLoadError 换掉表格并接上重试;
// 只有圆点的缺口 → FPMark「缺收款公司」;块内虚线条 → FPNote;手写空状态 → FPEmpty;改动数接进 openEditor。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'
import type { BuildingDTO } from '@/types/building'
import type { ContractDTO } from '@/types/contract'
import type { ParamRowDTO } from '@/api/params'
import type { CompanyFullDTO } from '@/api/billDelivery'
import { slotLabel, type PayContractIn, type PayNoticeIn } from '@/utils/payBookLogic'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
    put: vi.fn(() => Promise.resolve({ users: [], evicted: null, approvals: [], outcome: null })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))
vi.mock('@/api/params', () => ({ paramsApi: { list: vi.fn(), put: vi.fn() } }))
vi.mock('@/api/alloc', () => ({
  allocApi: {
    pools: vi.fn(() => Promise.resolve({ generated: false, rows: [] })),
    rules: vi.fn(() => Promise.resolve([])),
    updateRule: vi.fn(),
  },
}))
vi.mock('@/api/bills', () => ({ billsApi: { paymap: vi.fn(), setPaymap: vi.fn() } }))
vi.mock('@/api/billDelivery', async (orig) => ({
  ...(await orig<typeof import('@/api/billDelivery')>()),
  companyBookApi: {
    list: vi.fn(), create: vi.fn(), update: vi.fn(),
    addAccount: vi.fn(), updateAccount: vi.fn(), deleteAccount: vi.fn(),
  },
}))

import CoefBookWindow from '@/views/bills/CoefBookWindow.vue'
import PayBookWindow from '@/views/bills/PayBookWindow.vue'
import CompanyBookWindow from '@/views/bills/CompanyBookWindow.vue'
import ExportNoticeWindow from '@/views/bills/ExportNoticeWindow.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import { paramsApi } from '@/api/params'
import { billsApi } from '@/api/bills'
import { companyBookApi } from '@/api/billDelivery'

// ── 夹具(按真实 DTO 声明;两期三户,有一户跨两栋) ──
function bld(id: number, phase: number, name: string): BuildingDTO {
  return {
    id, name, phase, phaseName: '', zone: `p${phase}`, kind: '标准',
    floorCount: 3, totalArea: 1000, rentableArea: 900, status: 1,
    unitCount: 4, occupiedCount: 3, vacantCount: 1,
    expiringCount: 0, reservedCount: 0, leasedArea: 800,
    occRate: 0.8, monthlyRent: 20000, tenantIds: [],
    tenantBuildingArea: 800,
  }
}
function ct(id: number, tenantId: number, tenantName: string, buildingId: number): ContractDTO {
  return {
    id, contractNo: `HT${id}`, tenantId, tenantName,
    buildingId, buildingName: '', unitId: null, floorInfo: '1F',
    rentArea: 120, monthlyRent: 3000, deposit: 6000,
    startDate: '2025-01-01', endDate: '2026-12-31', signDate: '2024-12-20',
    status: 'active', termMonths: 24, daysToEnd: 300, remark: null,
  }
}
const BUILDINGS = [bld(1, 2, 'A座'), bld(2, 2, 'B座'), bld(3, 1, 'C座')]
const CONTRACTS = [ct(1, 11, '甲科技', 1), ct(2, 12, '乙物流', 1), ct(3, 12, '乙物流', 2), ct(4, 13, '丙贸易', 3)]
const prow = (scope: string, value: number): ParamRowDTO => ({
  key: 'mgmt_fee', label: '电力管理费', unit: '元/度', group: 'constant',
  scope, scopeLabel: scope ? '户级' : '全园', value, valueText: `${value} 元/度`,
  mode: 'from', acctMonth: '', rangeText: '长期', sourceChain: [`全园:${value}`],
  formula: null, hint: null, editable: true, monthlyCheck: false,
  hasMonthRow: false, rowId: null, note: null,
})
const acct = (id: number, companyId: number, isDefault: boolean) => ({
  id, companyId, kind: 'bank' as const, accountName: `户名${id}`, accountNo: `6222${id}`,
  bankName: '工行', isDefault, sortNo: id, remark: null,
})
const COMPANIES: CompanyFullDTO[] = [
  { id: 7, name: '一泽科技', short: '一泽', sortNo: 1, fullName: '佛山一泽科技有限公司', status: 1, accounts: [acct(1, 7, true), acct(2, 7, false)] },
  { id: 8, name: '二源置业', short: '二源', sortNo: 2, fullName: null, status: 1, accounts: [] },
]
// 二期两户:甲已落到一泽;乙有一张单没落到收款公司(缺口)、还没核对
const NOTICES: PayNoticeIn[] = [
  { tenantId: 11, tenantName: '甲科技', payCompanyId: 7, payCompanyName: '一泽', noticeKind: 'normal', premiseText: '二期A座', totalAmount: 1234.5, status: 'confirmed' },
  { tenantId: 12, tenantName: '乙物流', payCompanyId: 7, payCompanyName: '一泽', noticeKind: 'normal', premiseText: '二期A座', totalAmount: 800, status: 'draft' },
  { tenantId: 12, tenantName: '乙物流', payCompanyId: null, noticeKind: 'normal', premiseText: '二期B座', totalAmount: 200, status: 'draft' },
  { tenantId: 13, tenantName: '丙贸易', payCompanyId: 8, payCompanyName: '二源', noticeKind: 'normal', premiseText: '一期C座', totalAmount: 500, status: 'confirmed' },
]
const PAY_CONTRACTS: PayContractIn[] = CONTRACTS.map(c => ({ tenantId: c.tenantId, tenantName: c.tenantName, buildingId: c.buildingId }))

const settle = async () => { await flushPromises(); await new Promise(r => setTimeout(r, 0)); await flushPromises() }
const mounted: VueWrapper[] = []
const stubs = { global: { stubs: { Teleport: true } } }

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('token', 'test-token')
  setActivePinia(createPinia())
  vi.clearAllMocks()
  askQueue.splice(0)
  receipts.splice(0)
  vi.mocked(paramsApi.list).mockResolvedValue([prow('', 0.16)])
  vi.mocked(paramsApi.put).mockResolvedValue(undefined as never)
  vi.mocked(billsApi.paymap).mockResolvedValue([{ tenantId: 11, feeKey: 'elecStd', companyId: 7 }])
  vi.mocked(billsApi.setPaymap).mockResolvedValue()
  vi.mocked(companyBookApi.list).mockResolvedValue(structuredClone(COMPANIES))
})
afterEach(() => {
  while (askQueue.length) answer(false)
  mounted.splice(0).forEach(w => w.unmount())
})

// ─────────────────────────────── 系数簿 ───────────────────────────────
type CoefVm = {
  editMode: boolean; stash: Map<number, number | null>; phase: string
  onEditBtn: () => Promise<void>; setPhase: (v: string) => Promise<void>; setCoef: (v: string) => Promise<void>
  exitEdit: () => Promise<void>
}
async function openCoef() {
  const w = mount(CoefBookWindow, {
    props: { open: false, ym: '2026-03', phase: '2', contracts: CONTRACTS, buildings: BUILDINGS, years: [2026] },
    ...stubs,
  })
  mounted.push(w)
  await w.setProps({ open: true })
  await settle()
  return w
}
async function coefInEdit() {
  useAuthStore().permissions = ['param-policy:edit']
  const w = await openCoef()
  await (w.vm as unknown as CoefVm).onEditBtn()
  await settle()
  return w
}

describe('系数簿', () => {
  it('❗加载失败:FPLoadError 换掉表格(不关窗),点重试重拉,拉到了表格回来', async () => {
    vi.mocked(paramsApi.list).mockRejectedValueOnce(new Error('网关超时'))
    const w = await openCoef()
    const err = w.find('.fp-empty.error')
    expect(err.text()).toContain('2026 年 3 月的系数没读到')
    expect(err.text()).toContain('网关超时')
    expect(w.find('.cb-table').exists(), '和表格互斥').toBe(false)
    expect(w.emitted('close'), '不再弹窗后关窗').toBeUndefined()
    await err.find('button').trigger('click')
    await settle()
    expect(paramsApi.list).toHaveBeenCalledTimes(2)
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.find('.cb-table').exists()).toBe(true)
  })

  it('❗层份键在一期页签:空状态换掉表格,没有虚线条', async () => {
    const w = await openCoef()
    await (w.vm as unknown as CoefVm).setPhase('1')
    await (w.vm as unknown as CoefVm).setCoef('elevator_share')
    await settle()
    expect(w.find('.fp-empty:not(.error)').text()).toContain('只在二期开放')
    expect(w.find('.cb-table').exists()).toBe(false)
    expect(w.find('.cb-bar').exists()).toBe(false)
  })

  it('❗统一修改条输错:字段下面出红字,不走回执;改了值红字消失', async () => {
    const w = await coefInEdit()
    await w.find('tbody input[type="checkbox"]').setValue(true)
    await w.find('.cb-uni-in').setValue('abc')
    await w.findAll('.cb-unibar button').find(b => b.text() === '应用到选中')!.trigger('click')
    expect(w.find('.cb-unibar .fp-field-err').text()).toBe('请输入数字(元/度)')
    expect(receipts.length, '字段错不走回执').toBe(0)
    expect((w.vm as unknown as CoefVm).stash.size).toBe(0)
    await w.find('.cb-uni-in').setValue('0.2')
    expect(w.find('.cb-unibar .fp-field-err').text()).toBe('')
  })

  it('❗有暂存时切期页签先问;点「继续编辑」期和暂存都不动', async () => {
    const w = await coefInEdit()
    const vm = w.vm as unknown as CoefVm
    vm.stash.set(11, 0.2)
    const p = vm.setPhase('1')
    await settle()
    expect(askQueue[0]).toMatchObject({ title: '切换到「一期」？', body: '这页有 1 处改动还没保存。', cancel: '继续编辑', danger: true })
    answer(false)
    await p
    expect(vm.phase).toBe('2')
    expect(vm.stash.size).toBe(1)
  })

  it('❗关窗:0 条暂存直接关不问;有暂存出离开确认,取消不关、放弃才关', async () => {
    const w = await coefInEdit()
    const vm = w.vm as unknown as CoefVm
    vm.stash.set(11, 0.2); vm.stash.set(12, null)
    w.findComponent(FPDrawer).vm.$emit('close')
    await settle()
    expect(askQueue[0]).toMatchObject({ title: '关闭「系数簿」？', body: '这页有 2 处改动还没保存。', action: '放弃改动并关闭' })
    answer(false)
    await settle()
    expect(w.emitted('close')).toBeUndefined()
    w.findComponent(FPDrawer).vm.$emit('close')
    await settle()
    answer(true)
    await settle()
    expect(w.emitted('close')).toHaveLength(1)

    const w2 = await openCoef()
    w2.findComponent(FPDrawer).vm.$emit('close')
    await settle()
    expect(askQueue.length, '0 处改动不弹').toBe(0)
    expect(w2.emitted('close')).toHaveLength(1)
  })

  it('❗编辑态的改动数 = 暂存条数(锁与窗口登记同一个函数,不算两倍)', async () => {
    const w = await coefInEdit()
    const vm = w.vm as unknown as CoefVm
    vm.stash.set(11, 0.2); vm.stash.set(12, 0.3); vm.stash.set(13, null)
    expect(useAuthStore().dirtyTotal).toBe(3)
  })

  it('❗保存失败:失败回执带「重试」,点了再提交一次', async () => {
    const w = await coefInEdit()
    const vm = w.vm as unknown as CoefVm
    vm.stash.set(11, 0.2)
    await settle()
    vi.mocked(paramsApi.put).mockRejectedValueOnce(new Error('服务器没有响应'))
    await w.findAll('button').find(b => b.text().startsWith('保存('))!.trigger('click')
    await settle()
    expect(receipts.at(-1)).toMatchObject({ tone: 'fail', action: { label: '重试' } })
    expect(receipts.at(-1)!.text).toContain('服务器没有响应')
    const calls = vi.mocked(paramsApi.put).mock.calls.length
    receipts.at(-1)!.action!.run()
    await settle()
    expect(vi.mocked(paramsApi.put).mock.calls.length).toBeGreaterThan(calls)
    expect(vm.stash.size, '重试成功,暂存清空').toBe(0)
  })

  it('❗退出编辑:不保存 → 再问放弃(退出编辑「系数簿」),放弃后退出并清空暂存', async () => {
    const w = await coefInEdit()
    const vm = w.vm as unknown as CoefVm
    vm.stash.set(11, 0.2)
    const p = vm.exitEdit()
    await settle()
    expect(askQueue[0]).toMatchObject({ title: '退出编辑前保存 1 条暂存？', cancel: '不保存' })
    answer(false)
    await settle()
    expect(askQueue[0]).toMatchObject({ title: '退出编辑「系数簿」？', action: '放弃改动并退出编辑', danger: true })
    answer(true)
    await p
    expect(vm.editMode).toBe(false)
    expect(vm.stash.size).toBe(0)
    expect(paramsApi.put, '选了不保存就一条都不提交').not.toHaveBeenCalled()
  })
})

// ─────────────────────────────── 收款簿 ───────────────────────────────
type PayVm = {
  editMode: boolean; stash: Map<string, number>; colId: string
  setSlot: (v: string) => Promise<void>; exitEdit: () => Promise<void>
}
async function openPay() {
  const w = mount(PayBookWindow, {
    props: { open: false, ym: '2026-03', phase: '2', notices: NOTICES, contracts: PAY_CONTRACTS, buildings: BUILDINGS },
    ...stubs,
  })
  mounted.push(w)
  await w.setProps({ open: true })
  await settle()
  return w
}

describe('收款簿', () => {
  it('❗加载失败:FPLoadError 换掉表格,点重试重拉', async () => {
    vi.mocked(billsApi.paymap).mockRejectedValueOnce(new Error('连接被重置'))
    const w = await openPay()
    expect(w.find('.fp-empty.error').text()).toContain('收款公司和收款映射没读到')
    expect(w.find('.pb-table').exists()).toBe(false)
    expect(w.emitted('close')).toBeUndefined()
    await w.find('.fp-empty.error button').trigger('click')
    await settle()
    expect(billsApi.paymap).toHaveBeenCalledTimes(2)
    expect(w.find('.pb-table').exists()).toBe(true)
  })

  it('❗缺收款公司的户:名字旁就地标记「缺收款公司」,不再是只有圆点', async () => {
    const w = await openPay()
    const row = w.findAll('.pb-table tbody tr').find(r => r.text().includes('乙物流'))!
    expect(row.find('.fp-mark.warn').text()).toBe('缺收款公司')
    expect(w.findAll('.pb-table .fp-mark').length, '甲没缺口').toBe(1)
    expect(w.find('.pb-dot').exists()).toBe(false)
  })

  it('❗有暂存关窗出离开确认;编辑态改动数 = 暂存条数', async () => {
    useAuthStore().permissions = ['billing-issue:edit']
    const w = await openPay()
    const vm = w.vm as unknown as PayVm
    vm.editMode = true
    await settle()
    vm.stash = new Map([['11|elecStd', 8], ['12|elecStd', 8]])
    expect(useAuthStore().dirtyTotal).toBe(2)
    w.findComponent(FPDrawer).vm.$emit('close')
    await settle()
    expect(askQueue[0]).toMatchObject({ title: '关闭「收款簿」？', body: '这页有 2 处改动还没保存。' })
    answer(false)
    await settle()
    expect(w.emitted('close')).toBeUndefined()
  })

  it('❗有暂存时切收款槽先问;点「继续编辑」槽和暂存都不动', async () => {
    useAuthStore().permissions = ['billing-issue:edit']
    const w = await openPay()
    const vm = w.vm as unknown as PayVm
    vm.editMode = true
    vm.stash = new Map([['12|elecStd', 8]])
    await settle()
    const p = vm.setSlot('waterStd')
    await settle()
    expect(askQueue[0]).toMatchObject({ title: `切换到「${slotLabel('waterStd')}」？`, cancel: '继续编辑', danger: true })
    answer(false)
    await p
    expect(vm.colId).toBe('elecStd')
    expect(vm.stash.size).toBe(1)
  })

  it('❗退出编辑:不保存 → 再问放弃(退出编辑「收款簿」),放弃后退出', async () => {
    useAuthStore().permissions = ['billing-issue:edit']
    const w = await openPay()
    const vm = w.vm as unknown as PayVm
    vm.editMode = true
    vm.stash = new Map([['12|elecStd', 8]])
    await settle()
    const p = vm.exitEdit()
    await settle()
    expect(askQueue[0]).toMatchObject({ title: '退出编辑前保存 1 条暂存？', cancel: '不保存' })
    answer(false)
    await settle()
    expect(askQueue[0]).toMatchObject({ title: '退出编辑「收款簿」？', danger: true })
    answer(true)
    await p
    expect(vm.editMode).toBe(false)
    expect(billsApi.setPaymap).not.toHaveBeenCalled()
  })

  it('❗保存失败走失败回执带「重试」', async () => {
    useAuthStore().permissions = ['billing-issue:edit']
    const w = await openPay()
    const vm = w.vm as unknown as PayVm
    vm.editMode = true
    await settle()
    vm.stash = new Map([['12|elecStd', 8]])
    await settle()
    vi.mocked(billsApi.setPaymap).mockRejectedValueOnce(new Error('写库失败'))
    await w.findAll('button').find(b => b.text().startsWith('保存('))!.trigger('click')
    await settle()
    expect(receipts.at(-1)).toMatchObject({ tone: 'fail', action: { label: '重试' } })
    expect(receipts.at(-1)!.text).toContain('写库失败')
  })
})

// ─────────────────────────────── 收款公司 ───────────────────────────────
async function openCompany() {
  useAuthStore().permissions = ['master:edit']
  const w = mount(CompanyBookWindow, { props: { open: false }, ...stubs })
  mounted.push(w)
  await w.setProps({ open: true })
  await settle()
  return w
}

describe('收款公司', () => {
  it('❗加载失败:FPLoadError 换掉窗体,点重试重拉', async () => {
    vi.mocked(companyBookApi.list).mockRejectedValueOnce(new Error('拒绝访问'))
    const w = await openCompany()
    expect(w.find('.fp-empty.error').text()).toContain('收款公司没读到')
    expect(w.find('.cw-split').exists()).toBe(false)
    expect(w.emitted('close')).toBeUndefined()
    await w.find('.fp-empty.error button').trigger('click')
    await settle()
    expect(companyBookApi.list).toHaveBeenCalledTimes(2)
    expect(w.find('.cw-split').exists()).toBe(true)
  })

  it('❗公司名清空再保存:输入框下面出「公司名必填」,不走回执、不发请求', async () => {
    const w = await openCompany()
    await w.find('.cw-pane input').setValue('')
    await w.findAll('.cw-pane button').find(b => b.text() === '保存')!.trigger('click')
    // 挂了 Teleport 桩,槽里的节点每次重渲都换新:按位置重新取,不拿旧引用
    const nameField = w.find('.cw-pane label.cw-f')
    expect(nameField.find('.fp-field-err').text()).toBe('公司名必填')
    expect(receipts.length).toBe(0)
    expect(companyBookApi.update).not.toHaveBeenCalled()
  })

  it('❗表单有改动时换公司先问(离开「一泽科技」),取消就留在原公司', async () => {
    const w = await openCompany()
    await w.find('.cw-pane input').setValue('一泽科技(新)')
    await w.findAll('.cw-item').find(b => b.text().includes('二源置业'))!.trigger('click')
    await settle()
    expect(askQueue[0]).toMatchObject({ title: '离开「一泽科技」？', body: '这页有 1 处改动还没保存。', action: '放弃改动并离开' })
    answer(false)
    await settle()
    expect((w.find('.cw-pane input').element as HTMLInputElement).value).toBe('一泽科技(新)')
  })

  it('❗保存公司失败走失败回执带「重试」', async () => {
    const w = await openCompany()
    await w.find('.cw-pane input').setValue('一泽科技(新)')
    vi.mocked(companyBookApi.update).mockRejectedValueOnce(new Error('公司名重复'))
    await w.findAll('.cw-pane button').find(b => b.text() === '保存')!.trigger('click')
    await settle()
    expect(receipts.at(-1)).toMatchObject({ tone: 'fail', text: '公司名重复', action: { label: '重试' } })
  })

  it('❗删账户先问(删除类,danger);取消不删', async () => {
    const w = await openCompany()
    await w.find('.cw-mini.del').trigger('click')
    await settle()
    expect(askQueue[0]).toMatchObject({ title: '删除账户「户名1 62221」？', action: '删除账户', danger: true })
    answer(false)
    await settle()
    expect(companyBookApi.deleteAccount).not.toHaveBeenCalled()
  })

  it('❗表单有改动时关窗出离开确认,改动数登记进 auth(公司表单 + 开着的账户编辑器各算一处)', async () => {
    const w = await openCompany()
    await w.find('.cw-pane input').setValue('一泽科技(新)')
    expect(useAuthStore().dirtyTotal).toBe(1)
    await w.findAll('.cw-mini').find(b => b.attributes('aria-label') === '编辑')!.trigger('click')
    expect(useAuthStore().dirtyTotal).toBe(2)
    w.findComponent(FPDrawer).vm.$emit('close')
    await settle()
    expect(askQueue[0]).toMatchObject({ title: '关闭「收款公司」？', body: '这页有 2 处改动还没保存。' })
    answer(false)
    await settle()
    expect(w.emitted('close')).toBeUndefined()
  })

  it('❗没有账户的公司:空状态换掉账户表', async () => {
    const w = await openCompany()
    await w.findAll('.cw-item').find(b => b.text().includes('二源置业'))!.trigger('click')
    await settle()
    expect(w.find('.cw-pane .fp-empty').text()).toContain('还没有收款账户')
    expect(w.find('.cw-table').exists()).toBe(false)
  })
})

// ─────────────────── 三个簿窗口 · 失败态与竞态(房内定型写法) ───────────────────
// 失败时不许进编辑、写函数自守;重试在途失败件留在原地(错误只在成功分支清);
// 两趟叠着发只认后发的那趟(先发的晚到,不管是旧数还是失败,都不许盖)。
describe('三个簿窗口 · 失败态与竞态', () => {
  type Loadable = { load: () => Promise<void> }
  /** 一个挂住的请求,手里攥着放行 / 失败两头 */
  function held<T>() {
    let ok!: (v: T) => void, fail!: (e: Error) => void
    const p = new Promise<T>((res, rej) => { ok = res; fail = rej })
    return { p, ok, fail }
  }

  // ── 系数簿 ──
  // 破坏验证:onEditBtn 第一行 `if (loadErr.value) return` 删掉 → 直呼进了编辑态 → 红;
  //           FPEditModeButton 的 :disabled 去掉 → 红
  it('❗系数簿首载失败:编辑按钮置灰;直呼 onEditBtn 也进不了编辑态', async () => {
    useAuthStore().permissions = ['param-policy:edit']
    vi.mocked(paramsApi.list).mockRejectedValueOnce(new Error('网关超时'))
    const w = await openCoef()
    expect(w.findComponent(FPEditModeButton).props('disabled')).toBe(true)
    await (w.vm as unknown as CoefVm).onEditBtn()
    await settle()
    expect((w.vm as unknown as CoefVm).editMode).toBe(false)
  })

  // 破坏验证:「加载中…」的 v-if 去掉 `&& !loadErr` → 重试一按失败件就换成转圈 → 红
  it('❗系数簿重试在途:失败件留在原地、表格不出;到数才换回表格', async () => {
    vi.mocked(paramsApi.list).mockRejectedValueOnce(new Error('网关超时'))
    const w = await openCoef()
    const h = held<ParamRowDTO[]>()
    vi.mocked(paramsApi.list).mockImplementationOnce(() => h.p)
    await w.find('.fp-empty.error button').trigger('click')
    await settle()
    expect(w.find('.fp-empty.error').exists(), '重试一按下失败件就没了').toBe(true)
    expect(w.find('.cb-table').exists()).toBe(false)
    h.ok([prow('', 0.16)])
    await settle()
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.find('.cb-table').exists()).toBe(true)
  })

  // 破坏验证:load 成功支的 `if (my !== seq) return` 删掉 → 0.99 盖上来 → 红;catch 支的删掉 → 冒失败件 → 红
  it('❗系数簿两趟叠着发:先发的晚到,旧数不盖新数、失败不冒失败件', async () => {
    useAuthStore().permissions = ['param-policy:edit']
    const first = held<ParamRowDTO[]>(), second = held<ParamRowDTO[]>()
    vi.mocked(paramsApi.list).mockImplementationOnce(() => first.p).mockImplementationOnce(() => second.p)
    const w = await openCoef()
    const vm = w.vm as unknown as CoefVm & Loadable
    void vm.load()
    await vm.load()
    await settle()
    const fresh = w.find('.cb-table').text()
    second.ok([prow('', 0.99), prow('tenant:11', 0.99)])
    await settle()
    expect(w.find('.cb-table').text(), '先发的旧数盖了上来').toBe(fresh)
    first.fail(new Error('超时'))
    await settle()
    expect(w.find('.fp-empty.error').exists(), '先发的失败冒了出来').toBe(false)
    expect(w.find('.cb-table').text()).toBe(fresh)
  })

  // 破坏验证:guardDrop 答「是」后不清 stash → 红
  it('❗系数簿有暂存切期:答「放弃改动并切换」→ 期换了、暂存清空', async () => {
    const w = await coefInEdit()
    const vm = w.vm as unknown as CoefVm
    vm.stash.set(11, 0.2)
    const p = vm.setPhase('1')
    await settle()
    expect(askQueue[0]?.action).toBe('放弃改动并切换')
    answer(true)
    await p
    expect(vm.phase).toBe('1')
    expect(vm.stash.size).toBe(0)
  })

  // 破坏验证:onSave 的自守去掉 `|| loadErr.value` → 红
  it('❗系数簿编辑中重拉失败:保存直呼也不提交', async () => {
    const w = await coefInEdit()
    const vm = w.vm as unknown as CoefVm & Loadable & { onSave: () => Promise<void> }
    vm.stash.set(11, 0.2)
    vi.mocked(paramsApi.list).mockRejectedValueOnce(new Error('网关超时'))
    await vm.load()
    await settle()
    expect(vm.editMode, '前置:还在编辑态').toBe(true)
    await vm.onSave()
    expect(paramsApi.put).not.toHaveBeenCalled()
  })

  // ── 收款簿 ──
  type PayVmX = PayVm & Loadable & { onSave: () => Promise<void> }
  const payEditBtn = (w: VueWrapper) => w.findAll('button').find(b => b.text() === '编辑模式')!

  // 破坏验证:编辑模式按钮的 :disabled="!!loadErr" 去掉 → 红
  it('❗收款簿首载失败:编辑模式按钮置灰', async () => {
    useAuthStore().permissions = ['billing-issue:edit']
    vi.mocked(billsApi.paymap).mockRejectedValueOnce(new Error('连接被重置'))
    const w = await openPay()
    expect(payEditBtn(w).attributes('disabled')).toBeDefined()
  })

  // 破坏验证:「加载中…」的 v-if 去掉 `&& !loadErr` → 红
  it('❗收款簿重试在途:失败件留在原地、表格不出;到数才换回表格', async () => {
    vi.mocked(billsApi.paymap).mockRejectedValueOnce(new Error('连接被重置'))
    const w = await openPay()
    const h = held<Awaited<ReturnType<typeof billsApi.paymap>>>()
    vi.mocked(billsApi.paymap).mockImplementationOnce(() => h.p)
    await w.find('.fp-empty.error button').trigger('click')
    await settle()
    expect(w.find('.fp-empty.error').exists()).toBe(true)
    expect(w.find('.pb-table').exists()).toBe(false)
    h.ok([{ tenantId: 11, feeKey: 'elecStd', companyId: 7 }])
    await settle()
    expect(w.find('.pb-table').exists()).toBe(true)
  })

  // 破坏验证:load 成功支 / catch 支的 seq 判断删掉 → 红
  it('❗收款簿两趟叠着发:先发的晚到,旧数不盖新数、失败不冒失败件', async () => {
    type PM = Awaited<ReturnType<typeof billsApi.paymap>>
    const first = held<PM>(), second = held<PM>()
    vi.mocked(billsApi.paymap).mockImplementationOnce(() => first.p).mockImplementationOnce(() => second.p)
    const w = await openPay()
    const vm = w.vm as unknown as PayVmX
    void vm.load()
    await vm.load()
    await settle()
    const fresh = w.find('.pb-table').text()
    second.ok([{ tenantId: 11, feeKey: 'elecStd', companyId: 8 }, { tenantId: 12, feeKey: 'elecStd', companyId: 8 }])
    await settle()
    expect(w.find('.pb-table').text(), '先发的旧数盖了上来').toBe(fresh)
    first.fail(new Error('超时'))
    await settle()
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.find('.pb-table').text()).toBe(fresh)
  })

  // 破坏验证:guardDrop 答「是」后不清 stash → 红
  it('❗收款簿有暂存切槽:答「放弃改动并切换」→ 槽换了、暂存清空', async () => {
    useAuthStore().permissions = ['billing-issue:edit']
    const w = await openPay()
    const vm = w.vm as unknown as PayVmX
    vm.editMode = true
    vm.stash = new Map([['12|elecStd', 8]])
    await settle()
    const p = vm.setSlot('waterStd')
    await settle()
    answer(true)
    await p
    expect(vm.colId).toBe('waterStd')
    expect(vm.stash.size).toBe(0)
  })

  // 破坏验证:onSave 的自守去掉 `|| loadErr.value` → 红
  it('❗收款簿编辑中重拉失败:保存直呼也不提交', async () => {
    useAuthStore().permissions = ['billing-issue:edit']
    const w = await openPay()
    const vm = w.vm as unknown as PayVmX
    vm.editMode = true
    vm.stash = new Map([['12|elecStd', 8]])
    vi.mocked(billsApi.paymap).mockRejectedValueOnce(new Error('连接被重置'))
    await vm.load()
    await settle()
    expect(vm.editMode, '前置:还在编辑态').toBe(true)
    await vm.onSave()
    expect(billsApi.setPaymap).not.toHaveBeenCalled()
  })

  // ── 收款公司(没有编辑模式,只有失败态与竞态两条) ──
  // 破坏验证:「加载中…」的 v-if 去掉 `&& !loadErr` → 红
  it('❗收款公司重试在途:失败件留在原地、窗体不出;到数才换回窗体', async () => {
    vi.mocked(companyBookApi.list).mockRejectedValueOnce(new Error('拒绝访问'))
    const w = await openCompany()
    const h = held<CompanyFullDTO[]>()
    vi.mocked(companyBookApi.list).mockImplementationOnce(() => h.p)
    await w.find('.fp-empty.error button').trigger('click')
    await settle()
    expect(w.find('.fp-empty.error').exists()).toBe(true)
    expect(w.find('.cw-split').exists()).toBe(false)
    h.ok(structuredClone(COMPANIES))
    await settle()
    expect(w.find('.cw-split').exists()).toBe(true)
  })

  // 破坏验证:CompanyBookWindow.load 成功支 / catch 支的 seq 判断删掉 → 红
  it('❗收款公司两趟叠着发:先发的晚到,旧名单不盖新名单、失败不冒失败件', async () => {
    const first = held<CompanyFullDTO[]>(), second = held<CompanyFullDTO[]>()
    vi.mocked(companyBookApi.list).mockImplementationOnce(() => first.p).mockImplementationOnce(() => second.p)
    const w = await openCompany()
    const vm = w.vm as unknown as Loadable
    void vm.load()
    await vm.load()
    await settle()
    const fresh = w.find('.cw-split').text()
    second.ok([{ ...structuredClone(COMPANIES[0]), name: '旧名单里的公司' }])
    await settle()
    expect(w.find('.cw-split').text(), '先发的旧名单盖了上来').toBe(fresh)
    first.fail(new Error('超时'))
    await settle()
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.find('.cw-split').text()).toBe(fresh)
  })
})

// ─────────────────────────────── 导出通知单 ───────────────────────────────
async function openExport() {
  const w = mount(ExportNoticeWindow, {
    props: { open: false, ym: '2026-03', phase: '2', notices: NOTICES, contracts: PAY_CONTRACTS, buildings: BUILDINGS },
    ...stubs,
  })
  mounted.push(w)
  await w.setProps({ open: true })
  await settle()
  return w
}

describe('导出通知单', () => {
  it('❗缺收款公司的户:就地标记,不是只有圆点', async () => {
    const w = await openExport()
    const row = w.findAll('.ex-table tbody tr').find(r => r.text().includes('乙物流'))!
    expect(row.find('.fp-mark.warn').text()).toBe('缺收款公司')
    expect(w.find('.ex-dot').exists()).toBe(false)
  })

  it('❗选中的公司有不印账户块的:块内提示 FPNote,没有虚线条', async () => {
    const w = await openExport()
    // 默认勾已确认的甲(一泽)。一泽选了账户 → 不出提示;改成「不印账户块」→ 出
    const vm = w.vm as unknown as { acctByCo: Record<number, string> }
    vm.acctByCo = { 7: '1' }
    await settle()
    expect(w.find('.fp-note').exists()).toBe(false)
    vm.acctByCo = { 7: '' }
    await settle()
    expect(w.find('.fp-note').text()).toContain('1 家公司这次不印账户块')
    expect(w.find('.ex-warn').exists()).toBe(false)
  })

  it('❗勾了没核对的户点导出先问;取消不导,确认才 emit', async () => {
    const w = await openExport()
    const rowB = w.findAll('.ex-table tbody tr').find(r => r.text().includes('乙物流'))!
    await rowB.find('input[type="checkbox"]').setValue(true)
    const btn = w.findAll('button').find(b => b.text().includes('导出 zip'))!
    await btn.trigger('click')
    await settle()
    expect(askQueue[0]).toMatchObject({ title: '1 户还没核对确认，仍然导出？', body: '乙物流还没核对确认。', action: '仍然导出' })
    answer(false)
    await settle()
    expect(w.emitted('export')).toBeUndefined()

    await btn.trigger('click')
    await settle()
    answer(true)                                      // 没核对
    await settle()
    expect(askQueue[0]?.title, '乙还缺收款公司,接着问第二句').toBe('1 户的单还没落到收款公司，仍然导出？')
    answer(true)
    await settle()
    expect(w.emitted('export')).toHaveLength(1)
  })
})
