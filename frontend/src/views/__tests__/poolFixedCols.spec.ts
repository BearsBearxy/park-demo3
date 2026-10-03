// 公共电核算的固定列与表格高度(LIST-PAGE-SPEC §9;计划 W8,画布 07-C 公共电核算行)。
// 钉什么:用途(rank 0,名称列)→ 位置 走 planFixed —— 左两根合计超过表格可见宽 40% 先退位置;用途封顶 1/5,超了省略、
// 悬停看全称;分组标签格贴住的宽不超过仍固定的列;表格区在 v-else 里(首载完才出现),靠 useWideTable 的 watch(wrap) 接上;
// 高度按 0/40/40/40 分级。断言钉渲染出来的 left / width 像素,不钉配置对象。
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { rowsNotEndingInFill, stubWideTable } from '@/composables/__tests__/wideTableStub'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import type { AllocPoolLineDTO, AllocPoolRowDTO } from '@/api/alloc'

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
    pools: vi.fn(),
    memberDiff: vi.fn(() => Promise.resolve([])),
    meterDiff: vi.fn(() => Promise.resolve([])),
    rules: vi.fn(() => Promise.resolve([])),
    poolMonths: vi.fn(() => Promise.resolve([])),
    lossMonths: vi.fn(() => Promise.resolve([])),
  },
}))
vi.mock('@/api/params', () => ({
  paramsApi: { list: vi.fn(() => Promise.resolve([])), status: vi.fn(() => Promise.resolve(null)) },
}))
vi.mock('@/api/meters', () => ({
  metersApi: { list: vi.fn(() => Promise.resolve([])), months: vi.fn(() => Promise.resolve([])) },
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
import { allocApi } from '@/api/alloc'

const line = (p: Partial<AllocPoolLineDTO>): AllocPoolLineDTO => ({
  meterId: 1, label: 'A座·负一层·地下车库东侧照明·电表①', area: 'A座', spot: '负一层', floorLabel: '负一层',
  useName: '地下车库东侧照明', subName: '电表①', meterType: null, code: null, sign: 1, factorSnap: 1,
  prevTotal: 452.02, currTotal: 497.3, qtyTotal: 45.28, qtySharp: null, qtyPeak: null, qtyFlat: null, qtyValley: null,
  costAmount: 51.9, ...p,
})
const pool = (p: Partial<AllocPoolRowDTO>): AllocPoolRowDTO => ({
  ruleId: 1, zone: 'p1', name: '一期 A座·负一层·地下车库东侧照明', bookBlock: 'A座及园区公共表', bookKey: null, groupLabel: '一期 A座',
  method: 'direct', stdKind: null, roundScale: 2, baseKey: null, sortNo: 1, note: null,
  buildingId: 13, buildingName: '一期 A座', floorLabel: '负一层', side: null, feeName: '地下车库东侧照明', feeKey: 'share_elec_light',
  autoName: '一期 A座·负一层·地下车库东侧照明', autoMembers: false, members: [], links: [],
  meters: [{ meterId: 1, name: 'A-B1-1', sign: 1, label: 'A座·负一层·地下车库东侧照明·电表①', spot: '负一层', subName: '电表①',
    meterType: null, status: 'active', statusFrom: '2023-08' }],
  lines: [line({})],
  qtyTotal: 45.28, qtySharp: null, qtyPeak: null, qtyFlat: null, qtyValley: null, extraQty: null,
  costAmount: 51.9, baseSnap: null, stdValue: null, foldAdd: null, priceSnap: null,
  allocatedAmount: null, gapAmount: null, warn: null, ...p,
})
// 位置最长「招商中心 四楼」:6 个字 + 空格 = 6.6em × 14 → 93 + 2 + 20 = 115;
// 用途最长「公共用电 / 西侧租户」:8 个字 + 3 个半角 = 9.8em → 138 + 2 + 20 = 160
const ROWS = [
  pool({}),
  pool({ ruleId: 2, buildingName: '一期 招商中心', floorLabel: '四楼', feeName: '招商中心电1', sortNo: 2,
    lines: [line({ meterId: 2, area: '招商中心', floorLabel: '四楼', useName: '招商中心电1' })] }),
  pool({ ruleId: 3, bookBlock: 'A座电梯及楼层公共电', floorLabel: '二楼西侧', sortNo: 3,
    lines: [line({ meterId: 3, floorLabel: '二楼西侧', useName: '公共用电 / 西侧租户' })] }),
]
// 20 个字的用途名估宽 14 × 20 + 22 = 302
const LONG = '园区一期东北角配电房旁公共照明与水泵合用'

let ro: ReturnType<typeof stubWideTable>
beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['billing-run:edit', 'param-policy:edit']
  ro = stubWideTable('pl-wrap')
})
const mounted: VueWrapper[] = []
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()); ro.restore() })

async function open(rows: AllocPoolRowDTO[] = ROWS) {
  vi.mocked(allocApi.pools).mockResolvedValue({ generated: true, rows })
  useBillingPeriodStore().pick(2025, 3)
  const w = mount(PoolLedgerView, { attachTo: document.body, global: { stubs: { Teleport: true } } })
  mounted.push(w)
  await flushPromises()
  return w
}
const th = (w: VueWrapper, text: string) => w.findAll<HTMLElement>('thead th').find(t => t.text() === text)!
const px = (s: string) => parseFloat(s)

describe('公共电核算 · 固定列(用途 → 位置)', () => {
  // 破坏验证:位置的 rank 改成 0(永远不退)→ 第一条红;locSt 不带 fix.style.loc 之外还硬挂 pl-fix → 第二条红
  it('可见 500:两根合计 275 > 200,位置退成普通列,用途贴左 0', async () => {
    const w = await open()
    await ro.fire(500, 800)
    const loc = th(w, '位置')
    expect(loc.element.style.position).toBe('')
    expect(loc.classes()).not.toContain('pl-fix')
    expect(th(w, '用途').element.style.position).toBe('sticky')
    expect(th(w, '用途').element.style.left).toBe('0px')
  })

  // 破坏验证:grpLblSt 位置退了仍贴左 → 红;colspan 退回 1 → 红
  it('可见 500:位置退了,分组标签格照旧跨两列但不贴左(组名不被挤成一两个字,横滚时也不盖小计)', async () => {
    const w = await open()
    await ro.fire(500, 800)
    const lbl = w.find('tr.pl-grp td.pl-glbl')
    expect(lbl.attributes('colspan')).toBe('2')
    expect((lbl.element as HTMLElement).style.position).toBe('')
    expect(lbl.classes()).not.toContain('pl-fix')
  })

  // 破坏验证:useSt 不并 fix.style.use(只给宽)→ 用途 left 不是 115px → 红
  it('可见 1600:两根都固定,用途 left = 位置宽 115,分组标签格跨两列 115 + 160', async () => {
    const w = await open()
    await ro.fire(1600, 800)
    expect(th(w, '位置').element.style.left).toBe('0px')
    expect(th(w, '用途').element.style.left).toBe('115px')
    const lbl = w.find('tr.pl-grp td.pl-glbl')
    expect(lbl.attributes('colspan')).toBe('2')
    expect((lbl.element as HTMLElement).style.width).toBe('275px')
  })

  // 破坏验证:用途去掉 name: true(不封顶)→ 宽 302 → 红
  it('可见 1000 + 20 字用途名:用途封顶 1000/5 = 200,悬停看全称', async () => {
    const w = await open([...ROWS, pool({ ruleId: 9, sortNo: 9, lines: [line({ meterId: 9, useName: LONG })] })])
    await ro.fire(1000, 800)
    expect(th(w, '用途').element.style.width).toBe('200px')
    const nm = w.findAll('tr.pl-row .nm').find(n => n.text() === LONG)!
    expect((nm.element as HTMLElement & { _tip?: { text: string } })._tip?.text).toBe(LONG)
  })
})

// 最右空列(LIST-PAGE §4 列宽铁律,2026-10-02 用户拍板):表格区比各列合计宽时,余宽全落在每行末尾那一格空列,
// 不再按比例摊进电表、用量、应分摊这些列。段行 / 放出实收盈亏后每行列数一致,由 poolLedgerLayout 的 asserts-4 钉
describe('公共电核算 · 最右空列', () => {
  // 破坏验证:分组行 :colspan="tailN" 后面那格 fp-fill 删掉 → 红(列出两行 pl-grp)
  it('可见 3000:表头、分组行、逐表行、合计行的最右一格都是空列;位置 115、用途 160 = 估宽,不吃余宽', async () => {
    const w = await open()
    await ro.fire(3000, 800)
    expect(rowsNotEndingInFill(w.get('table.pl-table').element)).toEqual([])
    expect(th(w, '位置').element.style.width).toBe('115px')
    expect(th(w, '用途').element.style.width).toBe('160px')
  })
})

describe('公共电核算 · 表格高度(0/40/40/50)', () => {
  // 没有分组表头:0 级门槛 列名 40 + 合计 50(03-A)+ 8×40 = 410;不够先让合计不贴底,再不够给表格区一个底、整页往下滚。
  // 那个底挂在 .pl-tablearea 上 = 工具条 44 + 卡边框 2 + .pl-wrap 上边线 1 + 列名 40 + 8×40 = 407:
  // 挂在 .pl-wrap 上的话,外面的卡片是 min-height:0 + overflow:hidden,卡不跟着长,最后几行和横向滚动条被裁掉(对抗复查 regress-1)
  // 破坏验证:table 上 hs-foot 类绑定去掉 → 409 那条红;footH 改回 40 → 409 那条红;
  //   min-height 挂回 .pl-wrap(areaSt 不给)→ 359 那条红
  it.each([
    [410, false, ''],
    [409, true, ''],
    [359, true, '407px'],
  ] as const)('表格区 %i:合计不贴底 %s,表格区 min-height「%s」', async (h, free, minH) => {
    ro.injectCss('views/alloc/PoolLedgerView.vue')
    const w = await open()
    await ro.fire(1200, h)
    expect(w.get('table.pl-table').classes().includes('hs-foot')).toBe(free)
    expect(getComputedStyle(w.get('tfoot th').element).bottom).toBe(free ? 'auto' : '0px')
    expect((w.get('.pl-tablearea').element as HTMLElement).style.minHeight).toBe(minH)
    expect((w.get('.pl-wrap').element as HTMLElement).style.minHeight, '.pl-wrap 自己不挂底').toBe('')
  })
})
