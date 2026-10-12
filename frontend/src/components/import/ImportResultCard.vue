<script setup lang="ts">
// 导入弹窗的原地结果卡(md-v2-done;动效板 ③;UI-OVERLAY-SPEC §8):进度卡跑完就地换成它,弹窗不关。
// 标题「✓ 导进去 N 行」,勾一笔画出(320ms,pathLength + dashoffset,both:减少动态时停在画完);右上「用时 m:ss」。
// 三种长相(kind):
//   flat   两块数(导进去 / 没导);没导的行逐条列出(核对页导不了的 bad + 后端报的 errors,不折叠)+ 一句怎么补。
//   secs   都导进去了:两块数(N 段 / M 行导进去)+「一期、二期、三期都在库里了。」;有没导的 → 同 flat。
//   ledger 都导进去了:只一句「9月水电的台账已经在库里了。」;有没导的 → 同 flat。
// 抄表的匹配分档、档案改动、「n 条提示」、分项明细照旧(10-02 版)。按钮在弹窗底栏,这里只画内容。
import { ref, computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import type { BadRow } from '@/utils/importHeaderMatch'
import { useImportResult, FIELD_LABEL } from './useImportResult'
import { mss, n0, type ImportOutcome } from './importRun'

const props = withDefaults(defineProps<{
  result: ImportOutcome; unit: string; elapsed: number; note: string
  kind?: 'flat' | 'secs' | 'ledger'
  /** 核对页就导不了、这次没发的行 */
  bad?: BadRow[]
  /** secs:导了几段 */
  segs?: number
  /** 都导进去时那一句(secs / ledger) */
  okLine?: string
}>(), { kind: 'flat', bad: () => [], segs: 0, okLine: '' })

const { notices, changes, chgVal, chgSpan, matchStats } = useImportResult(props.result)
/** 没导的:核对页的 bad + 后端跳过的(后端写口 skipped 就是 errors 条数,取大不重复算)。
 *  两种行号不是一把尺:核对页的是文件里第几行(BadRow.row),后端的是发出去的第几条(已不含表头和导不了的行)——
 *  后者写「第 N 条」,不冒充文件行号 */
const missed = computed(() => props.bad.length + Math.max(props.result.skipped, props.result.errors.length))
const missList = computed(() => [
  ...props.bad.map(b => ({ row: `第 ${b.row} 行`, label: brief(b.cells), reason: b.reason })),
  ...props.result.errors.map(e => ({ row: e.rowIndex >= 0 ? `第 ${e.rowIndex + 1} 条` : '', label: e.label || '（空）', reason: e.reason })),
])
const allIn = computed(() => missed.value === 0)
// 一行都没写进去(全被后端拒掉 / 只剩导不了的行):不打勾、不写「导进去 0 行」—— 打勾读起来就是成功了
const none = computed(() => props.result.imported === 0 && missed.value > 0)
// 导不了的行写哪一行:头两格 + 第三格(「二期 7栋 · 9月19」)
function brief(cells: string[]): string {
  const c = cells.map(x => String(x ?? '').trim()).filter(Boolean)
  return c.length > 2 ? `${c.slice(0, 2).join(' ')} · ${c[2]}` : c.join(' ')
}
const open = ref<Record<'chg' | 'note', boolean>>({ chg: false, note: false })
</script>

<template>
  <div class="irc">
    <div class="irc-h">
      <component :is="iconFor('alert-triangle')" v-if="none" class="irc-no" :size="18" aria-hidden="true" />
      <svg v-else class="irc-ok" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" pathLength="1" /></svg>
      <h4>{{ none ? `一${unit}都没导进去` : `导进去 ${n0(result.imported)} ${unit}` }}</h4>
      <span class="irc-meta">用时 {{ mss(elapsed) }}<template v-if="note"> · {{ note }}</template></span>
    </div>

    <div v-if="!(kind === 'ledger' && allIn)" class="irc-stats">
      <template v-if="kind === 'secs' && allIn">
        <div class="irc-stat"><b>{{ n0(segs) }}</b><span>段</span></div>
        <div class="irc-stat"><b>{{ n0(result.imported) }}</b><span>{{ unit }}导进去</span></div>
      </template>
      <template v-else>
        <div class="irc-stat"><b>{{ n0(result.imported) }}</b><span>{{ unit }}导进去</span></div>
        <div class="irc-stat" :class="{ warn: missed > 0 }"><b>{{ n0(missed) }}</b><span>{{ unit }}没导</span></div>
      </template>
    </div>

    <template v-if="missList.length">
      <div class="irc-st">没导的 {{ n0(missed) }} {{ unit }}</div>
      <ul class="irc-errs">
        <li v-for="(e, i) in missList" :key="i">
          <span class="rw">{{ e.row }}</span><span class="lb">{{ e.label }}</span><span class="rs">{{ e.reason }}</span>
        </li>
      </ul>
    </template>

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

    <p v-if="none" class="irc-p">改好这 {{ n0(missed) }} {{ unit }}后再导一次就行。</p>
    <p v-else-if="!allIn" class="irc-p">改好这 {{ n0(missed) }} {{ unit }}后单独再导就行；已经导进去的 {{ n0(result.imported) }} {{ unit }}再导也只是用新数盖掉，不会多出来。</p>
    <p v-else-if="okLine" class="irc-p">{{ okLine }}</p>
  </div>
</template>

<style scoped>
/* 照 md-v2-done(.md-done):浅底卡;换上来淡入 120ms,勾在卡淡入之后一笔画出 320ms(动效板 ③) */
.irc { display:flex; flex-direction:column; gap:12px; padding:16px 18px; border-radius:var(--radius-md); background:var(--surface-card);
  opacity:0; animation:fp-fade-in var(--dur-fast) var(--ease-out) forwards; }
.irc-h { display:flex; align-items:center; gap:8px; }
.irc-h h4 { margin:0; flex:1; font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); }
.irc-ok { flex:0 0 auto; color:var(--hue-blue); }
.irc-no { flex:0 0 auto; color:var(--status-warning); }
.irc-ok path { stroke-dasharray:1; stroke-dashoffset:1; animation:irc-draw var(--dur-slow) var(--ease-out) var(--dur-fast) both; }
@keyframes irc-draw { from { stroke-dashoffset:1; } to { stroke-dashoffset:0; } }
/* 减少动态:全局把时长压成 1ms,延迟也去掉,勾直接是画完的样子 */
@media (prefers-reduced-motion: reduce) { .irc-ok path { animation-delay:0s; } }
.irc-meta { flex:0 0 auto; font-size:var(--fs-micro); font-family:var(--font-mono); color:var(--text-muted); }

.irc-stats { display:flex; gap:10px; }
.irc-stat { flex:1; min-width:0; display:flex; align-items:baseline; gap:6px; padding:12px 14px; border-radius:var(--radius-sm); background:var(--surface-white); }
.irc-stat b { font-family:var(--font-mono); font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.irc-stat span { font-size:var(--fs-label); color:var(--text-secondary); }
.irc-stat.warn b { color:var(--caution-text); }

/* 没导的行(.md-errs):白底列表,行 36 高,原因琥珀色靠右 */
.irc-st { font-size:var(--fs-micro); font-weight:var(--fw-semibold); color:var(--text-secondary); }
.irc-errs { list-style:none; margin:0; padding:0; border-radius:var(--radius-sm); background:var(--surface-white); max-height:216px; overflow:auto; }
.irc-errs li { display:flex; gap:12px; align-items:center; min-height:36px; padding:0 12px; border-bottom:1px solid var(--divider); font-size:var(--fs-label); }
.irc-errs li:last-child { border-bottom:none; }
.irc-errs .rw { flex:0 0 auto; min-width:56px; font-family:var(--font-mono); color:var(--text-muted); }
.irc-errs .lb { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--font-mono); color:var(--text-primary); }
.irc-errs .rs { margin-left:auto; flex:0 0 auto; max-width:50%; text-align:right; color:var(--caution-text); }
.irc-p { margin:0; font-size:var(--fs-label); line-height:20px; color:var(--text-secondary); }

/* 分项明细:两列,名左数右 */
.irc-detail { display:grid; grid-template-columns:1fr 1fr; column-gap:24px; row-gap:3px; padding:10px 12px; border-radius:var(--radius-sm); background:var(--surface-white); max-height:160px; overflow:auto; }
.irc-kv { display:flex; justify-content:space-between; gap:10px; font-size:var(--fs-micro); color:var(--text-secondary); min-width:0; }
.irc-kv span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.irc-kv b { flex:0 0 auto; font-family:var(--font-mono); font-weight:var(--fw-regular); color:var(--text-primary); white-space:nowrap; }

/* 可展开块:白底圆角,点标题行展开(抄表的档案改动、提示) */
.irc-fold { padding:8px 12px; border-radius:var(--radius-sm); background:var(--surface-white); }
.irc-fold-t { font-size:var(--fs-micro); color:var(--text-muted); margin-bottom:6px; }
.irc-toggle { display:flex; align-items:center; gap:6px; width:100%; border:none; background:transparent; cursor:pointer; padding:2px 0; font-family:var(--font-sans); font-size:var(--fs-label); font-weight:var(--fw-medium); color:var(--text-secondary); }
.irc-list { list-style:none; margin:8px 0 2px; padding:0; max-height:180px; overflow:auto; display:flex; flex-direction:column; gap:6px; }
.irc-list li { display:flex; align-items:baseline; gap:12px; font-size:var(--fs-micro); }
.irc-list .rw { flex:0 0 auto; font-family:var(--font-mono); color:var(--text-muted); }
.irc-list .lb { flex:0 0 auto; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:var(--fw-semibold); color:var(--text-primary); }
.irc-list .rs { flex:1; min-width:0; overflow-wrap:anywhere; color:var(--text-secondary); }
.irc-chips { display:flex; flex-wrap:wrap; gap:6px; }
.irc-chip { font-size:var(--fs-micro); color:var(--text-secondary); background:var(--surface-card); border:1px solid var(--border-subtle); border-radius:var(--radius-full); padding:2px 9px; white-space:nowrap; }
.irc-chip b { font-family:var(--font-mono); color:var(--text-primary); margin-left:3px; }
.irc-chip.warn { border-color:var(--status-warning); color:var(--caution-text); }
.irc-chip.warn b { color:var(--caution-text); }
</style>
