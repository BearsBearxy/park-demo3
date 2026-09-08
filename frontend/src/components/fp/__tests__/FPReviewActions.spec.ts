// 审核动作簇(per-screen-review §02 四态 × 两角色 / §04 退回理由 / §05 两张弹卡 / §07 四条裁定)。
//
// 这一簇是**全站唯一的一份**,15 个屏共用 —— 所以「哪个态画哪几颗」的断言只能在这里写一次。
// 屏那一层只负责喂 keys / label / canEdit,不再各推一遍(铁律 5)。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import FPReviewActions from '@/components/fp/FPReviewActions.vue'
import FPReviewDialog from '@/components/fp/FPReviewDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import { reviewApi } from '@/api/review'
import type { ReviewRow, ReviewStatus } from '@/types/review'

vi.mock('@/api/review', () => ({
  reviewApi: {
    // 收尾那两趟(batch 的 finally)回空表就够 —— 断言看的是写动作打了没有、打给谁
    list: vi.fn(() => Promise.resolve([])),
    states: vi.fn(() => Promise.resolve([])),
    submit: vi.fn(() => Promise.resolve()),
    approve: vi.fn(() => Promise.resolve()),
    returnBack: vi.fn(() => Promise.resolve()),
    withdraw: vi.fn(() => Promise.resolve()),
    recall: vi.fn(() => Promise.resolve()),
    closedMonths: vi.fn(() => Promise.resolve([])),
    pending: vi.fn(() => Promise.resolve([])),
  },
}))
vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve()),
    put: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 't'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

const KEY = 'salary:2025-06'
const KEY2 = 'alloc-loss:2025-06'

function row(key: string, status: ReviewStatus, over: Partial<ReviewRow> = {}): ReviewRow {
  return {
    key, kind: key.split(':')[0], scope: null, status,
    submittedBy: 'zhangsan', submittedAt: '2025-06-30T09:00:00',
    reviewedBy: null, reviewedAt: null, reason: null, blockedBy: [],
    ...over,
  }
}

/** 组一屏:先把闸道数据塞进 store(mount 时 ensureYear 命中就不打请求),再挂组件。 */
function mountWith(opts: {
  rows: ReviewRow[]
  keys?: string[] | null
  perms?: string[]
  me?: string
  canEdit?: boolean
  monthText?: string | null
  /** 整年模式(年表屏):传年份数字本身 */
  year?: number | null
  edit?: boolean
  /** 故意不塞年数据 —— 验「还不知道」这一档 */
  unloaded?: boolean
}) {
  const review = useReviewStore()
  if (!opts.unloaded) review.byYear = new Map([[2025, opts.rows]])
  // 每个写动作做完 batch 都会重取闸道(stores/review.ts 的 finally)。回空表的话行会消失,
  // 屏上的按钮跟着没 —— 同一条用例里点第二次就找不到按钮了。让重取回同一份。
  ;(reviewApi.states as ReturnType<typeof vi.fn>).mockResolvedValue(opts.unloaded ? [] : opts.rows)
  const auth = useAuthStore()
  auth.me = opts.me ?? 'zhangsan'
  auth.permissions = opts.perms ?? ['entry:edit']
  const w = mount(FPReviewActions, {
    props: {
      keys: opts.keys === undefined ? [KEY] : opts.keys,
      label: '附表12 · 2025-06',
      monthText: opts.monthText ?? null,
      year: opts.year ?? null,
      canEdit: opts.canEdit ?? true,
      edit: opts.edit ?? false,
    },
  })
  return w
}

const labels = (w: ReturnType<typeof mount>) =>
  w.findAll('button').map((b) => b.text().trim())
const bodyLabels = () =>
  [...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '')
const bodyBtn = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const click = async (w: ReturnType<typeof mount>, label: string) => {
  const b = w.findAll('button').find((x) => x.text().trim() === label)
  expect(b, `屏上没有「${label}」这颗按钮`).toBeTruthy()
  await b!.trigger('click')
  await flushPromises()
}

describe('审核动作簇 FPReviewActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    document.body.innerHTML = ''      // Teleport 的残留会让上一条的文本污染下一条
    vi.stubGlobal('alert', vi.fn())   // jsdom 没有实现 alert
  })

  // ── §02 四态 × 两角色 ────────────────────────────────────

  // 破坏验证:把 toSubmit 的 inState 改成只认 'entered' 之外的态 → 红
  it('❗未交审 · 录入人:只画「交审」', () => {
    const w = mountWith({ rows: [] })          // 库里没这一行 = 派生 entered
    expect(labels(w)).toEqual(['交审'])
  })

  // 破坏验证:把 toApprove 的 inState('submitted') 改成 inState('submitted','entered') → 红
  it('❗未交审 · 审核员:不画一颗灰着的「通过」', () => {
    const w = mountWith({ rows: [], perms: ['entry:edit', 'review:approve'] })
    expect(labels(w)).not.toContain('通过')
    expect(labels(w)).not.toContain('退回')
  })

  // 破坏验证:把 toRecall 的 submittedBy 比较删掉(恒真) → 「他人交的」那条红
  it('❗待审核 · 本人交的:画「撤回」', () => {
    const w = mountWith({ rows: [row(KEY, 'submitted')], me: 'zhangsan' })
    expect(labels(w)).toEqual(['撤回'])
  })

  // 破坏验证:同上,或把 auth.me 换成 auth.displayName 去比 → 红
  it('❗待审核 · 别人交的:一颗都不画(撤不了,那是审核员的退回)', () => {
    const w = mountWith({ rows: [row(KEY, 'submitted', { submittedBy: 'lisi' })], me: 'zhangsan' })
    expect(labels(w)).toEqual([])
  })

  // 破坏验证:把 toApprove/toWithdraw 的 isReviewer 门去掉 → 「录入人看已审核」那条红
  it('❗待审核 · 审核员:画「通过」「退回」', () => {
    const w = mountWith({
      rows: [row(KEY, 'submitted', { submittedBy: 'lisi' })],
      perms: ['entry:edit', 'review:approve'],
    })
    expect(labels(w)).toEqual(['通过', '退回'])
  })

  // 破坏验证:把 submitText 里的 returned 三元去掉(恒「交审」) → 红
  it('❗已退回 · 录入人:红 chip + 「重新交审」', () => {
    const w = mountWith({
      rows: [row(KEY, 'returned', { reviewedBy: '李审', reviewedAt: '2026-03-05T14:22:00', reason: '三期水电重复计了一次' })],
    })
    expect(labels(w).sort()).toEqual(['已退回 · 李审 03-05', '重新交审'].sort())
    // §01:chip 在动作位**左边**。VTU 对多根组件的 findAll 不保证顺序,所以按渲染出来的 HTML 判位置。
    const html = w.html()
    expect(html.indexOf('已退回')).toBeLessThan(html.indexOf('重新交审'))
  })

  // 破坏验证:把 toWithdraw 改成 inState('approved','submitted') 之类 → 红
  it('❗已审核 · 录入人:什么都不加(药丸已经在编辑按钮位上)', () => {
    const w = mountWith({ rows: [row(KEY, 'approved', { reviewedBy: '李审' })] })
    expect(labels(w)).toEqual([])
  })

  // 破坏验证:把 toWithdraw 的 isReviewer 门写成恒真 → 上面那条红
  it('❗已审核 · 审核员:画「撤销审核」', () => {
    const w = mountWith({
      rows: [row(KEY, 'approved', { reviewedBy: '李审' })],
      perms: ['entry:edit', 'review:approve'],
    })
    expect(labels(w)).toEqual(['撤销审核'])
  })

  // ── 两道不渲染的门 ──────────────────────────────────────

  // 破坏验证:把 show 的 canEdit 与去掉 → 红
  it('❗canEdit=false:整簇不渲染(只读账号本来就没有编辑按钮)', () => {
    const w = mountWith({ rows: [], canEdit: false })
    expect(w.findAll('button')).toHaveLength(0)
  })

  // 破坏验证:把 ready 的 yearLoaded 判断删掉 → 红(会画出一颗「交审」)
  it('❗年数据还没到:一颗都不画(不能给一张已审核的表画交审键)', () => {
    const w = mountWith({ rows: [], unloaded: true })
    expect(w.findAll('button')).toHaveLength(0)
  })

  // 破坏验证:把 ready 里的 length > 0 守卫去掉 → 红(every 对空表恒真,整簇会挂上来)。
  // ⚠ 只断按钮数是**假绿**:零把键本来就没有按钮可画,守卫在不在都是 0 颗。
  //   要看得出差别,得断那张常驻的弹卡有没有被挂上 —— 那才是守卫真正拦住的东西。
  it('❗keys 为空:整簇不渲染(连弹卡都不挂)', () => {
    const w = mountWith({ rows: [], keys: [] })
    expect(w.findAll('button')).toHaveLength(0)
    expect(w.findComponent(FPReviewDialog).exists()).toBe(false)
  })

  // ── edit:编辑态里交审会静默丢草稿 ─────────────────────────
  //
  // 屏是草稿式编辑(MeterView 的 draft/dirtyIds、催缴单行内备注、报表屏 draft)。编辑态点「交审」→
  // 后端 submit 成功 → 键翻 submitted → useEditMode:267 那条守卫强退编辑态 → 没保存的草稿静默消失。
  // 交审交的本来就是**库里那一份**,编辑态那一位置根本不该有这颗按钮。

  // 破坏验证:把模板里那层 <template v-if="!edit"> 去掉(编辑态照画交审) → 红
  it('❗编辑态:一颗动作按钮都不画(交审交的是库里那一份,手上是没保存的草稿)', () => {
    const w = mountWith({ rows: [], edit: true })
    expect(labels(w)).toEqual([])
  })

  // 破坏验证:把那层 v-if 从「只罩动作按钮」扩成罩住整簇(连 chip 一起藏) → 红。
  // 这条是钉子:上一版最容易写成一刀切,而人正是照着那句退回理由在改,改的时候把理由抽走是反的。
  it('❗编辑态:「已退回 · 理由」那颗 chip 必须留着,只是没了「重新交审」', async () => {
    const w = mountWith({
      rows: [row(KEY, 'returned', { reviewedBy: '李审', reviewedAt: '2026-03-05T14:22:00', reason: '三期水电重复计了一次' })],
      edit: true,
    })
    expect(labels(w)).toEqual(['已退回 · 李审 03-05'])
    // chip 还能点开看全文 —— 藏了按钮不等于把这条路一起断了
    await click(w, '已退回 · 李审 03-05')
    expect(w.text()).toContain('三期水电重复计了一次')
  })

  // 破坏验证:把 v-if="!edit" 写成只罩 toSubmit 那一颗 → 红。
  // (这四颗实际挡了个空:submitted/approved 本来就锁编辑、进不了编辑态。留着断言是为了
  //  钉住「编辑态动作区一律为空」这条,免得后人按态一颗颗放行。)
  it('❗编辑态:审核员的通过/退回/撤销也一并不画', () => {
    const w = mountWith({
      rows: [row(KEY, 'submitted', { submittedBy: 'lisi' })],
      perms: ['entry:edit', 'review:approve'], edit: true,
    })
    expect(labels(w)).toEqual([])
  })

  // ── 文案 ────────────────────────────────────────────────

  // 破坏验证:把 nSuffix 的 n > 1 改成 n > 99(恒不带) → 红
  it('❗多键:按钮文案带项数「交审（2 项）」', () => {
    const w = mountWith({ rows: [], keys: [KEY, KEY2] })
    expect(labels(w)).toEqual(['交审（2 项）'])
  })

  // 破坏验证:把 submitText 里的 monthText 拼接删掉 → 红
  it('❗年表屏:按钮文案带月「交审 6 月」', () => {
    const w = mountWith({ rows: [], monthText: '6 月' })
    expect(labels(w)).toEqual(['交审 6 月'])
  })

  // ── §04 退回理由:chip 点开是浮层,不顶版 ──────────────────

  // 破坏验证:把 rva-pop 那段 v-if="reasonOpen" 改成 v-if="false" → 红
  it('❗红 chip 点开是完整理由 + 谁 + 什么时候', async () => {
    const w = mountWith({
      rows: [row(KEY, 'returned', { reviewedBy: '李审', reviewedAt: '2026-03-05T14:22:00', reason: '三期水电这个月重复计了一次' })],
    })
    expect(w.text()).not.toContain('三期水电这个月重复计了一次')   // 没点之前不占版面
    await click(w, '已退回 · 李审 03-05')
    expect(w.text()).toContain('三期水电这个月重复计了一次')
    expect(w.text()).toContain('李审 · 2026-03-05 14:22 退回')
  })

  // ── §05-D1 交审确认卡 ──────────────────────────────────

  // 破坏验证:把 @click="confirming = true" 改成 @click="doSubmit()" → 红(第一句就打了请求)
  it('❗交审要确认卡拦一道,点按钮不直接发请求', async () => {
    const w = mountWith({ rows: [] })
    await click(w, '交审')
    expect(reviewApi.submit).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('交出去之后这张表这个月就锁了')
    expect(bodyLabels()).toContain('取消')

    bodyBtn('交审')!.click()
    await flushPromises()
    expect(reviewApi.submit).toHaveBeenCalledWith(KEY)
  })

  // 破坏验证:把确认卡的「取消」按钮也接到 doSubmit → 红
  it('❗确认卡的「取消」不发请求', async () => {
    const w = mountWith({ rows: [] })
    await click(w, '交审')
    bodyBtn('取消')!.click()
    await flushPromises()
    expect(reviewApi.submit).not.toHaveBeenCalled()
  })

  // 破坏验证:把 doSubmit 里的 submitAll(ks) 换成 submitAll([keys[0]]) → 红(只交了一把)
  it('❗多键交审一次交两把(公共电核算屏 alloc + alloc-loss)', async () => {
    const w = mountWith({ rows: [], keys: [KEY, KEY2] })
    await click(w, '交审（2 项）')
    bodyBtn('交审')!.click()
    await flushPromises()
    expect(reviewApi.submit).toHaveBeenCalledTimes(2)
    expect(reviewApi.submit).toHaveBeenCalledWith(KEY2)
  })

  // ── §05-D2 退回/撤销走已有的 FPReviewDialog ────────────────

  // 破坏验证:把 dlg = 'return' 改成直接 review.returnAll(...,'') → 红(弹卡不出、理由是空的)
  it('❗「退回」走 FPReviewDialog,理由必填后才发请求', async () => {
    const w = mountWith({
      rows: [row(KEY, 'submitted', { submittedBy: 'lisi' })],
      perms: ['entry:edit', 'review:approve'],
    })
    await click(w, '退回')
    expect(document.body.textContent).toContain('退回 · 附表12 · 2025-06')
    expect(document.body.textContent).toContain('理由（必填）')
    expect(reviewApi.returnBack).not.toHaveBeenCalled()

    const ta = document.body.querySelector('textarea')!
    ta.value = '三期水电重复计了一次'
    ta.dispatchEvent(new Event('input'))
    await flushPromises()
    bodyBtn('确认退回')!.click()
    await flushPromises()
    expect(reviewApi.returnBack).toHaveBeenCalledWith(KEY, '三期水电重复计了一次')
  })

  // 破坏验证:把 action 传成恒 'return' → 红(标题写「退回」、发的是 returnBack)
  it('❗「撤销审核」复用同一张卡,发的是 withdraw', async () => {
    const w = mountWith({
      rows: [row(KEY, 'approved', { reviewedBy: '李审' })],
      perms: ['entry:edit', 'review:approve'],
    })
    await click(w, '撤销审核')
    expect(document.body.textContent).toContain('撤销审核 · 附表12 · 2025-06')
    const ta = document.body.querySelector('textarea')!
    ta.value = '金额算错了'
    ta.dispatchEvent(new Event('input'))
    await flushPromises()
    bodyBtn('确认撤销审核')!.click()
    await flushPromises()
    expect(reviewApi.withdraw).toHaveBeenCalledWith(KEY, '金额算错了')
  })

  // ── §07-③ 撤回:不要确认卡、不要理由 ─────────────────────

  // 破坏验证:给撤回也套一张确认卡(改成 confirming = true) → 红
  it('❗「撤回」不要确认卡、不要理由,点了直接发', async () => {
    const w = mountWith({ rows: [row(KEY, 'submitted')], me: 'zhangsan' })
    await click(w, '撤回')
    expect(reviewApi.recall).toHaveBeenCalledWith(KEY)
    expect(document.body.querySelector('textarea')).toBeNull()
  })

  // ── 整年模式(2026-09-08「一颗按钮管整年,键仍按月」) ────────────
  //
  // 四个年表屏一屏一整年、12 行同时摆着,没有「当前月」这一维:一颗按钮把这一年够格的月一次交出去。
  // 候选月怎么筛在 composables/useSchedScreen.ts 一份,这里只断**文案**——
  // 那颗按钮到底作用于几个月,是这一屏上唯一能读出「代价有多大」的地方。

  const YK = (m: string) => `pv:2025-${m}`

  // 破坏验证:把 actText 里的 `${props.year} 年（${ks.length} 个月）` 换回 nSuffix → 红。
  //          光秃秃一颗「交审（3 项）」读不出交的是哪一年、几个月。
  it('❗整年 · 多个月够格:「交审 2025 年（3 个月）」', () => {
    const w = mountWith({
      rows: [], year: 2025, keys: [YK('01'), YK('02'), YK('03')],
    })
    expect(labels(w)).toEqual(['交审 2025 年（3 个月）'])
  })

  // 破坏验证:把 actText 里 `ks.length === 1` 那一支删掉 → 红(写成「交审 2025 年（1 个月）」)。
  // ⚠ 这一条也正是「不能靠从键里自动推年模式」的那条边界:只剩一把键时,
  //   「同 kind 跨月」的形状就没了,自动推会退回光秃秃一颗「交审」。
  it('❗整年 · 只剩一个月够格:「交审 6 月」,不写「2025 年（1 个月）」', () => {
    const w = mountWith({
      rows: [row(YK('05'), 'approved'), row(YK('06'), 'returned', { reviewedBy: '李审', reviewedAt: '2025-07-02T10:00:00', reason: '重复计了一次' })],
      year: 2025, keys: [YK('05'), YK('06')],
    })
    expect(labels(w).sort()).toEqual(['已退回 · 李审 07-02', '重新交审 6 月'].sort())
  })

  // 破坏验证:把「通过」那颗的 actText 换回 nSuffix → 红。
  // 同一屏上「交审」与「通过」的月数**本来就不一样** —— 各自数各自那一档,不许折成一个数。
  it('❗整年 · 审核员:「通过 2025 年（2 个月）」,与「交审」各数各的', () => {
    const w = mountWith({
      rows: [row(YK('01'), 'submitted', { submittedBy: 'lisi' }),
             row(YK('02'), 'submitted', { submittedBy: 'lisi' }),
             row(YK('03'), 'approved')],
      year: 2025, keys: [YK('01'), YK('02'), YK('03'), YK('04')],
      perms: ['entry:edit', 'review:approve'],
    })
    // 04 库里没行 = 派生 entered → 只它一个够交审 → 写成「交审 4 月」
    expect(labels(w).sort())
      .toEqual(['交审 4 月', '通过 2025 年（2 个月）', '退回 2025 年（2 个月）', '撤销审核 3 月'].sort())
  })

  // 破坏验证:把模板里 <template v-if="!edit"> 去掉 → 红。
  // 年表屏也是草稿式(新增抽屉 / 导入窗),编辑态那一位置同样不该有「交审」。
  it('❗整年 · 编辑态:一颗动作按钮都不画', () => {
    const w = mountWith({ rows: [], year: 2025, keys: [YK('01'), YK('02')], edit: true })
    expect(labels(w)).toEqual([])
  })

  // 破坏验证:把 doSubmit 改成 review.submitAll(keys.value) → 红(会把已审的月再交一次,吃 409)。
  it('❗整年 · 交审只发够格的那几把键,已审 / 待审的月不跟着走', async () => {
    const w = mountWith({
      rows: [row(YK('01'), 'approved'), row(YK('02'), 'submitted', { submittedBy: 'lisi' })],
      year: 2025, keys: [YK('01'), YK('02'), YK('03'), YK('04')],
    })
    await click(w, '交审 2025 年（2 个月）')
    bodyBtn('交审')!.click()                     // 确认卡是 Teleport 到 body 的
    await flushPromises()
    expect((reviewApi.submit as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]))
      .toEqual([YK('03'), YK('04')])
  })

  // 破坏验证:把 confirmHint 的整年分支删掉(恒说「这个月」) → 红。
  // 用户拍板时明确要求:一颗按钮管整年,代价必须在屏上说清楚。
  it('❗整年 · 确认卡说的是「这一年的 N 个月一起锁」,不是「这个月」', async () => {
    const w = mountWith({ rows: [], year: 2025, keys: [YK('01'), YK('02'), YK('03')] })
    await click(w, '交审 2025 年（3 个月）')
    const hint = document.body.querySelector('.rva-hint')?.textContent ?? ''
    expect(hint).toContain('2025 年的 3 个月一起锁')
  })

  // ── 铁律 7:不预判前置 ───────────────────────────────────

  // 破坏验证:给「通过」加上 :disabled="row.blockedBy.length > 0" → 红
  it('❗「通过」不预判上游前置:blockedBy 非空照样可点,409 由后端说', async () => {
    const w = mountWith({
      rows: [row(KEY, 'submitted', { submittedBy: 'lisi', blockedBy: ['计费参数'] })],
      perms: ['entry:edit', 'review:approve'],
    })
    const b = w.findAll('button').find((x) => x.text().trim() === '通过')!
    expect(b.attributes('disabled')).toBeUndefined()
    await click(w, '通过')
    expect(reviewApi.approve).toHaveBeenCalledWith(KEY)
  })

  // 破坏验证:把 run() 的三分支合成一句 alert(msg) → 红
  it('❗409 与 403 分流成两句话(合成一句用户分不出该找谁)', async () => {
    const a = vi.fn()
    vi.stubGlobal('alert', a)
    ;(reviewApi.approve as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ code: 409, message: '计费参数还没审' })
    const w = mountWith({
      rows: [row(KEY, 'submitted', { submittedBy: 'lisi' })],
      perms: ['entry:edit', 'review:approve'],
    })
    await click(w, '通过')
    expect(a).toHaveBeenCalledWith('上游还没审完：计费参数还没审')

    ;(reviewApi.approve as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ code: 403, message: '没有这张表的权限' })
    await click(w, '通过')
    expect(a).toHaveBeenLastCalledWith('你没有这张表的权限：没有这张表的权限')
  })
})
