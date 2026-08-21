<script setup lang="ts">
// FinDialogs — 三报表共用弹窗三合一(公司新建/重命名、确认删除、添加子类)。
// 1:1 移植 fin-common.jsx FinCompanyDialog/FinConfirm/FinAddRowDialog + .fin-mask/.fin-dlg 样式;
// 遵 DESIGN-FIDELITY §7 居中弹窗:Teleport to body + backdrop flex 居中 + Esc 关闭 + 体内滚动。
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import type { FinCompany } from './FinCompanyPicker.vue'

// 单一 dlg 描述符,null = 不显示。company: 新建/重命名;delco: 确认删除;addrow: 加子类。
export type FinDialog =
  | { type: 'company'; mode: 'new' | 'edit'; company?: FinCompany }
  | { type: 'delco'; company: FinCompany }
  | { type: 'addrow'; parentLabel: string; heading?: string; placeholder?: string; hint?: string }

const props = defineProps<{
  dlg: FinDialog | null
  companies: FinCompany[]   // 用于公司同名校验
}>()

const emit = defineEmits<{
  close: []
  submitCompany: [name: string]     // company 提交(new/edit 由父级依 mode 分派)
  confirmDelete: []                  // delco 确认
  submitRow: [label: string]         // addrow 提交
}>()

const name = ref('')
const err = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// 打开/切换弹窗时重置输入并聚焦
watch(() => props.dlg, async (d) => {
  err.value = ''
  if (d?.type === 'company') name.value = d.company?.name ?? ''
  else name.value = ''
  if (d && (d.type === 'company' || d.type === 'addrow')) {
    await nextTick(); inputRef.value?.focus()
  }
}, { immediate: true })

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.dlg) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function submitCompany() {
  const v = name.value.trim()
  if (!v) { err.value = '请输入公司名称'; return }
  const initial = props.dlg?.type === 'company' ? props.dlg.company?.name : undefined
  if (props.companies.some((c) => c.name === v && c.name !== initial)) { err.value = '已存在同名公司'; return }
  emit('submitCompany', v)
}
function submitRow() {
  const v = name.value.trim()
  if (!v) { err.value = '请输入名称'; return }
  emit('submitRow', v)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="dlg" class="fin-mask" @mousedown="emit('close')">
      <!-- 公司新建 / 重命名 -->
      <div v-if="dlg.type === 'company'" class="fin-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="fin-dlg-h">
          <h3>{{ dlg.mode === 'edit' ? '重命名公司' : '新增管理公司' }}</h3>
          <p>{{ dlg.mode === 'edit' ? '修改该管理公司的显示名称。' : '为新管理公司创建一份独立报表,结构与现有报表一致,各项金额初始为空。' }}</p>
        </div>
        <div class="fin-dlg-b">
          <div class="fin-field">
            <div class="lab">公司名称</div>
            <input ref="inputRef" class="fin-in" :class="{ err }" v-model="name" placeholder="如:园区资产管理有限公司"
              @input="err = ''" @keydown.enter="submitCompany" />
          </div>
          <div class="fin-erm">{{ err }}</div>
        </div>
        <div class="fin-dlg-f">
          <Button variant="gray" size="sm" @click="emit('close')">取消</Button>
          <Button variant="filled" size="sm" @click="submitCompany">
            <template #leading><component :is="iconFor('check')" /></template>
            {{ dlg.mode === 'edit' ? '保存' : '创建' }}
          </Button>
        </div>
      </div>

      <!-- 确认删除公司 -->
      <div v-else-if="dlg.type === 'delco'" class="fin-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="fin-dlg-h">
          <h3>删除管理公司</h3>
          <p>确认删除「{{ dlg.company.name }}」及其全部台账与报表数据?此操作不可撤销。</p>
        </div>
        <div class="fin-dlg-f" style="padding-top:20px">
          <Button variant="gray" size="sm" @click="emit('close')">取消</Button>
          <Button variant="danger" size="sm" @click="emit('confirmDelete')">
            <template #leading><component :is="iconFor('trash-2')" /></template>
            确认删除
          </Button>
        </div>
      </div>

      <!-- 添加子类 -->
      <div v-else class="fin-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="fin-dlg-h">
          <h3>{{ dlg.heading || '添加子类' }}</h3>
          <p>在「<b style="color:var(--text-secondary)">{{ dlg.parentLabel }}</b>」下新增一个明细子类,金额随该子类逐期录入,父项自动汇总。</p>
        </div>
        <div class="fin-dlg-b">
          <div class="fin-field">
            <div class="lab">子类名称</div>
            <input ref="inputRef" class="fin-in" :class="{ err }" v-model="name" :placeholder="dlg.placeholder || '如:一期租户'"
              @input="err = ''" @keydown.enter="submitRow" />
          </div>
          <div class="fin-erm">{{ err }}</div>
          <div v-if="dlg.hint" class="fin-dlg-note"><component :is="iconFor('info')" :size="15" /><span>{{ dlg.hint }}</span></div>
        </div>
        <div class="fin-dlg-f">
          <Button variant="gray" size="sm" @click="emit('close')">取消</Button>
          <Button variant="filled" size="sm" @click="submitRow">
            <template #leading><component :is="iconFor('check')" /></template>
            添加
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 居中弹窗(遵 DESIGN-FIDELITY §7)。fin-common.jsx 的 .fin-mask 本就 grid 居中,保留;补 Teleport+Esc(见 script)。 */
.fin-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:300; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:finfade .16s forwards; }
@keyframes finfade { to { opacity:1; } }
.fin-dlg { width:min(440px,92vw); max-height:88vh; overflow-y:auto; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); animation:finrise .2s var(--ease-standard) both; }
@keyframes finrise { from { opacity:0; transform:translateY(8px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
.fin-dlg-h { padding:20px 22px 0; }
.fin-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.fin-dlg-b { padding:18px 22px 4px; display:flex; flex-direction:column; gap:14px; }
.fin-field .lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
/* 高度对齐设计系统 md=36(ds/Input 与 ds/Select 同档):此前 38/40px,而同一表单网格里的
   下拉已是 ds/Select 的 36px,并排就差 2~4px。改这里而不是改 Select —— 36 是三个 ds 控件
   (Button/Input/Select)共同的 md 档,38/40 才是各表单自己发明的。 */
.fin-in { width:100%; box-sizing:border-box; height:36px; padding:0 12px; font-size:var(--fs-body); color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.fin-in:focus { border-color:var(--hue-blue); }
.fin-in.err { border-color:var(--hue-red); }
.fin-erm { font-size:11.5px; color:var(--hue-red); margin-top:-6px; min-height:14px; }
.fin-dlg-note { display:flex; gap:8px; align-items:flex-start; padding:11px 13px; border-radius:var(--radius-md); background:var(--accent-sky); font-size:12px; line-height:1.55; color:var(--text-secondary); }
.fin-dlg-note :deep(svg) { flex:0 0 auto; color:var(--hue-blue); margin-top:1px; }
.fin-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
</style>
