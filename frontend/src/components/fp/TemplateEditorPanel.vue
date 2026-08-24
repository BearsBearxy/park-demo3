<script setup lang="ts">
// 账册模板编辑器(BOOK-WORKBENCH-SPEC §3)。纯受控:不发请求,保存/回滚全部 emit 给宿主。
//
// 版式:居中弹窗(DESIGN-FIDELITY §7,样式对齐 FinDialogs 的 .fin-mask/.fin-dlg 系)。
// 主体=分组卡片(组名可改 + 组内列行),右侧窄栏=版本链;底部=变更说明 + 保存。
//
// 轻/结构改动语义(§3)在 UI 里讲清楚:
//  · 轻改动(显示名/别名/列宽)→ 不升版,原版就地更新
//  · 结构改动(增删列/换槽/隐藏切换/列序/组增删)→ 升版 v+1,且现行版全局生效
//    (历史月份同样按新版显示)—— 保存前本地判断,提示条常驻占位(LAYOUT-STABILITY:
//    出现/消失不得顶动保存按钮,故 min-height 恒占一行)。
//
// 浮层纪律(UI-OVERLAY-SPEC):本组件是宿主弹窗,Esc 挂 document **冒泡**阶段且只在
// open 时拦截 —— 内层浮层(ds/Select 下拉)在元素级 stopPropagation 先赢,Esc 才能
// 只收下拉不关弹窗。不用 Vue <Transition>(repo 禁令:后台标签页 rAF 不跑会卡遮罩)。
import { ref, computed, watch, onUnmounted } from 'vue'
import { X, Plus, ChevronUp, ChevronDown, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import { BOOK_SLOTS, SLOT_LABELS, flattenCols, newCustomColId } from '@/types/book'
import type { Book, BookDef, BookGroup, BookCol, BookSlot, TemplateVersion } from '@/types/book'

const props = defineProps<{
  open: boolean
  book: Book | null
  versions: TemplateVersion[]
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'save', def: BookDef, note: string): void
  (e: 'rollback', ver: number): void
  (e: 'close'): void
}>()

const draft = ref<BookDef | null>(null)
const note = ref('')

// open 时把现行定义深拷贝成草稿(纯数据,JSON 拷贝够用);关了不清,避免关帧闪空
watch(() => [props.open, props.book] as const, ([o, b]) => {
  if (o && b) {
    draft.value = JSON.parse(JSON.stringify(b.definition)) as BookDef
    note.value = ''
  }
}, { immediate: true })

// ── 结构改动判定(§3):列的 增删/顺序/换槽/隐藏 + 组增删,任一变即结构 ──
// 签名只含结构位(id/slot/hidden/列序/组序),显示名/别名/列宽不参与 → 轻改动不触发
function structSig(def: BookDef): string {
  return def.groups
    .map(g => `${g.id}[${g.cols.map(c => `${c.id}:${c.slot}:${c.hidden ? 1 : 0}`).join(',')}]`)
    .join(';')
}
const structural = computed(() =>
  !!(draft.value && props.book) && structSig(draft.value) !== structSig(props.book.definition))

const slotOpts = BOOK_SLOTS.map(s => ({ value: s, label: SLOT_LABELS[s] }))

// ── 草稿编辑 ──
function addAlias(c: BookCol, e: Event) {
  const el = e.target as HTMLInputElement
  const v = el.value.trim()
  if (v && !c.aliases.includes(v)) c.aliases.push(v)
  el.value = ''
}

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
            <h3>模板编辑 — {{ book.name }}</h3>
            <p>现行 v{{ book.ver }} · 改显示名/别名/列宽为轻改动不升版;增删列、换语义槽、隐藏切换、调列序将升新版,并对所有账期(含历史月)生效</p>
          </div>
          <button class="te-x" aria-label="关闭" @click="emit('close')"><X :size="16" /></button>
        </header>

        <div class="te-body">
          <!-- 主区:分组卡片列表 -->
          <div class="te-main">
            <section v-for="g in draft.groups" :key="g.id" class="te-group">
              <input v-model="g.label" class="te-gname" placeholder="(无一级表头)" />
              <div v-for="(c, ci) in g.cols" :key="c.id" class="te-colrow" :class="{ hidden: c.hidden }">
                <input v-model="c.label" class="te-name" placeholder="显示名" />
                <div class="te-aliases">
                  <span v-for="(a, ai) in c.aliases" :key="a" class="te-chip">
                    {{ a }}
                    <button class="te-chip-x" :aria-label="`删除别名 ${a}`" @click="c.aliases.splice(ai, 1)"><X :size="10" /></button>
                  </span>
                  <input class="te-aliasin" placeholder="+别名" @keydown.enter.prevent="addAlias(c, $event)" />
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
          </div>

          <!-- 右侧窄栏:版本链(回滚=复制历史版为新版本,版本号只前进) -->
          <aside class="te-vers">
            <div class="te-vtitle">版本链</div>
            <div v-for="v in versions" :key="v.id" class="te-vitem" :class="{ cur: v.current }">
              <div class="te-vline">
                <b>v{{ v.ver }}</b>
                <span v-if="v.current" class="te-curbadge">现行</span>
              </div>
              <div class="te-vnote">{{ v.note || '—' }}</div>
              <div class="te-vmeta">{{ v.createdBy }} · {{ fmtTime(v.createdAt) }}</div>
              <button v-if="!v.current" class="te-rollback" @click="emit('rollback', v.ver)">回滚为新版本</button>
            </div>
            <div v-if="!versions.length" class="te-vempty">暂无版本记录</div>
          </aside>
        </div>

        <!-- 升版提示:常驻占位一行(LAYOUT-STABILITY),结构改动时才显字 -->
        <p class="te-verbumpline">
          <span v-if="structural" class="te-verbump">本次将升版 v{{ book.ver + 1 }},历史月份同样按新版显示</span>
        </p>

        <footer class="te-foot">
          <input v-model="note" class="te-note" placeholder="变更说明(记入版本与操作日志)" />
          <Button class="te-cancel" variant="outline" size="sm" @click="emit('close')">取消</Button>
          <Button class="te-save" variant="filled" size="sm" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存' }}
          </Button>
        </footer>
      </div>
    </div>
  </Teleport>
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
.te-x {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: none; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-muted); cursor: pointer;
}
.te-x:hover { background: var(--surface-card); color: var(--text-primary); }

.te-body { flex: 1; min-height: 0; display: flex; border-top: 1px solid var(--border-subtle); }
.te-main { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 22px 18px; display: flex; flex-direction: column; gap: 12px; }

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

/* 列行:显示名 | 别名chips | 槽 | 隐藏 | 宽 | 移动 | 删除 */
.te-colrow {
  display: grid; grid-template-columns: 150px 1fr 110px auto 64px auto 60px;
  align-items: center; gap: 8px;
  padding: 5px 6px; border-radius: var(--radius-sm); background: var(--surface-white);
  border: 1px solid var(--border-subtle);
}
.te-colrow.hidden { opacity: 0.55; }
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
.te-aliasin { width: 72px; flex: 0 0 auto; }

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
}
.te-vitem.cur { border-color: var(--brand-blue); }
.te-vline { display: flex; align-items: center; gap: 6px; }
.te-vline b { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); }
.te-curbadge {
  font-size: var(--fs-micro); line-height: 1; padding: 3px 7px; border-radius: 999px;
  background: var(--accent-blue); color: var(--brand-deep);
}
.te-vnote { font-size: var(--fs-label); color: var(--text-secondary); word-break: break-all; }
.te-vmeta { font-size: var(--fs-micro); color: var(--text-muted); }
.te-rollback {
  align-self: flex-start; margin-top: 3px; height: 24px; padding: 0 10px;
  border: 1px solid var(--border-subtle); border-radius: 999px; background: var(--surface-white);
  font-size: var(--fs-micro); color: var(--text-secondary); cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.te-rollback:hover { border-color: var(--hue-blue); color: var(--hue-blue); }
.te-vempty { font-size: var(--fs-label); color: var(--text-muted); }

/* 升版提示:恒占一行(空着不可见但占位),避免出现时顶动脚部按钮 */
.te-verbumpline {
  margin: 0; min-height: 20px; padding: 4px 22px 0;
  display: flex; align-items: center;
  border-top: 1px solid var(--border-subtle);
}
.te-verbump { font-size: var(--fs-label); line-height: 20px; color: var(--status-warning); }

.te-foot { display: flex; align-items: center; gap: 8px; padding: 10px 22px 18px; }
.te-note { flex: 1; height: 28px; }
</style>
