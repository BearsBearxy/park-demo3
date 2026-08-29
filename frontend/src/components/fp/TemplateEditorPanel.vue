<script setup lang="ts">
// 账册模板面板(BOOK-WORKBENCH-SPEC §3)。双模式:
//  · 只读查看(默认):分组/列名/别名 chips/隐藏徽标/列宽纯展示;右栏版本链每项可点,
//    点历史版 → booksApi.versionDefinition 取该版定义做只读预览(顶部横幅 + 一键回现行版)。
//    唯一的读请求,其余仍纯受控:保存/切版全部 emit 给宿主。
//  · 编辑模式:仅 canEdit(book-template:edit)且仅对现行版;头部「编辑模式」进入,
//    「完成/取消」退回只读。正在看历史版时点「编辑模式」先切回现行版再进入。
//
// 版式:居中弹窗(DESIGN-FIDELITY §7,样式对齐 FinDialogs 的 .fin-mask/.fin-dlg 系)。
// 主体=分组卡片(组名 + 组内列行),右侧窄栏=版本链;编辑态底部=变更说明 + 保存。
//
// 按月独立(2026-08-26 spec P4/P7):打开的是**当前月**生效的那一版,保存产出链尾+1 并只把当前月切过去;
// 编辑按钮旁的版本选择器列出全链、选中即钉本月。红点/「升到 vN」/链尾编辑门全部退场。
// 本月已录入(monthHasData)则模板定稿:选择器与编辑门一起置灰,清空该月数据即自动解冻(P6)。
//
// 浮层纪律(UI-OVERLAY-SPEC):本组件是宿主弹窗,Esc 挂 document **冒泡**阶段且只在
// open 时拦截 —— 内层浮层(ds/Select 下拉、别名输入框)在元素级 stopPropagation 先赢,
// Esc 才能只收内层不关弹窗。不用 Vue <Transition>(repo 禁令:后台标签页 rAF 不跑会卡遮罩)。
import { ref, computed, watch, onUnmounted } from 'vue'
import { useEditLock } from '@/composables/useEditLock'
import { S } from '@/utils/lockScopes'
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import type { Directive } from 'vue'
import { X, Plus, ChevronUp, ChevronDown, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import { booksApi } from '@/api/books'
import { BOOK_SLOTS, SLOT_LABELS, flattenCols, newCustomColId } from '@/types/book'
import type { Book, BookDef, BookGroup, BookCol, BookSlot, TemplateVersion } from '@/types/book'

const props = defineProps<{
  open: boolean
  book: Book | null
  versions: TemplateVersion[]
  saving: boolean
  canEdit: boolean       // 宿主传 auth.can('book-template:edit')
  canSwitch: boolean     // 宿主传 auth.can('book-template:switch')(第17权限点)
  monthHasData: boolean  // 本月已录入 → 模板定稿(P6 冻结:不许切版、不许编辑)
  // 锁键 = pin 键 = (册, 年, 月)。面板此前不知道自己在哪个月,锁只好按册加 ——
  // 而 saveTemplate / pin 两个写口带的都是这三个。台账屏矩阵态下 month 为 null。
  year: number | null
  month: number | null
}>()

const emit = defineEmits<{
  (e: 'save', def: BookDef, note: string): void
  (e: 'pin', ver: number): void
  (e: 'close'): void
}>()

// 冻结说明:一个没解释的灰控件等于没提示
const frozenHint = '本月已录入,模板已定稿;清空本月数据后可改'

const mode = ref<'view' | 'edit'>('view')
const draft = ref<BookDef | null>(null)
const note = ref('')

// 历史版预览(只读):previewVer 非空=正在看历史版;previewDef 为空=在加载
const previewVer = ref<number | null>(null)
const previewDef = ref<BookDef | null>(null)

// 别名录入态:当前显示输入框的列 id(声明须在 immediate watcher 之前)
const aliasEditId = ref<string | null>(null)

// 只读主区展示的定义:历史版预览优先,否则现行版
const shownDef = computed<BookDef | null>(() =>
  previewVer.value != null ? previewDef.value : props.book?.definition ?? null)

// open(或宿主保存后换 book)时回到只读查看态;draft 深拷贝备着(纯数据,JSON 拷贝够用)。
// 关了不清,避免关帧闪空。
watch(() => [props.open, props.book] as const, ([o, b]) => {
  if (o && b) {
    draft.value = JSON.parse(JSON.stringify(b.definition)) as BookDef
    note.value = ''
    mode.value = 'view'
    previewVer.value = null
    previewDef.value = null
    aliasEditId.value = null
  }
}, { immediate: true })

// ── 编辑锁(CONCURRENCY-SPEC §4) ──
// 这个面板此前**完全没有锁** —— 两个人能同时改同一份模板,后保存的整份覆盖。
// 作用域锁到 **(屏, 册, 年, 月)**,与 saveTemplate / pin 两个写口的键一致(理由见 lockScopes.ts)。
// screen 进键是为了让侧栏圆点分得开两屏 —— 台账某公司的模板被改,不该让附表10 也亮。
const lockScope = computed(() =>
  props.book && props.year != null && props.month != null
    ? S.bookTemplate(props.book.screen, props.book.id, props.year, props.month)
    : null)
const lock = useEditLock(() => { mode.value = 'view'; aliasEditId.value = null },
                          () => props.canEdit)
const { lockedBy, evictedBy } = lock
const heldByOther = lock.watchScope(() => lockScope.value)
// 退出的路不止一条(点完成/取消/关面板/换账册),用 watch 兜住 —— 漏一条就是一把没人认领的锁
watch(() => mode.value, (m) => { if (m !== 'edit') lock.release() })
watch(() => props.open, (o) => { if (!o) lock.release() })

// ── 模式切换 ──
async function enterEdit() {
  // 冻结先判:本地判断不花钱,已录入的月份连锁都不必去占 —— 占到了也进不去(spec 2026-08-26 P6)
  if (!props.book || !props.canEdit || props.monthHasData) return
  // 权限齐 ≠ 进得去:先占到锁才进(与全站其余 19 个写面同一条规矩)
  if (!lockScope.value) return          // 没定到月就没有可锁的东西,也就不该进编辑态
  if (!(await lock.acquire(lockScope.value))) return
  backToCurrent()   // 正在看历史版:先切回现行版(编辑只对现行版)
  draft.value = JSON.parse(JSON.stringify(props.book.definition)) as BookDef
  note.value = ''
  aliasEditId.value = null
  mode.value = 'edit'
}

/** 接管成功 → 锁已经是我们的了,直接进编辑态。 */
async function onTaken() {
  lockedBy.value = null
  await enterEdit()
}

function exitEdit() {
  mode.value = 'view'
  aliasEditId.value = null
}

// ── 被接管时的「复制我的改动」(口径照 LedgerWideTable.draftAsTsv) ──
// draft 是整份 BookDef 深拷贝,重进编辑态会**整份重新快照**(enterEdit 那句 JSON.parse)
// —— 被踢后不给复制的路就是让人白改。只导差异:逐列比对,新增/改动/删除各一行。
function templateDiff(): { group: string; state: string; col: BookCol }[] {
  if (!draft.value || !props.book) return []
  const orig = new Map<string, { g: string; c: BookCol }>()
  for (const g of props.book.definition.groups)
    for (const c of g.cols) orig.set(c.id, { g: g.label ?? '', c })
  const out: { group: string; state: string; col: BookCol }[] = []
  const seen = new Set<string>()
  for (const g of draft.value.groups) {
    for (const c of g.cols) {
      seen.add(c.id)
      const o = orig.get(c.id)
      if (!o) out.push({ group: g.label ?? '', state: '新增', col: c })
      else if (JSON.stringify(c) !== JSON.stringify(o.c) || (g.label ?? '') !== o.g)
        out.push({ group: g.label ?? '', state: '改动', col: c })
    }
  }
  for (const o of orig.values()) if (!seen.has(o.c.id)) out.push({ group: o.g, state: '删除', col: o.c })
  return out
}
const templateDirty = computed(() => (mode.value === 'edit' ? templateDiff().length : 0))
function templateDraftAsTsv(): string {
  const TAB = '\t', NL = '\n'
  const head = ['状态', '分组', '列ID', '显示名', '档位', '隐藏', '列宽', '别名'].join(TAB)
  const body = templateDiff().map(d => [
    d.state, d.group, d.col.id, d.col.label, SLOT_LABELS[d.col.slot] ?? d.col.slot,
    d.col.hidden ? '是' : '', d.col.w ?? '', (d.col.aliases ?? []).join('、'),
  ].join(TAB))
  return [head, ...body].join(NL)
}

// ── 历史版预览 ──
async function viewVersion(v: TemplateVersion) {
  if (mode.value === 'edit' || !props.book) return
  if (v.current) { backToCurrent(); return }
  previewVer.value = v.ver
  previewDef.value = null
  try {
    const def = await booksApi.versionDefinition(props.book.id, v.ver)
    if (previewVer.value === v.ver) previewDef.value = def   // 竞态守卫:只收最后点的那版
  } catch {
    if (previewVer.value === v.ver) backToCurrent()
  }
}

function backToCurrent() {
  previewVer.value = null
  previewDef.value = null
}

const slotOpts = BOOK_SLOTS.map(s => ({ value: s, label: SLOT_LABELS[s] }))

// ── 别名录入:「+ 别名」按钮原地变输入框;Enter/blur 都提交,Esc/空值失焦取消 ──
// blur 提交是硬要求:输完不按回车直接点「保存」,blur 先于 click 落进 draft,不丢。
const vFocus: Directive<HTMLInputElement> = { mounted: (el) => el.focus() }

function commitAlias(c: BookCol, el: HTMLInputElement) {
  const v = el.value.trim()
  if (v && !c.aliases.includes(v)) c.aliases.push(v)
  el.value = ''   // 先清值再收输入框:收起若触发 blur 也不会二次提交
}
function onAliasEnter(c: BookCol, e: KeyboardEvent) {
  if (e.isComposing) return   // IME 守卫:拼音候选确认的 Enter 不提交半截
  e.preventDefault()
  commitAlias(c, e.target as HTMLInputElement)
  aliasEditId.value = null    // 提交成 chip 后原位回到「+ 别名」按钮
}
function onAliasBlur(c: BookCol, e: Event) {
  commitAlias(c, e.target as HTMLInputElement)
  aliasEditId.value = null
}
function cancelAlias(e: KeyboardEvent) {
  ;(e.target as HTMLInputElement).value = ''
  aliasEditId.value = null
}

// ── 草稿编辑 ──
function addCol(g: BookGroup) {
  if (!draft.value) return
  const existing = new Set(flattenCols(draft.value).map(c => c.id))
  g.cols.push({
    id: newCustomColId(existing),
    std: false,
    label: '自定义列',
    aliases: [],
    slot: 'other',
    hidden: false,
    w: null,
  })
}

function moveCol(g: BookGroup, i: number, d: -1 | 1) {
  const j = i + d
  if (j < 0 || j >= g.cols.length) return
  const [c] = g.cols.splice(i, 1)
  g.cols.splice(j, 0, c)
}

function removeCol(g: BookGroup, i: number) {
  g.cols.splice(i, 1)
}

function save() {
  if (!draft.value || props.saving) return
  // 归一化:组名空串→null(无一级表头);列宽空/非法→null
  const def = JSON.parse(JSON.stringify(draft.value)) as BookDef
  for (const g of def.groups) {
    if (typeof g.label === 'string' && g.label.trim() === '') g.label = null
    for (const c of g.cols) {
      c.label = c.label.trim()
      const w = c.w
      c.w = typeof w === 'number' && Number.isFinite(w) && w > 0 ? Math.round(w) : null
    }
  }
  emit('save', def, note.value.trim())
}

// Esc:宿主弹窗挂 document 冒泡阶段,只在 open 时拦(关闭态绝不吞别人的键)
function onKey(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') { e.stopPropagation(); emit('close') }
}
watch(() => props.open, (v) => {
  if (v) document.addEventListener('keydown', onKey)
  else document.removeEventListener('keydown', onKey)
}, { immediate: true })
onUnmounted(() => document.removeEventListener('keydown', onKey))

function fmtTime(s: string): string {
  return s.replace('T', ' ').slice(0, 16)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open && book && draft" class="te-mask" @mousedown="emit('close')">
      <div class="te-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <header class="te-head">
          <div class="te-head-txt">
            <h3>账册模板 — {{ book.name }}</h3>
            <p v-if="mode === 'edit'">本月生效 v{{ book.ver }} · 保存将存成新版本(任何改动都升版),并只把本月切到新版;同册其他月份不动</p>
            <p v-else>本月生效 v{{ book.ver }} · 点右侧版本项可查看历史版定义(只读)</p>
          </div>
          <!-- ⚠ heldByOther 也要挡:这个下拉的 @change 会走 booksApi.pin(册,版本,年,月),
               是**真写服务端**,而它长在编辑态之外 —— 不挡的话 A 正握着本月模板锁在编辑,
               B 能同时把这个月切到别的版本,锁形同虚设(EDIT-MODE-SPEC v4:写入口不许绕过编辑态)。 -->
          <select class="te-verpick" :disabled="monthHasData || !canSwitch || !!heldByOther"
                  :value="String(book.ver)"
                  :title="monthHasData ? frozenHint
                          : heldByOther ? `${heldByOther.displayName} 正在改本月模板,改完才能切版本`
                          : '选择本月使用的账册版本'"
                  @change="emit('pin', Number(($event.target as HTMLSelectElement).value))">
            <option v-for="v in versions" :key="v.id" :value="String(v.ver)">
              v{{ v.ver }}{{ v.ver === book.latestVer ? ' · 最新' : '' }}{{ v.note ? ' — ' + v.note : '' }}
            </option>
          </select>
          <span v-if="monthHasData" class="te-frozen">本月已录入,模板已定稿</span>
          <!-- 与全站同一颗按钮:四态定宽 + 锁态显示。
               作用域锁到**账册**不锁到期 —— 模板改动影响这本账册所有月份。
               冻结走 disabled 而不是 can-enter:can-enter=false 是**不画按钮**,
               按钮忽隐忽现会挪版(LAYOUT-STABILITY §2 优先级 1);画出来禁用掉,旁边那句提示才说得清为什么。 -->
          <FPEditModeButton v-if="mode !== 'edit'" class="te-editbtn" :edit="false"
                            :held-by-other="heldByOther" :can-enter="canEdit"
                            :disabled="monthHasData" @toggle="enterEdit" />
          <FPEditModeButton v-else class="te-donebtn" :edit="true" @toggle="exitEdit" />
          <button class="te-x" aria-label="关闭" @click="emit('close')"><X :size="16" /></button>
        </header>

        <div class="te-body">
          <!-- 主区 -->
          <div class="te-main">
            <!-- 只读查看(默认;含历史版预览) -->
            <template v-if="mode === 'view'">
              <div v-if="previewVer != null" class="te-histbar">
                <span>正在查看 v{{ previewVer }}(历史版)</span>
                <button class="te-histback" @click="backToCurrent">回到现行版</button>
              </div>
              <div v-if="previewVer != null && !previewDef" class="te-loading">加载历史版定义…</div>
              <template v-else-if="shownDef">
                <section v-for="g in shownDef.groups" :key="g.id" class="te-group">
                  <div class="te-gname-ro" :class="{ none: !g.label }">{{ g.label || '(无一级表头)' }}</div>
                  <div v-for="c in g.cols" :key="c.id" class="te-colrow ro" :class="{ hidden: c.hidden }">
                    <span class="te-roname">
                      {{ c.label }}
                      <span v-if="c.hidden" class="te-hidebadge">隐藏</span>
                    </span>
                    <div class="te-aliases">
                      <span v-for="a in c.aliases" :key="a" class="te-chip">{{ a }}</span>
                      <span v-if="!c.aliases.length" class="te-noalias">—</span>
                    </div>
                    <span class="te-slotro">{{ SLOT_LABELS[c.slot] }}</span>
                    <span class="te-wro" title="列宽(px)">{{ c.w ?? '自动' }}</span>
                  </div>
                </section>
              </template>
            </template>

            <!-- 编辑态(仅现行版) -->
            <template v-else>
              <section v-for="g in draft.groups" :key="g.id" class="te-group">
                <input v-model="g.label" class="te-gname" placeholder="(无一级表头)" />
                <div v-for="(c, ci) in g.cols" :key="c.id" class="te-colrow" :class="{ hidden: c.hidden }">
                  <input v-model="c.label" class="te-name" placeholder="显示名" />
                  <div class="te-aliases">
                    <span v-for="(a, ai) in c.aliases" :key="a" class="te-chip">
                      {{ a }}
                      <button class="te-chip-x" :aria-label="`删除别名 ${a}`" @click="c.aliases.splice(ai, 1)"><X :size="10" /></button>
                    </span>
                    <input v-if="aliasEditId === c.id" v-focus class="te-aliasin" placeholder="别名"
                           @keydown.enter="onAliasEnter(c, $event)"
                           @keydown.esc.stop="cancelAlias"
                           @blur="onAliasBlur(c, $event)" />
                    <button v-else type="button" class="te-aliasadd" @click="aliasEditId = c.id">+ 别名</button>
                  </div>
                  <!-- 语义槽:标准列的槽只读(§6 分析层契约);自定义列可换槽(结构改动) -->
                  <span v-if="c.std" class="te-slotro" title="标准列的语义槽固定,不可更换">{{ SLOT_LABELS[c.slot] }}</span>
                  <Select v-else class="te-slotsel" size="sm" :options="slotOpts"
                          :model-value="c.slot" @update:model-value="c.slot = $event as BookSlot" />
                  <label class="te-hidewrap" title="隐藏列不出现在宽表与导入模板中">
                    <input v-model="c.hidden" type="checkbox" class="te-hide" />隐藏
                  </label>
                  <input v-model.number="c.w" type="number" class="te-w" placeholder="宽" title="列宽(px),留空自动" />
                  <div class="te-moves">
                    <button class="te-mv" aria-label="上移" :disabled="ci === 0" @click="moveCol(g, ci, -1)"><ChevronUp :size="14" /></button>
                    <button class="te-mv" aria-label="下移" :disabled="ci === g.cols.length - 1" @click="moveCol(g, ci, 1)"><ChevronDown :size="14" /></button>
                  </div>
                  <!-- 删除:仅自定义列;标准列不可删(§3),给「可隐藏」占位保持行宽一致 -->
                  <button v-if="!c.std" class="te-del" aria-label="删除该列" @click="removeCol(g, ci)"><Trash2 :size="14" /></button>
                  <span v-else class="te-nodel" title="标准列不可删除,可改名/加别名/隐藏">可隐藏</span>
                </div>
                <button class="te-addcol" @click="addCol(g)"><Plus :size="14" /> 添加自定义列</button>
              </section>
            </template>
          </div>

          <!-- 右侧窄栏:版本链。只读态每项可点做历史预览;编辑态出切版按钮(钉的是本月的版本,链只追加不改写) -->
          <aside class="te-vers">
            <div class="te-vtitle">版本链</div>
            <div v-for="v in versions" :key="v.id" class="te-vitem"
                 :class="{ cur: v.current, clickable: mode === 'view', viewing: previewVer === v.ver }"
                 @click="viewVersion(v)">
              <div class="te-vline">
                <b>v{{ v.ver }}</b>
                <span v-if="v.current" class="te-curbadge">现行</span>
              </div>
              <div class="te-vnote">{{ v.note || '—' }}</div>
              <div class="te-vmeta">{{ v.createdBy }} · {{ fmtTime(v.createdAt) }}</div>
              <button v-if="mode === 'edit' && !v.current && canSwitch" class="te-adopt" @click.stop="emit('pin', v.ver)">切到此版</button>
            </div>
            <div v-if="!versions.length" class="te-vempty">暂无版本记录</div>
          </aside>
        </div>

        <template v-if="mode === 'edit'">
          <!-- 升版提示:恒显一行(P5 任何保存都升版,轻/重改动的区分已废除,所以不再随改动种类闪现)。
               版本号是**链尾+1**(后端 maxVer+1),不是本月生效版+1 —— 本月钉在旧版时两者不是一回事 -->
          <p class="te-verbumpline">
            <span class="te-verbump">本次保存将存成新版 v{{ book.latestVer + 1 }},只把本月切过去;同册其他月份不动</span>
          </p>

          <footer class="te-foot">
            <input v-model="note" class="te-note" placeholder="变更说明(记入版本与操作日志)" />
            <Button class="te-cancel" variant="outline" size="sm" @click="exitEdit">取消</Button>
            <Button class="te-save" variant="filled" size="sm" :disabled="saving" @click="save">
              {{ saving ? '保存中…' : '保存' }}
            </Button>
          </footer>
        </template>
      </div>
    </div>
  </Teleport>
  <FPTakeoverDrawer :holder="lockedBy" :scope="lockScope ?? ''"
                    :what="`${book?.name ?? ''} 账册模板`"
                    @close="lockedBy = null" @taken="onTaken" />
  <FPEvictedDialog :eviction="evictedBy" :what="`${book?.name ?? ''} 账册模板`"
                   :dirty-count="templateDirty" :copy-text="templateDraftAsTsv"
                   @close="evictedBy = null" />
</template>

<style scoped>
/* 遮罩/弹窗壳:对齐 FinDialogs .fin-mask/.fin-dlg(居中,DESIGN-FIDELITY §7) */
.te-mask {
  position: fixed; inset: 0; z-index: var(--z-modal);
  background: rgba(28, 28, 28, 0.34);
  display: grid; place-items: center; padding: 24px; box-sizing: border-box;
}
.te-dlg {
  width: min(1080px, 94vw); max-height: 88vh;
  display: flex; flex-direction: column;
  background: var(--surface-white); border: 1px solid var(--border-subtle);
  border-radius: 16px; box-shadow: 0 24px 64px rgba(28, 28, 28, 0.28);
  overflow: hidden;
}

.te-head { display: flex; align-items: flex-start; gap: 12px; padding: 20px 22px 12px; }
.te-head-txt { flex: 1; min-width: 0; }
.te-head h3 { margin: 0; font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.te-head p { margin: 6px 0 0; font-size: var(--fs-label); line-height: 1.5; color: var(--text-muted); }
.te-editbtn, .te-donebtn { flex: 0 0 auto; }
/* 版本选择器(P7):恒在编辑按钮左边,两态同款;本月已录入时置灰,旁边一句为什么 */
.te-verpick {
  flex: 0 0 auto; max-width: 220px; height: 28px; padding: 0 8px;
  font-size: var(--fs-label); font-family: var(--font-sans); color: var(--text-primary);
  background: var(--surface-white); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm); cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.te-verpick:hover:not(:disabled) { border-color: var(--border-strong); }
.te-verpick:disabled { color: var(--text-disabled); background: var(--surface-sunken); cursor: not-allowed; }
.te-frozen { flex: 0 0 auto; align-self: center; font-size: var(--fs-micro); color: var(--text-muted); }
.te-x {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: none; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-muted); cursor: pointer;
}
.te-x:hover { background: var(--surface-card); color: var(--text-primary); }

.te-body { flex: 1; min-height: 0; display: flex; border-top: 1px solid var(--border-subtle); }
.te-main { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 22px 18px; display: flex; flex-direction: column; gap: 12px; }

/* 历史版预览横幅 */
.te-histbar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: var(--radius-sm);
  background: var(--accent-blue); color: var(--brand-deep);
  font-size: var(--fs-label);
}
.te-histback {
  margin-left: auto; height: 24px; padding: 0 10px;
  border: 1px solid var(--brand-blue); border-radius: 999px;
  background: var(--surface-white); font-size: var(--fs-micro);
  color: var(--brand-deep); cursor: pointer;
}
.te-histback:hover { background: var(--surface-card); }
.te-loading { font-size: var(--fs-label); color: var(--text-muted); padding: 8px 2px; }

/* 分组卡片 */
.te-group {
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--surface-card); padding: 10px 12px 12px;
  display: flex; flex-direction: column; gap: 6px;
}
.te-gname {
  width: 240px; box-sizing: border-box; height: 30px; padding: 0 10px;
  font-size: var(--fs-body); font-weight: var(--fw-semibold); font-family: var(--font-sans);
  color: var(--text-primary); background: var(--surface-white);
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); outline: none;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.te-gname:focus { border-color: var(--hue-blue); }
/* 组名只读展示 */
.te-gname-ro {
  height: 30px; line-height: 30px;
  font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary);
}
.te-gname-ro.none { color: var(--text-muted); font-weight: var(--fw-regular); }

/* 列行(编辑):显示名 | 别名chips | 槽 | 隐藏 | 宽 | 移动 | 删除 */
.te-colrow {
  display: grid; grid-template-columns: 150px 1fr 110px auto 64px auto 60px;
  align-items: center; gap: 8px;
  padding: 5px 6px; border-radius: var(--radius-sm); background: var(--surface-white);
  border: 1px solid var(--border-subtle);
}
/* 列行(只读):显示名 | 别名chips | 槽 | 宽 */
.te-colrow.ro { grid-template-columns: 170px 1fr 110px 64px; }
.te-colrow.hidden { opacity: 0.55; }
.te-roname {
  display: inline-flex; align-items: center; gap: 6px; min-width: 0;
  font-size: var(--fs-label); color: var(--text-primary); overflow: hidden; white-space: nowrap;
}
.te-hidebadge {
  flex: 0 0 auto; font-size: var(--fs-micro); line-height: 1; padding: 3px 7px; border-radius: 999px;
  background: var(--surface-sunken); border: 1px solid var(--border-subtle); color: var(--text-muted);
}
.te-noalias { font-size: var(--fs-micro); color: var(--text-disabled); }
.te-wro { font-size: var(--fs-micro); color: var(--text-muted); text-align: center; }

.te-name, .te-w, .te-aliasin, .te-note {
  box-sizing: border-box; height: 28px; padding: 0 8px;
  font-size: var(--fs-label); font-family: var(--font-sans); color: var(--text-primary);
  background: var(--surface-white); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm); outline: none;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.te-name:focus, .te-w:focus, .te-aliasin:focus, .te-note:focus { border-color: var(--hue-blue); }
.te-name { width: 100%; }
.te-w { width: 64px; }
/* number spinner 挤占 64px 后数字被截,去掉 */
.te-w::-webkit-outer-spin-button, .te-w::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

.te-aliases { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
.te-chip {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: var(--fs-micro); line-height: 1; padding: 4px 6px 4px 8px; border-radius: 999px;
  background: var(--surface-sunken); border: 1px solid var(--border-subtle); color: var(--text-secondary);
  white-space: nowrap;
}
.te-chip-x {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; padding: 0; border: none; border-radius: 999px;
  background: transparent; color: var(--text-muted); cursor: pointer;
}
.te-chip-x:hover { background: var(--ink-100); color: var(--text-primary); }
.te-aliasin { width: 88px; flex: 0 0 auto; }
/* 「+ 别名」按钮:与 chip 同高同形,点击原地变输入框 */
.te-aliasadd {
  display: inline-flex; align-items: center;
  height: 22px; padding: 0 8px; border: 1px dashed var(--border-strong);
  border-radius: 999px; background: transparent;
  font-size: var(--fs-micro); color: var(--text-secondary); cursor: pointer; white-space: nowrap;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.te-aliasadd:hover { border-color: var(--hue-blue); color: var(--hue-blue); }

.te-slotro {
  font-size: var(--fs-micro); color: var(--text-muted); text-align: center;
  padding: 5px 0; border: 1px dashed var(--border-subtle); border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}
.te-slotsel { width: 110px; }

.te-hidewrap {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: var(--fs-micro); color: var(--text-secondary); cursor: pointer; white-space: nowrap;
}
.te-hide { margin: 0; accent-color: var(--brand-blue); cursor: pointer; }

.te-moves { display: inline-flex; gap: 2px; }
.te-mv, .te-del {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm); background: var(--surface-white);
  color: var(--text-muted); cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.te-mv:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-primary); }
.te-mv:disabled { opacity: 0.35; cursor: default; }
.te-del:hover { border-color: var(--status-danger); color: var(--status-danger); }
.te-nodel { font-size: var(--fs-micro); color: var(--text-disabled); text-align: center; white-space: nowrap; }

.te-addcol {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 4px;
  height: 26px; padding: 0 10px; border: 1px dashed var(--border-strong);
  border-radius: 999px; background: transparent; font-size: var(--fs-label);
  color: var(--text-secondary); cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.te-addcol:hover { border-color: var(--hue-blue); color: var(--hue-blue); }

/* 右侧版本链窄栏 */
.te-vers {
  flex: 0 0 232px; overflow-y: auto; border-left: 1px solid var(--border-subtle);
  padding: 14px 16px 18px; display: flex; flex-direction: column; gap: 8px;
  background: var(--surface-card);
}
.te-vtitle { font-size: var(--fs-label); font-weight: var(--fw-medium); color: var(--text-muted); }
.te-vitem {
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  background: var(--surface-white); padding: 8px 10px;
  display: flex; flex-direction: column; gap: 3px;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.te-vitem.cur { border-color: var(--brand-blue); }
.te-vitem.clickable { cursor: pointer; }
.te-vitem.clickable:hover { border-color: var(--border-strong); }
.te-vitem.viewing { border-color: var(--hue-blue); background: var(--accent-blue); }
.te-vline { display: flex; align-items: center; gap: 6px; }
.te-vline b { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); }
.te-curbadge {
  font-size: var(--fs-micro); line-height: 1; padding: 3px 7px; border-radius: 999px;
  background: var(--accent-blue); color: var(--brand-deep);
}
.te-vnote { font-size: var(--fs-label); color: var(--text-secondary); word-break: break-all; }
.te-vmeta { font-size: var(--fs-micro); color: var(--text-muted); }
.te-adopt {
  align-self: flex-start; margin-top: 3px; height: 24px; padding: 0 10px;
  border: 1px solid var(--border-subtle); border-radius: 999px; background: var(--surface-white);
  font-size: var(--fs-micro); color: var(--text-secondary); cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.te-adopt:hover { border-color: var(--hue-blue); color: var(--hue-blue); }
.te-vempty { font-size: var(--fs-label); color: var(--text-muted); }

/* 升版提示:恒占一行 */
.te-verbumpline {
  margin: 0; min-height: 20px; padding: 4px 22px 0;
  display: flex; align-items: center;
  border-top: 1px solid var(--border-subtle);
}
.te-verbump { font-size: var(--fs-label); line-height: 20px; color: var(--text-secondary); }

.te-foot { display: flex; align-items: center; gap: 8px; padding: 10px 22px 18px; }
.te-note { flex: 1; height: 28px; }
</style>
