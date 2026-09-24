/**
 * 催缴单屏窄档形态 —— RESPONSIVE-LAYOUT-SPEC §5.7(屏顶 KPI 卡行)+ §5.10(屏标题行 + 筛选行)。
 *
 * 起因(MOBILE-390-AUDIT-2026-09-21 §1-D):`BillNoticesView` 表前四块合计 572px,
 * 390 首屏 655 只剩 83px 给表 —— 一条表头加一行数据。
 *
 * ── S 档(390×844)屏顶块高逐条钉死(下面 §G 一条条断 CSS 字面量),算术 ─────────
 *   FPStepStrip  54   .fss--s 定高(§5.9,组件里本来就有,本轮没动)
 *   gap          14   .bn-page gap
 *   .bn-head     30   S 档屏名与期段控不进 DOM ⇒ 左只剩 FPAlertChip(.fac 30 高),
 *                     右只剩 审核簇 28 + ⋯ 30 ⇒ 行高 30
 *                     (编辑模式 2026-09-21 搬进手机顶栏,行上不再有它 —— 行高不变,
 *                      定行高的本来就是 ⋯ 那 30;改前 190:h2 34 + 七个入口在 358 宽里折三行)
 *   gap          14
 *   .bn-kpis     92   横滑一行 = 单张 FPStat 高
 *                     (12 padding + 18 标签 + 4 + 26 数字 + 4 + 16 sub + 12 padding)
 *                     改前 2×2 = 92×2 + 12 gap = 196
 *   gap          14
 *   .bn-toolbar  44   搜索 44 + 筛选钮 44,一行(改前 74:复选 + 批量确认 + 230 搜索折两行)
 *   ──────────────
 *   屏顶合计    262   (改前 556;体检记的 572 是 §5.9 定高落地之前量的)
 *   表可用 = 首屏 655 − 262 = 393
 *   表头 34(.bn-table thead th)+ tfoot 40(.bn-table tfoot th)= 74
 *   (393 − 74) ÷ 34(tbody td 行高) = 9.38 → **9 行**
 *   改前:(99 − 74) ÷ 34 = 0.7 → **0 行**
 *   ⚠ 9 行是上限不是保证:真数据里每个楼栋有一条 .bn-band 分组头,也按 34 占一行。
 *
 * ── M 档(768×1024 竖屏;平板落 M,§3.5)同一份算术 ──────────────────────────
 *   内容带 = 1024 − .fp-stage padding 8×2(AppShell :336)− .fp-main-card 边框 2(:318)
 *            − TabStrip 44(:516)− Toolbar 48(:216)− .fp-content padding 16×2(:339) = 882
 *   FPStepStrip  54   .fss--m 是 flex-wrap:nowrap 的横滑全条(§5.9),一行药丸。
 *                     ⚠ M 档组件里没有定高声明 —— 这 54 是按与 .fss--s 同构推算的,
 *                     下面只断得了「它不折行」(.fss--m { flex-wrap: nowrap; }),断不了 54。
 *   gap          14
 *   .bn-head     30   屏名/期段控不进 DOM;左 FPAlertChip 30,
 *                     右 审核簇 28 + 编辑模式 28 + ⋯ 30 ⇒ 30
 *                     (编辑态多一颗生成 28:601 那一端右组可能仍折 2 行 ⇒ 屏顶 +38、表少 1 行)
 *   gap          14
 *   .bn-kpis     92   与 S 同一条横滑轨(§5.7 按卡片数分档,4 张两档都走横滑;改前 2 列 196)
 *   gap          14
 *   .bn-toolbar  44   搜索(960 块定高 44)+ 筛选钮 44
 *   ──────────────
 *   屏顶合计    262;表可用 = 882 − 262 = 620;(620 − 74) ÷ 34 = 16.05 → **16 行**
 *   改前 = 54+14+30+14+196+14+44 = 366(动作没收,右组在 768 上还多五颗只读钮)
 *          → (882−366−74) ÷ 34 = 13 行
 *
 * ── M 档为什么不走顶栏 ────────────────────────────────────────────────────
 * AppShell.vue:162 是 `v-if="tier !== 's'"`(桌面 TabStrip + Toolbar),:168 的 v-else 才挂
 * MobileTopBar —— **M 档根本不渲染手机顶栏**。所以 §5.10「M 档主动作留 2 个」不能靠
 * useTopBarAction,那两个只能留在屏内流里。本屏 M 档行上的两个 = 编辑模式 + 生成(编辑态)。
 *
 * ── 为什么一半断 DOM、一半断 CSS 字面量 ───────────────────────────────────────
 * jsdom 不做布局(每个元素宽高都是 0),@media 条件也不参与计算 —— 挂载后量尺寸只能得到恒真式。
 * 所以:「渲染哪一支」(屏名进不进 DOM、七个入口收没收进「⋯」、筛选在不在面板里)断 DOM,
 * 走 useViewport 的 tier;「几何与层叠顺序」断源码字面量,那正是这一轮改的东西。
 *
 * 两档都断:只断 S 的话,把 XL 也一起收掉同样是全绿的 —— §9 桌面零差异会被静默破掉。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mediaBlock } from '@/test-utils/mediaBlock'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { billNoticesApi, type BillNoticeDTO, type NoticeWarnDTO } from '@/api/billNotices'
import { paramsApi, type ParamStatusDTO } from '@/api/params'
import { contractApi } from '@/api/contract'
import { buildingApi } from '@/api/building'
import { companyBookApi, billDeliveryApi } from '@/api/billDelivery'
import { billsApi } from '@/api/bills'
import { _resetViewportForTest } from '@/composables/useViewport'
import BillNoticesView from '@/views/bills/BillNoticesView.vue'

const SRC = join(__dirname, '..', '..')
const VIEW_CSS = readFileSync(join(SRC, 'views', 'bills', 'BillNoticesView.vue'), 'utf8').replace(/\r\n/g, '\n')
const STRIP_CSS = readFileSync(join(SRC, 'components', 'fp', 'FPStepStrip.vue'), 'utf8').replace(/\r\n/g, '\n')
const STAT_CSS = readFileSync(join(SRC, 'components', 'fp', 'FPStat.vue'), 'utf8').replace(/\r\n/g, '\n')
const MX_CSS = readFileSync(join(SRC, 'styles', 'mx-list.css'), 'utf8').replace(/\r\n/g, '\n')

const Q960 = '@media (max-width: 960px)'
const Q600 = '@media (max-width: 600px)'

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

// ── 夹具:**不退化** —— 三户、两个期、金额三档互不相同、只有一户带 warn。
//    (同期两户 + 别期一户 ⇒ 换期能看出行数变;一户带 warn ⇒「仅看有警告」能看出行数变;
//     金额各不相同 ⇒ KPI 的「总额」与「月租金」不是同一个数,四张卡不会碰巧一样。)
const mk = (
  id: number, tenantId: number, tenantName: string,
  premiseText: string, totalAmount: number, warns: NoticeWarnDTO[],
): BillNoticeDTO => ({
  id, ym: '2026-08', tenantId, tenantName,
  payCompanyId: 3, payCompanyName: '甲公司', noticeKind: 'combined',
  premiseText, totalAmount, prevDue: 0, status: 'draft', warns, lineCount: 4,
})
const NOTICES: BillNoticeDTO[] = [
  mk(91, 5, '力灏', '一期 A座602室', 12345.6, []),
  mk(92, 6, '宏远', '一期 B座101室', 8761.25,
     [{ code: 'W_PRICE_MISSING', payload: 'elec_sharp', hint: '' }]),
  mk(93, 7, '晟通', '二期 C座305室', 20408.9, []),
]
const STATUS: ParamStatusDTO = {
  priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
  poolSnapshotAt: '2026-08-16T16:37:51', billBatchAt: '2026-08-20T13:41:34',
  stale: false, otherMonthsAffected: [],
}

/** 档位:useViewport 是模块级单例,换 matchMedia mock 后必须 _resetViewportForTest 重建。 */
function setTier(tier: 's' | 'm' | 'xl') {
  vi.stubGlobal('matchMedia', (q: string) => ({
    media: q,
    // 三条查询是 max-width 600 / 960 / 1280。s 命中全部;m 命中 960 与 1280;xl 一条不中。
    matches: tier === 's' ? q.includes('max-width')
      : tier === 'm' ? (q.includes('960') || q.includes('1280'))
        : false,
    addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

let w: VueWrapper | null = null

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore().permissions = ['billing-run:edit', 'billing-issue:edit']
  vi.mocked(billNoticesApi.list).mockResolvedValue(NOTICES as never)
  vi.mocked(billNoticesApi.notes).mockResolvedValue([] as never)
  vi.mocked(billNoticesApi.generate).mockResolvedValue({ generated: 3, lines: 12, warned: 1 } as never)
  vi.mocked(paramsApi.status).mockResolvedValue(STATUS as never)
  vi.mocked(contractApi.list).mockResolvedValue([] as never)
  vi.mocked(buildingApi.list).mockResolvedValue([] as never)
  vi.mocked(companyBookApi.list).mockResolvedValue([] as never)
  vi.mocked(billsApi.paymap).mockResolvedValue([] as never)
})
afterEach(() => {
  w?.unmount(); w = null
  _resetViewportForTest()
  vi.unstubAllGlobals()
})

/** 期是组级的(stores/billingPeriod):先选期再挂,否则撞出账月矩阵。 */
async function open(tier: 's' | 'm' | 'xl') {
  setTier(tier)
  useBillingPeriodStore().pick(2026, 8)
  w = mount(BillNoticesView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

/** tbody 里的真租户行(排掉楼栋分组头 .bn-band 与空态 .bn-noro)。 */
const tenantRows = (v: VueWrapper) =>
  v.findAll('.bn-table tbody tr').filter(r => r.find('.bn-tname').exists())

// ════════════════════════════════════════════════════════════════════════════
describe('§5.7 屏顶 KPI 卡行 —— 4 张 ⇒ 横滑胶囊行,不是 2×2', () => {
  it('S 档:4 张 FPStat 一张不少,全在 .bn-kpis 这一条轨里', async () => {
    const v = await open('s')
    const rail = v.find('.bn-kpis')
    expect(rail.exists()).toBe(true)
    const cards = rail.findAll('.fs')
    // 「≥5 张才先砍再排」—— 本屏 4 张走横滑档,一张都不许砍
    expect(cards).toHaveLength(4)
    // 夹具不退化的自证:四张卡读数各不相同(全 0 / 全同的夹具写死也绿)
    const nums = cards.map(c => c.find('.fs-n').text())
    expect(new Set(nums).size).toBe(4)
    // 一期两户:户数 2,总额 12345.6 + 8761.25 = 21106.85,警告 1
    expect(nums[0]).toBe('2')
    expect(nums[1]).toBe('21,106.85')
    expect(nums[3]).toBe('1')
  })

  // ⚠ 收窄:上一轮这四条断在 600 块里(`mediaBlock(VIEW_CSS, Q600)`),因为那时 M 档还是两列。
  //   现在轨写在 **960 块**、S 档沿层叠继承 —— 原判据「S 档自己那块里有这四行」不再成立:
  //   它既会在「轨只写给 S、M 留两列」时绿,也会在「两档都写一份」时绿,两种都不是现在的形态。
  //   新判据把「写在哪一档」也钉住:960 块里有,600 块里**一个 .bn-kpis 规则都没有**(= 真的继承)。
  it('M↓ CSS:一行横滑 + flex:0 0 140px + 隐滚动条(照抄 mx-list 的 .mx-kpirail),S 档继承不重写', () => {
    const m = mediaBlock(VIEW_CSS, Q960)
    expect(m).not.toBe('')   // 取不到块 ⇒ 下面几条全成空转
    expect(m).toContain('.bn-kpis { display: flex; flex-wrap: nowrap; overflow-x: auto;')
    expect(m).toContain('.bn-kpis > * { flex: 0 0 140px; }')
    expect(m).toContain('.bn-kpis::-webkit-scrollbar { display: none; }')
    expect(m).toContain('scrollbar-width: none;')
    // S 档一条不重写:重写一份 = 两处几何要同步改,下一个人只会改一处
    expect(mediaBlock(VIEW_CSS, Q600)).not.toContain('.bn-kpis')
    // 范式同源:mx-list.css 的 .mx-kpirail S 档那段写的就是这三样
    const mx = mediaBlock(MX_CSS, Q600)
    expect(mx).toContain('.mx-kpirail > * { flex: 0 0 140px; }')
    expect(mx).toContain('.mx-kpirail::-webkit-scrollbar { display: none; }')
  })

  it('S 档不走「先砍再排」:四张卡没有任何条件渲染,600 块里也不再排格子', async () => {
    // 「先砍再排」是 ≥5 张那一档的做法,落地形态一定是给某几张卡加 v-if / display:none。
    // 本屏 4 张走横滑,所以模板里四个 <FPStat> 一个条件都不许挂。
    const stats = VIEW_CSS.match(/<FPStat\b[^>]*>/g) ?? []
    expect(stats).toHaveLength(4)
    expect(stats.filter(t => /\bv-(if|show)\b/.test(t))).toEqual([])
    // 轨改成 flex 之后 S 档不该再留任何格子定义(留着=有人把 2×2 又写回来了)
    expect(mediaBlock(VIEW_CSS, Q600)).not.toContain('grid-template-columns')
    const v = await open('s')
    expect(v.findAll('.bn-kpis .fs')).toHaveLength(4)
  })

  // ⚠ 收窄:上一轮这条断的是「M 档仍是两列(本轮不动)」。原判据是范围判断(上一轮 M 档动作没收,
  //   标题行还占着地方,KPI 改不改都到不了「表进首屏」),不是「两列更对」。这一轮 M 档动作收完,
  //   KPI 那 196px 成了 M 屏顶最大的一块,而 §5.7 是**按卡片数分档**(4 张 ⇒ 横滑),不按视口;
  //   §3.5-pre 又要求 M 档行组成静态确定 —— 两列 grid 在 4 张时永远吃两行。故 M 档改走同一条轨。
  it('M 档与 S 同轨(4 张 ⇒ 横滑),XL 仍是 repeat(4, minmax(150px, 1fr))(§9 零差异)', async () => {
    expect(mediaBlock(VIEW_CSS, Q960)).not.toContain('grid-template-columns')
    const outside = VIEW_CSS.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    expect(outside).toContain('.bn-kpis { flex: 0 0 auto; display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; }')
    // 形态是 CSS 的事,张数是 DOM 的事:M 档同样四张一张不砍(≥5 张才「先砍再排」)
    const v = await open('m')
    expect(v.findAll('.bn-kpis .fs')).toHaveLength(4)
  })

  it('层叠顺序:960 块写在 600 块之前(写反是静默的,S 档会被 M 档盖回两列)', () => {
    const i960 = VIEW_CSS.indexOf(Q960)
    const i600 = VIEW_CSS.indexOf(Q600)
    expect(i960).toBeGreaterThan(0)
    expect(i600).toBeGreaterThan(i960)
    // 本轮没有新开媒体块:全文件只有 960 / 600 / hover:none 三条
    expect(VIEW_CSS.match(/@media \(max-width: (\d+)px\)/g)).toEqual([Q960, Q600])
  })

  it('140 宽的卡上标签补了省略号(FPStat 的 .fs-l 是 nowrap 且没有 overflow,不截会压到邻卡)', () => {
    expect(STAT_CSS).toContain('.fs-l { font-size: var(--fs-label); line-height: 18px; color: var(--text-primary); white-space: nowrap; }')
    // 跟着轨一起搬进 960 块:140 宽的卡 M 档也有,省略号留在 600 块 = M 档标签压邻卡
    expect(mediaBlock(VIEW_CSS, Q960)).toContain('.bn-kpis :deep(.fs-l) { overflow: hidden; text-overflow: ellipsis; }')
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('§5.10 屏标题行 —— 屏名不上屏,动作收成 1 主 +「⋯」,状态留一颗徽标', () => {
  it('XL 档基线:h2 屏名 / 期段控 / 五颗只读动作都在,没有「⋯」(§9 零差异)', async () => {
    const v = await open('xl')
    expect(v.find('h2.bn-title').exists()).toBe(true)
    expect(v.find('h2.bn-title').text()).toContain('催缴单')
    expect(v.findAll('.bn-head-l .ds-seg-item')).toHaveLength(3)
    const labels = v.findAll('.bn-actions .ds-btn').map(b => b.text())
    expect(labels).toEqual(expect.arrayContaining(['收款公司', '收款簿', '系数簿', '导出通知单', '导出对账表']))
    expect(v.find('.bn-actions .fp-emb').exists()).toBe(true)
    expect(v.find('.bn-actions .fp-more').exists()).toBe(false)
    expect(v.find('.bn-fbtn').exists()).toBe(false)
  })

  it('S 档:h2 屏名整个不进 DOM(判据四 —— 顶栏 52px 已经写着「催缴单」)', async () => {
    const v = await open('s')
    expect(v.find('h2.bn-title').exists()).toBe(false)
  })

  it('M 档:屏名同样不画(§5.10「M 档」那段明文),L 档还画', async () => {
    expect((await open('m')).find('h2.bn-title').exists()).toBe(false)
    w?.unmount(); w = null
    // L 档(961–1280)不在 §5.10 的收编范围,屏名照旧
    setTier('xl')
    vi.stubGlobal('matchMedia', (q: string) => ({
      media: q, matches: q.includes('1280'), addEventListener() {}, removeEventListener() {},
    }))
    _resetViewportForTest()
    useBillingPeriodStore().pick(2026, 8)
    w = mount(BillNoticesView, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(w.find('h2.bn-title').exists()).toBe(true)
  })

  // ⚠ 收窄:上一轮这条断的是「主动作(.fp-emb)**在行上**」—— 那时手机顶栏还没有动作位,
  //   主动作只能留在行上。这一轮 §5.10「动作 → 顶栏右:1 个主动作」落地(useTopBarAction),
  //   行上再画一颗就是同一个动作画两遍,所以原判据不再成立:S 档 .fp-emb 必须**不在行上**,
  //   而主动作必须在 ui.topBarAction 里、并且真的能点(下面直接调 onClick 验它接的是 toggleEdit)。
  it('S 档:主动作搬进顶栏(行上没有编辑按钮),另外六个入口一个不剩地进了「⋯」', async () => {
    const v = await open('s')
    expect(v.find('.bn-actions .fp-emb').exists()).toBe(false)
    // 顶栏动作位:label 就是无障碍名,点它真的进编辑态(不点它一件写操作都做不成)
    const ui = useUiStore()
    expect(ui.topBarAction?.label).toBe('编辑模式')
    ui.topBarAction!.onClick()
    await flushPromises()
    expect(ui.topBarAction?.label, '顶栏那颗点下去没进编辑态').toBe('完成')
    // 行上不再有那五颗 ds-btn
    const onRow = v.findAll('.bn-actions .ds-btn').map(b => b.text())
    expect(onRow).not.toContain('收款公司')
    expect(onRow).not.toContain('导出通知单')
    // 「⋯」在,且点开之后六件一件不少(先断真的选到了菜单项,再断内容)。
    // 编辑态下菜单里还多「批量确认」与「生成」—— 生成在 S 档进菜单,M 档留在行上。
    const more = v.find('.bn-actions .fp-more-btn')
    expect(more.exists()).toBe(true)
    await more.trigger('click')
    const items = v.findAll('.fp-more-item').map(b => b.text())
    expect(items.length).toBeGreaterThanOrEqual(6)
    for (const t of ['收款公司', '收款簿', '系数簿', '导出通知单', '导出对账表', '批量确认']) {
      expect(items).toContain(t)
    }
    expect(items.some(t => /重新生成|生成本月/.test(t)), 'S 档生成也该在菜单里').toBe(true)
  })

  it('S 档:顶栏不画按不动的按钮 —— 只读账号(canEnter 假)不登记主动作', async () => {
    useAuthStore().permissions = []          // 无写权、也无 elevate:request ⇒ canEnter 假
    await open('s')
    expect(useUiStore().topBarAction).toBeNull()
  })

  it('M 档:顶栏根本不渲染(AppShell:162)⇒ 主动作留屏内 2 个:编辑模式 + 生成(编辑态)', async () => {
    const v = await open('m')
    // ① 编辑模式在行上(M 档没有手机顶栏可搬)
    expect(v.find('.bn-actions .fp-emb').exists()).toBe(true)
    // 浏览态:五颗只读钮已经收走,行上的 ds-btn 里没有它们
    const browse = v.findAll('.bn-actions .ds-btn').map(b => b.text())
    for (const t of ['收款公司', '收款簿', '系数簿', '导出通知单', '导出对账表']) {
      expect(browse.some(x => x.includes(t)), `${t} 还留在 M 档行上`).toBe(false)
    }
    // ② 进编辑态后生成留在行上(不是菜单里)
    await v.find('.fp-emb').trigger('click')
    await flushPromises()
    const edit = v.findAll('.bn-actions .ds-btn').map(b => b.text())
    expect(edit.some(t => /重新生成|生成本月/.test(t)), 'M 档第二个主动作该在行上').toBe(true)
    await v.find('.bn-actions .fp-more-btn').trigger('click')
    const items = v.findAll('.fp-more-item').map(b => b.text())
    expect(items.length).toBeGreaterThanOrEqual(6)   // 先断真的选到了菜单项
    expect(items.some(t => /重新生成|生成本月/.test(t)), 'M 档生成在行上又在菜单里 = 画两遍').toBe(false)
    expect(items).toContain('批量确认')
  })

  it('S 档:状态是行上一颗徽标,不是一整行 ——「⋯」里没有它', async () => {
    const v = await open('s')
    // 告警入口 chip(.fac,30 高)留在标题行左组里
    const chip = v.find('.bn-head-l .fac')
    expect(chip.exists()).toBe(true)
    // 左组收完只剩这一颗:屏名与期段控都走了,所以它没有把行撑成两行
    expect(v.findAll('.bn-head-l > *')).toHaveLength(1)
    // .bn-head 底下仍然只有左右两块,没有为状态新开一行
    expect(v.findAll('.bn-head > *')).toHaveLength(2)
    await v.find('.bn-actions .fp-more-btn').trigger('click')
    const items = v.findAll('.fp-more-item').map(b => b.text())
    expect(items.some(t => t.includes('待处理') || t.includes('审核'))).toBe(false)
  })

  it('§5.11:「⋯」里一点就不可逆的「重新生成」走二次确认,confirm 说不就不发请求', async () => {
    const v = await open('s')
    useUiStore().topBarAction!.onClick()          // 进编辑态,generate 那条才进菜单
    await flushPromises()
    await v.find('.bn-actions .fp-more-btn').trigger('click')
    const gen = v.findAll('.fp-more-item').find(b => /重新生成|生成本月/.test(b.text()))
    expect(gen, '编辑态下菜单里应该有生成那条').toBeTruthy()
    const confirmSpy = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmSpy)
    await gen!.trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalledOnce()
    expect(confirmSpy.mock.calls[0][0]).toContain('覆盖')
    expect(billNoticesApi.generate).not.toHaveBeenCalled()
  })

  it('§5.11:「⋯」→「批量确认」那一路同样不可逆(单向流转)—— 落刀前有二次确认', async () => {
    const v = await open('s')
    useUiStore().topBarAction!.onClick()
    await flushPromises()
    await v.find('.bn-actions .fp-more-btn').trigger('click')
    const entry = v.findAll('.fp-more-item').find(b => b.text().includes('批量确认'))
    expect(entry, '编辑态下菜单里应该有批量确认那条').toBeTruthy()
    await entry!.trigger('click')
    // 先断真的进了选择态(操作条换上来了),再断确认这件事
    const all = v.find('.bn-toolbar .bn-bulkb')
    expect(all.exists()).toBe(true)
    expect(all.text()).toContain('全选')
    await all.trigger('click')
    const go = v.findAll('.bn-toolbar .ds-btn').find(b => b.text().includes('确认选中'))
    expect(go, '选中之后该有「确认选中 N 户」').toBeTruthy()
    const confirmSpy = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmSpy)
    await go!.trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalledOnce()
    // 2026-09-23:交付轴不再是单向的(S20 §1.3 那条「不提供退回草稿按钮」已被推翻),
    // 这句二次确认改成说**代价**——重生成会跳过这几户,要反悔得逐户去抽屉里取消。
    expect(confirmSpy.mock.calls[0][0]).toContain('重新生成会跳过这几户')
    expect(confirmSpy.mock.calls[0][0], '这句话现在是假的').not.toContain('不能改回草稿')
    expect(billDeliveryApi.confirm).not.toHaveBeenCalled()
  })

  it('单户确认不加二次确认:那一户就在手指底下,106 行一行一个弹窗 = 把确认变成肌肉记忆', async () => {
    const v = await open('xl')
    await v.find('.fp-emb').trigger('click')       // 进编辑态,行内「确认」钮才出
    await flushPromises()
    const one = v.find('.bn-cfm')
    expect(one.exists(), '编辑态下 draft 户行上该有「确认」').toBe(true)
    const confirmSpy = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirmSpy)
    vi.mocked(billDeliveryApi.confirm).mockResolvedValue({ confirmed: 1, skipped: 0 } as never)
    await one.trigger('click')
    await flushPromises()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(billDeliveryApi.confirm).toHaveBeenCalledOnce()
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('§5.10 筛选行 —— >2 件控件就收:搜索留外面,选择器进面板', () => {
  it('XL 档基线:复选框与批量确认在行上,没有筛选钮、没有面板(§9 零差异)', async () => {
    const v = await open('xl')
    expect(v.find('.bn-toolbar .bn-chk').exists()).toBe(true)
    expect(v.find('.bn-toolbar .bn-search').exists()).toBe(true)
    expect(v.find('.bn-fbtn').exists()).toBe(false)
    expect(v.find('.bn-fpanel').exists()).toBe(false)
  })

  it('S 档:行上只剩搜索 + 一颗写着当前期的筛选钮', async () => {
    const v = await open('s')
    expect(v.find('.bn-toolbar .bn-search').exists()).toBe(true)
    expect(v.find('.bn-toolbar .bn-chk').exists()).toBe(false)
    const btn = v.find('.bn-toolbar .bn-fbtn')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('一期')
    // 计数只数非默认的那几件:刚进屏一件都没改 ⇒ 不画计数
    expect(v.find('.bn-fcnt').exists()).toBe(false)
    // 批量确认是动作不是筛选,S 档跟着动作进了「⋯」
    expect(v.findAll('.bn-toolbar .ds-btn').map(b => b.text())).not.toContain('批量确认')
  })

  it('M 档:与 S 同判(narrow)—— 复选与批量确认都不在行上,筛选钮与面板照出', async () => {
    const v = await open('m')
    expect(v.find('.bn-toolbar .bn-search').exists()).toBe(true)
    expect(v.find('.bn-toolbar .bn-chk').exists()).toBe(false)
    // ⚠ 「批量确认」的判据是 canIssue = mayIssue && editMode —— **必须先进编辑态**,
    //   否则它在任何档都不渲染,这条就是恒真(2026-09-21 对抗复查实跑抓到:
    //   把 :844 的判据从 isS 改成 narrow,三档一条断言都没覆盖到)。
    await v.find('.fp-emb').trigger('click')
    await flushPromises()
    // 前提:编辑态真的进去了 —— 用同屏已被别处验证过的判据(编辑态才出的「生成」留在行上)
    expect(v.findAll('.bn-actions .ds-btn').map(b => b.text()).some(t => /重新生成|生成本月/.test(t)),
      '前提:编辑态没进去,下面那条就成了恒真').toBe(true)
    expect(v.findAll('.bn-toolbar .ds-btn').map(b => b.text()),
      'M 档「批量确认」该收进「⋯」,不该留在筛选行上').not.toContain('批量确认')
    const btn = v.find('.bn-toolbar .bn-fbtn')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('一期')
    await btn.trigger('click')
    expect(v.findAll('.bn-fpanel .ds-seg-item').map(b => b.text())).toEqual(['一期', '二期', '三期'])
    expect(v.find('.bn-fpanel .bn-chk').exists()).toBe(true)
  })

  it('S 档:面板里一件不少 —— 期段控 3 颗 + 仅看有警告', async () => {
    const v = await open('s')
    expect(v.find('.bn-fpanel').exists()).toBe(false)   // 没点之前不渲染
    await v.find('.bn-fbtn').trigger('click')
    const panel = v.find('.bn-fpanel')
    expect(panel.exists()).toBe(true)
    expect(panel.findAll('.ds-seg-item').map(b => b.text())).toEqual(['一期', '二期', '三期'])
    expect(panel.find('.bn-chk').exists()).toBe(true)
    expect(panel.find('.bn-chk').text()).toContain('仅看有警告')
  })

  it('S 档:面板里那份是活的 —— 换期真的换表,不是摆设', async () => {
    const v = await open('s')
    expect(tenantRows(v)).toHaveLength(2)              // 一期:力灏 + 宏远
    await v.find('.bn-fbtn').trigger('click')
    const seg = v.findAll('.bn-fpanel .ds-seg-item')
    await seg[1].trigger('click')                      // 二期
    await flushPromises()
    expect(tenantRows(v)).toHaveLength(1)              // 二期:晟通
    expect(tenantRows(v)[0].find('.bn-tname').text()).toContain('晟通')
    expect(v.find('.bn-fbtn').text()).toContain('二期')
  })

  it('S 档:勾「仅看有警告」→ 表筛到 1 行,筛选钮长出计数 1', async () => {
    const v = await open('s')
    await v.find('.bn-fbtn').trigger('click')
    const chk = v.find('.bn-fpanel .bn-chk input')
    await chk.setValue(true)
    await flushPromises()
    expect(tenantRows(v)).toHaveLength(1)
    expect(tenantRows(v)[0].find('.bn-tname').text()).toContain('宏远')
    expect(v.find('.bn-fcnt').text()).toBe('1')
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('§G 屏顶块高逐条钉死(算术见文件头,收完 0 行 → 9 行)', () => {
  it('工序条 54(§5.9 定高,本轮没动);M 档那一支断的是「不折行」,54 在 M 是推算值', () => {
    expect(STRIP_CSS).toContain('.fss--s {\n  height: 54px;')
    // M 档没有定高声明,算术里的 54 靠这一条撑着:一行药丸、横滑,不会折成两行再把表推下去
    expect(STRIP_CSS).toContain('.fss--m { flex-wrap: nowrap; }')
  })

  it('筛选条 44:筛选钮 44 高,搜索框在 960 块里跟到 44(同一行两件控件同档)', () => {
    const outside = VIEW_CSS.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    expect(outside).toContain('.bn-fbtn { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 44px;')
    expect(mediaBlock(VIEW_CSS, Q960)).toContain('.bn-search { height: 44px; }')
    // 16px 是 §6.5 的 iOS 聚焦不缩放门槛,只在 S 档补
    expect(mediaBlock(VIEW_CSS, Q600)).toContain('font-size: var(--fs-input-m);')
  })

  it('KPI 轨 92 = FPStat 的六段几何(12+18+4+26+4+16+12)', () => {
    expect(STAT_CSS).toContain('.fs { box-sizing: border-box; min-width: 0; border-radius: var(--radius-lg); padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }')
    expect(STAT_CSS).toContain('line-height: 18px')      // .fs-l
    expect(STAT_CSS).toContain('height: 26px;')          // .fs-n
    expect(STAT_CSS).toContain('line-height: 16px')      // .fs-s
  })

  it('页面 gap 14、表头 34 / 行高 34 / tfoot 40(算术里的三个除数没被改掉)', () => {
    expect(VIEW_CSS).toContain('.bn-page { position: relative; display: flex; flex-direction: column; gap: 14px;')
    expect(VIEW_CSS).toContain('.bn-table thead th { position: sticky; top: 0; height: 34px;')
    expect(VIEW_CSS).toContain('.bn-table tbody td { height: 34px;')
    expect(VIEW_CSS).toContain('.bn-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 40px;')
  })

  it('§5.4 没被顺手改掉:colgroup 一根不动,窄了照旧在 .bn-wrap 内横滚', () => {
    expect(mediaBlock(VIEW_CSS, Q960)).toContain('.bn-table { min-width: 920px; }')
    expect(VIEW_CSS).toContain('.bn-wrap { flex: 1 1 auto; min-height: 0; overflow: auto;')
  })
})
