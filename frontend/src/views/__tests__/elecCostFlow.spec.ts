import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

import ElecCostView from '@/views/elec/ElecCostView.vue'
import { elecCostApi } from '@/api/elecCost'
import type {
  ElecMeterDTO, ElecCostEntryDTO, ElecPriceCfgDTO, ElecMetricDTO,
} from '@/api/elecCost'
import { useAuthStore } from '@/stores/auth'
import api from '@/api'

/**
 * 电费成本总览(ElecCostView)挂载测 —— 模板照 cpMeterFlow.spec.ts + meterPeriodFlow.spec.ts
 * (三屏刚套上同一套「选期矩阵 + 失败槽 + 编辑门」形状,本屏工作区未提交)。
 *
 * 每条用例的注释都写明:production(ElecCostView.vue)改哪一行会让它红。
 *
 * (写测时抓到的坑 —— loadMonth 失败分支不碰 cfgs,首败整屏停转圈 —— 已在 4a61a1a 修掉:
 *   catch 里 `cfgs.value = cfgs.value ?? []`;「首败不转圈」那条就是它的钉。
 *   早期用例仍走"先成功进一个月再换月触发失败",与真实换月剧本同形,保留不改。)
 */

vi.mock('@/api/elecCost', () => ({
  elecCostApi: {
    meters: vi.fn(), createMeter: vi.fn(), updateMeter: vi.fn(), deleteMeter: vi.fn(),
    years: vi.fn(), months: vi.fn(),
    entries: vi.fn(), upsertEntry: vi.fn(), deleteEntry: vi.fn(),
    priceCfg: vi.fn(), savePriceCfg: vi.fn(),
    importRows: vi.fn(), simulate: vi.fn(),
    metrics: vi.fn(), metricsYear: vi.fn(),
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

// 夹具按真实 DTO 声明(src/api/elecCost.ts)再 as never —— 字段漏一个渲染当场崩。
const METERS: ElecMeterDTO[] = [
  { id: 1, name: '园区总表', kind: 'master', sortNo: 1 },
  { id: 2, name: '运营表A', kind: 'ops', sortNo: 2 },
]

/** 2025-03 的一条真实形状费项行(ops 表 usage 费项)。source/note 是来源/备注列要读的。 */
const ENTRIES: readonly ElecCostEntryDTO[] = [
  { id: 11, meterId: 2, meterName: '运营表A', acctMonth: '2025-03', feeKey: 'usage', subKey: '',
    amount: 100, qty: null, note: '旧备注', source: 'manual' },
]

const CFGS: ElecPriceCfgDTO[] = [
  { cfgKey: 'pv_grid_price', value: 0.45, source: 'default', monthValue: null, defaultValue: 0.45, note: null },
  { cfgKey: 'grid_posted_price', value: null, source: null, monthValue: null, defaultValue: null, note: null },
]

const METRICS: ElecMetricDTO[] = [
  { key: 'parkElecProfit', label: '园区电费利润', value: 123.4, formulaText: 'Σ收入−Σ成本', missing: [] },
]

beforeEach(() => {
  setActivePinia(createPinia())
  // param-policy:edit 必须在权限种子里 —— commitCfg/onSimulate 判的是 editC
  // (= editMode && !loadErr && canPrice)。缺了它 canPrice 恒假,把 editC 里的
  // editMode 项删掉(浏览态守卫没了)测试照样绿,⑦ 那两条断言等于没写。
  useAuthStore().permissions = ['entry:edit', 'param-policy:edit']
  vi.clearAllMocks()
  localStorage.clear()
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  vi.mocked(elecCostApi.meters).mockResolvedValue(METERS as never)
  vi.mocked(elecCostApi.entries).mockResolvedValue([] as never)
  vi.mocked(elecCostApi.metrics).mockResolvedValue(METRICS as never)
  vi.mocked(elecCostApi.priceCfg).mockResolvedValue(CFGS as never)
  vi.mocked(elecCostApi.months).mockResolvedValue(['2025-01', '2025-02', '2025-03'])
})

async function open() {
  const w = mount(ElecCostView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

/** 进到表格页:2025-03,三路都成功。 */
async function toTable() {
  const w = await open()
  await w.findAll('.bmm-card')[2].trigger('click')
  await flushPromises()
  return w
}

/**
 * 进到「本月费项取数失败」的表格页:先成功进 2025-03(cfgs 落位,见文件头那条坑),
 * 再换月到 2025-07 让 entries 挂掉 —— 同真实的「换月取数失败」剧本。
 */
async function toFailedTable() {
  const w = await toTable()
  vi.mocked(elecCostApi.entries).mockRejectedValue(new Error('后端挂了'))
  await w.find('.ec-permonth').trigger('click')      // 换月回矩阵
  await flushPromises()
  await w.findAll('.bmm-card')[6].trigger('click')   // 2025-07,取数会失败
  await flushPromises()
  return w
}

const btn = (w: ReturnType<typeof mount>, t: string) =>
  w.findAll('button').find(b => b.text().includes(t))

describe('电费成本总览 · ① 选期动线', () => {
  it('❗首进 = 选期矩阵,矩阵按后端账期着色,不自己 snap 到某个月', async () => {
    // 红线:ElecCostView.vue:452 的 `v-if="!picked"` 改成恒假,或 :166 的
    // `if (picked.value) loadMonth()` 去掉 if 直接拉 —— 前两段断言红;
    // :77 的 `months: () => dataMonths.value ?? []` 断掉喂矩阵 → has/blank 断言红。
    const w = await open()
    expect(w.find('.fmg').exists(), '该看到选期矩阵').toBe(true)
    expect(w.find('.ec-page').exists(), '不该直接落表格').toBe(false)
    expect(elecCostApi.entries, '没选期就不该去拉某个月的费项').not.toHaveBeenCalled()
    const cards = w.findAll('.bmm-card')
    expect(cards).toHaveLength(12)                 // 数据年只有 2025,当前年也是 2025
    expect(cards[0].classes()).toContain('has')
    expect(cards[2].classes()).toContain('has')
    expect(cards[3].classes()).toContain('blank')
  })

  it('❗点月格 → 落表格,拉的是那个月(费项+指标+电价参数三路一起)', async () => {
    // 红线:ElecCostView.vue:126-129 的 Promise.all 少拉任一路 —— 对应的
    // toHaveBeenCalledWith 红(cfgs/metrics 落不齐还会卡在 :474 的转圈上)。
    // ⚠ 拉数是双保险:onPickCell(:156)与 watch(gateYm)(:168)各自都会 loadMonth,
    //   破坏验证坐实**单删任何一个照样绿** —— 两处一起删这条才红,注释别谎报单点。
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    expect(elecCostApi.entries).toHaveBeenCalledWith(2025, 3)
    expect(elecCostApi.metrics).toHaveBeenCalledWith(2025, 3)
    expect(elecCostApi.priceCfg).toHaveBeenCalledWith('2025-03')
    expect(w.find('.ec-page').exists()).toBe(true)
    expect(w.find('.fmg').exists(), '门该退场').toBe(false)
  })

  it('❗months 空表照样画 12 张空卡 —— 否则这本账彻底进不去', async () => {
    // 红线:ElecCostView.vue:458 的 `:loading="dataMonths === null && !monthsErr"` 改成
    // `!dataMonths.length` 之类 —— 空表 [] 被当「加载中」,门永久转圈,第一条也录不进去。
    vi.mocked(elecCostApi.months).mockResolvedValue([])
    const w = await open()
    expect(w.find('.page-spin').exists(), '空数据不是「加载中」').toBe(false)
    expect(w.findAll('.bmm-card'), '当前年一行 12 张空卡').toHaveLength(12)
    expect(w.findAll('.bmm-card.blank')).toHaveLength(12)

    // 而且点得进去 —— 那正是要去录第一笔的地方
    await w.findAll('.bmm-card')[6].trigger('click')
    await flushPromises()
    expect(elecCostApi.entries).toHaveBeenCalledWith(2025, 7)
  })
})

describe('电费成本总览 · ② 取数失败时不许猜', () => {
  it('❗费项挂了 + 编辑态 → 零写入口;「本月暂无」不与失败条并列', async () => {
    // 红线:ElecCostView.vue:49/50 editE/editC 里的 `&& !loadErr.value` 删掉 ——
    // 行内输入(.ec-in 金额备注 / .ec-nameedit 表名 / .ec-cfgin 电价)在假底数上冒出来;
    // :507 导入按钮的 v-if 从 editE 放宽成 editMode —— 导入入口回来;
    // :530 空态的 `!loadErr &&` 删掉 —— entries 被清成 [],「暂无」把失败说成「真的没有」。
    const w = await toFailedTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()

    expect(w.find('.fp-lderr').exists(), '失败条得在').toBe(true)
    expect(w.text()).toContain('后端挂了')
    expect(w.findAll('.ec-in'), '金额/备注行内输入框').toHaveLength(0)
    expect(w.findAll('.ec-nameedit'), '电表名行内输入框').toHaveLength(0)
    expect(w.findAll('.ec-cfgin'), '电价参数输入框(editC 那扇门)').toHaveLength(0)
    expect(btn(w, '导入'), '导入长表 Excel 的入口').toBeUndefined()
    expect(w.find('.ec-empty').exists(), '「暂无」把失败说成了「真的没有」').toBe(false)
  })
})

describe('电费成本总览 · ③ 电表清单独立槽', () => {
  it('❗电表清单挂了 → 硬失败面 .ec-gate-fail + 重试,不是永久转圈', async () => {
    // 红线:ElecCostView.vue:93-101 loadMeters 的 try/catch 改回裸 await(metersErr
    // 不落,:474 那行 `!meters || …` 永远停在转圈),或 :468-472 的硬失败面删掉。
    vi.mocked(elecCostApi.meters).mockRejectedValue(new Error('清单挂了'))
    const w = await toTable()
    expect(w.find('.page-spin').exists(), '不许永久转圈').toBe(false)
    expect(w.find('.ec-gate-fail').exists()).toBe(true)
    expect(w.text()).toContain('电表清单加载失败')

    vi.mocked(elecCostApi.meters).mockResolvedValue(METERS as never)
    await btn(w, '重试')!.trigger('click')
    await flushPromises()
    expect(w.find('.ec-page').exists(), '重试成功该落表').toBe(true)
  })

  it('❗metersErr 独立槽不许被换月的成功抹掉', async () => {
    // 红线:ElecCostView.vue:90 的 metersErr 独立槽并回 readErr(合槽)——
    // loadMonth 成功那句 `readErr.value = null`(:131)顺手把清单的失败一起抹掉,
    // 屏上是一张没有任何解释的表。
    const w = await open()
    vi.mocked(elecCostApi.meters).mockRejectedValue(new Error('清单挂了'))
    ;(w.vm as unknown as { loadMeters: () => Promise<void> }).loadMeters()
    await flushPromises()

    await w.findAll('.bmm-card')[2].trigger('click')   // 换月:费项这次是成功的
    await flushPromises()
    expect(w.text(), '清单的失败被费项的成功抹掉了').toContain('电表清单加载失败')
  })
})

describe('电费成本总览 · ④ readErr 只在成功清', () => {
  /** 一个永不结算的 promise —— 把"在途"这段时间钉住看。 */
  const hang = () => new Promise(() => {})

  it('❗重试在途的整段时间里,门必须继续关着', async () => {
    // 红线:ElecCostView.vue:131 成功分支那句 `readErr.value = null` 挪到 loadMonth
    // 开头(:124 旁):点重试那一刻 loadErr 当场变假 —— 失败条消失、伪造的空表上
    // 冒出输入框、还宣布「本月暂无」,而 entries 还是失败留下的 []。
    const w = await toFailedTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()

    vi.mocked(elecCostApi.entries).mockImplementation(hang as never)
    await w.find('.fp-lderr button').trigger('click')   // 重试 —— 这一趟永不结算
    await nextTick()

    expect(w.find('.fp-lderr').exists(), '失败条不该在重试一开始就消失').toBe(true)
    expect(w.findAll('.ec-in'), '在途时不该冒出写入口').toHaveLength(0)
    expect(w.find('.ec-empty').exists(), '在途时不该宣布「本月暂无」').toBe(false)
  })

  it('❗重试成功之后门要重新打开 —— 光会关不会开就是把人永久锁在外面', async () => {
    // 红线:ElecCostView.vue:131 那句 `readErr.value = null` 整个删掉 ——
    // "失败时关门"的断言一条都不红,而后端恢复后失败条还挂着,
    // 写入口永久禁用,唯一出路是刷新整页。
    const w = await toFailedTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    expect(w.find('.fp-lderr').exists(), '前提:先失败一次').toBe(true)

    vi.mocked(elecCostApi.entries).mockResolvedValue(ENTRIES as never)
    await w.find('.fp-lderr button').trigger('click')       // 重试,这次成功
    await flushPromises()

    expect(w.find('.fp-lderr').exists(), '成功了失败条还挂着').toBe(false)
    expect(w.findAll('.ec-in').length, '成功了写入口没回来').toBeGreaterThan(0)
  })
})

describe('电费成本总览 · ⑤ 失败态禁"进"不禁"出"', () => {
  it('❗编辑态里 loadErr 变真,「完成」必须还能点 —— 否则锁交不回去', async () => {
    // 红线:ElecCostView.vue:518 `:disabled="!editMode && !!loadErr"` 把 `!editMode &&`
    // 删掉 —— 编辑态里的「完成」一起被禁:人退不出去,elec-cost:<年-月> 那把锁
    // 也交不回去,别人只能干等心跳超时或走接管。
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    const done = () => w.findAll('button').find(b => b.text().includes('完成'))
    expect(done(), '前提:此刻是「完成」态').toBeTruthy()

    vi.mocked(elecCostApi.entries).mockRejectedValue(new Error('后端挂了'))
    await w.find('.ec-permonth').trigger('click')
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')
    await flushPromises()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true   // 只测按钮本身
    await flushPromises()

    expect(w.find('.fp-lderr').exists(), '前提:确实是失败态').toBe(true)
    expect(done()?.attributes('disabled'), '编辑态里的「完成」被禁掉了 —— 退不出去').toBeUndefined()
  })

  it('❗失败态不许进编辑模式 —— 占得到锁却一个写控件都没有', async () => {
    // 红线:ElecCostView.vue:518 的 `:disabled` 整个删掉 —— 进得去就占住期锁,
    // 可 editE/editC 都被 loadErr 判假,一个写控件都不会出现:
    // 把别人挡在外面,自己什么也做不了。
    const w = await toFailedTable()
    const b = w.findAll('button').find(x => x.text().includes('编辑'))
    expect(b, '前提:编辑模式按钮在').toBeTruthy()
    expect(b!.attributes('disabled'), '失败态还能进编辑模式').toBeDefined()
  })
})

describe('电费成本总览 · ⑥ 编辑态就地转假要关写弹窗', () => {
  it('❗接管/提权到期就地打假 → 新增电表弹窗与导入弹窗必须一起关', async () => {
    // 红线:ElecCostView.vue:53-57 的 watch(editMode) 删掉 —— 弹窗的 v-if 只判
    // 自己那个 ref(:677 meterDlg / :699 importing),editMode 就地转假后弹窗还挂着,
    // 「新增」「确认导入」照样 POST:浏览态下写库,写的还是一把已归别人的期锁。
    const w = await toTable()
    const vm = w.vm as unknown as { editMode: boolean; meterDlg: boolean; importing: boolean }
    vm.editMode = true
    vm.meterDlg = true
    vm.importing = true
    await flushPromises()
    expect(w.find('.ec-mask').exists(), '前提:新增电表弹窗确实开着').toBe(true)

    vm.editMode = false            // ← 接管 / 授权到期走的正是这一句
    await flushPromises()
    expect(w.find('.ec-mask').exists(), '新增电表弹窗没关').toBe(false)
    expect(vm.importing, '导入弹窗没关').toBe(false)
  })
})

describe('电费成本总览 · ⑦ 浏览态下每个写函数都打不出去', () => {
  it('❗8 个写函数逐个直呼,零 API —— 关弹窗只是 UI 补丁', async () => {
    // 红线:八个写函数各自开头的守卫 —— commitAmount(:281)/commitNote(:315)/
    // commitMeterName(:330)/delMeter(:340)/submitMeter(:361)/commitCfg(:381)/
    // onSimulate(:400)/onImport(:432)—— 删掉任何一句,对应的 not.toHaveBeenCalled 红。
    //
    // ⚠ 前置状态必须做足(本仓栽过四次):entries 有值(commitAmount/commitNote 的
    //   cur/e 才存在,否则在自己原有的早退分支就 return 了)、mForm 填好、confirm 恒真、
    //   cfgs 有行 —— 守卫删掉照样绿的断言等于没写。
    // ⚠ commitCfg/onSimulate 判 editC:param-policy:edit 已在权限种子里(见 beforeEach),
    //   让「editC 里的 editMode 项被删」这种破坏真的能走到发请求那一步。
    vi.mocked(elecCostApi.entries).mockResolvedValue(ENTRIES as never)
    vi.mocked(elecCostApi.upsertEntry).mockResolvedValue(ENTRIES[0] as never)
    vi.mocked(elecCostApi.deleteEntry).mockResolvedValue(undefined as never)
    vi.mocked(elecCostApi.createMeter).mockResolvedValue(METERS[1] as never)
    vi.mocked(elecCostApi.updateMeter).mockResolvedValue(METERS[1] as never)
    vi.mocked(elecCostApi.deleteMeter).mockResolvedValue(undefined as never)
    vi.mocked(elecCostApi.savePriceCfg).mockResolvedValue(undefined as never)
    vi.mocked(elecCostApi.simulate).mockResolvedValue({ filled: 1, skipped: 0, byRule: {} } as never)
    const w = await toTable()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'alert').mockImplementation(() => {})

    // 先在编辑态里把状态摆好(新增表单填好)……
    const vm = w.vm as unknown as Record<string, never>
    ;(vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    ;(vm as unknown as { mForm: { name: string; kind: string } }).mForm = { name: '新表X', kind: 'ops' }
    await flushPromises()

    // ……再让编辑态就地转假(= 被接管 / 提权到期走的那一句),然后逐个直呼写函数
    ;(vm as unknown as { editMode: boolean }).editMode = false
    await flushPromises()
    // ⚠ 导入那条走的是 importRegistry 里的 `http.post('/elec-cost/import')`,**不经 elecCostApi**
    //   (registry :788 的 ponytail 注释写明是并行期直调端点)。只断言 elecCostApi.* 的话
    //   onImport 的守卫删掉照样绿。spy @/api default.post 才钉得住。
    const post = vi.spyOn(api, 'post').mockResolvedValue({ imported: 1, skipped: 0, errors: [] } as never)
    const call = vm as unknown as Record<string, (...a: never[]) => unknown>
    call.commitAmount(2 as never, 'usage' as never, '' as never, '999' as never)
    call.commitNote(ENTRIES[0] as never, '改备注' as never)
    call.commitMeterName({ ...METERS[0] } as never, '改名了' as never)
    await call.delMeter(METERS[0] as never)
    await call.submitMeter()
    call.commitCfg(CFGS[0] as never, 'month' as never, '0.9' as never)
    await call.onSimulate()
    await call.onImport(
      [{ 电表: '园区总表', 费项: '工业分时电费', 月份: '2025-03', 金额: 1 }] as never,
      'x.xlsx' as never,
    )
    await flushPromises()

    for (const [k, fn] of [
      ['upsertEntry', elecCostApi.upsertEntry], ['deleteEntry', elecCostApi.deleteEntry],
      ['updateMeter', elecCostApi.updateMeter], ['deleteMeter', elecCostApi.deleteMeter],
      ['createMeter', elecCostApi.createMeter], ['savePriceCfg', elecCostApi.savePriceCfg],
      ['simulate', elecCostApi.simulate], ['importRows', elecCostApi.importRows],
    ] as const) {
      expect(fn, `浏览态下 ${k} 被打出去了`).not.toHaveBeenCalled()
    }
    expect(post.mock.calls.map(c => c[0]), '浏览态下整月导入被打出去了')
      .not.toContain('/elec-cost/import')
  })
})

describe('电费成本总览 · ⑧ reloadMetrics 竞态', () => {
  it('❗换期后旧期的 metrics 回包不许盖进新期', async () => {
    // 红线:ElecCostView.vue:147 的 `const my = seq` / :150 的 `if (my === seq)` 竞态
    // 守卫删掉 —— 旧期发出的 reloadMetrics 慢结算,回包盖进新期:
    // 「7 月标题 + 3 月指标」,指标表在说假话。
    const w = await toTable()

    // 旧期(2025-03)发出一趟慢结算的指标重取
    let settleOld!: (v: unknown) => void
    vi.mocked(elecCostApi.metrics).mockImplementationOnce(
      () => new Promise(res => { settleOld = res }) as never,
    )
    const stale = (w.vm as unknown as { reloadMetrics: () => Promise<void> }).reloadMetrics()

    // 换期到 2025-07,新期指标正常回来
    vi.mocked(elecCostApi.metrics).mockResolvedValue([
      { key: 'parkElecProfit', label: '新期口径指标', value: 7, formulaText: 'f', missing: [] },
    ] as never)
    await w.find('.ec-permonth').trigger('click')
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')
    await flushPromises()
    expect(w.text(), '前提:新期指标已上屏').toContain('新期口径指标')

    // 旧期那趟现在才结算 —— 不许盖进新期
    settleOld([{ key: 'parkElecProfit', label: '旧期口径指标', value: 3, formulaText: 'f', missing: [] }])
    await stale
    await flushPromises()
    expect(w.text(), '旧期回包盖掉了新期指标').not.toContain('旧期口径指标')
    expect(w.text()).toContain('新期口径指标')
  })
})

describe('电费成本总览 · ⑨ 写完要刷账期清单', () => {
  it('❗commitAmount 成功后要重新问一遍哪些月有数据 —— 空月录第一笔矩阵要亮', async () => {
    // 红线:ElecCostView.vue:308 成功分支那句 `void loadYears()` 删掉 ——
    // dataMonths 是矩阵 hasData 着色的唯一数据源,用户在空月录了第一笔 →
    // 回矩阵 → 那个月还是灰的:矩阵在说假话(CpMeter 当初的移植教训)。
    const w = await open()
    await w.findAll('.bmm-card')[6].trigger('click')   // 2025-07,空月
    await flushPromises()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    vi.mocked(elecCostApi.months).mockClear()
    vi.mocked(elecCostApi.upsertEntry).mockResolvedValue({
      id: 77, meterId: 2, meterName: '运营表A', acctMonth: '2025-07', feeKey: 'usage', subKey: '',
      amount: 88, qty: null, note: null, source: 'manual',
    } as never)

    ;(w.vm as unknown as { commitAmount: (mid: number, fee: string, sub: string, raw: string) => void })
      .commitAmount(2, 'usage', '', '88')
    await flushPromises()

    expect(elecCostApi.upsertEntry, '前提:保存真的发生了').toHaveBeenCalled()
    expect(elecCostApi.months, '写完要重新问一遍哪些月有数据').toHaveBeenCalled()
  })
})
describe('电费成本总览 · 首败不转圈', () => {
  it('❗第一次选期就失败 → 失败条 + 重试,不是永久转圈', async () => {
    // 本屏是三份数据(entries/metrics/cfgs):失败分支只清前两份时 cfgs 恒 null,
    // 模板 `!cfgs` 让整屏停在 page-spin —— 失败条一次都不渲染,用户被锁死。
    const { elecCostApi } = await import('@/api/elecCost')
    vi.mocked(elecCostApi.entries).mockRejectedValue(new Error('后端挂了'))
    vi.mocked(elecCostApi.metrics).mockRejectedValue(new Error('后端挂了'))
    vi.mocked(elecCostApi.priceCfg).mockRejectedValue(new Error('后端挂了'))
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')   // 首次选期,三路全挂
    await flushPromises()

    expect(w.find('.page-spin').exists(), '不许永久转圈').toBe(false)
    expect(w.find('.fp-lderr').exists(), '失败条要在').toBe(true)
    expect(w.text()).toContain('后端挂了')
  })
})


describe('电费成本总览 · 复查第二轮补钉', () => {
  async function toTable() {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    return w
  }
  // ⚠ subKey 用 ''(不是 null):entryMap 的键是模板串 `${e.subKey}`,null 会串成字面量 "null",
  //   entryOf(mid, fee, '') 永远查不中 —— 破坏验证抓到删行支整条没执行过。
  const ENTRY = { id: 7, meterId: 1, meterName: '总表', acctMonth: '2025-03', feeKey: 'industrial',
                  subKey: '', amount: 100, qty: null, note: null, source: 'manual' }

  async function toEdit() {
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    return w
  }

  it('❗upsert 失败回滚撞上换期 → 不许把旧期整表盖进新期', async () => {
    // 本屏的乐观回滚是**整数组置换**(样板是改行对象,换期后天然免疫)。
    // 无围栏时:7 月改一笔在途 → 换到 8 月落表 → 7 月那笔失败,catch 把 7 月整表赋回 ——
    // 「2025年8月」标题下渲染的全是 7 月费项,之后每笔录入按 acctMonth=8 写 7 月语境的数。
    const { elecCostApi } = await import('@/api/elecCost')
    vi.mocked(elecCostApi.entries).mockResolvedValue([ENTRY] as never)
    const w = await toEdit()
    const vm = w.vm as unknown as {
      entries: object[] | null
      commitAmount: (mid: number, fk: string, sk: string, raw: string) => void
    }
    let fail!: (e: unknown) => void
    vi.mocked(elecCostApi.upsertEntry).mockReturnValueOnce(new Promise((_, rj) => { fail = rj }) as never)
    vm.commitAmount(1, 'industrial', '', '999')     // 7 月那笔,在途

    // 换到 8 月(空月),新表落位
    vi.mocked(elecCostApi.entries).mockResolvedValue([] as never)
    await w.find('.ec-permonth').trigger('click')
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')
    await flushPromises()
    expect((vm.entries ?? []).length, '前提:8 月是空表').toBe(0)

    fail(new Error('挂了'))                          // 7 月那笔迟到失败
    await flushPromises()
    expect((vm.entries ?? []).length, '7 月整表被回滚盖进了 8 月').toBe(0)
  })

  it('❗清空=删行那支同病:迟到失败不许把旧期表盖回', async () => {
    const { elecCostApi } = await import('@/api/elecCost')
    vi.mocked(elecCostApi.entries).mockResolvedValue([ENTRY] as never)
    const w = await toEdit()
    const vm = w.vm as unknown as {
      entries: object[] | null
      commitAmount: (mid: number, fk: string, sk: string, raw: string) => void
    }
    let fail!: (e: unknown) => void
    vi.mocked(elecCostApi.deleteEntry).mockReturnValueOnce(new Promise((_, rj) => { fail = rj }) as never)
    vm.commitAmount(1, 'industrial', '', '')        // 清空=删行,在途
    expect(elecCostApi.deleteEntry, '前提:删行请求真的发出去了').toHaveBeenCalled()

    vi.mocked(elecCostApi.entries).mockResolvedValue([] as never)
    await w.find('.ec-permonth').trigger('click')
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')
    await flushPromises()

    fail(new Error('挂了'))
    await flushPromises()
    expect((vm.entries ?? []).length, '删行失败的回滚穿越了期').toBe(0)
  })

  it('❗commitCfg 失败回滚同病 —— 旧月电价参数不许盖进新月', async () => {
    const { elecCostApi } = await import('@/api/elecCost')
    const CFG = { cfgKey: 'pv_price', label: '光伏上网电价', unit: '元/kWh',
                  monthValue: 0.4, defaultValue: 0.35, value: 0.4, source: 'month', note: null }
    vi.mocked(elecCostApi.priceCfg).mockResolvedValue([CFG] as never)
    const w = await toEdit()
    const vm = w.vm as unknown as {
      cfgs: { monthValue: number | null }[] | null
      commitCfg: (c: object, scope: string, raw: string) => void
    }
    let fail!: (e: unknown) => void
    vi.mocked(elecCostApi.savePriceCfg).mockReturnValueOnce(new Promise((_, rj) => { fail = rj }) as never)
    vm.commitCfg(CFG as never, 'month' as never, '0.5')

    vi.mocked(elecCostApi.priceCfg).mockResolvedValue([{ ...CFG, monthValue: null, value: 0.35, source: 'default' }] as never)
    await w.find('.ec-permonth').trigger('click')
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')
    await flushPromises()

    fail(new Error('挂了'))
    await flushPromises()
    expect(vm.cfgs?.[0]?.monthValue, '旧月参数被回滚盖进新月').toBeNull()
  })

  it('❗换期在途时 commitAmount/commitCfg 打不出去(已聚焦输入框的键盘提交)', async () => {
    const { elecCostApi } = await import('@/api/elecCost')
    vi.mocked(elecCostApi.entries).mockResolvedValue([ENTRY] as never)
    const w = await toEdit()
    const vm = w.vm as unknown as {
      reloading: boolean
      commitAmount: (mid: number, fk: string, sk: string, raw: string) => void
      commitCfg: (c: object, scope: string, raw: string) => void
    }
    vm.reloading = true
    vm.commitAmount(1, 'industrial', '', '999')
    vm.commitCfg({ cfgKey: 'pv_price', monthValue: 0.4, defaultValue: null, value: 0.4, source: 'month', note: null } as never, 'month' as never, '0.5')
    expect(elecCostApi.upsertEntry).not.toHaveBeenCalled()
    expect(elecCostApi.savePriceCfg).not.toHaveBeenCalled()
  })

  it('❗第二写面(电价参数卡)与指标卡都要盖 fp-stale', async () => {
    const w = await toEdit()
    ;(w.vm as unknown as { reloading: boolean }).reloading = true
    await new Promise(r => setTimeout(r, 260))
    await flushPromises()
    const staled = w.findAll('.ec-listcard').filter(c => c.classes().includes('fp-stale'))
    expect(staled.length, '三张卡(费项/指标/参数)都要退一步').toBe(3)
  })

  it('❗2025 任一月有人在编辑 → 模拟填充不许跑;confirm 期间才进来的也要拦', async () => {
    // simulate 写 2025 全年,本屏只持当月的月锁;服务端不查锁,这道闸是唯一防线。
    const { elecCostApi } = await import('@/api/elecCost')
    const { usePresenceStore } = await import('@/stores/presence')
    const w = await toEdit()
    const vm = w.vm as unknown as { onSimulate: () => Promise<void> }
    const pres = usePresenceStore()
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})

    // 弹框前就有人 → 直接拦
    pres.users = [{
      sid: 's9', user: 'lisi', displayName: '李四', role: null, scope: null, label: '电费',
      mode: 'edit', editScopes: ['elec-cost:2025-03'], sinceMs: 1, idleMs: 0, self: false,
    }]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await vm.onSimulate()
    expect(elecCostApi.simulate).not.toHaveBeenCalled()
    expect(String(alert.mock.calls.at(-1)![0])).toContain('李四')
    // 预检的独有可观察量:人早就在,confirm 根本不该弹(只靠复检的话这里会弹一次)
    expect(confirmSpy, '弹框前就该拦下,不该让用户白读一遍确认文案').not.toHaveBeenCalled()

    // TOCTOU:弹框前没人,confirm 期间进来 → 复检拦
    pres.users = []
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      pres.users = [{
        sid: 's9', user: 'wangwu', displayName: '王五', role: null, scope: null, label: '电费',
        mode: 'edit', editScopes: ['elec-cost:2025-07'], sinceMs: 1, idleMs: 0, self: false,
      }]
      return true
    })
    await vm.onSimulate()
    expect(elecCostApi.simulate, 'confirm 之后不复查就写穿别人的月').not.toHaveBeenCalled()
  })

  it('同期两笔连改的指标乱序回包 —— 后发的那笔要赢', async () => {
    // reloadMetrics 的 seq 只防换期串台;同期两趟持同一个 seq,无 mSeq 时先发后到的旧指标
    // 会盖掉后发先到的新指标。
    const { elecCostApi } = await import('@/api/elecCost')
    const w = await toEdit()
    const vm = w.vm as unknown as { metrics: { value: number }[] | null; reloadMetrics: () => Promise<void> }
    let slow!: (v: unknown) => void
    vi.mocked(elecCostApi.metrics)
      .mockReturnValueOnce(new Promise(r => { slow = r }) as never)   // 第一笔:慢
      .mockResolvedValueOnce([{ key: 'k', label: 'x', value: 222, formula: '', missing: [] }] as never)
    const p1 = vm.reloadMetrics()
    const p2 = vm.reloadMetrics()                                     // 第二笔:快,先落位
    await p2
    slow([{ key: 'k', label: 'x', value: 111, formula: '', missing: [] }])
    await p1
    expect((vm.metrics?.[0] as { value: number } | undefined)?.value, '旧回包盖了新指标').toBe(222)
  })
})
