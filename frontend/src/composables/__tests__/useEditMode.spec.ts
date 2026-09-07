import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useEditMode } from '@/composables/useEditMode'
import { useReviewStore } from '@/stores/review'
import api from '@/api'

/** 种一份授权 —— 走真实路径 requestElevation(),而不是往 store 里塞。
 *  grants 对外是只读 computed(提权状态的真身在服务端),塞不进去也不该塞得进去。 */
async function grant(perm: string, label = '计费口径', authorizerName = '王主管', ttlMs = 30 * 60_000) {
  const auth = useAuthStore()
  vi.mocked(api.post).mockResolvedValueOnce([
    { perm, permLabel: label, authorizer: 'boss', authorizerName, expiresAt: Date.now() + ttlMs },
  ] as never)
  await auth.requestElevation([perm], 'boss', 'pw')
}

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve([])),
    delete: vi.fn(() => Promise.resolve()),
  },
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

/** 公共电核算页:同时碰「出账运行」与「计费口径」两档 —— 本文件大部分断言的原型 */
const POOL = ['billing-run:edit', 'param-policy:edit']

function asRole(perms: string[]) {
  const auth = useAuthStore()
  auth.permissions = perms
  return auth
}

describe('编辑模式 × 提权', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    sessionStorage.clear()
    // ⚠ 必须清 mock 调用记录。vi.mock 的 spy 是**模块级**的,记录跨用例累积 ——
    //   不清的话 `expect(api.delete).toHaveBeenCalledWith(...)` 会被前面某个用例的调用喂饱,
    //   于是「退出编辑要结束授权」这条即使被完全删掉也照样绿。
    //   2026-08-22 变异验证抓到:把 exit() 换成裸置 editMode=false,16 条全绿。
    vi.clearAllMocks()
  })

  // ── 按钮画不画 ──

  it('只读账号 / 园区股东:零权限且不能请求提权 → 编辑模式按钮不出现', () => {
    asRole([])                                   // 预置角色 viewer / shareholder 就是这个状态
    const { canEnter } = useEditMode(POOL)
    expect(canEnter.value).toBe(false)
  })

  it('能请求提权的业务账号:一项权限都没有也看得到按钮', () => {
    // 用户拍板 2026-08-22:除只读与股东,其他账号一律「看得见、点得动、点了给出路」。
    // 藏掉入口的话用户只会以为系统没这个功能。
    asRole(['elevate:request'])
    const { canEnter } = useEditMode(POOL)
    expect(canEnter.value).toBe(true)
  })

  // ── 进不进得去 ──

  it('缺任何一项 → 点编辑模式当场弹授权窗(不是进去之后再提示)', () => {
    // 用户拍板 2026-08-22:提示条不够,要把授权窗直接推到脸上,取消/授权二选一。
    asRole(['billing-run:edit', 'elevate:request'])
    const { editMode, asking, toggle } = useEditMode(POOL)
    toggle()
    expect(asking.value).toEqual(['param-policy:edit'])
    expect(editMode.value).toBe(false)          // 还没进,等用户选
  })

  it('⚠ 取消授权 → 留在浏览态,哪怕有一半权限', () => {
    // 用户拍板 2026-08-22:「没通过授权的话依旧是非编辑模式」。
    // 上一版是「有 billing-run 就照常进,param-policy 那半锁着」——
    // 那正是「编辑态里一半控件点不动」的来源,整条作废。
    asRole(['billing-run:edit', 'elevate:request'])
    const { editMode, asking, toggle, cancelAsk } = useEditMode(POOL)
    toggle()
    cancelAsk()
    expect(asking.value).toBeNull()
    expect(editMode.value).toBe(false)
  })

  it('一项都没有 → 弹授权窗;取消后不进(空壳没意义)', () => {
    asRole(['elevate:request'])
    const { editMode, asking, toggle, cancelAsk } = useEditMode(POOL)
    toggle()
    expect(editMode.value).toBe(false)
    expect(asking.value).toEqual(POOL)
    cancelAsk()
    expect(editMode.value).toBe(false)
  })

  it('权限齐全 → 直接进,不打扰', () => {
    asRole(POOL)
    const { editMode, asking, toggle } = useEditMode(POOL)
    toggle()
    expect(editMode.value).toBe(true)
    expect(asking.value).toBeNull()
  })

  // ── 缺哪些 / 点了缺的那个 ──

  it('missing 只列真正改不动的那些', () => {
    asRole(['billing-run:edit'])
    const { missing } = useEditMode(POOL)
    expect(missing.value).toEqual(['param-policy:edit'])
  })

  it('askFor 指定权限点 —— 点哪个控件就只要哪一项', () => {
    asRole(['billing-run:edit', 'elevate:request'])
    const { asking, askFor } = useEditMode(POOL)
    askFor('param-policy:edit')
    expect(asking.value).toEqual(['param-policy:edit'])
  })

  it('askFor 已经有的权限 → 不弹窗(别拿一个已经能做的事去烦主管)', () => {
    asRole(POOL)
    const { asking, askFor } = useEditMode(POOL)
    askFor('billing-run:edit')
    expect(asking.value).toBeNull()
  })

  // ── 提权之后 ──

  it('拿到授权后 missing 变空、编辑模式打开', async () => {
    const auth = asRole(['billing-run:edit', 'elevate:request'])
    const { editMode, missing, onElevated } = useEditMode(POOL)

    await grant('param-policy:edit')
    expect(missing.value).toEqual([])
    expect(auth.can('param-policy:edit')).toBe(true)
    expect(auth.authorizerOf('param-policy:edit')).toBe('王主管')

    onElevated()
    expect(editMode.value).toBe(true)
  })

  it('授权到期 → can() 立刻转回 false(不必等后端 403)', async () => {
    const auth = asRole(['elevate:request'])
    await grant('param-policy:edit', '计费口径', '王主管', -1)   // 发下来就已过期
    expect(auth.can('param-policy:edit')).toBe(false)
    expect(auth.elevationLeftMs).toBe(0)
  })

  it('授权到期 → 自动退出编辑模式(别留一屋子点不动的控件)', async () => {
    // 铁律①「进得了编辑模式 ⇒ 权限齐」的另一半:30 分钟 TTL 常常在人还编着时到点。
    vi.useFakeTimers()
    try {
      asRole(['billing-run:edit', 'elevate:request'])
      await grant('param-policy:edit', '计费口径', '王主管', 2_000)   // 2 秒后到期
      const { editMode, toggle } = useEditMode(POOL)
      toggle()
      await nextTick()
      expect(editMode.value).toBe(true)

      vi.advanceTimersByTime(3_000)        // auth 每秒 tick nowMs → 过期授权掉出 can()
      await nextTick()
      expect(editMode.value).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('深链直接置 editMode 也逃不掉:权限不齐当场弹回浏览态', async () => {
    // PoolLedger 的 ?generate=1、ParamCenter 的 ?edit=1 是绕过 toggle() 直接赋值的。
    // 守卫放在 composable 里就不必指望每个页面各自记得。
    asRole(['billing-run:edit', 'elevate:request'])
    const { editMode } = useEditMode(POOL)
    editMode.value = true
    await nextTick()
    expect(editMode.value).toBe(false)
  })

  it('角色本身有的权限,hasOwn 与 can 一致;提权来的只有 can 认', async () => {
    const auth = asRole(['billing-run:edit'])
    await grant('param-policy:edit')
    expect(auth.hasOwn('billing-run:edit')).toBe(true)
    expect(auth.hasOwn('param-policy:edit')).toBe(false)
    expect(auth.can('param-policy:edit')).toBe(true)
  })

  // ── 退出 ──

  it('⚠ 还有别的页面在编辑态时,退出这一个**不**结束授权', async () => {
    // v3 之后编辑态跨页签存活 —— 两个页面同时在编辑态是常态。
    // 退出其中一个就清授权的话,另一个页面的写入口会在用户改到一半时无声锁回去。
    asRole(['billing-run:edit', 'elevate:request'])
    await grant('param-policy:edit')

    const a = useEditMode(POOL)                  // 授权已补齐 → toggle() 直接进
    const b = useEditMode(['param-policy:edit'])
    a.toggle(); b.editMode.value = true          // b 走深链那条路径(直接赋值)
    await nextTick()

    a.toggle()                                    // 关掉 a,b 还开着
    await nextTick()
    expect(api.delete).not.toHaveBeenCalled()

    b.exit()                                      // 最后一个也关了
    await nextTick()
    expect(api.delete).toHaveBeenCalledWith('/auth/elevate')
  })

  it('横幅上主动点「结束授权」不受「还有编辑页开着」阻拦', async () => {
    const auth = asRole(['billing-run:edit', 'elevate:request'])
    await grant('param-policy:edit')
    const a = useEditMode(POOL)
    a.toggle()
    await nextTick()
    await auth.endElevation(true)               // 用户在横幅上点的那一下
    expect(api.delete).toHaveBeenCalledWith('/auth/elevate')
    expect(auth.can('param-policy:edit')).toBe(false)
  })

  it('退出最后一个编辑模式 = 结束全部授权', async () => {
    asRole(['billing-run:edit', 'elevate:request'])
    await grant('param-policy:edit')      // 补齐后 toggle() 直接进,不弹窗

    const { editMode, toggle } = useEditMode(POOL)
    toggle()
    await nextTick()
    expect(editMode.value).toBe(true)
    toggle()                                   // 点「完成」
    await nextTick()
    expect(editMode.value).toBe(false)
    expect(api.delete).toHaveBeenCalledWith('/auth/elevate')
  })
})

describe('system 权限永远不进 can() 的提权那一侧', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks() })

  it('提权不改变导航判定 —— 因为 system:* 根本发不下来', () => {
    // can('system:view') 是侧栏与路由守卫的判据。把提权并进 can() 之所以安全,
    // 全靠**后端**的不可提权名单:system:* 永远不会出现在 grants 里(ElevationApiIT 钉死)。
    // 前端这一侧是照单全收的 —— 所以这条只断言「没有授权时导航不受影响」,
    // 真正的闸不在这里。写死一个前端黑名单会给人一种双保险的错觉,而它拦不住任何东西。
    const auth = useAuthStore()
    auth.permissions = ['elevate:request', 'billing-run:edit']
    expect(auth.can('system:view')).toBe(false)
    expect(auth.can('system:edit')).toBe(false)
  })
})

describe('编辑模式 × 换期', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  // ── 换期(2026-08-29):作用域一变,旧锁就不该再握着 ──
  //
  // 出账链改造给了「换出账月」一个专门的按钮,这条路比原来的顶栏下拉显眼得多。
  // 但洞是既有的:改前用下拉换年月,editMode 与锁同样原地不动 ——
  // 于是能拿着 3 月的锁去改 5 月,正是 CONCURRENCY-SPEC 要防的那件事。
  // 修在共享的这一处,不在七个调用方各写一遍(漏一个就是一把没人认领的锁)。
  async function enterAt(scope: () => string | null) {
    asRole(['entry:edit'])
    vi.mocked(api.post).mockResolvedValue({ granted: true, holder: null } as never)
    const m = useEditMode(['entry:edit'], { scope })
    await m.toggle()
    return m
  }

  it('❗编辑态下换期 → 自动退出并还锁,不许拿着 3 月的锁改 5 月', async () => {
    const ym = ref('2025-03')
    const m = await enterAt(() => `billing-chain:${ym.value}`)
    expect(m.editMode.value).toBe(true)
    expect(api.post).toHaveBeenCalledWith('/locks/billing-chain:2025-03')

    ym.value = '2025-05'
    await nextTick()
    expect(m.editMode.value, '换期必须退出编辑态').toBe(false)
    expect(api.delete, '旧锁必须还回去(还的是旧的那把)')
      .toHaveBeenCalledWith('/locks/billing-chain:2025-03')
  })

  it('作用域没变就不动 —— 别把无关的重渲当成换期', async () => {
    const ym = ref('2025-03')
    const m = await enterAt(() => `billing-chain:${ym.value}`)
    ym.value = '2025-03'
    await nextTick()
    expect(m.editMode.value).toBe(true)
  })

  it('❗占锁在途时期变了 → 不进编辑态,并把刚拿到的锁还回去', async () => {
    // 占锁是一趟网络往返。这中间用户完全可以换期、或退回选期门。
    // 上面那条 scopeWhileEditing 守卫**看不到这一种**:它的 before 是 null
    // (发起时还没进过编辑态),条件里 `before != null` 当场把它放过去。
    // 后果在带选期门的屏上最狠(光伏分栋抄表/分桩明细/电费成本总览):
    // 退回矩阵后 editMode 仍为真,而唯一的「完成」按钮长在 v-else 的表格页里、已经不渲染
    // —— 锁握着、没有写入口、也没有出口,别人还被挡在外面。
    asRole(['entry:edit'])
    const ym = ref('2025-03')
    let settle!: (v: unknown) => void
    vi.mocked(api.post).mockReturnValueOnce(
      new Promise(r => { settle = r }) as never,
    )
    const m = useEditMode(['entry:edit'], { scope: () => `billing-chain:${ym.value}` })

    const pending = m.toggle()
    ym.value = '2025-05'                      // ← 往返期间换了期
    settle({ granted: true, holder: null })
    await pending

    expect(m.editMode.value, '锁的已经不是他要编的那一期了').toBe(false)
    expect(api.delete, '刚拿到的那把锁要立刻还回去')
      .toHaveBeenCalledWith('/locks/billing-chain:2025-03')
  })

  it('❗占锁在途时不许再发一趟 —— 两趟重叠会互相拆台', async () => {
    // 上一版只做了"回来复核一次期",没挡住重叠。两趟交错结算时(先发的后回,
    // 正是链路抖一下再恢复的常态):迟到的那趟把 useEditLock 里共享的 `held`
    // 覆写回旧 scope、再 start() 一遍,然后复核发现期变了就 release() ——
    // stop() 无条件撤掉键鼠监听、把 handleEviction 置 null、presence 降回 view。
    // 终态:人留在新期的编辑态,而新期那把锁服务端还挂着却再没有心跳,
    // 3 分钟 TTL 一到别人 acquire 直接 granted,两人同改同保存互相整片覆盖,
    // 且接管回调已是 null,这一侧连「你被接管了」都不会弹。
    asRole(['entry:edit'])
    const ym = ref('2025-03')
    const settlers: ((v: unknown) => void)[] = []
    vi.mocked(api.post).mockImplementation(
      () => new Promise(r => { settlers.push(r as (v: unknown) => void) }) as never,
    )
    const m = useEditMode(['entry:edit'], { scope: () => `billing-chain:${ym.value}` })

    const first = m.toggle()          // 第一趟:占 2025-03,卡住
    ym.value = '2025-05'
    const second = m.toggle()         // 第二趟:在途时又点了一下
    expect(settlers, '在途时不该再发一趟 acquire').toHaveLength(1)

    settlers[0]({ granted: true, holder: null })
    await Promise.all([first, second])
    expect(m.editMode.value, '期已经变了,不该进编辑态').toBe(false)
    expect(api.delete, '还的必须是自己占的那把').toHaveBeenCalledWith('/locks/billing-chain:2025-03')
    expect(vi.mocked(api.delete).mock.calls, '只该还一次').toHaveLength(1)
  })

  it('在途那趟结束之后还能再进 —— 别把闸门永久关上', async () => {
    asRole(['entry:edit'])
    let settle!: (v: unknown) => void
    vi.mocked(api.post).mockImplementationOnce(
      () => new Promise(r => { settle = r as (v: unknown) => void }) as never,
    )
    const m = useEditMode(['entry:edit'], { scope: () => 'billing-chain:2025-03' })
    const p1 = m.toggle()
    settle({ granted: true, holder: null })
    await p1
    expect(m.editMode.value).toBe(true)
    m.exit()
    vi.mocked(api.post).mockResolvedValue({ granted: true, holder: null } as never)
    await m.toggle()
    expect(m.editMode.value, 'entering 没复位 → 从此再也进不去').toBe(true)
  })

  it('占锁在途但期没变 → 照常进编辑态(别把正常路径也拦了)', async () => {
    asRole(['entry:edit'])
    let settle!: (v: unknown) => void
    vi.mocked(api.post).mockReturnValueOnce(
      new Promise(r => { settle = r }) as never,
    )
    const m = useEditMode(['entry:edit'], { scope: () => 'billing-chain:2025-03' })
    const pending = m.toggle()
    settle({ granted: true, holder: null })
    await pending
    expect(m.editMode.value).toBe(true)
    expect(api.delete).not.toHaveBeenCalled()
  })

  it('不上锁的屏(没传 scope)不受影响 —— 它本来就没有期这回事', async () => {
    asRole(['entry:edit'])
    const m = useEditMode(['entry:edit'])
    await m.toggle()
    await nextTick()
    expect(m.editMode.value).toBe(true)
  })
})

describe('lockScope / onTaken(接管闭环)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('❗lockScope() 与传入的 opts.scope() 逐字相同 —— 屏不必再写一遍表达式', () => {
    const year = ref(2025)
    const em = useEditMode(['meter-reading:edit'], { scope: () => `pv-meter:${year.value}` })
    expect(em.lockScope()).toBe('pv-meter:2025')
    year.value = 2026
    expect(em.lockScope(), '期变了要跟着变 —— 固化就会去接一把不是本屏握着的锁').toBe('pv-meter:2026')
  })

  it('❗onTaken() 走 enter():占锁往返中期变了 → 还锁且不进编辑态', async () => {
    // 这条守的是「复用 enter() 而不是另写一段 acquire」。另写一段就把换期复核摘掉了。
    asRole(['meter-reading:edit'])
    const year = ref(2025)
    const em = useEditMode(['meter-reading:edit'], { scope: () => `pv-meter:${year.value}` })
    vi.mocked(api.post).mockImplementation(async () => {
      year.value = 2026                      // 往返途中用户换了期
      return { granted: true, holder: null, acquiredAt: 1 } as never
    })
    await em.onTaken()
    expect(em.editMode.value, '期已经变了,不该留在编辑态').toBe(false)
    expect(api.delete, '刚拿到的那把锁要还回去').toHaveBeenCalledWith('/locks/pv-meter:2025?t=1')
  })
})

// ══════════ 审核闸(SIDEBAR-UX-REDESIGN §7.5,R2 T2) ══════════

/** 让 /review 回一行指定态,其余端点照常回 []。 */
function seedReview(status: string, extra: Record<string, unknown> = {}) {
  vi.mocked(api.get).mockImplementation((url: string) =>
    url === '/review'
      ? Promise.resolve([{
          key: 'salary:2025-03', kind: 'salary', scope: null, status,
          submittedBy: '张三', submittedAt: '2025-03-04T09:00:00',
          reviewedBy: '李审', reviewedAt: '2025-03-05T10:00:00',
          reason: null, blockedBy: [], ...extra,
        }] as never)
      : (Promise.resolve([]) as never),
  )
}

const SALARY = { reviewKey: () => 'salary:2025-03' }

describe('审核闸(第二道:权限 → 审核态 → 锁)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
    vi.mocked(api.get).mockImplementation(() => Promise.resolve([]) as never)
  })

  // 破坏验证:删掉 enter()/toggle() 里那两处 `if (reviewBlock.value) return` → 红
  it('❗已审核的表进不了编辑模式', async () => {
    asRole(['entry:edit'])
    seedReview('approved')
    const m = useEditMode(['entry:edit'], SALARY)
    await m.toggle()
    await nextTick()
    expect(m.editMode.value, '已审核 = 谁都改不了(§7.3)').toBe(false)
    expect(m.reviewNote.value).toBe('已审核 · 李审 03-05')
  })

  // 破坏验证:把 types/review.ts 的 LOCKING 改成只含 'approved' → 红
  it('❗待审核也锁(D17)', async () => {
    asRole(['entry:edit'])
    seedReview('submitted')
    const m = useEditMode(['entry:edit'], SALARY)
    await m.toggle()
    await nextTick()
    expect(m.editMode.value).toBe(false)
    expect(m.reviewNote.value).toBe('待审核 · 已交审')
  })

  // 破坏验证:把 'returned' 加进 LOCKING → 红
  it('❗已退回可以改 —— returned 只是留痕,可编辑性等同录入中(§7.2)', async () => {
    asRole(['entry:edit'])
    seedReview('returned')
    const m = useEditMode(['entry:edit'], SALARY)
    await m.toggle()
    await nextTick()
    expect(m.editMode.value, '退回就是要他改完再交,拦了他改什么').toBe(true)
    expect(m.reviewNote.value, '可编辑就不该出药丸').toBeNull()
  })

  // ❗这两条是「闸装在 enter() 不装在 toggle()」的证据(计划 D-R2-1)。
  //
  // ⚠ 只断言 editMode 为假是**假绿**:enter() 的闸删掉之后,下面那个深链守卫照样会把人
  //   拉出来,最终态一模一样。差别在中间那一下 —— 没有 enter() 闸时,人先去服务端**占了
  //   一把锁**再被踢出来:一张已审核的表上凭空多一次 acquire/release,别人那一瞬看到的是
  //   「有人正在编辑」。所以断言点是「有没有发出这趟占锁」。
  const lockPosts = () =>
    vi.mocked(api.post).mock.calls.filter(c => String(c[0]).startsWith('/locks'))

  it('❗叫主管授权进来的人照样进不去,且不去占锁 —— 闸在 enter() 不在 toggle()', async () => {
    asRole([])                       // 一档权限都没有,只能请求提权
    seedReview('approved')
    const m = useEditMode(['entry:edit'], { ...SALARY, scope: () => 'sched:salary:2025' })
    await grant('entry:edit')        // 主管当场批了
    await m.onElevated()             // 授权成功的回调
    await nextTick()
    expect(m.editMode.value, '权限齐 ≠ 进得去:审核态是另一道闸').toBe(false)
    expect(lockPosts(), '已审核的表上不该出现一次 acquire').toHaveLength(0)
  })

  // 同上一条同源:接管拿到的是锁,不是改已审核表的资格。
  it('❗接管成功也进不去,且不去重占锁', async () => {
    asRole(['entry:edit'])
    seedReview('approved')
    const m = useEditMode(['entry:edit'], { ...SALARY, scope: () => 'sched:salary:2025' })
    await m.onTaken()
    await nextTick()
    expect(m.editMode.value).toBe(false)
    expect(lockPosts(), '接管回来直接被审核态挡住,不该再 acquire 一次').toHaveLength(0)
  })

  // 破坏验证:从 watch 的依赖数组里删掉 reviewBlockWhileEditing → 红
  it('❗深链绕过 toggle 直接进了编辑态,审核态一到就把人拉出来', async () => {
    asRole(['entry:edit'])
    const m = useEditMode(['entry:edit'], SALARY)
    m.editMode.value = true                    // ?edit=1 / ?generate=1 那条路
    await nextTick()
    expect(m.editMode.value, '审核态还没到,不该误伤').toBe(true)

    // 别人在另一个浏览器审了,本屏下一次重取才看得到 —— store 按月缓存,
    // 不失效的话 ensure 直接命中旧的空结果(这一步漏了会得到一条永远绿的假断言)。
    seedReview('approved')
    const rs = useReviewStore()
    rs.invalidate('2025-03')
    await rs.ensure('2025-03')
    await nextTick()
    expect(m.editMode.value, '在编辑态里被审了 → 立刻退出').toBe(false)
  })

  // 破坏验证:把 toggle() 里的审核闸挪到 missing 判断之后 → 红
  it('❗已审核时不弹提权窗 —— 别让人白叫一次主管', async () => {
    asRole([])                       // 缺权限,平时点了会弹授权窗
    seedReview('approved')
    const m = useEditMode(['entry:edit'], SALARY)
    await m.toggle()
    expect(m.asking.value, '§7.5:elevate:request 弹窗不出现').toBeNull()
  })

  // 破坏验证:把 reviewBlock 里那句 isFailed 判断删掉 → 红
  it('❗审核态拉失败要保守 —— 放行等于让人录完二十行再吃一个 423', async () => {
    asRole(['entry:edit'])
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/review' ? (Promise.reject(new Error('boom')) as never) : (Promise.resolve([]) as never))
    const m = useEditMode(['entry:edit'], SALARY)
    await m.toggle()
    await nextTick()
    expect(m.editMode.value).toBe(false)
    expect(m.reviewNote.value).toBe('审核态未知')
  })

  // 破坏验证:把 enter()/toggle() 里的 `if (rk)` 改成无条件 ensure → 红
  it('❗不传 reviewKey 的屏一个字不改 —— 不打网络也不挡', async () => {
    asRole(['entry:edit'])
    const m = useEditMode(['entry:edit'])
    await m.toggle()
    await nextTick()
    expect(m.editMode.value).toBe(true)
    expect(m.reviewNote.value).toBeNull()
    expect(vi.mocked(api.get).mock.calls.filter(c => c[0] === '/review'),
           '没有审核键就不该去问审核态').toHaveLength(0)
  })
})
