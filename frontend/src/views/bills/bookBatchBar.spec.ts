// 系数簿 / 收款簿:进编辑态,统一修改条换掉工具条右半、不另起一行 —— 表格不往下挪(横条盘点 2026-10-03,
// LAYOUT-STABILITY §1);弹窗开着时顶栏被遮罩盖住,临时授权胶囊挂一枚在弹窗头(画布 08 ElevStates)。
// jsdom 量不了坐标,钉 DOM 结构:表格容器前面的块数、它的序号两态一样。「❗」开头的做过破坏验证。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

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
vi.mock('@/api/params', () => ({ paramsApi: { list: vi.fn(() => Promise.resolve([])), put: vi.fn() } }))
vi.mock('@/api/alloc', () => ({
  allocApi: { pools: vi.fn(() => Promise.resolve({ generated: false, rows: [] })), rules: vi.fn(() => Promise.resolve([])) },
}))
vi.mock('@/api/bills', () => ({ billsApi: { paymap: vi.fn(() => Promise.resolve([])), setPaymap: vi.fn() } }))
vi.mock('@/api/billDelivery', async (orig) => ({
  ...(await orig<typeof import('@/api/billDelivery')>()),
  companyBookApi: { list: vi.fn(() => Promise.resolve([])), payees: vi.fn(() => Promise.resolve([])) },
}))

import api from '@/api'
import CoefBookWindow from '@/views/bills/CoefBookWindow.vue'
import PayBookWindow from '@/views/bills/PayBookWindow.vue'

const settle = async () => { await flushPromises(); await new Promise((r) => setTimeout(r, 0)); await flushPromises() }
let w: VueWrapper | null = null
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('token', 'test-token')
  setActivePinia(createPinia())
})
afterEach(() => { w?.unmount(); w = null })

/** 弹窗内容区的直接子块(class 串),到表格容器为止 */
const blocks = (wrapCls: string) => {
  const kids = [...w!.find('.fp-dwr-body').element.children].map((e) => e.className)
  return kids.slice(0, kids.findIndex((c) => c.includes(wrapCls)) + 1)
}

async function openCoef() {
  w = mount(CoefBookWindow, {
    props: { open: false, ym: '2026-03', phase: '2', contracts: [], buildings: [], years: [2026] },
    global: { stubs: { Teleport: true } },
  })
  await w.setProps({ open: true })
  await settle()
}
async function openPay() {
  w = mount(PayBookWindow, {
    props: { open: false, ym: '2026-03', phase: '2', notices: [], contracts: [], buildings: [] },
    global: { stubs: { Teleport: true } },
  })
  await w.setProps({ open: true })
  await settle()
}

describe('编辑态批量条不加行', () => {
  // 破坏验证:把 .cb-unibar 挪回表格上方单独一行(<div v-if="editMode" class="cb-unibar"> 在 .cb-wrap 前)→ 红
  it('❗系数簿:进编辑态表格前面还是「工具条 + 说明行」两块,工具条换成了统一修改条', async () => {
    useAuthStore().permissions = ['bill-notices:coef']
    await openCoef()
    const before = blocks('cb-wrap')
    expect(before).toEqual(['cb-controls', 'cb-hint', 'cb-wrap'])
    await (w!.vm as unknown as { onEditBtn: () => Promise<void> }).onEditBtn()
    await settle()
    expect((w!.vm as unknown as { editMode: boolean }).editMode, '前置:进了编辑态').toBe(true)
    const after = blocks('cb-wrap')
    expect(after).toHaveLength(before.length)
    expect(after[0]).toBe('cb-controls cb-unibar')
    expect(w!.find('.cb-unibar').text()).toContain('统一修改为')
    expect(w!.find('.cb-unibar .fp-field-err').exists(), '输错的红字在工具条里,不另起一行').toBe(true)
  })

  // 破坏验证:同上,.pb-unibar 挪回单独一行 → 红
  it('❗收款簿:同上', async () => {
    useAuthStore().permissions = ['bill-notices:issue']
    await openPay()
    const before = blocks('pb-wrap')
    expect(before).toEqual(['pb-controls', 'pb-hint', 'pb-wrap'])
    ;(w!.vm as unknown as { editMode: boolean }).editMode = true
    await settle()
    const after = blocks('pb-wrap')
    expect(after).toHaveLength(before.length)
    expect(after[0]).toBe('pb-controls pb-unibar')
    expect(w!.find('.pb-unibar').text()).toContain('统一指定为')
  })
})

describe('弹窗头上挂授权胶囊', () => {
  async function elevate() {
    vi.mocked(api.get).mockResolvedValueOnce([{
      perm: 'bill-notices:coef', permLabel: '催缴单 · 系数簿', authorizer: 'zhang', authorizerName: '张经理', expiresAt: Date.now() + 1_721_500,
    }] as never)
    await useAuthStore().refreshElevation()
  }

  // 破坏验证:删掉系数簿 #badge 里的 <FPElevChip> → 红
  it('❗系数簿、收款簿:有授权时标题旁一枚胶囊,没有时不出', async () => {
    await openCoef()
    expect(w!.find('.fp-dwr-hd .ec-chip').exists()).toBe(false)
    await elevate()
    await settle()
    expect(w!.find('.fp-dwr-hd .ec-chip').text()).toBe('28:41')
    w!.unmount()
    await openPay()
    expect(w!.find('.fp-dwr-hd .ec-chip').exists()).toBe(true)
  })
})
