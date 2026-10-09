// 合同终止框的「这户在解约月挂着的表」(METER-TIMELINE-SPEC §3.6,C3)。钉四件会真出事的事:
// ① 打开就按解约日取表清单,房号对得上的默认勾;改解约日要重取(换月了,挂着的表可能不同);
// ② 确认时只把勾着的表交给后端 —— 勾选状态丢了 = 该空置的表继续挂着退租户;
// ③ 表清单没拿到,确认钮不放行(不然等于「一块都不空置」而用户以为处理过了);失败后重试成功才清错;
// ④ 框里写明「解约当月水电按月抄表，整月仍算原租户」。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import FPConfirmHost from '@/components/fp/FPConfirmHost.vue'
import { useAuthStore } from '@/stores/auth'
import { contractApi } from '@/api/contract'
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'

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
  useAuthStore().permissions = ['contracts:edit']
  terminate.mockReset().mockResolvedValue({ ...CONTRACT, status: 'terminated' })
  terminatePreview.mockReset().mockResolvedValue(PREVIEW)
  vi.mocked(contractApi.remove).mockReset()
  askQueue.splice(0)
  receipts.splice(0)
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
    // 加载失败(十件 ⑦):换掉表清单本身,「{年} 年 {月} 月…没读到」+ 副句给原因 + 重试
    expect(dlg().querySelector('.cd-vac .fp-empty.error')).not.toBeNull()
    expect(dlg().textContent).toMatch(/\d{4} 年 \d{1,2} 月挂在这户名下的表没读到/)
    expect(dlg().textContent).toContain('读到之前不能终止 · 网关超时')
    expect(dlg().querySelector('.cd-vac-list'), '失败态和清单互斥').toBeNull()
    expect(confirmBtn().disabled).toBe(true)
    confirmBtn().click()
    await flushPromises()
    expect(terminate).not.toHaveBeenCalled()
    ;[...dlg().querySelectorAll('button')].find(b => b.textContent?.includes('重试'))!.click()
    await flushPromises()
    expect(dlg().textContent).not.toContain('没读到')
    expect(confirmBtn().disabled).toBe(false)
  })

  // 破坏验证:doTerminate 的 catch 不推回执(或回执不带动作)→ 红;run 不调 doTerminate → 第二次 terminate 不发生 → 红
  it('❗终止失败:底部回执写原因并带「重试」,框不关;点重试再交一次', async () => {
    terminate.mockRejectedValueOnce(new Error('当月已出账'))
    const w = await openTerminate()
    confirmBtn().click()
    await flushPromises()
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ tone: 'fail', text: '终止失败：当月已出账' })
    expect(receipts[0].action?.label).toBe('重试')
    expect(dlg(), '失败了框还开着,勾选不丢').not.toBeNull()
    receipts[0].action!.run()
    await flushPromises()
    expect(terminate).toHaveBeenCalledTimes(2)
    expect(w.emitted('terminated')).toHaveLength(1)
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

// 删除(画布 02-B 右 / 06-B ⑨):自写的 cd-dlg 遮罩换成 ask —— 标题问句、按钮写动作、删除类主按钮红且焦点在「取消」
describe('删除合同 · 走 ask', () => {
  const delBtn = (w: VueWrapper) => w.findAll('button').find(b => b.text() === '删除')!
  async function mountDrawer() {
    const w = mount(ContractDrawer, { props: { contract: CONTRACT }, attachTo: document.body })
    mounted.push(w)
    await flushPromises()
    return w
  }

  // 破坏验证:ask 去掉 danger → 焦点落到「删除合同」→ 红;onDelete 不等 ask 的答复就删 → 点取消也删了 → 红
  it('❗点删除出确认:标题问句带合同号、主按钮「删除合同」、焦点在「取消」;点取消不删', async () => {
    mounted.push(mount(FPConfirmHost, { attachTo: document.body }))
    const w = await mountDrawer()
    await delBtn(w).trigger('click')
    await flushPromises()
    const card = document.querySelector('.fch-card') as HTMLElement
    expect(card.querySelector('.fch-t')!.textContent).toBe('删除合同「C2024M-042」？')
    const btns = [...card.querySelectorAll('button')]
    expect(btns.map(b => b.textContent!.trim())).toEqual(['取消', '删除合同'])
    expect(document.activeElement, '删除类焦点在「取消」').toBe(btns[0])
    expect(document.querySelector('.cd-dlg'), '自写的删除遮罩不该再出现').toBeNull()
    btns[0].click()
    await flushPromises()
    expect(contractApi.remove).not.toHaveBeenCalled()
    expect(w.emitted('deleted')).toBeUndefined()
  })

  // 破坏验证:onDelete 里 ok 判断去掉 → 上一条红;doDelete 不 emit deleted → 红
  it('❗确认后才删,删完 emit deleted', async () => {
    vi.mocked(contractApi.remove).mockResolvedValue(undefined as never)
    const w = await mountDrawer()
    await delBtn(w).trigger('click')
    expect(askQueue[0]).toMatchObject({ danger: true, action: '删除合同' })
    answer(true)
    await flushPromises()
    expect(contractApi.remove).toHaveBeenCalledWith(42)
    expect(w.emitted('deleted')).toHaveLength(1)
  })

  // 破坏验证:onDelete 答完后的 `props.contract !== c` 去掉 → 删了问话时那份 → 红
  it('❗问的途中抽屉换成了另一份合同:答「删除合同」也不删,不 emit deleted', async () => {
    vi.mocked(contractApi.remove).mockResolvedValue(undefined as never)
    const w = await mountDrawer()
    await delBtn(w).trigger('click')
    expect(askQueue[0]?.title, '前置:问的是 42 那份').toBe('删除合同「C2024M-042」？')
    await w.setProps({ contract: { ...CONTRACT, id: 43, contractNo: 'C2024M-043' } })
    answer(true)
    await flushPromises()
    expect(contractApi.remove).not.toHaveBeenCalled()
    expect(w.emitted('deleted')).toBeUndefined()
  })

  // 破坏验证:doDelete 的 catch 不推回执 → 红;run 不再调 doDelete → 第二次 remove 不发生 → 红
  it('❗删除失败:回执写原因带「重试」,点了再删一次(不再问)', async () => {
    vi.mocked(contractApi.remove).mockRejectedValueOnce(new Error('合同已出账')).mockResolvedValueOnce(undefined as never)
    const w = await mountDrawer()
    await delBtn(w).trigger('click')
    answer(true)
    await flushPromises()
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ tone: 'fail', text: '删除失败：合同已出账' })
    expect(receipts[0].action?.label).toBe('重试')
    receipts[0].action!.run()
    await flushPromises()
    expect(askQueue, '重试不再问一遍').toHaveLength(0)
    expect(contractApi.remove).toHaveBeenCalledTimes(2)
    expect(w.emitted('deleted')).toHaveLength(1)
  })
})

// 块内提示(画布 01-A 卡3 / 06-B ④):租金行没绑单元 → 「标的段与费用」块里一行黄条 + 「去绑定」(= 编辑弹窗里每段的「面积落在」)
describe('标的段与费用 · 租金行未绑单元', () => {
  // 破坏验证:FPNote 的 v-if 改成恒 false → 红;@action 不 emit edit → 红
  it('❗有未绑的租金行:块里出「租金行还没绑单元 · 去绑定」,点去绑定打开编辑', async () => {
    const c = { ...CONTRACT, unboundTermCount: 2 }
    const w = mount(ContractDrawer, { props: { contract: c } })
    mounted.push(w)
    await flushPromises()
    const note = w.find('.fp-note')
    expect(note.exists()).toBe(true)
    expect(note.classes()).toContain('warn')
    expect(note.text()).toContain('租金行还没绑单元')
    expect(note.element.closest('.cd-note')!.parentElement!.textContent, '要在「标的段与费用」那块里').toContain('标的段与费用')
    expect(note.find('button').text()).toBe('去绑定')
    await note.find('button').trigger('click')
    expect(w.emitted('edit')).toEqual([[c]])
  })

  // 破坏验证:去掉 #action 上的 v-if="auth.can('contracts:edit')" → 只读用户也有「去绑定」→ 红
  it('全绑了不出;没有编辑权限只说不给「去绑定」', async () => {
    const ok = mount(ContractDrawer, { props: { contract: { ...CONTRACT, unboundTermCount: 0 } } })
    mounted.push(ok)
    await flushPromises()
    expect(ok.find('.fp-note').exists()).toBe(false)
    // 全绑了提示位也在(常驻 32px 预留,2026-10-03 横条收尾),只是空的 —— 下面的费用网格不跟着跳
    expect(ok.find('.cd-note').exists()).toBe(true)
    expect(ok.find('.cd-note').text()).toBe('')
    // 预留位的高:常驻 32(= FPNote 的 min-height),有没有提示下面的费用网格都在同一处。破坏验证:min-height 删掉 → 红
    const src = readFileSync(join(__dirname, 'ContractDrawer.vue'), 'utf8')
    expect(src).toMatch(/\.cd-note \{ margin-top:8px; min-height:32px; \}/)
    useAuthStore().permissions = []
    const ro = mount(ContractDrawer, { props: { contract: { ...CONTRACT, unboundTermCount: 1 } } })
    mounted.push(ro)
    await flushPromises()
    expect(ro.find('.fp-note').text()).toContain('租金行还没绑单元')
    expect(ro.find('.fp-note button').exists()).toBe(false)
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
