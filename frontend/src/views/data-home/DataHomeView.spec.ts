import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DataHomeOverviewDTO, DataHomeStepDTO } from '@/types/dataHome'

// 锁 DATA-HOME-REDESIGN spec §2/§5:三级主次(总览行 → 流水线 → 当前步大卡 + 唯一主 CTA),
// 以及「没问题的东西不占版面」(blockers 空 → 整条不渲染)。
// 改版前这屏把同一批信息说了三遍(KPI 3/4 与下方重复、待办是完整度的子集),那组断言已随契约删除。

beforeEach(() => setActivePinia(createPinia()))

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const getOverview = vi.fn()
vi.mock('@/api/dataHome', () => ({ dataHomeApi: { getOverview: (ym?: string) => getOverview(ym) } }))

import DataHomeView from './DataHomeView.vue'

const step = (key: string, label: string, status: DataHomeStepDTO['status'], detail = ''): DataHomeStepDTO =>
  ({ key, label, status, detail, go: key })

const STEPS_4DONE: DataHomeStepDTO[] = [
  step('params', '计费参数', 'done', '本月电价 6/6 已录'),
  step('meters', '园区抄表', 'done', '已抄 1088 块'),
  step('alloc', '公共电核算', 'done'),
  step('alloc-loss', '楼栋损耗', 'done'),
  step('bill-notices', '催缴单', 'current', '未生成'),
]
const STEPS_ALLDONE: DataHomeStepDTO[] = STEPS_4DONE.map((s, i) =>
  i === 4 ? step('bill-notices', '催缴单', 'done', '102 户 · ¥2474138.88 · 66 户带警告') : s)

const BLOCKER_CONTRACT = {
  kind: 'contract-gap' as const,
  text: '219 份合同无租金计费行，会让公摊/催缴单算不准',
  cta: '去补档', go: 'contracts',
}

function overview(patch: Partial<DataHomeOverviewDTO> = {}): DataHomeOverviewDTO {
  return {
    period: { year: 2024, month: 2, label: '2024年2月' },
    months: ['2023-08', '2024-02', '2025-06'],
    blockers: [],
    chain: { currentIndex: 4, steps: STEPS_4DONE },
    schedules: {
      done: 2, total: 9,
      items: [
        { name: '月度台账', tag: '凭证', done: false, go: 'ledger' },
        { name: '办公水电', tag: '附13', done: true, go: 'utilities' },
        { name: '光伏发电', tag: '附6', done: true, go: 'pv-income' },
      ],
    },
    ...patch,
  }
}

// RBAC v2 起 isReadonly = 「一个 :edit 权限都没有」,不再是 role === 'viewer'。
// 这屏用它决定 CTA 文案(「去处理」vs「查看」)与写按钮是否渲染,所以默认给一个有写权限的
// 登录态 —— 否则版面用例会被权限态带偏(空 pinia 在 v2 下就是只读)。传 perms: [] 模拟只读账号。
// 必须在 setActivePinia 之前写 storage:auth store 是初始化时读它的。
const EDITOR_PERMS = ['entry:edit', 'billing-run:edit', 'meter-reading:edit', 'report:edit']

async function mountWith(patch: Partial<DataHomeOverviewDTO> = {}, opts: { perms?: string[] } = {}) {
  localStorage.setItem('permissions', JSON.stringify(opts.perms ?? EDITOR_PERMS))
  setActivePinia(createPinia())
  getOverview.mockResolvedValue(overview(patch))
  const w = mount(DataHomeView)
  await flushPromises()
  return w
}

describe('数据中心首页 · 两段式工作台', () => {
  it('blockers 为空时前置条整条不渲染', async () => {
    const w = await mountWith({ blockers: [] })
    expect(w.find('.dh-blocker').exists()).toBe(false)
    expect(w.text()).not.toContain('去补档')
  })

  it('blockers 非空时才出现,且带 CTA', async () => {
    const w = await mountWith({ blockers: [BLOCKER_CONTRACT] })
    expect(w.find('.dh-blocker').exists()).toBe(true)
    expect(w.text()).toContain('219 份合同无租金计费行')
    expect(w.text()).toContain('去补档')
  })

  it('当前步出大卡,且全页只有一个主 CTA', async () => {
    const w = await mountWith({ chain: { currentIndex: 4, steps: STEPS_4DONE } })
    expect(w.text()).toContain('催缴单')
    expect(w.findAll('[data-primary-cta]')).toHaveLength(1)
    expect(w.text()).toContain('去处理')
  })

  it('5 步全 done 时大卡换成去对账', async () => {
    const w = await mountWith({ chain: { currentIndex: -1, steps: STEPS_ALLDONE } })
    expect(w.text()).toContain('本月出账已完成')
    expect(w.text()).toContain('去对账核对')
    expect(w.findAll('[data-primary-cta]')).toHaveLength(1)
  })

  it('period 为 null 时显示空库引导', async () => {
    const w = await mountWith({ period: null })
    expect(w.text()).toContain('还没开始出账')
    expect(w.find('.dh-steps').exists()).toBe(false)   // 空库不摆流水线空架子
  })

  it('零写权限:主 CTA 改「查看」,前置条的写操作按钮隐藏', async () => {
    const w = await mountWith({ blockers: [BLOCKER_CONTRACT] }, { perms: [] })
    expect(w.text()).toContain('查看')
    expect(w.text()).not.toContain('去处理')
    // 前置条文案照出(他该知道有缺口),但「去补档」是写操作,不给点
    expect(w.text()).toContain('219 份合同无租金计费行')
    expect(w.text()).not.toContain('去补档')
  })

  it('附表未录在前、已录在后', async () => {
    const w = await mountWith()
    const names = w.findAll('.dh-item .dh-iname').map(n => n.text())
    expect(names[0]).toBe('月度台账')          // 未录
    expect(names.slice(1)).toEqual(['办公水电', '光伏发电'])   // 已录靠后
  })

  it('不传 ym 首载走锚定月(后端定)', async () => {
    await mountWith()
    expect(getOverview).toHaveBeenCalledWith(undefined)
  })
})

describe('数据中心首页 · 首载骨架', () => {
  // 这屏此前是整页 `v-if="ov"` —— 数据到达前一整块白屏，而它是登录后第一眼看到的屏。
  //
  // ⚠ 它的骨架**是另画的一份版式**（不像列表屏那样能在叶子上放骨架），所以有漂移风险：
  //   谁改了真版式的条数却忘了改骨架，界面就会在数据落位时跳一下，而且不报错。
  //   下面两条就是钉这件事的 —— 出账链恒 4 步、附表恒 9 项
  //   （后端 DataHomeService 写死 `new Schedules(done, 9, items)`）。

  /** 让接口停在「在途」，好在数据到达前观察 DOM。 */
  function pending() {
    let resolve!: (v: DataHomeOverviewDTO) => void
    getOverview.mockReturnValue(new Promise<DataHomeOverviewDTO>((r) => { resolve = r }))
    return { resolve }
  }

  it('数据没到时不是白屏，骨架条数与真版式一致', async () => {
    localStorage.setItem('permissions', JSON.stringify(EDITOR_PERMS))
    setActivePinia(createPinia())
    const gate = pending()
    const w = mount(DataHomeView)
    await flushPromises()

    expect(w.find('.dh').exists(), '根节点必须常驻 —— 它是零位移的锚点').toBe(true)
    expect(w.findAll('.fp-shim').length, '要有骨架，不是白屏').toBeGreaterThan(0)
    expect(w.findAll('.dh-step').length, '出账链恒 5 步').toBe(5)
    expect(w.findAll('.dh-item').length, '附表恒 9 项(后端写死 total=9)').toBe(9)
    // 静态文案不该被糊掉:它们不依赖数据,糊成微光条等于把已知的东西藏起来
    expect(w.text()).toContain('本月出账')
    expect(w.text()).toContain('出账链')

    gate.resolve(overview())
    await flushPromises()
    expect(w.findAll('.fp-shim').length, '数据到了就不该再有骨架').toBe(0)
    expect(w.findAll('.dh-step').length, '真版式也是 5 步 —— 对不上就会跳').toBe(5)
  })

  it('根节点在数据到达前后是同一个 DOM 节点', async () => {
    localStorage.setItem('permissions', JSON.stringify(EDITOR_PERMS))
    setActivePinia(createPinia())
    const gate = pending()
    const w = mount(DataHomeView)
    await flushPromises()

    const before = w.find('.dh').element
    gate.resolve(overview())
    await flushPromises()

    expect(w.find('.dh').element, '根节点被重建了 —— 那就是原来那种整页 v-if 的写法').toBe(before)
  })
})
