import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setActivePinia, createPinia } from 'pinia'

import CpMeterView from '@/views/charging/CpMeterView.vue'
import { cpMeterApi } from '@/api/cpMeter'
import type { CpStationDTO, CpReadingDTO, CpPowerUsageDTO } from '@/api/cpMeter'
import { useAuthStore } from '@/stores/auth'
import api from '@/api'

/**
 * 分桩充电明细(CpMeterView)挂载测 —— 模板照 meterPeriodFlow.spec.ts(PvMeterView
 * 三轮对抗复查后的形状),用例一一对应地移植,再加本屏特有的两条:
 *   · cpMeterApi.months 按 props.vehicleType 取(改前拿全集,汽车屏把电动车的月画成「有数据」)
 *   · 附表7(car)/附表8(ebike) 是两个独立的屏,期按 `cp-meter:{type}` 分记,互不串
 *
 * 每条用例的注释都写明:production(CpMeterView.vue)改哪一行会让它红。
 */

vi.mock('@/api/cpMeter', () => ({
  cpMeterApi: {
    stations: vi.fn(), createStation: vi.fn(), updateStation: vi.fn(), deleteStation: vi.fn(),
    years: vi.fn(), months: vi.fn(),
    readings: vi.fn(), createReading: vi.fn(), updateReading: vi.fn(), deleteReading: vi.fn(),
    powerUsage: vi.fn(), upsertPowerUsage: vi.fn(),
    importRows: vi.fn(), simulate: vi.fn(),
  },
}))

// 锁 mock 照 paramCenterView.spec:69:不 mock 的话 locksApi 走真 axios,jsdom 里抛错 →
// 被「拿不准就不进」兜住 → 一切走 toggle/enter 的路径全挂。
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

// 期间深链(SIDEBAR-UX-REDESIGN §4.2):屏接了 useDeepPeriod(内部 useRoute)。query 可变 —— 深链那几条要在切回之间换掉 ?p=;
// fullPath 走 getter:useRoute() 的返回对象只建一次,写成普通字段的话切回时读到的还是旧地址(照 meterWriteGuards.spec:60-66)。
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/car-charging?' + new URLSearchParams(query).toString() } }),
}))

// 夹具按真实 DTO 声明(src/api/cpMeter.ts)再 as never —— 字段漏一个渲染当场崩。
// 桩库是 car/ebike 共享表:塞一个 ebike 桩进去,car 屏的行数=2 顺带钉住类型过滤。
const STATIONS: CpStationDTO[] = [
  { id: 1, name: '快充1', operator: '小桔', vehicleType: 'car', sortNo: 1 },
  { id: 2, name: '快充2', operator: '万城万', vehicleType: 'car', sortNo: 2 },
  { id: 9, name: '单车棚A', operator: '叮叮充', vehicleType: 'ebike', sortNo: 3 },
]

/** 2025-03 的一条真实形状记录。source/note 是抽屉徽标列要读的,漏了渲染崩。 */
const MAR: readonly CpReadingDTO[] = [
  { id: 1, stationId: 1, stationName: '快充1', readDate: '2025-03-05',
    chargeKwh: 120, fee: 6, revenue: 60, note: null, source: 'manual' },
]

/** 「电表与损耗」一行(commitMeter 的直呼夹具用)。 */
const USAGE_ROW: CpPowerUsageDTO = {
  id: 11, operator: '小桔', vehicleType: 'car', month: 3,
  meterKwh: 100, sumChargeKwh: 120, lossKwh: -20, note: null,
}

beforeEach(() => {
  setActivePinia(createPinia())
  // billing-run:edit 必须在种子里 —— onSimulate 的守卫是 `!editMode || !canRun`,
  // 缺了它守卫删掉也 return,⑧ 那条断言等于没写。
  useAuthStore().permissions = ['meter-master:edit', 'meter-reading:edit', 'billing-run:edit']
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(query)) delete query[k]
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  vi.mocked(cpMeterApi.stations).mockResolvedValue(STATIONS as never)
  vi.mocked(cpMeterApi.readings).mockResolvedValue([] as never)
  vi.mocked(cpMeterApi.powerUsage).mockResolvedValue([] as never)
  vi.mocked(cpMeterApi.months).mockResolvedValue(['2025-01', '2025-02', '2025-03'])
})

async function open(vehicleType: 'car' | 'ebike' = 'car') {
  const w = mount(CpMeterView, { props: { vehicleType }, global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

describe('分桩充电明细 · 选期动线', () => {
  it('❗第一次进 = 选期矩阵,不再自己 snap 到某个月', async () => {
    // 红线:CpMeterView.vue:397 的 `v-if="!picked"` 改成恒假,或 :160 的
    // `if (picked.value) loadMonth()` 去掉 if 直接拉 —— 任一处都让这条红。
    const w = await open()
    expect(w.find('.fmg').exists(), '该看到选期矩阵').toBe(true)
    expect(w.find('.cm-page').exists(), '不该直接落表格').toBe(false)
    expect(cpMeterApi.readings, '没选期就不该去拉某个月的记录').not.toHaveBeenCalled()
  })

  it('❗矩阵按后端给的账期画格,months 按本屏车型取', async () => {
    // 红线:CpMeterView.vue:154 `cpMeterApi.months(props.vehicleType)` 把参数删掉
    // (退回改前的全集口径)—— toHaveBeenCalledWith('car') 当场红。
    const w = await open()
    expect(cpMeterApi.months).toHaveBeenCalledWith('car')
    const cards = w.findAll('.bmm-card')
    expect(cards).toHaveLength(12)                 // 数据年只有 2025,当前年也是 2025
    expect(cards[0].classes()).toContain('has')
    expect(cards[2].classes()).toContain('has')
    expect(cards[3].classes()).toContain('blank')
  })

  it('点月格 → 落表格,拉的是那个月(记录+电表一起)', async () => {
    // 红线:CpMeterView.vue:148-151 onPickCell 少 await loadMonth,或 :131-134 的
    // Promise.all 少拉一路 —— readings/powerUsage 任一断言红。
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    expect(cpMeterApi.readings).toHaveBeenCalledWith(2025, 3)
    expect(cpMeterApi.powerUsage).toHaveBeenCalledWith(2025, 3)
    expect(w.find('.cm-page').exists()).toBe(true)
    expect(w.find('.fmg').exists(), '门该退场').toBe(false)
  })

  it('❗卸载重挂后期还在 —— 侧栏点开直落表格', async () => {
    // 红线:期若从 useScreenPeriodStore(key cp-meter:car)搬回屏内 ref
    // (CpMeterView.vue:80-85 的 useMonthGate 接线),openFresh 全新重建后这里回到矩阵。
    const first = await open()
    await first.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    first.unmount()

    vi.clearAllMocks()
    vi.mocked(cpMeterApi.stations).mockResolvedValue(STATIONS as never)
    vi.mocked(cpMeterApi.readings).mockResolvedValue([] as never)
    vi.mocked(cpMeterApi.powerUsage).mockResolvedValue([] as never)
    vi.mocked(cpMeterApi.months).mockResolvedValue(['2025-01', '2025-02', '2025-03'])

    const again = await open()
    expect(again.find('.fmg').exists(), '选过期了就不该再拦').toBe(false)
    expect(again.find('.cm-page').exists()).toBe(true)
    expect(cpMeterApi.readings).toHaveBeenCalledWith(2025, 3)
  })

  it('顶栏「换月」回矩阵,年月下拉已不存在', async () => {
    // 红线:CpMeterView.vue:445-448 的「换月 + 期标」换回一对 ds/Select ——
    // .ds-sel-trigger 数量断言红(本仓下拉一律 ds/Select,渲染 <button class="ds-sel-trigger">,
    // 从不产出原生 <select>,写 findAll('select') 恒 0 = 零守卫)。
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()

    expect(w.find('.cm-per').text(), '期写在工具条上').toBe('2025-03')
    expect(w.findAll('.mx-toolbar .ds-sel-trigger'), '年月下拉整个撤了').toHaveLength(0)

    await w.find('.cm-permonth').trigger('click')
    await flushPromises()
    expect(w.find('.fmg').exists()).toBe(true)
  })

  it('❗一条数据都没有时照样画得出矩阵 —— 否则这本账彻底进不去', async () => {
    // 红线:CpMeterView.vue:404 的 `:loading="dataMonths === null && !monthsErr"` 改成
    // `!dataMonths.length` 之类 —— 空表 [] 被当「加载中」,门永久转圈,第一条也录不进去。
    vi.mocked(cpMeterApi.months).mockResolvedValue([])
    const w = await open()
    expect(w.find('.page-spin').exists(), '空数据不是「加载中」').toBe(false)
    expect(w.findAll('.bmm-card'), '当前年一行 12 张空卡').toHaveLength(12)
    expect(w.findAll('.bmm-card.blank')).toHaveLength(12)

    // 而且点得进去 —— 那正是要去录第一笔的地方
    await w.findAll('.bmm-card')[6].trigger('click')
    await flushPromises()
    expect(cpMeterApi.readings).toHaveBeenCalledWith(2025, 7)
  })

  it('❗换月取数失败 → 说出来 + 清空,不许「新期标题 + 上一期数字」', async () => {
    // 红线:CpMeterView.vue:136-142 失败分支删掉(裸 await)或不清 readings ——
    // .fp-lderr 不出现 / 屏上是 3 月的数顶着 7 月的期标。
    vi.mocked(cpMeterApi.readings).mockResolvedValue(MAR as never)
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')   // 2025-03,有数据
    await flushPromises()
    expect(w.find('.cm-per').text()).toBe('2025-03')

    vi.mocked(cpMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    await w.find('.cm-permonth').trigger('click')      // 回矩阵
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')   // 2025-07,取数会失败
    await flushPromises()

    expect(w.find('.cm-per').text(), '期标已经是新期').toBe('2025-07')
    expect(w.find('.fp-lderr').exists(), '失败必须说出来').toBe(true)
    expect(w.text()).toContain('后端挂了')
  })

  it('账期清单拉不到 → 说出来 + 给重试,不给半张矩阵', async () => {
    // 红线:CpMeterView.vue:152-156 loadMonths 的 catch 删掉(monthsErr 不落),
    // 或 :405 的 :error 不接 —— 失败静默,矩阵永远转圈。
    vi.mocked(cpMeterApi.months).mockRejectedValue(new Error('后端挂了'))
    const w = await open()
    expect(w.find('.fp-lderr').exists()).toBe(true)
    expect(w.text()).toContain('后端挂了')
    expect(w.findAll('.bmm-card')).toHaveLength(0)
  })
})

/**
 * 取数失败时,这一屏必须闭嘴不猜:rows 按 stations 铺,记录拿不到时每格落 0,
 * 屏上是一张长得完全正常的**伪造全零表**。写入口/导出/空态文案三个出口一起堵。
 */
describe('分桩充电明细 · 取数失败时不许猜', () => {
  /** 进到表格页(选好期),记录按 mock 决定成败。 */
  async function toTable() {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    return w
  }
  const btn = (w: ReturnType<typeof mount>, t: string) =>
    w.findAll('button').find(b => b.text().includes(t))

  it('❗读数挂了 + 编辑模式 → 一个写入口都不给', async () => {
    // 红线:CpMeterView.vue:58/59 editStation/editReading 里的 `&& !loadErr.value` 删掉
    // (行内输入框冒出来),或 :453 导入按钮的 v-if 从 editReading 放宽成 editMode。
    vi.mocked(cpMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()

    expect(w.find('.fp-lderr').exists(), '失败条得在').toBe(true)
    expect(w.findAll('.cm-edit'), '桩名/运营商/电表的行内输入框').toHaveLength(0)
    expect(btn(w, '导入'), '导入整月 Excel 的入口').toBeUndefined()
  })

  it('❗读数挂了 → 导出按钮禁用', async () => {
    // 红线:CpMeterView.vue:464 `:disabled="exporting || !!loadErr || reloading"` 把
    // `!!loadErr` 删掉 —— 导出的全零表与真正零充电的月逐字节一致,文件离开系统分辨不了。
    vi.mocked(cpMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    expect(btn(w, '导出')!.attributes('disabled'), '失败态还能导出').toBeDefined()
  })

  it('❗失败条与「本月暂无记录」不许同屏 —— 后者会被读成结论', async () => {
    // 红线:CpMeterView.vue:487 空态的 `v-if="!loadErr && myReadings.length === 0"` 把
    // `!loadErr &&` 删掉 —— 失败时 readings 被清成 [],「暂无」把失败说成「真的没有」。
    vi.mocked(cpMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    expect(w.find('.fp-lderr').exists()).toBe(true)
    expect(w.find('.cm-empty').exists(), '「暂无记录」把失败说成了「真的没有」').toBe(false)
  })

  it('❗桩档案挂了 → 硬失败面 + 重试,不是永久转圈', async () => {
    // 红线:CpMeterView.vue:103-111 loadStations 的 try/catch 改回裸 await(stationsErr
    // 不落,:420 那行 `!stations || …` 永远停在转圈),或 :414 的硬失败面删掉。
    vi.mocked(cpMeterApi.stations).mockRejectedValue(new Error('档案挂了'))
    const w = await toTable()
    expect(w.find('.page-spin').exists(), '不许永久转圈').toBe(false)
    expect(w.find('.cm-gate-fail').exists()).toBe(true)
    expect(w.text()).toContain('充电桩档案加载失败')

    vi.mocked(cpMeterApi.stations).mockResolvedValue(STATIONS as never)
    await btn(w, '重试')!.trigger('click')
    await flushPromises()
    expect(w.find('.cm-page').exists(), '重试成功该落表').toBe(true)
  })

  it('❗桩档案的失败不许被「换月」抹掉', async () => {
    // 红线:CpMeterView.vue:96 的 stationsErr 独立槽并回 readErr(合槽)——
    // loadMonth 成功那句 `readErr.value = null`(:135)顺手把档案的失败一起抹掉,
    // 屏上是一张没有任何解释的表。
    const w = await open()
    vi.mocked(cpMeterApi.stations).mockRejectedValue(new Error('档案挂了'))
    ;(w.vm as unknown as { loadStations: () => Promise<void> }).loadStations()
    await flushPromises()

    await w.findAll('.bmm-card')[2].trigger('click')   // 换月:记录这次是成功的
    await flushPromises()
    expect(w.text(), '档案的失败被记录的成功抹掉了').toContain('充电桩档案加载失败')
  })

  it('重试只重来挂掉的那一份', async () => {
    // 红线:CpMeterView.vue:113-116 retryLoad 改成无脑双拉 —— stations 断言红。
    vi.mocked(cpMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    vi.mocked(cpMeterApi.stations).mockClear()
    vi.mocked(cpMeterApi.readings).mockClear()

    await w.find('.fp-lderr button').trigger('click')
    await flushPromises()
    expect(cpMeterApi.readings, '挂的那份要重来').toHaveBeenCalled()
    expect(cpMeterApi.stations, '好好的那份不必再拉一遍').not.toHaveBeenCalled()
  })

  it('❗.cm-page 必须 position:relative —— 否则加载条跑到页签条上', () => {
    // 红线:CpMeterView.vue:739 `.cm-page { position: relative; … }` 把 relative 删掉 ——
    // FPLoadBar 是 absolute,会认 AppShell 的 .fp-main-card,横条画在整个工作区顶边。
    // jsdom 不跑 scoped 样式,只能查源码。
    const s = readFileSync(join(__dirname, '../charging/CpMeterView.vue'), 'utf8')
    expect(/\.cm-page \{[^}]*position: relative/.test(s)).toBe(true)
  })
})

/**
 * 门不许在错误的时机敞开:每一道门都判 loadErr,「什么时候算失败」这一个信号
 * 在错误的时机被清掉、或被合并得太粗,所有门同时敞开。
 */
describe('分桩充电明细 · 门不许在错误的时机敞开', () => {
  const btn = (w: ReturnType<typeof mount>, t: string) =>
    w.findAll('button').find(b => b.text().includes(t))
  /** 一个永不结算的 promise —— 把"在途"这段时间钉住看。 */
  const hang = () => new Promise(() => {})

  async function toTable() {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    return w
  }

  it('❗重试在途的整段时间里,门必须继续关着', async () => {
    // 红线:CpMeterView.vue:124 注释说的那件事 —— 把 `readErr.value = null` 从
    // :135 的成功分支挪到 loadMonth 开头:点重试那一刻 loadErr 当场变假,
    // 失败条消失、导出解禁、伪造的零上冒出输入框,而 readings 还是失败留下的 []。
    vi.mocked(cpMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()

    vi.mocked(cpMeterApi.readings).mockImplementation(hang as never)
    await w.find('.fp-lderr button').trigger('click')   // 重试 —— 这一趟永不结算
    await nextTick()

    expect(w.find('.fp-lderr').exists(), '失败条不该在重试一开始就消失').toBe(true)
    expect(btn(w, '导出')!.attributes('disabled'), '在途时导出必须仍禁用').toBeDefined()
    expect(w.findAll('.cm-edit'), '在途时不该冒出写入口').toHaveLength(0)
    expect(w.find('.cm-empty').exists(), '在途时不该宣布「本月暂无」').toBe(false)
  })

  it('❗重试成功之后门要重新打开 —— 光会关不会开就是把人永久锁在外面', async () => {
    // 红线:CpMeterView.vue:135 成功分支那句 `readErr.value = null` 整个删掉 ——
    // 上面那批"失败时关门"的断言一条都不红,而后端恢复后失败条还挂着,
    // 写入口与导出永久禁用,唯一出路是刷新整页。
    vi.mocked(cpMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    expect(w.find('.fp-lderr').exists(), '前提:先失败一次').toBe(true)

    vi.mocked(cpMeterApi.readings).mockResolvedValue(MAR as never)
    await w.find('.fp-lderr button').trigger('click')       // 重试,这次成功
    await flushPromises()

    expect(w.find('.fp-lderr').exists(), '成功了失败条还挂着').toBe(false)
    expect(btn(w, '导出')!.attributes('disabled'), '成功了导出还禁着').toBeUndefined()
    expect(w.findAll('.cm-edit').length, '成功了写入口没回来').toBeGreaterThan(0)
  })

  it('❗换期在途时禁导出 —— 否则导出「新期文件名 + 上一期数字」', async () => {
    // 红线:CpMeterView.vue:464 `:disabled` 里把 `|| reloading` 删掉 ——
    // 点月格那一刻期标当场变新期,readings 仍是上一期的(loadMonth 故意不清旧数据),
    // 而 exportCpMeterMonth 只拿 year/month 做文件名,不过滤行。
    vi.mocked(cpMeterApi.readings).mockResolvedValue(MAR as never)
    const w = await toTable()
    expect(btn(w, '导出')!.attributes('disabled'), '静止时导出该是可用的').toBeUndefined()

    vi.mocked(cpMeterApi.readings).mockImplementation(hang as never)
    await w.find('.cm-permonth').trigger('click')
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')   // 换到 2025-07,取数挂在半路
    await nextTick()

    expect(w.find('.cm-per').text(), '期标已经是新期').toBe('2025-07')
    expect(btn(w, '导出')!.attributes('disabled'), '数字还是 3 月的,不许导出').toBeDefined()
  })

  it('❗编辑态被就地打假(接管/提权到期)→ 两个写弹窗必须一起关', async () => {
    // 红线:CpMeterView.vue:277-282 的 watch(editMode) 删掉 —— 弹窗的 v-if 只判
    // 自己那个 ref,editMode 就地转假后弹窗还挂着,「新增」「确认导入」照样 POST,
    // 浏览态下写库,写的还是一把已归别人的期锁。
    const w = await toTable()
    const vm = w.vm as unknown as { editMode: boolean; stationDlg: boolean; importing: boolean }
    vm.editMode = true
    vm.stationDlg = true
    vm.importing = true
    await flushPromises()
    expect(w.find('.cm-mask').exists(), '前提:弹窗确实开着').toBe(true)

    vm.editMode = false            // ← 接管 / 授权到期走的正是这一句
    await flushPromises()
    expect(w.find('.cm-mask').exists(), '新增充电桩弹窗没关').toBe(false)
    expect(vm.importing, '导入弹窗没关').toBe(false)
  })

  it('❗浏览态下每一个写函数都必须打不出去 —— 关弹窗只是 UI 补丁', async () => {
    // 红线:八个写函数各自开头的守卫 —— commitStation(:207)/commitMeter(:223)/
    // saveForm(:285)/delRow(:303)/delStation(:310)/submitStation(:329)/
    // onImport(:351)/onSimulate(:363)—— 删掉任何一句,对应的 not.toHaveBeenCalled 红。
    //
    // ⚠ 前置状态必须做足(本仓栽过三次):openSt 是 null / stForm 空 / form 空 /
    //   confirm 假的时候,这些函数在**自己原有的**早退分支就 return 了 ——
    //   守卫删掉照样绿,断言等于没写。
    vi.mocked(cpMeterApi.readings).mockResolvedValue(MAR as never)
    const w = await toTable()
    const vm = w.vm as unknown as Record<string, never>
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    // 先在编辑态里把状态摆好(抽屉打开、两份表单填好、新增行展开)……
    ;(vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    await w.findAll('.cm-table tbody tr')[0].trigger('click')     // openSt = 快充1
    await flushPromises()
    ;(vm as unknown as { stForm: { name: string; operator: string; vehicleType: string } }).stForm =
      { name: '快充3', operator: '小桔', vehicleType: 'car' }
    ;(vm as unknown as { form: Record<string, string> }).form =
      { readDate: '2025-03-09', chargeKwh: '10', fee: '1', revenue: '5', note: '' }
    ;(vm as unknown as { adding: boolean }).adding = true
    await flushPromises()

    // ……再让编辑态就地转假(= 被接管 / 提权到期走的那一句),然后逐个直呼写函数
    ;(vm as unknown as { editMode: boolean }).editMode = false
    await flushPromises()
    // ⚠ 导入那条走的是 importRegistry 里的 `http.post('/cp-meter/import')`,**不经 cpMeterApi**
    //   (registry :591 注释写明是并行期直调端点)。只断言 cpMeterApi.* 的话这个守卫删掉照样绿。
    const post = vi.spyOn(api, 'post').mockResolvedValue({ imported: 1, skipped: 0, errors: [] } as never)
    const call = vm as unknown as Record<string, (...a: never[]) => unknown>
    await call.submitStation()
    await call.delStation()
    await call.saveForm()
    await call.delRow(1 as never, '2025-03-05' as never)
    await call.onSimulate()
    await call.onImport(
      [{ 运营商: '小桔', 桩名: '快充1', 日期: '2025-03-09', 充电量: 10, 手续费: 1, 收益: 5 }] as never,
      'x.xlsx' as never,
    )
    call.commitStation({ id: 1, name: '快充1', operator: '小桔', vehicleType: 'car', sortNo: 1 } as never,
      'name' as never, '改名了' as never)
    call.commitMeter({ ...USAGE_ROW } as never, '999' as never)
    await flushPromises()

    for (const [k, fn] of [
      ['createStation', cpMeterApi.createStation], ['updateStation', cpMeterApi.updateStation],
      ['deleteStation', cpMeterApi.deleteStation], ['createReading', cpMeterApi.createReading],
      ['updateReading', cpMeterApi.updateReading], ['deleteReading', cpMeterApi.deleteReading],
      ['upsertPowerUsage', cpMeterApi.upsertPowerUsage], ['simulate', cpMeterApi.simulate],
      ['importRows', cpMeterApi.importRows],
    ] as const) {
      expect(fn, `浏览态下 ${k} 被打出去了`).not.toHaveBeenCalled()
    }
    expect(post.mock.calls.map(c => c[0]), '浏览态下整月导入被打出去了')
      .not.toContain('/cp-meter/import')
  })

  it('❗老的一趟失败结算在新的成功之后,不许把整屏锁成只读', async () => {
    // 红线:CpMeterView.vue:102-110 loadStations 的 stSeq 竞态守卫删掉 ——
    // 双击重试两趟并发,先发的那趟后失败结算,stationsErr 被写回,
    // 而 stations 已经是新的、完全正确的那份:一屏正确的数据被永久锁成只读。
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()

    const vm = w.vm as unknown as { loadStations: () => Promise<void> }
    let failLate!: (e: unknown) => void
    vi.mocked(cpMeterApi.stations).mockImplementationOnce(
      () => new Promise((_, rej) => { failLate = rej }) as never,
    )
    const stale = vm.loadStations()                    // 第一趟:会失败,但结算得晚
    vi.mocked(cpMeterApi.stations).mockResolvedValue(STATIONS as never)
    await vm.loadStations()                            // 第二趟:成功,先结算
    failLate(new Error('档案挂了'))
    await stale
    await flushPromises()

    expect(w.text(), '成功之后不该再冒出失败文案').not.toContain('充电桩档案加载失败')
    expect(w.findAll('.cm-edit').length, '数据是对的却被锁成只读').toBeGreaterThan(0)
  })

  it('❗编辑态里取数挂掉时,「完成」必须还能点 —— 否则锁交不回去', async () => {
    // 红线:CpMeterView.vue:474 `:disabled="!editMode && !!loadErr"` 把 `!editMode &&`
    // 删掉 —— 编辑态里的「完成」一起被禁:人退不出去,cp-meter:car:<year> 那把锁
    // 也交不回去,别人只能干等 3 分钟心跳超时或走接管。禁的只该是"进",不该是"出"。
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    const done = () => w.findAll('button').find(b => b.text().includes('完成'))
    expect(done(), '前提:此刻是「完成」态').toBeTruthy()

    vi.mocked(cpMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    await w.find('.cm-permonth').trigger('click')
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')
    await flushPromises()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true   // 换期守卫会退出,这里只测按钮
    await flushPromises()

    expect(w.find('.fp-lderr').exists(), '前提:确实是失败态').toBe(true)
    expect(done()?.attributes('disabled'), '编辑态里的「完成」被禁掉了 —— 退不出去').toBeUndefined()
  })

  it('❗切页签要收掉抽屉 —— 它是 Teleport to body,子树没了它不会没', async () => {
    // 红线:CpMeterView.vue:62 onDeactivated 里把 `openSt.value = null` 删掉 ——
    // FPDrawer Teleport 到 body,随 KeepAlive 停用不会移出,浮在别的页面上。
    const Host = defineComponent({
      components: { CpMeterView },
      props: { on: { type: Boolean, default: true } },
      template: '<KeepAlive><CpMeterView v-if="on" vehicle-type="car" /></KeepAlive>',
    })
    const w = mount(Host, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    await w.findAll('.cm-table tbody tr')[0].trigger('click')
    await flushPromises()
    expect(w.find('.fp-dwr-backdrop').exists(), '前提:抽屉开着').toBe(true)

    await w.setProps({ on: false })    // KeepAlive 停用 = 切到别的页签
    await flushPromises()
    await w.setProps({ on: true })
    await flushPromises()
    expect(w.find('.fp-dwr-backdrop').exists(), '切回来抽屉还开着').toBe(false)
  })

  it('❗失败态不许进编辑模式 —— 占得到锁却一个写控件都没有', async () => {
    // 红线:CpMeterView.vue:474 `:disabled="!editMode && !!loadErr"` 整个删掉 ——
    // 进得去就占住 cp-meter:car:<year> 那把锁,可 editStation/editReading 都被
    // loadErr 判假,一个写控件都不会出现:把别人挡在外面,自己什么也做不了。
    vi.mocked(cpMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    const b = w.findAll('button').find(x => x.text().includes('编辑'))
    expect(b, '前提:编辑模式按钮在').toBeTruthy()
    expect(b!.attributes('disabled'), '失败态还能进编辑模式').toBeDefined()
  })

  it('❗只有桩档案挂了时,抽屉不许藏掉这一桩真实存在的记录', async () => {
    // 红线:CpMeterView.vue:598 抽屉那道拦截从 `v-if="readErr"` 改成判合并槽 loadErr ——
    // 档案挂掉(记录好好的)也会宣布「本月记录未加载成功…别在这里录」,
    // 并把真实记录全部藏起来:说了假话还删了信息。
    vi.mocked(cpMeterApi.readings).mockResolvedValue(MAR as never)
    const w = await toTable()
    vi.mocked(cpMeterApi.stations).mockRejectedValue(new Error('档案挂了'))
    await (w.vm as unknown as { loadStations: () => Promise<void> }).loadStations()
    await flushPromises()
    expect(w.text(), '前提:档案的失败已经上屏').toContain('充电桩档案加载失败')

    await w.findAll('.cm-table tbody tr')[0].trigger('click')
    await flushPromises()
    expect(w.text(), '记录好好的,抽屉不该说记录没加载成功').not.toContain('本月记录未加载成功')
    expect(w.findAll('.cm-dtable tbody tr').length, '这一桩的真实记录被藏了').toBeGreaterThan(0)
  })
})

/**
 * 本屏特有:附表7(car)与附表8(ebike)共用本组件,却是两个独立的屏。
 * 期按 `cp-meter:{type}` 分记,账期清单按车型取 —— 两边互不串。
 */
describe('分桩充电明细 · 附表7/8 各记各的', () => {
  it('❗两次 mount 不同 vehicleType:期互不串,months 各按各的车型取', async () => {
    // 红线一:CpMeterView.vue:82 useMonthGate 的 key 去掉 `:${props.vehicleType}` ——
    //   汽车屏选过 3 月后,电动车屏一进来直落 3 月的表,不再撞矩阵(第二段断言红)。
    // 红线二:CpMeterView.vue:154 months 不带车型 —— 第三段 toHaveBeenCalledWith('ebike') 红。
    const car = await open('car')
    await car.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    expect(car.find('.cm-page').exists()).toBe(true)
    car.unmount()

    vi.mocked(cpMeterApi.months).mockClear()
    vi.mocked(cpMeterApi.readings).mockClear()
    const ebike = await open('ebike')
    expect(ebike.find('.fmg').exists(), '电动车屏不该继承汽车屏选过的期').toBe(true)
    expect(ebike.find('.cm-page').exists()).toBe(false)
    expect(cpMeterApi.readings, '没选期不该拉记录').not.toHaveBeenCalled()
    expect(cpMeterApi.months).toHaveBeenCalledWith('ebike')
    ebike.unmount()

    // 反向再钉一下:回到汽车屏,它自己的期还在,直落表格
    const carAgain = await open('car')
    expect(carAgain.find('.fmg').exists(), '汽车屏选过的期不该被电动车屏动过').toBe(false)
    expect(carAgain.find('.cm-page').exists()).toBe(true)
  })
})

describe('充电桩分桩明细 · 写完要刷账期清单', () => {
  it('❗删除记录之后要重新问一遍哪些月有数据 —— 否则矩阵把刚录过的月画成空', async () => {
    // dataMonths 是矩阵 hasData 着色的唯一数据源。写路径只 loadMonth 不刷清单的话,
    // 用户在空月录了第一笔 → 回矩阵 → 那个月还是灰的 —— 矩阵在说假话。
    // (agent 写测时抓到的移植遗漏:PvMeterView 有 reloadAfterWrite,这屏当初没搬。)
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    vi.mocked(cpMeterApi.months).mockClear()
    vi.mocked(cpMeterApi.deleteReading).mockResolvedValue(undefined as never)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await (w.vm as unknown as { delRow: (id: number, d: string) => Promise<void> })
      .delRow(1, '2025-03-05')
    await flushPromises()

    expect(cpMeterApi.months, '写完要重新问一遍哪些月有数据').toHaveBeenCalled()
  })

  it('❗保存记录之后同样要刷清单 —— 五个写路径各自的调用点都要钉', async () => {
    // 破坏验证抓到:只钉 delRow 时,把 saveForm 的 reloadAfterWrite 换回 loadMonth 照样绿。
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    const vm = w.vm as unknown as {
      editMode: boolean; openSt: object | null
      form: { readDate: string; chargeKwh: string; fee: string; revenue: string; note: string }
      adding: boolean; saveForm: () => Promise<void>
    }
    vm.editMode = true
    await flushPromises()
    vm.openSt = STATIONS[0] as never
    vm.adding = true
    vm.form = { readDate: '2025-03-09', chargeKwh: '10', fee: '1', revenue: '8', note: '' }
    await flushPromises()
    vi.mocked(cpMeterApi.months).mockClear()
    vi.mocked(cpMeterApi.createReading).mockResolvedValue({} as never)

    await vm.saveForm()
    await flushPromises()

    expect(cpMeterApi.createReading, '前提:保存真的发生了').toHaveBeenCalled()
    expect(cpMeterApi.months, '保存后要刷账期清单').toHaveBeenCalled()
  })
})

/** 复查第二轮坐实的测试空档(2 HIGH + 3 MEDIUM)+ 本轮新守卫。 */
describe('分桩充电明细 · 复查补钉', () => {
  async function toCar() {
    const w = await open('car')
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    return w
  }

  it('❗car 屏只画汽车桩 —— vehicleType 过滤是附表7/8 唯一的数据隔离', async () => {
    // 删掉 myStations/myReadings/myUsage 的 .filter(vehicleType) 时:
    // 附表7 渲染出电动车桩,月汇总把电动车的量加进汽车账,导出的政府报表两本账串一张表。
    // 此前注释声称钉了行数,实际零断言(复查抓到:测试文件对自身覆盖面说了假话)。
    const w = await toCar()
    const names = w.findAll('.cm-table tbody tr').map(r => r.text())
    expect(names.length, 'car 屏只有 2 台汽车桩').toBe(2)
    expect(w.find('.cm-table').text(), '电动车桩不许出现在汽车屏').not.toContain('叮叮充')
  })

  it('❗编辑态里 commitMeter 的整条路径:空串不动 / 载荷对月 / 失败回滚', async () => {
    // 此前只测了浏览态自守 —— 删掉空串守卫后,清空输入框失焦(change 带 ''),
    // Number('')=0 过非负校验,upsert 把真实电表读数覆写成 0:数据被销毁,测试全绿。
    const w = await toCar()
    const vm = w.vm as unknown as {
      editMode: boolean
      myUsage: { operator: string; meterKwh: number | null; id: number | null }[]
      commitMeter: (u: object, raw: string) => void
    }
    vm.editMode = true
    await flushPromises()
    const u = { id: 1, operator: '万城万', vehicleType: 'car', year: 2025, month: 3,
                meterKwh: 100, sumChargeKwh: 95, lossKwh: 5, note: null }

    vm.commitMeter(u as never, '')                 // 空串=不动(后端无删除口)
    expect(cpMeterApi.upsertPowerUsage, '空串不许打出去 —— 那会把真值覆写成 0').not.toHaveBeenCalled()

    vm.commitMeter(u as never, '-3')               // 负数拦下
    expect(cpMeterApi.upsertPowerUsage).not.toHaveBeenCalled()

    vi.mocked(cpMeterApi.upsertPowerUsage).mockResolvedValue({ ...u, meterKwh: 120 } as never)
    vm.commitMeter(u as never, '120')
    await flushPromises()
    expect(cpMeterApi.upsertPowerUsage, '载荷必须带对的运营商与年月').toHaveBeenCalledWith(
      expect.objectContaining({ operator: '万城万', year: 2025, month: 3, meterKwh: 120 }))

    // 失败回滚:乐观更新写上去的值要退回去
    vi.mocked(cpMeterApi.upsertPowerUsage).mockRejectedValue(new Error('挂了'))
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    const live = { ...u, meterKwh: 120 }
    vm.commitMeter(live as never, '999')
    expect((live as { meterKwh: number }).meterKwh, '乐观更新先写上').toBe(999)
    await flushPromises()
    expect((live as { meterKwh: number }).meterKwh, '失败要回滚').toBe(120)
  })

  it('❗换期在途时 commitMeter 打不出去 —— fp-stale 挡不住已聚焦输入框的键盘提交', async () => {
    const w = await toCar()
    const vm = w.vm as unknown as {
      editMode: boolean; reloading: boolean
      commitMeter: (u: object, raw: string) => void
    }
    vm.editMode = true
    vm.reloading = true            // 换期在途
    await flushPromises()
    vm.commitMeter({ id: 1, operator: '万城万', vehicleType: 'car', year: 2025, month: 3,
                     meterKwh: 100, sumChargeKwh: 95, lossKwh: 5, note: null } as never, '120')
    expect(cpMeterApi.upsertPowerUsage, '在途时按的是新期标、写的是旧语境的数').not.toHaveBeenCalled()
  })

  it('❗换期在途时「电表与损耗」卡要退一步(fp-stale)', async () => {
    const w = await toCar()
    // 卡挂在 v-if="myUsage.length" 上 —— 先喂一行,否则卡不渲染断言落空
    ;(w.vm as unknown as { usageRows: object[] }).usageRows = [
      { id: 1, operator: '万城万', vehicleType: 'car', year: 2025, month: 3,
        meterKwh: 100, sumChargeKwh: 95, lossKwh: 5, note: null },
    ]
    ;(w.vm as unknown as { reloading: boolean }).reloading = true
    await new Promise(r => setTimeout(r, 260))    // useDeferredFlag 熬 200ms
    await flushPromises()
    expect(w.find('.cm-usage').classes(), '第二张带写入口的卡也要盖').toContain('fp-stale')
  })

  it('❗真点按钮进编辑态 —— FPEditModeButton 的 toggle 接线不许断', async () => {
    // 此前 28 条全用 vm.editMode 直写,@toggle="toggleEdit()" 的接线删掉照样全绿。
    const w = await toCar()
    const btn = w.findAll('button').find(b => b.text().includes('编辑模式'))
    expect(btn, '按钮在').toBeTruthy()
    await btn!.trigger('click')
    await flushPromises()
    expect(w.findAll('button').some(b => b.text() === '完成'), '点了要真进得去').toBe(true)
  })

  it('❗onImport / submitStation / delStation 写完也要刷清单(五个调用点逐个钉)', async () => {
    const w = await toCar()
    const vm = w.vm as unknown as Record<string, (...a: never[]) => Promise<void>> & {
      editMode: boolean; openSt: object | null
      stForm: { name: string; operator: string; vehicleType: string }
    }
    vm.editMode = true
    await flushPromises()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'alert').mockImplementation(() => {})

    // onImport(走 importRegistry 的 http.post)
    const api = (await import('@/api')).default
    vi.spyOn(api, 'post').mockResolvedValue({ imported: 1, skipped: 0, errors: [] } as never)
    vi.mocked(cpMeterApi.months).mockClear()
    await vm.onImport([{ 桩名: '快充1', 日期: '2025-03-09', 充电量: 1, 手续费: 0, 收益: 1 }] as never, 'x.xlsx' as never)
    await flushPromises()
    expect(cpMeterApi.months, 'onImport 后要刷清单').toHaveBeenCalled()

    // submitStation
    vm.stForm = { name: '新桩X', operator: '新商', vehicleType: 'car' }
    vi.mocked(cpMeterApi.createStation).mockResolvedValue({} as never)
    vi.mocked(cpMeterApi.months).mockClear()
    await vm.submitStation()
    await flushPromises()
    expect(cpMeterApi.months, 'submitStation 后要刷清单').toHaveBeenCalled()

    // delStation
    vm.openSt = STATIONS[0] as never
    vi.mocked(cpMeterApi.deleteStation).mockResolvedValue(undefined as never)
    vi.mocked(cpMeterApi.months).mockClear()
    await vm.delStation()
    await flushPromises()
    expect(cpMeterApi.months, 'delStation 后要刷清单').toHaveBeenCalled()
  })

  it('❗切页签回来要重拉桩库与清单 —— 双实例对跨型写入不许失明', async () => {
    // 附表7/8 是两个 KeepAlive 实例,桩库共享:在另一屏跨型建桩/点模拟填充后,
    // 本实例的 stations/dataMonths 全部陈旧 —— 新桩不见 → 重建撞 409 却满屏找不到;
    // 矩阵把 simulate 刚写的月画成空 → 用户对着假空表手工补录 → 双计。
    // 房内解药 onReactivated 已用在 6 屏,本屏是移植时漏接的(复查坐实)。
    const Host = defineComponent({
      components: { CpMeterView },
      props: { on: { type: Boolean, default: true } },
      template: '<KeepAlive><CpMeterView v-if="on" vehicle-type="car" /></KeepAlive>',
    })
    const w = mount(Host, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    vi.mocked(cpMeterApi.stations).mockClear()
    vi.mocked(cpMeterApi.months).mockClear()

    await w.setProps({ on: false })   // 切走
    await flushPromises()
    await w.setProps({ on: true })    // 切回来
    await flushPromises()

    expect(cpMeterApi.stations, '切回来要重拉共享桩库').toHaveBeenCalled()
    expect(cpMeterApi.months, '切回来要重拉账期清单').toHaveBeenCalled()
  })

  it('❗confirm 期间对面才进编辑 → 复查要拦住(TOCTOU)', async () => {
    // confirm() 同步阻塞事件循环:对话框开着期间 ping 一拍都发不出,弹框前的检查
    // 读的是冻结名单,窗口宽度 = 用户读文案的时长。服务端对 /simulate 不查锁,
    // 前端这道闸是唯一防线 —— confirm 返回后必须再复查一次。
    const w = await toCar()
    const vm = w.vm as unknown as { editMode: boolean; onSimulate: () => Promise<void> }
    vm.editMode = true
    await flushPromises()
    const { usePresenceStore } = await import('@/stores/presence')
    const pres = usePresenceStore()
    pres.users = []                                  // 弹框前:对面没人
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      // 用户读文案的这段时间里,李四在对面进了编辑态
      pres.users = [{
        sid: 's9', user: 'lisi', displayName: '李四', role: null, scope: null, label: '附表8',
        mode: 'edit', editScopes: ['cp-meter:ebike:2025'], sinceMs: 1, idleMs: 0, self: false,
      }]
      return true
    })

    await vm.onSimulate()
    expect(cpMeterApi.simulate, 'confirm 之后不复查就写穿对面的锁').not.toHaveBeenCalled()
  })

  it('❗电表卡与空态横幅也要吃车型过滤 —— myUsage/myIds 各自钉死', async () => {
    // 上一条过滤测试只钉了 myStations(注释声称钉三处,又一次对覆盖面说假话)。
    // myUsage 不过滤:car 屏的电表卡渲染出 ebike 运营商行,commitMeter 载荷带 u.vehicleType
    // —— 在汽车屏上录数写进电动车的账。myIds 不过滤:只有 ebike 记录的月,car 屏的
    // 「暂无记录」横幅会消失 —— 把别人的账当成自己的有数月。
    vi.mocked(cpMeterApi.readings).mockResolvedValue([
      { id: 9, stationId: 9, stationName: '单车棚A', readDate: '2025-03-05',
        chargeKwh: 50, fee: 2, revenue: 20, note: null, source: 'manual' },
    ] as never)                                       // 只有 ebike 桩的记录
    vi.mocked(cpMeterApi.powerUsage).mockResolvedValue([
      { id: 1, operator: '万城万', vehicleType: 'car', year: 2025, month: 3,
        meterKwh: 100, sumChargeKwh: 95, lossKwh: 5, note: null },
      { id: 2, operator: '叮叮充', vehicleType: 'ebike', year: 2025, month: 3,
        meterKwh: 60, sumChargeKwh: 55, lossKwh: 5, note: null },
    ] as never)
    const w = await toCar()

    expect(w.find('.cm-utable').text(), 'ebike 运营商行不许出现在汽车屏的电表卡').not.toContain('叮叮充')
    expect(w.find('.cm-empty').exists(), '本型没有记录就该亮「暂无」—— ebike 的记录不算数').toBe(true)
  })

  it('❗切回来时已选的月也要重取 —— 双计剧本的后半段', async () => {
    // onReactivated 的第三支 `if (picked) loadMonth()`:另一屏跑完 simulate 切回来,
    // 矩阵经 loadMonths 亮了,可当前打开的月的表体仍是 simulate 前的旧数据 ——
    // 用户对着缺行的表在别的日期补录,与 simulated 行双计。
    const Host = defineComponent({
      components: { CpMeterView },
      props: { on: { type: Boolean, default: true } },
      template: '<KeepAlive><CpMeterView v-if="on" vehicle-type="car" /></KeepAlive>',
    })
    const w = mount(Host, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    await w.findAll('.bmm-card')[2].trigger('click')   // 选 2025-03
    await flushPromises()
    vi.mocked(cpMeterApi.readings).mockClear()
    vi.mocked(cpMeterApi.powerUsage).mockClear()

    await w.setProps({ on: false })
    await flushPromises()
    await w.setProps({ on: true })
    await flushPromises()

    expect(cpMeterApi.readings, '切回来要重取当前月').toHaveBeenCalledWith(2025, 3)
    expect(cpMeterApi.powerUsage, '电表行同理').toHaveBeenCalledWith(2025, 3)
  })

  it('❗对面车型同年有人在编辑 → 模拟填充不许跑(simulate 是全类型写)', async () => {
    const w = await toCar()
    const vm = w.vm as unknown as { editMode: boolean; onSimulate: () => Promise<void> }
    vm.editMode = true
    await flushPromises()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    // 对面(ebike)同年有人在编辑 —— 在场表直接喂
    const { usePresenceStore } = await import('@/stores/presence')
    usePresenceStore().users = [{
      sid: 's9', user: 'lisi', displayName: '李四', role: null, scope: null, label: '附表8',
      mode: 'edit', editScopes: ['cp-meter:ebike:2025'], sinceMs: 1000, idleMs: 0, self: false,
    }]

    await vm.onSimulate()
    expect(cpMeterApi.simulate, 'simulate 会写对面的账,对面有锁就不许跑').not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalled()
    expect(String(alert.mock.calls[0][0])).toContain('李四')
  })
})

describe('分桩充电明细 · 期间深链(SIDEBAR-UX-REDESIGN §4.2)', () => {
  it('❗带 p 进屏直落那个月:矩阵不出现,记录只拉一次、拉的就是那个月', async () => {
    // 红线:CpMeterView.vue 的 useDeepPeriod 删掉 → 落回矩阵;挪到 onMounted 之后 → readings 拉两次
    query.p = '2025-03'
    const w = await open()
    expect(w.find('.fmg').exists(), '门该被深链跳过').toBe(false)
    expect(w.find('.cm-page').exists()).toBe(true)
    expect(cpMeterApi.readings).toHaveBeenCalledWith(2025, 3)
    expect(cpMeterApi.readings).toHaveBeenCalledTimes(1)
  })

  it('抽屉里正在新增一行时切走 → 草稿随抽屉一起收掉;切回换月照换(本屏不设 dirty 闸:切回时没有草稿可护)', async () => {
    // 红线:onDeactivated 里的 `openSt.value = null` 删掉 → watch(openSt, cancelForm) 不跑,adding 留着 → 「草稿已收」断言红
    query.p = '2025-03'
    const Host = defineComponent({
      components: { CpMeterView },
      props: { on: { type: Boolean, default: true } },
      template: '<KeepAlive><CpMeterView v-if="on" vehicle-type="car" /></KeepAlive>',
    })
    const w = mount(Host, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    const vm = w.findComponent(CpMeterView).vm as unknown as { openSt: unknown; startAdd: () => void; adding: boolean }
    vm.openSt = STATIONS[0]        // 走真实路径:新增行只能从抽屉里点出来
    await flushPromises()          // 抽屉先开(watch(openSt, cancelForm) 先落定),照真实两次点击的间隔来
    vm.startAdd()
    await flushPromises()
    expect(vm.adding, '前提:新增行展开着').toBe(true)
    await w.setProps({ on: false }); await flushPromises()
    expect(vm.adding, '切走时抽屉收掉,草稿跟着没了').toBe(false)
    query.p = '2025-04'
    await w.setProps({ on: true }); await flushPromises()
    expect(cpMeterApi.readings, '没有草稿可护 → 期照换').toHaveBeenCalledWith(2025, 4)
  })
})
