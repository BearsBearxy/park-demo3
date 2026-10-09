// 角色权限屏(RBAC-SPEC §15.9)。钉会真出事的契约:
// ① 权限点跟后端走(按后端给的 screen / kind 挂到导航表的层 → 分组 → 屏,不硬编码),每屏一行:查看 | 编辑 | 其他动作;
// ② 无 sys-roles:edit 时照常显示当前配置与成员,只是全部 disabled、没有保存/新建/删除/添加成员/移出;
// ③ 删除只对自定义角色出现,且有成员时禁用(预置角色一律无删除按钮);
// ④ 勾编辑或动作自动带上本屏查看,取消查看连带取消本屏全部动作;层 / 分组行三态勾选管整列;
// ⑤ 系统管理分级(RBAC-SPEC §12):不是系统管理员的,比自己大的角色整块只读,自己没有的权限那一格置灰;
// ⑥ 成员栏:增减先记在表单里、计入改动数、和权限一起保存(增量);自己 / 最后一个启用的系统管理员 / 管不了的账号置灰并写原因;
//    切回页签时表单干净三样重取,有改动只重取账号、勾选不动、已失效的待办去掉。
//    ①–④⑥ 的用例都以系统管理员身份挂载(不受分级限制),⑤ 单独以「只管角色的人」挂载。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { askQueue, answer } from '@/utils/ask'
import type { PermDTO, RoleDTO, UserDTO } from '@/types/system'

const P = (key: string, label: string, screen: string | null, kind: PermDTO['kind']): PermDTO => ({ key, label, hint: `${label}的说明`, screen, kind })
const PERMS = {
  perms: [
    P('data-home:view', '本月出账 · 查看', 'data-home', 'view'),
    P('buildings:view', '楼栋管理 · 查看', 'buildings', 'view'),
    P('buildings:edit', '楼栋管理 · 编辑', 'buildings', 'edit'),
    P('tenants:view', '租户管理 · 查看', 'tenants', 'view'),
    P('tenants:edit', '租户管理 · 编辑', 'tenants', 'edit'),
    P('ledger:view', '月度台账 · 查看', 'ledger', 'view'),
    P('ledger:edit', '月度台账 · 编辑', 'ledger', 'edit'),
    P('ledger:template', '月度台账 · 账册模板', 'ledger', 'action'),
    P('ledger:company', '月度台账 · 新增删除公司', 'ledger', 'action'),
    P('salary:view', '附表12 工资明细 · 查看', 'salary', 'view'),
    P('salary:edit', '附表12 工资明细 · 编辑', 'salary', 'edit'),
    P('cockpit:view', '经营驾驶舱 · 查看', 'cockpit', 'view'),
    P('sys-users:view', '用户管理 · 查看', 'sys-users', 'view'),
    P('sys-roles:view', '角色权限 · 查看', 'sys-roles', 'view'),
    P('sys-roles:edit', '角色权限 · 编辑', 'sys-roles', 'edit'),
    P('lock:takeover', '编辑锁 · 授权', null, 'other'),
  ],
  navLayers: [
    { id: 'data', label: '数据中心' },
    { id: 'reports', label: '账簿与报表' },
    { id: 'analysis', label: '经营分析' },
  ],
}
const ADMIN_PERMS = PERMS.perms.map(p => p.key)
const ROLES: RoleDTO[] = [
  { id: 1, code: 'admin', name: '系统管理员', builtin: true, navLayers: ['data', 'reports', 'analysis'], perms: ADMIN_PERMS, userCount: 3, remark: null },
  { id: 7, code: 'auditor', name: '外部审计', builtin: false, navLayers: ['reports'], perms: ['ledger:view', 'ledger:edit'], userCount: 0, remark: null },
  { id: 8, code: 'clerk2', name: '兼职文员', builtin: false, navLayers: ['data'], perms: [], userCount: 3, remark: null },
]
const ref_ = (id: number) => ({ id, code: ROLES.find(r => r.id === id)!.code, name: ROLES.find(r => r.id === id)!.name })
const U = (id: number, username: string, displayName: string, roleIds: number[], o: Partial<UserDTO> = {}): UserDTO =>
  ({ id, username, displayName, status: 1, mustChangePassword: false, roles: roleIds.map(ref_), createdAt: '', manageable: true, ...o })
// 我 = sec(兼职文员,有角色权限的编辑);系统管理员角色里 boss 是唯一启用的,ghost 停用了
const USERS: UserDTO[] = [
  U(1, 'sec', '安全员', [8]),
  U(2, 'boss', '王总', [1]),
  U(3, 'ghost', '离职的', [1], { status: 0 }),
  U(4, 'zhou', '周会计', [8]),
  U(5, 'old', '老账号', [8], { status: 0 }),
  U(6, 'li', '李出纳', []),
  U(7, 'wang', '王股东', [], { manageable: false }),
  U(9, 'qian', '钱专员', [8]),
]

const roles = vi.fn()
const users = vi.fn()
const perms = vi.fn()
const removeRole = vi.fn()
const createRole = vi.fn()
const updateRole = vi.fn()
vi.mock('@/api/system', () => ({
  systemApi: {
    perms: () => perms(),
    roles: () => roles(),
    users: () => users(),
    removeRole: (...a: unknown[]) => removeRole(...a),
    createRole: (...a: unknown[]) => createRole(...a),
    updateRole: (...a: unknown[]) => updateRole(...a),
  },
}))

import SystemRolesView from './SystemRolesView.vue'

function login(perms_: string[], superAdmin = true) {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.permissions = perms_
  auth.superAdmin = superAdmin
  auth.me = 'sec'
  vi.spyOn(auth, 'endElevation').mockResolvedValue()
  return auth
}
function mountWith(perms_: string[], superAdmin = true) {
  login(perms_, superAdmin)
  return mount(SystemRolesView)
}
const EDITOR = ['sys-roles:view', 'sys-roles:edit']

beforeEach(() => {
  localStorage.clear()
  askQueue.splice(0)
  for (const f of [roles, users, perms, removeRole, createRole, updateRole]) f.mockReset()
  perms.mockImplementation(() => Promise.resolve(PERMS))
  roles.mockImplementation(() => Promise.resolve(ROLES))
  users.mockImplementation(() => Promise.resolve(USERS))
  updateRole.mockImplementation((id: number) => Promise.resolve(ROLES.find(r => r.id === id)))
})
type TipEl = HTMLElement & { _tip?: { text: string } }
type W = ReturnType<typeof mount>
const box = (w: W, key: string) => w.find(`input[data-perm="${key}"]`)
const on = (w: W, key: string) => (box(w, key).element as HTMLInputElement).checked
const tipOf = (el: Element | undefined | null) => (el as TipEl | null)?._tip?.text
/** 权限树 + 不分屏的权限 + 导航可见层里全部复选框 */
const allBoxes = (w: W) => w.findAll('.sr-main input[type="checkbox"]')
const pickRole = async (w: W, name: string) => {
  await w.findAll('.sr-item').find(b => b.find('.sr-item-n').text() === name)!.trigger('click')
  await flushPromises()
}
const memberNames = (w: W) => w.findAll('.sr-memrow').map(r => r.attributes('data-user'))
const memberRow = (w: W, u: string) => w.find(`.sr-memrow[data-user="${u}"]`)
const rowBtn = (w: W, u: string) => memberRow(w, u).find('.sr-memact')
const openAdd = async (w: W) => { await w.find('.sr-memadd').trigger('click'); await nextTick() }
const cand = (w: W, u: string) => w.find(`.sr-cand[data-user="${u}"]`)

describe('权限树', () => {
  it('权限点跟后端返回走,按导航表的层 → 分组 → 屏挂;每屏查看 | 编辑 | 其他动作;跨屏的另列一段', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    // 16 个权限点 + 3 个导航层 = 19 个格子,一个不少;另有层 / 分组行的三态表头
    expect(w.findAll('.sr-main input[data-perm]').length).toBe(16)
    expect(w.findAll('.sr-tr-l').map(r => r.attributes('data-layer'))).toEqual(['data', 'analysis', 'system'])
    expect(w.findAll('.sr-tr-g').map(r => r.attributes('data-group'))).toEqual(['档案', '记账 · 按月'])
    expect(w.findAll('.sr-tr-s').map(r => r.attributes('data-screen')))
      .toEqual(['data-home', 'buildings', 'tenants', 'ledger', 'salary', 'cockpit', 'sys-users', 'sys-roles'])
    const ledger = w.find('.sr-tr-s[data-screen="ledger"]')
    expect(ledger.find('.sr-rowlbl').text()).toBe('月度台账')
    expect(ledger.find('.sr-rowhint').text(), '屏名下面一行是查看那一项的说明').toBe('月度台账 · 查看的说明')
    expect(ledger.find('.sr-tacts').text(), '动作格只写动作名').toBe('账册模板新增删除公司')
    expect(w.find('.sr-tr-s[data-screen="data-home"]').findAll('.sr-tc')[1].text(), '本月出账没有编辑').toBe('—')
    expect(w.find('.sr-tr-l[data-layer="analysis"] [data-col="action"]').exists(), '经营分析一个动作都没有:表头画「—」').toBe(false)
    expect(w.text()).toContain('不分屏的权限')
    expect(box(w, 'lock:takeover').exists()).toBe(true)
    // 默认选中第一个角色,其已有权限勾上
    expect(on(w, 'ledger:company')).toBe(true)
  })

  // ❗破坏验证:onKey 里改成只 toggle 本格(不走 toggleKey)→ 红
  it('❗勾动作自动带上本屏查看;取消查看连带取消本屏全部动作,别的屏不动', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    await pickRole(w, '兼职文员')
    await box(w, 'ledger:template').trigger('change')
    expect([on(w, 'ledger:view'), on(w, 'ledger:edit'), on(w, 'ledger:template')]).toEqual([true, false, true])
    await box(w, 'salary:edit').trigger('change')
    await box(w, 'ledger:view').trigger('change')
    expect([on(w, 'ledger:view'), on(w, 'ledger:template')]).toEqual([false, false])
    expect([on(w, 'salary:view'), on(w, 'salary:edit')], '同组的工资不动').toEqual([true, true])
  })

  // ❗破坏验证:onCol 不调 toggleCol(什么都不做)→ 红;表头 :indeterminate 去掉 → 「部分」那一步红
  it('❗分组行的三态表头:部分时半勾;点一下全勾(带上查看),再点一下全清', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    await pickRole(w, '兼职文员')
    const head = () => w.find('.sr-tr-g[data-group="档案"] input[data-col="edit"]')
    const st = () => [(head().element as HTMLInputElement).checked, (head().element as HTMLInputElement).indeterminate]
    expect(st()).toEqual([false, false])
    await box(w, 'tenants:edit').trigger('change')
    expect(st(), '部分').toEqual([false, true])
    await head().trigger('change')
    expect(st(), '全勾').toEqual([true, false])
    expect(['buildings:view', 'buildings:edit', 'tenants:view', 'tenants:edit'].map(k => on(w, k))).toEqual([true, true, true, true])
    await head().trigger('change')
    expect(['buildings:edit', 'tenants:edit'].map(k => on(w, k)), '全清编辑,查看留着').toEqual([false, false])
    expect(['buildings:view', 'tenants:view'].map(k => on(w, k))).toEqual([true, true])
  })

  // 只读时三态按角色实际勾的算,不排除「我缺的」:只有角色权限查看的人去看系统管理员角色,
  // 数据中心那一行的「查看」表头和下面各屏一样是勾上的,不是灰着的空框
  // 破坏验证:tri 不看 canEditRole(照旧排除我缺的)→ 红
  it('❗只读、我自己缺的项很多:层行三态照角色实际勾的画', async () => {
    const w = mountWith(['sys-roles:view', 'cockpit:view'], false)
    await flushPromises()
    expect(on(w, 'data-home:view'), '前提:看的是系统管理员角色,全勾着').toBe(true)
    const head = w.find('.sr-tr-l[data-layer="data"] input[data-col="view"]').element as HTMLInputElement
    expect([head.checked, head.indeterminate, head.disabled]).toEqual([true, false, true])
  })

  // 破坏验证:导航可见层每行加回 <code>{{ l.id }}</code> → 红;副标题改回「每一屏分「查看」和「编辑」」→ 红
  it('导航可见层只写层名,不印 data / reports 这类代码;副标题不说每屏都有编辑', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    const sec = w.findAll('.sr-sec').find(x => x.text().includes('导航可见层'))!
    expect(sec.text()).not.toMatch(/\b(data|reports|analysis)\b/)
    expect(w.find('.sr-sub').text()).toContain('每一屏有「查看」，能改数据的屏另有「编辑」')
  })

  it('无 sys-roles:edit:照显当前配置与成员,但全部禁用,没有任何写入口', async () => {
    const w = mountWith(['sys-roles:view'])
    await flushPromises()
    const boxes = w.findAll('.sr-main input[type="checkbox"]')
    expect(boxes.length).toBeGreaterThan(16)
    expect(boxes.every(b => (b.element as HTMLInputElement).disabled)).toBe(true)
    expect(on(w, 'ledger:company')).toBe(true)                          // 配置照样看得见
    expect(w.find('.sr-act').exists()).toBe(false)                      // 没有保存/取消
    expect(w.find('.sr-item.add').exists()).toBe(false)                 // 没有新建角色
    expect(memberNames(w)).toEqual(['boss', 'ghost'])                   // 成员照列
    expect(w.find('.sr-memadd').exists()).toBe(false)
    expect(w.findAll('.sr-memact')).toHaveLength(0)
    expect(w.find('.sr-ro').text()).toBe('只读：改角色需要「角色权限 · 编辑」。')
  })
})

describe('成员栏', () => {
  it('本角色成员 = 账号列表里挂着这个角色的;停用的带「已停用」,自己带「你」;没有成员时说一句', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    expect(w.find('.sr-mem .sr-sectitle').text()).toBe('本角色成员（2）')
    expect(memberNames(w)).toEqual(['boss', 'ghost'])
    expect(memberRow(w, 'ghost').text()).toContain('已停用')
    await pickRole(w, '兼职文员')
    expect(memberRow(w, 'sec').text()).toContain('你')
    expect(memberRow(w, 'zhou').text()).not.toContain('你')
    await pickRole(w, '外部审计')
    expect(w.find('.sr-mem').text()).toContain('还没有账号用这个角色')
  })

  // 破坏验证:memberLock 去掉自己那一档 → 红;去掉最后一个系统管理员那一档 → 红
  it('❗自己那一行、最后一个启用的系统管理员:「移出」置灰并写原因;先把另一位标成待移出,剩下那位就成了最后一个', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    expect(rowBtn(w, 'boss').attributes('disabled'), 'boss 是系统管理员角色里唯一启用的').toBeDefined()
    expect(tipOf(rowBtn(w, 'boss').element)).toBe('「boss」是最后一个启用的系统管理员账号，移出后就没有人能管理整个系统了')
    await pickRole(w, '兼职文员')
    expect(rowBtn(w, 'sec').attributes('disabled')).toBeDefined()
    expect(tipOf(rowBtn(w, 'sec').element)).toBe('不能改自己的角色，请另一位管理员操作')
    expect(rowBtn(w, 'zhou').attributes('disabled')).toBeUndefined()

    users.mockImplementation(() => Promise.resolve([...USERS, U(10, 'boss2', '副总', [1])]))
    const w2 = mountWith(EDITOR)
    await flushPromises()
    expect(rowBtn(w2, 'boss').attributes('disabled'), '还有 boss2,boss 不是最后一个').toBeUndefined()
    await rowBtn(w2, 'boss2').trigger('click')
    expect(memberRow(w2, 'boss2').text()).toContain('保存后移出')
    expect(rowBtn(w2, 'boss').attributes('disabled')).toBeDefined()
    expect(tipOf(rowBtn(w2, 'boss').element)).toBe('「boss」是最后一个启用的系统管理员账号，移出后就没有人能管理整个系统了')
    expect(rowBtn(w2, 'ghost').attributes('disabled'), '停用的不算「启用的系统管理员」,照常能移出').toBeUndefined()
  })

  // 破坏验证:memberLock 去掉 manageable 那一档 → 红
  it('❗管不了的账号:候选里置灰、点了不加,悬停写原因', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    await pickRole(w, '外部审计')
    await openAdd(w)
    expect(cand(w, 'wang').attributes('disabled')).toBeDefined()
    expect(tipOf(cand(w, 'wang').element)).toBe('这个账号有你没有的权限，只有系统管理员能改')
    expect(cand(w, 'sec').attributes('disabled'), '自己也置灰').toBeDefined()
    expect(tipOf(cand(w, 'sec').element)).toBe('不能改自己的角色，请另一位管理员操作')
    await cand(w, 'wang').trigger('click')
    expect(memberNames(w)).not.toContain('wang')
  })

  // 破坏验证:dirtyCount 不数成员 → 改动数那两条红;save 不带 addUserIds / removeUserIds → 请求体那条红
  it('❗加一个、移出一个:各算一处改动,和权限一起点「保存」,请求体只带增量', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    await pickRole(w, '兼职文员')
    const auth = useAuthStore()
    await openAdd(w)
    expect(w.findAll('.sr-cand').map(c => c.attributes('data-user')), '候选只列不在本角色的').toEqual(['boss', 'ghost', 'li', 'wang'])
    await w.find('.sr-mem .ds-searchfield input').setValue('李')
    expect(w.findAll('.sr-cand').map(c => c.attributes('data-user')), '按姓名筛').toEqual(['li'])
    await cand(w, 'li').trigger('click')
    expect(memberNames(w)[0], '待加入的排最前').toBe('li')
    expect(memberRow(w, 'li').text()).toContain('保存后加入')
    expect(auth.dirtyTotal).toBe(1)
    // 破坏验证:memberTitle 不分「现 / 保存后」→ 红(和角色头「N 个账号使用中」并排对不上)
    expect(w.find('.sr-mem .sr-sectitle').text(), '有待办时现在和保存后分开写').toBe('本角色成员（现 4，保存后 5）')
    await w.find('.sr-mem .ds-searchfield input').setValue('没这人')
    expect(w.find('.sr-cands').text()).toBe('没有找到这个账号')
    await rowBtn(w, 'zhou').trigger('click')
    expect(memberRow(w, 'zhou').classes()).toContain('out')
    expect(rowBtn(w, 'zhou').text()).toBe('撤销')
    expect(auth.dirtyTotal).toBe(2)
    expect(w.find('.sr-mem .sr-sectitle').text(), '保存后会有几个:4 + 1 − 1').toBe('本角色成员（现 4，保存后 4）')
    await w.findAll('.sr-act button').find(b => b.text() === '保存')!.trigger('click')
    await flushPromises()
    expect(updateRole).toHaveBeenCalledWith(8, { name: '兼职文员', navLayers: ['data'], perms: [], remark: '', addUserIds: [6], removeUserIds: [4] })
  })

  it('撤销待移出、待加入的再点「移出」:都回到原样,改动数归零', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    await pickRole(w, '兼职文员')
    await rowBtn(w, 'zhou').trigger('click')
    await rowBtn(w, 'zhou').trigger('click')                             // 撤销
    await openAdd(w)
    await cand(w, 'li').trigger('click')
    await rowBtn(w, 'li').trigger('click')                               // 待加入的「移出」= 撤掉
    expect(memberNames(w)).toEqual(['sec', 'zhou', 'old', 'qian'])
    expect(useAuthStore().dirtyTotal).toBe(0)
  })

  it('新建角色时也能直接挑成员,请求只带 addUserIds', async () => {
    createRole.mockResolvedValue({ ...ROLES[1], id: 11, name: '出纳' })
    const w = mountWith(EDITOR)
    await flushPromises()
    await w.find('.sr-item.add').trigger('click')
    await flushPromises()
    await w.find('.sr-name').setValue('出纳')
    await w.find('.sr-code').setValue('cashier')
    await openAdd(w)
    expect(w.findAll('.sr-cand')).toHaveLength(USERS.length)
    await cand(w, 'li').trigger('click')
    expect(useAuthStore().dirtyTotal, '标识 + 名称 + 1 个成员').toBe(3)
    await w.findAll('.sr-act button').find(b => b.text() === '新建角色')!.trigger('click')
    await flushPromises()
    expect(createRole).toHaveBeenCalledWith({ code: 'cashier', name: '出纳', navLayers: ['data', 'reports', 'analysis'], perms: [], remark: '', addUserIds: [6] })
  })

  it('候选为空:所有账号都已在这个角色里', async () => {
    users.mockImplementation(() => Promise.resolve(USERS.map(u => ({ ...u, roles: [ref_(8)] }))))
    const w = mountWith(EDITOR)
    await flushPromises()
    await pickRole(w, '兼职文员')
    await openAdd(w)
    expect(w.find('.sr-cands').text()).toBe('所有账号都已在这个角色里')
  })

  // 在用户管理里改了某人的角色,切回角色屏就看得到(和用户管理屏同一个钩子 onReactivated)
  // 破坏验证:onReactivated 不分干净 / 有改动(一律 load)→ 第二条红(勾选被冲掉);不调 pruneMembers → 第二条红
  describe('切回页签', () => {
    const Other = defineComponent({ render: () => h('i') })
    /** 每条用例一份 show:上一条挂着的宿主不能跟着翻 */
    function host() {
      const show = ref(true)
      const Host = defineComponent({ setup: () => () => h(KeepAlive, null, [show.value ? h(SystemRolesView) : h(Other)]) })
      const flip = async () => { show.value = false; await nextTick(); show.value = true; await flushPromises() }
      return { w: mount(Host), flip }
    }

    it('❗表单干净:权限字典、角色、账号三样重取', async () => {
      login(EDITOR)
      const { w, flip } = host()
      await flushPromises()
      expect([perms, roles, users].map(f => f.mock.calls.length)).toEqual([1, 1, 1])
      users.mockImplementation(() => Promise.resolve(USERS.map(u => (u.username === 'li' ? { ...u, roles: [ref_(1)] } : u))))
      await flip()
      expect([perms, roles, users].map(f => f.mock.calls.length)).toEqual([2, 2, 2])
      expect(memberNames(w)).toContain('li')
      w.unmount()
    })

    it('❗表单有改动:只重取账号,勾选不动;别人已经做了的待加入 / 待移出从待办里去掉', async () => {
      login(EDITOR)
      const { w, flip } = host()
      await flushPromises()
      await pickRole(w, '兼职文员')
      await box(w, 'salary:edit').trigger('change')                      // 权限改动 2 处(连带查看)
      await openAdd(w)
      await cand(w, 'li').trigger('click')
      await cand(w, 'boss').trigger('click')
      await rowBtn(w, 'zhou').trigger('click')
      await rowBtn(w, 'qian').trigger('click')
      expect(useAuthStore().dirtyTotal).toBe(2 + 4)
      // 这期间有人在用户管理里:给 li 挂上了兼职文员、把 zhou 从兼职文员里摘掉了
      users.mockImplementation(() => Promise.resolve(USERS.map(u =>
        u.username === 'li' ? { ...u, roles: [ref_(8)] } : u.username === 'zhou' ? { ...u, roles: [] } : u)))
      await flip()
      expect([perms, roles, users].map(f => f.mock.calls.length)).toEqual([1, 1, 2])
      expect([on(w, 'salary:view'), on(w, 'salary:edit')], '勾选没被冲掉').toEqual([true, true])
      expect(memberRow(w, 'li').text(), 'li 已经是成员了,不再是「保存后加入」').not.toContain('保存后加入')
      expect(memberRow(w, 'zhou').exists(), 'zhou 已经不在了').toBe(false)
      expect(memberRow(w, 'boss').text()).toContain('保存后加入')
      expect(memberRow(w, 'qian').text()).toContain('保存后移出')
      expect(useAuthStore().dirtyTotal).toBe(2 + 2)
    })
  })
})

describe('角色本身', () => {
  it('❗有没保存的改动 = 在编辑:登记进 auth.editors(页签条不换掉这一格、关浏览器先问);改回去 / 卸载就撤', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    const auth = useAuthStore()
    expect(auth.editing).toBe(false)
    await w.find('.sr-name').setValue('改个名')
    expect(auth.editing).toBe(true)
    await w.find('.sr-name').setValue('系统管理员')
    expect(auth.editing).toBe(false)
    expect(auth.endElevation, '撤登记顺带结束授权(最后一个编辑态时)').toHaveBeenCalled()
    await w.find('.sr-name').setValue('改个名')
    w.unmount()
    expect(auth.editing).toBe(false)
  })

  it('删除按钮:预置角色没有;自定义角色有,有成员时禁用并写「请先移出」', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    const delBtn = () => w.findAll('button').find(b => b.text().includes('删除角色'))
    expect(delBtn()).toBeUndefined()                                     // 预置(admin)
    await pickRole(w, '外部审计')                                        // 自定义 + 0 账号
    expect(delBtn()?.attributes('disabled')).toBeUndefined()
    await pickRole(w, '兼职文员')                                        // 自定义 + 3 账号
    expect(delBtn()?.attributes('disabled')).toBeDefined()
    expect(tipOf(delBtn()!.element)).toBe('该角色下还有 3 个账号，请先移出')
  })

  it('❗改动数接进 openEditor:改名 + 勾一个跨屏权限 = 2 处;勾编辑连带勾上的查看也算一处', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    await pickRole(w, '外部审计')
    const auth = useAuthStore()
    await w.find('.sr-name').setValue('改个名')
    await box(w, 'lock:takeover').trigger('change')
    expect(auth.dirtyTotal).toBe(2)
    await box(w, 'tenants:edit').trigger('change')
    expect(auth.dirtyTotal).toBe(4)
  })

  it('❗有改动时换角色走 askLeave:答「继续编辑」留在原角色、改动还在;答放弃才换', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    await w.find('.sr-name').setValue('改个名')
    await pickRole(w, '外部审计')
    expect(askQueue[0]).toMatchObject({ title: '离开「系统管理员」？', body: '这页有 1 处改动还没保存。', cancel: '继续编辑' })
    answer(false)
    await flushPromises()
    expect((w.find('.sr-name').element as HTMLInputElement).value).toBe('改个名')
    await pickRole(w, '外部审计')
    answer(true)
    await flushPromises()
    expect((w.find('.sr-name').element as HTMLInputElement).value).toBe('外部审计')
  })

  it('❗没改动时换角色不弹', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    await pickRole(w, '外部审计')
    expect(askQueue).toHaveLength(0)
    expect((w.find('.sr-name').element as HTMLInputElement).value).toBe('外部审计')
  })

  it('❗删除角色走 ask(danger),答「删除角色」才发请求', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    await pickRole(w, '外部审计')
    await w.findAll('button').find(b => b.text().includes('删除角色'))!.trigger('click')
    await flushPromises()
    expect(askQueue[0]).toMatchObject({ title: '删除角色「外部审计」？', action: '删除角色', danger: true })
    answer(true)
    await flushPromises()
    expect(removeRole).toHaveBeenCalledWith(7)
  })

  it('保存成功:回执写立即生效、被改到的账号刷新页面后导航才跟着变', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    await pickRole(w, '外部审计')
    await box(w, 'cockpit:view').trigger('change')
    await w.findAll('.sr-act button').find(b => b.text() === '保存')!.trigger('click')
    await flushPromises()
    expect(updateRole).toHaveBeenCalledWith(7, expect.objectContaining({ perms: ['ledger:view', 'ledger:edit', 'cockpit:view'] }))
    expect(updateRole.mock.calls[0][1]).not.toHaveProperty('addUserIds')
    expect(w.text()).toContain('已保存「外部审计」 —— 立即生效；被改到的账号刷新页面后，导航才跟着变')
  })

  it('❗加载失败换掉整块(FPLoadError,和权限树互斥);点重试重拉,成功后回来', async () => {
    users.mockRejectedValueOnce({ message: '网关超时' })
    const w = mountWith(['sys-roles:view'])
    await flushPromises()
    const err = w.find('.fp-empty.error')
    expect(err.text()).toContain('角色权限没读到')
    expect(err.text()).toContain('网关超时')
    expect(w.find('.sr-split').exists()).toBe(false)
    await err.find('button').trigger('click')
    await flushPromises()
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.find('.sr-split').exists()).toBe(true)
  })

  // 字段报错(十件 ⑤;02-C 脚注「表单里的字段错误不走回执,贴在字段下面」;LAYOUT-STABILITY §4.2 框变红)
  it('❗新建角色缺名称 / 标识不合规:红字贴在各自字段下面、框变红,不走页面 toast、不发请求;改对了红字当场消', async () => {
    const w = mountWith(EDITOR)
    await flushPromises()
    await w.find('.sr-item.add').trigger('click')
    await flushPromises()
    const errs = () => w.findAll('.sr-panehead .fp-field-err').map(e => e.text())
    expect(errs(), '前置:新建时名称、标识两处报错位常驻,没点保存前不报').toEqual(['', ''])
    await w.find('.sr-code').setValue('9 号角色')
    await w.findAll('.sr-act button').find(b => b.text() === '新建角色')!.trigger('click')
    await flushPromises()
    expect(errs()).toEqual(['角色名必填', '标识必填,且只能用英文字母开头 + 字母/数字/下划线/短横'])
    expect([w.find('.sr-name').classes('bad'), w.find('.sr-code').classes('bad')]).toEqual([true, true])
    expect(w.text().split('角色名必填').length - 1, '只出现在字段下面一处,没进页面 toast').toBe(1)
    expect(createRole).not.toHaveBeenCalled()
    await w.find('.sr-name').setValue('外包审计')
    await w.find('.sr-code').setValue('outsource_audit')
    expect(errs()).toEqual(['', ''])
    expect(w.find('.sr-name').classes('bad')).toBe(false)
  })

  // 两趟叠着发(写后重拉 + 手点重试)只认后发的那趟
  // 破坏验证:load 成功支的 `if (my !== seq) return` 删掉 → 旧名单盖屏 → 红;catch 支的删掉 → 冒失败件 → 红
  it('❗先发的晚到:旧名单不盖新名单,失败不冒失败件', async () => {
    let lateOk!: (v: RoleDTO[]) => void, lateFail!: (e: Error) => void
    roles
      .mockImplementationOnce(() => new Promise((_, rej) => { lateFail = rej }))
      .mockImplementationOnce(() => new Promise((res) => { lateOk = res }))
    const w = mountWith(['sys-roles:view'])
    await flushPromises()
    const vm = w.vm as unknown as { load: () => Promise<void> }
    void vm.load()
    await vm.load()
    await flushPromises()
    const names = () => w.findAll('.sr-item-n').map(n => n.text())
    expect(names()).toEqual(['系统管理员', '外部审计', '兼职文员'])
    lateOk([{ ...ROLES[0], name: '旧名单里的角色' }])
    await flushPromises()
    expect(names(), '先发的旧名单盖了上来').toEqual(['系统管理员', '外部审计', '兼职文员'])
    lateFail(new Error('网关超时'))
    await flushPromises()
    expect(w.find('.fp-empty.error').exists(), '先发的失败冒了出来').toBe(false)
    expect(names()).toEqual(['系统管理员', '外部审计', '兼职文员'])
  })
})

// ── 分级 ──
// 后端按「这个人能不能改它」给 manageable:只管角色的人看系统管理员角色是 false,看自建小角色是 true
describe('系统管理分级', () => {
  const NON_SUPER = ['sys-roles:view', 'sys-roles:edit', 'ledger:view', 'ledger:edit']
  const rolesFor = (adminManageable: boolean) => ROLES.map(r => ({ ...r, manageable: r.code === 'admin' ? adminManageable : true }))

  // 破坏验证:lacks 改成恒 false → 红(没有的那几格可点);勾得到的那几格被一起置灰 → 红
  it('❗不是系统管理员:自己没有的权限那一格置灰、悬停说为什么;自己有的照常能勾;全是没有的那一列表头点不动', async () => {
    roles.mockImplementation(() => Promise.resolve(rolesFor(false)))
    const w = mountWith(NON_SUPER, false)
    await flushPromises()
    await pickRole(w, '外部审计')
    const dis = (k: string) => (box(w, k).element as HTMLInputElement).disabled
    expect(['tenants:view', 'tenants:edit', 'ledger:template', 'salary:view', 'lock:takeover'].map(dis), '没有的五格')
      .toEqual([true, true, true, true, true])
    expect(['ledger:view', 'ledger:edit', 'sys-roles:view', 'sys-roles:edit'].map(dis), '有的四格').toEqual([false, false, false, false])
    expect(tipOf(box(w, 'ledger:template').element.closest('label'))).toBe('你没有这项权限,只有系统管理员能把它分给角色')
    expect(tipOf(box(w, 'lock:takeover').element.closest('label'))).toBe('你没有这项权限,只有系统管理员能把它分给角色')
    const archEdit = w.find('.sr-tr-g[data-group="档案"] input[data-col="edit"]')
    expect((archEdit.element as HTMLInputElement).disabled, '档案的编辑全是我没有的').toBe(true)
    expect(tipOf(archEdit.element.closest('label'))).toBe('你没有这项权限,只有系统管理员能把它分给角色')
    expect(w.find('.sr-act').exists(), '这个角色本身能改').toBe(true)
  })

  // 破坏验证:canEditRole 不看 manageable(恒 canEdit)→ 红
  it('❗不是系统管理员:系统管理员角色整块只读(含成员),写明只有系统管理员能改;系统管理员本人照常能改', async () => {
    roles.mockImplementation(() => Promise.resolve(rolesFor(false)))
    const w = mountWith(NON_SUPER, false)
    await flushPromises()                                                // 默认选中第一个 = 系统管理员角色
    expect(allBoxes(w).every(b => (b.element as HTMLInputElement).disabled)).toBe(true)
    expect(w.find('.sr-act').exists()).toBe(false)
    expect(w.find('input.sr-name').exists(), '名称也不给改').toBe(false)
    expect(w.find('.sr-memadd').exists(), '成员也不给动').toBe(false)
    expect(w.findAll('.sr-memact')).toHaveLength(0)
    expect(w.find('.sr-ro').text()).toBe('系统管理员角色只有系统管理员能改。')
    expect(w.find('.sr-item.add').exists(), '新建角色照常(新角色只能勾自己有的)').toBe(true)

    roles.mockImplementation(() => Promise.resolve(rolesFor(true)))
    const s = mountWith(EDITOR, true)
    await flushPromises()
    expect(s.find('.sr-act').exists()).toBe(true)
    expect((box(s, 'tenants:edit').element as HTMLInputElement).disabled, '系统管理员不看自己有没有').toBe(false)
  })
})
