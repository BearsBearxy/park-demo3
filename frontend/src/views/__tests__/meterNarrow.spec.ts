/**
 * 园区抄表 · S 档屏顶(RESPONSIVE-LAYOUT-SPEC §5.7 屏顶 KPI 行 + §5.10 屏标题行/筛选行)。
 *
 * 这一组是 390 体检(MOBILE-390-AUDIT-2026-09-21 §1-D)那条的收口屏:
 * 表前五块 723px > 首屏 655px,`.mt-page` 是 height:100% 定高链、表是唯一 flex:1 可压的孩子
 * —— 表被压到 0 行,用户原话「抄表屏根本看不到表格」。
 *
 * 钉的是屏顶那笔算术,不是「好不好看」:
 *   工序条 54(§5.9,别人的文件)+ 摘要行 44 + 筛选条 44 + 标题行 0 = 142
 * 四个数任意一个松掉,表能露几行就不是 §5.10 末尾算的那个数。所以四条都逐条钉死,
 * 并额外钉一条合计 —— 合计那条是让「某人把 44 改成 52、另一处减回去」这种互相抵消也红。
 *
 * 档位判定走 useViewport 的 tier(JS),不走 @media:S 档换的是 DOM 结构不是样式。
 * jsdom 无 matchMedia → tier 恒 'xl',既有桌面断言(meterWriteGuards 等)自动走宽档分支。
 * 所以每组都成对断 S 与 XL:只断一档等于没断 —— 把 isS 写成恒真时单档断言照样全绿,
 * 而桌面 1440 被改掉了(§9 零差异)。
 *
 * 夹具口径(不许退化:两行数据比值都一样 / 全零 / 只有一行,写死也绿):
 *   三块租户电表、同在 p1 区,两块已抄一块未抄 → 租户表总数 3 / 已抄 2 / 未抄 1 / 派生就绪 3,
 *   异常 0 / 待核·待绑定 0·0。这正是真库里那六张卡的形状(93 / 92 / 1 / 0 / 0·0 / 92)。
 *   「异常自己长出来」那条**换一份夹具重跑**(usageTotal 打成负数 → 倒走 → 异常 1),
 *   不是同一份夹具断两种。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import MeterView from '@/views/meters/MeterView.vue'
import MeterLedgerGrid from '@/views/meters/MeterLedgerGrid.vue'
import Segmented from '@/components/ds/Segmented.vue'
import { metersApi, type MeterDTO, type MeterReadingDTO, type MeterBindingDTO, type MeterDeleteDTO } from '@/api/meters'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { _resetViewportForTest } from '@/composables/useViewport'

// jsdom 没有 ResizeObserver,而 MeterLedgerGrid 的 onMounted 直接 new 它(同 meterWriteGuards:35)
class ROStub {
  constructor(_cb: ResizeObserverCallback) { void _cb }
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ROStub

vi.mock('@/api/meters', () => ({
  metersApi: {
    list: vi.fn(), readings: vi.fn(), binding: vi.fn(), months: vi.fn(),
    meterReadings: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
    createReading: vi.fn(), updateReading: vi.fn(), deleteReading: vi.fn(),
    deletePreview: vi.fn(), batchDelete: vi.fn(), autoLinkByName: vi.fn(),
    bind: vi.fn(), importRows: vi.fn(), usageSummary: vi.fn(),
  },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/building', () => ({ buildingApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/zones', () => ({ zonesApi: { list: () => Promise.resolve([{ code: 'p1', name: '一期' }, { code: 'p2', name: '二期' }]) } }))
vi.mock('@/api/alloc', () => ({
  allocApi: { poolMonths: () => Promise.resolve([]), lossMonths: () => Promise.resolve([]) },
}))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: () => Promise.resolve([]) } }))
vi.mock('@/api/review', () => ({
  reviewApi: {
    closedMonths: vi.fn().mockResolvedValue([]),
    states: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { status: () => Promise.resolve(null) } }))
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/meters?' + new URLSearchParams(query).toString() } }),
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

const YM = '2025-03'

/** 一块租户电表。字面量 + as never 会把漏字段悄悄放过去,故按 MeterDTO 声明。 */
function meter(id: number, name: string): MeterDTO {
  return {
    id, kind: 'elec', zone: 'p1', name, area: 'A座', spot: '一楼东侧',
    floorLabel: '一楼', side: '东侧', roomNo: `10${id}室`,
    tenantName: `租户${id}`, tenantId: id, buildingId: 13, ownership: 'tenant',
    meterType: null, deviceType: 'three', subName: `电表${id}`, code: `E-00${id}`, factor: 500,
    retiredYm: null, activeFromYm: null, removedYm: null, sortNo: id, readingCount: 1,
  }
}
/** 已抄的一条读数;usageTotal 可打成负数 → 倒走 → 异常 +1(readingFlags:25)。 */
function reading(meterId: number, curr: number, usageTotal: number): MeterReadingDTO {
  return {
    id: 100 + meterId, meterId, ym: YM,
    prevTotal: 100, currTotal: curr,
    prevSharp: null, prevPeak: null, prevFlat: null, prevValley: null,
    currSharp: null, currPeak: null, currFlat: null, currValley: null,
    factorSnap: 500, usageTotal,
    usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null,
    note: null, source: 'manual',
  }
}

const METERS = [meter(1, '一车间总电'), meter(2, '二车间总电'), meter(3, '三车间总电')]
/** 基线:1、2 已抄(各自用量不同 —— 两行比值全等的夹具写死也绿),3 未抄。异常 0。 */
const READINGS_OK = [reading(1, 180, 40000), reading(2, 260, 75000)]
/** 换一份夹具:1 号倒走(usageTotal<0)→ 异常 1。其余原样。 */
const READINGS_NEG = [reading(1, 80, -10000), reading(2, 260, 75000)]
/** 三块表全部 auto 绑定 → 派生就绪 3、待绑定 0。 */
const BINDING: MeterBindingDTO = {
  summary: { pending: 0 },
  rows: METERS.map(m => ({
    meterId: m.id, status: 'auto' as const, bucket: null, contractId: null,
    contractNo: null, locations: [], hasReading: true,
  })),
}
const DEL_PREVIEW: MeterDeleteDTO = {
  ym: YM, readings: 137, meters: 137, metersEmptied: 3, derived: 412,
  manualKept: [], meterDeleted: ['测试表A'], meterBlocked: [],
}

/** S 档桩:三条 max-width 全命中 → useViewport 判 tier='s'(390 手机)。 */
function asS() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: /max-width: (600|960|1280)px/.test(q), media: q,
    addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}
/** XL 档 = 不给 matchMedia(jsdom 原样),useViewport 回落 'xl'。 */
function asXL() {
  vi.unstubAllGlobals()
  _resetViewportForTest()
}

interface MeterVm {
  editMode: boolean
  status: string
  own: string
  suspectOnly: boolean
  delTyped: string
  delPreview: MeterDeleteDTO | null
  panel: '' | 'filter' | 'more'
}
const vmOf = (w: { vm: unknown }) => w.vm as MeterVm

async function open(readings: MeterReadingDTO[] = READINGS_OK) {
  vi.mocked(metersApi.readings).mockImplementation((ym: string) =>
    Promise.resolve(ym === YM ? readings : []))
  const w = mount(MeterView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['meter-reading:edit', 'meter-master:edit']
  useBillingPeriodStore().pick(2025, 3)
  for (const k of Object.keys(query)) delete query[k]
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(metersApi.list).mockResolvedValue(METERS)
  vi.mocked(metersApi.binding).mockResolvedValue(BINDING)
  vi.mocked(metersApi.months).mockResolvedValue([YM])
  vi.mocked(metersApi.deletePreview).mockResolvedValue(DEL_PREVIEW)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})
afterEach(() => { asXL() })

// ─────────────────────────────────────────────────────────────────────────────

const SRC = readFileSync(join(__dirname, '../meters/MeterView.vue'), 'utf8').replace(/\r\n/g, '\n')
const STRIP_SRC = readFileSync(join(__dirname, '../../components/fp/FPStepStrip.vue'), 'utf8').replace(/\r\n/g, '\n')

/** 从 CSS 文本里取某个选择器规则块内 `prop: value` 的那个 value(取第一处命中)。 */
function cssProp(css: string, selector: string, prop: string): string | null {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) return null
  const end = css.indexOf('}', at)
  const body = css.slice(at, end)
  const m = new RegExp(`(?:^|[;{])\\s*${prop}\\s*:\\s*([^;}]+)`).exec(body)
  return m ? m[1].trim() : null
}

describe('§5.7+§5.10 · S 档屏顶四块的高度逐条钉死', () => {
  it('摘要行 44:定高且 flex 不许压缩(.mt-page 是 height:100% 定高链)', () => {
    expect(cssProp(SRC, '.mt5-sum', 'height')).toBe('44px')
    expect(cssProp(SRC, '.mt5-sum', 'flex')).toBe('0 0 44px')
  })

  it('筛选条 44:同上', () => {
    expect(cssProp(SRC, '.mt5-fbar', 'height')).toBe('44px')
    expect(cssProp(SRC, '.mt5-fbar', 'flex')).toBe('0 0 44px')
  })

  it('工序条 54(§5.9,FPStepStrip.vue 那一份)—— 屏顶合计的第三个加数', () => {
    // 这一条读的是别人的文件。钉它是因为 §5.10 末尾那笔算术(表可用 439 → 9 行)
    // 是四个数一起成立才成立的:工序条自己那份规范改了,本屏能露几行当场就不对了。
    expect(cssProp(STRIP_SRC, '.fss--s', 'height')).toBe('54px')
  })

  it('屏顶合计 = 142(54+44+44+0)—— 挡「这边加 8、那边减 8」的互相抵消', () => {
    const px = (v: string | null) => Number(String(v).replace('px', ''))
    const strip = px(cssProp(STRIP_SRC, '.fss--s', 'height'))
    const sum = px(cssProp(SRC, '.mt5-sum', 'height'))
    const fbar = px(cssProp(SRC, '.mt5-fbar', 'height'))
    expect([strip, sum, fbar]).toEqual([54, 44, 44])
    expect(strip + sum + fbar + 0).toBe(142)
  })

  it('屏顶块序与块数:定高链上流内只剩五块,gap 乘数是 4 不是 3', async () => {
    // §5.10 末尾那笔算术按「工序条/摘要行/筛选条/表」四块算 gap 14×3=42。
    // 实测流内还有第五块:`.mt5-s-hint`(荐桌面预留位,§11.2 用户拍板的形态,flex:0 0 20px)。
    // 于是 390 上的真账是:623 − (54+44+44+20) − 14×4 = 405,(405−112)÷34 = 8.6 → 8 行。
    // 这一条把块序与块数钉住:谁再往屏顶塞一块,行数当场变,而这条会指名道姓地红。
    asS()
    const w = await open()
    const page = w.find('.mt-page')
    expect(page.exists(), '前提:屏本体渲染出来了').toBe(true)
    const inFlow = [...page.element.children]
      .map(c => c.className)
      .filter(c => typeof c === 'string' && c !== '')   // teleport/transition 桩是浮层,不占流
    expect(inFlow).toEqual(['fss fss--s', 'mt5-sum', 'mt5-fbar', 'mt5-s-hint', 'mlg-wrap'])
    w.unmount()
  })

  it('标题行 0:S 档整行不在 DOM 里(不是 display:none)', async () => {
    asS()
    const w = await open()
    // ⚠ 先断「真的选到了东西」:选择器写错时 find 恒为空,下面那条就成了恒真
    expect(w.find('.mt-page').exists(), '前提:屏本体渲染出来了').toBe(true)
    expect(w.find('.mt5-sum').exists(), '前提:S 档分支确实走到了').toBe(true)
    expect(w.find('.mt-head').exists(), 'S 档标题行还在 —— 顶栏 52px 已经写着屏名(§5.10 判据四)').toBe(false)
    expect(w.find('.mt-title').exists()).toBe(false)
    w.unmount()
  })
})

describe('§5.7 · 摘要行:有数的上屏,值为 0 的进「更多」', () => {
  it('基线夹具:四段上屏(总数/已抄/未抄/派生就绪),异常与待核·待绑定进「更多」', async () => {
    asS()
    const w = await open()
    const segs = w.findAll('.mt5-sum-segs .mt5-seg:not(.more)')
    expect(segs.map(s => s.find('.lab').text())).toEqual(['租户表总数', '已抄', '未抄', '派生就绪'])
    expect(segs.map(s => s.find('.val').text())).toEqual(['3', '2', '1', '3'])
    // 值为 0 的两张卡(异常 / 待核·待绑定,三个维度)不在主行里,收进「更多」
    const more = w.find('.mt5-seg.more')
    expect(more.exists(), '「更多」入口不见了 —— 0 值维度就成了无处可达').toBe(true)
    expect(more.find('.val').text()).toBe('2')
    w.unmount()
  })

  it('换一份夹具(1 号倒走):异常自己长回主行,「更多」随之少一样', async () => {
    asS()
    const w = await open(READINGS_NEG)
    const labs = w.findAll('.mt5-sum-segs .mt5-seg:not(.more)').map(s => s.find('.lab').text())
    expect(labs, '前提:摘要行确实渲染出了段').not.toHaveLength(0)
    expect(labs).toContain('异常')
    const i = labs.indexOf('异常')
    expect(w.findAll('.mt5-sum-segs .mt5-seg:not(.more)')[i].find('.val').text()).toBe('1')
    // 长出来的只有它:此刻仍为 0 的那一张不许跟着一起冒到主行里
    // (只断「异常在」的话,把 sumSegs 的 n>0 过滤整个删掉照样绿 —— 2026-09-21 破坏验证实测)
    expect(labs, '待核 / 待绑定 此刻是 0·0,不该在主行').not.toContain('待核 / 待绑定')
    expect(labs).toEqual(['租户表总数', '已抄', '未抄', '异常', '派生就绪'])
    // 判据是此刻的数,不是写死藏三样:剩下的 0 值维度只有「待核 / 待绑定」一张
    expect(w.find('.mt5-seg.more .val').text()).toBe('1')
    w.unmount()
  })

  it('每段是独立点击区且 ≥36 高;点「未抄」照样筛表(行数从 3 变 1)', async () => {
    asS()
    const w = await open()
    expect(cssProp(SRC, '.mt5-seg', 'min-height'), '触达下限 §6.2').toBe('36px')
    const grid = w.findComponent(MeterLedgerGrid)
    expect((grid.props('rows') as unknown[]).length, '前提:三块表都在表里').toBe(3)

    const segs = w.findAll('.mt5-sum-segs .mt5-seg:not(.more)')
    const missing = segs.find(s => s.find('.lab').text() === '未抄')
    expect(missing, '前提:「未抄」这一段真的在主行里').toBeTruthy()
    expect(missing!.element.tagName, '每段必须是自己的按钮,不是一整行一个点击区').toBe('BUTTON')
    await missing!.trigger('click')
    await flushPromises()
    expect(vmOf(w).status).toBe('missing')
    expect((grid.props('rows') as unknown[]).length, '点了「未抄」表没跟着筛 —— 宽档点卡能筛,这个功能不许丢').toBe(1)
    w.unmount()
  })

  it('「更多」里的段点下去同样筛表,并关掉面板', async () => {
    asS()
    const w = await open()
    await w.find('.mt5-seg.more').trigger('click')
    await flushPromises()
    const panelSegs = w.findAll('.mt5-panel .mt5-seg')
    expect(panelSegs.map(s => s.find('.lab').text())).toEqual(['异常', '待核 / 待绑定'])
    await panelSegs[0].trigger('click')
    await flushPromises()
    expect(vmOf(w).status).toBe('anomaly')
    expect(vmOf(w).panel).toBe('')
    expect((w.findComponent(MeterLedgerGrid).props('rows') as unknown[]).length).toBe(0)
    w.unmount()
  })

  it('进度「留数不留条」:条退成行底 3px 底纹,宽度跟着 92/93 那个百分比走', async () => {
    asS()
    const w = await open()
    expect(cssProp(SRC, '.mt5-sum-bar', 'height')).toBe('3px')
    // 夹具是已抄 2 / 租户表 3 = 67%;写死 100% 或写死 0 都红
    expect(w.find('.mt5-sum-bar > span').attributes('style')).toContain('width: 67%')
    w.unmount()
  })
})

describe('§5.10 · 筛选行收成「搜索 + 带计数的筛选钮」', () => {
  it('筛选钮计数:0 项(默认)不画数字', async () => {
    asS()
    const w = await open()
    expect(w.find('.mt5-fbar .mx-search input').exists(), '搜索框必须留在外面(输入即用)').toBe(true)
    const btn = w.find('.mt5-fbtn')
    expect(btn.exists(), '前提:筛选钮渲染出来了').toBe(true)
    expect(btn.find('.n').exists(), '一项没选却画着计数').toBe(false)
    expect(btn.classes()).not.toContain('on')
    w.unmount()
  })

  it('筛选钮计数:2 项(归属 + 状态)→ 钮上写 2', async () => {
    asS()
    const w = await open()
    const vm = vmOf(w)
    vm.own = 'share'
    vm.status = 'missing'
    await flushPromises()
    expect(w.find('.mt5-fbtn .n').text()).toBe('2')
    expect(w.find('.mt5-fbtn').classes()).toContain('on')
    // 再加一项:搜索不算(它在钮外),存疑算
    vm.suspectOnly = true
    await flushPromises()
    expect(w.find('.mt5-fbtn .n').text()).toBe('3')
    w.unmount()
  })

  it('面板里一件不少:段控 2 + 下拉 3 + 重置 1 = 收进去的六件(第七件是留在外面的搜索)', async () => {
    asS()
    const w = await open()
    await w.find('.mt5-fbtn').trigger('click')
    await flushPromises()
    const panel = w.find('.mt5-panel')
    expect(panel.exists(), '前提:筛选面板开出来了').toBe(true)
    expect(panel.findAllComponents(Segmented), '分区 + 电/水 两条段控').toHaveLength(2)
    expect(panel.findAll('.ds-sel-trigger'), '楼栋 / 归属 / 状态 三条下拉').toHaveLength(3)
    expect(panel.text()).toContain('重置')
    // 面板里的控件按 §6.2 主操作档 44 高(form-sheet.css 压 input/.ds-sel-trigger,这里管段)
    expect(cssProp(SRC, '.mt5-panel .mt5-seg', 'min-height')).toBe('44px')
    w.unmount()
  })

  it('主动作留 1 个(编辑模式)在流内那一行 —— 顶栏没有屏级动作插槽', async () => {
    asS()
    const w = await open()
    const bar = w.find('.mt5-fbar')
    expect(bar.exists(), '前提:S 档筛选条渲染出来了').toBe(true)
    expect(bar.text()).toContain('编辑模式')
    expect(bar.find('.fp-more-btn').exists(), '「⋯」溢出菜单').toBe(true)
    w.unmount()
  })
})

describe('§5.11 · 「⋯」里的不可逆动作有二次确认', () => {
  it('菜单里点「批量删除本期」→ 先出预览确认单,手打账期之前删不动', async () => {
    asS()
    const w = await open()
    const vm = vmOf(w)
    vm.editMode = true
    await flushPromises()

    await w.find('.mt5-fbar .fp-more-btn').trigger('click')
    await flushPromises()
    const items = w.findAll('.mt5-fbar .fp-more-item')
    expect(items.map(i => i.text()), '宽档那几颗动作一颗都不许在收纳时丢')
      .toEqual(['下载模板', '导出当月', '导入', '新增表', '批量删除本期'])

    const del = items[items.length - 1]
    await del.trigger('click')
    await flushPromises()

    // 不是「菜单里一行字点了就删」:先拉预览数字、再要人手打账期(§5.11 待办条那句)
    expect(metersApi.batchDelete).not.toHaveBeenCalled()
    expect(w.find('.mt-dlg h3').text()).toBe(`批量删除本期 · ${YM}`)
    const confirmBtn = w.findAll('.mt-dlg-f button').find(b => b.text().includes('确认删除'))
    expect(confirmBtn, '前提:确认删除那颗按钮真的在').toBeTruthy()
    expect(confirmBtn!.attributes('disabled'), '账期没打就能点 —— 二次确认成了摆设').toBeDefined()

    vm.delTyped = YM
    await flushPromises()
    expect(w.findAll('.mt-dlg-f button').find(b => b.text().includes('确认删除'))!.attributes('disabled')).toBeUndefined()
    w.unmount()
  })
})

describe('§9 · XL 档零差异:标题行、6 张卡、7 件筛选原样', () => {
  it('标题行 + 6 张统计卡照旧,S 档那两块一个都不出现', async () => {
    asXL()
    const w = await open()
    expect(w.find('.mt-head').exists()).toBe(true)
    expect(w.find('.mt-title').text()).toContain('园区抄表')
    expect(w.findAll('.mt5-cards .mt5-card'), '6 张卡一张都不许少').toHaveLength(6)
    expect(w.find('.mt5-prog .bar').exists(), '宽档进度条仍是条不是底纹').toBe(true)
    // 先断「真的选到了东西」(上面四条),再断不该有的
    expect(w.find('.mt5-sum').exists(), 'S 档摘要行漏到宽档了').toBe(false)
    expect(w.find('.mt5-fbar').exists(), 'S 档筛选条漏到宽档了').toBe(false)
    w.unmount()
  })

  it('筛选条 7 件原样:段控 2 + 下拉 3 + 搜索 1 + 重置 1', async () => {
    asXL()
    const w = await open()
    const bar = w.find('.mt5-filters')
    expect(bar.exists(), '前提:宽档筛选条还在').toBe(true)
    expect(bar.findAllComponents(Segmented)).toHaveLength(2)
    expect(bar.findAll('.ds-sel-trigger')).toHaveLength(3)
    expect(bar.findAll('.mx-search input')).toHaveLength(1)
    expect(bar.text()).toContain('重置')
    w.unmount()
  })

  it('宽档不画筛选钮 / 不画「⋯」—— 那两件是 S 档收纳出来的', async () => {
    asXL()
    const w = await open()
    expect(w.find('.mt5-filters').exists(), '前提:宽档筛选条还在').toBe(true)
    expect(w.find('.mt5-fbtn').exists()).toBe(false)
    expect(w.find('.fp-more-btn').exists()).toBe(false)
    w.unmount()
  })
})
