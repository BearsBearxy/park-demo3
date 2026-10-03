<script setup lang="ts">
// 导入弹窗的原地结果卡(画布 11 节 ImportDone;UI-OVERLAY-SPEC §8):进度卡跑完就地换成它,弹窗不关。
// 标题图标两态:一条没跳过 = 蓝圈勾;有跳过 / 未导入 = 橙三角。两格统计;分项明细两列;
// 抄表的匹配分档与档案变化、「n 条提示(已导入,仅需知会)」「n 行未导入」可展开(读法同 ImportResultToast)。
// 按钮在弹窗脚部(「去查看」「知道了」),这里只画内容。
import { ref, computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import { useImportResult, FIELD_LABEL } from './useImportResult'
import { mss, n0, type ImportOutcome } from './importRun'

const props = defineProps<{ result: ImportOutcome; unit: string; elapsed: number; note: string }>()

const { notices, changes, chgVal, chgSpan, matchStats } = useImportResult(props.result)
const warned = computed(() => props.result.skipped > 0 || props.result.errors.length > 0)
// 「n 行未导入」默认展开(画布 ImportDone 右:这几行要人去处理),提示与档案改动默认收起
const open = ref<Record<'chg' | 'note' | 'err', boolean>>({ chg: false, note: false, err: true })
</script>

<template>
  <div class="irc">
    <div class="irc-h">
      <component :is="iconFor(warned ? 'alert-triangle' : 'check-circle-2')" :size="20" :class="warned ? 'warn' : 'ok'" />
      <h4>导入完成</h4>
      <span class="irc-meta">用时 {{ mss(elapsed) }}<template v-if="note"> · {{ note }}</template></span>
    </div>

    <div class="irc-stats">
      <div class="irc-stat ok"><b>{{ n0(result.imported) }}</b><small>{{ unit }}</small><span>成功写入</span></div>
      <div class="irc-stat" :class="{ warn: result.skipped > 0 }"><b>{{ n0(result.skipped) }}</b><span>跳过</span></div>
    </div>

    <div v-if="result.detail?.length" class="irc-detail">
      <div v-for="([k, v], i) in result.detail" :key="i" class="irc-kv"><span>{{ k }}</span><b>{{ v }}</b></div>
    </div>

    <div v-if="matchStats" class="irc-fold">
      <div class="irc-fold-t">表身份匹配</div>
      <div class="irc-chips">
        <span v-for="(s, i) in matchStats" :key="i" :class="['irc-chip', { warn: s.warn }]">{{ s.label }} <b>{{ s.n }}</b></span>
      </div>
    </div>

    <div v-if="changes.length" class="irc-fold">
      <button type="button" class="irc-toggle" @click="open.chg = !open.chg">
        <component :is="iconFor(open.chg ? 'chevron-down' : 'chevron-right')" :size="14" />{{ changes.length }} 处表档案改动
      </button>
      <ul v-if="open.chg" class="irc-list">
        <li v-for="(c, i) in changes" :key="i">
          <span class="lb" v-tip="c.label">{{ c.label }}</span>
          <span class="rs">{{ FIELD_LABEL[c.field] ?? c.field }} {{ chgVal(c, c.before) }} → {{ chgVal(c, c.after) }} · {{ chgSpan(c) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="notices.length" class="irc-fold">
      <button type="button" class="irc-toggle" @click="open.note = !open.note">
        <component :is="iconFor(open.note ? 'chevron-down' : 'chevron-right')" :size="14" />{{ notices.length }} 条提示（已导入，仅需知会）
      </button>
      <ul v-if="open.note" class="irc-list">
        <li v-for="(n, i) in notices" :key="i">
          <span v-if="n.rowIndex >= 0" class="rw">第 {{ n.rowIndex + 1 }} 行</span>
          <span class="lb">{{ n.label || '（空）' }}</span>
          <span class="rs">{{ n.reason }}</span>
        </li>
      </ul>
    </div>

    <div v-if="result.errors.length" class="irc-fold">
      <button type="button" class="irc-toggle warn" @click="open.err = !open.err">
        <component :is="iconFor(open.err ? 'chevron-down' : 'chevron-right')" :size="14" />{{ result.errors.length }} 行未导入
      </button>
      <ul v-if="open.err" class="irc-list">
        <li v-for="(e, i) in result.errors" :key="i">
          <span v-if="e.rowIndex >= 0" class="rw">第 {{ e.rowIndex + 1 }} 行</span>
          <span class="lb">{{ e.label || '（空）' }}</span>
          <span class="rs">{{ e.reason }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* 视觉词汇抄 ImportResultToast(.ir-stat / .ir-summary / .ir-errs-list) */
.irc { display:flex; flex-direction:column; gap:12px; }
.irc-h { display:flex; align-items:center; gap:10px; }
.irc-h h4 { margin:0; flex:1; font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); }
.irc-h .ok { color:var(--hue-blue); }
.irc-h .warn { color:var(--hue-orange); }
.irc-meta { flex:0 0 auto; font-size:var(--fs-micro); font-family:var(--font-mono); color:var(--text-muted); }

.irc-stats { display:flex; gap:10px; }
.irc-stat { flex:1; min-width:0; display:flex; flex-wrap:wrap; align-items:baseline; column-gap:4px; row-gap:2px; padding:12px 14px; border-radius:var(--radius-md); background:var(--surface-card); }
.irc-stat b { font-size:22px; font-family:var(--font-mono); font-weight:var(--fw-semibold); color:var(--text-primary); }
.irc-stat small { font-size:var(--fs-label); color:var(--text-muted); }
.irc-stat span { flex:0 0 100%; font-size:var(--fs-micro); color:var(--text-muted); }
.irc-stat.ok b { color:var(--hue-blue); }
.irc-stat.warn b { color:var(--hue-orange); }

/* 分项明细:两列,名左数右 */
.irc-detail { display:grid; grid-template-columns:1fr 1fr; column-gap:24px; row-gap:3px; padding:10px 12px; border-radius:var(--radius-md); background:var(--surface-card); max-height:160px; overflow:auto; }
.irc-kv { display:flex; justify-content:space-between; gap:10px; font-size:var(--fs-micro); color:var(--text-secondary); min-width:0; }
.irc-kv span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.irc-kv b { flex:0 0 auto; font-family:var(--font-mono); font-weight:var(--fw-regular); color:var(--text-primary); white-space:nowrap; }

/* 可展开块:浅底圆角,点标题行展开(结果内容本身,不是字段校验) */
.irc-fold { padding:8px 12px; border-radius:var(--radius-md); background:var(--surface-card); }
.irc-fold-t { font-size:var(--fs-micro); color:var(--text-muted); margin-bottom:6px; }
.irc-toggle { display:flex; align-items:center; gap:6px; width:100%; border:none; background:transparent; cursor:pointer; padding:2px 0; font-family:var(--font-sans); font-size:var(--fs-label); font-weight:var(--fw-medium); color:var(--text-secondary); }
.irc-toggle.warn { color:var(--hue-orange); }
.irc-list { list-style:none; margin:8px 0 2px; padding:0; max-height:180px; overflow:auto; display:flex; flex-direction:column; gap:6px; }
.irc-list li { display:flex; align-items:baseline; gap:12px; font-size:var(--fs-micro); }
.irc-list .rw { flex:0 0 auto; font-family:var(--font-mono); color:var(--text-muted); }
.irc-list .lb { flex:0 0 auto; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:var(--fw-semibold); color:var(--text-primary); }
.irc-list .rs { flex:1; min-width:0; overflow-wrap:anywhere; color:var(--text-secondary); }
.irc-chips { display:flex; flex-wrap:wrap; gap:6px; }
.irc-chip { font-size:var(--fs-micro); color:var(--text-secondary); background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-full); padding:2px 9px; white-space:nowrap; }
.irc-chip b { font-family:var(--font-mono); color:var(--text-primary); margin-left:3px; }
.irc-chip.warn { border-color:var(--hue-orange); color:var(--hue-orange); }
.irc-chip.warn b { color:var(--hue-orange); }
</style>
