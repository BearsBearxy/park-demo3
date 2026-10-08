// 角色屏权限树的纯函数(RBAC-SPEC §15.9)。「❗」开头的做过破坏验证。
import { describe, expect, it } from 'vitest'
import type { PermDTO, UserDTO } from '@/types/system'
import { buildTree, colKeys, dirtyCount, pruneMembers, shortLabel, toggleCol, toggleKey, triState, type RoleForm } from './roleTree'

const P = (key: string, label: string, screen: string | null, kind: PermDTO['kind']): PermDTO => ({ key, label, hint: `${label}的说明`, screen, kind })
// 故意打乱:树的顺序只认导航表,不认后端给的顺序
const PERMS: PermDTO[] = [
  P('sys-roles:edit', '角色权限 · 编辑', 'sys-roles', 'edit'),
  P('review:approve', '审核', null, 'other'),
  P('ledger:template', '月度台账 · 账册模板', 'ledger', 'action'),
  P('bill-notices:payee', '催缴单 · 收款公司', 'bill-notices', 'action'),
  P('park:edit', '出租与楼栋 · 编辑', 'park', 'edit'),
  P('future-screen:view', '新的一屏 · 查看', 'future-screen', 'view'),
  P('tenants:edit', '租户管理 · 编辑', 'tenants', 'edit'),
  P('ledger:view', '月度台账 · 查看', 'ledger', 'view'),
  P('bill-notices:issue', '催缴单 · 签发', 'bill-notices', 'action'),
  P('data-home:view', '本月出账 · 查看', 'data-home', 'view'),
  P('buildings:view', '楼栋管理 · 查看', 'buildings', 'view'),
  P('park:view', '出租与楼栋 · 查看', 'park', 'view'),
  P('bill-notices:edit', '催缴单 · 编辑', 'bill-notices', 'edit'),
  P('tenants:view', '租户管理 · 查看', 'tenants', 'view'),
  P('ledger:edit', '月度台账 · 编辑', 'ledger', 'edit'),
  P('buildings:edit', '楼栋管理 · 编辑', 'buildings', 'edit'),
  P('cockpit:view', '经营驾驶舱 · 查看', 'cockpit', 'view'),
  P('bill-notices:view', '催缴单 · 查看', 'bill-notices', 'view'),
  P('sys-roles:view', '角色权限 · 查看', 'sys-roles', 'view'),
]
const tree = buildTree(PERMS)
const data = tree.layers.find((L) => L.id === 'data')!
const grp = (title: string) => data.groups.find((g) => g.title === title)!
const ARCHIVE = () => grp('档案')
const BILLING = () => grp('出账 · 每月工序')
const none = () => false

describe('buildTree', () => {
  // 破坏验证:buildTree 不收「其他」(rest 那一段删掉)→ 红
  it('❗按导航表的层 → 分组 → 屏顺序挂,不按后端顺序;导航表里没有的屏落最后的「其他」,跨屏项单独一段', () => {
    expect(tree.layers.map((L) => L.id)).toEqual(['data', 'analysis', 'system', 'other'])
    expect(data.groups.map((g) => g.title)).toEqual([null, '档案', '出账 · 每月工序', '记账 · 按月'])
    expect(data.groups.flatMap((g) => g.screens.map((s) => s.value))).toEqual(['data-home', 'buildings', 'tenants', 'bill-notices', 'ledger'])
    expect(tree.layers[3]).toMatchObject({ label: '其他', groups: [{ title: null, screens: [{ value: 'future-screen', label: '新的一屏' }] }] })
    expect(tree.cross.map((p) => p.key)).toEqual(['review:approve'])
    const bn = BILLING().screens[0]
    expect([bn.view?.key, bn.edit?.key, bn.actions.map((a) => a.key)]).toEqual(['bill-notices:view', 'bill-notices:edit', ['bill-notices:payee', 'bill-notices:issue']])
    expect(data.groups[0].screens[0].edit, '本月出账没有编辑').toBeNull()
    expect(bn.actions.map(shortLabel)).toEqual(['收款公司', '签发'])
  })
})

describe('三态与整列', () => {
  it('三态:全勾 / 一个没勾 / 部分;这一列下面一项都没有是 empty', () => {
    expect(triState(ARCHIVE(), 'view', ['buildings:view', 'tenants:view'], none)).toBe('all')
    expect(triState(ARCHIVE(), 'view', [], none)).toBe('none')
    expect(triState(ARCHIVE(), 'view', ['tenants:view'], none)).toBe('some')
    expect(triState(ARCHIVE(), 'action', [], none), '档案没有专有动作').toBe('empty')
    expect(triState(data, 'action', ['bill-notices:issue'], none), '层这一行管到组里的屏').toBe('some')
  })

  // 破坏验证:toggleCol 去掉「勾编辑 / 动作带上本屏查看」→ 红
  it('❗整列勾编辑:这些屏的查看一起勾上', () => {
    const out = toggleCol(ARCHIVE(), 'edit', [], none)
    expect(out.sort()).toEqual(['buildings:edit', 'buildings:view', 'tenants:edit', 'tenants:view'])
  })

  // 破坏验证:toggleCol 清查看时不带走本屏编辑 / 动作 → 红
  it('❗整列全勾时点查看 = 全清,连带清掉这些屏的编辑和动作;别的组不动', () => {
    const all = [...colKeys(BILLING(), 'view'), ...colKeys(BILLING(), 'edit'), ...colKeys(BILLING(), 'action'), 'ledger:view', 'ledger:edit']
    expect(triState(BILLING(), 'view', all, none)).toBe('all')
    expect(toggleCol(BILLING(), 'view', all, none).sort()).toEqual(['ledger:edit', 'ledger:view'])
  })

  // 破坏验证:toggleCol 不滤 lacks → 红(签发被整列勾上 / 被整列清掉)
  it('❗自己没有的那一格(lacks)不被整列勾上,也不被整列清掉', () => {
    const lacks = (k: string) => k === 'bill-notices:issue'
    expect(toggleCol(BILLING(), 'action', [], lacks).sort()).toEqual(['bill-notices:payee', 'bill-notices:view'])
    // 管不了的格子本来就勾着(系统管理员给的):整列清不动它
    const had = ['bill-notices:view', 'bill-notices:issue', 'bill-notices:payee']
    expect(triState(BILLING(), 'action', had, lacks), '三态只数自己有的那几项').toBe('all')
    expect(toggleCol(BILLING(), 'action', had, lacks).sort()).toEqual(['bill-notices:issue', 'bill-notices:view'])
  })

  // 破坏验证:triState 把 lacks 也数进去 → 红(第一下勾完还是「部分」,第二下又去全勾,永远清不掉)
  it('❗有 lacks 项的列点两下回到全空', () => {
    const lacks = (k: string) => k === 'bill-notices:issue'
    const once = toggleCol(BILLING(), 'action', [], lacks)
    expect(triState(BILLING(), 'action', once, lacks)).toBe('all')
    const twice = toggleCol(BILLING(), 'action', once, lacks)
    expect(triState(BILLING(), 'action', twice, lacks)).toBe('none')
  })

  // 破坏验证:triState 去掉 locked 那一档 → 红
  it('❗这一列下面全是 lacks:表头 locked、点了什么都不变', () => {
    const lacks = (k: string) => k.startsWith('bill-notices:') && k !== 'bill-notices:view'
    expect(triState(BILLING(), 'action', [], lacks)).toBe('locked')
    expect(toggleCol(BILLING(), 'action', ['ledger:view'], lacks)).toEqual(['ledger:view'])
  })
})

describe('单格联动', () => {
  const bn = () => BILLING().screens[0]
  // 破坏验证:toggleKey 勾动作不带查看 → 红;取消查看不带走动作 → 红
  it('❗勾动作自动勾上本屏查看;取消查看连带取消本屏全部动作;取消动作不动查看', () => {
    const a = toggleKey(bn(), 'bill-notices:issue', ['ledger:view'])
    expect(a.sort()).toEqual(['bill-notices:issue', 'bill-notices:view', 'ledger:view'])
    const b = toggleKey(bn(), 'bill-notices:issue', a)
    expect(b.sort()).toEqual(['bill-notices:view', 'ledger:view'])
    const c = toggleKey(bn(), 'bill-notices:view', ['bill-notices:view', 'bill-notices:edit', 'bill-notices:payee', 'ledger:view'])
    expect(c, '别的屏不动').toEqual(['ledger:view'])
  })
})

describe('改动数与成员', () => {
  const role = { name: '财务专员', remark: null, perms: ['ledger:view'], navLayers: ['data'] }
  const form = (o: Partial<RoleForm> = {}): RoleForm =>
    ({ code: 'clerk', name: '财务专员', remark: '', perms: ['ledger:view'], navLayers: ['data'], addIds: [], removeIds: [], ...o })

  // 破坏验证:dirtyCount 不数成员 → 红
  it('❗改动数 = 名称 / 备注 / 每个权限点 / 每个导航层 + 待加入人数 + 待移出人数;新建时 = 标识、名称、勾上的权限点、待加入', () => {
    expect(dirtyCount(form(), role, false)).toBe(0)
    expect(dirtyCount(form({ perms: ['ledger:edit'], addIds: [3, 4], removeIds: [5] }), role, false)).toBe(2 + 2 + 1)
    expect(dirtyCount(form({ code: 'x', name: 'y', perms: ['ledger:view', 'ledger:edit'], addIds: [3] }), null, true)).toBe(1 + 1 + 2 + 1)
  })

  const U = (id: number, roleIds: number[]): UserDTO =>
    ({ id, username: `u${id}`, displayName: `人${id}`, status: 1, mustChangePassword: false, roles: roleIds.map((r) => ({ id: r, code: `r${r}`, name: `角色${r}` })), createdAt: '' })

  // 破坏验证:pruneMembers 原样返回 → 红
  it('❗切回时重取账号:已经在角色里的待加入、已经不在的待移出、已经没了的账号,都从待办里去掉', () => {
    const users = [U(1, [7]), U(2, []), U(3, [7]), U(4, [])]
    expect(pruneMembers(users, 7, [1, 2, 99], [3, 4, 98])).toEqual({ addIds: [2], removeIds: [3] })
  })
})
