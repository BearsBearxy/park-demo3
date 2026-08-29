<script setup lang="ts">
// 用户管理(RBAC-SPEC §10 P1)。骨架抄租户管理屏(列表 + 抽屉 + 逐条 CRUD),布局遵 LIST-PAGE-SPEC。
//
// ⚠ 全屏没有「删除账号」:账号只停用不删除(RBAC-SPEC §8)。删掉的账号名下有导入记录、
//   系数簿修改历史、审核痕迹,真删了这些记录成孤儿,追责链断掉。后端也没有 DELETE /system/users。
//
// 读全开的唯一例外是 system 层(§0):无 system:edit 的人进得来、看得见全部账号与角色,
//   只是所有写按钮不渲染 —— 与其它屏「显示但不能改」同一口径。
import { ref, computed, watch, onMounted, onBeforeUnmount, h } from 'vue'
import { systemApi } from '@/api/system'
import type { RoleDTO, UserDTO } from '@/types/system'
import type { SortState } from '@/components/fp/fpSort'
import KpiCard from '@/components/ds/KpiCard.vue'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Avatar from '@/components/ds/Avatar.vue'
import Select from '@/components/ds/Select.vue'
import Badge from '@/components/ds/Badge.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPSectionLabel from '@/components/fp/FPSectionLabel.vue'
import FPSortableTable, { type SortableColumn } from '@/components/fp/FPSortableTable.vue'
import { useFitRows } from '@/components/fp/useFitRows'
import FPPager from '@/components/fp/FPPager.vue'
import { iconFor } from '@/components/ds/icon'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const canEdit = computed(() => auth.can('system:edit'))

// ─── state ───────────────────────────────────────────────
const users = ref<UserDTO[] | null>(null)   // null = 首载未完成(不闪「共 0 个账号」空态)
const roles = ref<RoleDTO[]>([])
const loadErr = ref('')

const q = ref('')
const roleFilter = ref('')      // '' = 全部角色
const statusFilter = ref('')    // '' = 全部状态
const sort = ref<SortState | null>(null)
const page = ref(1)
const tableWrapEl = ref<HTMLElement | null>(null)
const pageSize = useFitRows(tableWrapEl)

// ─── 错误文案 ─────────────────────────────────────────────
const errText = (e: unknown, fallback: string) => (e as { message?: string })?.message || fallback

// 后端两条守卫要给人话,不能把原始报错糊到用户脸上。契约没规定 message 文本,
// 所以按「关键词 + HTTP 状态」双路匹配;都不命中时透传后端原文(总比英文 AxiosError 强)。
function rejectText(e: unknown, fallback: string): string {
  const msg = errText(e, '')
  const status = (e as { response?: { status?: number } })?.response?.status
  // ① 自我保护:不能停用自己、不能改自己的角色 —— 否则管理员一步把自己锁在门外
  if (/self|自己|本人|current user/i.test(msg)) {
    return '这一步不能对你自己的账号做 —— 停用自己或改掉自己的角色会把你锁在门外。请让另一位管理员来操作。'
  }
  // ② 用户名唯一
  if (status === 409 || /exist|duplicate|已存在|重复|占用/i.test(msg)) {
    return '这个用户名已经被占用了,换一个再试。'
  }
  return msg || fallback
}

async function reload() {
  loadErr.value = ''
  try {
    // 账号只有几十行:q/roleId/status 三个筛选全在前端算,不为每次敲键去 refetch
    const [us, rs] = await Promise.all([systemApi.users(), systemApi.roles()])
    users.value = us
    roles.value = rs
  } catch (e) {
    users.value = null                       // 失败不留半截旧数据在屏上
    loadErr.value = errText(e, '服务异常')
  }
}
onMounted(reload)

// ─── 筛选 ────────────────────────────────────────────────
const STATUS_OPTS = [
  { value: '', label: '全部状态' },
  { value: '1', label: '启用' },
  { value: '0', label: '停用' },
]
const roleOpts = computed(() => [
  { value: '', label: '全部角色' },
  ...roles.value.map(r => ({ value: String(r.id), label: r.name })),
])

const filtered = computed(() => (users.value ?? []).filter(u => {
  const kw = q.value.trim()
  if (kw && !u.username.includes(kw) && !u.displayName.includes(kw)) return false
  if (statusFilter.value !== '' && String(u.status) !== statusFilter.value) return false
  if (roleFilter.value !== '' && !u.roles.some(r => String(r.id) === roleFilter.value)) return false
  return true
}))

const kpi = computed(() => {
  const all = users.value ?? []
  return { total: all.length, on: all.filter(u => u.status === 1).length, off: all.filter(u => u.status !== 1).length }
})

// ─── 表格 ────────────────────────────────────────────────
// 停用行灰化(数据照常显示,只是视觉降一档);启用行正常色
const nameColor = (u: UserDTO) => (u.status === 1 ? 'var(--text-primary)' : 'var(--text-muted)')
const fmtTime = (s: string) => (s ? s.replace('T', ' ').slice(0, 16) : '—')
// S 档行卡次级字段:角色拼一串,口径与角色列的 title 一致(不另造格式)
const roleText = (u: UserDTO) => (u.roles.length ? u.roles.map(r => r.name).join(' · ') : '未分配角色')

const columns = computed<SortableColumn<UserDTO>[]>(() => {
  const cols: SortableColumn<UserDTO>[] = [
    {
      key: 'username', header: '用户名', width: '210px',
      sortValue: (u: UserDTO) => u.username,
      render: (u: UserDTO) => h('span', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } }, [
        h(Avatar, { name: u.displayName || u.username, size: 30, style: u.status === 1 ? undefined : 'opacity:.55' }),
        h('span', {
          title: u.username,
          style: {
            fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 'var(--fw-medium)',
            color: nameColor(u), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
        }, u.username),
      ]),
    },
    {
      key: 'displayName', header: '显示名', width: '190px',
      sortValue: (u: UserDTO) => u.displayName,
      render: (u: UserDTO) => h('span', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } }, [
        h('span', {
          title: u.displayName,
          style: { color: nameColor(u), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, u.displayName),
        // 首次登录强制改密(拍板 #3):没改过的标出来,管理员才知道这人还在用初始密码
        u.mustChangePassword
          ? h(Badge, { tone: 'orange', variant: 'subtle', style: 'flex:0 0 auto', title: '该账号还在用初始密码,下次登录会被要求修改' }, () => '待改密')
          : null,
      ]),
    },
    {
      // 唯一的弹性列(列宽铁律:至多一列不定宽,吸收余宽)
      key: 'roles', header: '角色',
      sortValue: (u: UserDTO) => u.roles.map(r => r.name).join(','),
      render: (u: UserDTO) => u.roles.length
        ? h('span', {
            title: u.roles.map(r => r.name).join(' · '),
            style: { display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' },
          }, u.roles.map(r => h(Badge, { key: r.id, tone: 'slate', variant: 'subtle', style: 'flex:0 0 auto' }, () => r.name)))
        : h('span', { style: { color: 'var(--text-muted)' } }, '未分配角色'),
    },
    {
      key: 'status', header: '状态', width: '96px',
      sortValue: (u: UserDTO) => u.status,
      render: (u: UserDTO) => h(Badge, { tone: u.status === 1 ? 'blue' : 'neutral', variant: 'subtle' }, () => (u.status === 1 ? '启用' : '停用')),
    },
    {
      key: 'createdAt', header: '创建时间', width: '160px', mono: true,
      sortValue: (u: UserDTO) => u.createdAt ?? '',
      render: (u: UserDTO) => h('span', { style: { color: 'var(--text-muted)', fontSize: '12px' } }, fmtTime(u.createdAt)),
    },
  ]
  // 无 system:edit 时整列不渲染(而不是渲染一排点了会 403 的按钮)
  if (canEdit.value) {
    cols.push({
      key: 'ops', header: '操作', width: '250px', align: 'right' as const,
      render: (u: UserDTO) => {
        // 自己那一行:「编辑(改角色)」与「停用」后端有自锁守卫会 409,前端预先禁掉 ——
        // 让人点一个注定失败的按钮是坏体验。重置密码不禁:给自己重置是合法的。
        const isMe = !!auth.me && u.username === auth.me
        const selfTip = '不能对自己做这个操作 —— 改掉自己的角色或停用自己会把你锁在门外,'
                      + '而这个系统没有第二条进门的路。请让另一位管理员操作。'
        return h('span', { style: { display: 'inline-flex', gap: '6px', justifyContent: 'flex-end' } }, [
          h(Button, {
            variant: 'outline', size: 'sm', disabled: isMe, title: isMe ? selfTip : undefined,
            onClick: (e: MouseEvent) => { e.stopPropagation(); if (!isMe) openEdit(u) },
          }, () => '编辑'),
          h(Button, { variant: 'outline', size: 'sm', onClick: (e: MouseEvent) => { e.stopPropagation(); openReset(u) } }, () => '重置密码'),
          h(Button, {
            variant: u.status === 1 ? 'gray' : 'filled', size: 'sm',
            disabled: isMe, title: isMe ? selfTip : undefined,
            onClick: (e: MouseEvent) => { e.stopPropagation(); if (!isMe) openToggle(u) },
          }, () => (u.status === 1 ? '停用' : '启用')),
        ])
      },
    })
  }
  return cols
})

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
const safePage = computed(() => Math.min(page.value, pageCount.value))
const paged = computed(() => filtered.value.slice((safePage.value - 1) * pageSize.value, safePage.value * pageSize.value))
watch([q, roleFilter, statusFilter, sort], () => { page.value = 1 })

// ─── 新建账号 ─────────────────────────────────────────────
const newDlg = ref(false)
const nUsername = ref('')
const nDisplay = ref('')
const nPassword = ref('')
const nRoleIds = ref<number[]>([])
const nErr = ref('')
const nBusy = ref(false)
const nDone = ref('')    // 非空 = 创建成功,弹窗转成结果页(而不是弹一条会顶动表格的提示条)

function openNew() {
  newDlg.value = true
  nUsername.value = ''; nDisplay.value = ''; nPassword.value = ''
  nRoleIds.value = []; nErr.value = ''; nDone.value = ''
}

async function submitNew() {
  const username = nUsername.value.trim()
  const displayName = nDisplay.value.trim()
  if (!username) { nErr.value = '请输入用户名'; return }
  if (!displayName) { nErr.value = '请输入显示名'; return }
  if (!nPassword.value) { nErr.value = '请设置初始密码'; return }
  if (nBusy.value) return
  nBusy.value = true
  try {
    await systemApi.createUser({ username, displayName, password: nPassword.value, roleIds: [...nRoleIds.value] })
    nDone.value = username
    nPassword.value = ''            // 明文密码不在内存里多留一秒
    await reload()
  } catch (e) {
    nErr.value = rejectText(e, '新建账号失败')
  } finally {
    nBusy.value = false
  }
}

// ─── 编辑(抽屉) ──────────────────────────────────────────
const openUser = ref<UserDTO | null>(null)
const eDisplay = ref('')
const eRoleIds = ref<number[]>([])
const eErr = ref('')
const eBusy = ref(false)

function openEdit(u: UserDTO) {
  openUser.value = u
  eDisplay.value = u.displayName
  eRoleIds.value = u.roles.map(r => r.id)
  eErr.value = ''
}

async function submitEdit() {
  const u = openUser.value
  if (!u || eBusy.value) return
  const displayName = eDisplay.value.trim()
  if (!displayName) { eErr.value = '显示名不能为空'; return }
  eBusy.value = true
  try {
    await systemApi.updateUser(u.id, { displayName, roleIds: [...eRoleIds.value] })
    openUser.value = null
    await reload()
  } catch (e) {
    eErr.value = rejectText(e, '保存失败')
  } finally {
    eBusy.value = false
  }
}

// ─── 重置密码 ─────────────────────────────────────────────
const pwTarget = ref<UserDTO | null>(null)
const pwVal = ref('')
const pwErr = ref('')
const pwBusy = ref(false)
const pwDone = ref(false)

function openReset(u: UserDTO) {
  pwTarget.value = u; pwVal.value = ''; pwErr.value = ''; pwDone.value = false
}

async function submitReset() {
  const u = pwTarget.value
  if (!u || pwBusy.value) return
  if (!pwVal.value) { pwErr.value = '请输入新密码'; return }
  pwBusy.value = true
  try {
    await systemApi.resetPassword(u.id, pwVal.value)
    pwVal.value = ''
    pwDone.value = true
    await reload()
  } catch (e) {
    pwErr.value = rejectText(e, '重置密码失败')
  } finally {
    pwBusy.value = false
  }
}

// ─── 停用 / 启用 ──────────────────────────────────────────
const tgTarget = ref<UserDTO | null>(null)
const tgErr = ref('')
const tgBusy = ref(false)

function openToggle(u: UserDTO) {
  tgTarget.value = u; tgErr.value = ''
}

async function submitToggle() {
  const u = tgTarget.value
  if (!u || tgBusy.value) return
  tgBusy.value = true
  try {
    await systemApi.setUserStatus(u.id, u.status === 1 ? 0 : 1)
    tgTarget.value = null
    await reload()
  } catch (e) {
    tgErr.value = rejectText(e, '操作失败')
  } finally {
    tgBusy.value = false
  }
}

// Esc 关最上层的弹窗(抽屉自带,三个 .fin-dlg 靠这一条)。ds/Select 展开时会在 capture
// 阶段吞掉 Esc,所以收下拉不会连坐把弹窗一起关掉(UI-OVERLAY-SPEC §2)。
function onEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (tgTarget.value) tgTarget.value = null
  else if (pwTarget.value) pwTarget.value = null
  else if (newDlg.value) newDlg.value = false
}
onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))
</script>

<template>
  <!-- 根收编 .mx-page(迁移①):内联 height:100% 媒体查询盖不住,S 档高度链三件套要在类上生效;
       fp-fluid = 摘掉 base.css 的 800px 屏级地板(通过 §9 验收的标志) -->
  <div class="mx-page fp-fluid">
    <!-- 1. 标题行 -->
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0;font-size:var(--fs-h2);font-weight:var(--fw-semibold)">用户管理</h2>
        <p style="margin:5px 0 0;font-size:var(--fs-label);color:var(--text-muted)">
          系统管理 · 共 {{ users ? users.length : '…' }} 个账号 · 账号只停用不删除,历史记录中的操作痕迹保留
        </p>
      </div>
      <div v-if="canEdit" style="display:flex;gap:8px">
        <Button variant="filled" size="sm" @click="openNew">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新建账号
        </Button>
      </div>
    </div>

    <!-- 数据区:首载完成前只转圈,失败给人话 + 重试,不闪空表 -->
    <!-- 数据体**不再整屏 v-if** —— 外壳常驻，只在叶子上放骨架（加载态设计稿 §07「精确占位」）。
         零位移由「外壳从不卸载」这个结构保证，不是靠两份版式对齐出来的。 -->
      <div class="mx-body">
        <aside class="mx-kpirail">
          <KpiCard label="账号总数" :value="String(kpi.total)" tint="slate" :style="{ padding: '20px' }">
            <template #icon><component :is="iconFor('users')" :size="16" /></template>
          </KpiCard>
          <KpiCard label="启用中" :value="String(kpi.on)" tint="blue" :style="{ padding: '20px' }">
            <template #icon><component :is="iconFor('check-circle-2')" :size="16" /></template>
          </KpiCard>
          <KpiCard label="已停用" :value="String(kpi.off)" sub="登不进来,痕迹保留" tint="plain" :style="{ padding: '20px' }">
            <template #icon><component :is="iconFor('lock')" :size="16" /></template>
          </KpiCard>
          <KpiCard label="角色" :value="String(roles.length)" tint="cyan" :style="{ padding: '20px' }">
            <template #icon><component :is="iconFor('shield-check')" :size="16" /></template>
          </KpiCard>
        </aside>

        <div class="mx-main">
          <!-- 2. 工具栏(LIST-PAGE-SPEC §2:单行,右侧 搜索 + Select)。
               本屏无期别/分组维度,左侧留空占位撑开 space-between —— 不为凑规范硬造一组 tab。 -->
          <div class="mx-toolbar">
            <span aria-hidden="true" />
            <div class="mx-toolbar-right">
              <div class="mx-search">
                <span class="mx-search-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </span>
                <input v-model="q" placeholder="搜索用户名 / 显示名" />
              </div>
              <div style="width:150px">
                <Select :options="roleOpts" v-model="roleFilter" size="sm" />
              </div>
              <div style="width:130px">
                <Select :options="STATUS_OPTS" v-model="statusFilter" size="sm" />
              </div>
            </div>
          </div>

          <!-- 3. 列表卡片(LIST-PAGE-SPEC §3) -->
          <Card surface="white" :padding="0" class="mx-listcard">
            <div ref="tableWrapEl" class="mx-tablewrap">
              <FPSortableTable
                :columns="columns"
                :rows="paged"
                rowKey="id"
                :sort="sort"
                :rowHover="true"
                :skeleton-rows="users || loadErr ? 0 : pageSize"
                @sortChange="sort = $event"
                @rowClick="openEdit($event)"
              >
                <!-- S 档行卡映射(迁移②,spec §5.1:主字段 + ≤2 次级 + 状态胶囊,72px 内);
                     点卡=点行,仍走 @rowClick 开编辑抽屉。重置密码/停用只在桌面表格的操作列,
                     手机入口属屏组后续自决(与 S 档无排序入口同一口径) -->
                <template #card="{ row }">
                  <div class="mx-rowcard-main">{{ row.displayName }}</div>
                  <div class="mx-rowcard-sub">
                    <span style="font-family:var(--font-mono)">{{ row.username }}</span>
                    <span>{{ roleText(row) }}</span>
                    <!-- flex:0 0 auto 豁免 .mx-rowcard-sub > * 的 min-width:0,胶囊不被截字 -->
                    <span style="margin-left:auto;flex:0 0 auto">
                      <Badge :tone="row.status === 1 ? 'blue' : 'neutral'" variant="subtle">
                        {{ row.status === 1 ? '启用' : '停用' }}
                      </Badge>
                    </span>
                  </div>
                </template>
              </FPSortableTable>
            </div>
            <div v-if="users && filtered.length === 0" style="text-align:center;padding:40px;color:var(--text-disabled)">没有匹配的账号</div>
            <div v-if="!users || filtered.length > 0" class="mx-pagerbar">
              <FPPager :page="safePage" :pageCount="pageCount" :total="filtered.length" @page="page = $event" />
            </div>
          </Card>
        </div>
      </div>
    <!-- 失败态仍是流内条:阻断性错误本就该打断流程(LAYOUT-STABILITY §6) -->
    <FPLoadError v-if="loadErr" @retry="reload">
      <span>账号列表没加载出来:{{ loadErr }} —— 屏上不显示任何账号,重试成功前无法管理。</span>
    </FPLoadError>

    <!-- 4. 编辑抽屉(用户名不可改) -->
    <FPDrawer
      :open="!!openUser"
      :title="openUser?.displayName ?? ''"
      :subtitle="openUser ? `${openUser.username} · 创建于 ${fmtTime(openUser.createdAt)}` : ''"
      icon="user"
      :width="560"
      @close="openUser = null"
    >
      <template #badge>
        <Badge v-if="openUser" :tone="openUser.status === 1 ? 'blue' : 'neutral'" variant="subtle">
          {{ openUser.status === 1 ? '启用' : '停用' }}
        </Badge>
        <Badge v-if="openUser?.mustChangePassword" tone="orange" variant="subtle">待改密</Badge>
      </template>

      <template v-if="canEdit" #footer>
        <Button variant="gray" size="sm" @click="openUser = null">取消</Button>
        <Button variant="filled" size="sm" :disabled="eBusy" @click="submitEdit">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          保存
        </Button>
      </template>

      <div v-if="openUser">
        <FPSectionLabel icon="user">账号</FPSectionLabel>
        <div class="su-stack">
          <div class="su-field">
            <div class="lab">用户名</div>
            <!-- 只读:导入记录、系数簿修改历史、审核痕迹都按它追责,改了历史就对不上人 -->
            <div class="su-ro">{{ openUser.username }}</div>
            <div class="su-hint">用户名创建后不可修改 —— 历史记录里的操作痕迹按它认人。</div>
          </div>
          <div class="su-field">
            <div class="lab">显示名</div>
            <input class="su-in" v-model="eDisplay" :disabled="!canEdit" placeholder="如:张会计" @input="eErr = ''" @keydown.enter="submitEdit" />
          </div>
        </div>
      </div>

      <div v-if="openUser">
        <FPSectionLabel icon="shield-check">角色 · 可多选</FPSectionLabel>
        <p class="su-hint" style="margin:0 0 8px">一个人可以有多个角色(如「主管兼管理员」),权限取并集。</p>
        <div class="su-roles">
          <label v-for="r in roles" :key="r.id" class="su-role" :class="{ dis: !canEdit }">
            <input type="checkbox" :value="r.id" v-model="eRoleIds" :disabled="!canEdit" />
            <span class="su-role-n">{{ r.name }}</span>
            <span v-if="r.builtin" class="su-role-b">预置</span>
            <span class="su-role-r">{{ r.remark || '' }}</span>
          </label>
          <div v-if="roles.length === 0" class="su-hint">没有可分配的角色 —— 先去「角色权限」屏建一个。</div>
        </div>
        <div class="su-erm">{{ eErr }}</div>
      </div>
    </FPDrawer>

    <!-- 5. 新建账号弹窗 -->
    <Teleport to="body">
      <div v-if="newDlg" class="fin-mask" @mousedown="newDlg = false">
        <div class="fin-dlg" role="dialog" aria-modal="true" @mousedown.stop>
          <!-- 成功页:初始密码的口径必须让管理员读到,所以不关窗直接转结果态 -->
          <template v-if="nDone">
            <div class="fin-dlg-h">
              <h3>账号已创建</h3>
              <p>账号「{{ nDone }}」已创建。初始密码已设置,该账号首次登录时会被要求修改密码。</p>
            </div>
            <div class="fin-dlg-f" style="padding-top:20px">
              <Button variant="filled" size="sm" @click="newDlg = false">完成</Button>
            </div>
          </template>
          <template v-else>
            <div class="fin-dlg-h">
              <h3>新建账号</h3>
              <p>设一个初始密码交给本人,他首次登录时会被要求改掉。账号建好后只能停用,不能删除。</p>
            </div>
            <div class="fin-dlg-b">
              <div class="fin-row">
                <div class="su-field">
                  <div class="lab">用户名 <b class="req">*</b></div>
                  <input class="su-in" :class="{ err: nErr }" v-model="nUsername" placeholder="登录用,如 zhang.kj" @input="nErr = ''" @keydown.enter="submitNew" />
                </div>
                <div class="su-field">
                  <div class="lab">显示名 <b class="req">*</b></div>
                  <input class="su-in" :class="{ err: nErr }" v-model="nDisplay" placeholder="如:张会计" @input="nErr = ''" @keydown.enter="submitNew" />
                </div>
              </div>
              <div class="su-field">
                <div class="lab">初始密码 <b class="req">*</b></div>
                <input class="su-in" :class="{ err: nErr }" type="password" v-model="nPassword" placeholder="交给本人,首次登录须改" @input="nErr = ''" @keydown.enter="submitNew" />
              </div>
              <div class="su-field">
                <div class="lab">角色 · 可多选</div>
                <div class="su-roles">
                  <label v-for="r in roles" :key="r.id" class="su-role">
                    <input type="checkbox" :value="r.id" v-model="nRoleIds" />
                    <span class="su-role-n">{{ r.name }}</span>
                    <span v-if="r.builtin" class="su-role-b">预置</span>
                    <span class="su-role-r">{{ r.remark || '' }}</span>
                  </label>
                  <div v-if="roles.length === 0" class="su-hint">没有可分配的角色 —— 可以先建账号,之后再到「角色权限」屏分配。</div>
                </div>
              </div>
              <div class="fin-erm">{{ nErr }}</div>
            </div>
            <div class="fin-dlg-f">
              <Button variant="gray" size="sm" @click="newDlg = false">取消</Button>
              <Button variant="filled" size="sm" :disabled="nBusy" @click="submitNew">
                <template #leading><component :is="iconFor('check')" :size="14" /></template>
                创建
              </Button>
            </div>
          </template>
        </div>
      </div>
    </Teleport>

    <!-- 6. 重置密码弹窗 -->
    <Teleport to="body">
      <div v-if="pwTarget" class="fin-mask" @mousedown="pwTarget = null">
        <div class="fin-dlg" role="dialog" aria-modal="true" @mousedown.stop>
          <template v-if="pwDone">
            <div class="fin-dlg-h">
              <h3>密码已重置</h3>
              <p>「{{ pwTarget.displayName }}」的密码已重置,该账号下次登录须修改密码。</p>
            </div>
            <div class="fin-dlg-f" style="padding-top:20px">
              <Button variant="filled" size="sm" @click="pwTarget = null">完成</Button>
            </div>
          </template>
          <template v-else>
            <div class="fin-dlg-h">
              <h3>重置密码</h3>
              <p>为「{{ pwTarget.displayName }}({{ pwTarget.username }})」设一个新密码。提交后该账号下次登录须修改密码。</p>
            </div>
            <div class="fin-dlg-b">
              <div class="su-field">
                <div class="lab">新密码 <b class="req">*</b></div>
                <input class="su-in" :class="{ err: pwErr }" type="password" v-model="pwVal" placeholder="交给本人" @input="pwErr = ''" @keydown.enter="submitReset" />
              </div>
              <div class="fin-erm">{{ pwErr }}</div>
            </div>
            <div class="fin-dlg-f">
              <Button variant="gray" size="sm" @click="pwTarget = null">取消</Button>
              <Button variant="filled" size="sm" :disabled="pwBusy" @click="submitReset">
                <template #leading><component :is="iconFor('check')" :size="14" /></template>
                重置
              </Button>
            </div>
          </template>
        </div>
      </div>
    </Teleport>

    <!-- 7. 停用 / 启用 二次确认(文案是「停用」,不是「删除」) -->
    <Teleport to="body">
      <div v-if="tgTarget" class="fin-mask" @mousedown="tgTarget = null">
        <div class="fin-dlg" role="dialog" aria-modal="true" @mousedown.stop>
          <div class="fin-dlg-h">
            <h3>{{ tgTarget.status === 1 ? '停用账号' : '启用账号' }}</h3>
            <p v-if="tgTarget.status === 1">
              确认停用「{{ tgTarget.displayName }}({{ tgTarget.username }})」?
              停用后立即无法登录,已登录的会话下一个请求即失效;历史记录中该账号的操作痕迹保留。
            </p>
            <p v-else>
              确认启用「{{ tgTarget.displayName }}({{ tgTarget.username }})」?启用后该账号可以立即登录,权限按其当前角色生效。
            </p>
            <!-- 错误位常驻(LAYOUT-STABILITY-SPEC §4.2):红字凭空长一行会把「确认停用」顶到手指底下跑掉。
                 选择器带 .fin-dlg-h 前缀:.fin-dlg-h p 的 muted 色特异性高于单类名,压不住会把红字染灰 -->
            <p class="tg-err"><template v-if="tgErr">{{ tgErr }}</template></p>
          </div>
          <div class="fin-dlg-f" style="padding-top:20px">
            <Button variant="gray" size="sm" @click="tgTarget = null">取消</Button>
            <Button :variant="tgTarget.status === 1 ? 'danger' : 'filled'" size="sm" :disabled="tgBusy" @click="submitToggle">
              <template #leading><component :is="iconFor(tgTarget.status === 1 ? 'lock' : 'check')" :size="14" /></template>
              {{ tgTarget.status === 1 ? '确认停用' : '确认启用' }}
            </Button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 加载失败条(1:1 PoolLedgerView .pl-bar.err) */
/* 表单(1:1 TenantNewDialog .fin-field/.fin-in:md=36 与 ds/Select 同档) */
.su-field { display: flex; flex-direction: column; }
/* 多个字段竖排间距走容器 gap,不用 `+` 相邻选择器 —— 弹窗体本身已是 flex gap:14,
   两套间距叠加会变成 28px(改这里比在每处覆盖便宜) */
.su-stack { display: flex; flex-direction: column; gap: 14px; }
.su-field .lab { font-size: var(--fs-label); font-weight: var(--fw-medium); color: var(--text-secondary); margin-bottom: 7px; }
.su-field .req { color: var(--hue-red); font-weight: var(--fw-medium); }
.su-in { width: 100%; box-sizing: border-box; height: 36px; padding: 0 12px; font-size: var(--fs-body); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); outline: none; background: var(--surface-white); font-family: var(--font-sans); transition: border-color var(--dur-fast) var(--ease-standard); }
.su-in:focus { border-color: var(--hue-blue); }
.su-in.err { border-color: var(--hue-red); }
.su-in:disabled { background: var(--bg-sunken); color: var(--text-muted); cursor: not-allowed; }
/* 只读字段:长得像输入框但明显不可编辑(sunken 底 + 无边框聚焦态) */
.su-ro { height: 36px; display: flex; align-items: center; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-sunken); color: var(--text-secondary); font-family: var(--font-mono); font-size: var(--fs-body); }
.su-hint { font-size: var(--fs-label); color: var(--text-muted); line-height: 1.5; margin-top: 6px; }
.su-erm { font-size: var(--fs-label); color: var(--hue-red); min-height: 16px; margin-top: 8px; line-height: 1.5; }

/* 角色多选 */
.su-roles { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 6px; max-height: 240px; overflow-y: auto; }
.su-role { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: var(--radius-sm); cursor: pointer; }
.su-role:hover { background: var(--bg-hover); }
.su-role.dis { cursor: default; }
.su-role.dis:hover { background: transparent; }
.su-role-n { font-size: var(--fs-body); color: var(--text-primary); white-space: nowrap; }
.su-role-b { flex: 0 0 auto; font-size: var(--fs-micro); color: var(--text-muted); background: var(--bg-sunken); border-radius: var(--radius-full); padding: 1px 6px; }
.su-role-r { flex: 1; min-width: 0; font-size: var(--fs-label); color: var(--text-muted); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 弹窗外壳 1:1 TenantNewDialog .fin-mask/.fin-dlg(DESIGN-FIDELITY §7) */
.fin-mask { position: fixed; inset: 0; background: rgba(28,28,28,.34); z-index: 320; display: grid; place-items: center; padding: 24px; box-sizing: border-box; backdrop-filter: blur(2px); opacity: 0; animation: fp-fade-in var(--dur-base) forwards; }
.fin-dlg { width: min(480px,92vw); max-height: 88vh; overflow-y: auto; background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: 16px; box-shadow: 0 24px 64px rgba(28,28,28,.28); animation: fp-rise-in var(--dur-base) var(--ease-standard) both; }
.fin-dlg-h { padding: 20px 22px 0; }
.fin-dlg-h h3 { margin: 0; font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.fin-dlg-h p { margin: 6px 0 0; font-size: var(--fs-label); line-height: 1.5; color: var(--text-muted); }
/* 停用/启用弹窗的错误位:恒定一行高,空着也占位 */
.fin-dlg-h .tg-err { margin-top: 10px; font-size: var(--fs-label); color: var(--hue-red); min-height: 18px; line-height: 18px; }
.fin-dlg-b { padding: 18px 22px 4px; display: flex; flex-direction: column; gap: 14px; }
.fin-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fin-erm { font-size: var(--fs-label); color: var(--hue-red); margin-top: -6px; min-height: 16px; line-height: 1.5; }
.fin-dlg-f { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 22px 20px; }

/* S 档工具栏(RESPONSIVE-LAYOUT-SPEC §5.1 迁移③):右组 搜索230+角色150+状态130 ≈530px,
   390 视口一行塞不下 —— 搜索独占一行、两个 Select 落第二行。mx-infra 未覆盖搜索收窄,屏内补 */
@media (max-width: 600px) {
  .mx-toolbar-right { flex: 1 1 auto; flex-wrap: wrap; }
  .mx-search { flex: 1 1 100%; width: auto; }
}
</style>
