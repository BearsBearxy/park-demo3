<script setup lang="ts">
// 导入结果提示 — 居中小弹层:imported N 条 / skipped M / errors 可展开。复用 DS Button。
import { ref, computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import type { ImportResultDTO } from '@/types/import'

// summary: 智能整表多段导入时,各段「年月期·导入/跳过/错误」一行一段
const props = defineProps<{ result: ImportResultDTO; summary?: string }>()
const emit = defineEmits<{ close: [] }>()

const showErrors = ref(false)

// 抄表导入的身份匹配分档(METER-IMPORT-SPEC §4);其余导入器无 matches 即不显示。
// 「新建」是异常放大器:重导老文件时应≈0,暴涨=身份判错。
const MATCH_LABEL: Record<string, string> = { code: '按编码命中', addr: '按位置命中', name: '按标识命中', new: '新建' }
const matchStats = computed(() => {
  const ms = props.result.matches
  if (!ms?.length) return null
  return Object.entries(MATCH_LABEL)
    .map(([k, label]) => ({ label, n: ms.filter(m => m.matchBy === k).length, warn: k === 'new' }))
    .filter(x => x.n > 0)
})
</script>

<template>
  <div class="ir-scrim" @mousedown="emit('close')">
    <div class="ir-card" @mousedown.stop>
      <div class="ir-h">
        <component :is="iconFor(result.errors.length ? 'alert-triangle' : 'check-circle-2')"
                   :size="20" :class="result.errors.length ? 'ir-warn' : 'ir-ok'" />
        <h3>导入完成</h3>
        <button class="ir-x" @click="emit('close')"><component :is="iconFor('x')" :size="16" /></button>
      </div>
      <div class="ir-stats">
        <div class="ir-stat ok"><b>{{ result.imported }}</b><span>成功写入</span></div>
        <div class="ir-stat" :class="{ warn: result.skipped > 0 }"><b>{{ result.skipped }}</b><span>跳过</span></div>
      </div>
      <div v-if="matchStats" class="ir-match">
        <div class="ir-match-t">表身份匹配</div>
        <div class="ir-match-row">
          <span v-for="(s, i) in matchStats" :key="i" :class="['ir-match-chip', { warn: s.warn }]">
            {{ s.label }} <b>{{ s.n }}</b>
          </span>
        </div>
      </div>
      <div v-if="summary" class="ir-summary">
        <div v-for="(ln, i) in summary.split('\n')" :key="i" class="ir-summary-line">{{ ln }}</div>
      </div>
      <div v-if="result.errors.length" class="ir-errs">
        <button class="ir-errs-toggle" @click="showErrors = !showErrors">
          <component :is="iconFor(showErrors ? 'chevron-down' : 'chevron-right')" :size="14" />
          {{ result.errors.length }} 行未导入
        </button>
        <ul v-if="showErrors" class="ir-errs-list">
          <li v-for="(e, i) in result.errors" :key="i">
            <span class="ir-errs-row">第 {{ e.rowIndex + 1 }} 行</span>
            <span class="ir-errs-label">{{ e.label }}</span>
            <span class="ir-errs-reason">{{ e.reason }}</span>
          </li>
        </ul>
      </div>
      <div class="ir-f">
        <Button variant="filled" full-width @click="emit('close')">知道了</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ir-scrim { position:fixed; inset:0; z-index:340; background:rgba(28,28,28,.32); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; }
.ir-card { width:min(420px,94vw); background:var(--surface-white); border-radius:var(--radius-lg); box-shadow:0 24px 60px rgba(28,28,28,.22); display:flex; flex-direction:column; overflow:hidden; }
.ir-h { display:flex; align-items:center; gap:10px; padding:18px 20px 12px; }
.ir-h h3 { margin:0; flex:1; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.ir-ok { color:var(--hue-blue); }
.ir-warn { color:var(--hue-orange); }
.ir-x { width:28px; height:28px; border:none; background:transparent; border-radius:8px; color:var(--text-muted); cursor:pointer; display:grid; place-items:center; }
.ir-x:hover { background:var(--bg-hover); color:var(--text-primary); }

.ir-stats { display:flex; gap:10px; padding:0 20px; }
.ir-stat { flex:1; display:flex; flex-direction:column; gap:2px; padding:12px 14px; border-radius:var(--radius-md); background:var(--surface-card); }
.ir-stat b { font-size:22px; font-family:var(--font-mono); font-weight:var(--fw-semibold); color:var(--text-primary); }
.ir-stat span { font-size:11.5px; color:var(--text-muted); }
.ir-stat.ok b { color:var(--hue-blue); }
.ir-stat.warn b { color:var(--hue-orange); }

.ir-match { margin:12px 20px 0; padding:8px 12px; background:var(--surface-card); border-radius:var(--radius-md); }
.ir-match-t { font-size:11px; color:var(--text-muted); margin-bottom:6px; }
.ir-match-row { display:flex; flex-wrap:wrap; gap:6px; }
.ir-match-chip { font-size:11.5px; color:var(--text-secondary); background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-full); padding:2px 9px; white-space:nowrap; }
.ir-match-chip b { font-family:var(--font-mono); color:var(--text-primary); margin-left:3px; }
.ir-match-chip.warn { border-color:var(--hue-orange); color:var(--hue-orange); }
.ir-match-chip.warn b { color:var(--hue-orange); }

.ir-summary { margin:12px 20px 0; padding:8px 12px; background:var(--surface-card); border-radius:var(--radius-md); display:flex; flex-direction:column; gap:3px; }
.ir-summary-line { font-size:11.5px; font-family:var(--font-mono); color:var(--text-secondary); }

.ir-errs { padding:12px 20px 0; }
.ir-errs-toggle { display:flex; align-items:center; gap:6px; border:none; background:transparent; cursor:pointer; font-family:var(--font-sans); font-size:12.5px; font-weight:var(--fw-medium); color:var(--text-secondary); padding:6px 0; }
.ir-errs-list { list-style:none; margin:6px 0 0; padding:8px 10px; max-height:180px; overflow:auto; background:var(--surface-card); border-radius:var(--radius-md); }
.ir-errs-list li { display:flex; align-items:baseline; gap:8px; font-size:11.5px; padding:4px 0; border-bottom:1px solid var(--divider); }
.ir-errs-list li:last-child { border-bottom:none; }
.ir-errs-row { font-family:var(--font-mono); color:var(--text-muted); flex:0 0 auto; }
.ir-errs-label { color:var(--text-primary); flex:0 0 auto; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ir-errs-reason { color:var(--hue-red); flex:1; }

.ir-f { padding:16px 20px; }
</style>
