<script setup lang="ts">
// 统一附表页头 — 共享脚手架。返回 + 标题 + 年份徽标 + 编辑模式徽标 + 编辑/完成。
// 1:1 移植 ledger-common.jsx LedgerHeader(.lc-head/.lc-yearbadge/.lc-editbadge)。
import { ref, computed, watch, onUnmounted } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import { useAuthStore } from '@/stores/auth'
import { useEditLock } from '@/composables/useEditLock'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'

const props = withDefaults(defineProps<{
  icon: string
  title: string
  sub?: string
  year: number
  edit: boolean
  /** 本屏写权限键(RBAC-SPEC)。无此权限时编辑与导入按钮不渲染,数据照常显示。
   *  必填 —— 7 个消费屏各传各的(附表族 entry:edit,损益附表 report:edit)。 */
  perm: string
  /** 本屏是否有导入能力。导入按钮由本组件统一渲染 —— 此前 7 屏各自往 #idle-actions 里
   *  塞了逐字相同的 5 行按钮,门控也就散成 7 份。 */
  showImport?: boolean
  /** 导入按钮禁用(母册附表保存中) */
  importDisabled?: boolean
  /** 未保存的草稿处数。>0 时导入前二次确认 —— 导入落库后要重拉数据,会静默冲掉草稿。
   *  只有附表10 与母册附表有草稿(其余 5 屏是抽屉即时落库),它们传,别的屏不用管。 */
  dirty?: number
  /** 本期的编辑锁作用域(CONCURRENCY-SPEC §3.1),如 `sched:pv:2025`。
   *  **不传 = 这一屏不上锁**,行为与加锁之前一个字不差。 */
  scope?: string | null
  /** 把未保存草稿序列化成 TSV(被接管弹窗的「复制我的改动」)。草稿在各屏,页头只递话:
   *  有草稿的屏(附表10/母册附表)传,即时落库的 5 屏不用管 —— 不传就不显示复制块。 */
  copyText?: () => string
}>(), { showImport: false, importDisabled: false, dirty: 0, scope: null })

const emit = defineEmits<{ back: []; 'toggle-edit': [forced?: boolean]; import: [] }>()

// EDIT-MODE-SPEC v3 + ELEVATION-SPEC:无写权限的账号**也看得到**编辑按钮,点了弹主管授权窗。
// 只有连提权都不能问的(只读账号 / 园区股东)才彻底不渲染。
// 放这里而不是放 7 个消费屏 —— 那 7 屏原本一个都没引 auth,门是整体缺失的,不是漏了某屏;
// 同理,提权入口放这里,7 屏一次到位。
const auth = useAuthStore()
const asking = ref<string[] | null>(null)
const canAsk = computed(() => auth.can(props.perm) || auth.can('elevate:request'))

// ⚠ 必须登记进 auth.editors —— 本组件不走 useEditMode(编辑态由 7 个消费屏各自持有)。
//   不登记的话守卫两头都失效:别的页面退出编辑时会以为"没人在编辑了",
//   把本屏正用着的授权一起结束掉;而本屏退出时又会被别的页面挡住结束不了。
const meId = Symbol('sched-header')
watch(() => props.edit, (on) => { if (on) auth.openEditor(meId); else auth.closeEditor(meId) })
onUnmounted(() => auth.closeEditor(meId))

// ── 编辑锁(CONCURRENCY-SPEC §4) ──
// 与 useEditMode 共用同一份机制(useEditLock)。本组件不走 useEditMode —— 编辑态由 7 个消费屏
// 各自持有 —— 所以锁也得在这儿自己接一次,但接的是同一个 composable,不是另抄一份。
// forced=true 的 toggle-edit 是**强制退出**(被接管/提权到期/换期):锁已经没了。
// 绑 `edit = !edit` 的屏照常翻假;做脏检查的屏(附表10/损益表)必须放弃「先问要不要保存」——
// 那道确认在锁没了之后只剩一个无锁写的入口(收口复查坐实:dirty>0 时 emit 被吞,edit 恒真)。
const lock = useEditLock(() => { if (props.edit) emit('toggle-edit', true) },
                          () => auth.can(props.perm))
const { lockedBy, evictedBy } = lock

/**
 * 锁按钮三态(设计稿 C-1/C-2/C-3):同一个物理位置、min-width 定死,换文案不换宽度。
 *
 * 取自**在场表**而不是「点了被拒」的结果 —— 不点也能看见谁占着(C-2 画的就是这个)。
 */
const heldByOther = lock.watchScope(() => props.scope)

/** 退出编辑态的四件事。`edit` 是 prop,组件自己改不了 —— 只能发事件请上层翻。 */
function exitEdit(forced = false) {
  auth.closeEditor(meId)      // 显式出集合:watch 是 pre flush,下一行同步就要用到结果
  void auth.endElevation()
  lock.release()              // 还的是 held 那把,也就是**进编辑态时**占的那个 scope
  emit('toggle-edit', forced)
}

async function onToggleEdit() {
  if (!props.edit && !auth.can(props.perm)) { asking.value = [props.perm]; return }
  if (props.edit) { exitEdit(); return }
  // 权限齐 ≠ 进得去:没传 scope 的屏原样直接进;传了的必须先占到锁
  if (props.scope && !(await lock.acquire(props.scope))) return
  emit('toggle-edit')
}

/**
 * 编辑态里 scope 变了 → 还旧锁 + 退出编辑态(CONCURRENCY-SPEC §3)。
 *
 * 锁只在 onToggleEdit 那一刻 acquire 一次,之后就固化了。而这 7 屏**都能在编辑态里就地换期**:
 * 附表13/14 顶部 Segmented 切子表、附表12 月胶囊换月、四屏「新增记账」存别的年时屏会静默跳年。
 * 不还的话人在 5 月编辑却握着 3 月的锁 —— 5 月对别人显示「无人编辑」,两个人同时改,后保存的赢。
 * 这是**会丢数据**的那一档,不是体验问题。
 *
 * 同一根因在 `useEditMode` 里已修(2026-08-29);SchedHeader 是第二套锁实现,覆盖不到,故此处再补。
 * 选「退出」而不是「换锁续编」:新期的锁可能被别人占着,悄悄让人在没有锁的期上继续编辑更坏。
 */
watch(() => props.scope, (now, before) => {
  if (!props.edit || before == null || now === before) return
  exitEdit(true)
})

/** 接管成功 → 锁已经是我们的了,直接进编辑态。 */
async function onTaken() {
  lockedBy.value = null
  if (props.scope) await lock.acquire(props.scope)   // 重入拿回 held 与心跳
  if (!props.edit) emit('toggle-edit')
}

function onImport() {
  if (props.dirty > 0 &&
      !confirm(`当前有 ${props.dirty} 处修改尚未保存。\n导入会重新载入本期数据,这些修改将丢失。\n\n仍要导入?`)) return
  emit('import')
}
</script>

<template>
  <div class="lc-head">
    <div class="lc-head-l">
      <button class="lc-back" @click="emit('back')" title="返回年份选择">
        <component :is="iconFor('arrow-left')" :size="17" />
      </button>
      <div>
        <h2 class="lc-title"><component :is="iconFor(icon)" :size="20" />{{ title }}</h2>
        <p v-if="sub" class="lc-sub">{{ sub }}</p>
      </div>
    </div>
    <div class="lc-head-actions">
      <span class="lc-yearbadge"><component :is="iconFor('calendar')" :size="14" />{{ year }} 年</span>
      <span v-if="edit" class="lc-editbadge"><component :is="iconFor('pencil')" :size="13" />编辑模式</span>
      <slot v-if="edit" name="edit-actions" />
      <!-- 导入 = 写操作,收进编辑态(EDIT-MODE-SPEC v2 §1「浏览态一切写入口隐藏」)。
           改前是 `v-if="!edit"` 的 #idle-actions 插槽,依据是 2026-07-11 的旧决定「导入常驻非编辑态」,
           与 07-20 定稿的 v2 直接冲突 —— 表现为本系统两套互斥的肌肉记忆:这 8 屏「退出编辑才能导入」,
           抄表/光伏/充电桩/电费成本 4 屏「进编辑才能导入」。按较新的 v2 收敛。
           顺带堵掉:浏览态暴露导入 = 任何看数据的人误点两下就覆盖整月台账。 -->
      <Button v-if="edit && showImport && auth.can(perm)" variant="outline" size="sm"
              :disabled="importDisabled" @click="onImport">
        <template #leading><component :is="iconFor('upload')" :size="14" /></template>
        导入 Excel
      </Button>
      <slot name="static-actions" />
      <!-- 文案与形态对齐 EDIT-MODE-SPEC §2 与抄表屏样板(MeterView.vue:583):
           浏览态 outline(编辑是次要动作) → 编辑态 filled(完成是主要动作)。
           改前这里恒 filled + 文案「编辑表格」,与 6 个抄表族屏的 outline +「编辑模式」两派并存。 -->
      <!-- 锁位就长在编辑模式按钮上(设计稿 §05):不另加 chip —— 那是你的手本来就要去的地方。
           min-width 定死,三态换文案不换宽度,工具条不挪一个像素(LAYOUT-STABILITY)。 -->
      <Button v-if="canAsk" :variant="edit ? 'filled' : 'outline'" size="sm"
              class="lc-lockbtn" :class="{ held: !!heldByOther }" @click="onToggleEdit">
        <template #leading>
          <span v-if="heldByOther && !edit" class="lc-lockav" :class="{ dim: heldByOther.idle }">{{ heldByOther.displayName.slice(0, 1) }}</span>
          <component v-else :is="iconFor(edit ? 'check' : 'pencil')" :size="14" />
        </template>
        <template v-if="edit">完成</template>
        <template v-else-if="heldByOther">
          {{ heldByOther.displayName }} {{ heldByOther.idle ? `空闲 ${Math.floor(heldByOther.idleMs / 60000)} 分` : '编辑中' }}
        </template>
        <template v-else>编辑模式</template>
      </Button>
    </div>
    <FPElevateDialog :perms="asking" :what="`修改${title}`"
                     :page="`${title} · ${year} 年`" :action="`修改${title}`"
                     @close="asking = null" @elevated="asking = null; void onToggleEdit()" />
    <FPTakeoverDrawer :holder="lockedBy" :scope="scope ?? ''" :what="`${title} ${year} 年`"
                      @close="lockedBy = null" @taken="onTaken" />
    <FPEvictedDialog :eviction="evictedBy" :what="`${title} ${year} 年`"
                     :dirty-count="dirty" :copy-text="copyText" @close="evictedBy = null" />
  </div>
</template>

<style scoped>
/* 1:1 from ledger-common.jsx LedgerCommonStyles (.lc-head 段,44-55) */
.lc-head { flex:0 0 auto; display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.lc-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.lc-back { width:36px; height:36px; flex:0 0 auto; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:var(--radius-md); cursor:pointer; display:grid; place-items:center; color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.lc-back:hover { background:var(--bg-hover); color:var(--text-primary); }
.lc-title { margin:0; font:var(--type-h2); font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); display:flex; align-items:center; gap:10px; }
.lc-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.lc-head-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.lc-yearbadge { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 12px; border-radius:var(--radius-full); background:var(--accent-blue); color:var(--hue-blue); font-size:12.5px; font-weight:var(--fw-semibold); font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
.lc-editbadge { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 12px; border-radius:var(--radius-full); background:rgb(255,243,230); color:var(--hue-orange); font-size:12.5px; font-weight:var(--fw-medium); white-space:nowrap; }
/* 锁位:三态同宽 —— 「编辑模式」/「张三 编辑中」/「张三 空闲 23 分」/「完成」换文案不挪版 */
.lc-lockbtn { min-width:150px; justify-content:center; }
.lc-lockbtn.held { border-color:var(--hue-orange); background:rgb(252,243,232); color:var(--hue-orange); }
.lc-lockav { width:18px; height:18px; flex:0 0 auto; border-radius:50%; display:grid; place-items:center; background:var(--fill-blue); color:#fff; font-size:9.5px; font-weight:var(--fw-semibold); }
.lc-lockav.dim { opacity:.55; }
</style>
