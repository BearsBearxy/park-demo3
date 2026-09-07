import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

import SchedHeader from '@/components/sched/SchedHeader.vue'
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
    url === '/review'
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
    const w = mk({ reviewKey: 'salary:2025-04', edit: true })
    await flushPromises()
    expect(w.emitted('toggle-edit'), '2025-04 没审,不该误伤').toBeUndefined()

    seedReview('approved')
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
    await rs.ensure('2025-03')
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

  // 破坏验证:把 reviewBlock 里的 isFailed 判断删掉 → 红
  it('❗审核态拉失败要保守', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/review' ? (Promise.reject(new Error('boom')) as never) : (Promise.resolve([]) as never))
    const w = mk({ reviewKey: 'salary:2025-03' })
    await flushPromises()
    expect(w.find('.lc-reviewpill').text()).toContain('审核态未知')
  })

  // 破坏验证:把 watch 的 immediate 去掉或改成无条件 ensure → 红
  it('❗不传 reviewKey 的屏一个字不改', async () => {
    const w = mk()
    await flushPromises()
    expect(w.find('.lc-reviewpill').exists()).toBe(false)
    expect(vi.mocked(api.get).mock.calls.filter(c => c[0] === '/review')).toHaveLength(0)
  })
})
