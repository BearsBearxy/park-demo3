<!-- Copyright (c) 2026 Junyang. All rights reserved. -->
<script setup lang="ts">
// 导入进度卡 + 失败卡(md-v2-run / md-v2-fail;动效板 ③④;UI-OVERLAY-SPEC §8)。
// 只画 FpImportModal 给的 RunState,不发请求、不管按钮(按钮在弹窗底栏)。
//   逐段(附表10):「正在导入 3 段 · 255 行」+ 已用 + 真进度条 +「已写进 a / N 行」+ 每段一行(✓ 已导进去 / 转圈 正在写 / · 没开始)。
//   单次请求:不写百分比,不确定进度条横移(减少动态时改呼吸),右上「已用 m:ss」+ 步骤表。
//   failing:请求已经失败、失败卡还没换上的那 200ms —— 进度条变红(--ease-standard),然后弹窗换失败卡(淡入 120ms)。
//   失败:逐段网络 / 5xx →「第 k 段(期区)没导进去」+ 原因 + 每段一行 + 哪几段已在库里、从哪接着导;
//         整单拒 →「导入失败，这次一行都没写进去」;多次请求的(工资逐月等)前面已写入 → 不写「一行都没写进去」。
import { computed } from 'vue'
import { AlertCircle } from 'lucide-vue-next'
import { iconFor } from '@/components/ds/icon'
import { mss, n0, type RunState } from './importRun'

const props = defineProps<{ run: RunState; failing?: boolean }>()

const K = computed(() => props.run.segs.length)
/** 逐段:正在写(或卡住)的那一段,0 基 */
const cur = computed(() => Math.min(props.run.done, K.value - 1))
const doneSegs = computed(() => props.run.segs.slice(0, props.run.done))
/** 已写进 = 写完那些段后端回的写入数(跳过的行不算);进度条按已发出的行数走,跳过的行也走完了 */
const written = computed(() => doneSegs.value.reduce((a, s) => a + s.ok, 0))
const sent = computed(() => doneSegs.value.reduce((a, s) => a + s.n, 0))
const pct = computed(() => `${props.run.count ? (sent.value / props.run.count) * 100 : 0}%`)
const segAt = (k: number) => props.run.segs[k] ?? { label: '', n: 0, ok: 0 }
const segState = (k: number) => (k < props.run.done ? 'done' : k === props.run.done ? 'now' : 'todo')
const SEG_NOW: Record<string, string> = { done: '已导进去', now: '正在写', todo: '没开始' }

/** 失败卡用段列表的写法:有段写进去了,或这是能接着导的那种(网络 / 5xx) */
const segFail = computed(() => props.run.seg && (props.run.done > 0 || props.run.fail?.kind !== 'reject'))
/** 请求发出后没有回应:断的那段写没写进去不知道,不说「没导」 */
const lost = computed(() => props.run.fail?.kind === 'lost')
const failSeg = (k: number) => (k < props.run.done ? 'done' : k === props.run.done ? 'bad' : 'todo')
const SEG_FAIL: Record<string, string> = { done: '已导进去', todo: '没开始' }
const failLine = computed(() => {
  const lb = segAt(cur.value).label
  const kept = props.run.done > 0 ? `${doneSegs.value.map(s => s.label).join('、')}已经在库里了；` : ''
  if (props.run.fail?.kind === 'reject') return `${kept}${lb}${K.value - props.run.done > 1 ? '和后面的段' : ''}都没写。`
  return `${kept}${lost.value ? `${lb}写没写进去，以本页刷新后看到的为准；` : ''}接着导只从${lb}开始，不会重复。`
})
</script>

<template>
  <!-- ── 失败 ── -->
  <div v-if="run.fail" class="ipf">
    <div class="ipf-h">
      <AlertCircle :size="18" class="ipf-ic" aria-hidden="true" />
      <h4 v-if="segFail">第 {{ run.done + 1 }} 段（{{ segAt(cur).label }}）{{ lost ? '没等到服务器的结果' : '没导进去' }}</h4>
      <h4 v-else-if="lost">导入失败，没等到服务器的结果</h4>
      <h4 v-else-if="run.wrote > 0">导入没做完，前面已写入 {{ n0(run.wrote) }} {{ run.unit }}</h4>
      <h4 v-else>导入失败，这次一{{ run.unit }}都没写进去</h4>
    </div>
    <div class="ipf-box"><small>原因</small><span>{{ run.fail.reason }}</span></div>
    <template v-if="segFail">
      <ul class="ipc-segs">
        <li v-for="(s, k) in run.segs" :key="k" :class="failSeg(k)">
          <component v-if="failSeg(k) === 'done'" :is="iconFor('check')" :size="14" class="st" />
          <component v-else-if="failSeg(k) === 'bad'" :is="iconFor('x-circle')" :size="14" class="st" />
          <i v-else class="st dot" />
          <span class="nm">{{ s.label }}</span><span class="n">{{ n0(s.n) }} {{ run.unit }}</span>
          <em>{{ failSeg(k) === 'bad' ? (lost ? '没等到结果' : '没导') : SEG_FAIL[failSeg(k)] }}</em>
        </li>
      </ul>
      <p class="ipf-line">{{ failLine }}</p>
    </template>
    <template v-else>
      <p class="ipf-line">{{ lost ? '这次写没写进去，以本页刷新后看到的为准。'
        : run.wrote > 0 ? '已写入的留在库里，出错那一次和后面的都没写。' : '本期还是导入前的数据。' }}</p>
      <p v-if="run.kept" class="ipf-line">{{ run.kept }}</p>
    </template>
  </div>

  <!-- ── 进行中 · 逐段 ── -->
  <div v-else-if="run.seg" class="ipc">
    <div class="ipc-h">
      <h4>正在导入 {{ K }} 段 · {{ n0(run.count) }} {{ run.unit }}</h4>
      <span class="ipc-el">已用 <b>{{ mss(run.elapsed) }}</b></span>
    </div>
    <div class="ipc-bar" :class="{ bad: failing }"><i :style="{ width: pct }" /></div>
    <div class="ipc-sub">已写进 <b>{{ n0(written) }}</b> / {{ n0(run.count) }} {{ run.unit }}</div>
    <ul class="ipc-segs">
      <li v-for="(s, k) in run.segs" :key="k" :class="segState(k)">
        <component v-if="segState(k) === 'done'" :is="iconFor('check')" :size="14" class="st" />
        <span v-else-if="segState(k) === 'now'" class="st page-spin ipc-spin" aria-hidden="true" />
        <i v-else class="st dot" />
        <span class="nm">{{ s.label }}</span><span class="n">{{ n0(s.n) }} {{ run.unit }}</span>
        <em>{{ SEG_NOW[segState(k)] }}</em>
      </li>
    </ul>
    <p class="ipc-p">导完之前不能关这个窗口。万一断了，不关窗口就能从断的那段接着导。</p>
  </div>

  <!-- ── 进行中 · 单次请求 ── -->
  <div v-else class="ipc">
    <div class="ipc-h">
      <h4>正在导入 {{ n0(run.count) }} {{ run.unit }}</h4>
      <span class="ipc-meta">{{ run.meta }}</span>
      <span class="ipc-el">已用 <b>{{ mss(run.elapsed) }}</b></span>
    </div>
    <div class="ipc-bar ind" :class="{ bad: failing }"><i /></div>
    <div class="ipc-sub">这一步一次写完，中途没有进度可看</div>
    <ul class="ipc-steps">
      <li v-for="(s, i) in run.steps" :key="i" :class="i < run.stage ? 'done' : i === run.stage ? 'now' : 'todo'">
        <component v-if="i < run.stage" :is="iconFor('check')" :size="14" class="st" />
        <span v-else-if="i === run.stage" class="st page-spin ipc-spin" aria-hidden="true" />
        <i v-else class="st dot" />
        <span>{{ s.label }}</span>
        <em>{{ s.note }}</em>
      </li>
    </ul>
    <p class="ipc-p">导完之前不能关这个窗口。</p>
  </div>
</template>

<style scoped>
/* 卡:照 md-v2-run / md-v2-fail(.md-run / .md-fail):浅底圆角,16 18 内边距 */
.ipc, .ipf { display:flex; flex-direction:column; gap:12px; padding:16px 18px; border-radius:var(--radius-md); background:var(--surface-card); }
/* 失败卡换上来淡入 120ms(动效板 ④);减少动态时 motion.css 全局压成 1ms */
.ipf { opacity:0; animation:fp-fade-in var(--dur-fast) var(--ease-out) forwards; }
.ipc-h { display:flex; align-items:center; gap:8px; min-width:0; }
.ipc-h h4, .ipf-h h4 { margin:0; flex:0 0 auto; font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); }
.ipc-meta { flex:1 1 auto; min-width:0; font-size:var(--fs-micro); font-family:var(--font-mono); color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ipc-el { flex:0 0 auto; margin-left:auto; font-size:var(--fs-micro); color:var(--text-muted); }
.ipc-el b { font-family:var(--font-mono); font-weight:var(--fw-semibold); color:var(--text-primary); }

/* 进度条:6 高,蓝;每写完一段往前走 200ms 起手快;失败变红 200ms 标准(动效板 ③④)。不确定态是一截横移的条(不写百分比) */
.ipc-bar { position:relative; height:6px; border-radius:3px; background:var(--border-subtle); overflow:hidden; }
.ipc-bar > i { position:absolute; top:0; bottom:0; left:0; border-radius:inherit; background-color:var(--hue-blue);
  transition:width var(--dur-base) var(--ease-out), background-color var(--dur-base) var(--ease-standard); }
.ipc-bar.bad > i { background-color:var(--hue-red); }
.ipc-bar.ind > i { width:30%; animation:ipc-slide 1.4s var(--ease-standard) infinite; }
@keyframes ipc-slide { from { transform:translateX(-100%); } to { transform:translateX(340%); } }
@keyframes ipc-breathe { 50% { opacity:.35; } }
/* 减少动态:不横移,原地呼吸。全局那条把一切动画压成 1ms —— 这里要更高优先级把它顶回来(同 motion.css .page-spin 例外) */
@media (prefers-reduced-motion: reduce) {
  .ipc-bar.ind > i { left:35%; transform:none; animation:ipc-breathe 1.6s ease-in-out infinite !important; animation-duration:1.6s !important; animation-iteration-count:infinite !important; }
  /* 转圈换成原地一闪一闪(动效板「减少动态效果」);全局 .page-spin 例外让它照转,这里更具体、同为 !important 顶回来 */
  .ipc-spin.page-spin { animation:ipc-breathe 1.6s ease-in-out infinite !important; animation-duration:1.6s !important; animation-iteration-count:infinite !important; }
}

.ipc-sub { font-size:var(--fs-label); color:var(--text-secondary); }
.ipc-sub b { font-family:var(--font-mono); font-weight:var(--fw-semibold); color:var(--text-primary); }
.ipc-p, .ipf-line { margin:0; font-size:var(--fs-label); line-height:20px; color:var(--text-secondary); }

/* 每段一行(.md-segs):36 高、上分隔线;图标 · 期区 · 行数 · 右注 */
.ipc-segs { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
.ipc-segs li { display:flex; align-items:center; gap:10px; height:36px; border-top:1px solid var(--divider); font-size:var(--fs-label); color:var(--text-secondary); }
.ipc-segs .nm { color:var(--text-primary); min-width:60px; }
.ipc-segs .n { font-family:var(--font-mono); }
.ipc-segs em, .ipc-steps em { margin-left:auto; font-style:normal; font-size:var(--fs-micro); color:var(--text-muted); white-space:nowrap; }
.ipc-segs li.bad em { color:var(--hue-red); }

/* 单次请求的步骤表:左图标 · 名 · 右注 */
.ipc-steps { list-style:none; margin:0; padding:12px 0 0; border-top:1px solid var(--divider); display:flex; flex-direction:column; gap:12px; }
.ipc-steps li { display:flex; align-items:center; gap:10px; font-size:var(--fs-label); color:var(--text-primary); }
.ipc-steps li.todo { color:var(--text-muted); }
.ipc-steps em { font-family:var(--font-mono); }

.st { flex:0 0 auto; }
.done .st { color:var(--hue-blue); }
.bad .st { color:var(--hue-red); }
.ipc-spin.page-spin { width:12px; height:12px; border-width:2px; box-sizing:border-box; margin:0 1px; }
.dot { width:14px; height:14px; display:grid; place-items:center; }
.dot::before { content:''; width:6px; height:6px; border-radius:50%; background:var(--border-strong); }

/* 失败:标题红圈 + 原因块(.md-fail .why) */
.ipf-h { display:flex; align-items:center; gap:8px; }
.ipf-ic { flex:0 0 auto; color:var(--hue-red); }
.ipf-box { display:flex; flex-direction:column; gap:2px; padding:10px 12px; border-radius:var(--radius-sm); background:var(--danger-soft); color:var(--delta-down-text); font-size:var(--fs-label); }
.ipf-box small { font-size:var(--fs-micro); opacity:.8; }
</style>
