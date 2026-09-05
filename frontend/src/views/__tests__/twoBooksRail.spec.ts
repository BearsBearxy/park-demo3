import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import PvView from '@/views/pv/PvView.vue'
import { pvApi } from '@/api/pv'
import { pvMeterApi } from '@/api/pvMeter'
import { useAuthStore } from '@/stores/auth'

/**
 * 一屏两本账：功能门 → 左栏（2026-08-29「两本账」设计稿 §②）。
 *
 * 改前是一道**整屏拦住**的岔路口，而且 `mode` 是纯本地 ref ——
 * 侧栏点击走 `tabs.openFresh()` 会重建组件，**每次进来都要重答一遍这道选择题**。
 *
 * 三份原规范（PV/CP/ELEC-METER-SPEC）本来就写着「会话内记住选择（KeepAlive）」，
 * 而实现从落笔那天起就没做到：`openFresh` 的语义（2026-07-07 定）比那三份规范
 * （07-18/19 定稿）早 11 天，两份文档从没对过账。所以这不是推翻规范，是补上它。
 *
 * 挑光伏做样本：三屏（光伏 / 充电桩 / 电费）接法逐字相同，另外两屏由下面的结构门禁覆盖。
 */

vi.mock('@/api/pv', () => ({
  pvApi: {
    overview: vi.fn(), records: vi.fn(), phases: vi.fn(),
    create: vi.fn(), remove: vi.fn(), batchDelete: vi.fn(),
    clearImported: vi.fn(), updateNote: vi.fn(),
  },
}))
vi.mock('@/api/pvMeter', () => ({
  pvMeterApi: {
    stations: vi.fn(), readings: vi.fn(), months: vi.fn(), years: vi.fn(),
    createReading: vi.fn(), updateReading: vi.fn(), deleteReading: vi.fn(),
    createStation: vi.fn(), updateStation: vi.fn(), deleteStation: vi.fn(), simulate: vi.fn(),
  },
}))
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):PvView 与子屏 PvMeterView 都接了 useDeepPeriod(内部 useRoute)。query 可变 —— 深链那几条要在切回之间换掉 ?p=;
// fullPath 走 getter:useRoute() 的返回对象只建一次,写成普通字段的话切回时读到的还是旧地址(照 meterWriteGuards.spec:60-66)。
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/pv-income?' + new URLSearchParams(query).toString() } }),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit', 'meter-master:edit', 'meter-reading:edit']
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(query)) delete query[k]
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  vi.mocked(pvApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(pvApi.phases).mockResolvedValue([] as never)
  vi.mocked(pvMeterApi.stations).mockResolvedValue([] as never)
  vi.mocked(pvMeterApi.readings).mockResolvedValue([] as never)
  vi.mocked(pvMeterApi.months).mockResolvedValue([])
})

async function open() {
  const w = mount(PvView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回(照 meterWriteGuards.spec:299)。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(PvView) : null) }),
  }), { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return { w, alive }
}

describe('光伏 · 一屏两本账', () => {
  it('❗进屏不再是岔路口 —— 左栏两本账常驻，主区直接是内容', async () => {
    const w = await open()
    const items = w.findAll('.br-item')
    expect(items).toHaveLength(2)
    expect(items.map(i => i.find('.br-name').text())).toEqual(['报送台账', '分栋运营账'])
    // 主区已经在报送台账那一支(年份门),不是一屏卡片
    expect(w.find('.sm-gate').exists(), '默认落在报送台账').toBe(true)
  })

  it('左栏副行写的是「按什么口径看」，不是功能名', async () => {
    const w = await open()
    expect(w.findAll('.br-item .br-desc').map(d => d.text()))
      .toEqual(['按期 · 按月', '按栋 · 按日'])
  })

  it('点左栏第二项 → 换到运营账那一支，左栏还在', async () => {
    const w = await open()
    await w.findAll('.br-item')[1].trigger('click')
    await flushPromises()
    // ⚠ 判据必须是**矩阵真的画出来了**。`.fmg` 是 FPMonthGate 的根 div,
    //   转圈那一支也挂在它下面 —— 用它当判据,门永久转圈时测试照样绿(这条曾经真的绿过)。
    expect(w.findAll('.bmm-card').length, '零数据也该给出当前年一行 12 张空月卡').toBe(12)
    expect(w.findAll('.br-item'), '左栏常驻').toHaveLength(2)
    expect(w.findAll('.br-item')[1].classes()).toContain('on')
  })

  it('❗记住上次 —— 卸载重挂(模拟侧栏点击重建)直接落回运营账', async () => {
    const first = await open()
    await first.findAll('.br-item')[1].trigger('click')
    await flushPromises()
    first.unmount()

    const again = await open()
    expect(again.findAll('.br-item')[1].classes(), '不该退回默认那本').toContain('on')
    expect(again.findAll('.bmm-card').length).toBe(12)
  })

  it('❗切账本必须退出编辑态 —— 否则切回来就是「有编辑态、没有锁」', async () => {
    // 锁挂在子组件 SchedHeader 的 onUnmounted 上,切走时**真的还了**;
    // 而 edit 由本层持有,不归零的话切回来表格以编辑态渲染却一把锁都没有,
    // 别人同时也能占到同一期 —— 两人各改各的,后写静默盖先写。
    const w = await open()
    const vm = w.vm as unknown as { edit: boolean; mode: string }
    vm.edit = true
    await flushPromises()

    await w.findAll('.br-item')[1].trigger('click')   // 切到运营账
    await flushPromises()
    expect(vm.edit, '切账本没退出编辑态').toBe(false)
  })

  it('本机存的值被人改坏了就退回默认，不白屏', async () => {
    localStorage.setItem('fp-view-mode:pv-income', 'nonsense')
    const w = await open()
    expect(w.findAll('.br-item')[0].classes()).toContain('on')
  })

  it('两支各自的返回箭头随功能门一起退场 —— 左栏就是出路', async () => {
    const w = await open()
    // 报送台账支:年份门不再有「返回功能选择」
    expect(w.find('.sm-gate-back').exists()).toBe(false)
    await w.findAll('.br-item')[1].trigger('click')
    await flushPromises()
    expect(w.find('.pm-back').exists(), '运营账支的返回箭头也撤了').toBe(false)
  })
})

  it('❗浏览态直呼 onCreate → 零 API(失锁后抽屉可能还挂着,守发请求这层)', async () => {
    const w = await open()
    vi.mocked(pvApi.create).mockResolvedValue({} as never)
    await (w.vm as unknown as { onCreate: (req: object) => Promise<void> })
      .onCreate({ acctMonth: '2026-01', amount: 1 })
    expect(pvApi.create, '浏览态下新增被打出去了').not.toHaveBeenCalled()
  })

/** 另外两屏只做结构门禁 —— 三屏接法逐字相同，各写一份挂载测只会长歪。 */
describe('三屏一致性门禁', () => {
  const VIEWS = join(__dirname, '..')
  const FILES: Record<string, string> = {
    '/pv/PvView.vue': 'pv-income',
    '/charging/ChargingView.vue': 'car-charging',   // 文件里是三元，下面只查前缀
    '/elec/ElecView.vue': 'elec-cost',
  }

  it.each(Object.keys(FILES))('%s 功能门已退场，换成左栏', (rel) => {
    const s = readFileSync(join(VIEWS, rel), 'utf8')
    expect(/fngate/.test(s), `${rel} 还有功能门那块整屏卡片`).toBe(false)
    expect(s.includes('<BookRail'), `${rel} 没有左栏`).toBe(true)
    expect(s.includes('loadViewMode'), `${rel} 不记上次看的是哪本 —— openFresh 会把它清掉`).toBe(true)
    expect(s.includes('saveViewMode'), `${rel} 只读不写，等于没记`).toBe(true)
    expect(/mode = ref<Mode>/.test(s), `${rel} 的 mode 不是从本机读出来的`).toBe(true)
    // ⚠ 键要各归各屏:三屏若共一个 MODE_SCREEN 键,「记住上次看哪本」会互相串台,
    //   而旧门禁分不清三个屏 —— 键撞了照样绿(首轮复查 [132])。
    const expectKeys = rel.includes('Charging') ? ['car-charging', 'ebike-charging'] : [FILES[rel]]
    for (const k of expectKeys) {
      expect(s.includes(`'${k}'`), `${rel} 的 MODE_SCREEN 键不是 ${k}`).toBe(true)
    }
    // 「返回功能选择」是功能门的回退口，门没了它也该没了
    expect(s.includes('返回功能选择'), `${rel} 还留着功能门的回退口`).toBe(false)
  })

  it.each(['/pv/PvView.vue', '/charging/ChargingView.vue', '/elec/ElecView.vue', '/utilities/UtilitiesView.vue'])(
    '%s 的 onCreate/onImport 带写口自守(收口复查:失锁后浮层是仅剩的无锁写入口)', (rel) => {
      const src = readFileSync(join(VIEWS, rel), 'utf8')
      const guards = (src.match(/if \(!edit\.value\) return/g) ?? []).length
      expect(guards, `${rel} 的写函数自守少于 2 处(onCreate + onImport)`).toBeGreaterThanOrEqual(2)
    })

  it.each(['/pv/PvMeterView.vue', '/charging/CpMeterView.vue', '/elec/ElecCostView.vue'])(
    '%s 的返回箭头与 back 事件一并退场', (rel) => {
      const s = readFileSync(join(VIEWS, rel), 'utf8')
      expect(s.includes('返回功能选择')).toBe(false)
      expect(s.includes("defineEmits<{ back: [] }>"), `${rel} 的 back 事件没人接了`).toBe(false)
    })
})

describe('光伏 · 期间深链(SIDEBAR-UX-REDESIGN §4.2 年表屏 p 只取年 / §5.1 extra.mode)', () => {
  // 年表 DTO 的形状不是这里要钉的:records 让它在途,屏落在转圈分支,断言只看门与请求
  const pending = () => vi.mocked(pvApi.records).mockReturnValue(new Promise(() => {}) as never)

  it('❗带 p=2025 进屏直落该年:年份门不出现,拉的就是那一年且只拉一次', async () => {
    // 红线:PvView.vue 的 useDeepPeriod 删掉 → 门出现;current 用 periodOf(year, month) → 切回每次白拉
    query.p = '2025'
    pending()
    const w = await open()
    expect(w.find('.sm-gate').exists(), '门该被深链跳过').toBe(false)
    expect(pvApi.records).toHaveBeenCalledWith(2025)
    expect(pvApi.records).toHaveBeenCalledTimes(1)
  })

  it('❗?mode=summary 盖过本机记住的运营账,且不写回本机', async () => {
    // 红线:mode 初值不看 route.query.mode → 落到运营账;deepMode 经 saveViewMode 写回 → 记忆被一条链接改掉
    localStorage.setItem('fp-view-mode:pv-income', 'meter')
    query.p = '2025'; query.mode = 'summary'
    pending()
    const w = await open()
    expect(w.findAll('.br-item')[0].classes(), '落在报送台账').toContain('on')
    expect(localStorage.getItem('fp-view-mode:pv-income'), '深链不改记忆').toBe('meter')
  })

  it('运营账那本开着时,年份深链不拉年表(它在 v-else 底下看不见);带月的 p 由子屏自己认', async () => {
    // 红线:apply 里的 mode === 'summary' 门删掉 → 看不见的年表白拉一趟
    localStorage.setItem('fp-view-mode:pv-income', 'meter')
    query.p = '2025-03'
    const w = await open()
    expect(w.findAll('.br-item')[1].classes()).toContain('on')
    expect(pvApi.records).not.toHaveBeenCalled()
    expect(pvMeterApi.readings, '子屏 PvMeterView 的深链照常').toHaveBeenCalledWith(2025, 3)
  })

  it('❗切页签回来重读年表与总览(spec §12)', async () => {
    // 红线:PvView.vue 新加的 onReactivated(refresh) 删掉 → 切回零请求
    query.p = '2025'
    // 这条不能用 pending():refresh 先 await load(year) 再 reloadOverview,records 不兑现 overview 永远到不了(计划复查 P0B-1)
    vi.mocked(pvApi.records).mockResolvedValue(null as never)
    const { alive } = await keptAlive()
    vi.mocked(pvApi.records).mockClear()
    vi.mocked(pvApi.overview).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(pvApi.records).toHaveBeenCalledWith(2025)
    expect(pvApi.overview).toHaveBeenCalledTimes(1)
  })

  it('❗新增抽屉开着时切回、地址栏换了年 → 不切年,deepNote 说清楚', async () => {
    // 红线:dirty 探针改成 () => 0 → 年被切到 2026,pickYear 顺手 edit=false 把抽屉关了
    query.p = '2025'
    pending()
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(PvView).vm as unknown as { drawer: boolean; year: number | null }
    vm.drawer = true
    await flushPromises()
    alive.value = false; await flushPromises()
    query.p = '2026'
    alive.value = true; await flushPromises()
    expect(pvApi.records).not.toHaveBeenCalledWith(2026)
    expect(vm.year).toBe(2025)
    expect(vm.drawer).toBe(true)
    expect(w.find('.fpt--warning').text()).toContain('地址栏要求 2026 期，本期有 1 处未保存')
  })

  it('❗current 只报年:切回时地址栏多了别的键、期没变 → 只有重读那一趟,深链不再 apply', async () => {
    // 红线:current 改成 periodOf(year.value, 1) → want '2025' 永不等于 '2025-01' → 地址栏一变键就多 apply 一次(pickYear 又拉一趟年表),records 两趟
    query.p = '2025'
    vi.mocked(pvApi.records).mockResolvedValue(null as never)
    const { alive } = await keptAlive()
    vi.mocked(pvApi.records).mockClear()
    alive.value = false; await flushPromises()
    query.mode = 'summary'   // 去重键变了,期没变
    alive.value = true; await flushPromises()
    expect(pvApi.records, '只有 refresh 那一趟').toHaveBeenCalledTimes(1)
  })
})
