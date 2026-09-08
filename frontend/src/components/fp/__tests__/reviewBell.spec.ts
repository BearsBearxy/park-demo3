// 铃铛计数与通知抽屉的审核两段(SIDEBAR-UX-REDESIGN §7.4 通知行,R2 T8/T9)。
//
// 顶栏红点是**三件事的总和**:等我批的授权 + 等我审的键 + 我交的表被退回。
// 分成三个红点会让顶栏出现三个几乎一样的点,没人分得清哪个是哪个;
// 分段列出来在抽屉里 —— 那里有地方写清楚是哪一件。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePresenceStore } from '@/stores/presence'
import FPApprovalDrawer from '@/components/fp/FPApprovalDrawer.vue'
import { reviewApi } from '@/api/review'

vi.mock('@/api/review', () => ({ reviewApi: { pending: vi.fn(() => Promise.resolve([])) } }))

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve([])),
    put: vi.fn(() => Promise.resolve({ users: [], evictions: [], approvals: [], outcome: null })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 't'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

/**
 * ⚠ FPSideDrawer 是 Teleport to body,`w.text()` 拿不到内容(实测是空串,不是「没渲染」)。
 *   所以断言走 document.body,按钮也从那里找。
 */
async function drawerWith(pendingReviews: number, myReturned: number) {
  const p = usePresenceStore()
  p.pendingReviews = pendingReviews
  p.myReturned = myReturned
  const w = mount(FPApprovalDrawer, { props: { open: true } })
  await flushPromises()
  return {
    w,
    text: () => document.body.textContent ?? '',
    button: (label: string) =>
      [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === label),
  }
}

describe('通知抽屉的审核两段(R2 T8/T9)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    document.body.innerHTML = ''    // Teleport 的残留会让上一条的文本污染下一条
  })

  // 破坏验证:把标题改回 `待批授权 ${pending.length}` → 红
  it('❗抽屉标题数的是三件事的总和,不只是待批授权', async () => {
    const d = await drawerWith(3, 2)
    expect(d.text()).toContain('通知 5')
  })

  // 破坏验证:把「有 N 张表等你审」那段删掉 → 红
  it('❗有待审时出「去审核」,点了跳首页并关抽屉', async () => {
    const d = await drawerWith(3, 0)
    expect(d.text()).toContain('有 3 张表等你审')
    d.button('去审核')!.click()
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/data-home')
    expect(d.w.emitted('close'), '跳走了就该关掉浮层').toBeTruthy()
  })

  // 破坏验证:把「被退回」那段删掉 → 红。
  // 这一段是 R2 唯一给**录入方**的提醒 —— 没有它,被退回的人要自己想起来去首页看。
  it('❗被退回时出提醒,点了也去首页', async () => {
    const d = await drawerWith(0, 2)
    expect(d.text()).toContain('你交的 2 张表被退回了')
    d.button('去看看')!.click()
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/data-home')
  })

  // 破坏验证:把两段的 v-if 去掉 → 红。抽屉里的空段落只会让人多滚一屏
  // (与主管条那种「32px 定高常驻」不是一回事 —— 那是顶栏的条,这是浮层里的段)。
  it('❗零条时两段都不渲染', async () => {
    const d = await drawerWith(0, 0)
    expect(d.text()).not.toContain('等你审')
    expect(d.text()).not.toContain('被退回')
    expect(d.text()).toContain('通知 0')
  })
})


// ══════════ 待审明细(2026-09-08) ══════════
//
// 用户实测原话:「右上角依旧只有『有 1 张表等你审』的提示,没有指明什么文件待审」。
// 改前那句话后面跟的「去审核」推的是不带期的裸 /data-home,首页落在它自己锚定的月上 ——
// 待审的键不在那个月时,人点进去看到的是「暂无待审」,只能自己在年份条上逐月翻。
describe('通知抽屉列出待审明细', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  const ITEMS = [
    { key: 'ledger:3:2024-02', kind: 'ledger', scope: '3', period: '2024-02',
      label: '2024-02 月度台账 · 公司 3', submittedBy: '张三', submittedAt: null },
    { key: 'salary:2024-05', kind: 'salary', scope: null, period: '2024-05',
      label: '2024-05 附表12', submittedBy: '李四', submittedAt: null },
  ]

  async function open(n = 2) {
    vi.mocked(reviewApi.pending).mockResolvedValue(ITEMS as never)
    const p = usePresenceStore()
    p.pendingReviews = n
    const w = mount(FPApprovalDrawer, { props: { open: true } })
    await flushPromises()
    return w
  }

  // ❗破坏验证:把模板里那段 ap-rvlist 删掉 → 红。这一条就是用户报的那个问题本身。
  it('❗不只给个数,把哪几张表列出来', async () => {
    await open()
    const txt = document.body.textContent ?? ''
    expect(txt).toContain('有 2 张表等你审')
    expect(txt, '要写明是哪几张').toContain('2024-02 月度台账 · 公司 3')
    expect(txt).toContain('2024-05 附表12')
    expect(txt, '谁交的也要写 —— 有疑问知道找谁').toContain('张三')
  })

  // ❗破坏验证:把 goItem 里的 periodLink 换成裸 '/data-home' → 红。
  //   这是「点进去还得自己翻月份」的根因:待审的键分散在好几个月,首页只锚一个。
  it('❗点一条直达那张表所在的屏与月,不是把人扔回首页', async () => {
    const w = await open()
    const item = [...document.body.querySelectorAll('.ap-rvitem')]
      .find(b => b.textContent?.includes('月度台账'))!
    ;(item as HTMLElement).click()
    await flushPromises()
    const arg = push.mock.calls.at(-1)![0]
    expect(String(JSON.stringify(arg)), '要带上月份').toContain('2024-02')
    expect(String(JSON.stringify(arg)), '台账还要带上是哪家公司').toContain('3')
    expect(w.emitted('close'), '跳走了就该关掉浮层').toBeTruthy()
  })

  // 明细取不到不能把整段藏起来 —— 数字才是那句「有事等你」,明细是锦上添花。
  it('明细取不到时,退回改前的样子(只有个数 + 一个去处)', async () => {
    vi.mocked(reviewApi.pending).mockRejectedValue(new Error('boom'))
    const p = usePresenceStore()
    p.pendingReviews = 1
    mount(FPApprovalDrawer, { props: { open: true } })
    await flushPromises()
    expect(document.body.textContent).toContain('有 1 张表等你审')
    expect(document.body.querySelectorAll('.ap-rvitem')).toHaveLength(0)
  })

  // 没有待审就不打这一趟 —— 抽屉是给「待批授权」用的,审核那段零条时整段不渲染。
  it('零待审时不去取明细', async () => {
    const p = usePresenceStore()
    p.pendingReviews = 0
    mount(FPApprovalDrawer, { props: { open: true } })
    await flushPromises()
    expect(reviewApi.pending).not.toHaveBeenCalled()
  })
})
