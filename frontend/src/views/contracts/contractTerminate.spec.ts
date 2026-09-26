// 合同终止框的「这户在解约月挂着的表」(METER-TIMELINE-SPEC §3.6,C3)。钉四件会真出事的事:
// ① 打开就按解约日取表清单,房号对得上的默认勾;改解约日要重取(换月了,挂着的表可能不同);
// ② 确认时只把勾着的表交给后端 —— 勾选状态丢了 = 该空置的表继续挂着退租户;
// ③ 表清单没拿到,确认钮不放行(不然等于「一块都不空置」而用户以为处理过了);失败后重试成功才清错;
// ④ 框里写明「解约当月水电按月抄表，整月仍算原租户」。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { ContractDTO, ContractDetailDTO, ContractTerminatePreviewDTO } from '@/types/contract'

const terminate = vi.fn()
const terminatePreview = vi.fn()
vi.mock('@/api/contract', () => ({
  contractApi: {
    detail: vi.fn(() => Promise.resolve(DETAIL)),
    terminate: (...a: unknown[]) => terminate(...a),
    terminatePreview: (...a: unknown[]) => terminatePreview(...a),
    remove: vi.fn(),
  },
}))

import ContractDrawer from './ContractDrawer.vue'
import { useAuthStore } from '@/stores/auth'

const CONTRACT: ContractDTO = {
  id: 42, contractNo: 'C2024M-042', tenantId: 7, tenantName: '甲电子', buildingId: 3, buildingName: 'B座',
  unitId: null, floorInfo: '3F 301', rentArea: 500, monthlyRent: 20000, deposit: 40000,
  startDate: '2023-01-01', endDate: '2025-12-31', signDate: '2022-12-20', status: 'active',
  termMonths: 36, daysToEnd: 400, remark: null,
}
const DETAIL = {
  contract: CONTRACT,
  tenant: { companyName: '甲电子', contactName: '', contactPhone: '', businessType: '电子', status: 1 },
  billingLines: [], extraUnitIds: [],
} as ContractDetailDTO
// 真实形状:三块表,两块房号对得上(checked),一块是同户另一处的(不默认勾)
const PREVIEW: ContractTerminatePreviewDTO = {
  vacateFrom: '2024-05',
  meters: [
    { meterId: 101, label: 'B座3楼·电表①', roomNo: '301', checked: true },
    { meterId: 102, label: 'B座3楼·水表', roomNo: '301', checked: true },
    { meterId: 205, label: 'C座1楼·电表③', roomNo: '105', checked: false },
  ],
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['contract:edit']
  terminate.mockReset().mockResolvedValue({ ...CONTRACT, status: 'terminated' })
  terminatePreview.mockReset().mockResolvedValue(PREVIEW)
})

// 弹窗 Teleport 到 body:哪条用例中途红了没走到 unmount,残留的弹窗会被下一条的 querySelector 捡到 → 连坐。统一在这里收
const mounted: VueWrapper[] = []
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()); document.body.innerHTML = '' })

async function openTerminate() {
  const w = mount(ContractDrawer, { props: { contract: CONTRACT }, attachTo: document.body })
  mounted.push(w)
  await flushPromises()
  await w.findAll('button').find(b => b.text().includes('终止'))!.trigger('click')
  await flushPromises()
  return w
}
const dlg = () => document.querySelector('.cd-dlg') as HTMLElement
const confirmBtn = () => [...dlg().querySelectorAll('button')].find(b => b.textContent?.includes('确认终止')) as HTMLButtonElement

describe('合同终止框 · 解约月挂着的表', () => {
  // 破坏验证:把 loadPreview 里 `filter(m => m.checked)` 改成 `filter(() => false)` → 勾选断言红
  it('❗打开即按解约日取表清单,房号对得上的默认勾;框里写明解约当月水电整月归原户', async () => {
    await openTerminate()
    expect(terminatePreview).toHaveBeenCalledWith(42, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    const rows = [...dlg().querySelectorAll('.cd-vac-row')]
    expect(rows.map(r => r.querySelector('.nm')!.textContent)).toEqual(['B座3楼·电表①', 'B座3楼·水表', 'C座1楼·电表③'])
    expect(rows.map(r => (r.querySelector('input') as HTMLInputElement).checked)).toEqual([true, true, false])
    expect(dlg().textContent).toContain('勾上的自 2024-05 起空置')
    expect(dlg().textContent).toContain('解约当月水电按月抄表，整月仍算原租户')
  })

  // 破坏验证:doTerminate 里不传 ids(改回 terminate(id, termOn))→ 红
  it('❗确认只交勾着的表:取消一块、加勾一块,后端收到的就是现在勾着的', async () => {
    const w = await openTerminate()
    const boxes = [...dlg().querySelectorAll('.cd-vac-row input')] as HTMLInputElement[]
    boxes[1].click()                 // 取消水表
    boxes[2].click()                 // 加勾 C 座那块
    await flushPromises()
    confirmBtn().click()
    await flushPromises()
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(terminate.mock.calls[0][0]).toBe(42)
    expect(terminate.mock.calls[0][2]).toEqual([101, 205])
    expect(w.emitted('terminated')).toHaveLength(1)
  })

  // 破坏验证:canConfirmTerminate 去掉 `&& !previewErr.value` 与 `!!preview.value` → 失败时确认钮可点 → 红
  it('❗表清单没拿到 → 确认钮不放行;重试成功才清错、放行', async () => {
    terminatePreview.mockRejectedValueOnce(new Error('网关超时'))
    await openTerminate()
    expect(dlg().textContent).toContain('表清单没加载出来:网关超时')
    expect(confirmBtn().disabled).toBe(true)
    confirmBtn().click()
    await flushPromises()
    expect(terminate).not.toHaveBeenCalled()
    ;[...dlg().querySelectorAll('button')].find(b => b.textContent?.includes('重试'))!.click()
    await flushPromises()
    expect(dlg().textContent).not.toContain('没加载出来')
    expect(confirmBtn().disabled).toBe(false)
  })

  // 破坏验证:watch([askTerminate, termOn]) 改成只 watch askTerminate → 第二次调用不发生 → 红
  it('改解约日 → 按新日期重取(换了月,挂着的表可能不同)', async () => {
    const w = await openTerminate()
    const dp = w.findComponent({ name: 'DatePicker' })
    dp.vm.$emit('update:modelValue', '2024-06-15')
    await flushPromises()
    expect(terminatePreview).toHaveBeenCalledTimes(2)
    expect(terminatePreview.mock.calls[1]).toEqual([42, '2024-06-15'])
  })
})

// 续签钮(对抗复查 F5):新一期起租前旧合同照常在租、状态仍是 active,光看状态拦不住再续一次 → 链上有下一期就禁用
// 破坏验证:canRenew 去掉 chain 那一条 → 第二条断言红
describe('续签钮 · 已有下一期不能再续', () => {
  const renewBtn = (w: VueWrapper) => w.findAll('button').find(b => b.text().includes('续签'))!
  it('没有下一期可点;链上有 parent 指向它的下一期就禁用', async () => {
    const solo = mount(ContractDrawer, { props: { contract: CONTRACT, chain: [{ c: CONTRACT, seq: 1 }] } })
    mounted.push(solo)
    await flushPromises()
    expect(renewBtn(solo).attributes('disabled')).toBeUndefined()
    const next = { ...CONTRACT, id: 43, contractNo: 'C2024M-042#2', parentContractId: 42, status: 'future' }
    const w = mount(ContractDrawer, { props: { contract: CONTRACT, chain: [{ c: CONTRACT, seq: 1 }, { c: next, seq: 2 }] } })
    mounted.push(w)
    await flushPromises()
    expect(renewBtn(w).attributes('disabled')).toBeDefined()
  })

  // 破坏验证:ctTimeline 的 expiring 分支不看 hasNext → 第二条断言红
  it('即将到期但已有下一期:时间轴不再写「建议尽快续签」', async () => {
    const soon = { ...CONTRACT, status: 'expiring', daysToEnd: 40 }
    const next = { ...CONTRACT, id: 43, contractNo: 'C2024M-042#2', parentContractId: 42, status: 'future' }
    const lone = mount(ContractDrawer, { props: { contract: soon, chain: [{ c: soon, seq: 1 }] } })
    mounted.push(lone)
    await flushPromises()
    expect(lone.text()).toContain('剩余 40 天 · 建议尽快续签')
    const w = mount(ContractDrawer, { props: { contract: soon, chain: [{ c: soon, seq: 1 }, { c: next, seq: 2 }] } })
    mounted.push(w)
    await flushPromises()
    expect(w.text()).toContain('剩余 40 天 · 下一期已签')
    expect(w.text()).not.toContain('建议尽快续签')
  })

  // 递增段的前一段(文案复查):徽标与时间轴都不说「已续签」,与续签框「递增不算续签」一致;下一期是续签的照旧
  // 破坏验证:nextIsEscalation 恒 false → 递增那组两条断言红
  it('前一段被递增取代写「已递增」,被续签取代仍写「已续签」', async () => {
    const old = { ...CONTRACT, status: 'renewed' }
    const esc = { ...CONTRACT, id: 43, contractNo: 'C2024M-042#2', parentContractId: 42, status: 'active', linkType: 'escalation' as const }
    const w = mount(ContractDrawer, { props: { contract: old, chain: [{ c: old, seq: 1 }, { c: esc, seq: 2 }] } })
    mounted.push(w)
    await flushPromises()
    expect(w.text()).toContain('已递增')
    expect(w.text()).toContain('2025-12-31 · 进入下一价格档')
    expect(w.text()).not.toContain('已续签')
    const ren = { ...esc, linkType: 'renew' as const }
    const w2 = mount(ContractDrawer, { props: { contract: old, chain: [{ c: old, seq: 1 }, { c: ren, seq: 2 }] } })
    mounted.push(w2)
    await flushPromises()
    expect(w2.text()).toContain('2025-12-31 · 被新一期取代')
    expect(w2.text()).not.toContain('已递增')
  })
})
