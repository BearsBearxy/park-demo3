// 催缴单屏里 METER-TIMELINE-SPEC §5 落到前端的三件事(C3):
//   ① 明细表行与当月档案比不上 → 行上写「档案现归 X」(后端 detail 的 archiveTenantName);比得上不出字;
//   ② 已导出户抽屉里的「作废」:理由必填,逐张调 void(id, reason);浏览态没有入口、直呼也打不出去;
//   ③ 需重算只因抄表 → 组名「改过抄表还没重算」,不再一律说参数。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import {
  billNoticesApi,
  type BillNoticeDTO, type BillNoticeDetailDTO, type BillNoticeLineDTO,
} from '@/api/billNotices'
import { paramsApi, type ParamStatusDTO } from '@/api/params'
import { contractApi } from '@/api/contract'
import { buildingApi } from '@/api/building'
import { companyBookApi } from '@/api/billDelivery'
import { billsApi } from '@/api/bills'
import BillNoticesView from '@/views/bills/BillNoticesView.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))
vi.mock('@/api/billNotices', () => ({
  billNoticesApi: {
    list: vi.fn(), months: vi.fn(), detail: vi.fn(),
    notes: vi.fn(), saveNote: vi.fn(), deleteNote: vi.fn(),
    generate: vi.fn(), issue: vi.fn(), void: vi.fn(),
  },
}))
vi.mock('@/api/review', () => ({
  reviewApi: {
    closedMonths: vi.fn().mockResolvedValue([]),
    states: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { status: vi.fn(), list: vi.fn(), put: vi.fn() } }))
vi.mock('@/api/contract', () => ({ contractApi: { list: vi.fn() } }))
vi.mock('@/api/building', () => ({ buildingApi: { list: vi.fn() } }))
vi.mock('@/api/bills', () => ({ billsApi: { paymap: vi.fn(), setPaymap: vi.fn() } }))
vi.mock('@/api/billDelivery', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/billDelivery')>(),
  companyBookApi: { list: vi.fn() },
  billDeliveryApi: { confirm: vi.fn(), markExported: vi.fn() },
}))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

// ── 夹具按真实 DTO 声明 ──
const elecLine = (p: Partial<BillNoticeLineDTO>): BillNoticeLineDTO => ({
  lineNo: 1, feeKey: 'elec', premise: '一期 A座602室',
  meterId: 11, meterLabel: 'A座6楼·电表①', contractId: 77, seg: null,
  prevRead: 1000, currRead: 1200, factorSnap: 1,
  qty: 200, priceSnap: 0.9, priceKey: null, priceScope: null, priceMonth: null,
  ruleBranch: null, poolRuleId: null, poolName: null, shareSrc: null, baseSnap: null,
  amount: 180, note: null, feeGroup: 'elec', archiveTenantId: null, archiveTenantName: null, ...p,
})
const notice = (status: string): BillNoticeDTO => ({
  id: 91, ym: '2026-08', tenantId: 5, tenantName: '力灏',
  payCompanyId: 3, payCompanyName: '甲公司', noticeKind: 'combined',
  premiseText: '一期 A座602室', totalAmount: 360, prevDue: 0,
  status, warns: [], lineCount: 2,
})
const DETAIL: BillNoticeDetailDTO = {
  id: 91, ym: '2026-08', tenantId: 5, tenantName: '力灏',
  payCompanyId: 3, payCompanyName: '甲公司', noticeKind: 'combined',
  premiseText: '一期 A座602室', totalAmount: 360, prevDue: 0,
  status: 'exported', warns: [],
  lines: [
    elecLine({ lineNo: 1, meterId: 11, meterLabel: 'A座6楼·电表①', note: '引擎备注甲' }),
    // 档案本月挂在别户:后端给了 id 与名字
    elecLine({ lineNo: 2, meterId: 12, meterLabel: 'A座6楼·电表②', archiveTenantId: 8, archiveTenantName: '乙科技' }),
  ],
}
const STATUS: ParamStatusDTO = {
  priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
  poolSnapshotAt: '2026-08-16T16:37:51', billBatchAt: '2026-08-20T13:41:34',
  stale: false, otherMonthsAffected: [],
}

interface Vm { dlgTab: string; editMode: boolean; voidTenant: (tid: number) => Promise<void> }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore().permissions = ['billing-run:edit', 'billing-issue:edit']
  vi.mocked(billNoticesApi.list).mockResolvedValue([notice('exported')])
  vi.mocked(billNoticesApi.detail).mockResolvedValue(DETAIL)
  vi.mocked(billNoticesApi.notes).mockResolvedValue([])
  vi.mocked(billNoticesApi.void).mockResolvedValue(notice('void'))
  vi.mocked(paramsApi.status).mockResolvedValue(STATUS)
  vi.mocked(contractApi.list).mockResolvedValue([])
  vi.mocked(buildingApi.list).mockResolvedValue([])
  vi.mocked(companyBookApi.list).mockResolvedValue([])
  vi.mocked(billsApi.paymap).mockResolvedValue([])
})

async function open() {
  useBillingPeriodStore().pick(2026, 8)
  const w = mount(BillNoticesView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
type Wrapper = Awaited<ReturnType<typeof open>>
async function openDrawer(w: Wrapper) {
  await w.findAll('.bn-table tbody tr').find(r => r.find('.bn-tname').exists())!.trigger('click')
  await flushPromises()
}
async function enterEdit(w: Wrapper) {
  await w.find('.fp-emb').trigger('click')
  await flushPromises()
}

describe('催缴单 · 明细行档案比对', () => {
  // 破坏验证:archText 里 `if (n == null) return null` 改成 `return null`(恒不出字)→ 本条红
  it('❗档案现归别户的那一行写「档案现归 乙科技」,一致的那一行不出字', async () => {
    const w = await open()
    await openDrawer(w)
    ;(w.vm as unknown as Vm).dlgTab = 'util'
    await flushPromises()
    const rows = w.findAll('.bn-dtable tbody tr').filter(r => r.text().includes('A座6楼·电表'))
    expect(rows).toHaveLength(2)
    const [same, moved] = rows
    expect(moved.find('.bn-arch').text()).toBe('档案现归 乙科技')
    expect(same.find('.bn-arch').exists()).toBe(false)
    expect(same.text()).toContain('引擎备注甲')
  })
})

describe('催缴单 · 已导出户作废', () => {
  // 破坏验证:footer 里去掉 exported 分支的「作废」按钮 → 找不到按钮红;
  //           voidTenant 里 billNoticesApi.void 不带 reason → toHaveBeenCalledWith 红
  it('❗编辑态下已导出户有「作废」,理由带给后端,作废后重拉本月', async () => {
    const w = await open()
    await enterEdit(w)
    await openDrawer(w)
    const btn = w.findAll('button').find(b => b.text() === '作废')
    expect(btn, '已导出户抽屉里该有作废').toBeTruthy()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce('  档案归错了户  ')
    const listCalls = vi.mocked(billNoticesApi.list).mock.calls.length
    await btn!.trigger('click')
    await flushPromises()
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(billNoticesApi.void).toHaveBeenCalledWith(91, '档案归错了户')
    expect(vi.mocked(billNoticesApi.list).mock.calls.length, '作废后重拉本月').toBe(listCalls + 1)
    prompt.mockRestore()
  })

  // 破坏验证:删掉 voidTenant 开头的 `!canIssue.value ||` → 浏览态直呼打得出 void → 红
  it('❗浏览态没有「作废」入口;直呼 voidTenant 也打不出去', async () => {
    const w = await open()
    await openDrawer(w)
    expect((w.vm as unknown as Vm).editMode).toBe(false)
    expect(w.findAll('button').some(b => b.text() === '作废')).toBe(false)
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('理由')
    await (w.vm as unknown as Vm).voidTenant(5)
    await flushPromises()
    expect(billNoticesApi.void).not.toHaveBeenCalled()
    prompt.mockRestore()
  })

  it('理由为空不作废', async () => {
    const w = await open()
    await enterEdit(w)
    await openDrawer(w)
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce('   ')
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await w.findAll('button').find(b => b.text() === '作废')!.trigger('click')
    await flushPromises()
    expect(billNoticesApi.void).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledWith('理由必填')
    prompt.mockRestore(); alert.mockRestore()
  })
})

describe('催缴单 · 需重算的来源', () => {
  // 破坏验证:BillNoticesView 的 title 换回写死的 '改过参数还没重算' → 红
  it('❗只因抄表过期 → 组名「改过抄表还没重算」,主语是抄表数据', async () => {
    vi.mocked(paramsApi.status).mockResolvedValue({
      ...STATUS, stale: true, lastChangeAt: '2026-08-21T09:00:00', lastChangeSource: 'meter', staleSources: ['meter'],
    })
    const w = await open()
    await w.find('button.fac').trigger('click')
    await flushPromises()
    const t = w.text()
    expect(t).toContain('改过抄表还没重算')
    expect(t).toContain('抄表数据（读数或表档案）在本月催缴单生成之后又改过')
    expect(t).toContain('最近一次改动 08-21 09:00')
    expect(t).not.toContain('改过参数还没重算')
  })
})
