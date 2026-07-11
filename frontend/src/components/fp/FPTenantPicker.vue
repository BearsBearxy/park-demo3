<script setup lang="ts">
// 共享可搜索租户选择器(spec §T3):候选由调用方传入,组件不拉数据、不依赖 tenantApi
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { filterTenants, type FPTenantOption } from './fpTenantPicker'

const props = withDefaults(
  defineProps<{
    tenants: FPTenantOption[]
    modelValue: number | null
    placeholder?: string
    disabled?: boolean
    invalid?: boolean // 红框错误态(合同弹窗「请选择租户」复用)
    emptyHint?: string // 无匹配时的补充说明(如台账:候选已排除本月已有行的租户,不解释用户会以为搜索坏了)
  }>(),
  { placeholder: '请选择租户', disabled: false, invalid: false, emptyHint: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const open = ref(false)
const q = ref('')
const hi = ref(0) // 键盘高亮索引
const rootRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const selected = computed(() => props.tenants.find((t) => t.id === props.modelValue) ?? null)
const results = computed(() => filterTenants(props.tenants, q.value))

// 期区徽章口径与 FPPhaseTabs 一致
const PHASE_BADGE: Record<number, string> = { 1: '一期', 2: '二期', 3: '三期', 4: '宿舍' }

function toggle() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
  } else {
    q.value = '' // 再次打开时搜索词清空
    hi.value = 0
    open.value = true
    nextTick(() => searchRef.value?.focus())
  }
}

function pick(t: FPTenantOption) {
  emit('update:modelValue', t.id)
  open.value = false
}

watch(q, () => { hi.value = 0 }) // 过滤变化重置高亮

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); const t = results.value[hi.value]; if (t) pick(t) }
  // Esc 只关浮层:阻断冒泡,否则宿主弹窗(TenantNewDialog/ContractNewDialog 的 window keydown)会连整个弹窗一起关,表单丢失
  else if (e.key === 'Escape') { e.stopPropagation(); open.value = false }
}

function move(d: number) {
  const n = results.value.length
  if (!n) return
  hi.value = (hi.value + d + n) % n
  nextTick(() => listRef.value?.children[hi.value]?.scrollIntoView({ block: 'nearest' }))
}

// 点击组件外关闭。必须挂 capture 阶段:宿主弹窗容器有 @mousedown.stop(如 TenantNewDialog .fin-dlg),
// 冒泡阶段监听在弹窗内永远收不到事件,「点外关闭」会整体失效;capture 先于 .stop 派发,不受影响。
function onDoc(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', onDoc, true))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc, true))
</script>

<template>
  <div ref="rootRef" class="fp-tp">
    <button
      type="button"
      class="fp-tp-trigger"
      :class="{ open, invalid }"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="txt" :class="{ ph: !selected }">{{ selected ? selected.name : placeholder }}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chev">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <div v-if="open" class="fp-tp-pop">
      <input
        ref="searchRef"
        v-model="q"
        class="fp-tp-search"
        type="text"
        placeholder="搜索租户名称"
        @keydown="onKey"
      />
      <div ref="listRef" class="fp-tp-list" role="listbox">
        <button
          v-for="(t, i) in results"
          :key="t.id"
          type="button"
          class="fp-tp-item"
          :class="{ hi: i === hi, sel: t.id === modelValue }"
          role="option"
          :aria-selected="t.id === modelValue"
          @mouseenter="hi = i"
          @click="pick(t)"
        >
          <span class="nm">{{ t.name }}</span>
          <span v-if="t.phase != null && PHASE_BADGE[t.phase]" class="badge">{{ PHASE_BADGE[t.phase] }}</span>
          <span v-if="t.parentName" class="rel">关联:{{ t.parentName }}</span>
        </button>
        <div v-if="!results.length" class="fp-tp-empty">
          无匹配租户<span v-if="emptyHint" class="hint">{{ emptyHint }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fp-tp {
  position: relative;
}

/* 触发器:输入框样式按钮,视觉对齐 ds/Select.vue */
.fp-tp-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 12px;
  box-sizing: border-box;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.fp-tp-trigger.open { border-color: var(--border-strong); }
.fp-tp-trigger.invalid { border-color: var(--status-danger); }
.fp-tp-trigger:disabled {
  background: var(--bg-sunken);
  cursor: not-allowed;
  opacity: 0.6;
}
.fp-tp-trigger .txt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-tp-trigger .txt.ph { color: var(--text-muted); }
.fp-tp-trigger .chev {
  flex: 0 0 auto;
  color: var(--text-muted);
  transition: transform var(--dur-fast) var(--ease-standard);
}
.fp-tp-trigger.open .chev { transform: rotate(180deg); }

/* 浮层:白底/细边/圆角/阴影,同 ds/Select.vue popover */
.fp-tp-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 60;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  padding: 6px;
  box-sizing: border-box;
}

.fp-tp-search {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  margin-bottom: 6px;
  box-sizing: border-box;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  color: var(--text-primary);
  outline: none;
}
.fp-tp-search:focus { border-color: var(--border-strong); }
.fp-tp-search::placeholder { color: var(--text-muted); }

.fp-tp-list {
  max-height: 260px;
  overflow-y: auto;
}

.fp-tp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  box-sizing: border-box;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) var(--ease-standard);
}
.fp-tp-item.hi { background: var(--bg-hover); }
.fp-tp-item.sel .nm { font-weight: var(--fw-medium); }
.fp-tp-item .nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-tp-item .badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  font-size: var(--fs-micro);
  color: var(--text-secondary);
}
.fp-tp-item .rel {
  flex: 0 0 auto;
  margin-left: auto;
  font-size: var(--fs-label);
  color: var(--text-muted);
}

.fp-tp-empty {
  padding: 10px;
  font-size: var(--fs-label);
  color: var(--text-muted);
  text-align: center;
}
.fp-tp-empty .hint {
  display: block;
  margin-top: 4px;
  font-size: var(--fs-micro);
  color: var(--text-disabled);
}
</style>
