// 公共电核算 · 池编辑里的表按月看(METER-TIMELINE-SPEC §5,C3):
//   ① 池里本月已拆 / 停用的表灰显,并写明「自 M 起已拆，不计」(池引擎自该月起不算它);在用的不出这句;
//   ② 移出打开抽屉时就在池里的表 → 先查读数,确认框点名有读数的月份;取消 = 表还在池里、勾选框拨回;
//      本次刚勾上的表取消勾选不问、不查读数;
//   ③ 全库搜表的清单站在本页账期取(GET /meters 带 ym)。
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import type { AllocPoolRowDTO } from '@/api/alloc'
import type { MeterDTO, MeterReadingDTO } from '@/api/meters'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {} }) }))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))
vi.mock('@/api/alloc', () => ({
  allocApi: {
    pools: vi.fn(() => Promise.resolve({ generated: false, rows: [] })),
    memberDiff: vi.fn(() => Promise.resolve([])),
    rules: vi.fn(() => Promise.resolve([])),
    poolCandidates: vi.fn(() => Promise.resolve({ meters: [], tenants: [], tenantNote: null })),
    poolMonths: vi.fn(() => Promise.resolve([])),
    lossMonths: vi.fn(() => Promise.resolve([])),
  },
}))
vi.mock('@/api/params', () => ({
  paramsApi: {
    list: vi.fn(() => Promise.resolve([])),
    status: vi.fn(() => Promise.resolve({
      priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
      poolSnapshotAt: null, billBatchAt: null, stale: false, otherMonthsAffected: [],
    })),
  },
}))
vi.mock('@/api/meters', () => ({
  metersApi: {
    list: vi.fn(() => Promise.resolve([])),
    months: vi.fn(() => Promise.resolve([])),
    meterReadings: vi.fn(),
  },
}))
vi.mock('@/api/building', () => ({ buildingApi: { list: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/api/review', () => ({
  reviewApi: {
    closedMonths: vi.fn().mockResolvedValue([]), states: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]), submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(),
  },
}))

import PoolLedgerView from '../alloc/PoolLedgerView.vue'
import { metersApi } from '@/api/meters'

const reading = (ym: string, usageTotal: number | null): MeterReadingDTO => ({
  id: 1, meterId: 11, ym, prevTotal: 0, currTotal: usageTotal, prevSharp: null, prevPeak: null, prevFlat: null,
  prevValley: null, currSharp: null, currPeak: null, currFlat: null, currValley: null, factorSnap: 1,
  usageTotal, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null, note: null, source: 'import',
})
// 真实形状:池里两块表,一块 2024-03 起已拆、一块在用;另有一块 2025-01 起停用
const ROW: AllocPoolRowDTO = {
  ruleId: 23, zone: 'p1', name: 'A座·电梯', bookBlock: null, bookKey: null, groupLabel: 'A座',
  method: 'floor', stdKind: null, roundScale: 2, baseKey: null, sortNo: 1, note: null,
  buildingId: 13, buildingName: 'A座', floorLabel: null, side: null, feeName: '电梯', feeKey: 'share_elec_floor',
  autoName: 'A座·电梯', autoMembers: false, members: [], links: [], lines: [],
  meters: [
    { meterId: 11, name: 'A-EL-1', sign: 1, label: 'A座·东梯电表', spot: null, subName: null, meterType: null, status: 'removed', statusFrom: '2024-03' },
    { meterId: 12, name: 'A-EL-2', sign: 1, label: 'A座·西梯电表', spot: null, subName: null, meterType: null, status: 'active', statusFrom: '2023-08' },
    { meterId: 13, name: 'A-EL-3', sign: 1, label: 'A座·货梯电表', spot: null, subName: null, meterType: null, status: 'retired', statusFrom: '2025-01' },
  ],
  qtyTotal: null, qtySharp: null, qtyPeak: null, qtyFlat: null, qtyValley: null, extraQty: null,
  costAmount: null, baseSnap: null, stdValue: null, foldAdd: null, priceSnap: null,
  allocatedAmount: null, gapAmount: null, warn: null,
}

// 全库里一块不在池里的表(搜得到),2024-06 起已拆
const M99: MeterDTO = {
  id: 99, kind: 'elec', zone: 'p1', name: 'X-99', area: 'A座', spot: '天面', floorLabel: null, side: null, roomNo: null,
  tenantName: '天面风机', tenantId: null, buildingId: 13, ownership: 'share', meterType: null, deviceType: null,
  subName: null, code: null, factor: 1, status: 'removed', statusFrom: '2024-06', statusUntil: null,
  assignFrom: '2023-08', assignUntil: null, assignSrc: 'migrate', changedThisMonth: false, sortNo: 1, readingCount: 3,
}

interface Vm { openPoolDlg: (r?: AllocPoolRowDTO) => void; form: { meters: { meterId: number }[] } }

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['billing-run:edit', 'param-policy:edit']
  vi.mocked(metersApi.meterReadings).mockReset()
})

// 抽屉 Teleport 到 body:中途红了的用例若没走到 unmount,残留的行会被下一条的 bindRow 捡到 → 连坐。统一在这里收
const mounted: VueWrapper[] = []
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()); document.body.innerHTML = '' })

async function openPool() {
  useBillingPeriodStore().pick(2025, 3)
  const w = mount(PoolLedgerView, { attachTo: document.body })
  mounted.push(w)
  await flushPromises()
  ;(w.vm as unknown as Vm).openPoolDlg(ROW)
  await flushPromises()
  return w
}
const bindRow = (label: string) =>
  [...document.querySelectorAll('.pl-bindrow')].find(r => r.querySelector('.nm')?.textContent === label) as HTMLElement

describe('池编辑 · 表按月看', () => {
  // 破坏验证:offText 里 removed 那一支改成 return null → 红
  it('❗本月已拆 / 停用的表灰显并写明自哪月起不计;在用的不出', async () => {
    await openPool()
    const gone = bindRow('A座·东梯电表')
    expect(gone.classList.contains('off')).toBe(true)
    expect(gone.textContent).toContain('自 2024-03 起已拆，不计')
    expect(gone.textContent).not.toContain('其他位置')
    expect(bindRow('A座·货梯电表').textContent).toContain('自 2025-01 起停用，不计')
    const live = bindRow('A座·西梯电表')
    expect(live.classList.contains('off')).toBe(false)
    expect(live.textContent).not.toContain('不计')
  })

  // 破坏验证:toggleBind 里去掉 confirmUnbind 那一步(直接 splice)→ 取消确认后表还是被移出 → 红;
  //           confirmUnbind 的 filter 去掉 `usageTotal !== 0` → 月份清单多出 2024-01 → 红
  it('❗移出池里原有的表:确认框点名有读数的月份;取消 = 还在池里、框拨回勾上', async () => {
    vi.mocked(metersApi.meterReadings).mockResolvedValue([
      reading('2024-02', 35), reading('2023-10', 120), reading('2024-01', 0),
    ])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    const w = await openPool()
    const box = bindRow('A座·西梯电表').querySelector('input') as HTMLInputElement
    box.click()
    await flushPromises()
    expect(metersApi.meterReadings).toHaveBeenCalledWith(12)
    expect(confirm.mock.calls[0][0]).toContain('这 2 个月有读数(用量非零):2023-10、2024-02')
    expect((w.vm as unknown as Vm).form.meters.map(m => m.meterId)).toContain(12)
    expect(box.checked, '取消后勾选框要拨回').toBe(true)
    // 再点一次、这回确认 → 真的移出
    confirm.mockReturnValueOnce(true)
    box.click()
    await flushPromises()
    expect((w.vm as unknown as Vm).form.meters.map(m => m.meterId)).not.toContain(12)
    confirm.mockRestore()
  })

  it('没有读数的表移出不问', async () => {
    vi.mocked(metersApi.meterReadings).mockResolvedValue([reading('2024-01', 0)])
    const confirm = vi.spyOn(window, 'confirm')
    const w = await openPool()
    ;(bindRow('A座·西梯电表').querySelector('input') as HTMLInputElement).click()
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect((w.vm as unknown as Vm).form.meters.map(m => m.meterId)).not.toContain(12)
    confirm.mockRestore()
  })

  // 破坏验证:offText 去掉 `metersYm.value === ym.value ?` 那层(直接查 meterById)→ 切月重拉失败后
  //           还拿 3 月的清单说 4 月「已拆」→ 最后一条断言红
  it('❗切月重拉表清单失败 → 不拿上个月那份说本月的在册状态', async () => {
    vi.mocked(metersApi.list).mockResolvedValueOnce([M99]).mockRejectedValue(new Error('网关超时'))
    await openPool()
    const q = document.querySelector('.pl-bindq') as HTMLInputElement
    q.value = 'X-99'; q.dispatchEvent(new Event('input'))
    await flushPromises()
    const row = () => [...document.querySelectorAll('.pl-bindrow')].find(r => r.textContent?.includes('天面风机')) as HTMLElement
    expect(row().textContent, '前置:3 月那份清单说它已拆').toContain('自 2024-06 起已拆，不计')
    useBillingPeriodStore().pick(2025, 4)
    await flushPromises()
    expect(metersApi.list).toHaveBeenLastCalledWith('elec', undefined, '2025-04')
    expect(row().textContent).not.toContain('已拆')
    vi.mocked(metersApi.list).mockReset().mockResolvedValue([])
  })

  // 破坏验证:loadMeters 里不传 ym → 红
  it('❗全库表清单带本页账期', async () => {
    vi.mocked(metersApi.list).mockClear()
    await openPool()
    expect(metersApi.list).toHaveBeenCalledWith('elec', undefined, '2025-03')
  })
})
