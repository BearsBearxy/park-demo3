<script setup lang="ts">
// 共享单元多选器(S15 §2,仿 FPTenantPicker):候选=全部楼栋分组(栋名小节头),复选框多选;
// 选中为有序数组:首个=主单元(★可点换主),其余=附加单元;chips 带栋名可删,缺档 id 也出 chip(隐形id炸弹修复)。
// 组件不拉数据,候选由调用方传入。
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { groupUnits, toggleUnit, makePrimary, unitChips } from './fpUnitPicker'
import type { FPUnitOption } from './fpUnitPicker'

const props = withDefaults(
  defineProps<{
    units: FPUnitOption[]
    modelValue: number[]        // 有序:首个=主单元,其余=附加单元
    placeholder?: string
    disabled?: boolean
    loading?: boolean           // 候选加载中(调用方逐栋并发拉取时)
  }>(),
  { placeholder: '留空 · 不指定单元', disabled: false, loading: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: number[]] }>()

const open = ref(false)
const q = ref('')
const rootRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)

const groups = computed(() => groupUnits(props.units, q.value))
const chips = computed(() => unitChips(props.modelValue, props.units))
const triggerText = computed(() =>
  chips.value.length ? chips.value[0].label + (chips.value.length > 1 ? ` +${chips.value.length - 1}` : '') : '')

function toggle() {
  if (props.disabled) return
  if (open.value) { open.value = false; return }
  q.value = ''
  open.value = true
  nextTick(() => searchRef.value?.focus())
}

const isSel = (id: number) => props.modelValue.includes(id)
function onToggleUnit(id: number) { emit('update:modelValue', toggleUnit(props.modelValue, id)) }   // 多选:浮层不关
function onMakePrimary(id: number) { emit('update:modelValue', makePrimary(props.modelValue, id)) }
function onRemove(id: number) { emit('update:modelValue', props.modelValue.filter((x) => x !== id)) }

// Esc 只关浮层:阻断冒泡,否则宿主弹窗(ContractNewDialog 等)的 keydown 会连整个弹窗一起关,表单丢失(FPTenantPicker 同坑)
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); open.value = false }
}

// 点击组件外关闭。必须挂 capture 阶段:宿主弹窗容器有 @mousedown.stop,
// 冒泡阶段监听在弹窗内永远收不到事件;capture 先于 .stop 派发(FPTenantPicker 同坑)
function onDoc(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', onDoc, true))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc, true))
</script>

<template>
  <div ref="rootRef" class="fp-up">
    <button
      type="button"
      class="fp-up-trigger"
      :class="{ open }"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="txt" :class="{ ph: !chips.length }">
        {{ chips.length ? triggerText : (loading ? '单元加载中…' : placeholder) }}
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chev">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <!-- 回填 chips:首个=主单元(★);跨栋/候选缺档一律可见 -->
    <div v-if="chips.length" class="fp-up-chips">
      <span
        v-for="(c, i) in chips"
        :key="c.id"
        class="fp-up-chip"
        :class="{ main: i === 0, missing: c.missing }"
        :title="c.missing ? '候选中无此单元(可能已删除或候选未加载),保存仍保留;移除请点 ×' : ''"
      >
        <button type="button" class="star" :disabled="disabled || i === 0"
                :title="i === 0 ? '主单元' : '设为主单元'" @click="onMakePrimary(c.id)">
          {{ i === 0 ? '★' : '☆' }}
        </button>
        <span class="lb">{{ c.label }}</span>
        <button type="button" class="rm" :disabled="disabled" title="移除" @click="onRemove(c.id)">×</button>
      </span>
    </div>

    <div v-if="open" class="fp-up-pop">
      <input
        ref="searchRef"
        v-model="q"
        class="fp-up-search"
        type="text"
        placeholder="搜索栋名/单元号"
        @keydown="onKey"
      />
      <div class="fp-up-list" role="listbox" aria-multiselectable="true">
        <div v-if="loading" class="fp-up-empty">单元加载中…</div>
        <template v-else>
          <div v-for="g in groups" :key="g.buildingId" class="fp-up-group">
            <div class="fp-up-ghead">{{ g.buildingName }}</div>
            <label v-for="u in g.units" :key="u.id" class="fp-up-item" role="option" :aria-selected="isSel(u.id)">
              <input type="checkbox" :checked="isSel(u.id)" @change="onToggleUnit(u.id)" />
              <span class="nm">{{ u.floor }}F-{{ u.unitNo }}</span>
              <span class="meta">{{ u.area != null ? u.area + '㎡' : '' }}{{ u.status && u.status !== 'vacant' ? ' · 非空置' : '' }}</span>
            </label>
          </div>
          <div v-if="!groups.length" class="fp-up-empty">无匹配单元</div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fp-up {
  position: relative;
}

/* 触发器/浮层/搜索:视觉同 FPTenantPicker */
.fp-up-trigger {
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
.fp-up-trigger.open { border-color: var(--border-strong); }
.fp-up-trigger:disabled {
  background: var(--bg-sunken);
  cursor: not-allowed;
  opacity: 0.6;
}
.fp-up-trigger .txt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-up-trigger .txt.ph { color: var(--text-muted); }
.fp-up-trigger .chev {
  flex: 0 0 auto;
  color: var(--text-muted);
  transition: transform var(--dur-fast) var(--ease-standard);
}
.fp-up-trigger.open .chev { transform: rotate(180deg); }

/* chips:栋名+单元号,首个=主(★);缺档虚线红 */
.fp-up-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.fp-up-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 4px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--surface-card);
  font-size: var(--fs-label);
  color: var(--text-secondary);
  line-height: 1.6;
}
.fp-up-chip.main {
  border-color: var(--hue-blue);
  color: var(--text-primary);
}
.fp-up-chip.missing {
  border-style: dashed;
  border-color: var(--status-danger, var(--hue-red));
  color: var(--text-muted);
}
.fp-up-chip .star {
  border: none;
  background: none;
  padding: 0 2px;
  font-size: 12px;
  color: var(--hue-orange);
  cursor: pointer;
  line-height: 1;
}
.fp-up-chip .star:disabled { cursor: default; }
.fp-up-chip .lb { white-space: nowrap; }
.fp-up-chip .rm {
  border: none;
  background: none;
  padding: 0 2px;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1;
}
.fp-up-chip .rm:hover { color: var(--hue-red); }
.fp-up-chip .rm:disabled { cursor: not-allowed; opacity: 0.5; }

.fp-up-pop {
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

.fp-up-search {
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
.fp-up-search:focus { border-color: var(--border-strong); }
.fp-up-search::placeholder { color: var(--text-muted); }

.fp-up-list {
  max-height: 260px;
  overflow-y: auto;
}

/* 栋名小节头 */
.fp-up-ghead {
  padding: 6px 8px 3px;
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  color: var(--text-muted);
}

.fp-up-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  box-sizing: border-box;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.fp-up-item:hover { background: var(--bg-hover); }
.fp-up-item input { accent-color: var(--hue-blue); flex: 0 0 auto; }
.fp-up-item .nm {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-up-item .meta {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: var(--fs-micro);
  color: var(--text-muted);
}

.fp-up-empty {
  padding: 10px;
  font-size: var(--fs-label);
  color: var(--text-muted);
  text-align: center;
}
</style>
