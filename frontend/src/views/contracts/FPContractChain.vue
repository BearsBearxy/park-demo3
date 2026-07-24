<script setup lang="ts">
// 续签链 chip 条(CONTRACT-CARD-V2-SPEC §3/§4.1)。期号用阿拉伯数字 1,2,3(用户拍板)。
// 单期合同整条不渲染;旧合同亦可见后续期并可跳转(§4.1),但各期状态互不污染由卡片自身保证(§4.2)。
import type { ContractDTO } from '@/types/contract'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
const props = defineProps<{ chain: { c: ContractDTO; seq: number }[]; currentId: number }>()
const emit = defineEmits<{ jump: [ContractDTO] }>()
</script>

<template>
  <div v-if="props.chain.length > 1" class="cc-wrap">
    <button
      v-for="it in props.chain" :key="it.c.id" type="button" class="cc-chip"
      :class="{ cur: it.c.id === props.currentId }"
      :disabled="it.c.id === props.currentId"
      :title="it.c.contractNo"
      @click="emit('jump', it.c)"
    >
      <span class="cc-seq">{{ it.seq }}</span>
      <span class="cc-body">
        <span class="cc-no">{{ it.c.contractNo }}</span>
        <span class="cc-range">{{ it.c.startDate ? it.c.startDate + ' → ' + it.c.endDate : '—' }}</span>
      </span>
      <FPContractStatus :status="it.c.status" />
    </button>
  </div>
</template>

<style scoped>
.cc-wrap { display:flex; gap:8px; overflow-x:auto; padding:2px 0 6px; }
.cc-chip { display:flex; align-items:center; gap:8px; flex:0 0 auto; cursor:pointer;
  padding:6px 10px; border:1px solid var(--border-subtle); border-radius:var(--radius-md);
  background:var(--surface-white); font:inherit; text-align:left; }
.cc-chip:hover:not(:disabled) { background:var(--surface-card); }
.cc-chip.cur { border-color:var(--hue-blue); background:var(--surface-card); cursor:default; }
.cc-seq { width:20px; height:20px; flex:0 0 auto; border-radius:50%; display:grid; place-items:center;
  background:var(--border-strong); color:#fff; font-size:11.5px; font-weight:var(--fw-semibold); }
.cc-chip.cur .cc-seq { background:var(--hue-blue); }
.cc-body { display:flex; flex-direction:column; min-width:0; }
.cc-no { font-size:12.5px; font-weight:var(--fw-medium); color:var(--text-primary); }
.cc-range { font-size:11px; color:var(--text-muted); font-family:var(--font-mono); }
</style>
