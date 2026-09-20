<template>
  <div class="fp-phasetabs">
    <button
      v-for="t in tabs"
      :key="t.k"
      class="fp-phasetab"
      :class="{ on: String(modelValue) === String(t.k) }"
      @click="$emit('update:modelValue', t.k)"
    >
      {{ t.label }}
      <span v-if="counts && counts[t.k] != null" class="ct">{{ counts[t.k] }}</span>
    </button>
  </div>
</template>

<script>
// ponytail: TABS hardcoded per contract §2.6 — labels never change
// (放普通 <script> 块:defineProps 默认值不能引用 <script setup> 局部变量)
const TABS = [
  { k: 'all', label: '全部' },
  { k: 1, label: '一期' },
  { k: 2, label: '二期' },
  { k: 3, label: '三期' },
  { k: 4, label: '宿舍' },
]
</script>

<script setup>
defineProps({
  modelValue: [String, Number],
  counts: Object,
  // 可选自定义标签集({k,label}[],如合同生命周期 tabs);不传=期区 TABS,现有使用方零改动
  tabs: { type: Array, default: () => TABS },
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
/* 1:1 port from fp-master-ui.jsx injectMasterStyles() */
.fp-phasetabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--surface-sunken);
  border-radius: var(--radius-full);
}

.fp-phasetab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 16px;
  border: none;
  background: transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: var(--fw-medium);
  color: var(--text-muted);
  white-space: nowrap;
  transition: color var(--dur-fast), background var(--dur-fast);
}

.fp-phasetab:hover {
  color: var(--text-secondary);
}

/* 选中格 --surface-raised:暗色下比轨道亮一层才分得开(DARK-MODE-SPEC §4 段控) */
.fp-phasetab.on {
  background: var(--surface-raised);
  color: var(--text-primary);
  box-shadow: 0 1px 4px rgba(28, 28, 28, 0.12);
}

.fp-phasetab .ct {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--fw-semibold);
  color: var(--text-muted);   /* 数量是内容不是禁用:--text-disabled 浅色下只有 1.6:1(DARK-MODE-SPEC §4) */
}

.fp-phasetab.on .ct {
  color: var(--hue-blue);
}

/* M 档(601–960)胶囊 34 → 32(TabletContent §① delta 行3)。触屏可达面积按**整组**算:
   外框 .fp-phasetabs padding 4,32 + 4×2 = 40,与稿的算法一致。
   下面的 600 块把 S 档原样退回 34 —— 稿只改 M 档一行,手机那档不在本次范围内。
   (CSS 断点只能写字面量,允许值 600/960/1280 见 styles/breakpoints.ts) */
@media (max-width: 960px) { /* M↓ */
  .fp-phasetab { height: 32px; }
}
@media (max-width: 600px) { /* S:不动 */
  .fp-phasetab { height: 34px; }
}
</style>
