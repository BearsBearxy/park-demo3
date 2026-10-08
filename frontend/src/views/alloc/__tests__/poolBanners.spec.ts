// 横条收尾(2026-10-03,实现规范 §2「横条盘点」PoolLedgerView 两行):
//   ① 池配置抽屉「摊给谁」段:名单上方那块黄色「该定位本月租户有变动:新在租 …;已退租 …」撤掉,
//      改在名单行上就地标「新在租」「已退租」—— 那块一出现就把名单往下推;
//   ② 分摊方式选「园区自担」:原来是一条 ⓘ 黄条,改成空状态外形(FPEmpty sm),它本来就是换掉名单。
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import type { AllocPoolRowDTO } from '@/api/alloc'

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
    meterDiff: vi.fn(() => Promise.resolve([])),
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
  metersApi: { list: vi.fn(() => Promise.resolve([])), months: vi.fn(() => Promise.resolve([])), meterReadings: vi.fn() },
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

import PoolLedgerView from '../PoolLedgerView.vue'
import { allocApi } from '@/api/alloc'

// 夹具:名单里三户 —— 一户本月新在租(还没勾)、一户已退租(还勾着)、一户照常;不退化成「全是新在租」
const ROW: AllocPoolRowDTO = {
  ruleId: 23, zone: 'p1', name: 'A座·电梯', bookBlock: null, bookKey: null, groupLabel: 'A座',
  method: 'area', stdKind: null, roundScale: 2, baseKey: null, sortNo: 1, note: null,
  buildingId: 13, buildingName: 'A座', floorLabel: null, side: null, feeName: '电梯', feeKey: 'share_elec',
  autoName: 'A座·电梯', autoMembers: false, links: [], lines: [], meters: [],
  members: [
    { tenantId: 6, tenantName: '旧户', unitNo: null, weight: null, inForce: 'yes', floorLabel: null },
    { tenantId: 7, tenantName: '老住户', unitNo: null, weight: null, inForce: 'yes', floorLabel: null },
  ],
  qtyTotal: null, qtySharp: null, qtyPeak: null, qtyFlat: null, qtyValley: null, extraQty: null,
  costAmount: null, baseSnap: null, stdValue: null, foldAdd: null, priceSnap: null,
  allocatedAmount: null, gapAmount: null, warn: null,
} as unknown as AllocPoolRowDTO
const cand = (tenantId: number, tenantName: string) => ({ tenantId, tenantName, unitNo: null, inForce: 'yes' as const, preChecked: null })

interface Vm { openPoolDlg: (r?: AllocPoolRowDTO) => void }
const mounted: VueWrapper[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['alloc:edit', 'alloc:pools']
  vi.mocked(allocApi.memberDiff).mockResolvedValue([
    { ruleId: 23, poolName: 'A座·电梯', added: [cand(5, '新户')], removed: [cand(6, '旧户')] },
  ])
  vi.mocked(allocApi.poolCandidates).mockResolvedValue(
    { meters: [], tenants: [cand(5, '新户'), cand(6, '旧户'), cand(7, '老住户')], tenantNote: null } as never)
})
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()); document.body.innerHTML = '' })

async function openPool(row: AllocPoolRowDTO) {
  useBillingPeriodStore().pick(2025, 3)
  const w = mount(PoolLedgerView, { attachTo: document.body })
  mounted.push(w)
  await flushPromises()
  ;(w.vm as unknown as Vm).openPoolDlg(row)
  await flushPromises()
  return w
}
const memberRow = (name: string) =>
  [...document.querySelectorAll('.pl-bindrow')].find(r => r.querySelector('.nm')?.textContent === name) as HTMLElement
/** 只看「新在租 / 已退租」这两颗(楼层签等别的签不归这条管) */
const chips = (name: string) => [...memberRow(name).querySelectorAll('.pl-chip')].map(c => c.textContent!.trim())
  .filter(t => t === '新在租' || t === '已退租')

describe('池配置 · 名单变动就地标', () => {
  // 破坏验证:把汇总块加回来 / diffAdded 那颗签删掉 / 已退租判据去掉 diffRemoved → 红
  it('❗名单上方没有变动汇总块;新在租那户标「新在租」,已退租那户标「已退租」,照常那户都不标', async () => {
    await openPool(ROW)
    expect(document.body.textContent).not.toContain('该定位本月租户有变动')
    expect([...document.querySelectorAll('.pl-innerwarn')].map(e => e.className),
      '只剩常驻占位的缺日期那一格').toEqual(['pl-innerwarn pl-nodatewarn blank'])
    expect(chips('新户')).toEqual(['新在租'])
    expect(chips('旧户')).toEqual(['已退租'])
    expect(chips('老住户')).toEqual([])
    const tip = (memberRow('新户').querySelector('.pl-chip') as HTMLElement & { _tip?: { text: string } })._tip?.text
    expect(tip).toBe('本月在租,还不在受益人里')
  })

  // 破坏验证:FPEmpty 换回 .pl-innerwarn 黄条 → 红
  it('❗园区自担:受益人位置是空状态「这里没有受益人可选」+ 一句为什么,没有 ⓘ 黄条', async () => {
    await openPool({ ...ROW, method: 'none', members: [] } as unknown as AllocPoolRowDTO)
    const empty = document.querySelector('.pl-sec .fp-empty.sm') as HTMLElement
    expect(empty, '空状态外形').toBeTruthy()
    expect(empty.querySelector('.sub')!.textContent).toBe('不摊给租户,全额挂园区亏')
    expect(empty.textContent).toContain('这里没有受益人可选')
    expect(document.body.textContent).not.toContain('—— 这里没有受益人可选')
    expect(document.querySelectorAll('.pl-innerwarn')).toHaveLength(0)
  })
})
