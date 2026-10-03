<script setup lang="ts">
// 角色权限矩阵(RBAC-SPEC v2 §10 P1)— 左栏角色列表(预置/自定义分组),右栏该角色的权限矩阵 + 导航可见层。
// 权限点清单来自 GET /api/system/perms(后端 Perm.ALL),**前端不硬编码** —— 后端加第 14 个权限点,这里自动多一行。
// 分组标题按 key 前缀推(system:* / lock:* 各自成组,其余归业务写权限),13 行才不至于平铺成一片。
// 预置角色(builtin=true)不可删但权限与导航层照改 —— 「交付后客户自己调」是本屏存在的理由;删除只对自定义角色出现。
// 读全开(§0):无 system:edit 时矩阵照常显示当前配置,只是复选框 disabled、没有保存/新增/删除入口。
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { systemApi } from '@/api/system'
import type { NavLayerDTO, PermDTO, RoleDTO } from '@/types/system'
import { useAuthStore } from '@/stores/auth'
import { useScreen } from '@/composables/useTabShells'
import { ask, askLeave } from '@/utils/ask'
import { iconFor } from '@/components/ds/icon'
import FPToast from '@/components/fp/FPToast.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import Button from '@/components/ds/Button.vue'
import Badge from '@/components/ds/Badge.vue'

const auth = useAuthStore()
const canEdit = computed(() => auth.can('system:edit'))
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback

// ── 数据 ──
const perms = ref<PermDTO[]>([])
const navLayerDefs = ref<NavLayerDTO[]>([])
const roles = ref<RoleDTO[]>([])
const loaded = ref(false)
const loadErr = ref('')
const saving = ref(false)
const msg = ref<{ tone: 'ok' | 'err'; text: string } | null>(null)

const selId = ref<number | null>(null)
const creating = ref(false)
const form = ref({ code: '', name: '', remark: '', perms: [] as string[], navLayers: [] as string[] })
// 字段报错(十件 ⑤):点过一次保存才亮,之后随输入即时消;贴在字段下面,不走页面 toast
const tried = ref(false)
const nameErr = computed(() => (tried.value && !form.value.name.trim() ? '角色名必填' : ''))
// code 建后不可改,写坏了只能重建一个:在这儿挡住,别等后端 500
const codeErr = computed(() => (tried.value && creating.value && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(form.value.code.trim())
  ? '标识必填,且只能用英文字母开头 + 字母/数字/下划线/短横' : ''))

const cur = computed(() => roles.value.find(r => r.id === selId.value) ?? null)
const builtinRoles = computed(() => roles.value.filter(r => r.builtin))
const customRoles = computed(() => roles.value.filter(r => !r.builtin))

// seq:保存 / 删除后的重拉与手点重试并发时只认最后一次;错误只在成功分支清(重试途中失败态不闪回)
let seq = 0
async function load(keepId?: number | null) {
  const my = ++seq
  try {
    const [cat, rs] = await Promise.all([systemApi.perms(), systemApi.roles()])
    if (my !== seq) return
    perms.value = cat.perms
    navLayerDefs.value = cat.navLayers
    roles.value = rs
    const id = keepId ?? selId.value
    selId.value = rs.some(r => r.id === id) ? id! : rs[0]?.id ?? null
    creating.value = false
    fillForm(cur.value)
    loadErr.value = ''
  } catch (e) {
    if (my !== seq) return
    loadErr.value = errMsg(e, '角色数据加载失败')
  } finally { if (my === seq) loaded.value = true }
}
onMounted(() => load())

function fillForm(r: RoleDTO | null) {
  tried.value = false
  form.value = r
    ? { code: r.code, name: r.name, remark: r.remark ?? '', perms: [...r.perms], navLayers: [...r.navLayers] }
    // 新角色缺省:零权限 + 全部导航层(比反过来安全 —— 少给权限只是不能改,少给导航层是整层看不见)
    : { code: '', name: '', remark: '', perms: [], navLayers: navLayerDefs.value.map(l => l.id) }
}

// ── 权限矩阵分组(前缀推;后端新增的未知前缀一律归业务组,不会凭空消失) ──
const GROUPS = [
  { id: 'biz', title: '业务写权限', sub: '勾上=这个角色能改对应模块;不勾也照样能看(读全开)' },
  { id: 'system', title: '系统管理', sub: '账号、角色与操作日志 —— 全站唯一「读也要管」的一段' },
  { id: 'lock', title: '编辑锁', sub: '并发编辑时的接管授权' },
]
function bucketOf(key: string): string {
  const prefix = key.slice(0, key.indexOf(':'))
  return prefix === 'system' || prefix === 'lock' ? prefix : 'biz'
}
const permGroups = computed(() =>
  GROUPS.map(g => ({ ...g, rows: perms.value.filter(p => bucketOf(p.key) === g.id) }))
       .filter(g => g.rows.length > 0),
)

// ── 编辑 ──
// 改动数(EDIT-MODE §6.1):名称 / 备注各算 1 处,权限点与导航层每勾一个、每去一个各算 1 处。
// 新建时只数标识、名称和勾上的权限点(导航层缺省全勾,不算改动)
const setDiff = (a: string[], b: string[]) => a.filter(x => !b.includes(x)).length + b.filter(x => !a.includes(x)).length
const dirtyCount = computed(() => {
  const f = form.value
  if (creating.value) return +!!f.code.trim() + +!!f.name.trim() + f.perms.length
  const r = cur.value
  if (!r) return 0
  return +(f.name !== r.name) + +(f.remark !== (r.remark ?? ''))
    + setDiff(f.perms, r.perms) + setDiff(f.navLayers, r.navLayers)
})
const dirty = computed(() => dirtyCount.value > 0)

// 有没保存的改动 = 在编辑:登记进 auth.editors —— 页签条不把这一格换掉、关浏览器先确认(TAB-BAR-SPEC §2)
const meId = Symbol('roles')
const screen = useScreen()
// 撤登记时顺带结束授权:这是最后一个编辑态的话,授权不该留到 30 分钟到期(还有别的在编辑时它自己不作为)
function unregister() { auth.closeEditor(meId); void auth.endElevation() }
watch(dirty, (on) => { if (on) auth.openEditor(meId, screen, () => dirtyCount.value, ['system:edit']); else unregister() })
onUnmounted(unregister)

// 换角色 / 去新建会丢掉手上的改动:askLeave(0 处不弹)
const leave = () => askLeave({ page: creating.value ? '新建角色' : cur.value?.name ?? '', count: dirtyCount.value, verb: '离开' })
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
    title: `放弃这 ${dirtyCount.value} 处改动？`,
    body: '放弃后回到上次保存的样子。',
    action: '放弃改动',
    cancel: '继续编辑',
    danger: true,
  }))) return
  msg.value = null
  creating.value = false
  fillForm(cur.value)
}
function toggle(list: string[], key: string) {
  if (!canEdit.value) return
  const i = list.indexOf(key)
  if (i < 0) list.push(key); else list.splice(i, 1)
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
    // remark 空串即清空备注(RoleReq.remark 是可选 string,不收 null)
    const req = { name, navLayers: [...f.navLayers], perms: [...f.perms], remark: f.remark.trim() }
    const saved = creating.value
      ? await systemApi.createRole({ ...req, code })
      : await systemApi.updateRole(selId.value!, req)
    await load(saved.id)
    msg.value = { tone: 'ok', text: `已保存「${saved.name}」 —— 该角色下的账号下次请求即生效` }
  } catch (e) {
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
  <!-- fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §11.1 迁移查看态(≤960 双栏降单列、矩阵外框横滚),
       摘掉 base.css 的 M↓ 屏级地板。配置操作按 §11.1「系统管理配置明确不做」:不禁不藏不优化 -->
  <div class="sr-page fp-fluid">
    <!-- 页头 -->
    <div class="sr-head">
      <div>
        <h2 class="sr-title">角色权限</h2>
        <p class="sr-sub">
          读全开、写分权:任何账号都能看全站数据,权限只决定「能不能改」。共 {{ loaded ? roles.length : '…' }} 个角色
        </p>
      </div>
    </div>

    <!-- 保存成功/失败走 toast(浮层,不顶下面的角色矩阵);加载失败在下面换掉整块内容(十件 ⑦) -->
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

      <!-- 右:权限矩阵 -->
      <section v-if="creating || cur" class="sr-pane">
        <div class="sr-panehead">
          <div class="sr-nameline">
            <input v-if="canEdit" v-model="form.name" class="sr-name" :class="{ bad: !!nameErr }" placeholder="角色名,如:财务专员" />
            <span v-else class="sr-name ro">{{ form.name }}</span>
            <Badge v-if="!creating && cur?.builtin" tone="slate" variant="subtle" :dot="false">预置</Badge>
          </div>
          <!-- 报错位在可编辑时常驻(条件是权限,不是有没有错);字才跟着错走 -->
          <template v-if="canEdit"><p class="fp-field-err"><template v-if="nameErr">{{ nameErr }}</template></p></template>
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
            <!-- 删除只对自定义角色出现;有账号在用时禁用并说清要先改派(预置角色一律无此按钮) -->
            <Button v-if="canEdit && !creating && cur && !cur.builtin" variant="outline" size="sm"
                    :disabled="cur.userCount > 0 || saving"
                    v-tip="cur.userCount > 0 ? `该角色下还有 ${cur.userCount} 个账号,请先改派` : '删除该角色'"
                    @click="remove(cur)">
              <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
              删除角色
            </Button>
          </div>
          <template v-if="creating"><p class="fp-field-err"><template v-if="codeErr">{{ codeErr }}</template></p></template>
          <input v-if="canEdit" v-model="form.remark" class="sr-remark" placeholder="备注(选填):这个角色给谁用" />
          <p v-else-if="form.remark" class="sr-remark ro">{{ form.remark }}</p>
        </div>

        <!-- 权限矩阵 -->
        <div v-for="g in permGroups" :key="g.id" class="sr-sec">
          <div class="sr-sechead">
            <span class="sr-sectitle">{{ g.title }}</span>
            <span class="sr-secsub">{{ g.sub }}</span>
          </div>
          <label v-for="p in g.rows" :key="p.key" class="sr-row" :class="{ off: !canEdit }">
            <input type="checkbox" :checked="form.perms.includes(p.key)" :disabled="!canEdit"
                   @change="toggle(form.perms, p.key)" />
            <span class="sr-rowtxt">
              <span class="sr-rowlbl">{{ p.label }}</span>
              <span class="sr-rowhint">{{ p.hint }}</span>
            </span>
            <code class="sr-key">{{ p.key }}</code>
          </label>
        </div>

        <!-- 导航可见层 -->
        <div class="sr-sec">
          <div class="sr-sechead">
            <span class="sr-sectitle">导航可见层</span>
            <span class="sr-secsub">
              勾掉的层在这个角色的左侧导航里不显示。系统管理层单独由「系统管理·查看」权限决定,不在这里配
            </span>
          </div>
          <label v-for="l in navLayerDefs" :key="l.id" class="sr-row" :class="{ off: !canEdit }">
            <input type="checkbox" :checked="form.navLayers.includes(l.id)" :disabled="!canEdit"
                   @change="toggle(form.navLayers, l.id)" />
            <span class="sr-rowtxt"><span class="sr-rowlbl">{{ l.label }}</span></span>
            <code class="sr-key">{{ l.id }}</code>
          </label>
        </div>

        <div v-if="canEdit" class="sr-act">
          <Button variant="gray" size="sm" :disabled="saving || !dirty" @click="cancel">取消</Button>
          <Button variant="filled" size="sm" :disabled="saving || !dirty" @click="save">
            {{ saving ? '保存中…' : creating ? '新建角色' : '保存' }}
          </Button>
        </div>
        <p v-else class="sr-ro">只读:改角色权限需要「系统管理·编辑」权限。</p>
      </section>

      <div v-else class="sr-pane empty">左栏选一个角色</div>
    </div>
  </div>
</template>

<style scoped>
.sr-page { display: flex; flex-direction: column; gap: 14px; box-sizing: border-box; max-width: 1200px; margin: 0 auto; width: 100%; }
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
.sr-pane { display: flex; flex-direction: column; gap: 14px; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); padding: 16px 18px; }
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
.sr-key { flex: 0 0 auto; font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-muted); background: var(--surface-sunken); border-radius: var(--radius-xs); padding: 2px 6px; }

.sr-act { display: flex; justify-content: flex-end; gap: 8px; padding-top: 12px; border-top: 1px solid var(--divider); }
.sr-ro { margin: 0; padding-top: 12px; border-top: 1px solid var(--divider); font-size: var(--fs-micro); color: var(--text-muted); }

/* ── M/S 档(≤960):双栏降单列——角色列表在上、权限矩阵在下(DOM 序即视觉序,无需重排)。
   矩阵行(勾选+说明+key 胶囊)窄屏可能超宽:外框显式横滚不裁内容(§5.4 口径)。
   配置操作不优化(§11.1 系统管理配置明确不做),查看/勾选可用即可 ── */
@media (max-width: 960px) {
  .sr-split { grid-template-columns: 1fr; }
  .sr-pane { overflow-x: auto; }
}
</style>
