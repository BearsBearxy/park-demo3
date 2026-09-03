import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setActivePinia, createPinia } from 'pinia'

import PvMeterView from '@/views/pv/PvMeterView.vue'
import { pvMeterApi } from '@/api/pvMeter'
import type { PvReadingDTO } from '@/api/pvMeter'
import { useAuthStore } from '@/stores/auth'
import { usePresenceStore } from '@/stores/presence'
import { locksApi } from '@/api/locks'
import { S } from '@/utils/lockScopes'
import api from '@/api'

/**
 * 运营账屏动线的端到端证明（2026-08-29「两本账」设计稿 §③）。
 *
 * 挑光伏分栋抄表做样本：三屏（分栋抄表 / 分桩明细 / 电费成本总览）接法逐字相同。
 *
 * 要钉的就两条：
 *   ① 第一次进 = 选期矩阵，**不许**再自己 snap 到某个月（改前 `latestPeriodOf` 干的事）
 *   ② 选过之后**卸载重挂**照样直落表 —— 侧栏点击走 `tabs.openFresh()` → epoch 递增 →
 *      组件全新重建，期若回到屏内 ref，这条当场红。
 */

vi.mock('@/api/pvMeter', () => ({
  pvMeterApi: {
    stations: vi.fn(), readings: vi.fn(), months: vi.fn(), years: vi.fn(),
    createReading: vi.fn(), updateReading: vi.fn(), deleteReading: vi.fn(),
    createStation: vi.fn(), updateStation: vi.fn(), deleteStation: vi.fn(),
    simulate: vi.fn(), importRows: vi.fn(),
  },
}))

// 锁 mock 照 cpMeterFlow.spec.ts:34-44。不 mock 的话 locksApi 走真 axios,jsdom 里抛错 →
// 被 useEditLock「拿不准就不进」兜住 → 一切走 toggle/enter 的路径全挂。
// 这里全用 vi.fn()(cpMeter 那份是写死的箭头函数),因为下面两条要逐条改 acquire 的答案。
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: vi.fn(), release: vi.fn(), heartbeat: vi.fn(),
    takeover: vi.fn(), releaseOnUnload: vi.fn(),
  },
}))

// 期间深链(SIDEBAR-UX-REDESIGN §4.2):屏接了 useDeepPeriod(内部 useRoute)。query 可变 —— 深链那几条要在切回之间换掉 ?p=;
// fullPath 走 getter:useRoute() 的返回对象只建一次,写成普通字段的话切回时读到的还是旧地址(照 meterWriteGuards.spec:60-66)。
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/pv-income?' + new URLSearchParams(query).toString() } }),
}))

/** 2025-03 的一条真实形状记录。`revenue` 是后端派生字段,抽屉那一列直接 fy(r.revenue) —— 漏了就渲染崩。 */
const MAR: readonly PvReadingDTO[] = [
  { id: 1, stationId: 1, stationName: 'B 座', readDate: '2025-03-05',
    genTotal: 100, selfUse: 80, gridFeed: 20, priceSnap: 0.62, revenue: 49.6,
    note: null, source: 'manual' },
]

const STATIONS = [
  { id: 1, name: 'B 座', phase: 1, metered: 1, capacityKwp: 210, panelCount: 420, panelWatt: 500, priceYuan: 0.62, sortNo: 1 },
  { id: 2, name: 'C、D 座', phase: 1, metered: 1, capacityKwp: 252, panelCount: null, panelWatt: null, priceYuan: 0.62, sortNo: 2 },
]
/** 第三栋没装光伏计量表(V118 的 metered=0) */
const STATIONS_WITH_NOMETER = [
  ...STATIONS,
  { id: 3, name: 'E 座', phase: 1, metered: 0, capacityKwp: null, panelCount: null, panelWatt: null, priceYuan: null, sortNo: 3 },
]

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['meter-master:edit', 'meter-reading:edit']
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(query)) delete query[k]
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  vi.mocked(pvMeterApi.stations).mockResolvedValue(STATIONS as never)
  vi.mocked(pvMeterApi.readings).mockResolvedValue([] as never)
  vi.mocked(pvMeterApi.months).mockResolvedValue(['2025-01', '2025-02', '2025-03'])
})

async function open() {
  const w = mount(PvMeterView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回(照 meterWriteGuards.spec:299)。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(PvMeterView) : null) }),
  }), { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return { w, alive }
}

describe('光伏分栋抄表 · 选期动线', () => {
  it('❗第一次进 = 选期矩阵，不再自己 snap 到某个月', async () => {
    const w = await open()
    expect(w.find('.fmg').exists(), '该看到选期矩阵').toBe(true)
    expect(w.find('.pm-page').exists(), '不该直接落表格').toBe(false)
    expect(pvMeterApi.readings, '没选期就不该去拉某个月的读数').not.toHaveBeenCalled()
  })

  it('矩阵按后端给的账期画格', async () => {
    const w = await open()
    const cards = w.findAll('.bmm-card')
    expect(cards).toHaveLength(12)                 // 数据年只有 2025，当前年也是 2025
    expect(cards[0].classes()).toContain('has')
    expect(cards[2].classes()).toContain('has')
    expect(cards[3].classes()).toContain('blank')
  })

  it('点月格 → 落表格，拉的是那个月', async () => {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 3)
    expect(w.find('.pm-page').exists()).toBe(true)
    expect(w.find('.fmg').exists(), '门该退场').toBe(false)
  })

  it('❗卸载重挂后期还在 —— 侧栏点开直落表格', async () => {
    const first = await open()
    await first.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    first.unmount()

    // 侧栏点击 = openFresh → epoch 变 → 全新实例。期若在屏内 ref，这里就回到矩阵了。
    vi.clearAllMocks()
    vi.mocked(pvMeterApi.stations).mockResolvedValue(STATIONS as never)
    vi.mocked(pvMeterApi.readings).mockResolvedValue([] as never)
    vi.mocked(pvMeterApi.months).mockResolvedValue(['2025-01', '2025-02', '2025-03'])

    const again = await open()
    expect(again.find('.fmg').exists(), '选过期了就不该再拦').toBe(false)
    expect(again.find('.pm-page').exists()).toBe(true)
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 3)
  })

  it('顶栏「换月」回矩阵，年月下拉已不存在', async () => {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()

    expect(w.find('.pm-per').text(), '期写在工具条上').toBe('2025-03')
    // ⚠ 选择器只能是 .ds-sel-trigger。本仓下拉一律走 ds/Select(SystemLogsView.vue:155 明写),
    //   它渲染的是 <button class="ds-sel-trigger">,**从来不产出原生 <select>** ——
    //   写成 findAll('select') 的话这条恒为 0,把一个 <Select> 塞回去照样绿,等于零守卫。
    expect(w.findAll('.mx-toolbar .ds-sel-trigger'), '年月下拉整个撤了').toHaveLength(0)

    await w.find('.pm-permonth').trigger('click')
    await flushPromises()
    expect(w.find('.fmg').exists()).toBe(true)
  })

  it('❗一条数据都没有时照样画得出矩阵 —— 否则这本账彻底进不去', async () => {
    // 后端三个 /months 在空表时**正常返回 []**,不抛错。
    // 曾经用 `!dataMonths.length` 当加载中,于是零数据 → 门永久转圈 → 矩阵一次不渲染,
    // 而它是进这本账的唯一入口(功能门与返回箭头都已随重设计撤掉)。
    // 全新部署、或某车型一条抄表都没有时,那本账从此不可达,第一条也录不进去。
    vi.mocked(pvMeterApi.months).mockResolvedValue([])
    const w = await open()
    expect(w.find('.page-spin').exists(), '空数据不是「加载中」').toBe(false)
    expect(w.findAll('.bmm-card'), '当前年一行 12 张空卡').toHaveLength(12)
    expect(w.findAll('.bmm-card.blank')).toHaveLength(12)

    // 而且点得进去 —— 那正是要去录第一笔的地方
    await w.findAll('.bmm-card')[6].trigger('click')
    await flushPromises()
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 7)
  })

  it('❗换月取数失败 → 说出来 + 清空，不许「新期标题 + 上一期数字」', async () => {
    // 对抗复查坐实:点月格那一刻 picked 当场变 true、门收起、工具条期标与空态文案全换成新期,
    // 而表体的 readings 是上一期的 —— 用户把 3 月的量当 7 月读走,零提示、不自愈。
    // 更硬的一半:改前 loadReadings 连 try/catch 都没有。
    vi.mocked(pvMeterApi.readings).mockResolvedValue(MAR as never)
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')   // 2025-03,有数据
    await flushPromises()
    expect(w.find('.pm-per').text()).toBe('2025-03')

    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    await w.find('.pm-permonth').trigger('click')      // 回矩阵
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')   // 2025-07,取数会失败
    await flushPromises()

    expect(w.find('.pm-per').text(), '期标已经是新期').toBe('2025-07')
    expect(w.find('.fp-lderr').exists(), '失败必须说出来').toBe(true)
    expect(w.text()).toContain('后端挂了')
  })

  it('❗录入/删除/导入之后要刷账期清单 —— 否则矩阵把刚录过的月继续画成「空」', async () => {
    // dataMonths 改前只喂年下拉(有 buildYearOptions 兜底,陈旧无所谓);
    // 现在它是矩阵 hasData 着色与「最近有数据月」描边的**唯一**数据源,陈旧就是矩阵在说假话。
    const w = await open()
    await w.findAll('.bmm-card')[7].trigger('click')   // 2025-08,空月
    await flushPromises()
    // 写函数各自判编辑态(照 BillNoticesView),浏览态下直接 return —— 这里要测的是"写完刷清单",
    // 所以必须先真的进编辑态,不能绕过守卫直接调。
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    vi.mocked(pvMeterApi.months).mockClear()

    vi.mocked(pvMeterApi.deleteReading).mockResolvedValue(undefined as never)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const vm = w.vm as unknown as { delRow: (id: number, d: string) => Promise<void> }
    await vm.delRow(1, '2025-08-05')
    await flushPromises()

    expect(pvMeterApi.months, '写完要重新问一遍哪些月有数据').toHaveBeenCalled()
  })

  it('账期清单拉不到 → 说出来 + 给重试，不给半张矩阵', async () => {
    vi.mocked(pvMeterApi.months).mockRejectedValue(new Error('后端挂了'))
    const w = await open()
    expect(w.find('.fp-lderr').exists()).toBe(true)
    expect(w.text()).toContain('后端挂了')
    expect(w.findAll('.bmm-card')).toHaveLength(0)
  })
})

/**
 * 取数失败时,这一屏必须**闭嘴不猜** —— 2026-08-29 单屏对抗复查的 7 条。
 *
 * 共同的根:`rows` 是按 `stations` 铺的,读数拿不到时每格落 0。
 * 于是失败态下屏幕上是一张**长得完全正常的全零表**,而它是伪造的。
 * 三个出口必须一起堵:写入口(拿它当底数改)、导出(全零 xlsx 离开系统)、空态文案(「本月暂无」压过失败条)。
 */
describe('光伏分栋抄表 · 取数失败时不许猜', () => {
  /** 进到表格页(选好期),读数按 mock 决定成败。 */
  async function toTable() {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    return w
  }
  const btn = (w: ReturnType<typeof mount>, t: string) =>
    w.findAll('button').find(b => b.text().includes(t))

  it('❗读数挂了 + 编辑模式 → 一个写入口都不给', async () => {
    // 表里 13 行全零是 rows 按 stations 铺出来的假底数。放行录入 = 让人对着假数写真数据;
    // 更狠的是保存后 reload 撞抖动,主屏立刻变「本月暂无抄表记录」,用户判定失败去重录 ——
    // 同日撞 409,换个日期就是一条重复的消纳收益行。
    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()

    expect(w.find('.fp-lderr').exists(), '失败条得在').toBe(true)
    expect(w.findAll('.pm-edit'), '电站档案的行内输入框').toHaveLength(0)
    expect(btn(w, '导入'), '导入整月 Excel 的入口').toBeUndefined()
  })

  it('❗读数挂了 → 导出按钮禁用', async () => {
    // readings 被清成 [] 之后导出的是「全站全零」的月度表,与一个真正零发电的月份产出
    // **逐字节一致**。文件会离开系统发给别人,分辨不了就不能给。
    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    expect(btn(w, '导出')!.attributes('disabled'), '失败态还能导出').toBeDefined()
  })

  it('❗失败条与「本月暂无记录」不许同屏 —— 后者会被读成结论', async () => {
    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    expect(w.find('.fp-lderr').exists()).toBe(true)
    expect(w.find('.pm-empty').exists(), '「暂无记录」把失败说成了「真的没有」').toBe(false)
  })

  it('❗电站档案挂了 → 硬失败面 + 重试,不是永久转圈', async () => {
    // 改前 loadStations 是裸 await:一挂 stations 恒为 null,
    // 而模板那句 `v-else-if="!stations || !readings"` 就永远停在转圈上,连重试口都没有。
    vi.mocked(pvMeterApi.stations).mockRejectedValue(new Error('档案挂了'))
    const w = await toTable()
    expect(w.find('.page-spin').exists(), '不许永久转圈').toBe(false)
    expect(w.find('.pm-gate-fail').exists()).toBe(true)
    expect(w.text()).toContain('电站档案加载失败')

    vi.mocked(pvMeterApi.stations).mockResolvedValue(STATIONS as never)
    await btn(w, '重试')!.trigger('click')
    await flushPromises()
    expect(w.find('.pm-page').exists(), '重试成功该落表').toBe(true)
  })

  it('❗电站档案的失败不许被「换月」抹掉', async () => {
    // 两份数据合用一个错误槽时:档案挂了 → 用户点月格 → loadReadings 开头 `readErr = null`
    // 把它抹掉 → 读数拉成功 → 屏上是一张没有任何解释的空表(站没了行就没了)。
    // 这条就是逼出 stationsErr 独立槽的那一条。
    const w = await open()
    vi.mocked(pvMeterApi.stations).mockRejectedValue(new Error('档案挂了'))
    ;(w.vm as unknown as { loadStations: () => Promise<void> }).loadStations()
    await flushPromises()

    await w.findAll('.bmm-card')[2].trigger('click')   // 换月:读数这次是成功的
    await flushPromises()
    expect(w.text(), '档案的失败被读数的成功抹掉了').toContain('电站档案加载失败')
  })

  it('重试只重来挂掉的那一份', async () => {
    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    vi.mocked(pvMeterApi.stations).mockClear()
    vi.mocked(pvMeterApi.readings).mockClear()

    await w.find('.fp-lderr button').trigger('click')
    await flushPromises()
    expect(pvMeterApi.readings, '挂的那份要重来').toHaveBeenCalled()
    expect(pvMeterApi.stations, '好好的那份不必再拉一遍').not.toHaveBeenCalled()
  })

  it('❗.pm-page 必须 position:relative —— 否则加载条跑到页签条上', () => {
    // FPLoadBar 是 absolute 定位。宿主不给参照,它会认最近的定位祖先
    // (AppShell 的 .fp-main-card),横条直接画在整个工作区顶边上。
    // 同批四屏都写了 relative,这屏当初抄漏了 —— jsdom 不跑 scoped 样式,只能查源码。
    const s = readFileSync(join(__dirname, '../pv/PvMeterView.vue'), 'utf8')
    expect(/\.pm-page \{[^}]*position: relative/.test(s)).toBe(true)
  })
})

/**
 * 第一轮修复(ac1d9b5)之后的第二轮对抗复查坐实的 6 条 —— 其中 3 条 HIGH 是**那次提交自己写进去的**。
 *
 * 共同的根:我加的每一道门都判 `loadErr`。于是"什么时候算失败"这一个信号
 * 一旦在错误的时机被清掉、或被合并得太粗,所有门同时敞开。
 */
describe('光伏分栋抄表 · 门不许在错误的时机敞开', () => {
  const btn = (w: ReturnType<typeof mount>, t: string) =>
    w.findAll('button').find(b => b.text().includes(t))
  /** 一个永不结算的 promise —— 用来把"在途"这段时间钉住看。 */
  const hang = () => new Promise(() => {})

  async function toTable() {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    return w
  }

  it('❗重试在途的整段时间里,门必须继续关着', async () => {
    // readErr 若清在请求开头(我第一版就是),点重试那一刻 loadErr 当场变假:
    // 失败条消失、导出解禁、伪造的零上冒出输入框、屏上还主动宣布「本月暂无抄表记录」。
    // 而 readings 还是上一趟失败留下的 []。这时点导出,拿到的正是这次提交声称要挡住的全零表。
    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()

    vi.mocked(pvMeterApi.readings).mockImplementation(hang as never)
    await w.find('.fp-lderr button').trigger('click')   // 重试 —— 这一趟永不结算
    await nextTick()

    expect(w.find('.fp-lderr').exists(), '失败条不该在重试一开始就消失').toBe(true)
    expect(btn(w, '导出')!.attributes('disabled'), '在途时导出必须仍禁用').toBeDefined()
    expect(w.findAll('.pm-edit'), '在途时不该冒出写入口').toHaveLength(0)
    expect(w.find('.pm-empty').exists(), '在途时不该宣布「本月暂无」').toBe(false)
  })

  it('❗重试成功之后门要重新打开 —— 光会关不会开就是把人永久锁在外面', async () => {
    // 破坏验证抓到的空档:把成功分支里那句 `readErr.value = null` 整个删掉,
    // 上面那批"失败时要关门"的断言**一条都不红** —— 它们只证明了会关,没证明会开。
    // 真发生时:后端恢复了、数字也回来了,失败条却还挂着,写入口与导出永久禁用,
    // 唯一的出路是刷新整个页面。
    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    expect(w.find('.fp-lderr').exists(), '前提:先失败一次').toBe(true)

    vi.mocked(pvMeterApi.readings).mockResolvedValue(MAR as never)
    await w.find('.fp-lderr button').trigger('click')       // 重试,这次成功
    await flushPromises()

    expect(w.find('.fp-lderr').exists(), '成功了失败条还挂着').toBe(false)
    expect(btn(w, '导出')!.attributes('disabled'), '成功了导出还禁着').toBeUndefined()
    expect(w.findAll('.pm-edit').length, '成功了写入口没回来').toBeGreaterThan(0)
  })

  it('❗换期在途时禁导出 —— 否则导出「新期文件名 + 上一期数字」', async () => {
    // 点月格那一刻期标当场变新期,而 readings 仍是上一期的(loadReadings 故意不清旧数据)。
    // .fp-stale 只盖 .pm-card,工具条是它兄弟,导出按钮全程可点;
    // 而 pvMeterExcel 不按 year/month 过滤行,只拿它们做文件名/sheet 名/标题。
    vi.mocked(pvMeterApi.readings).mockResolvedValue(MAR as never)
    const w = await toTable()
    expect(btn(w, '导出')!.attributes('disabled'), '静止时导出该是可用的').toBeUndefined()

    vi.mocked(pvMeterApi.readings).mockImplementation(hang as never)
    await w.find('.pm-permonth').trigger('click')
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')   // 换到 2025-07,取数挂在半路
    await nextTick()

    expect(w.find('.pm-per').text(), '期标已经是新期').toBe('2025-07')
    expect(btn(w, '导出')!.attributes('disabled'), '数字还是 3 月的,不许导出').toBeDefined()
  })

  it('❗编辑态被就地打假(接管/提权到期)→ 两个写弹窗必须一起关', async () => {
    // 弹窗的 v-if 只判自己那个 ref,不判编辑态。别人走接管
    // (presence.handleEviction → useEditMode.exit())或 30 分钟提权到期都会**就地**把
    // editMode 打假、不卸载不跳路由 —— 屏幕退回浏览态而弹窗还挂着,
    // 里面的「新增」「确认导入」照样打 POST:浏览态下写库,写的还是一把已经归别人的期锁。
    const w = await toTable()
    const vm = w.vm as unknown as { editMode: boolean; stationDlg: boolean; importing: boolean }
    vm.editMode = true
    vm.stationDlg = true
    vm.importing = true
    await flushPromises()
    expect(w.find('.pm-mask').exists(), '前提:弹窗确实开着').toBe(true)

    vm.editMode = false            // ← 接管 / 授权到期走的正是这一句
    await flushPromises()
    expect(w.find('.pm-mask').exists(), '新增电站弹窗没关').toBe(false)
    expect(vm.importing, '导入弹窗没关').toBe(false)
  })

  it('❗浏览态下每一个写函数都必须打不出去 —— 关弹窗只是 UI 补丁', async () => {
    // 关弹窗挡住的是**已知**那条残留入口。真正不漏的守卫在发请求那一层:
    // editMode 会就地转假(被别人接管 / 30 分钟提权到期),而这些函数的调用者
    // (弹窗按钮、抽屉里的行、行内输入框)各有各的 v-if —— 漏一个就是一条浏览态写路径,
    // 写的还是一把已经归别人的期锁。照 BillNoticesView.vue:301/415/431 的既有写法。
    //
    // ⚠ 前置状态必须做足。破坏验证抓到过:openSt 是 null / stForm 是空的时候,
    //   delStation、submitStation、saveForm 在**自己原有的**早退分支就 return 了 ——
    //   守卫删掉照样绿,这条断言等于没写。
    vi.mocked(pvMeterApi.readings).mockResolvedValue(MAR as never)
    const w = await toTable()
    const vm = w.vm as unknown as Record<string, never>
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    // 先在编辑态里把状态摆好(抽屉打开、新增表单填好、编辑行展开)……
    ;(vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    await w.findAll('.pm-table tbody tr')[0].trigger('click')     // openSt = B 座
    await flushPromises()
    ;(vm as unknown as { stForm: { name: string; capacity: string; price: string } }).stForm =
      { name: '新楼', capacity: '100', price: '0.6' }
    ;(vm as unknown as { form: Record<string, string> }).form =
      { readDate: '2025-03-09', genTotal: '10', selfUse: '8', gridFeed: '2', note: '' }
    ;(vm as unknown as { adding: boolean }).adding = true
    await flushPromises()

    // ……再让编辑态就地转假(= 被接管 / 提权到期走的那一句),然后逐个直呼写函数
    ;(vm as unknown as { editMode: boolean }).editMode = false
    await flushPromises()
    // ⚠ 导入那条走的是 importRegistry 里的 `http.post('/pv-meter/import')`,**不经 pvMeterApi**
    //   (registry 那行注释写明是并行期直调端点)。只断言 pvMeterApi.* 的话这个守卫删掉照样绿。
    const post = vi.spyOn(api, 'post').mockResolvedValue({ imported: 1, skipped: 0, errors: [] } as never)
    const call = vm as unknown as Record<string, (...a: never[]) => unknown>
    await call.submitStation()
    await call.delStation()
    await call.saveForm()
    await call.delRow(1 as never, '2025-03-05' as never)
    await call.onSimulate()
    await call.onImport(
      [{ 电站: 'B 座', 抄表日期: '2025-03-09', 发电量: 10, 自消纳: 8, 上网: 2 }] as never,
      'x.xlsx' as never,
    )
    call.commitStation({ id: 1, name: 'B 座', capacityKwp: 1 } as never, 'capacityKwp' as never, '999' as never)
    call.commitStationName({ id: 1, name: 'B 座' } as never, '改名了' as never)
    await flushPromises()

    for (const [k, fn] of [
      ['createStation', pvMeterApi.createStation], ['updateStation', pvMeterApi.updateStation],
      ['deleteStation', pvMeterApi.deleteStation], ['createReading', pvMeterApi.createReading],
      ['updateReading', pvMeterApi.updateReading], ['deleteReading', pvMeterApi.deleteReading],
      ['simulate', pvMeterApi.simulate], ['importRows', pvMeterApi.importRows],
    ] as const) {
      expect(fn, `浏览态下 ${k} 被打出去了`).not.toHaveBeenCalled()
    }
    expect(post.mock.calls.map(c => c[0]), '浏览态下整月导入被打出去了')
      .not.toContain('/pv-meter/import')
  })

  it('❗老的一趟失败结算在新的成功之后,不许把整屏锁成只读', async () => {
    // loadStations 改前没有竞态守卫。双击重试 → 两趟并发 → 先发的那趟后失败结算,
    // stationsErr 被写回,而 stations 已经是新的、完全正确的那份。
    // 上一轮把 stationsErr 并进 loadErr 之后,这就不只是"文案陈旧":
    // 写入口、导出、编辑按钮全按 loadErr 判 —— 一屏正确的数据被永久锁成只读,
    // 还配一句「电站档案停留在上次拉到的版本」的假话。
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()

    const vm = w.vm as unknown as { loadStations: () => Promise<void> }
    let failLate!: (e: unknown) => void
    vi.mocked(pvMeterApi.stations).mockImplementationOnce(
      () => new Promise((_, rej) => { failLate = rej }) as never,
    )
    const stale = vm.loadStations()                    // 第一趟:会失败,但结算得晚
    vi.mocked(pvMeterApi.stations).mockResolvedValue(STATIONS as never)
    await vm.loadStations()                            // 第二趟:成功,先结算
    failLate(new Error('档案挂了'))
    await stale
    await flushPromises()

    expect(w.text(), '成功之后不该再冒出失败文案').not.toContain('电站档案加载失败')
    expect(w.findAll('.pm-edit').length, '数据是对的却被锁成只读').toBeGreaterThan(0)
  })

  it('❗编辑态里取数挂掉时,「完成」必须还能点 —— 否则锁交不回去', async () => {
    // FPEditModeButton 的 :disabled 不分编辑态(组件 43 行)。写成 `:disabled="!!loadErr"`
    // 会把编辑态里的那颗「完成」一起禁掉:人退不出去,pv-meter:<year> 那把锁也交不回去,
    // 别人只能干等 3 分钟心跳超时,或去走接管。禁的只该是"进",不该是"出"。
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    const done = () => w.findAll('button').find(b => b.text().includes('完成'))
    expect(done(), '前提:此刻是「完成」态').toBeTruthy()

    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    await w.find('.pm-permonth').trigger('click')
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')
    await flushPromises()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true   // 换期守卫会退出,这里只测按钮
    await flushPromises()

    expect(w.find('.fp-lderr').exists(), '前提:确实是失败态').toBe(true)
    expect(done()?.attributes('disabled'), '编辑态里的「完成」被禁掉了 —— 退不出去').toBeUndefined()
  })

  it('❗切页签要收掉抽屉 —— 它是 Teleport to body,子树没了它不会没', async () => {
    const Host = defineComponent({
      components: { PvMeterView },
      props: { on: { type: Boolean, default: true } },
      template: '<KeepAlive><PvMeterView v-if="on" /></KeepAlive>',
    })
    const w = mount(Host, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    await w.findAll('.pm-table tbody tr')[0].trigger('click')
    await flushPromises()
    expect(w.find('.fp-dwr-backdrop').exists(), '前提:抽屉开着').toBe(true)

    await w.setProps({ on: false })    // KeepAlive 停用 = 切到别的页签
    await flushPromises()
    await w.setProps({ on: true })
    await flushPromises()
    expect(w.find('.fp-dwr-backdrop').exists(), '切回来抽屉还开着').toBe(false)
  })

  it('❗失败态不许进编辑模式 —— 占得到锁却一个写控件都没有', async () => {
    // 进得去就占住 pv-meter:<year> 那把锁,可 editStation/editReading 都被 loadErr 判假,
    // 一个写控件都不会出现:把别人挡在外面,自己什么也做不了。
    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    const b = w.findAll('button').find(x => x.text().includes('编辑'))
    expect(b, '前提:编辑模式按钮在').toBeTruthy()
    expect(b!.attributes('disabled'), '失败态还能进编辑模式').toBeDefined()
  })

  it('❗只有电站档案挂了时,抽屉不许藏掉这一站真实存在的记录', async () => {
    // 抽屉那道拦截判的若是合并槽 loadErr,档案挂掉(读数好好的)也会宣布
    // 「本月读数未加载成功…别在这里录」,并把真实记录全部藏起来 —— 说了假话还删了信息。
    vi.mocked(pvMeterApi.readings).mockResolvedValue(MAR as never)
    const w = await toTable()
    vi.mocked(pvMeterApi.stations).mockRejectedValue(new Error('档案挂了'))
    await (w.vm as unknown as { loadStations: () => Promise<void> }).loadStations()
    await flushPromises()
    expect(w.text(), '前提:档案的失败已经上屏').toContain('电站档案加载失败')

    await w.findAll('.pm-table tbody tr')[0].trigger('click')
    await flushPromises()
    expect(w.text(), '读数好好的,抽屉不该说读数没加载成功').not.toContain('本月读数未加载成功')
    expect(w.findAll('.pm-dtable tbody tr').length, '这一站的真实记录被藏了').toBeGreaterThan(0)
  })
})

/**
 * 锁弹窗接线(C1/C2)—— 7 屏同一改法的**唯一行为证明**。
 *
 * 其余 6 屏只有 lockDialogsCoverage.spec.ts 的源码结构断言(那七屏各要十几个 API mock,
 * 七份堆一起没法维护)。「按下去到底会怎样」只在这一屏真跑一遍:
 *   C1 acquire 被拒 → lockedBy 非空 → 接管抽屉自动开(改前 7 屏没人接这个 ref,点了没反应)
 *   C2 心跳带回 eviction → evictedBy 非空 → 失锁弹窗自动开(改前编辑态就地消失,零提示)
 *
 * 破坏验证:把 PvMeterView 里那一行 <FPLockDialogs> 注释掉 → 只有这两条转红。
 */
describe('光伏分栋抄表 · 锁弹窗接线(C1/C2)', () => {
  beforeEach(() => {
    // 默认拿得到锁;要测「被别人占着」的那条自己覆盖。
    // ⚠ release 必须返回 promise —— useEditLock 对它 `.catch(...)`,返回 undefined 当场 TypeError。
    vi.mocked(locksApi.acquire).mockResolvedValue({ granted: true, holder: null, acquiredAt: 1 } as never)
    vi.mocked(locksApi.release).mockResolvedValue(undefined as never)
  })

  /** 进到表格页 —— 编辑按钮长在工具条上,选期矩阵那一屏没有它。 */
  async function toTable() {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    return w
  }

  it('❗别人占着锁时点编辑 → 接管抽屉出现(改前:点了什么都不发生)', async () => {
    vi.mocked(locksApi.acquire).mockResolvedValue({
      granted: false,
      holder: { user: 'lisi', displayName: '李四', heldMs: 60_000, idleMs: 1_000, idle: false },
    } as never)
    const w = await toTable()
    expect(w.find('.fp-emb').exists(), '前提:编辑按钮在,且本来就该可点(spec §2)').toBe(true)

    await w.find('.fp-emb').trigger('click')
    await flushPromises()

    expect((w.vm as unknown as { editMode: boolean }).editMode, '锁没拿到就不该进编辑态').toBe(false)
    expect(w.find('.tk-body').exists(), '接管抽屉必须开 —— 没有它这颗按钮就是死的').toBe(true)
  })

  it('❗编辑中被接管 → 失锁弹窗出现(改前:编辑态就地消失,一个字都不说)', async () => {
    const w = await toTable()
    await w.find('.fp-emb').trigger('click')
    await flushPromises()
    expect((w.vm as unknown as { editMode: boolean }).editMode, '前提:先真的进了编辑态').toBe(true)

    // ⚠ scope 按本屏此刻的 year 现算。写死 'pv-meter:2025' 的话,夹具的年份一改
    //   通知就按 scope 派不回来,而这条会**静静地永远绿**下去 —— 等于零守卫。
    const scope = S.pvMeter((w.vm as unknown as { year: number }).year)
    vi.spyOn(api, 'put').mockResolvedValue({
      users: [], approvals: [], outcome: null,
      evictions: [{ scope, by: 'lisi', byDisplayName: '李四', authorizerName: null }],
    } as never)
    await usePresenceStore().ping()
    await flushPromises()

    expect((w.vm as unknown as { editMode: boolean }).editMode, '被踢了要当场退出编辑态').toBe(false)
    expect(w.find('.evd-scrim').exists(), '被踢了必须说一声').toBe(true)
  })
})

/**
 * 未装表行(PV-ANALYSIS-SPEC §07 第一行)。
 *
 * 「没装表」与「装了表但这个月漏抄」必须分开:前者永久不用管,后者要催人补录。
 * 只靠「有没有抄表记录」判定会把两者显示成同一种灰 —— 该催的和不用催的混在一起,
 * 三周之内就没人看那盏灰灯了。
 *
 * 三样缺一样都会让两者混回去,所以三条各测各的:
 *   ① 灰徽标「未装表」  ② 容量/单价禁编  ③ 点了不开抽屉
 */
describe('光伏分栋抄表 · 未装表行', () => {
  async function openWithNoMeter() {
    vi.mocked(pvMeterApi.stations).mockResolvedValue(STATIONS_WITH_NOMETER as never)
    const w = await open()
    // 走完选期门落到表格(同上面那些用例:点第 3 个月格)
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    return w
  }

  it('未装表的行挂灰徽标,装了表的没有', async () => {
    const w = await openWithNoMeter()
    const trs = w.findAll('.pm-table tbody tr')
    const noMeter = trs.find(t => t.text().includes('E 座'))!
    expect(noMeter.text()).toContain('未装表')
    expect(noMeter.classes()).toContain('pm-nometer')
    const metered = trs.find(t => t.text().includes('B 座'))!
    expect(metered.text()).not.toContain('未装表')
    expect(metered.classes()).not.toContain('pm-nometer')
  })

  // FPDrawer 是这屏唯一 `Teleport to body` 的浮层,测试里 Teleport 被 stub 掉,
  // DOM 上找不到它的内容 —— 断组件的 open 属性,那才是「抽屉开没开」的事实
  const drawerOpen = (w: VueWrapper) =>
    w.findComponent({ name: 'FPDrawer' }).props('open') === true

  it('未装表的行点了不开抽屉', async () => {
    const w = await openWithNoMeter()
    const noMeter = w.findAll('.pm-table tbody tr').find(t => t.text().includes('E 座'))!
    await noMeter.trigger('click')
    await flushPromises()
    expect(drawerOpen(w)).toBe(false)
  })

  it('装了表的行照常开抽屉 —— 别把好行一起禁了', async () => {
    const w = await openWithNoMeter()
    const metered = w.findAll('.pm-table tbody tr').find(t => t.text().includes('B 座'))!
    await metered.trigger('click')
    await flushPromises()
    expect(drawerOpen(w)).toBe(true)
  })
})

describe('光伏分栋抄表 · 期间深链(SIDEBAR-UX-REDESIGN §4.2)', () => {
  it('❗带 p 进屏直落那个月:矩阵不出现,读数只拉一次、拉的就是那个月', async () => {
    // 红线:PvMeterView.vue 的 useDeepPeriod({ apply: … pickCell }) 删掉 → 落回矩阵;
    //      挪到 onMounted 之后 → 首载 readings 拉两次(onMounted 一次 + watch(gateYm) 一次)
    query.p = '2025-03'
    const w = await open()
    expect(w.find('.fmg').exists(), '门该被深链跳过').toBe(false)
    expect(w.find('.pm-per').text()).toBe('2025-03')
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 3)
    expect(pvMeterApi.readings, '首载只拉一次(期在 onMounted / watch 之前落定)').toHaveBeenCalledTimes(1)
  })

  it('只有年的链接不动 —— 本屏只认整月', async () => {
    query.p = '2025'
    const w = await open()
    expect(w.find('.fmg').exists()).toBe(true)
    expect(pvMeterApi.readings).not.toHaveBeenCalled()
  })

  it('❗切页签回来要重拉电站、账期清单与本月 —— 导入中心导完切回来不能还是旧表(spec §12)', async () => {
    // 红线:PvMeterView.vue 的 onReactivated 三支删掉 → 切回零请求
    const { w, alive } = await keptAlive()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    vi.mocked(pvMeterApi.stations).mockClear()
    vi.mocked(pvMeterApi.months).mockClear()
    vi.mocked(pvMeterApi.readings).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(pvMeterApi.stations).toHaveBeenCalledTimes(1)
    expect(pvMeterApi.months).toHaveBeenCalledTimes(1)
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 3)
  })

  it('切回时地址栏换了月 → 先改期再重读:拉的是新月,没有一趟按旧月拉', async () => {
    // 红线:useDeepPeriod 挪到 onReactivated 之后 → 重读那支先按 2025-03 拉一次
    query.p = '2025-03'
    const { w, alive } = await keptAlive()
    vi.mocked(pvMeterApi.readings).mockClear()
    alive.value = false; await flushPromises()
    query.p = '2025-04'
    alive.value = true; await flushPromises()
    expect(w.find('.pm-per').text()).toBe('2025-04')
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 4)
    expect(pvMeterApi.readings, '重读那趟不许还按旧月拉').not.toHaveBeenCalledWith(2025, 3)
  })

  it('❗抽屉里正在新增一行时切回、地址栏换了月 → 期不动,草稿还在,deepNote 说清楚', async () => {
    // 红线:dirty 探针改成 () => 0 → 期当场被切到 2025-04,表单默认日期跟着 monthLast 重算
    query.p = '2025-03'
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(PvMeterView).vm as unknown as { startAdd: () => void; adding: boolean }
    vm.startAdd()
    await flushPromises()
    expect(vm.adding, '前提:新增行展开着').toBe(true)
    alive.value = false; await flushPromises()
    query.p = '2025-04'
    alive.value = true; await flushPromises()
    expect(w.find('.pm-per').text(), '有草稿 → 不切期').toBe('2025-03')
    expect(vm.adding).toBe(true)
    expect(w.find('.fpt--warning').text()).toContain('地址栏要求 2025-04 期，本期有 1 处未保存')
  })
})
