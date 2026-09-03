// 公共电核算(PoolLedgerView)写口守卫 —— 钉住 2026-08-29 落地的 5 处 + F2(载入竞态)一处:
//   ① watch(editMode) 转假 → 池配置抽屉(FPDrawer)跟着关(:86)
//   ② onDeactivated 收 alertOpen —— FPAlertPanel 是 FPSideDrawer(Teleport to body),
//     子树随 KeepAlive 停用消失时它会留在 body 上飘着(:83)
//   ③ onGenerate 开头 `if (!editMode.value) return` —— 生成是整月先删后插(:287)
//   ④ submitPool(:686) / delPool(:726) 开头同款守卫
//   ⑤ 期由 useChainDeepPeriod 在 setup 期落定,applyHandoff 只剩 generate=1,顺序仍是先有期再进编辑,
//     且 period.picked 才进 —— 锁 scope 必须是真期的 `billing-chain:YYYY-MM`,不是 `billing-chain:0-00`
//   ⑥ F2:loadRules() 还在飞时禁用保存(rulesLoading/rulesNotReady)——否则 feeKey 静默冲成默认值
//
// ⚠ 浏览态直呼写函数的用例(③④),前置状态必须做足(form 填好、generated/confirm 都不拦路),
//   否则函数在自己原有的早退分支就 return,守卫删掉照样绿 —— 本仓已经栽过两次的坑。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'

const push = vi.fn()
const query: Record<string, string> = {}   // applyHandoff 读 route.query;每条用例自己塞
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query }),
}))

// 本屏自 EDIT-MODE-SPEC v3 起要先占到 billing-chain 月锁才进得了编辑态。
// 不 mock 的话 locksApi 走真 axios,jsdom 里抛错 → 被「拿不准就不进」兜住 → 编辑态永远进不去。
/** 占锁请求过的 scope 全记下来 —— 深链那条要靠它证明锁的是**真的那个月**(照 paramCenterView.spec.ts)。 */
const acquired: string[] = []
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: (scope: string) => { acquired.push(scope); return Promise.resolve({ granted: true, holder: null }) },
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

// generated:false → onGenerate 守卫之后没有 confirm 那道门;rows 空表也照常出页壳
vi.mock('@/api/alloc', () => ({
  allocApi: {
    pools: vi.fn(() => Promise.resolve({ generated: false, rows: [] })),
    memberDiff: vi.fn(() => Promise.resolve([])),
    rules: vi.fn(() => Promise.resolve([])),
    generate: vi.fn(() => Promise.resolve({ warnings: [] })),
    createRule: vi.fn(() => Promise.resolve({})),
    updateRule: vi.fn(() => Promise.resolve({})),
    deleteRule: vi.fn(() => Promise.resolve()),
    poolCandidates: vi.fn(() => Promise.resolve({ meters: [], tenants: [], tenantNote: null })),
    // stores/billingPeriod 的 /months 聚合(照 chainPeriodFlow.spec.ts)
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
  },
}))
vi.mock('@/api/building', () => ({ buildingApi: { list: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn(() => Promise.resolve([])) } }))

import PoolLedgerView from '../alloc/PoolLedgerView.vue'
import { allocApi, type AllocRuleDTO } from '@/api/alloc'

/** vm 直呼写函数用(script setup 的顶层绑定在 dev 构建里挂在实例代理上,meterPeriodFlow 同款) */
interface Vm {
  editMode: boolean
  onGenerate: () => Promise<void>
  submitPool: () => Promise<void>
  delPool: () => Promise<void>
  form: { id: number | null; feeName: string }
}

beforeEach(() => {
  setActivePinia(createPinia())
  // RBAC:两扇门(生成=billing-run,池配置=param-policy)都给齐 —— 编辑态一点就进,守卫只剩锁与 editMode
  useAuthStore().permissions = ['billing-run:edit', 'param-policy:edit']
  acquired.length = 0
  for (const k of Object.keys(query)) delete query[k]
})

async function mountPicked() {
  useBillingPeriodStore().pick(2025, 3)   // 期由出账月矩阵一处选定 —— 单测里直接落 store
  const w = mount(PoolLedgerView, { attachTo: document.body })
  await flushPromises()
  return w
}

describe('PoolLedgerView 写口守卫', () => {
  it('① 编辑态就地转假(提权到期/接管)→ 池配置抽屉跟着关', async () => {
    const w = await mountPicked()
    await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
    await flushPromises()
    // 前置做足:真的进了编辑态、真的开了抽屉 —— 抽屉没开这条什么都测不到
    expect(w.findAll('button').some(b => b.text() === '完成'), '前置:占锁成功进了编辑态').toBe(true)
    await w.findAll('button').find(b => b.text().includes('新增池'))!.trigger('click')
    await flushPromises()
    expect(document.querySelector('.fp-dwr-backdrop'), '前置:池配置抽屉开着').not.toBeNull()
    // 提权到期同款路径:权限掉光 → useEditMode 的 watch([editMode, missing]) 把 editMode 就地转假
    useAuthStore().permissions = []
    await flushPromises()
    // 抽屉的 v-if 只看 poolDlg,不判编辑态;关它的只有 PoolLedgerView:86 那行
    // `watch(editMode, v => { if (!v) poolDlg.value = false })`。
    // production 删掉 :86 这行 → 浏览态下抽屉还开着(「保存」照样 PUT 池配置)→ 这里非 null → 红
    expect(document.querySelector('.fp-dwr-backdrop')).toBeNull()
    w.unmount()
  })

  it('② KeepAlive 停用收 alertOpen —— FPAlertPanel 是 Teleport 抽屉,子树没了它不会没', async () => {
    const Host = defineComponent({
      components: { PoolLedgerView },
      props: { on: { type: Boolean, default: true } },
      template: '<KeepAlive><PoolLedgerView v-if="on" /></KeepAlive>',
    })
    useBillingPeriodStore().pick(2025, 3)
    const w = mount(Host, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    await w.find('button.fac').trigger('click')   // 常驻告警 chip → 开右侧抽屉
    await flushPromises()
    expect(w.find('.fp-sdw').exists(), '前置:告警抽屉开着').toBe(true)

    await w.setProps({ on: false })   // KeepAlive 停用 = 切到别的页签
    await flushPromises()
    await w.setProps({ on: true })
    await flushPromises()
    // production 删掉 :83 onDeactivated 里的 `alertOpen.value = false` → 切回来抽屉还开着 → 红
    // (真实站点里它 Teleport to body,停用时就飘在下一个屏上;单测 stub Teleport 后表现为切回仍渲染)
    expect(w.find('.fp-sdw').exists()).toBe(false)
    w.unmount()
  })

  it('③ 浏览态直呼 onGenerate 一定打不出去 —— 生成是整月先删后插', async () => {
    const w = await mountPicked()
    const vm = w.vm as unknown as Vm
    // 前置做足:confirm 恒真、generating=false、generated=false(pools fixture)——
    // 守卫之后没有任何早退分支,删守卫的话 allocApi.generate 一定被打出去
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    expect(vm.editMode, '前置:浏览态').toBe(false)
    await vm.onGenerate()
    await flushPromises()
    // production 删掉 :287 `if (!editMode.value) return` → generate('2025-03') 被打出去 → 红
    expect(allocApi.generate).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
    w.unmount()
  })

  it('④a 浏览态直呼 submitPool:form 填足也打不出去', async () => {
    const w = await mountPicked()
    const vm = w.vm as unknown as Vm
    // 前置做足:新建池(id=null)把守卫后面唯一的早退分支(缺费项)填掉 ——
    // 删守卫的话 createRule 一定被打出去
    vm.form.feeName = '消防'
    expect(vm.editMode, '前置:浏览态').toBe(false)
    await vm.submitPool()
    await flushPromises()
    // production 删掉 :686 `if (!editMode.value) return` → createRule 被打出去 → 红
    expect(allocApi.createRule).not.toHaveBeenCalled()
    expect(allocApi.updateRule).not.toHaveBeenCalled()
    w.unmount()
  })

  it('④b 浏览态直呼 delPool:有 id、confirm 恒真也删不动', async () => {
    const w = await mountPicked()
    const vm = w.vm as unknown as Vm
    // 前置做足:id 非空(守卫后第一个早退)+ confirm 恒真(第二个早退)
    vm.form.id = 7
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    expect(vm.editMode, '前置:浏览态').toBe(false)
    await vm.delPool()
    await flushPromises()
    // production 删掉 :726 `if (!editMode.value) return` → deleteRule(7) 被打出去 → 红
    expect(allocApi.deleteRule).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
    w.unmount()
  })

  it('⑤ 深链 ?ym&generate=1:先认领期再进编辑 —— 占的必须是真期那把锁', async () => {
    query.ym = '2024-03'
    query.generate = '1'
    const w = mount(PoolLedgerView, { attachTo: document.body })
    await flushPromises()
    expect(useBillingPeriodStore().ym, '深链的期认领进 store').toBe('2024-03')
    expect(w.findAll('button').some(b => b.text() === '完成'), '深链直接进了编辑态').toBe(true)
    // ❗锁的必须是**真的那个月**。期由 useChainDeepPeriod 在 setup 期落定,applyHandoff 只剩 generate=1,
    //   顺序仍是先有期再进编辑:反过来的话 enter() 起手算 scope 时期还没落定,占的是
    //   `billing-chain:0-00`,随后复核发现期变了还锁不进 —— 下面三条一起红。
    expect(acquired, '深链占的锁不是真期的那把').not.toContain('billing-chain:0-00')
    expect(acquired).toContain('billing-chain:2024-03')
    w.unmount()
  })

  it('⑤b 深链只有 generate=1 没有期:不摸锁,主区还是选期矩阵', async () => {
    query.generate = '1'
    const w = mount(PoolLedgerView, { attachTo: document.body })
    await flushPromises()
    expect(w.find('.cmg').exists(), '没有期 → 出账月矩阵').toBe(true)
    // production 删掉 :201 里的 `period.picked` 条件 → toggleEdit 照进,
    // 摸到 `billing-chain:0-00`(year/month 都是 `?? 0`)→ 这里长度非 0 → 红
    expect(acquired).toHaveLength(0)
    w.unmount()
  })

  // ⑥ F2·loadRules() 载入竞态:onMounted 是 fire-and-forget,「还在飞」的窗口里
  //   openPoolDlg 从 ruleById 取 feeKey 拿不到值,静默落回默认键。禁用保存按钮直到
  //   rules 落地(成功或失败)才是唯一不会静默改数的解法 —— 见 rulesLoading/rulesNotReady。
  it('⑥ rules 未返回时保存按钮禁用且提示正在载入,返回后自动可用', async () => {
    let resolveRules!: (v: AllocRuleDTO[]) => void
    const pending = new Promise<AllocRuleDTO[]>(res => { resolveRules = res })
    vi.mocked(allocApi.rules).mockReturnValueOnce(pending)
    useBillingPeriodStore().pick(2025, 3)
    const w = mount(PoolLedgerView, { attachTo: document.body })
    await flushPromises()
    await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
    await flushPromises()
    await w.findAll('button').find(b => b.text().includes('新增池'))!.trigger('click')
    await flushPromises()
    // FPDrawer 是 Teleport to body:抽屉里的内容不在 w 的渲染子树里,得从真实 DOM 找
    // (同文件①用 document.querySelector('.fp-dwr-backdrop') 同一手法)。
    const saveBtn = () => Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent?.includes('保存')) as HTMLButtonElement
    // production 删掉 rulesLoading 守卫(只留 rulesFailed)→ 还在飞的窗口里两者都是 false → 这里未禁用 → 红
    expect(saveBtn()?.disabled, '前置:rules 还没落地,保存必须禁用').toBe(true)
    expect(document.body.textContent).toContain('正在载入')
    resolveRules([])
    await flushPromises()
    expect(saveBtn()?.disabled, 'rules 落地后按钮应自动可用').toBe(false)
    w.unmount()
  })
})
