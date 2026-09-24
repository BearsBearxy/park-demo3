// 楼栋损耗(LossLedgerView)——「备注」这一列是本屏**唯一**的写入口(2026-09-23 用户要求),
// 其余每一格都是引擎算出来的派生值。这个文件钉住四件事:
//   ① 浏览态整屏零写控件(备注格是纯文本,别的格也不许冒出输入框)
//   ② 编辑态**只有**备注可写 —— 真的去数别的格有没有输入框,不是只测备注那一格
//   ③ 浏览态直呼 commitNote 一定打不出去(按钮的 :disabled / v-if 只是 UI 补丁)
//   ④ 编辑态就地转假(接管 / 提权到期)→ 备注输入框当场从 DOM 消失
// 外加 D 组文案:对账行名由后端的 supplyLabel/sumLabel 拼、告警组叫「改过参数还没重算」。
//
// ⚠ 浏览态直呼写函数的用例,前置状态必须做足(本仓栽过四次):先在编辑态真写一次证明通路是活的,
//   再退出来打 —— 否则函数在自己原有的早退分支(值没变 / loss 为 null)就 return 了,
//   守卫删掉照样绿,等于没写这条断言。
// ⚠ 本仓没有原生 <select>(下拉一律 components/ds/Select.vue,渲染 button.ds-sel-trigger),
//   所以「别的格不可写」只数 input / textarea / [contenteditable],不数 select(恒 0,是假断言)。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import type { AllocLossDTO, AllocLossUnitDTO } from '@/api/alloc'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query: {} }),
}))

// 本屏要先占到 billing-chain 月锁才进得了编辑态;不 mock 的话 locksApi 走真 axios,
// jsdom 里抛错 → 被「拿不准就不进」兜住 → 编辑态永远进不去(照 poolWriteGuards.spec.ts)。
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

/** 两栋:一栋有备注、一栋没有 —— 「写进去 / 清空」两条路各有落点。 */
const unit = (p: Partial<AllocLossUnitDTO>): AllocLossUnitDTO => ({
  headBuildingId: 20, label: '一期 B座', zone: 'p1',
  cQty: 5318.4, cableQty: null, dQty: 5399.07, eQty: 80.67, rawRate: 0.0152,
  gQty: 86.8, adjQty: null, adjRate: 0.005, variant: 'net', tenantRate: 0.0202, note: null,
  formulaRate: 0.0202, manualRate: null, gParts: null, gDiv: null, ...p,
})
// 对账两条(POOL-ENGINE-SPEC §6.2):第二条=2026-09-23 补的「真正总计」那一组。
// 数字是开发库 2024-02 一期实测值,屏上四行读作 supplyLabel vs sumLabel。
const LOSS: AllocLossDTO = {
  generated: true,
  units: [unit({}), unit({ headBuildingId: 13, label: '一期 A座', note: '独立供电，另表' })],
  recon: [
    { zone: 'p1', supplyLabel: 'B-G座总电', sumLabel: '除一期 A座外各栋',
      supplyQty: 68320, sumC: 63054.4, sumD: 62923.96,
      lossVsC: -5265.6, rateVsC: -0.0771, lossVsD: -5396.04, rateVsD: -0.079 },
    { zone: 'p1', supplyLabel: 'B-G座总电 + A座总电', sumLabel: '全部楼栋',
      supplyQty: 106870, sumC: 101604.4, sumD: 97800.46,
      lossVsC: -5265.6, rateVsC: -0.0493, lossVsD: -9069.54, rateVsD: -0.0849 },
  ],
}

const STATUS = {
  priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
  poolSnapshotAt: '2025-03-10T09:00:00', billBatchAt: null, stale: false, otherMonthsAffected: [],
}

vi.mock('@/api/alloc', () => ({
  allocApi: {
    loss: vi.fn(),
    saveLossNote: vi.fn(() => Promise.resolve()),
    poolMonths: vi.fn(() => Promise.resolve([])),
    lossMonths: vi.fn(() => Promise.resolve([])),
  },
}))
vi.mock('@/api/params', () => ({
  paramsApi: { list: vi.fn(() => Promise.resolve([])), status: vi.fn() },
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
import { paramsApi } from '@/api/params'

/** vm 直呼写函数用(script setup 的顶层绑定在 dev 构建里挂在实例代理上,同 poolWriteGuards) */
interface Vm {
  editMode: boolean
  commitNote: (u: AllocLossUnitDTO, raw: string) => void
  units: AllocLossUnitDTO[]
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['billing-run:edit']
  vi.mocked(allocApi.loss).mockResolvedValue(structuredClone(LOSS))
  vi.mocked(allocApi.saveLossNote).mockClear()
  vi.mocked(allocApi.saveLossNote).mockResolvedValue(undefined)
  vi.mocked(paramsApi.status).mockResolvedValue({ ...STATUS })
})

async function open() {
  useBillingPeriodStore().pick(2025, 3)   // 期由出账月矩阵一处选定 —— 单测里直接落 store
  const w = mount(LossLedgerView, { attachTo: document.body, global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

/** 进编辑态(占锁已 mock 成必给)。返回时已确认真的进去了。 */
async function enterEdit(w: Awaited<ReturnType<typeof open>>) {
  await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
  await flushPromises()
  expect(w.findAll('button').some(b => b.text() === '完成'), '前置:占锁成功进了编辑态').toBe(true)
}

/**
 * 整屏可写控件。本仓无原生 select —— `findAll('select')` 恒空是假断言,
 * 下拉是 ds/Select,渲染成 button.ds-sel-trigger,必须单独数它。
 * contenteditable 用 :not([contenteditable="false"]) 而不是 ="true":
 * 裸写 `contenteditable`(无值)也是可写的,只匹配 ="true" 会漏掉。
 * 2026-09-23:原来只数 input/textarea/[contenteditable="true"] 三类,
 * 给别的格换成 ds/Select 或裸 contenteditable,「只有备注可写」照样绿。
 */
const writables = (w: { findAll: (s: string) => unknown[] }) => [
  ...w.findAll('input'),
  ...w.findAll('textarea'),
  ...w.findAll('.ds-sel-trigger'),
  ...w.findAll('[contenteditable]:not([contenteditable="false"])'),
]

describe('楼栋损耗 · 备注是唯一的写入口', () => {
  it('① 浏览态:备注是纯文本,整屏一个可写控件都没有', async () => {
    const w = await open()
    expect(w.findAll('.ll-txt').length, '前置:备注列渲染出来了').toBeGreaterThan(0)
    // production 把备注那格的 `v-if="editN"` 删掉(或换成恒真)→ 这两条红
    expect(w.findAll('.ll-in'), '浏览态不许有备注输入框').toHaveLength(0)
    expect(writables(w), '浏览态整屏零写控件').toHaveLength(0)
    w.unmount()
  })

  it('② 编辑态:只有备注可写 —— 别的格一个输入框都不许冒出来', async () => {
    const w = await open()
    await enterEdit(w)
    const ins = w.findAll('.ll-in')
    // 前置:通路是活的(两栋各一格),否则下面那条「只有备注」可能只是「一个都没有」
    expect(ins, '编辑态每一行的备注都该变成输入框').toHaveLength(2)
    // ❗真的去数别的格:损耗调整度数 / 损耗率加点 / 收取损耗率 全是只读镜像,
    //   production 把其中任何一格改成 <input> → 这条红(而只测备注的断言照样绿)
    expect(writables(w).length, '编辑态可写控件只该有备注那几格').toBe(ins.length)
    // 只读镜像仍在屏上(不是被整列摘掉换成了输入框)
    expect(w.findAll('.ll-pv').length, '调整度数/加点两格仍是只读镜像').toBeGreaterThan(0)
    w.unmount()
  })

  it('③ 浏览态直呼 commitNote:先证明通路是活的,再退出来打 —— 一定打不出去', async () => {
    const w = await open()
    const vm = w.vm as unknown as Vm
    await enterEdit(w)
    // 前置做足:编辑态下真写一次 —— 值确实变了、loss 不是 null,守卫之后的早退分支全填掉
    vm.commitNote(vm.units[0], '编辑态写得进去')
    await flushPromises()
    expect(allocApi.saveLossNote, '前置:编辑态这条通路是活的').toHaveBeenCalledTimes(1)

    // 退出编辑态,同一个函数、同一份数据,换一个新值再打一次
    await w.findAll('button').find(b => b.text() === '完成')!.trigger('click')
    await flushPromises()
    expect(vm.editMode, '前置:回到浏览态').toBe(false)
    vm.commitNote(vm.units[0], '浏览态不该写得进去')
    await flushPromises()
    // production 删掉 commitNote 第一行 `if (!editN.value) return` → 这里变 2 次 → 红
    expect(allocApi.saveLossNote).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('④ 编辑态就地转假(接管 / 提权到期)→ 备注输入框当场从 DOM 消失', async () => {
    const w = await open()
    await enterEdit(w)
    expect(w.findAll('.ll-in').length, '前置:编辑态输入框在').toBeGreaterThan(0)
    // 提权到期同款路径:权限掉光 → useEditMode 的 watch([editMode, missing]) 把 editMode 就地转假
    useAuthStore().permissions = []
    await flushPromises()
    expect(w.findAll('.ll-in'), '编辑态转假后输入框还在屏上').toHaveLength(0)
    expect(writables(w)).toHaveLength(0)
    w.unmount()
  })

  it('⑤ 本月没读到(失败态):进不了编辑态,但已经在里面的退得出来', async () => {
    vi.mocked(allocApi.loss).mockRejectedValue(new Error('后端挂了'))
    const w = await open()
    expect(w.find('.fp-lderr').exists(), '前置:失败条在').toBe(true)
    const editBtn = () => w.findAll('button').find(b => b.text().includes('编辑模式'))
    // 没读到本月现状时表里是一张逐格 '–' 的假底 —— 对着它写备注，
    // 那一行的 headBuildingId 压根没落进这个月。
    // production 把 FPEditModeButton 上那句 `:disabled="!editMode && !!loadErr"` 删掉 → 本行红
    expect(editBtn()!.attributes('disabled'), '失败态下不该进得了编辑').toBeDefined()
    // 禁「进」不禁「出」:已在编辑态时载入失败,还得能点「完成」把锁交回去
    // production 把那句改成 `:disabled="!!loadErr"`（漏掉 !editMode）→ 本行红
    ;(w.vm as unknown as Vm).editMode = true
    await flushPromises()
    const done = w.findAll('button').find(b => b.text() === '完成')
    expect(done, '前置:已在编辑态').toBeTruthy()
    expect(done!.attributes('disabled'), '失败态把「完成」也禁掉了 —— 退不出去、锁交不回').toBeUndefined()
    w.unmount()
  })
})

describe('楼栋损耗 · 屏上的字', () => {
  it('对账行名由后端的 supplyLabel/sumLabel 拼出,「真正总计」那一组也在屏上', async () => {
    const w = await open()
    const labels = w.findAll('.ll-recon .ll-lbl').map(e => e.text())
    // production 把 reconRows 的 .filter 改回 .find(只取第一条)→ 后两行没了 → 红;
    // 把 buildLossReconRows 的行名改回写死的「供电局总表 / 各栋」→ 四行全红
    expect(labels).toEqual([
      'B-G座总电 vs 除一期 A座外各栋总表合计',
      'B-G座总电 vs 除一期 A座外各栋分表合计',
      'B-G座总电 + A座总电 vs 全部楼栋总表合计',
      'B-G座总电 + A座总电 vs 全部楼栋分表合计',
    ])
    // 第二组是新一条条目的头一行 —— 屏上靠它画分隔线
    expect(w.findAll('.ll-recon-all'), '两组之间要有分隔').toHaveLength(1)
    w.unmount()
  })

  it('告警组叫「改过参数还没重算」,不再叫「快照过期」', async () => {
    vi.mocked(paramsApi.status).mockResolvedValue({
      ...STATUS, stale: true, pendingChanges: 3, lastChangeAt: '2025-03-11T10:20:00',
    })
    const w = await open()
    await w.find('button.fac').trigger('click')   // 常驻告警 chip → 右侧抽屉
    await flushPromises()
    const panel = document.body.textContent ?? ''
    expect(panel, '组名没上屏').toContain('改过参数还没重算')
    // 「快照」是引擎内部的说法,屏上不许出现(与公共电核算屏同名同口吻)
    expect(panel).not.toContain('快照过期')
    expect(panel, 'staleText 去行话后的新句子').toContain('本屏数字还是改之前算的')
    w.unmount()
  })

  // METER-TIMELINE-SPEC §5:需重算的第二个来源 = 抄表。只有抄表改过时,组名 / 主语 / 明细都说抄表。
  // 破坏验证:把 LossLedgerView 的 title 换回写死的 '改过参数还没重算' → 本条红。
  it('❗只有抄表改过 → 组名「改过抄表还没重算」,主语不说计费参数', async () => {
    vi.mocked(paramsApi.status).mockResolvedValue({
      ...STATUS, stale: true, pendingChanges: 0, lastChangeAt: '2025-03-11T10:20:00',
      lastChangeSource: 'meter', staleSources: ['meter'],
    })
    const w = await open()
    await w.find('button.fac').trigger('click')
    await flushPromises()
    const panel = document.body.textContent ?? ''
    expect(panel).toContain('改过抄表还没重算')
    expect(panel).toContain('抄表数据（读数或表档案）在本月算出损耗之后又改过')
    expect(panel).toContain('抄表于 03-11 10:20 更新')
    expect(panel).not.toContain('改过参数还没重算')
    w.unmount()
  })
})
