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
