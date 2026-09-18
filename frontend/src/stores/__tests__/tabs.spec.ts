// 页签模型(TAB-BAR-SPEC §1 §2):用法和 Chrome 一样。
// 每条用例对应规范 §2 表里的一行;「❗」开头的做过破坏验证。
// 时序:调用方 open / openDeep / newTab 只**登记**这一跳开在哪,导航落定(router.afterEach → commit)才动页签条。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore, HOME, NEWTAB, tabMeta } from '../tabs'
import { useAuthStore } from '@/stores/auth'
import { _resetViewportForTest } from '@/composables/useViewport'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

type S = ReturnType<typeof useTabsStore>
/** 这一屏有东西进了编辑态(auth 登记表,和 useEditMode 等登记点同一个入口)。返回退出函数。 */
function editOn(screen: string): () => void {
  const auth = useAuthStore()
  const id = Symbol(screen)
  auth.openEditor(id, screen)
  return () => auth.closeEditor(id)
}
const vals = (s: S) => s.tabs.map(t => t.value)
/** 模拟 router:beforeEach(beforeNav)→ 导航落定 → afterEach(先 commit 再 setActive)。 */
function land(s: S, v: string, pop = false) {
  s.beforeNav(v, pop)
  s.commit(v)
  s.setActive(v)
}
/** 调用方先登记再 push,导航随即落定。 */
function go(s: S, v: string, opts?: { pin?: boolean }) {
  s.open(v, opts)
  land(s, v)
}

describe('页签模型 · 首页', () => {
  it('❗初始只有首页一格,且固定', () => {
    const s = useTabsStore()
    expect(s.tabs).toEqual([{ value: HOME, pinned: true }])
  })

  it('❗首页关不掉、取消不了固定、拖不动', () => {
    const s = useTabsStore()
    land(s, 'ledger')
    expect(s.close(HOME)).toBeNull()
    s.unpin(HOME)
    s.move(0, 1)
    expect(s.tabs[0]).toEqual({ value: HOME, pinned: true })
  })

  it('读本地存储时首页补在最前、固定的排前面、认不得的丢掉;旧预览槽键被删', () => {
    useAuthStore().me = 'zs'
    localStorage.setItem('fp-app-tabs:zs', JSON.stringify(['data-home', 'ledger', 'not-a-route', 'tenants', 'ledger']))
    localStorage.setItem('fp-app-pinned:zs', JSON.stringify(['tenants']))
    localStorage.setItem('fp-app-preview', 'contracts')
    const s = useTabsStore()
    expect(s.tabs).toEqual([
      { value: HOME, pinned: true }, { value: 'tenants', pinned: true }, { value: 'data-home' }, { value: 'ledger' },
    ])
    expect(localStorage.getItem('fp-app-preview')).toBeNull()
  })

  it('❗页签与固定按人写回本地存储(fp-app-tabs:<username>);不写不分人的旧键', async () => {
    useAuthStore().me = 'zs'
    const s = useTabsStore()
    s.openBackground('ledger')
    s.openBackground('tenants')
    s.pin('tenants')
    await nextTick()
    expect(JSON.parse(localStorage.getItem('fp-app-tabs:zs')!)).toEqual([HOME, 'tenants', 'ledger'])
    expect(JSON.parse(localStorage.getItem('fp-app-pinned:zs')!)).toEqual([HOME, 'tenants'])
    expect(localStorage.getItem('fp-app-tabs')).toBeNull()
  })

  it('❗别人的页签读不到:浏览器另一个标签页里的旧身份写的是他自己的键', () => {
    localStorage.setItem('fp-app-tabs:ls', JSON.stringify(['ledger']))
    useAuthStore().me = 'zs'
    expect(useTabsStore().tabs).toEqual([{ value: HOME, pinned: true }])
  })

  it('改版前不分人的旧键:读一次当成这个人的,读完删掉', () => {
    localStorage.setItem('fp-app-tabs', JSON.stringify(['ledger']))
    useAuthStore().me = 'zs'
    expect(useTabsStore().tabs.map(t => t.value)).toEqual([HOME, 'ledger'])
    expect(localStorage.getItem('fp-app-tabs')).toBeNull()
  })

  it('tabMeta:导航屏走导航表,首页 / 新标签页走附加表', () => {
    expect(tabMeta('ledger')?.page).toBe('月度台账')
    expect(tabMeta(HOME)).toEqual({ page: '首页', icon: 'home' })
    expect(tabMeta(NEWTAB)?.page).toBe('新标签页')
    expect(tabMeta('nope')).toBeUndefined()
  })
})

describe('页签模型 · 点哪开在哪(§2)', () => {
  it('❗在当前页签打开:当前那一格换成新屏,位置不变', () => {
    const s = useTabsStore()
    s.openBackground('ledger')
    s.openBackground('tenants')
    land(s, 'ledger')
    go(s, 'contracts')                     // 在台账那一格上点左边导航
    expect(vals(s)).toEqual([HOME, 'contracts', 'tenants'])
  })

  it('❗导航没落地(取消 / 失败 / 被守卫踢走),页签条一格不动;登记也作废', () => {
    const s = useTabsStore()
    land(s, 'ledger')
    s.open('tenants')                      // 登记了,但导航被取消
    s.clearIntent()
    expect(vals(s)).toEqual([HOME, 'ledger'])
    s.open('contracts', { pin: true })     // 被守卫踢回首页:落地的是 home,不是 contracts
    land(s, HOME)
    expect(vals(s)).toEqual([HOME, 'ledger'])
  })

  it('❗连点两下(第一跳被第二跳取消):只有落地的那一跳换掉当前页签,不留幽灵页签', () => {
    const s = useTabsStore()
    land(s, 'ledger')
    s.open('tenants')                      // 第一跳:chunk 还没到
    s.open('contracts')                    // 第二跳把它取消
    land(s, 'contracts')
    expect(vals(s)).toEqual([HOME, 'contracts'])
  })

  it('❗当前页签是首页 → 开在最右边的新页签,首页不被换掉', () => {
    const s = useTabsStore()
    s.openBackground('tenants')
    land(s, HOME)
    go(s, 'ledger')
    expect(vals(s)).toEqual([HOME, 'tenants', 'ledger'])
  })

  it('❗当前这屏我正在编辑 → 开在最右边的新页签,不换掉正在编辑的页面', () => {
    const s = useTabsStore()
    land(s, HOME)
    go(s, 'ledger')
    editOn('ledger')
    go(s, 'tenants')
    expect(vals(s)).toEqual([HOME, 'ledger', 'tenants'])
    // 判的是**当前页签那一屏**:不在编辑的屏照常被换掉
    go(s, 'contracts')
    expect(vals(s)).toEqual([HOME, 'ledger', 'contracts'])
  })

  it('❗编辑登记在别的屏不算:出账链三屏共用一把锁,计费参数在编辑时公共电核算照常被换掉', () => {
    const s = useTabsStore()
    s.openBackground('params')
    land(s, HOME)
    go(s, 'alloc')
    editOn('params')
    go(s, 'bill-notices')
    expect(vals(s)).toEqual([HOME, 'params', 'bill-notices'])
  })

  it('❗编辑态退出后就不算了', () => {
    const s = useTabsStore()
    land(s, HOME)
    go(s, 'ledger')
    const exit = editOn('ledger')
    exit()
    go(s, 'tenants')
    expect(vals(s)).toEqual([HOME, 'tenants'])
  })

  it('❗被换下去的屏当场卸载(纪元 +1),和关掉一样;上下文一并清掉', () => {
    const s = useTabsStore()
    land(s, HOME)
    go(s, 'ledger')
    s.setCtx('ledger', { p: '2025-06' })
    go(s, 'tenants')
    expect(s.epochOf('ledger')).toBe(1)
    expect(s.ctx.ledger).toBeUndefined()
    expect(s.epochOf('tenants')).toBe(0)
  })

  it('要打开的屏已经开着 → 不动页签,只是切过去', () => {
    const s = useTabsStore()
    s.openBackground('ledger')
    s.openBackground('tenants')
    land(s, 'tenants')
    go(s, 'ledger')
    expect(vals(s)).toEqual([HOME, 'ledger', 'tenants'])
  })

  it('换掉的是固定页签那一格时,新屏继承固定', () => {
    const s = useTabsStore()
    s.openBackground('ledger')
    s.pin('ledger')
    land(s, 'ledger')
    go(s, 'tenants')
    expect(s.tabs).toEqual([{ value: HOME, pinned: true }, { value: 'tenants', pinned: true }])
  })

  it('当前页签不在列表里(刚登录、手打地址)→ 追加到最右边', () => {
    const s = useTabsStore()
    land(s, 'ledger')
    expect(vals(s)).toEqual([HOME, 'ledger'])
  })

  it('❗pin:true(页面里的链接)→ 紧挨当前页签右边,来源不被换掉', () => {
    const s = useTabsStore()
    s.openBackground('cockpit')
    s.openBackground('ledger')
    land(s, 'cockpit')
    go(s, 'tenant-peer', { pin: true })
    expect(vals(s)).toEqual([HOME, 'cockpit', 'tenant-peer', 'ledger'])
  })

  it('❗内容区里点出来、没人登记的裸跳 = 页面里的链接,开在右边;显式登记盖过它', () => {
    vi.useFakeTimers()
    const s = useTabsStore()
    s.openBackground('ledger')
    land(s, 'cockpit')                     // [首页, 台账, 驾驶舱]
    s.markInPage()
    land(s, 'anomaly')                     // 驾驶舱「进入监控中心」:裸 push
    expect(vals(s)).toEqual([HOME, 'ledger', 'cockpit', 'anomaly'])
    s.markInPage()
    s.open('meters')                       // 出账步骤条:显式在当前页签走
    land(s, 'meters')
    expect(vals(s)).toEqual([HOME, 'ledger', 'cockpit', 'meters'])
    vi.advanceTimersByTime(0)              // 标记只在这一轮宏任务里有效
    land(s, 'params')
    expect(vals(s)).toEqual([HOME, 'ledger', 'cockpit', 'params'])
    vi.useRealTimers()
  })

  it('❗浏览器后退 / 前进到一个已关掉的屏:开在右边,不把正看着的那一格换掉', () => {
    const s = useTabsStore()
    for (const v of ['tenants', 'contracts']) s.openBackground(v)
    land(s, 'contracts')
    land(s, 'tenants')
    s.close('contracts')
    land(s, 'contracts', true)             // 后退
    expect(vals(s)).toEqual([HOME, 'tenants', 'contracts'])
  })

  it('❗openDeep:全新实例 + 紧挨来源右边;连跳两次谁都不被换掉', () => {
    const s = useTabsStore()
    land(s, 'cockpit')
    s.openDeep('sales-income')
    land(s, 'sales-income')
    s.openDeep('ledger')
    land(s, 'ledger')
    expect(vals(s)).toEqual([HOME, 'cockpit', 'sales-income', 'ledger'])
    expect(s.epochOf('ledger')).toBe(1)
  })

  it('openDeep 到已开着的屏:只换新实例,不多开一格', () => {
    const s = useTabsStore()
    land(s, 'ledger')
    s.openDeep('ledger')
    land(s, 'ledger')
    expect(vals(s)).toEqual([HOME, 'ledger'])
    expect(s.epochOf('ledger')).toBe(1)
  })

  it('❗openDeep / openFresh 到我正在编辑的屏:不换新实例(没保存的改动不能被冲掉),只切过去', () => {
    const s = useTabsStore()
    land(s, 'ledger')
    editOn('ledger')
    s.openDeep('ledger')
    s.openFresh('ledger')
    expect(s.epochOf('ledger')).toBe(0)
  })

  it('紧挨右边也不插进固定区', () => {
    const s = useTabsStore()
    land(s, HOME)
    go(s, 'ledger', { pin: true })
    s.openBackground('tenants')
    s.pin('tenants')
    expect(vals(s)).toEqual([HOME, 'tenants', 'ledger'])
    land(s, HOME)
    go(s, 'contracts', { pin: true })
    expect(vals(s)).toEqual([HOME, 'tenants', 'contracts', 'ledger'])
  })

  it('❗Ctrl / 中键(openBackground):立刻放最右边,不动当前页签', () => {
    const s = useTabsStore()
    land(s, 'ledger')
    s.openBackground('tenants')
    expect(vals(s)).toEqual([HOME, 'ledger', 'tenants'])
    expect(s.active).toBe('ledger')
    s.openBackground(HOME)          // 首页 / 新标签页 / 认不得的都不收
    s.openBackground(NEWTAB)
    s.openBackground('not-a-route')
    expect(vals(s)).toEqual([HOME, 'ledger', 'tenants'])
  })

  it('在新标签页上点一页 → 这一格变成那一页', () => {
    const s = useTabsStore()
    land(s, 'ledger')
    s.newTab()
    land(s, NEWTAB)
    go(s, 'tenants')
    expect(vals(s)).toEqual([HOME, 'ledger', 'tenants'])
  })
})

describe('页签模型 · 新标签页', () => {
  it('❗+ 放最右边;同时最多一个', () => {
    const s = useTabsStore()
    land(s, 'ledger')
    s.newTab()
    land(s, NEWTAB)
    land(s, 'ledger')
    s.newTab()
    land(s, NEWTAB)
    expect(vals(s)).toEqual([HOME, 'ledger', NEWTAB])
  })

  it('右键「在右侧新建页签」插在那一格右边', () => {
    const s = useTabsStore()
    s.openBackground('ledger')
    s.openBackground('tenants')
    s.newTab('ledger')
    land(s, NEWTAB)
    expect(vals(s)).toEqual([HOME, 'ledger', NEWTAB, 'tenants'])
  })
})

describe('页签模型 · 关闭', () => {
  it('❗关掉的若是当前页签:返回右边那格,没有就左边那格', () => {
    const s = useTabsStore()
    for (const v of ['ledger', 'tenants', 'contracts']) s.openBackground(v)
    expect(s.close('tenants')).toBe('contracts')
    expect(s.close('contracts')).toBe('ledger')
    expect(s.close('ledger')).toBe(HOME)
    expect(vals(s)).toEqual([HOME])
  })

  it('关掉的记进「最近关闭」,重新打开放最右边', () => {
    const s = useTabsStore()
    s.openBackground('ledger')
    s.openBackground('tenants')
    s.close('ledger')
    expect(s.closed).toEqual(['ledger'])
    expect(s.reopenClosed()).toBe('ledger')
    land(s, 'ledger')
    expect(vals(s)).toEqual([HOME, 'tenants', 'ledger'])
    expect(s.reopenClosed()).toBeNull()
  })

  it('关闭其他 / 关闭右侧:不关固定的', () => {
    const s = useTabsStore()
    for (const v of ['ledger', 'tenants', 'contracts', 'meters']) s.openBackground(v)
    s.pin('meters')
    expect(s.closeRight('tenants')).toEqual(['contracts'])
    expect(vals(s)).toEqual([HOME, 'meters', 'ledger', 'tenants'])
    expect(s.closeOthers('tenants')).toEqual(['ledger'])
    expect(vals(s)).toEqual([HOME, 'meters', 'tenants'])
  })

  it('close 清 ctx 但不动 epoch(弃状态由调用方导航完成后 dropState)', () => {
    const s = useTabsStore()
    s.openBackground('ledger')
    s.setCtx('ledger', { p: '2025-06' })
    s.close('ledger')
    expect(s.ctx.ledger).toBeUndefined()
    expect(s.epochOf('ledger')).toBe(0)
    s.dropState('ledger')
    expect(s.epochOf('ledger')).toBe(1)
  })
})

describe('页签模型 · 固定与拖动', () => {
  it('固定挪到固定区最后,取消固定挪到普通区最前', () => {
    const s = useTabsStore()
    for (const v of ['ledger', 'tenants', 'contracts']) s.openBackground(v)
    s.pin('contracts')
    expect(vals(s)).toEqual([HOME, 'contracts', 'ledger', 'tenants'])
    s.pin('tenants')
    expect(vals(s)).toEqual([HOME, 'contracts', 'tenants', 'ledger'])
    s.unpin('contracts')
    expect(s.tabs).toEqual([{ value: HOME, pinned: true }, { value: 'tenants', pinned: true }, { value: 'contracts' }, { value: 'ledger' }])
  })

  it('❗拖动只在同一区里换;普通页签拖不进固定区,也拖不到首页前面', () => {
    const s = useTabsStore()
    for (const v of ['ledger', 'tenants', 'contracts']) s.openBackground(v)
    s.pin('ledger')
    s.move(3, 2)                        // contracts ↔ tenants
    expect(vals(s)).toEqual([HOME, 'ledger', 'contracts', 'tenants'])
    s.move(3, 0)                        // 普通页签往首页前面拖 → 停在普通区最前
    expect(vals(s)).toEqual([HOME, 'ledger', 'tenants', 'contracts'])
    s.move(1, 3)                        // 固定页签往普通区拖 → 不动
    expect(vals(s)).toEqual([HOME, 'ledger', 'tenants', 'contracts'])
  })
})

describe('页签模型 · 最近访问 / 上下文 / 换人', () => {
  it('最近访问去重、封顶 8、不收首页与新标签页;只记落了地的', () => {
    const s = useTabsStore()
    const values = ['buildings', 'tenants', 'contracts', 'ledger', 'meters', 'alloc', 'pv-income', 'car-charging', 'ebike-charging']
    for (const v of values) land(s, v)
    land(s, HOME)
    land(s, 'tenants')
    expect(s.recent.length).toBe(8)
    expect(s.recent[0]).toBe('tenants')
    expect(s.recent).not.toContain(HOME)
    expect(new Set(s.recent).size).toBe(s.recent.length)
    s.open('params')                    // 登记了没落地
    expect(s.recent).not.toContain('params')
  })

  it('setCtx 整条替换,空字段不落键;首页与未知 value 不写', () => {
    const s = useTabsStore()
    s.setCtx('ledger', { p: '2025-06', coName: '一期公司' })
    s.setCtx('ledger', { p: '2025-07' })
    expect(s.ctx.ledger).toEqual({ p: '2025-07' })
    s.setCtx(HOME, { p: '2025-01' })
    s.setCtx('not-a-route', { p: '2025-01' })
    expect(s.ctx[HOME]).toBeUndefined()
    expect(s.ctx['not-a-route']).toBeUndefined()
  })

  it('未知 value 的 open / openFresh 什么都不动', () => {
    const s = useTabsStore()
    s.openFresh('not-a-route')
    land(s, 'not-a-route')
    expect(s.epochOf('not-a-route')).toBe(0)
    expect(vals(s)).toEqual([HOME])
  })

  it('❗同一个人过期后重新登录(me 不变):也只剩首页', async () => {
    const auth = useAuthStore()
    auth.me = 'zs'
    const s = useTabsStore()
    land(s, 'ledger')
    s.openBackground('tenants')
    auth.loginSeq++
    await nextTick()
    expect(s.tabs).toEqual([{ value: HOME, pinned: true }])
    expect(s.recent).toEqual([])
  })

  // ❗共享机器上换个人登进来,上一个人的页签、最近访问、最近关闭、epoch、ctx 全要清
  it('❗换人:页签只剩首页,其余全清', async () => {
    const s = useTabsStore()
    const auth = useAuthStore()
    auth.me = 'zhangsan'
    await nextTick()
    land(s, 'ledger')
    s.openBackground('tenants')
    s.close('tenants')
    s.openFresh('ledger')
    s.setCtx('ledger', { p: '2025-06' })
    auth.me = 'lisi'
    await nextTick()
    expect(s.tabs).toEqual([{ value: HOME, pinned: true }])
    expect(s.recent).toEqual([])
    expect(s.closed).toEqual([])
    // epoch 不清(单调增):清零会让登出那一拍前台那屏 key 变回 :0、在跳去登录页前被重挂一遍
    expect(s.epochOf('ledger')).toBe(1)
    expect(s.ctx).toEqual({})
    expect(s.active).toBe('')
  })
})

describe('页签模型 · 手机(S 档没有页签条)', () => {
  const real = window.matchMedia
  beforeEach(() => {
    // S 档:三条 max-width 查询全命中
    ;(window as any).matchMedia = (media: string) => ({
      media, matches: media.startsWith('(max-width'), addEventListener() {}, removeEventListener() {},
    })
    _resetViewportForTest()
  })
  afterEach(() => {
    ;(window as any).matchMedia = real
    _resetViewportForTest()
  })

  it('❗从首页点来点去不累积:只留首页 + 这一页,换掉的卸载', () => {
    const s = useTabsStore()
    land(s, HOME)
    go(s, 'ledger')
    land(s, HOME)
    go(s, 'tenants')
    expect(vals(s)).toEqual([HOME, 'tenants'])
    expect(s.epochOf('ledger')).toBe(1)
  })

  it('❗页面里的链接、后退到关掉的屏也一样换掉,不往右插', () => {
    const s = useTabsStore()
    land(s, HOME)
    go(s, 'ledger')
    go(s, 'tenants', { pin: true })
    land(s, 'contracts', true)
    expect(vals(s)).toEqual([HOME, 'contracts'])
  })

  it('❗回首页(已经开着的那格)也把上一屏清掉', () => {
    const s = useTabsStore()
    land(s, HOME)
    go(s, 'ledger')
    land(s, HOME)
    expect(vals(s)).toEqual([HOME])
    expect(s.epochOf('ledger')).toBe(1)
  })

  it('❗正在编辑的和固定的留着', () => {
    const s = useTabsStore()
    s.openBackground('meters')
    s.pin('meters')
    land(s, HOME)
    go(s, 'ledger')
    editOn('ledger')
    go(s, 'tenants')
    go(s, 'contracts')
    expect(vals(s)).toEqual([HOME, 'meters', 'ledger', 'contracts'])
  })
})
