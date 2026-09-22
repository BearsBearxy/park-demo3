// 催缴单明细抽屉的**形状**判据(2026-09-23 照稿实现,画布「催缴单租户抽屉 · 整屏重设计」)。
//
// 这一组钉的不是逻辑对不对,是「屏上这一块长什么样、在不在」—— 稿上四条硬约束:
//   ① 告警不占正文的一行:它是抽屉副标题行上的徽标(有几类就几个),点开才铺明细。
//   ② 状态进抽屉:开着抽屉核对的人要看得见这户核过没核过(今天只有列表那一列有)。
//   ③ 确认进抽屉 + 逐户导航:判断在抽屉里做出,钮就在抽屉里;确认完**原地留着**不自动跳。
//   ④ 换户不跳:正文永远三块,每块高度与这户的情况无关 —— 收款条空态也出条。
//
// 夹具给三户:带两类告警的、一条都没有的、和第一户**同一类**的 ——
// 第三户是为了测「换户收起」:换到没告警的户是假绿(那户本来就查不到这一组)。
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

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
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
    closedMonths: vi.fn().mockResolvedValue([]), states: vi.fn().mockResolvedValue([]),
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

// ── 夹具 ────────────────────────────────────────────────────────────────
const LINE: BillNoticeLineDTO = {
  lineNo: 1, feeKey: 'elec', premise: '一期 A座602室',
  meterId: 9, meterLabel: '力灏电', contractId: 77, seg: 'flat',
  prevRead: 0, currRead: 100, factorSnap: 1,
  qty: 100, priceSnap: 0.6, priceKey: null, priceScope: null, priceMonth: null,
  ruleBranch: null, poolRuleId: null, poolName: null, shareSrc: null, baseSnap: null,
  amount: 60, note: null, feeGroup: 'elec',
}
const base = {
  ym: '2026-08', payCompanyId: null, payCompanyName: null,
  noticeKind: 'combined' as const, prevDue: 0, status: 'draft' as const,
}
// 力灏:两类告警(表没挂上合同 ×2 + 合同没有起止日期 ×1);次生代:一条都没有;合源创盈:同第一类
const NOTICES: BillNoticeDTO[] = [
  {
    ...base, id: 91, tenantId: 5, tenantName: '力灏', premiseText: '一期 A座602室',
    totalAmount: 60, lineCount: 1,
    warns: [
      { code: 'W_METER_NO_CONTRACT', payload: '405', hint: 'A101力灏水' },
      { code: 'W_METER_NO_CONTRACT', payload: '409', hint: '力灏二楼水1' },
      { code: 'W_CONTRACT_NO_DATES', payload: 'S10-0062', hint: '' },
    ],
  },
  {
    ...base, id: 92, tenantId: 6, tenantName: '次生代', premiseText: '一期 A座616室',
    totalAmount: 80, lineCount: 1, warns: [],
  },
  // ⚠ 第三户必须带**同一个 code**:换户重置那条用例要靠它才测得到。
  //   只拿「有告警 → 没告警」测是假绿 —— 没告警的户本来就查不到这一组,
  //   面板不渲染跟 openWarn 有没有被清没关系(实测踩过)。
  {
    ...base, id: 93, tenantId: 7, tenantName: '合源创盈', premiseText: '一期 A座206室',
    totalAmount: 90, lineCount: 1,
    warns: [{ code: 'W_METER_NO_CONTRACT', payload: '501', hint: '合源创盈电' }],
  },
]
const detailOf = (n: BillNoticeDTO): BillNoticeDetailDTO => ({
  id: n.id, ym: n.ym, tenantId: n.tenantId, tenantName: n.tenantName,
  payCompanyId: null, payCompanyName: null, noticeKind: 'combined',
  premiseText: n.premiseText, totalAmount: n.totalAmount, prevDue: 0,
  status: n.status, warns: n.warns, lines: [LINE],
})
const STATUS: ParamStatusDTO = {
  priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
  poolSnapshotAt: '2026-08-16T16:37:51', billBatchAt: '2026-08-20T13:41:34',
  stale: false, otherMonthsAffected: [],
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore().permissions = ['billing-run:edit', 'billing-issue:edit']
  vi.mocked(billNoticesApi.list).mockResolvedValue(NOTICES as never)
  vi.mocked(billNoticesApi.detail).mockImplementation(
    (id: number) => Promise.resolve(detailOf(NOTICES.find(n => n.id === id)!)) as never)
  vi.mocked(billNoticesApi.notes).mockResolvedValue([] as never)
  vi.mocked(paramsApi.status).mockResolvedValue(STATUS as never)
  vi.mocked(contractApi.list).mockResolvedValue([] as never)
  vi.mocked(buildingApi.list).mockResolvedValue([] as never)
  vi.mocked(companyBookApi.list).mockResolvedValue([] as never)
  vi.mocked(billsApi.paymap).mockResolvedValue([] as never)
})

async function open() {
  useBillingPeriodStore().pick(2026, 8)
  const w = mount(BillNoticesView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
type Wrapper = Awaited<ReturnType<typeof open>>

/** 开第 i 户的明细抽屉(整行点击 = openDetail) */
async function openDrawer(w: Wrapper, i = 0) {
  const rows = w.findAll('.bn-table tbody tr').filter(r => r.find('.bn-tname').exists())
  expect(rows.length, '列表里该有三户').toBe(3)
  await rows[i].trigger('click')
  await flushPromises()
}

describe('催缴单抽屉 · ① 告警是副标题行上的徽标,不占正文的一行', () => {
  // ⚠ 破坏验证:把 #submeta 那一段搬回正文(改回 .bn-bar.warn)→ 本行红。
  it('一类一个徽标,写明类名与条数;正文里没有告警横条', async () => {
    const w = await open()
    await openDrawer(w, 0)
    const badges = w.findAll('.bn-abadge')
    expect(badges.length, '两类 → 两个徽标').toBe(2)
    expect(badges[0].text()).toContain('表没挂上合同')
    expect(badges[0].text()).toContain('2')
    expect(badges[1].text()).toContain('合同没有起止日期')
    expect(w.find('.bn-bar.warn').exists(), '正文里不该再有整宽告警条').toBe(false)
  })

  it('默认不展开:点一下才出明细与落点链,再点收起', async () => {
    const w = await open()
    await openDrawer(w, 0)
    expect(w.find('.bn-apanel').exists()).toBe(false)

    await w.findAll('.bn-abadge')[0].trigger('click')
    const panel = w.find('.bn-apanel')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('A101力灏水')
    expect(panel.text()).toContain('力灏二楼水1')
    expect(panel.text()).toContain('去园区抄表')
    // 时效那句仍在(它是这条告警唯一说得清「不是实时的」的地方)
    expect(panel.text()).toContain('重新生成本月后这里才会变')

    await w.findAll('.bn-abadge')[0].trigger('click')
    expect(w.find('.bn-apanel').exists()).toBe(false)
  })

  // ⚠ 破坏验证:把 openDetail 里那句 `openWarn.value = ''` 删掉 → 本行红。
  //   换到**也有这一类**的户(合源创盈),不是换到没告警的户 —— 后者是假绿。
  it('换户收起:上一户展开着,下一户的头不该凭空高一截', async () => {
    const w = await open()
    await openDrawer(w, 0)
    await w.findAll('.bn-abadge')[0].trigger('click')
    expect(w.find('.bn-apanel').exists()).toBe(true)
    await openDrawer(w, 2)                     // 合源创盈:同样有 W_METER_NO_CONTRACT
    expect(w.findAll('.bn-abadge').length, '前置:这户也有这一类').toBe(1)
    expect(w.find('.bn-apanel').exists()).toBe(false)
  })

  it('没有告警的户:一个徽标都没有', async () => {
    const w = await open()
    await openDrawer(w, 1)
    expect(w.findAll('.bn-abadge').length).toBe(0)
  })
})

describe('催缴单抽屉 · ② 状态进抽屉', () => {
  // ⚠ 破坏验证:把 #badge 那一段删掉 → 本行红。
  it('标题旁有状态徽标,字与列表那一列同一份', async () => {
    const w = await open()
    await openDrawer(w, 0)
    const st = w.find('.fp-dwr-hd .bn-st')
    expect(st.exists()).toBe(true)
    expect(st.text()).toBe('待核对')
  })
})

describe('催缴单抽屉 · ③ 确认与逐户导航都在底部动作条上', () => {
  // ⚠ 破坏验证:把 footer 里那颗 primary 钮删掉 → 本行红。
  it('待核对 + 有签发权:主动作是「核对无误,确认该户」', async () => {
    const w = await open()
    await w.find('.fp-emb').trigger('click')      // 进编辑态(canIssue 把 editMode 编进算式)
    await flushPromises()
    await openDrawer(w, 0)
    const ft = w.find('.fp-dwr-ft')
    expect(ft.text()).toContain('核对无误,确认该户')
    expect(ft.text()).toContain('导出本户 Excel')
  })

  it('浏览态没有这颗钮(写权限的两扇门之一没开)', async () => {
    const w = await open()
    await openDrawer(w, 0)
    expect(w.find('.fp-dwr-ft').text()).not.toContain('确认该户')
  })

  // ⚠ 破坏验证:把 stepTenant 改成不调 openDetail → 本行红。
  it('下一户:原地换户,抽屉不关;计数走当前筛选后的这一期', async () => {
    const w = await open()
    await openDrawer(w, 0)
    expect(w.find('.bn-nav .pos').text()).toBe('1 / 3')

    const next = w.findAll('.bn-nav button').at(-1)!
    await next.trigger('click')
    await flushPromises()

    expect(w.find('.fp-dwr').exists(), '抽屉不关').toBe(true)
    expect(w.find('.fp-dwr-hd h3').text()).toBe('次生代')
    expect(w.find('.bn-nav .pos').text()).toBe('2 / 3')
  })

  // ⚠ 取消确认(2026-09-23)。原来这一档只有一句「已确认 · 不能改回草稿」——
  //   点错一户就只剩作废(落 void 不是 draft)或整月重生成(会冲掉别人核完的户)两条路,
  //   两条都不是「反悔」。破坏验证:把 footer 里那颗「取消确认」删掉 → 本行红。
  it('已确认 + 有签发权:出「取消确认」,并且不再说不能改回草稿', async () => {
    vi.mocked(billNoticesApi.list).mockResolvedValue(
      NOTICES.map((n, i) => (i === 0 ? { ...n, status: 'confirmed' as const } : n)) as never)
    const w = await open()
    await w.find('.fp-emb').trigger('click')
    await flushPromises()
    await openDrawer(w, 0)
    const ft = w.find('.fp-dwr-ft')
    expect(ft.text()).toContain('取消确认')
    expect(ft.text()).toContain('已确认')
    expect(ft.text(), '这句话现在是假的,不许再印').not.toContain('不能改回草稿')
  })

  it('已确认但只有运行权:没有「取消确认」(它和确认同一个权限点)', async () => {
    useAuthStore().permissions = ['billing-run:edit']
    vi.mocked(billNoticesApi.list).mockResolvedValue(
      NOTICES.map((n, i) => (i === 0 ? { ...n, status: 'confirmed' as const } : n)) as never)
    const w = await open()
    await w.find('.fp-emb').trigger('click')
    await flushPromises()
    await openDrawer(w, 0)
    expect(w.find('.fp-dwr-ft').text()).not.toContain('取消确认')
  })

  it('首尾两端把导航钮禁掉', async () => {
    const w = await open()
    await openDrawer(w, 0)
    const btns = w.findAll('.bn-nav button')
    expect((btns[0].element as HTMLButtonElement).disabled, '第一户没有上一户').toBe(true)
    expect((btns.at(-1)!.element as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('催缴单抽屉 · ④ 换户不跳:正文永远三块', () => {
  // ⚠ 这一条是稿上「换户时费项表不移动」的机器判据。
  //   破坏验证:给 PaySlotGrid 加回 v-if="slotCells.length",或把告警搬回正文 → 本行红。
  it('带告警的户与不带告警的户,正文的块序与块数一模一样', async () => {
    const w = await open()
    const shape = async (i: number) => {
      await openDrawer(w, i)
      const body = w.find('.fp-dwr-body')
      return {
        hgrid: body.findAll('.bn-hgrid').length,
        pay: body.findAll('.psg-bar').length,
        seg: body.findAll('.ds-seg, .seg').length,
        warnBar: body.findAll('.bn-bar.warn').length,
        apanel: body.findAll('.bn-apanel').length,
      }
    }
    expect(await shape(0)).toEqual(await shape(1))
    // 「一个槽都没有的户,条也要在」那条在 PaySlotGrid.spec 里测(本夹具每户都有 elec 行,
    //   槽不会空 —— 在这里写那条断言是假绿)
    expect((await shape(1)).pay, '收款条恒出').toBe(1)
  })

  it('头部是三格,上期欠费降格成「本期合计」底下的小字', async () => {
    const w = await open()
    await openDrawer(w, 0)
    const g = w.find('.bn-hgrid')
    expect(g.classes()).toContain('c3')
    expect(g.findAll('.bn-hfld').length).toBe(3)
    // ⚠ 不许印那个恒 0 的数:它不是量出来的,印出来就是「这户上期不欠钱」的断言(对抗复查 2026-09-23)。
    //   破坏验证:改回 `上期欠费 {{ fmt2(dlgRow.prevDue) }}` → 本行红。
    expect(g.text()).toContain('上期欠费 · 收款流水未接入')
    expect(g.text()).not.toContain('上期欠费 0.00')
    expect(g.find('.bn-hsub').exists()).toBe(true)
  })
})
