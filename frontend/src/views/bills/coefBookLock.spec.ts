import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { usePresenceStore } from '@/stores/presence'
import CoefBookWindow from '@/views/bills/CoefBookWindow.vue'
import api from '@/api'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
    put: vi.fn(() => Promise.resolve({ users: [], evicted: null, approvals: [], outcome: null })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))
vi.mock('@/api/params', () => ({ paramsApi: { list: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/api/alloc', () => ({
  allocApi: {
    pools: vi.fn(() => Promise.resolve({ generated: false, rows: [] })),
    rules: vi.fn(() => Promise.resolve([])),
  },
}))

const PERM = 'param-policy:edit'

/**
 * **这份 spec 依赖「今天」,必须钉死。**
 *
 * 组件的生效月默认取当天(`CoefBookWindow.vue:52` `const today = new Date()`,
 * 61-62 行 `effYear/effMonth`),而编辑锁的作用域又是由生效月推出来的
 * (`S.coefBook(effYear, effMonth)`)。不钉的话这三条只在 2026-08 月内是绿的,
 * 进入下个月就整月红,而且**每个月都会再红一次** ——
 * 2026-09-02 系统日期一翻就这么红过。
 *
 * 只假 `Date`,**不假 timers**:下面 `settle()` 靠真的 `setTimeout(r, 0)` 等微任务,
 * 整套 fake timers 会让它永远不 resolve。
 *
 * SCOPE 从 TODAY 推,不再手写 —— 两者手写就一定会再次漂开。
 */
const TODAY = new Date('2026-08-15T09:00:00+08:00')
const YM = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}`
const SCOPE = `billing-chain:${YM}`

type Vm = { editMode: boolean; onEditBtn: () => Promise<void> }

function open() {
  return mount(CoefBookWindow, {
    // ym 是催缴单页的期,与窗口内独立选择的生效月(effYm)本可不同;
    // 这里让它与 TODAY 同月,复现套件写就时(2026-08 月内)的那个状态
    props: { open: true, ym: YM, phase: '2', contracts: [], buildings: [], years: [TODAY.getFullYear()] },
    global: { stubs: { Teleport: true } },
  })
}

/** 等一拍微任务 —— load() 里那三个 await 与 watch 的 flush。 */
const settle = async (w: ReturnType<typeof open>) => {
  await new Promise((r) => setTimeout(r, 0))
  await w.vm.$nextTick()
}

/**
 * 张三:没有本权,靠主管授权进来的。「结束授权」要能把他踢出去。
 *
 * ⚠ 不能直接写 `auth.grants = [...]` —— store 对外导出的是 `grants: liveGrants`,
 *   一个只读 computed(auth.ts:216)。只能顺着 refreshElevation() 从服务端灌进去,
 *   它也正是远程授权那条路真实走的入口。
 */
async function elevatedIn() {
  const auth = useAuthStore()
  auth.permissions = ['elevate:request']
  vi.mocked(api.get).mockResolvedValueOnce([{
    perm: PERM, permLabel: '计费口径', authorizer: 'admin',
    authorizerName: '周明', expiresAt: Date.now() + 1_800_000,
  }] as never)
  await auth.refreshElevation()
  return auth
}

describe('系数簿 · 编辑态的被动退出', () => {
  beforeEach(() => {
    // 只假 Date(见 TODAY 处的说明);组件在 setup 里读 new Date(),所以必须在 mount 之前设
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
    localStorage.clear(); sessionStorage.clear()
    localStorage.setItem('token', 'test-token')
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => { vi.useRealTimers() })

  it('点「结束授权」→ 退出编辑态并还锁', async () => {
    // 用户报的就是这条(2026-08-26):
    // 「张三退出催缴单的系数簿编辑模式后,别的账号依旧保持编辑中,侧边栏也在红点显示」
    // —— 他走的是横幅上的「结束授权」(App.vue → auth.endElevation(true))。
    //
    // 根因:EDIT-MODE-SPEC v4 铁律①「进得了编辑模式 ⇒ 本页权限一定齐」
    // 只在 useEditMode 里实现过一次(那份 watch([editMode, missing]))。
    // 系数簿不走 useEditMode,canEdit 只是个 computed、没有任何 watcher ——
    // 于是授权没了,editMode 还停在 true,锁还被那条 3 秒 ping 一直续着,
    // 连 3 分钟心跳自愈都等不到。
    const auth = await elevatedIn()
    const w = open()
    await settle(w)

    await (w.vm as unknown as Vm).onEditBtn()
    expect(api.post, '先得真占到锁').toHaveBeenCalledWith(`/locks/${SCOPE}`)
    expect((w.vm as unknown as Vm).editMode).toBe(true)

    await auth.endElevation(true)
    await settle(w)

    expect((w.vm as unknown as Vm).editMode, '授权没了就不许还留在编辑态').toBe(false)
    expect(api.delete, '锁必须当场还回去').toHaveBeenCalledWith(`/locks/${SCOPE}`)
  })

  it('结束授权后在场状态要翻回 view —— 否则别人的按钮一直挂着「张三 编辑中」', async () => {
    // 按钮与侧栏红点都读**在场表**,不读锁本身。
    // 锁还了但 mode 还停在 edit,别人看到的依旧是「有人在编辑」。
    const auth = await elevatedIn()
    const w = open()
    await settle(w)
    const presence = usePresenceStore()

    await (w.vm as unknown as Vm).onEditBtn()
    await presence.ping()
    // mode 已不由客户端申报(服务端从 editScopes 派生)—— 同一语义现在看锁列表
    expect(api.put).toHaveBeenLastCalledWith('/presence/ping',
      expect.objectContaining({ editScopes: [SCOPE] }))

    await auth.endElevation(true)
    await settle(w)
    await presence.ping()

    expect(api.put).toHaveBeenLastCalledWith('/presence/ping',
      expect.objectContaining({ editScopes: [] }))
  })

  it('关掉窗口也要还锁', async () => {
    // 顺手查出来的第二个洞(不是用户报的那条,但同一个根:本窗口没有任何被动退出路径)。
    // CoefBookWindow 是 `<CoefBookWindow :open="coefOpen">` —— **永远挂载着**,只切 open。
    // 而那个重置 watcher 第一行是 `if (!o) return`,只在**开窗**时跑;
    // 关窗时 editMode 停在 true,watch(editMode) 不触发,release() 从没跑过。
    useAuthStore().permissions = [PERM]
    const w = open()
    await settle(w)

    await (w.vm as unknown as Vm).onEditBtn()
    expect((w.vm as unknown as Vm).editMode).toBe(true)

    await w.setProps({ open: false })
    await settle(w)

    expect(api.delete, '关窗就得还锁').toHaveBeenCalledWith(`/locks/${SCOPE}`)
  })
})

describe('系数簿 · 被接管时暂存导 TSV', () => {
  it('❗stash(租户→新值/清除)一行一条,带键名与生效月', async () => {
    useAuthStore().permissions = [PERM]
    const w = open()
    await settle(w)
    const vm = w.vm as unknown as {
      stash: Map<number, number | null>
      stashAsTsv: () => string
    }
    vm.stash.set(5, 1.2)
    vm.stash.set(7, null)

    const tsv = vm.stashAsTsv()
    const lines = tsv.split('\n')
    expect(lines.length, '表头 + 两条暂存').toBe(3)
    expect(tsv).toContain('1.2')
    expect(tsv).toContain('(清除,回默认)')
    expect(lines[0]).toContain('生效起')
  })

  it('❗序列化器真的绑在被接管弹窗上', () => {
    const src = readFileSync(join(__dirname, 'CoefBookWindow.vue'), 'utf8')
    expect(src.includes(':copy-text="stashAsTsv"'), '弹窗断线,被踢的人拿不到复制的路').toBe(true)
    expect(src.includes(':dirty-count="stash.size"')).toBe(true)
  })
})
