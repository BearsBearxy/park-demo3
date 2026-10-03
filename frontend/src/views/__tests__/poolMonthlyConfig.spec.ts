// 公共电核算 · 池按月配置(2026-09-26 计划 D5 / D7,V131):
//   ① 「只改本月起」勾选框在抽屉级:园区自担(没有「摊给谁」名单)也出,文案点名电表、折入的标准、受益人三处;
//   ② 初始勾选 = 受益人 / 绑定表 / 折入链 任一处站在本月的有效组来自按月版本(src='month');
//      勾上保存 → memberMonth = 本月;
//   ③ 取整位:既有池只读一句(站在本月的参数值)+「去计费参数页改」,新建池才有选择框;
//   ④ 勾了「只改本月起」,移出表的确认框只点名本月及以后有读数的月份。
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import type { AllocPoolRowDTO } from '@/api/alloc'
import type { ParamRowDTO } from '@/api/params'
import type { MeterReadingDTO } from '@/api/meters'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ query: {} }) }))
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
    createRule: vi.fn(() => Promise.resolve({})),
    updateRule: vi.fn(() => Promise.resolve({})),
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
import { allocApi } from '@/api/alloc'
import { paramsApi } from '@/api/params'
import { metersApi } from '@/api/meters'
import { askQueue, answer } from '@/utils/ask'

type TipEl = HTMLElement & { _tip?: { text: string } }

// 真实形状:二期 #15 五车间广告字灯(纯标准行,折入绿化水泵),绑表 1 块;#16 五车间电梯 2023-10 起绑火炬园表(−1)
const ROW = (p: Partial<AllocPoolRowDTO>): AllocPoolRowDTO => ({
  ruleId: 15, zone: 'p2', name: '二期 五车间·广告字灯', bookBlock: null, bookKey: null, groupLabel: '二期 五车间',
  method: 'ref', stdKind: 'qty_over_base', roundScale: 3, baseKey: 'area_base', sortNo: 1, note: null,
  buildingId: 26, buildingName: '二期 五车间', floorLabel: null, side: null, feeName: '广告字灯', feeKey: 'share_elec_light',
  autoName: '二期 五车间·广告字灯', autoMembers: false, members: [], links: [], lines: [],
  meters: [{ meterId: 57, name: '五车间装饰灯新表', sign: 1, label: '五车间·广告字灯·消防分表', spot: null, subName: null, meterType: null, status: 'active', statusFrom: '2023-08', src: 'default' }],
  qtyTotal: null, qtySharp: null, qtyPeak: null, qtyFlat: null, qtyValley: null, extraQty: null,
  costAmount: null, baseSnap: null, stdValue: null, foldAdd: null, priceSnap: null,
  allocatedAmount: null, gapAmount: null, warn: null, ...p,
})
const MEMBER = { tenantId: 301, tenantName: '园区物业', unitNo: null, weight: null, inForce: 'yes' as const, floorLabel: null }
const LINK = { ruleId: 13, name: '二期园区·绿化水泵', type: 'fold_price' as const }
const reading = (ym: string, usageTotal: number | null): MeterReadingDTO => ({
  id: 1, meterId: 57, ym, prevTotal: 0, currTotal: usageTotal, prevSharp: null, prevPeak: null, prevFlat: null,
  prevValley: null, currSharp: null, currPeak: null, currFlat: null, currValley: null, factorSnap: 1,
  usageTotal, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null, note: null, source: 'import',
})
// 计费参数页同一读口的一行:#15 取整位 2023-10 起 3 位(源册 V76 从 10 月起 ROUND(…,3))
const ROUND_ROW: ParamRowDTO = {
  key: 'round_scale', label: '分摊标准小数位', unit: '', group: 'constant', scope: 'rule:15', scopeLabel: '二期 五车间·广告字灯（池）',
  value: 3, valueText: '四舍五入到 3 位', mode: 'from', acctMonth: '2023-10', rangeText: '2023-10 起长期',
  sourceChain: ['二期 五车间·广告字灯（池）:四舍五入到 3 位'], formula: null, hint: null, editable: true,
  monthlyCheck: false, hasMonthRow: false, rowId: 901, note: null,
}

interface Vm { openPoolDlg: (r?: AllocPoolRowDTO) => void; submitPool: () => Promise<void>; form: { monthOnly: boolean; meters: { meterId: number }[] } }

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['billing-run:edit', 'param-policy:edit']
  vi.mocked(allocApi.updateRule).mockClear()
  vi.mocked(metersApi.meterReadings).mockReset()
  vi.mocked(paramsApi.list).mockReset().mockResolvedValue([])
  push.mockClear()
})
const mounted: VueWrapper[] = []
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()); document.body.innerHTML = ''; askQueue.splice(0) })

async function open(row?: AllocPoolRowDTO, edit = false) {
  useBillingPeriodStore().pick(2024, 2)
  const w = mount(PoolLedgerView, { attachTo: document.body })
  mounted.push(w)
  await flushPromises()
  if (edit) {
    await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
    await flushPromises()
  }
  ;(w.vm as unknown as Vm).openPoolDlg(row)
  await flushPromises()
  return w
}
const monthBox = () => [...document.querySelectorAll('label.pl-chkline')]
  .find(l => l.textContent?.includes('只改本月起')) as HTMLLabelElement | undefined
const openAdvanced = async () => {
  ;([...document.querySelectorAll('button')].find(b => b.textContent?.includes('高级')) as HTMLButtonElement).click()
  await flushPromises()
}

describe('池按月配置 · 抽屉', () => {
  // 破坏验证:把勾选框挪回「摊给谁」的 v-else 分支里(园区自担不出)→ 红
  it('❗园区自担的池也出「只改本月起」,文案点名三处且写明之前的月份不动', async () => {
    await open(ROW({ ruleId: 19, method: 'none', name: '二期园区·充电桩、保安亭', autoName: '二期园区·充电桩、保安亭' }))
    const box = monthBox()
    expect(box, '园区自担也要有这个勾选框').toBeDefined()
    expect(box!.textContent).toContain('只改本月起（2024-02）：电表、折入的标准、受益人都从这个月起用，之前的月份不动')
    // 对抗复查 A1:名称 / 方法 / 费项不分月,勾了也对所有月生效 —— 悬停说明要讲清(破坏验证:删掉这句 → 红)
    expect((box as TipEl)._tip?.text).toContain('名称、分摊方式、费项这些不分月，勾不勾都是所有月份一起改')
  })

  // 破坏验证:初始勾选退回只看受益人(r.members.some(src==='month'))→ 前两条断言红;
  //           改成恒 true → 第三条红
  it('❗初始勾选:绑定表或折入链站在本月来自按月版本就勾上,三处都是长期那一份就不勾', async () => {
    const monthMeter = ROW({ meters: [{ ...ROW({}).meters[0], src: 'month' }] })
    await open(monthMeter)
    expect((monthBox()!.querySelector('input') as HTMLInputElement).checked, '绑定表来自按月版本').toBe(true)
    mounted.splice(0).forEach(w => w.unmount()); document.body.innerHTML = ''

    await open(ROW({ links: [{ ...LINK, src: 'month' }], members: [{ ...MEMBER, src: 'default' }] }))
    expect((monthBox()!.querySelector('input') as HTMLInputElement).checked, '折入链来自按月版本').toBe(true)
    mounted.splice(0).forEach(w => w.unmount()); document.body.innerHTML = ''

    await open(ROW({ links: [{ ...LINK, src: 'default' }], members: [{ ...MEMBER, src: 'default' }] }))
    expect((monthBox()!.querySelector('input') as HTMLInputElement).checked, '三处都是长期那一份').toBe(false)
  })

  // 破坏验证:submitPool 里 memberMonth 恒传 null → 红
  it('❗园区自担的池勾上后保存:memberMonth=本月,绑定表与折入链一起提交', async () => {
    const w = await open(ROW({ ruleId: 19, method: 'none', links: [{ ...LINK, src: 'default' }] }), true)
    const input = monthBox()!.querySelector('input') as HTMLInputElement
    input.click()
    await flushPromises()
    await (w.vm as unknown as Vm).submitPool()
    expect(allocApi.updateRule).toHaveBeenCalledTimes(1)
    const req = vi.mocked(allocApi.updateRule).mock.calls[0][1]
    expect(req.memberMonth).toBe('2024-02')
    expect(req.meters).toEqual([{ meterId: 57, sign: 1 }])
    expect(req.links).toEqual([{ ruleId: 13, type: 'fold_price' }])
  })

  // 破坏验证:loadMonth 的 key 去掉 round_scale → 只读句变「未设置（按 2 位）」→ 红;
  //           paramCells 的键过滤不放 round_scale → 同上红;四舍五入位数 Select 去掉 v-if → 展开区那条红;
  //           按钮不带 ruleId → 跳过去不定位到这个池 → 最后一条红
  it('❗既有池:取整位只读一句(站在本月的参数值)+ 去计费参数页改,没有选择框', async () => {
    vi.mocked(paramsApi.list).mockResolvedValue([ROUND_ROW])
    await open(ROW({}))
    expect(vi.mocked(paramsApi.list).mock.calls[0][2]?.key).toContain('round_scale')
    await openAdvanced()
    const ro = [...document.querySelectorAll('.pl-roparam')].find(e => e.textContent?.includes('分摊标准小数位')) as HTMLElement
    expect(ro.textContent).toContain('分摊标准小数位 四舍五入到 3 位（2023-10 起长期）')
    // 「高级」开关按钮自己的字里也有「四舍五入位数」,只看展开区
    expect(document.querySelector('.pl-otherbox')!.textContent).not.toContain('四舍五入位数')
    ;(ro.querySelector('button') as HTMLButtonElement).click()
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ path: '/params', query: { ym: '2024-02', zone: 'p1', section: 'constant', rule: '15', key: 'round_scale' } })
  })

  // 破坏验证:roRoundLine 的 inherit 分支改成 `${c.full}` → 出「未设置」而不说几位 → 红
  it('既有池没有取整位行:写明未设置、按 2 位', async () => {
    await open(ROW({ ruleId: 16, roundScale: 2 }))
    await openAdvanced()
    const ro = [...document.querySelectorAll('.pl-roparam')].find(e => e.textContent?.includes('分摊标准小数位')) as HTMLElement
    expect(ro.textContent).toContain('分摊标准小数位 未设置（按 2 位）')
  })

  it('新建池:照旧在「高级」里选四舍五入位数,没有只读句', async () => {
    await open(undefined)
    await openAdvanced()
    expect(document.querySelector('.pl-otherbox')!.textContent).toContain('四舍五入位数')
    expect(document.body.textContent).not.toContain('分摊标准小数位')
  })

  // 破坏验证:confirmUnbind 的 filter 去掉 `&& r.ym >= from` → 确认框多点名 2023-10、2024-01 → 红;
  //           months.join('、') 改成别的分隔符 → 本月及以后两个月连写的那句对不上 → 红
  it('❗勾了「只改本月起」移出表:确认框只点名本月及以后有读数的月份', async () => {
    vi.mocked(metersApi.meterReadings).mockResolvedValue([
      reading('2023-10', 1065.9), reading('2024-01', 812), reading('2024-02', 1065.9), reading('2024-03', 0), reading('2024-04', 640.5),
    ])
    const w = await open(ROW({ meters: [{ ...ROW({}).meters[0], src: 'month' }] }))
    expect((w.vm as unknown as Vm).form.monthOnly, '前置:按月版本 → 默认勾上').toBe(true)
    const row = [...document.querySelectorAll('.pl-bindrow')].find(r => r.textContent?.includes('五车间·广告字灯·消防分表')) as HTMLElement
    ;(row.querySelector('input') as HTMLInputElement).click()
    await flushPromises()
    expect(askQueue[0].body).toContain('这 2 个月有读数（用量非零）：2024-02、2024-04。')
    answer(true)
    await flushPromises()
    expect((w.vm as unknown as Vm).form.meters).toEqual([])
  })
})
