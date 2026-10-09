// 角色屏的权限树(RBAC-SPEC §15.9):纯函数 —— 建树、三态、整列勾 / 清、单格联动、改动数、成员待办的修剪。屏只管画。
// 权限点清单来自后端 Perm.META(GET /api/system/perms),**前端不列权限点**,只按 FP_NAV 的层 / 分组 / 屏顺序把它们挂上去:
// 后端多一屏、多一个动作,这里自动多一行、多一格;后端给了导航表里没有的屏 → 落最后的「其他」,不丢。
import { FP_NAV } from '@/nav/fpNav'
import type { PermDTO, UserDTO } from '@/types/system'

export type Col = 'view' | 'edit' | 'action'
export const COLS: readonly Col[] = ['view', 'edit', 'action']

export interface TreeScreen { value: string; label: string; view: PermDTO | null; edit: PermDTO | null; actions: PermDTO[] }
/** title 为 null:导航里没标题的分组,屏直接挂在层下 */
export interface TreeGroup { title: string | null; screens: TreeScreen[] }
export interface TreeLayer { id: string; label: string; groups: TreeGroup[] }
export interface PermTree { layers: TreeLayer[]; /** screen 为空的(审核、编辑锁授权、可请求提权):树下面单独一段 */ cross: PermDTO[] }

/** 旧后端没带 kind 的按键尾猜:view / edit,其余算专有动作 */
const colOf = (p: PermDTO): Col =>
  p.kind === 'view' || p.kind === 'edit' || p.kind === 'action' ? p.kind
    : p.key.endsWith(':view') ? 'view' : p.key.endsWith(':edit') ? 'edit' : 'action'

/** 「催缴单 · 签发」→「签发」:动作格只写动作名,屏名已经在行首 */
export const shortLabel = (p: PermDTO) => p.label.split(' · ').pop() ?? p.label

export function buildTree(perms: PermDTO[]): PermTree {
  const byScreen = new Map<string, PermDTO[]>()
  const cross: PermDTO[] = []
  for (const p of perms) {
    if (!p.screen) { cross.push(p); continue }
    byScreen.set(p.screen, [...(byScreen.get(p.screen) ?? []), p])
  }
  const screenOf = (value: string, label: string): TreeScreen | null => {
    const ps = byScreen.get(value)
    if (!ps) return null
    byScreen.delete(value)
    return {
      value, label,
      view: ps.find((p) => colOf(p) === 'view') ?? null,
      edit: ps.find((p) => colOf(p) === 'edit') ?? null,
      actions: ps.filter((p) => colOf(p) === 'action'),
    }
  }
  const layers: TreeLayer[] = FP_NAV.map((L) => ({
    id: L.id, label: L.label,
    groups: L.sections
      .map((s) => ({ title: s.title ?? null, screens: s.items.map((it) => screenOf(it.value, it.label)).filter((x): x is TreeScreen => !!x) }))
      .filter((g) => g.screens.length),
  })).filter((L) => L.groups.length)
  // 导航表里没有的屏:屏名取查看那一项中文名「 · 」前面那段,没有就用键前缀
  const rest = [...byScreen.keys()].map((v) => {
    const ps = byScreen.get(v)!
    const name = ps[0].label.includes(' · ') ? ps[0].label.split(' · ')[0] : v
    return screenOf(v, name)!
  })
  if (rest.length) layers.push({ id: 'other', label: '其他', groups: [{ title: null, screens: rest }] })
  return { layers, cross }
}

/** 一屏在某一列的权限点(查看 / 编辑 0–1 个,动作 0–n 个) */
export function cellKeys(s: TreeScreen, col: Col): string[] {
  if (col === 'view') return s.view ? [s.view.key] : []
  if (col === 'edit') return s.edit ? [s.edit.key] : []
  return s.actions.map((a) => a.key)
}
const screensOf = (node: TreeLayer | TreeGroup): TreeScreen[] =>
  'groups' in node ? node.groups.flatMap((g) => g.screens) : node.screens

/** 层 / 分组这一列下面全部的键 */
export const colKeys = (node: TreeLayer | TreeGroup, col: Col) => screensOf(node).flatMap((s) => cellKeys(s, col))

export type Tri = 'all' | 'none' | 'some' | 'empty' | 'locked'
/**
 * 层 / 分组这一列的三态。**只数自己有的那几项**(lacks 的不算):管得了的角色不可能已经勾着编辑者没有的权限(§12.2),
 * 算进去这一列永远到不了「全勾」,表头点一下只会一直「全勾上」、再也清不掉。
 * empty = 这一列下面一项都没有(画「—」);locked = 全是 lacks(表头置灰、点不动)。
 */
export function triState(node: TreeLayer | TreeGroup, col: Col, checked: readonly string[], lacks: (k: string) => boolean): Tri {
  const all = colKeys(node, col)
  if (!all.length) return 'empty'
  const mine = all.filter((k) => !lacks(k))
  if (!mine.length) return 'locked'
  const n = mine.filter((k) => checked.includes(k)).length
  return n === mine.length ? 'all' : n === 0 ? 'none' : 'some'
}

/**
 * 点表头:不是全勾就把这一列(非 lacks 的)全勾上,全勾就全清。联动同单格:勾编辑 / 动作带上本屏查看;清查看带走本屏全部动作。
 * lacks 的格既不被勾上、也不被清掉。返回新数组,不改入参。
 */
export function toggleCol(node: TreeLayer | TreeGroup, col: Col, checked: readonly string[], lacks: (k: string) => boolean): string[] {
  const st = triState(node, col, checked, lacks)
  if (st === 'empty' || st === 'locked') return [...checked]
  const out = new Set(checked)
  for (const s of screensOf(node)) {
    const ks = cellKeys(s, col).filter((k) => !lacks(k))
    if (!ks.length) continue
    if (st !== 'all') {
      ks.forEach((k) => out.add(k))
      if (col !== 'view' && s.view) out.add(s.view.key)
    } else if (col === 'view') {
      for (const k of [...ks, ...cellKeys(s, 'edit'), ...cellKeys(s, 'action')]) out.delete(k)
    } else ks.forEach((k) => out.delete(k))
  }
  return [...out]
}

/** 单格:勾编辑或任一动作 → 自动勾上本屏查看;取消本屏查看 → 连带取消本屏全部动作。返回新数组。 */
export function toggleKey(s: TreeScreen, key: string, checked: readonly string[]): string[] {
  const out = new Set(checked)
  const isView = s.view?.key === key
  if (out.has(key)) {
    out.delete(key)
    if (isView) for (const k of [...cellKeys(s, 'edit'), ...cellKeys(s, 'action')]) out.delete(k)
  } else {
    out.add(key)
    if (!isView && s.view) out.add(s.view.key)
  }
  return [...out]
}

// ── 改动数(EDIT-MODE §6.1) ──
export interface RoleForm { code: string; name: string; remark: string; perms: string[]; navLayers: string[]; addIds: number[]; removeIds: number[] }
const setDiff = (a: readonly string[], b: readonly string[]) => a.filter((x) => !b.includes(x)).length + b.filter((x) => !a.includes(x)).length
/**
 * 名称、备注各 1;每勾 / 去一个权限点、每勾 / 去一个导航层各 1;待加入、待移出每人 1。
 * 新建时 = 标识、名称、勾上的权限点、待加入人数(导航层缺省全勾,不算改动)。
 */
export function dirtyCount(f: RoleForm, role: { name: string; remark?: string | null; perms: string[]; navLayers: string[] } | null, creating: boolean): number {
  if (creating) return +!!f.code.trim() + +!!f.name.trim() + f.perms.length + f.addIds.length
  if (!role) return 0
  return +(f.name !== role.name) + +(f.remark !== (role.remark ?? ''))
    + setDiff(f.perms, role.perms) + setDiff(f.navLayers, role.navLayers)
    + f.addIds.length + f.removeIds.length
}

// ── 成员 ──
export const inRole = (u: UserDTO, roleId: number | null) => roleId != null && u.roles.some((r) => r.id === roleId)
/**
 * 切回页签时只重取了账号列表(表单有改动,权限勾选不能冲掉):待加入的人已经在角色里了、待移出的人已经不在了,
 * 这一条待办就去掉(别人在用户管理里先做了同一件事)。账号没了的也去掉。
 */
export function pruneMembers(users: UserDTO[], roleId: number | null, addIds: number[], removeIds: number[]) {
  const byId = new Map(users.map((u) => [u.id, u]))
  return {
    addIds: addIds.filter((id) => byId.has(id) && !inRole(byId.get(id)!, roleId)),
    removeIds: removeIds.filter((id) => byId.has(id) && inRole(byId.get(id)!, roleId)),
  }
}
