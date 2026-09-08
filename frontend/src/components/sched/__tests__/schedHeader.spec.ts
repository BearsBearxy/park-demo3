import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

import SchedHeader from '@/components/sched/SchedHeader.vue'
import FPReviewActions from '@/components/fp/FPReviewActions.vue'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import api from '@/api'

/**
 * SchedHeader 是**第二套**编辑锁实现。
 *
 * 附表族 7 屏的编辑态由各屏自己持有(`edit` 是 prop),锁在这个组件里 acquire/release ——
 * 它不走 `useEditMode`。所以 2026-08-29 在 useEditMode 里补的那条「换期就还锁」
 * 覆盖不到这 7 屏,得在这里再补一遍。
 *
 * 会踩到的实际动作(三处都在编辑态里就地换 scope):
 *   · 附表13/14 顶部 Segmented 切子表 → `S.utilities(no, year)` 的 no 变
 *   · 附表12 月胶囊换月           → `S.salary(year, month)` 的 month 变
 *   · 四屏「新增记账」存的是别的年 → 屏静默跳年,`S.pv(year)` 之类跟着变
 *
 * 不修的后果是**会丢数据**:人在 5 月编辑、手里却握着 3 月的锁,
 * 于是 5 月对别人显示「无人编辑」,两个人能同时改同一个月,后保存的赢。
 */

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
    put: vi.fn(() => Promise.resolve({ evicted: null })),
    delete: vi.fn(() => Promise.resolve()),
  },
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

function mk(props: Record<string, unknown> = {}) {
  return mount(SchedHeader, {
    props: {
      icon: 'wallet', title: '附表12 · 工资明细', year: 2025,
      edit: false, perm: 'entry:edit', scope: 'sched:salary:2025-03',
      ...props,
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  useAuthStore().permissions = ['entry:edit']
})

describe('SchedHeader 编辑锁', () => {
  /** 编辑模式按钮就是 .lc-lockbtn(锁位长在它身上,设计稿 §05) */
  const press = async (w: ReturnType<typeof mk>) => {
    await w.find('.lc-lockbtn').trigger('click')
    await flushPromises()
  }

  it('进编辑态先占锁', async () => {
    const w = mk()
    await press(w)
    expect(api.post).toHaveBeenCalledWith('/locks/sched:salary:2025-03')
    expect(w.emitted('toggle-edit')).toHaveLength(1)
  })

  it('❗编辑态里 scope 变了 → 还旧锁 + 请上层退出编辑态', async () => {
    // edit=false 起步,按一下真的占到 3 月那把锁,再让上层把 edit 翻上去
    const w = mk({ edit: false })
    await press(w)
    await w.setProps({ edit: true })
    vi.mocked(api.delete).mockClear()

    await w.setProps({ scope: 'sched:salary:2025-05' })
    await nextTick()
    await flushPromises()

    expect(api.delete, '还的必须是**旧**那把').toHaveBeenCalledWith('/locks/sched:salary:2025-03')
    expect(w.emitted('toggle-edit'), '请上层退出编辑态(edit 是 prop,组件自己改不了)')
      .toHaveLength(2)   // 1 = 进编辑态那次,2 = 换期请求退出
  })

  it('浏览态换 scope 什么都不做 —— 没进编辑态就没有锁可还', async () => {
    const w = mk({ edit: false })
    await w.setProps({ scope: 'sched:salary:2025-05' })
    await nextTick()
    expect(api.delete).not.toHaveBeenCalled()
    expect(w.emitted('toggle-edit')).toBeUndefined()
  })

  it('scope 没变就不动 —— 别把无关的重渲当成换期', async () => {
    const w = mk({ edit: false })
    await press(w)
    await w.setProps({ edit: true })
    vi.mocked(api.delete).mockClear()

    await w.setProps({ year: 2026 })   // 别的 prop 变,scope 不变
    await nextTick()
    expect(api.delete).not.toHaveBeenCalled()
  })

  it('不上锁的屏(scope=null)不受影响', async () => {
    const w = mk({ edit: true, scope: null })
    await w.setProps({ scope: null, year: 2026 })
    await nextTick()
    expect(api.delete).not.toHaveBeenCalled()
    expect(w.emitted('toggle-edit')).toBeUndefined()
  })
})

describe('SchedHeader 强制退出带 forced 标(收口复查)', () => {
  it('❗换期强退 emit 的是 toggle-edit(true) —— 脏检查屏必须无条件退', async () => {
    // 附表10/损益表把 @toggle-edit 绑在带脏检查的函数上:普通 emit 在 dirty>0 时
    // 会被「保存确认」吞掉,edit 恒真 —— 而锁已经还了,确认框里的「保存」是无锁写。
    // forced=true 是「锁没了」的信号,接收方必须放弃询问直接退。
    const w = mk({ scope: 'sched:pv:2025' })
    await w.find('.lc-lockbtn').trigger('click')     // 占锁进编辑
    await flushPromises()
    await w.setProps({ edit: true })
    await w.setProps({ scope: 'sched:pv:2026' })     // 编辑态里换期 → 强退
    await flushPromises()

    const calls = w.emitted('toggle-edit')!
    expect(calls.at(-1), '强制退出必须带 forced=true').toEqual([true])
  })

  it('用户自己点「完成」不是强制 —— 脏检查屏该有机会问一句', async () => {
    const w = mk({ scope: 'sched:pv:2025' })
    await w.find('.lc-lockbtn').trigger('click')
    await flushPromises()
    await w.setProps({ edit: true })
    await w.find('.lc-lockbtn').trigger('click')     // 点「完成」
    await flushPromises()
    expect(w.emitted('toggle-edit')!.at(-1), '用户主动退出 forced=false').toEqual([false])
  })

  it('❗附表10/损益表的接收端真的处理 forced —— 源码钉(挂载太重,函数是组件内部的)', () => {
    for (const rel of ['../../../views/sales-income/S10View.vue', '../../../views/reports/pnl/PnlScheduleView.vue']) {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      expect(/(?:finishEdit|toggleEdit)\(forced = false\)/.test(src), `${rel} 的处理函数不收 forced`).toBe(true)
      expect(src.includes('if (forced)'), `${rel} 没有 forced 直退分支 —— 强退会被脏检查吞掉`).toBe(true)
    }
  })
})

describe('SchedHeader copyText 透传(被接管的「复制我的改动」)', () => {
  // FPEvictedDialog 是 Teleport to body —— 查它必须桩掉 teleport(mk 没桩,这里本地挂)
  const mkT = (extra: Record<string, unknown> = {}) => mount(SchedHeader, {
    props: {
      icon: 'wallet', title: '附表12 · 工资明细', year: 2025,
      edit: false, perm: 'entry:edit', scope: 'sched:salary:2025-03', ...extra,
    },
    global: { stubs: { teleport: true } },
  })

  it('❗有草稿 + 传了 copyText → 被接管弹窗给复制的路,点了真拿到序列化文本', async () => {
    // 草稿在各屏,页头只递话:不透传的话被踢的人只看到「你丢了 N 处改动」然后关门。
    const w = mkT({ dirty: 3, copyText: () => 'A\tB\n1\t2' })
    await w.find('.lc-lockbtn').trigger('click')
    await flushPromises()
    await w.setProps({ edit: true })

    // 心跳带回被接管(锁 mock 的 put 返回 evictions)
    vi.mocked(api.put).mockResolvedValue({
      users: [],
      evictions: [{ scope: 'sched:salary:2025-03', by: 'lisi', byDisplayName: '李四', authorizerName: null }],
    } as never)
    const { usePresenceStore } = await import('@/stores/presence')
    await usePresenceStore().ping()
    await flushPromises()

    expect(w.find('.evd-scrim').exists(), '前提:被接管弹窗开了').toBe(true)
    expect(w.find('.evd-draft').exists(), '复制块必须在 —— 只给数字不给出路等于关门').toBe(true)
    expect(w.find('.evd-cnt').text()).toBe('3')

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await w.find('.evd-draft button').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('A\tB\n1\t2')
    vi.unstubAllGlobals()
  })

  it('没传 copyText 的屏照旧不显示复制块(即时落库的 5 屏没有草稿可复制)', async () => {
    const w = mkT({ dirty: 0 })
    await w.find('.lc-lockbtn').trigger('click')
    await flushPromises()
    await w.setProps({ edit: true })
    vi.mocked(api.put).mockResolvedValue({
      users: [],
      evictions: [{ scope: 'sched:salary:2025-03', by: 'lisi', byDisplayName: '李四', authorizerName: null }],
    } as never)
    const { usePresenceStore } = await import('@/stores/presence')
    await usePresenceStore().ping()
    await flushPromises()
    expect(w.find('.evd-scrim').exists()).toBe(true)
    expect(w.find('.evd-draft').exists()).toBe(false)
  })

  it('❗S10 与损益表真的把 copyText 绑上了(挂载太重,绑定用源码钉)', () => {
    for (const [rel, fn] of [
      ['../../../views/sales-income/S10View.vue', 'draftAsTsv'],
      ['../../../views/reports/pnl/PnlScheduleView.vue', 'draftAsTsv'],
    ] as const) {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      expect(src.includes(`:copy-text="${fn}"`), `${rel} 没把序列化器绑给 SchedHeader`).toBe(true)
      expect(src.includes(`function ${fn}`), `${rel} 没有序列化器`).toBe(true)
    }
  })
})

describe('SchedHeader 还锁时序(锁跟着 edit 状态走)', () => {
  const press = async (w: ReturnType<typeof mk>) => {
    await w.find('.lc-lockbtn').trigger('click')
    await flushPromises()
  }

  it('❗用户点「完成」只递话不还锁 —— 脏检查屏的保存确认要在锁下进行', async () => {
    // 旧时序:点「完成」先 release 再 emit。附表10/损益表 dirty>0 时不翻 edit、
    // 先弹「保存确认」—— 锁已经没了,确认框里的「保存修改」是**无锁写**,
    // 可能盖掉刚 acquire 到锁的另一个人正在编辑的数据。
    const w = mk()
    await press(w)                      // 进编辑(占锁)
    await w.setProps({ edit: true })
    vi.mocked(api.delete).mockClear()

    await press(w)                      // 点「完成」
    expect(w.emitted('toggle-edit')!.at(-1), '递话照发(forced=false)').toEqual([false])
    expect(api.delete, '屏还没确认退出,锁不许还 —— 它要陪到保存确认结束').not.toHaveBeenCalled()
  })

  it('❗屏真的翻假(保存成功/放弃/简单屏直翻)→ 这时才还锁', async () => {
    const w = mk()
    await press(w)
    await w.setProps({ edit: true })
    vi.mocked(api.delete).mockClear()
    await press(w)                      // 点「完成」,S10 式的屏此刻可能在弹确认
    expect(api.delete).not.toHaveBeenCalled()

    await w.setProps({ edit: false })   // 屏确认完(保存成功或放弃)才翻假
    await flushPromises()
    expect(api.delete, '收尾统一挂在 edit 翻假上').toHaveBeenCalledWith('/locks/sched:salary:2025-03')
  })

  it('被接管路径的收尾也走同一处 —— closeEditor/endElevation 不再漏(既有缺口)', async () => {
    // 旧代码接管回调只 emit,从不跑 closeEditor/endElevation。现在屏翻假时统一收尾。
    const w = mk()
    await press(w)
    await w.setProps({ edit: true })
    const auth = useAuthStore()
    const end = vi.spyOn(auth, 'endElevation')

    vi.mocked(api.put).mockResolvedValue({
      users: [],
      evictions: [{ scope: 'sched:salary:2025-03', by: 'lisi', byDisplayName: '李四', authorizerName: null }],
    } as never)
    const { usePresenceStore } = await import('@/stores/presence')
    await usePresenceStore().ping()
    await flushPromises()
    expect(w.emitted('toggle-edit')!.at(-1)).toEqual([true])

    await w.setProps({ edit: false })   // 屏收到 forced 翻假
    await flushPromises()
    expect(end, '接管后授权也要结束 —— 旧路径漏跑这一步').toHaveBeenCalled()
  })
})

// ══════════ 审核闸(§7.5,R2 T3)══════════
//
// SchedHeader 是编辑入口的**第二条路**,不走 useEditMode。spec §7.5 只写了 useEditMode
// 那一条,照字面实现等于放过附表族六把键(附6/7/8/10/11/12/13/14 全在这个页头底下)。

function seedReview(status: string) {
  vi.mocked(api.get).mockImplementation((url: string) =>
    url === '/review/states'
      ? Promise.resolve([{
          key: 'salary:2025-03', kind: 'salary', scope: null, status,
          submittedBy: '张三', submittedAt: null,
          reviewedBy: '李审', reviewedAt: '2025-03-05T10:00:00',
          reason: null, blockedBy: [],
        }] as never)
      : (Promise.resolve([]) as never))
}

describe('SchedHeader 审核闸', () => {
  const lockPosts = () =>
    vi.mocked(api.post).mock.calls.filter(c => String(c[0]).startsWith('/locks'))

  // 破坏验证:删掉 onToggleEdit 开头那一行 → 红
  it('❗已审核的附表点不进编辑模式,也不去占锁', async () => {
    seedReview('approved')
    const w = mk({ reviewKey: 'salary:2025-03' })
    await flushPromises()
    expect(w.find('.lc-reviewpill').text()).toContain('已审核 · 李审 03-05')
    expect(w.find('.lc-lockbtn').element.tagName, '按钮位换成了药丸').toBe('SPAN')
    await w.find('.lc-reviewpill').trigger('click')
    await flushPromises()
    expect(w.emitted('toggle-edit'), '药丸点不动').toBeUndefined()
    expect(lockPosts()).toHaveLength(0)
  })

  // 破坏验证:把 types/review.ts 的 LOCKING 改成只含 approved → 红
  it('❗待审核也锁(D17)', async () => {
    seedReview('submitted')
    const w = mk({ reviewKey: 'salary:2025-03' })
    await flushPromises()
    expect(w.find('.lc-reviewpill').text()).toContain('待审核 · 已交审')
  })

  // 破坏验证:把 returned 加进 LOCKING → 红
  it('❗已退回照常能改', async () => {
    seedReview('returned')
    const w = mk({ reviewKey: 'salary:2025-03' })
    await flushPromises()
    expect(w.find('.lc-reviewpill').exists()).toBe(false)
    await w.find('.lc-lockbtn').trigger('click')
    await flushPromises()
    expect(w.emitted('toggle-edit')).toBeTruthy()
  })

  // ❗这一条守的是「屏内换月」那条路 —— scope 是按年的(sched:salary:2025),换月不变,
  //   所以上面那条「换期还锁」的守卫**看不到**它。
  //   破坏验证:删掉 watch(reviewBlock, ...) 那一条 → 红
  it('❗编辑态里换到已审核的月 → 强制退出', async () => {
    // 闸道按**年**缓存(一屏 12 个月一趟),所以屏内换月不重新取数 —— 3 月已审这件事
    // 在进屏那一趟里就拿到了。这条测的正是「本地已经知道,换过去要当场拦」。
    seedReview('approved')                              // 该年只有 2025-03 是 approved
    const w = mk({ reviewKey: 'salary:2025-04', edit: true })
    await flushPromises()
    expect(w.emitted('toggle-edit'), '2025-04 没审,不该误伤').toBeUndefined()

    await w.setProps({ reviewKey: 'salary:2025-03' })   // 月胶囊换到 3 月
    await flushPromises()
    await nextTick()
    expect(w.emitted('toggle-edit')?.[0], '换到已审核的月要强制退出').toEqual([true])
  })

  // ❗onToggleEdit 里那道闸唯一**可达**的路:提权弹窗批准后的回调
  //   (`@elevated="asking = null; void onToggleEdit()"`)。
  //   平时点不到 —— 审核态一锁,按钮位就换成药丸了,点击落在 span 上。
  //   头一版只断言「点药丸没反应」,删掉 onToggleEdit 的闸照样全绿(药丸本来就点不动)。
  //   破坏验证:删掉 onToggleEdit 开头那一行 → 红。
  it('❗主管批完授权那一刻表已被审 → 照样进不去,也不占锁', async () => {
    // 缺 entry:edit 但能请求提权 —— canAsk 为真,按钮才画得出来(只读账号连按钮都没有)
    useAuthStore().permissions = ['elevate:request']
    const w = mk({ reviewKey: 'salary:2025-03' })
    await flushPromises()
    await w.find('.lc-lockbtn').trigger('click')   // 此刻还没锁,弹窗开了
    await flushPromises()
    expect(w.emitted('toggle-edit'), '缺权限只该弹窗,不该进').toBeUndefined()

    seedReview('approved')                   // 弹窗开着的时候,别人把这张表审了
    const rs = useReviewStore()
    rs.invalidate('2025-03')
    await rs.ensureYear(2025)
    await nextTick()

    // 主管批了 —— 权限这才齐(不补这一步 onToggleEdit 会在权限判那儿就返回,
    // 于是删掉审核闸也照样绿:头一版就栽在这里)
    useAuthStore().permissions = ['elevate:request', 'entry:edit']
    await w.findComponent({ name: 'FPElevateDialog' }).vm.$emit('elevated')
    await flushPromises()
    expect(w.emitted('toggle-edit'), '权限齐 ≠ 进得去').toBeUndefined()
    expect(lockPosts()).toHaveLength(0)
  })

  // 破坏验证:删掉 onTaken 里那一行 → 红。接管抽屉不能成为绕开审核闸的后门。
  //
  // ⚠ 必须走**真实路径**(从接管抽屉 emit `taken`)。<script setup> 没有 defineExpose,
  //   `w.vm.onTaken?.()` 拿到的是 undefined,`?.` 会把整条断言变成空操作 —— 头一版就是这么写的,
  //   删掉 onTaken 里的闸照样全绿。
  it('❗接管成功也进不去已审核的表', async () => {
    seedReview('approved')
    const w = mk({ reviewKey: 'salary:2025-03' })
    await flushPromises()
    await w.findComponent({ name: 'FPTakeoverDrawer' }).vm.$emit('taken')
    await flushPromises()
    expect(w.emitted('toggle-edit')).toBeUndefined()
    expect(lockPosts()).toHaveLength(0)
  })

  // 同 useEditMode 那条(D-R2-7):拉失败不挡,也不画药丸 —— 画了等于对用户断言「已审核」。
  it('❗审核态拉失败不挡编辑,也不画药丸', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/review/states' ? (Promise.reject(new Error('boom')) as never) : (Promise.resolve([]) as never))
    const w = mk({ reviewKey: 'salary:2025-03' })
    await flushPromises()
    expect(w.find('.lc-reviewpill').exists()).toBe(false)
    await w.find('.lc-lockbtn').trigger('click')
    await flushPromises()
    expect(w.emitted('toggle-edit')).toBeTruthy()
  })

  // 破坏验证:把 watch 的 immediate 去掉或改成无条件 ensure → 红
  it('❗不传 reviewKey 的屏一个字不改', async () => {
    const w = mk()
    await flushPromises()
    expect(w.find('.lc-reviewpill').exists()).toBe(false)
    expect(vi.mocked(api.get).mock.calls.filter(c => String(c[0]).startsWith('/review'))).toHaveLength(0)
  })
})

// ══════════ 审核动作簇(per-screen-review §03-B2)══════════
//
// 动作簇接在**页头**而不是 7 个消费屏各填一次 #static-actions —— 与导入按钮当年收进本组件
// 同一条理由。所以「7 屏一次到位」这件事只能在这里断言:屏那一层没有可断的东西。
//
// 「哪个态画哪几颗」的判据在 FPReviewActions 那一份(它自己的用例里逐格钉着),
// 这里只断三件本组件负责的事:接线接上了没有、月份从哪来、与旁边那颗编辑按钮/药丸打不打架。

describe('SchedHeader 审核动作簇', () => {
  /** ds/Button 渲染成 <button>;按文案找,免得依赖组件内部的 class */
  const btn = (w: ReturnType<typeof mk>, text: string) =>
    w.findAll('button').find((b) => b.text().includes(text))

  // 闸道回空表 = 这一年一条已落库的行都没有,而「录入中」是前端派生的(后端只发 submitted/
  // approved/returned)。⚠ 这一句必须显式写:上一个 describe 最后留下的实现是「/review/states
  // 一律 reject」,vi.clearAllMocks 只清调用记录不清实现 —— 继承过来的话 yearLoaded 恒假,
  // 动作簇「拿不准一颗都不画」,整个 describe 会绿得毫无意义。
  beforeEach(() => { vi.mocked(api.get).mockImplementation(() => Promise.resolve([]) as never) })

  // 破坏验证:把 reviewMonthText 改成恒 null → 红
  it('❗交审按钮写着月份,月份从 reviewKey 里推 —— 屏不用多传一个 prop', async () => {
    // 闸道只发已落库的行(submitted/approved/returned),空表 = 这把键还「录入中」
    const w = mk({ reviewKey: 'salary:2025-06' })
    await flushPromises()
    expect(btn(w, '交审 6 月'), '一屏 12 个月,不写月份交的是哪个月全靠猜').toBeTruthy()
  })

  // 破坏验证:把 <FPReviewActions> 挪到 .lc-lockbtn 之后 → 红
  it('❗动作簇长在编辑按钮左边,编辑按钮位不动', async () => {
    const w = mk({ reviewKey: 'salary:2025-06' })
    await flushPromises()
    const kids = [...w.find('.lc-head-actions').element.children]
    const iSubmit = kids.findIndex((el) => el.textContent?.includes('交审'))
    const iEdit = kids.findIndex((el) => el.classList.contains('lc-lockbtn'))
    expect(iSubmit, '动作簇要在 DOM 里').toBeGreaterThanOrEqual(0)
    expect(iSubmit, '§01:它长在编辑按钮**左边**').toBeLessThan(iEdit)
  })

  // 破坏验证:把动作簇的 :keys 写成恒 null → 红(药丸还在,撤回没了)
  it('❗待审核:药丸与动作簇并存 —— 编辑按钮位是药丸,旁边照样撤得回来', async () => {
    seedReview('submitted')
    useAuthStore().me = '张三'          // = 后端 submittedBy(登录名,不是 displayName)
    const w = mk({ reviewKey: 'salary:2025-03' })
    await flushPromises()
    expect(w.find('.lc-reviewpill').text()).toContain('待审核 · 已交审')
    expect(w.find('.lc-lockbtn').element.tagName, '按钮位仍是药丸').toBe('SPAN')
    expect(btn(w, '撤回'), '自己交的撤得回来(§07-③)').toBeTruthy()
    expect(btn(w, '交审'), '已经交出去了,不该再画一颗交审').toBeFalsy()
  })

  // 破坏验证:把 reviewPeriod 钉死成 mount 那一刻的值(非 computed)→ 红
  it('❗月胶囊换月 → 动作簇跟着换那个月的态', async () => {
    seedReview('approved')                              // 该年只有 2025-03 已审
    const w = mk({ reviewKey: 'salary:2025-03' })
    await flushPromises()
    expect(btn(w, '交审'), '已审核的月不画交审 —— 点下去只会吃一个 409').toBeFalsy()

    await w.setProps({ reviewKey: 'salary:2025-04' })
    await flushPromises()
    expect(btn(w, '交审 4 月'), '换到没审的月,按钮跟着换月份').toBeTruthy()
  })

  // 破坏验证:把 :can-edit 改成恒 true → 红
  it('❗只读账号两栏都不画 —— 没有编辑按钮的人也不该看见交审', async () => {
    useAuthStore().permissions = []                     // 连 elevate:request 都没有
    const w = mk({ reviewKey: 'salary:2025-06' })
    await flushPromises()
    expect(w.find('.lc-lockbtn').exists(), '编辑按钮本来就不画').toBe(false)
    expect(btn(w, '交审'), '单给他看一句「该你交审」是凭空多一条用不上的信息').toBeFalsy()
  })
})

// ══════════ 整年模式(2026-09-08「一颗按钮管整年,键仍按月」)══════════
//
// 四个年表屏(附6 / 附7·8 / 附11 / 附13·14)一屏一整年、12 行同时摆着,没有「当前月」这一维,
// 所以它们传 reviewKeys 而不是 reviewKey。本组件要负责的是三件:
//   ① 两条路合一(动作簇只认 keys),且**按月那条一个字不变** —— 另外 3 个消费屏正跑在上面;
//   ② 整年模式把 year 递给动作簇(文案「交审 2025 年（3 个月）」由它写,这里不重测);
//   ③ 分布 chip —— 用户拍板时明确要的那一半:一颗按钮管整年,这一年不是非黑即白的锁。
describe('SchedHeader 整年模式', () => {
  const btn = (w: ReturnType<typeof mk>, text: string) =>
    w.findAll('button').find((b) => b.text().includes(text))
  const YK = (m: string) => `pv:2025-${m}`

  beforeEach(() => { vi.mocked(api.get).mockImplementation(() => Promise.resolve([]) as never) })

  /** 闸道回这几行(后端只发已落库的三档) */
  const seed = (rows: { key: string; status: string }[]) => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/review/states'
        ? Promise.resolve(rows.map(r => ({
            kind: r.key.split(':')[0], scope: null, submittedBy: 'lisi',
            submittedAt: '2025-07-01T09:00:00', reviewedBy: '李审',
            reviewedAt: '2025-07-02T10:00:00', reason: null, blockedBy: [], ...r,
          })) as never)
        : (Promise.resolve([]) as never))
  }

  // 破坏验证:把 reviewKeyList 的 props.reviewKeys 那一支删掉 → 红(整簇又变回不渲染)。
  it('❗年表屏传一串月键 → 动作簇拿到整串,并按年模式写文案', async () => {
    const w = mk({ reviewKey: null, reviewKeys: [YK('01'), YK('02'), YK('03')] })
    await flushPromises()
    const rva = w.findComponent(FPReviewActions)
    expect(rva.props('keys')).toEqual([YK('01'), YK('02'), YK('03')])
    expect(rva.props('year'), '不传 year 的话文案退回「交审（3 项）」,读不出是哪一年').toBe(2025)
    expect(btn(w, '交审 2025 年（3 个月）')).toBeTruthy()
  })

  // ❗这一条守的是**另外 3 个消费屏**(附10 / 附12 / 台账走的是按月那条路)。
  //   破坏验证:把 reviewKeyList 写成 `props.reviewKeys ?? []` → 红(按月屏整簇消失)。
  it('❗按月那条路一个字不变 —— 不传 reviewKeys 时仍是单键 + monthText,year 为 null', async () => {
    const w = mk({ reviewKey: 'salary:2025-06' })
    await flushPromises()
    const rva = w.findComponent(FPReviewActions)
    expect(rva.props('keys')).toEqual(['salary:2025-06'])
    expect(rva.props('year'), '按月屏进了年模式的话「通过」会写成「通过 2025 年（N 个月）」').toBeNull()
    expect(btn(w, '交审 6 月')).toBeTruthy()
    expect(w.find('.lc-spreadchip').exists(), '按月屏不该有「本年 …」这条 chip').toBe(false)
  })

  // 破坏验证:把 yearSpread 里的三个分支合成一个数(例如只数 approved) → 红。
  // 用户原话的那一半:部分月已审、部分月还没录时,它不是一个非黑即白的锁,屏上要读得出分布。
  it('❗分布 chip 逐档数:「本年 2 已审 · 1 待审 · 2 待交」', async () => {
    seed([{ key: YK('01'), status: 'approved' }, { key: YK('02'), status: 'approved' },
          { key: YK('03'), status: 'submitted' }, { key: YK('04'), status: 'returned' }])
    const w = mk({ reviewKey: null,
      reviewKeys: [YK('01'), YK('02'), YK('03'), YK('04'), YK('05')] })
    await flushPromises()
    // 05 库里没行 = 派生 entered,与 returned 同属「还要交」那一档
    expect(w.find('.lc-spreadchip').text()).toBe('本年 2 已审 · 1 待审 · 2 待交')
  })

  // 破坏验证:把 yearSpread 里的 `parts.length ? … : null` 换成恒返回 → 红。
  it('❗年数据还没到手 → chip 不画,不是画一个「本年」空壳', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/review/states' ? (new Promise(() => {}) as never) : (Promise.resolve([]) as never))
    const w = mk({ reviewKey: null, reviewKeys: [YK('01'), YK('02')] })
    await flushPromises()
    expect(w.find('.lc-spreadchip').exists(), '拿不准就什么都不画(同动作簇 ready 的口径)').toBe(false)
  })

  // 破坏验证:把 `v-if="canAsk && yearSpread"` 的 canAsk 去掉 → 红。
  it('❗空年 / 只读账号:整簇与 chip 都不画', async () => {
    const empty = mk({ reviewKey: null, reviewKeys: [] })
    await flushPromises()
    expect(empty.find('.lc-spreadchip').exists(), '空年没什么可说的').toBe(false)
    expect(empty.findComponent(FPReviewActions).find('button').exists()).toBe(false)

    useAuthStore().permissions = []                    // 连 elevate:request 都没有
    const readonly = mk({ reviewKey: null, reviewKeys: [YK('01'), YK('02')] })
    await flushPromises()
    expect(readonly.find('.lc-spreadchip').exists(), '没有编辑按钮的人也不该看见这一条').toBe(false)
  })

  // 破坏验证:把 reviewLabel 的年模式那一支删掉 → 红(弹卡标题写成「附表6 · 光伏发电」,没有年)。
  it('❗弹卡标题带年份 —— 交的是整年,标题只写表名读不出交的是哪一年', async () => {
    const w = mk({ title: '附表6 · 光伏发电', reviewKey: null, reviewKeys: [YK('01')] })
    await flushPromises()
    expect(w.findComponent(FPReviewActions).props('label')).toBe('附表6 · 光伏发电 · 2025 年')
  })
})
