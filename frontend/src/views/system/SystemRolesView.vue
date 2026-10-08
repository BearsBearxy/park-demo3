<script setup lang="ts">
// 角色权限(RBAC-SPEC v2 §10 P1;v3 按模块「查看 / 编辑」;v4 §15.9 细到菜单单项)— 左栏角色列表(预置/自定义分组),
// 右栏该角色的权限树 + 不分屏的权限 + 导航可见层,宽屏时最右一列是「本角色成员」。
// 权限点清单来自 GET /api/system/perms(后端 Perm.META,每项带 screen / kind),**前端不硬编码** ——
// 树按 FP_NAV 的层 → 分组 → 屏顺序挂(views/system/roleTree.ts),后端加一屏、加一个动作,这里自动多一行、多一格。
// 勾编辑或动作自动带上本屏查看,取消查看连带取消本屏全部动作;层 / 分组那一行的三态勾选框管下面整列。
// 预置角色(builtin=true)不可删但权限与导航层照改 —— 「交付后客户自己调」是本屏存在的理由;删除只对自定义角色出现。
// 无 sys-roles:edit 时照常显示当前配置与成员,只是复选框 disabled、没有保存/新增/删除/添加成员/移出。
// 系统管理分级(RBAC-SPEC §12,用户 2026-10-04 拍板):不是系统管理员的,比自己大的角色(含系统管理员角色)整块只读,
// 自己没有的权限点那一格置灰 —— 后端同一条判据会 403,别让人勾完点保存才知道。系统管理员不受限。
// 成员(用户 2026-10-09 拍板②):和用户管理里给账号挂角色是同一份数据,改动先记在表单里、和权限一起点「保存」提交(增量,同一个事务);
// 守卫与用户管理同一条路径(后端 changeRoles),屏上把注定被拦的几种预先置灰并写原因。
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { systemApi } from '@/api/system'
import type { NavLayerDTO, PermDTO, RoleDTO, RoleReq, UserDTO } from '@/types/system'
import { useAuthStore } from '@/stores/auth'
import { useScreen } from '@/composables/useTabShells'
import { onReactivated } from '@/composables/onReactivated'
import { ask, askLeave } from '@/utils/ask'
import { iconFor } from '@/components/ds/icon'
import FPToast from '@/components/fp/FPToast.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import Button from '@/components/ds/Button.vue'
import Badge from '@/components/ds/Badge.vue'
import Popover from '@/components/ds/Popover.vue'
import PopoverItem from '@/components/ds/PopoverItem.vue'
import SearchField from '@/components/ds/SearchField.vue'
import {
  buildTree, COLS, triState, toggleCol, toggleKey, shortLabel, dirtyCount as countDirty, inRole, pruneMembers,
  type Col, type RoleForm, type TreeGroup, type TreeLayer, type TreeScreen,
} from './roleTree'

const auth = useAuthStore()
const canEdit = computed(() => auth.can('sys-roles:edit'))
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback

// ── 数据 ──
const perms = ref<PermDTO[]>([])
const navLayerDefs = ref<NavLayerDTO[]>([])
const roles = ref<RoleDTO[]>([])
const users = ref<UserDTO[]>([])
const loaded = ref(false)
const loadErr = ref('')
const saving = ref(false)
const msg = ref<{ tone: 'ok' | 'err'; text: string } | null>(null)

const selId = ref<number | null>(null)
const creating = ref(false)
const form = ref<RoleForm>({ code: '', name: '', remark: '', perms: [], navLayers: [], addIds: [], removeIds: [] })
// 字段报错(十件 ⑤):点过一次保存才亮,之后随输入即时消;贴在字段下面,不走页面 toast
const tried = ref(false)
const nameErr = computed(() => (tried.value && !form.value.name.trim() ? '角色名必填' : ''))
// code 建后不可改,写坏了只能重建一个:在这儿挡住,别等后端 500
const codeErr = computed(() => (tried.value && creating.value && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(form.value.code.trim())
  ? '标识必填,且只能用英文字母开头 + 字母/数字/下划线/短横' : ''))

const cur = computed(() => roles.value.find(r => r.id === selId.value) ?? null)
// 这个角色我能不能改:后端 manageable(守卫同一条判据);新建时看各格的 lacks
const canEditRole = computed(() => canEdit.value && (creating.value || cur.value?.manageable !== false))
/** 我自己没有这一项(只看角色给的,不看提权 —— 系统管理三屏借不到,分级比的也是角色给的) */
const lacks = (key: string) => !auth.superAdmin && !auth.hasOwn(key)
const LACK_TIP = '你没有这项权限,只有系统管理员能把它分给角色'
const rangeNote = computed(() => (cur.value?.code === 'admin'
  ? '系统管理员角色只有系统管理员能改。'
  : '这个角色有你没有的权限,只有系统管理员能改。'))
const builtinRoles = computed(() => roles.value.filter(r => r.builtin))
const customRoles = computed(() => roles.value.filter(r => !r.builtin))

// seq:保存 / 删除后的重拉与手点重试并发时只认最后一次;错误只在成功分支清(重试途中失败态不闪回)
let seq = 0
/** stay:页签切回时表单干净、人正停在「新建角色」上 —— 重取三样,但别把他从新建里踢出去 */
async function load(keepId?: number | null, stay = false) {
  const my = ++seq
  try {
    // 账号列表不带筛选:成员栏 = roles 里含本角色的账号,不按角色逐个请求
    const [cat, rs, us] = await Promise.all([systemApi.perms(), systemApi.roles(), systemApi.users()])
    if (my !== seq) return
    perms.value = cat.perms
    navLayerDefs.value = cat.navLayers
    roles.value = rs
    users.value = us
    const id = keepId ?? selId.value
    selId.value = rs.some(r => r.id === id) ? id! : rs[0]?.id ?? null
    if (!(stay && creating.value)) {
      creating.value = false
      fillForm(cur.value)
    }
    loadErr.value = ''
  } catch (e) {
    if (my !== seq) return
    loadErr.value = errMsg(e, '角色数据加载失败')
  } finally { if (my === seq) loaded.value = true }
}
onMounted(() => load())

/** 表单有改动时切回页签:只重取账号(权限勾选是整份快照,不能冲掉;成员改动是增量,换了底也成立),已失效的待办去掉 */
let useq = 0
async function reloadUsers() {
  const my = ++useq
  try {
    const us = await systemApi.users()
    if (my !== useq) return
    users.value = us
    const f = form.value
    Object.assign(f, pruneMembers(us, creating.value ? null : selId.value, f.addIds, f.removeIds))
  } catch { /* 取不到就留着上一份名单,保存时后端照样按库里的判 */ }
}
// 在用户管理里改了某人的角色,切回这一屏就看得到(和用户管理屏同一个钩子)
onReactivated(() => { if (dirtyCnt.value === 0) void load(undefined, true); else void reloadUsers() })

function fillForm(r: RoleDTO | null) {
  tried.value = false
  q.value = ''
  form.value = r
    ? { code: r.code, name: r.name, remark: r.remark ?? '', perms: [...r.perms], navLayers: [...r.navLayers], addIds: [], removeIds: [] }
    // 新角色缺省:零权限 + 全部导航层(没有查看权的屏照样不列;少给导航层是整层看不见)
    : { code: '', name: '', remark: '', perms: [], navLayers: navLayerDefs.value.map(l => l.id), addIds: [], removeIds: [] }
}

// ── 权限树 ──
const tree = computed(() => buildTree(perms.value))
const has = (k: string) => form.value.perms.includes(k)
const offKey = (k: string) => !canEditRole.value || lacks(k)
// 只读时三态按全部键算:那时「我缺哪项」无关(哪格都点不动),按它排除会让勾着很多项的角色表头显示空框、格子却是勾上的
const tri = (node: TreeLayer | TreeGroup, col: Col) => triState(node, col, form.value.perms, canEditRole.value ? lacks : () => false)
const COL_NAME: Record<Col, string> = { view: '查看', edit: '编辑', action: '其他动作' }
function onCol(node: TreeLayer | TreeGroup, col: Col) {
  if (!canEditRole.value) return
  form.value.perms = toggleCol(node, col, form.value.perms, lacks)
}
function onKey(s: TreeScreen, key: string) {
  if (offKey(key)) return
  form.value.perms = toggleKey(s, key, form.value.perms)
}
/** 格子悬停:缺这一项时说为什么;编辑 / 动作说它管什么(查看的说明已经写在屏名下面) */
const keyTip = (p: PermDTO) => (canEditRole.value && lacks(p.key) ? LACK_TIP : p.kind === 'view' ? undefined : p.hint)
function toggle(list: string[], key: string) {
  if (!canEditRole.value) return
  const i = list.indexOf(key)
  if (i < 0) list.push(key); else list.splice(i, 1)
}

// ── 成员 ──
const SELF_TIP = '不能改自己的角色，请另一位管理员操作'
const rangeTip = (u: UserDTO) => (u.roles.some(r => r.code === 'admin')
  ? '系统管理员账号只有系统管理员能改'
  : '这个账号有你没有的权限，只有系统管理员能改')
const roleId = computed(() => (creating.value ? null : selId.value))
const saved = computed(() => users.value.filter(u => inRole(u, roleId.value)))
type MemberRow = { u: UserDTO; state: 'add' | 'keep' | 'remove' }
/** 待加入的排最前,标「保存后加入」;待移出的变灰,标「保存后移出」 */
const memberRows = computed<MemberRow[]>(() => [
  ...form.value.addIds.map(id => users.value.find(u => u.id === id)).filter((u): u is UserDTO => !!u)
    .map(u => ({ u, state: 'add' as const })),
  ...saved.value.map(u => ({ u, state: form.value.removeIds.includes(u.id) ? 'remove' as const : 'keep' as const })),
])
/** 保存之后会有几个账号 */
const memberCount = computed(() => memberRows.value.filter(r => r.state !== 'remove').length)
/** 成员栏标题:有待加入 / 待移出时把现在和保存后分开写,不然和角色头「N 个账号使用中」并排对不上 */
const memberTitle = computed(() => (form.value.addIds.length || form.value.removeIds.length
  ? `本角色成员（现 ${saved.value.length}，保存后 ${memberCount.value}）`
  : `本角色成员（${saved.value.length}）`))
/** 系统管理员角色里最后一个启用的账号(待移出的不算还在) */
const lastAdmin = computed(() => {
  if (creating.value || cur.value?.code !== 'admin') return null
  const left = memberRows.value.filter(r => r.state !== 'remove' && r.u.status === 1)
  return left.length === 1 ? left[0].u.id : null
})
/** 这个账号的角色我动不动得了;动得了返回 ''。removing:要把他从本角色移出(多判一条「最后一个系统管理员」) */
function memberLock(u: UserDTO, removing: boolean): string {
  if (auth.me && u.username === auth.me) return SELF_TIP
  if (u.manageable === false) return rangeTip(u)
  if (removing && lastAdmin.value === u.id) return `「${u.username}」是最后一个启用的系统管理员账号，移出后就没有人能管理整个系统了`
  return ''
}
const q = ref('')
const outside = computed(() => users.value.filter(u => !inRole(u, roleId.value) && !form.value.addIds.includes(u.id)))
const candidates = computed(() => {
  const k = q.value.trim().toLowerCase()
  return k ? outside.value.filter(u => u.username.toLowerCase().includes(k) || (u.displayName ?? '').toLowerCase().includes(k)) : outside.value
})
function addMember(u: UserDTO) {
  if (!canEditRole.value || memberLock(u, false)) return
  form.value.addIds.push(u.id)
}
function removeMember(r: MemberRow) {
  if (!canEditRole.value) return
  const f = form.value
  if (r.state === 'add') { f.addIds = f.addIds.filter(id => id !== r.u.id); return }   // 待加入的再点「移出」= 撤掉
  if (memberLock(r.u, true)) return
  f.removeIds.push(r.u.id)
}
function undoRemove(r: MemberRow) { form.value.removeIds = form.value.removeIds.filter(id => id !== r.u.id) }

// ── 编辑 ──
// 改动数(EDIT-MODE §6.1):名称 / 备注各 1,权限点与导航层每勾一个、每去一个各 1,待加入 / 待移出每人 1。新建时见 roleTree.dirtyCount
const dirtyCnt = computed(() => countDirty(form.value, cur.value, creating.value))
const dirty = computed(() => dirtyCnt.value > 0)

// 有没保存的改动 = 在编辑:登记进 auth.editors —— 页签条不把这一格换掉、关浏览器先确认(TAB-BAR-SPEC §2)
const meId = Symbol('roles')
const screen = useScreen()
// 撤登记时顺带结束授权:这是最后一个编辑态的话,授权不该留到 30 分钟到期(还有别的在编辑时它自己不作为)
function unregister() { auth.closeEditor(meId); void auth.endElevation() }
watch(dirty, (on) => { if (on) auth.openEditor(meId, screen, () => dirtyCnt.value, ['sys-roles:edit']); else unregister() })
onUnmounted(unregister)

// 换角色 / 去新建会丢掉手上的改动:askLeave(0 处不弹)
const leave = () => askLeave({ page: creating.value ? '新建角色' : cur.value?.name ?? '', count: dirtyCnt.value, verb: '离开' })
async function pick(id: number) {
  if (id === selId.value && !creating.value) return
  if (!(await leave())) return
  msg.value = null
  selId.value = id
  creating.value = false
  fillForm(cur.value)
}
async function startCreate() {
  if (!(await leave())) return
  msg.value = null
  creating.value = true
  fillForm(null)
}
// 「取消」本身就是放弃改动:问的是放弃,不是离开
async function cancel() {
  if (dirty.value && !(await ask({
    title: `放弃这 ${dirtyCnt.value} 处改动？`,
    body: '放弃后回到上次保存的样子。',
    action: '放弃改动',
    cancel: '继续编辑',
    danger: true,
  }))) return
  msg.value = null
  creating.value = false
  fillForm(cur.value)
}

async function save() {
  if (saving.value) return
  const f = form.value
  const name = f.name.trim()
  const code = f.code.trim()
  tried.value = true
  if (nameErr.value || codeErr.value) return   // 错已贴在字段下面
  saving.value = true
  msg.value = null
  try {
    // remark 空串即清空备注(RoleReq.remark 是可选 string,不收 null);成员只带增量,没有就不带
    const req: RoleReq = { name, navLayers: [...f.navLayers], perms: [...f.perms], remark: f.remark.trim() }
    if (f.addIds.length) req.addUserIds = [...f.addIds]
    if (!creating.value && f.removeIds.length) req.removeUserIds = [...f.removeIds]
    const done = creating.value
      ? await systemApi.createRole({ ...req, code })
      : await systemApi.updateRole(selId.value!, req)
    await load(done.id)
    msg.value = { tone: 'ok', text: `已保存「${done.name}」 —— 立即生效；被改到的账号刷新页面后，导航才跟着变` }
  } catch (e) {
    // 任一条守卫拦下整次回滚:后端原话(带账号名)照显,表单不动,改了再存
    msg.value = { tone: 'err', text: errMsg(e, '保存失败') }
  } finally { saving.value = false }
}

async function remove(r: RoleDTO) {
  if (saving.value) return
  if (!(await ask({
    title: `删除角色「${r.name}」？`,
    body: '这个角色下没有账号在用，删除后不能撤销。',
    action: '删除角色',
    danger: true,
  }))) return
  saving.value = true
  msg.value = null
  try {
    await systemApi.removeRole(r.id)
    selId.value = null
    await load()
    msg.value = { tone: 'ok', text: `已删除角色「${r.name}」` }
  } catch (e) {
    msg.value = { tone: 'err', text: errMsg(e, '删除失败') }
  } finally { saving.value = false }
}
</script>

<template>
  <!-- fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §11.1 迁移查看态(≤960 双栏降单列、权限树外框横滚),
       摘掉 base.css 的 M↓ 屏级地板。配置操作按 §11.1「系统管理配置明确不做」:不禁不藏不优化 -->
  <div class="sr-page fp-fluid">
    <!-- 页头 -->
    <div class="sr-head">
      <div>
        <h2 class="sr-title">角色权限</h2>
        <p class="sr-sub">
          每一屏有「查看」，能改数据的屏另有「编辑」，有的屏还有单独的动作（比如催缴单的「签发」）；勾编辑或动作会自动带上这一屏的查看。共 {{ loaded ? roles.length : '…' }} 个角色
        </p>
      </div>
    </div>

    <!-- 保存成功/失败走 toast(浮层,不顶下面的权限树);加载失败在下面换掉整块内容(十件 ⑦) -->
    <FPToast :model-value="msg?.text ?? ''" :tone="msg?.tone === 'ok' ? 'success' : 'error'"
             placement="page" :duration="msg?.tone === 'ok' ? 4000 : 0"
             @update:model-value="msg = null" />

    <div v-if="!loaded" class="sr-empty">加载中…</div>
    <FPLoadError v-else-if="loadErr" :sub="`${loadErr} · 屏上不显示角色和权限`" @retry="load()">角色权限没读到</FPLoadError>

    <div v-else class="sr-split">
      <!-- 左:角色列表 -->
      <aside class="sr-list">
        <div class="sr-grp">预置角色</div>
        <button v-for="r in builtinRoles" :key="r.id" type="button" class="sr-item"
                :class="{ sel: !creating && r.id === selId }" @click="pick(r.id)">
          <span class="sr-item-n">{{ r.name }}</span>
          <span class="sr-item-s">{{ r.code }} · {{ r.userCount }} 个账号</span>
        </button>

        <div class="sr-grp">自定义角色</div>
        <button v-for="r in customRoles" :key="r.id" type="button" class="sr-item"
                :class="{ sel: !creating && r.id === selId }" @click="pick(r.id)">
          <span class="sr-item-n">{{ r.name }}</span>
          <span class="sr-item-s">{{ r.code }} · {{ r.userCount }} 个账号</span>
        </button>
        <div v-if="!customRoles.length" class="sr-none">还没有自定义角色</div>

        <button v-if="canEdit" type="button" class="sr-item add" :class="{ sel: creating }" @click="startCreate">
          <component :is="iconFor('plus')" :size="14" /> 新建角色
        </button>
      </aside>

      <!-- 右:角色头 + 权限树 + 成员 -->
      <section v-if="creating || cur" class="sr-pane">
        <div class="sr-panehead">
          <div class="sr-nameline">
            <input v-if="canEditRole" v-model="form.name" class="sr-name" :class="{ bad: !!nameErr }" placeholder="角色名,如:财务专员" />
            <span v-else class="sr-name ro">{{ form.name }}</span>
            <Badge v-if="!creating && cur?.builtin" tone="slate" variant="subtle" :dot="false">预置</Badge>
          </div>
          <!-- 报错位在可编辑时常驻(条件是权限,不是有没有错);字才跟着错走 -->
          <template v-if="canEditRole"><p class="fp-field-err"><template v-if="nameErr">{{ nameErr }}</template></p></template>
          <div class="sr-codeline">
            <template v-if="creating">
              <label class="sr-codelbl">标识</label>
              <input v-model="form.code" class="sr-code" :class="{ bad: !!codeErr }" placeholder="英文标识,如 finance_clerk;建后不可改" />
            </template>
            <template v-else>
              <span class="sr-codetxt">{{ cur?.code }}</span>
              <span class="sr-hint">标识建后不可改</span>
              <span class="sr-hint">· {{ cur?.userCount }} 个账号使用中</span>
            </template>
            <span style="flex:1"></span>
            <!-- 删除只对自定义角色出现;有账号在用时禁用并说清要先移出(预置角色一律无此按钮) -->
            <Button v-if="canEditRole && !creating && cur && !cur.builtin" variant="outline" size="sm"
                    :disabled="cur.userCount > 0 || saving"
                    v-tip="cur.userCount > 0 ? `该角色下还有 ${cur.userCount} 个账号，请先移出` : '删除该角色'"
                    @click="remove(cur)">
              <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
              删除角色
            </Button>
          </div>
          <template v-if="creating"><p class="fp-field-err"><template v-if="codeErr">{{ codeErr }}</template></p></template>
          <input v-if="canEditRole" v-model="form.remark" class="sr-remark" placeholder="备注(选填):这个角色给谁用" />
          <p v-else-if="form.remark" class="sr-remark ro">{{ form.remark }}</p>
        </div>

        <div class="sr-body">
          <div class="sr-main">
            <!-- 菜单权限:层 → 分组 → 屏;每屏一行:查看 | 编辑 | 其他动作 -->
            <div v-if="tree.layers.length" class="sr-sec">
              <div class="sr-sechead">
                <span class="sr-sectitle">菜单权限</span>
                <span class="sr-secsub">没勾查看的屏，导航里不出、直接打开显示无权查看。层和分组那一行的勾选框管下面整列：点一下全勾，再点一下全清。</span>
              </div>
              <div class="sr-treebox">
                <div class="sr-tree">
                  <div class="sr-tr sr-th"><span>菜单</span><span>查看</span><span>编辑</span><span>其他动作</span></div>
                  <template v-for="L in tree.layers" :key="L.id">
                    <div class="sr-tr sr-tr-l" :data-layer="L.id">
                      <span class="sr-tl">{{ L.label }}</span>
                      <span v-for="col in COLS" :key="col" class="sr-tc">
                        <span v-if="tri(L, col) === 'empty'" class="sr-mx-none">—</span>
                        <label v-else class="sr-mx-c" :class="{ off: !canEditRole || tri(L, col) === 'locked' }"
                               v-tip="canEditRole && tri(L, col) === 'locked' ? LACK_TIP : undefined">
                          <input type="checkbox" :data-col="col" :checked="tri(L, col) === 'all'" :indeterminate="tri(L, col) === 'some'"
                                 :disabled="!canEditRole || tri(L, col) === 'locked'" :aria-label="`${L.label} · 全部${COL_NAME[col]}`"
                                 @change="onCol(L, col)" />
                        </label>
                      </span>
                    </div>
                    <template v-for="(g, gi) in L.groups" :key="`${L.id}-${gi}`">
                      <div v-if="g.title" class="sr-tr sr-tr-g" :data-group="g.title">
                        <span class="sr-tl">{{ g.title }}</span>
                        <span v-for="col in COLS" :key="col" class="sr-tc">
                          <span v-if="tri(g, col) === 'empty'" class="sr-mx-none">—</span>
                          <label v-else class="sr-mx-c" :class="{ off: !canEditRole || tri(g, col) === 'locked' }"
                                 v-tip="canEditRole && tri(g, col) === 'locked' ? LACK_TIP : undefined">
                            <input type="checkbox" :data-col="col" :checked="tri(g, col) === 'all'" :indeterminate="tri(g, col) === 'some'"
                                   :disabled="!canEditRole || tri(g, col) === 'locked'" :aria-label="`${g.title} · 全部${COL_NAME[col]}`"
                                   @change="onCol(g, col)" />
                          </label>
                        </span>
                      </div>
                      <div v-for="s in g.screens" :key="s.value" class="sr-tr sr-tr-s" :class="{ deep: !!g.title }" :data-screen="s.value">
                        <span class="sr-tl">
                          <span class="sr-rowlbl">{{ s.label }}</span>
                          <span v-if="s.view?.hint" class="sr-rowhint">{{ s.view.hint }}</span>
                        </span>
                        <span v-for="(p, pi) in [s.view, s.edit]" :key="pi" class="sr-tc">
                          <label v-if="p" class="sr-mx-c" :class="{ off: offKey(p.key) }" v-tip="keyTip(p)">
                            <input type="checkbox" :data-perm="p.key" :checked="has(p.key)" :disabled="offKey(p.key)" :aria-label="p.label"
                                   @change="onKey(s, p.key)" />
                          </label>
                          <span v-else class="sr-mx-none">—</span>
                        </span>
                        <span class="sr-tacts">
                          <label v-for="a in s.actions" :key="a.key" class="sr-mx-c" :class="{ off: offKey(a.key) }" v-tip="keyTip(a)">
                            <input type="checkbox" :data-perm="a.key" :checked="has(a.key)" :disabled="offKey(a.key)" @change="onKey(s, a.key)" />
                            <span>{{ shortLabel(a) }}</span>
                          </label>
                          <span v-if="!s.actions.length" class="sr-mx-none">—</span>
                        </span>
                      </div>
                    </template>
                  </template>
                </div>
              </div>
            </div>

            <!-- 不分屏的权限:审核、编辑锁授权、可请求提权 -->
            <div v-if="tree.cross.length" class="sr-sec">
              <div class="sr-sechead">
                <span class="sr-sectitle">不分屏的权限</span>
              </div>
              <label v-for="p in tree.cross" :key="p.key" class="sr-row" :class="{ off: offKey(p.key) }"
                     v-tip="canEditRole && lacks(p.key) ? LACK_TIP : undefined">
                <input type="checkbox" :data-perm="p.key" :checked="has(p.key)" :disabled="offKey(p.key)"
                       @change="toggle(form.perms, p.key)" />
                <span class="sr-rowtxt">
                  <span class="sr-rowlbl">{{ p.label }}</span>
                  <span class="sr-rowhint">{{ p.hint }}</span>
                </span>
              </label>
            </div>

            <!-- 导航可见层 -->
            <div class="sr-sec">
              <div class="sr-sechead">
                <span class="sr-sectitle">导航可见层</span>
                <span class="sr-secsub">
                  勾掉的层在这个角色的左侧导航里不显示。系统管理层不在这里配,看用户管理、角色权限、操作日志这三屏的查看勾没勾
                </span>
              </div>
              <label v-for="l in navLayerDefs" :key="l.id" class="sr-row" :class="{ off: !canEditRole }">
                <input type="checkbox" :checked="form.navLayers.includes(l.id)" :disabled="!canEditRole"
                       @change="toggle(form.navLayers, l.id)" />
                <span class="sr-rowtxt"><span class="sr-rowlbl">{{ l.label }}</span></span>
              </label>
            </div>
          </div>

          <!-- 本角色成员(右栏内宽 >935 在权限树右边一列;≤935 排到权限树上面,见下面的容器查询) -->
          <aside class="sr-mem">
            <div class="sr-memhead">
              <span class="sr-sectitle">{{ memberTitle }}</span>
              <Popover v-if="canEditRole" align="end" :width="280">
                <template #trigger>
                  <Button variant="outline" size="sm" class="sr-memadd">
                    <template #leading><component :is="iconFor('plus')" :size="14" /></template>
                    添加成员
                  </Button>
                </template>
                <SearchField v-model="q" placeholder="按账号或姓名找" shortcut="" :width="262" />
                <div class="sr-cands" role="menu">
                  <PopoverItem v-for="u in candidates" :key="u.id" class="sr-cand" role="menuitem" :data-user="u.username"
                               :disabled="!!memberLock(u, false)" v-tip="memberLock(u, false) || undefined" @click="addMember(u)">
                    <span class="sr-acct">{{ u.username }}</span>
                    <span class="sr-mname">{{ u.displayName }}</span>
                    <Badge v-if="u.status !== 1" tone="neutral" variant="subtle" :dot="false">已停用</Badge>
                  </PopoverItem>
                  <p v-if="!candidates.length" class="sr-memnone">{{ outside.length ? '没有找到这个账号' : '所有账号都已在这个角色里' }}</p>
                </div>
              </Popover>
            </div>
            <p v-if="!memberRows.length" class="sr-memnone">还没有账号用这个角色</p>
            <ul v-else class="sr-memlist">
              <li v-for="r in memberRows" :key="r.u.id" class="sr-memrow" :class="{ out: r.state === 'remove' }" :data-user="r.u.username">
                <span class="sr-memtxt">
                  <span class="sr-acct">{{ r.u.username }}</span>
                  <span class="sr-mname">{{ r.u.displayName }}</span>
                </span>
                <span class="sr-memtags">
                  <Badge v-if="r.state === 'add'" tone="blue" variant="subtle" :dot="false">保存后加入</Badge>
                  <Badge v-if="r.state === 'remove'" tone="orange" variant="subtle" :dot="false">保存后移出</Badge>
                  <Badge v-if="r.u.status !== 1" tone="neutral" variant="subtle" :dot="false">已停用</Badge>
                  <Badge v-if="auth.me && r.u.username === auth.me" tone="slate" variant="subtle" :dot="false">你</Badge>
                </span>
                <template v-if="canEditRole">
                  <Button v-if="r.state === 'remove'" variant="borderless" size="sm" class="sr-memact" @click="undoRemove(r)">撤销</Button>
                  <Button v-else variant="borderless" size="sm" class="sr-memact"
                          :disabled="r.state === 'keep' && !!memberLock(r.u, true)"
                          v-tip="r.state === 'keep' ? memberLock(r.u, true) || undefined : undefined"
                          @click="removeMember(r)">移出</Button>
                </template>
              </li>
            </ul>
          </aside>
        </div>

        <div v-if="canEditRole" class="sr-act">
          <Button variant="gray" size="sm" :disabled="saving || !dirty" @click="cancel">取消</Button>
          <Button variant="filled" size="sm" :disabled="saving || !dirty" @click="save">
            {{ saving ? '保存中…' : creating ? '新建角色' : '保存' }}
          </Button>
        </div>
        <p v-else-if="canEdit" class="sr-ro">{{ rangeNote }}</p>
        <p v-else class="sr-ro">只读：改角色需要「角色权限 · 编辑」。</p>
      </section>

      <div v-else class="sr-pane empty">左栏选一个角色</div>
    </div>
  </div>
</template>

<style scoped>
.sr-page { display: flex; flex-direction: column; gap: 14px; box-sizing: border-box; max-width: 1440px; margin: 0 auto; width: 100%; }
.sr-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.sr-title { margin: 0; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.sr-sub { margin: 5px 0 0; font-size: var(--fs-label); color: var(--text-muted); }

.sr-empty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }

.sr-split { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 16px; align-items: start; }

/* 左栏 */
.sr-list { display: flex; flex-direction: column; gap: 4px; }
.sr-grp { padding: 8px 4px 2px; font-size: var(--fs-micro); font-weight: var(--fw-semibold); color: var(--text-muted); }
.sr-item { display: flex; flex-direction: column; gap: 2px; padding: 9px 11px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-white); text-align: left; cursor: pointer; font-family: var(--font-sans); }
.sr-item:hover { background: var(--surface-card); }
.sr-item.sel { border-color: var(--hue-blue); background: rgba(10, 132, 255, 0.06); }
.sr-item-n { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.sr-item-s { font-size: var(--fs-micro); color: var(--text-muted); font-family: var(--font-mono); }
.sr-item.add { flex-direction: row; align-items: center; justify-content: center; gap: 6px; margin-top: 6px; border-style: dashed; color: var(--text-secondary); font-size: var(--fs-label); }
.sr-none { padding: 6px 11px 2px; font-size: var(--fs-micro); color: var(--text-disabled); }

/* 右栏 */
/* container-type:成员栏放不放得在权限树右边,看的是右栏本身有多宽 —— 视口 1440 时左边导航一开,右栏只剩 770 上下(浏览器实测) */
.sr-pane { container-type: inline-size; display: flex; flex-direction: column; gap: 14px; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); padding: 16px 18px; }
.sr-pane.empty { align-items: center; justify-content: center; min-height: 220px; color: var(--text-disabled); font-size: var(--fs-label); }

.sr-panehead { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--divider); }
.sr-nameline { display: flex; align-items: center; gap: 10px; }
.sr-name { flex: 0 1 320px; height: 34px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--border-control); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-sans); font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.sr-name:focus { outline: none; border-color: var(--hue-blue); }
.sr-name.ro { border-color: transparent; padding-left: 0; line-height: 34px; }
.sr-name.bad { border-color: var(--status-danger); }
.sr-codeline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sr-codelbl { font-size: var(--fs-label); color: var(--text-secondary); }
.sr-code { width: 280px; height: 30px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--border-control); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary); }
.sr-code:focus { outline: none; border-color: var(--hue-blue); }
.sr-code.bad { border-color: var(--status-danger); }
.sr-codetxt { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-secondary); padding: 2px 8px; border-radius: var(--radius-full); background: var(--surface-sunken); }
.sr-hint { font-size: var(--fs-micro); color: var(--text-muted); }
.sr-remark { height: 30px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--border-control); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-primary); }
.sr-remark:focus { outline: none; border-color: var(--hue-blue); }
p.sr-remark.ro { margin: 0; border: none; padding: 0; height: auto; color: var(--text-muted); }

/* 权限树 + 成员:宽屏两列,成员在右 */
.sr-body { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px; align-items: start; }
.sr-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.sr-sec { display: flex; flex-direction: column; }
.sr-sechead { display: flex; flex-direction: column; gap: 2px; padding: 2px 0 8px; }
.sr-sectitle { font-size: var(--fs-h4); font-weight: var(--fw-semibold); color: var(--text-primary); }
.sr-secsub { font-size: var(--fs-micro); color: var(--text-muted); line-height: 1.5; }

.sr-row { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 4px 8px; border-radius: var(--radius-sm); cursor: pointer; }
.sr-row:hover { background: var(--bg-hover); }
.sr-row.off { cursor: default; }
.sr-row.off:hover { background: transparent; }
.sr-row input { accent-color: var(--hue-blue); cursor: pointer; flex: 0 0 auto; }
.sr-row input:disabled { cursor: default; }
.sr-rowtxt { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
.sr-rowlbl { font-size: var(--fs-body); color: var(--text-primary); }
.sr-rowhint { font-size: var(--fs-micro); color: var(--text-muted); line-height: 1.4; }

/* 权限树:菜单 | 查看 | 编辑 | 其他动作(放不下就折行);外框横滚不裁内容 */
.sr-treebox { overflow-x: auto; }
.sr-tree { display: flex; flex-direction: column; min-width: 600px; }
.sr-tr { display: grid; grid-template-columns: minmax(200px, 1.4fr) 56px 56px minmax(0, 2fr); gap: 12px; align-items: center; padding: 8px; border-bottom: 1px solid var(--divider); }
.sr-th { padding-top: 0; font-size: var(--fs-micro); font-weight: var(--fw-semibold); color: var(--text-muted); }
.sr-tr-l { background: var(--surface-card); font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.sr-tr-g .sr-tl { padding-left: 16px; font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-secondary); }
.sr-tr-s .sr-tl { padding-left: 16px; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.sr-tr-s.deep .sr-tl { padding-left: 32px; }
.sr-tc { display: flex; align-items: center; }
.sr-tacts { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.sr-mx-c { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; font-size: var(--fs-label); font-weight: var(--fw-regular); color: var(--text-primary); cursor: pointer; }
.sr-mx-c.off { cursor: default; }
.sr-mx-c input { accent-color: var(--hue-blue); cursor: pointer; margin: 0; }
.sr-mx-c input:disabled { cursor: default; }
.sr-mx-none { font-size: var(--fs-label); font-weight: var(--fw-regular); color: var(--text-disabled); }

/* 成员栏 */
.sr-mem { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.sr-memhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 0; }
.sr-cands { display: flex; flex-direction: column; gap: 2px; max-height: 280px; overflow-y: auto; margin-top: 8px; }
.sr-cand[disabled] { color: var(--text-disabled); cursor: default; }
.sr-cand[disabled]:hover { background: transparent; }
.sr-memnone { margin: 0; padding: 8px 2px; font-size: var(--fs-label); color: var(--text-muted); }
.sr-memlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.sr-memrow { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 0; border-bottom: 1px solid var(--divider); }
.sr-memrow.out .sr-memtxt { color: var(--text-muted); text-decoration: line-through; }
.sr-memtxt { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; color: var(--text-primary); }
.sr-memtags { display: inline-flex; flex-wrap: wrap; gap: 4px; flex: 0 1 auto; }
.sr-acct { font-family: var(--font-mono); font-size: var(--fs-label); }
.sr-mname { font-size: var(--fs-micro); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-cand .sr-mname { flex: 1 1 auto; }
.sr-memact { flex: 0 0 auto; }

/* 保存条贴着视口底:权限树六七十行,不该滚到底才找得到「保存」 */
.sr-act { position: sticky; bottom: 0; z-index: 1; display: flex; justify-content: flex-end; gap: 8px; padding: 12px 0; border-top: 1px solid var(--divider); background: var(--surface-white); }
.sr-ro { margin: 0; padding-top: 12px; border-top: 1px solid var(--divider); font-size: var(--fs-micro); color: var(--text-muted); }

/* 右栏内宽放不下「权限树 600 + 间距 16 + 成员 280」再留 40 余量:成员排到权限树上面整宽 */
@container (max-width: 935px) {
  .sr-body { grid-template-columns: minmax(0, 1fr); }
  .sr-mem { order: -1; }
}
/* ── M/S 档(≤960):双栏降单列——角色列表在上、权限树在下(DOM 序即视觉序,无需重排)。
   权限树窄屏会超宽:外框显式横滚不裁内容(§5.4 口径)。
   配置操作不优化(§11.1 系统管理配置明确不做),查看/勾选可用即可 ── */
@media (max-width: 960px) {
  .sr-split { grid-template-columns: 1fr; }
}
</style>
