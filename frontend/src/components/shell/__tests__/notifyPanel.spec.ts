// 铃铛面板(画布 06-F;PAGE-BEHAVIOR-SPEC §5.1;UI-OVERLAY-SPEC §7.1)。
// 原 FPApprovalDrawer 的断言(reviewBell.spec)搬到这里:授权当场批、待审逐张列出并直达那张表那个月、
// 明细取不到时退回「几件 + 一个去处」、零条时不留空段。
import { mount, flushPromises, DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { ourPark } from '@/test-utils/appConfig'
import { landNav } from '@/test-utils/landNav'
import { usePresenceStore } from '@/stores/presence'
import { useUpdateStore } from '@/stores/update'
import { useAuthStore } from '@/stores/auth'
import { useTabsStore } from '@/stores/tabs'
import { useBellStore } from '@/stores/bell'
import type { Pending } from '@/api/approvals'
import type { ReturnedItem } from '@/api/review'
import type { Notice } from '@/api/notices'
import type { PendingItem } from '@/types/review'
import type { ReleaseNote } from '@/types/changelog'
import api from '@/api'
import NotifyPanel from '@/components/shell/NotifyPanel.vue'

const push = vi.fn(landNav)
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve()),
    put: vi.fn(() => Promise.resolve({ users: [], evictions: [], approvals: [], outcome: null })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 't'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))
// 「v… 更新了什么」第二行的件数:钉一份和 06-F 一样的更新(重点卡 1 + 新增 2 + 改进 2 = 「新增 3 项 · 改进 2 项」)
const NOTE: ReleaseNote = {
  version: '0.0.0', date: '2026-10-01', headline: 'x',
  feature: { icon: 'bell', title: '铃铛', desc: 'x' },
  added: [{ icon: 'bell', title: 'a', desc: 'x' }, { icon: 'bell', title: 'b', desc: 'x' }],
  improved: [{ icon: 'bell', title: 'c', desc: 'x' }, { icon: 'bell', title: 'd', desc: 'x' }],
  fixed: [],
}
vi.mock('@/changelog', async (orig) => ({ ...(await orig<typeof import('@/changelog')>()), noteOf: () => NOTE }))
// bell store 换成桩:面板只读它的明细 / 错误槽 / 系统两项,调它的三个动作。取明细、标看过是 bell.spec 的事。
vi.mock('@/stores/bell', async () => {
  const { reactive } = await import('vue')
  const s = reactive({
    red: 0, reviews: [] as unknown[], returned: [] as unknown[], notices: [] as unknown[],
    noticesErr: null as string | null, noticesLoaded: true, newVersion: null as string | null, changelogUnread: false,
    newVersionRead: false, changelogRead: false,
    closePanel: vi.fn(), markAllRead: vi.fn(), loadNotices: vi.fn(),
  })
  return { useBellStore: () => s }
})

type Fake = {
  red: number; reviews: (PendingItem & { submittedByName?: string | null })[]; returned: ReturnedItem[]; notices: Notice[]
  noticesErr: string | null; noticesLoaded: boolean; newVersion: string | null; changelogUnread: boolean
  newVersionRead: boolean; changelogRead: boolean
  closePanel: ReturnType<typeof vi.fn>; markAllRead: ReturnType<typeof vi.fn>; loadNotices: ReturnType<typeof vi.fn>
}
const bell = useBellStore() as unknown as Fake
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const AP: Pending = {
  id: 'a1', requester: 'zhang', requesterName: '张会计', requesterRole: '会计',
  perms: ['meter-reading:edit'], permLabels: ['抄表读数'],
  page: '园区抄表 · 2026 年', action: '改读数', impact: '影响 B座 3 块表', leftMs: 102_000,
}
const RV: PendingItem & { submittedByName: string } = {
  key: 'ledger:3:2024-02', kind: 'ledger', scope: '3', period: '2024-02',
  label: '月度台账 2024-02', submittedBy: 'li', submittedByName: '李出纳', submittedAt: minsAgo(10),
}
const RT: ReturnedItem = {
  key: 'meters:2026-08', kind: 'meters', scope: null, period: '2026-08', label: '园区抄表 2026-08',
  reviewedBy: 'lishen', reviewedByName: '李审', reviewedAt: minsAgo(5), reason: 'B座 3 块表读数比上月小',
}
const N_OK: Notice = {
  id: 11, kind: 'approval_approved', title: '王主管批准了你的授权', detail: '30 分钟内可以改读数',
  ref: null, actor: 'wang', actorName: '王主管', createdAt: minsAgo(2), seen: false,
}
const N_BILL: Notice = {
  id: 12, kind: 'bill_unconfirmed', title: '陈会计取消确认了联塑精铟 9 月的催缴单', detail: '租金按新合同重算',
  ref: 'bill-notices:2026-09', actor: 'chen', actorName: '陈会计', createdAt: minsAgo(30), seen: true,
}

let w: VueWrapper | null = null
function open() {
  w = mount(NotifyPanel, { attachTo: document.body })
  return w
}
/** 面板挂在 body 上(Teleport),wrapper 里查不到,从 body 上取 */
const np = () => new DOMWrapper(document.body.querySelector('.np')!)
const rowOf = (text: string) => np().findAll('.np-row').find((r) => r.text().includes(text))!
const heads = () => np().findAll('.np-gh').map((h) => h.text())

beforeEach(() => {
  setActivePinia(createPinia()); ourPark()
  vi.clearAllMocks()
  for (const k of Object.keys(localStorage)) if (k.startsWith('fp-app-')) localStorage.removeItem(k)
  Object.assign(bell, { red: 0, reviews: [], returned: [], notices: [], noticesErr: null, noticesLoaded: true,
    newVersion: null, changelogUnread: false, newVersionRead: false, changelogRead: false })
})
afterEach(() => { w?.unmount(); w = null; document.body.innerHTML = '' })

describe('铃铛面板 · 分组', () => {
  // 破坏验证:把「系统」段挪到「有结果了」前面 → 红
  it('❗三组按 等你处理 → 有结果了 → 系统 排,组头写等你处理的件数(= 红数字)', () => {
    usePresenceStore().approvals = [AP]
    Object.assign(bell, { red: 4, reviews: [RV], notices: [N_OK], newVersion: '9.9.9' })
    open()
    expect(heads()).toEqual(['等你处理4', '有结果了', '系统'])
  })

  // 破坏验证:把 hasTodo 那几项全换成 true(空组也出组头)→ 红
  it('❗都没有时不留空组,只给一句「现在没有通知」', () => {
    open()
    expect(heads()).toEqual([])
    expect(np().text()).toContain('现在没有通知')
    expect(np().find('.np-foot').exists()).toBe(false)
  })

  // 破坏验证:hasResults 去掉「没取回来过且有没看的结果」那一项 → 第一段红;去掉 v-else-if="resultsPending" → 第二段红
  it('❗清单还没取回来:蓝点在叫人看,「有结果了」先写「加载中…」;什么都没有时也不先说「现在没有通知」', async () => {
    Object.assign(bell, { noticesLoaded: false })
    usePresenceStore().unseenResults = 2
    open()
    expect(heads()).toEqual(['有结果了'])
    expect(rowOf('加载中…').exists()).toBe(true)
    expect(np().text()).not.toContain('现在没有通知')
    w!.unmount()
    usePresenceStore().unseenResults = 0
    open()
    expect(heads()).toEqual([])
    expect(np().text()).toContain('加载中…')
    expect(np().text()).not.toContain('现在没有通知')
  })
})

describe('铃铛面板 · 授权请求当场处理(原 FPApprovalDrawer)', () => {
  // 破坏验证:mss 的分钟补零(padStart)→「01:42」→ 红;把权限点胶囊加回来 → 红
  it('❗压成两行:谁请你授权做什么 / 哪一屏 · 影响谁,右边剩余「1:42」;不再列权限点', () => {
    usePresenceStore().approvals = [AP]
    open()
    const r = rowOf('张会计')
    expect(r.find('.np-t').text()).toBe('张会计请你授权改读数')
    expect(r.find('.np-s').text()).toBe('园区抄表 · 2026 年 · 影响 B座 3 块表')
    expect(r.find('.np-left').text()).toBe('1:42')
    expect(r.text()).not.toContain('抄表读数')
    expect(r.find('.np-note').text()).toBe('批准后他 30 分钟内能改，日志同时记你们两人')
  })

  // 破坏验证:decide 里成功后不从 presence.approvals 摘掉 → 红;批准不带密码 → 红
  it('❗输自己的密码点批准 → decide(id, true, 密码),这一条当场摘掉', async () => {
    usePresenceStore().approvals = [AP]
    open()
    const input = rowOf('张会计').find('input')
    await input.trigger('focus')
    await input.setValue('pw1')
    await rowOf('张会计').findAll('button').find((b) => b.text() === '批准')!.trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/auth/approvals/a1', { approve: true, password: 'pw1' })
    expect(usePresenceStore().approvals).toEqual([])
  })

  // 破坏验证:拒绝也带上密码(`approve ? pw : undefined` 改成 pw)→ 红
  it('拒绝不用密码', async () => {
    usePresenceStore().approvals = [AP]
    open()
    await rowOf('张会计').find('input').setValue('pw1')
    await rowOf('张会计').findAll('button').find((b) => b.text() === '拒绝')!.trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/auth/approvals/a1', { approve: false, password: undefined })
  })

  // 破坏验证:去掉 :readonly 那条绑定 → 红;两条共用一个密码(v-model 不按 p.id 分)→ 红
  it('❗密码框反自动填充:挂上时只读、autocomplete=off、每条一个 name;聚焦哪条才解哪条,各输各的', async () => {
    const AP2: Pending = { ...AP, id: 'a2', requester: 'li', requesterName: '李会计' }
    usePresenceStore().approvals = [AP, AP2]
    open()
    const in1 = rowOf('张会计').find('input')
    const in2 = rowOf('李会计').find('input')
    expect(in1.attributes('readonly'), '聚焦前只读:浏览器不往只读框里填').toBeDefined()
    expect(in1.attributes('autocomplete')).toBe('off')
    expect([in1.attributes('name'), in2.attributes('name')]).toEqual(['fp-approve-a1', 'fp-approve-a2'])
    await in1.trigger('focus')
    expect(in1.attributes('readonly')).toBeUndefined()
    expect(in2.attributes('readonly'), '聚焦一条不解锁另一条').toBeDefined()
    await in1.setValue('pw1')
    const approve = (who: string) => rowOf(who).findAll('button').find((b) => b.text() === '批准')!
    expect(approve('张会计').attributes('disabled')).toBeUndefined()
    expect(approve('李会计').attributes('disabled'), '另一条没输密码,批准仍不可点').toBeDefined()
  })

  // 破坏验证:后果行写死成那句、不读 err → 红
  it('❗批准失败:后果那一行换成报错(同一行位,不长新行),密码清空', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ message: '密码不对' })
    usePresenceStore().approvals = [AP]
    open()
    await rowOf('张会计').find('input').setValue('bad')
    await rowOf('张会计').findAll('button').find((b) => b.text() === '批准')!.trigger('click')
    await flushPromises()
    const note = rowOf('张会计').find('.np-note')
    expect(note.text()).toBe('密码不对')
    expect(note.classes()).toContain('err')
    expect((rowOf('张会计').find('input').element as HTMLInputElement).value).toBe('')
  })
})

describe('铃铛面板 · 待审 / 被退回逐张列出', () => {
  // 破坏验证:goItem 的 periodLink 换成裸 '/data-home' → 红。这是「点进去还得自己翻月份」的根因。
  it('❗待审一行一张表,写谁交的;点整行 → 那张表那个月(带公司),并关面板', async () => {
    Object.assign(bell, { red: 1, reviews: [RV] })
    open()
    const r = rowOf('月度台账')
    expect(r.find('.np-t').text()).toBe('月度台账 2024-02 等你审')
    expect(r.find('.np-s').text()).toBe('李出纳交 · 10 分钟前')
    await r.trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/ledger', query: { p: '2024-02', co: '3' } })
    expect(w!.emitted('close')).toBeTruthy()
  })

  // 破坏验证:go() 里 tabs.openFresh(v) 换成 tabs.openDeep(v)(页面里的链接:开在右边新页签)→ 红
  it('❗铃铛是外壳上的入口:在当前页签打开,不是开到右边新页签(TAB-BAR-SPEC §2 例外)', async () => {
    const tabs = useTabsStore()
    await landNav('/meters')
    expect(tabs.tabs.map((t) => t.value)).toEqual(['home', 'meters'])
    Object.assign(bell, { red: 1, reviews: [RV] })
    open()
    await rowOf('月度台账').trigger('click')
    expect(tabs.tabs.map((t) => t.value)).toEqual(['home', 'ledger'])
  })

  // 破坏验证:returnedSub 不写理由 → 红
  it('❗被退回一行一张表,写审核人和理由;点了去那张表那个月', async () => {
    Object.assign(bell, { red: 1, returned: [RT] })
    open()
    const r = rowOf('被退回')
    expect(r.find('.np-t').text()).toBe('你交的园区抄表 2026-08 被退回')
    expect(r.find('.np-s').text()).toBe('李审：B座 3 块表读数比上月小 · 5 分钟前')
    await r.trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/meters', query: { p: '2026-08' } })
  })

  // 破坏验证:删掉 reviewFallback 那一行 → 红。明细是锦上添花,数字才是那句「有事等你」。
  it('❗明细没到(取不到)时退回「几件 + 一个去处」,不把整段藏起来', async () => {
    usePresenceStore().pendingReviews = 2
    usePresenceStore().myReturned = 1
    Object.assign(bell, { red: 3 })
    open()
    expect(np().text()).toContain('有 2 张表等你审')
    expect(np().text()).toContain('你交的 1 张表被退回了')
    await rowOf('有 2 张表等你审').trigger('click')
    expect(push).toHaveBeenCalledWith('/data-home')
  })
})

describe('铃铛面板 · 有结果了', () => {
  // 破坏验证:小蓝点去掉 v-if="!n.seen"(每行都挂)→ 红
  it('❗上次打开之后新来的行挂小蓝点,看过的不挂', () => {
    Object.assign(bell, { notices: [N_OK, N_BILL] })
    open()
    expect(rowOf('王主管').find('.np-dot').exists()).toBe(true)
    expect(rowOf('陈会计').find('.np-dot').exists()).toBe(false)
  })

  // 破坏验证:去掉行上的 read: n.seen → 红
  it('❗看过的行标题变灰(挂 read),没看过的不挂(06-F)', () => {
    Object.assign(bell, { notices: [N_OK, N_BILL] })
    open()
    expect(rowOf('陈会计').classes()).toContain('read')
    expect(rowOf('王主管').classes()).not.toContain('read')
  })

  // 破坏验证:noticeSub 里审核类不加审核人 / 别的类也加 → 红
  it('第二行:审核类先写审核人,别的类只写说明 · 时刻', () => {
    const wd: Notice = { ...N_BILL, id: 13, kind: 'review_withdrawn', title: '附表6 光伏 2026 的审核被撤销',
      detail: '上网电量改按新口径', actorName: '李审', ref: 'pv:2026-01' }
    Object.assign(bell, { notices: [N_OK, wd] })
    open()
    expect(rowOf('王主管').find('.np-s').text()).toBe('30 分钟内可以改读数 · 2 分钟前')
    expect(rowOf('审核被撤销').find('.np-s').text()).toBe('李审：上网电量改按新口径 · 30 分钟前')
  })

  // 破坏验证:targetOf 恒回 null(有结果了一律不跳)→ 红
  it('❗带去处的行点整行跳过去;授权结果这类没有去处的不是按钮、不带 ›', async () => {
    Object.assign(bell, { notices: [N_OK, N_BILL] })
    open()
    expect(rowOf('王主管').element.tagName).toBe('DIV')
    expect(rowOf('王主管').find('.np-arw').exists()).toBe(false)
    await rowOf('陈会计').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/bill-notices', query: { p: '2026-09' } })
  })

  // 破坏验证:删掉 noticesErr 那一行 → 红(独立错误槽要有出口)
  it('清单没取到:说没取到,给「重试」', async () => {
    Object.assign(bell, { noticesErr: '服务器没有响应' })
    open()
    expect(np().text()).toContain('没取到：服务器没有响应')
    await np().findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    expect(bell.loadNotices).toHaveBeenCalledTimes(1)
  })
})

describe('铃铛面板 · 系统', () => {
  // 破坏验证:新版本行的 v-if 改成 changelogUnread → 红
  it('❗服务器有新版 → 「灵睿已更新到 v…」带「刷新」;编辑中第二行改说保存后再刷新', async () => {
    Object.assign(bell, { newVersion: '0.25.0' })
    open()
    const r = rowOf('已更新到')
    expect(r.find('.np-t').text()).toBe('灵睿已更新到 v0.25.0')
    expect(r.find('.np-s').text()).toBe('刷新后生效')
    expect(r.find('.np-act').text()).toBe('刷新')
    useAuthStore().openEditor(Symbol('meters'), 'meters')
    await flushPromises()
    expect(rowOf('已更新到').find('.np-s').text()).toBe('你正在编辑，保存后再刷新')
  })

  // 破坏验证:seeHistory 里不调 openHistory → 红;noteCounts 不算重点卡 → 红
  it('❗没看过的更新记录 → 「v… 更新了什么」写件数,点「看看」开更新记录并关面板', async () => {
    Object.assign(bell, { changelogUnread: true })
    const update = useUpdateStore()
    const spy = vi.spyOn(update, 'openHistory').mockImplementation(() => {})
    open()
    const r = rowOf('更新了什么')
    expect(r.find('.np-t').text()).toBe(`v${update.version} 更新了什么`)
    expect(r.find('.np-s').text()).toBe('新增 3 项 · 改进 2 项')
    await r.find('.np-act').trigger('click')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(w!.emitted('close')).toBeTruthy()
  })

  // 破坏验证:系统两行的 read 绑定去掉 / 读反 → 红
  it('❗系统组:上次开铃铛时就在的那一行变灰,新来的不灰(06-F:「已更新到」黑、「更新了什么」灰)', () => {
    Object.assign(bell, { newVersion: '0.25.0', newVersionRead: false, changelogUnread: true, changelogRead: true })
    open()
    expect(rowOf('已更新到').classes()).not.toContain('read')
    expect(rowOf('更新了什么').classes()).toContain('read')
  })

  // 破坏验证:去掉「全部标为已读」的 @click → 红
  it('❗底部「全部标为已读」调 bell.markAllRead', async () => {
    Object.assign(bell, { notices: [N_OK] })
    open()
    await np().find('.np-foot .np-act').trigger('click')
    expect(bell.markAllRead).toHaveBeenCalledTimes(1)
  })
})

describe('铃铛面板 · 贴附浮层(UI-OVERLAY-SPEC §7.1)', () => {
  // 破坏验证:onDoc 不判 contains(按在面板里也关)→ 红;不挂 mousedown 监听 → 红
  it('❗按在面板外关,按在面板里不关', () => {
    Object.assign(bell, { notices: [N_OK] })
    open()
    rowOf('王主管').element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(w!.emitted('close')).toBeFalsy()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(w!.emitted('close')).toHaveLength(1)
  })

  // 破坏验证:onKey 去掉 stopPropagation → 红(底下的抽屉也听 Esc,会连宿主一起关)
  it('❗Esc 只关自己:关面板,事件不再往下传', () => {
    open()
    const below = vi.fn()
    window.addEventListener('keydown', below)
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(w!.emitted('close')).toHaveLength(1)
      expect(below).not.toHaveBeenCalled()
    } finally { window.removeEventListener('keydown', below) }
  })

  // 破坏验证:Teleport 加回 :disabled="!mobile"(桌面留在顶栏里)→ 红。顶栏有 backdrop-filter,自成层叠上下文,
  // 面板留在里面会被内容区的 sticky 表头 / 带定位的块盖住(层叠 jsdom 测不出,浏览器实测见收口消息)。
  // 破坏验证:place() 的 +6 改 +8 / right 不按铃铛右沿算 → 红
  it('❗桌面也挂到 body 上:上沿在顶栏下沿线下 6px,右沿对齐铃铛;手机贴顶栏下方满宽', () => {
    const bar = document.createElement('header')
    const nb = document.createElement('span')
    bar.appendChild(nb)
    document.body.appendChild(bar)
    bar.getBoundingClientRect = () => ({ top: 0, bottom: 48, left: 0, right: 1024, width: 1024, height: 48, x: 0, y: 0, toJSON: () => ({}) })
    nb.getBoundingClientRect = () => ({ top: 10, bottom: 38, left: 972, right: 1000, width: 28, height: 28, x: 972, y: 10, toJSON: () => ({}) })
    w = mount(NotifyPanel, { props: { anchor: nb }, attachTo: document.body })
    const np = document.body.querySelector<HTMLElement>(':scope > .np')
    expect(np, '桌面面板是 body 的直接子节点').not.toBeNull()
    expect(np!.classList.contains('np-m')).toBe(false)
    expect([np!.style.top, np!.style.right]).toEqual(['54px', `${window.innerWidth - 1000}px`])
    w.unmount()
    w = mount(NotifyPanel, { props: { mobile: true, anchor: nb }, attachTo: document.body })
    const m = document.body.querySelector<HTMLElement>(':scope > .np.np-m')
    expect(m).not.toBeNull()
    expect(m!.style.top, '手机的位置在样式表里(贴顶栏下方),不写内联').toBe('')
  })

  // 破坏验证:删掉 onUnmounted 里摘监听那几句 → 红
  it('关时摘掉 document 上的两个监听', () => {
    const rm = vi.spyOn(document, 'removeEventListener')
    open()
    w!.unmount(); w = null
    expect(rm).toHaveBeenCalledWith('mousedown', expect.any(Function), true)
    expect(rm).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    rm.mockRestore()
  })
})

// 长什么样(06-F;DS hints.card .nf-*):把组件自己的 <style> 塞进 document 读 getComputedStyle(同 notifyBell.spec 的做法;
// 令牌 jsdom 不求值,判据是令牌名)。:deep(x) 换成 x —— scoped 编译之后它就是后代选择器。
describe('铃铛面板 · 长什么样(06-F)', () => {
  const css = [...readFileSync(join(__dirname, '../NotifyPanel.vue'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1]).join('\n').replace(/:deep\(([^)]*)\)/g, '$1')
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  afterAll(() => style.remove())
  /** html 里 [data-k] 那个元素的计算样式 */
  const look = (html: string) => {
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    const s = getComputedStyle(host.querySelector('[data-k]')!)
    const r = { color: s.color, align: s.alignItems, alignSelf: s.alignSelf, top: s.top, h: s.height, radius: s.borderRadius }
    host.remove()
    return r
  }

  // 破坏验证:.np-row.read .np-t 那条删掉 / 改色 → 红
  it('❗看过的行标题 --text-secondary(DS .nf-row.read .nf-t)', () => {
    expect(look('<div class="np-row read"><span class="np-t" data-k></span></div>').color).toBe('var(--text-secondary)')
  })

  // 破坏验证:.np-row 改回 align-items:center → 红;.np-dot 改回 top:50% → 红
  it('❗两行字的行图标格顶对齐;小蓝点和图标格同一条中线(top 19)', () => {
    expect(look('<div class="np-row" data-k></div>').align).toBe('flex-start')
    expect(look('<div class="np-row"><i class="np-dot" data-k></i></div>').top).toBe('19px')
  })

  // 破坏验证:› 改回 --text-disabled / 不自己居中 → 红;size 改回 16 → 红
  it('❗行尾 › 是 12 号、--text-muted,自己竖向居中', () => {
    expect(look('<div class="np-row"><svg class="np-arw" data-k></svg></div>')).toMatchObject({ color: 'var(--text-muted)', alignSelf: 'center' })
    Object.assign(bell, { red: 1, reviews: [RV] })
    open()
    expect(rowOf('月度台账').find('svg.np-arw').attributes('width')).toBe('12')
  })

  // 破坏验证:倒计时改回 --warn-text → 红
  it('❗授权倒计时「1:42」用 --orange-text', () => {
    expect(look('<span class="np-left" data-k></span>').color).toBe('var(--orange-text)')
  })

  // 破坏验证:密码框高度那条删掉 → 红;头像圆角那条删掉 / 不挂 np-av → 红
  it('❗密码框 28 高(和两颗 sm 按钮一样高);头像是 28 方块、圆角 --radius-sm', () => {
    expect(look('<div class="np-pw"><div class="ds-in-field" data-k></div></div>').h).toBe('28px')
    expect(look('<span class="np-av" data-k></span>').radius).toBe('var(--radius-sm)')
    usePresenceStore().approvals = [AP]
    open()
    expect(rowOf('张会计').find('.np-av').exists()).toBe(true)
  })
})
