import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useEditMode } from '@/composables/useEditMode'
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

  it('不上锁的屏(没传 scope)不受影响 —— 它本来就没有期这回事', async () => {
    asRole(['entry:edit'])
    const m = useEditMode(['entry:edit'])
    await m.toggle()
    await nextTick()
    expect(m.editMode.value).toBe(true)
  })
})
