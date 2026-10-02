// 楼栋损耗的固定列与表格高度(LIST-PAGE-SPEC §9;计划 W6,画布 07-C 楼栋损耗行)。
// 钉什么:「位置」列不再锁 360 —— 宽 = min(最长名估宽, 可见宽 1/5),超了省略、悬停(v-tip)看全称;
// 表格区在 v-else 里(首载完才出现),靠 useWideTable 的 watch(wrap) 接上;高度按 0/38/34/40 分级。
// 断言钉渲染出来的 width 像素,不钉配置对象。
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { rowsNotEndingInFill, stubWideTable } from '@/composables/__tests__/wideTableStub'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import type { AllocLossDTO, AllocLossUnitDTO } from '@/api/alloc'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
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
vi.mock('@/api/alloc', () => ({
  allocApi: {
    loss: vi.fn(),
    saveLossNote: vi.fn(() => Promise.resolve()),
    poolMonths: vi.fn(() => Promise.resolve([])),
    lossMonths: vi.fn(() => Promise.resolve([])),
  },
}))
vi.mock('@/api/params', () => ({
  paramsApi: { list: vi.fn(() => Promise.resolve([])), status: vi.fn(() => Promise.resolve(null)) },
}))
vi.mock('@/api/meters', () => ({ metersApi: { months: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/api/zones', () => ({
  zonesApi: { list: vi.fn(() => Promise.resolve([{ code: 'p1', name: '一期' }, { code: 'p2', name: '二期' }])) },
}))
vi.mock('@/api/review', () => ({
  reviewApi: {
    closedMonths: vi.fn().mockResolvedValue([]),
    states: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(),
  },
}))

import LossLedgerView from '../alloc/LossLedgerView.vue'
import { allocApi } from '@/api/alloc'

const unit = (p: Partial<AllocLossUnitDTO>): AllocLossUnitDTO => ({
  headBuildingId: 20, label: '一期 B座', zone: 'p1',
  cQty: 5318.4, cableQty: null, dQty: 5399.07, eQty: 80.67, rawRate: 0.0152,
  gQty: 86.8, adjQty: null, adjRate: 0.005, variant: 'net', tenantRate: 0.0202, note: null,
  formulaRate: 0.0202, manualRate: null, gParts: null, gDiv: null, ...p,
})
// 20 个字的位置名估宽 272;对账行名最长的「B-G座总电 + A座总电 vs 全部楼栋分表合计」估宽 280
const LONG = '二期二车间三车间四车间五车间公共照明总表'
// 14 个字估宽 197,加「仅按公摊分摊度数」签 108 = 305,比对账行 280 长 —— 签的估宽决定列宽
const MID = '二期联合厂房东侧公共照明总表'
const RECON: AllocLossDTO['recon'] = [
  { zone: 'p1', supplyLabel: 'B-G座总电', sumLabel: '除一期 A座外各栋',
    supplyQty: 68320, sumC: 63054.4, sumD: 62923.96,
    lossVsC: -5265.6, rateVsC: -0.0771, lossVsD: -5396.04, rateVsD: -0.079 },
  { zone: 'p1', supplyLabel: 'B-G座总电 + A座总电', sumLabel: '全部楼栋',
    supplyQty: 106870, sumC: 101604.4, sumD: 97800.46,
    lossVsC: -5265.6, rateVsC: -0.0493, lossVsD: -9069.54, rateVsD: -0.0849 },
]
const loss = (units: AllocLossUnitDTO[]): AllocLossDTO => ({ generated: true, units, recon: RECON })

let ro: ReturnType<typeof stubWideTable>
const fire = (w: number, h: number) => ro.fire(w, h)

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['billing-run:edit']
  ro = stubWideTable('ll-wrap')
})
// 只还原自己打的桩:vi.restoreAllMocks() 会把上面 vi.mock 里 reviewApi 的 mockResolvedValue 一起抹掉,
// 第 2 条起 FPReviewActions 的 states(year).then 报 Unhandled Rejection,vitest 以退出码 1 收场
afterEach(() => { ro.restore() })

async function open(units: AllocLossUnitDTO[]) {
  vi.mocked(allocApi.loss).mockResolvedValue(loss(units))
  useBillingPeriodStore().pick(2025, 3)
  const w = mount(LossLedgerView, { attachTo: document.body, global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
const lblTh = (w: Awaited<ReturnType<typeof open>>) =>
  w.findAll<HTMLElement>('thead th').find(th => th.text() === '位置')!.element.style
type TipEl = HTMLElement & { _tip?: { text: string } }

describe('楼栋损耗 · 位置列', () => {
  it('可见 1000 + 20 字位置名:位置列宽 = 1000/5 = 200,名字和对账行名都悬停看全称', async () => {
    const w = await open([unit({ headBuildingId: 31, label: LONG, zone: 'p1' }), unit({ headBuildingId: 13, label: '一期 A座' })])
    await fire(1000, 800)
    expect(lblTh(w).width).toBe('200px')
    const td = w.findAll<HTMLElement>('tbody td.ll-fix')[0].element
    expect(td.style.width).toBe('200px')
    expect(td.style.left).toBe('0px')
    expect((td.querySelector('.ll-lbl-t') as TipEl)._tip?.text).toBe(LONG)
    // 对账行名最长估宽 280,在 200 里同样被截
    expect(w.findAll('tbody tr.ll-recon td.ll-fix .ll-lbl-t').map(s => (s.element as TipEl)._tip?.text)).toEqual([
      'B-G座总电 vs 除一期 A座外各栋总表合计', 'B-G座总电 vs 除一期 A座外各栋分表合计',
      'B-G座总电 + A座总电 vs 全部楼栋总表合计', 'B-G座总电 + A座总电 vs 全部楼栋分表合计',
    ])
    w.unmount()
  })

  it('可见 2000 + 短名:按最长的名字(对账行 280)算,不再锁 360', async () => {
    const w = await open([unit({}), unit({ headBuildingId: 13, label: '一期 A座' })])
    await fire(2000, 800)
    expect(lblTh(w).width).toBe('280px')
    w.unmount()
  })

  // 核算方式签不缩:手机档 1/5 = 71 放不下「仅按公摊分摊度数」102,不设下限名字被挤成 0 宽、悬停碰不到
  it.each([
    ['share_only', 168],   // 3 个字 60 + 签 108 → 名字分到 168 − 20 − 6 − 102 = 40 ≥ 37.5
    ['none', 113],         // 3 个字 60 + 签 53
  ] as const)('可见 358 + %s 签:位置列不低于「3 个字 + 签」= %ipx', async (variant, px) => {
    const w = await open([unit({ headBuildingId: 31, label: LONG, variant })])
    await fire(358, 800)
    expect(lblTh(w).width).toBe(px + 'px')
    expect(w.findAll<HTMLElement>('tbody td.ll-fix')[0].element.style.width).toBe(px + 'px')
    w.unmount()
  })

  it('可见 2000:核算方式签计入估宽,14 字名 + 签 = 305 比对账行 280 长,按 305', async () => {
    const w = await open([unit({ label: MID, variant: 'share_only' })])
    await fire(2000, 800)
    expect(lblTh(w).width).toBe('305px')
    w.unmount()
  })

  it('换月(units 换了):按新数据重算,位置列缩回对账行的 280', async () => {
    const w = await open([unit({ label: MID, variant: 'share_only' })])
    await fire(2000, 800)
    expect(lblTh(w).width).toBe('305px')
    vi.mocked(allocApi.loss).mockResolvedValue(loss([unit({})]))
    useBillingPeriodStore().pick(2025, 4)
    await flushPromises()
    expect(lblTh(w).width).toBe('280px')
    w.unmount()
  })

  it('名字超了省略:.ll-lbl-t 是 overflow hidden + ellipsis + min-width 0(签不缩,先挤的是它)', async () => {
    ro.injectCss('views/alloc/LossLedgerView.vue')
    const w = await open([unit({ headBuildingId: 31, label: LONG })])
    await fire(1000, 800)
    const cs = getComputedStyle(w.get('tbody td.ll-fix .ll-lbl-t').element)
    expect([cs.overflow, cs.textOverflow, parseFloat(cs.minWidth)]).toEqual(['hidden', 'ellipsis', 0])
    w.unmount()
  })
})

// 最右空列(LIST-PAGE §4 列宽铁律,2026-10-02 用户拍板):表格区比各列合计宽时,余宽全落在每行末尾那一格空列,
// 位置列和 10 根定宽列都不再按比例摊。jsdom 不排版,钉结构和宽度样式
describe('楼栋损耗 · 最右空列', () => {
  // 破坏验证:对账行 :colspan="colCount - 6" 后面那格 fp-fill 删掉 → 红(列出 4 行对账行)
  it('可见 3000:表头、单元行、对账行、合计行的最右一格都是空列;位置列 = 最长名估宽 280,不吃余宽', async () => {
    const w = await open([unit({}), unit({ headBuildingId: 13, label: '一期 A座' })])
    await fire(3000, 800)
    expect(w.findAll('tbody tr.ll-recon').length, '前提:对账行出来了').toBeGreaterThan(0)
    expect(rowsNotEndingInFill(w.get('table.ll-table').element)).toEqual([])
    expect(lblTh(w).width).toBe('280px')
    w.unmount()
  })
})

describe('楼栋损耗 · 表格高度(0/38/34/40)', () => {
  // 没有分组表头:0 级与 1 级同门槛 38 + 40 + 8×34 = 350;不够先让合计不贴底,再不够给表格区 310 的底
  it.each([
    [350, false, ''],
    [349, true, ''],
    [309, true, '310px'],
  ] as const)('表格区 %i:合计不贴底 %s,min-height「%s」', async (h, free, minH) => {
    ro.injectCss('views/alloc/LossLedgerView.vue')
    const w = await open([unit({}), unit({ headBuildingId: 13, label: '一期 A座' })])
    await fire(1200, h)
    expect(w.get('table.ll-table').classes().includes('hs-foot')).toBe(free)
    expect(getComputedStyle(w.get('tfoot th').element).bottom).toBe(free ? 'auto' : '0px')
    expect((w.get('.ll-wrap').element as HTMLElement).style.minHeight).toBe(minH)
    w.unmount()
  })
})
