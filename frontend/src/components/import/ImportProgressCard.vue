<script setup lang="ts">
// 导入进度卡 + 失败卡(画布 11 节 ImportSeg / ImportOne / ImportFail;UI-OVERLAY-SPEC §8)。
// 只画 FpImportModal 给的 RunState,不发请求、不管按钮(按钮在弹窗脚部)。
//   逐段(附表10):真进度条 + 「第 k 段 · 年月 · 期 · n 条」「已写入 a / N 条」。
//   单次请求:不写百分比,不确定进度条横移(减少动态时改呼吸),右上「已用 m:ss」。
//   失败:逐段网络 / 5xx →「第 k 段没导进去」+ 段列表(没回应的那段写没写进去不知道,照实写);整单拒 →「导入失败,这次一条都没写进去」;
//         多次请求的(工资逐月等)前面已写入 → 不写「一条都没写进去」。
import { computed } from 'vue'
import { AlertCircle } from 'lucide-vue-next'
import { iconFor } from '@/components/ds/icon'
import { mss, n0, type RunState } from './importRun'

const props = defineProps<{ run: RunState }>()

const K = computed(() => props.run.segs.length)
/** 逐段:正在写(或卡住)的那一段,0 基 */
const cur = computed(() => Math.min(props.run.done, K.value - 1))
const doneSegs = computed(() => props.run.segs.slice(0, props.run.done))
/** 已写入 = 写完那些段后端回的写入数(跳过的行不算);进度条按已发出的条数走,跳过的行也走完了 */
const written = computed(() => doneSegs.value.reduce((a, s) => a + s.ok, 0))
const sent = computed(() => doneSegs.value.reduce((a, s) => a + s.n, 0))
const pct = computed(() => `${props.run.count ? (sent.value / props.run.count) * 100 : 0}%`)
const segAt = (k: number) => props.run.segs[k] ?? { label: '', n: 0, ok: 0 }
const span = (a: number, b: number) => (a === b ? `第 ${a} 段` : `第 ${a}–${b} 段`)

/** 失败卡用段列表的写法:有段写进去了,或这是能接着导的那种(网络 / 5xx) */
const segFail = computed(() => props.run.seg && (props.run.done > 0 || props.run.fail?.kind !== 'reject'))
/** 请求发出后没有回应:断的那段写没写进去不知道,不说「没写」 */
const lost = computed(() => props.run.fail?.kind === 'lost')
const rest = computed(() => K.value - props.run.done - 1)
const failLine = computed(() => {
  const k = props.run.done + 1
  const tail = lost.value
    ? `第 ${k} 段写没写进去，以本页刷新后看到的为准` + (rest.value > 0 ? `；后面 ${rest.value} 段没有写。` : '。')
    : rest.value > 0 ? `第 ${k} 段和后面 ${rest.value} 段都没有写。` : `第 ${k} 段没有写。`
  return props.run.done > 0 ? `前 ${props.run.done} 段 ${n0(written.value)} 条已经写入；${tail}` : tail
})

const stepNote = (i: number, note: string) =>
  props.run.seg && i === 1 ? `${props.run.done} / ${K.value} 段` : note
</script>

<template>
  <!-- ── 失败 ── -->
  <div v-if="run.fail" class="ipf">
    <div class="ipf-h">
      <AlertCircle :size="18" class="ipf-ic" aria-hidden="true" />
      <h4 v-if="segFail">第 {{ run.done + 1 }} 段{{ lost ? '没等到服务器的结果' : '没导进去' }}</h4>
      <h4 v-else-if="lost">导入失败，没等到服务器的结果</h4>
      <h4 v-else-if="run.wrote > 0">导入没做完，前面已写入 {{ n0(run.wrote) }} {{ run.unit }}</h4>
      <h4 v-else>导入失败，这次一{{ run.unit }}都没写进去</h4>
    </div>
    <p v-if="segFail" class="ipf-line">{{ failLine }}</p>
    <div class="ipf-box">
      <small v-if="segFail">{{ span(run.done + 1, run.done + 1) }} · {{ segAt(cur).label }} · {{ n0(segAt(cur).n) }} 条</small>
      <small v-else>原因</small>
      <span>{{ run.fail.reason }}</span>
    </div>
    <template v-if="segFail">
      <div class="ipc">
        <div class="ipc-bar bad"><i :style="{ width: pct }" /></div>
        <ul class="ipc-steps sep">
          <li v-if="run.done > 0" class="done">
            <component :is="iconFor('check')" :size="15" class="st" /><span>{{ span(1, run.done) }}</span>
            <em>{{ n0(written) }} 条已写入</em>
          </li>
          <li class="bad">
            <component :is="iconFor('x-circle')" :size="15" class="st" /><span>{{ span(run.done + 1, run.done + 1) }}</span>
            <em>{{ lost ? '没等到结果' : '没写' }}</em>
          </li>
          <li v-if="rest > 0" class="todo">
            <i class="st dot" /><span>{{ span(run.done + 2, K) }}</span><em>没开始</em>
          </li>
        </ul>
      </div>
    </template>
    <template v-else>
      <p class="ipf-line">{{ lost ? '这次写没写进去，以本页刷新后看到的为准。'
        : run.wrote > 0 ? '已写入的留在库里，出错那一次和后面的都没写。' : '本期还是导入前的数据。' }}</p>
      <p v-if="run.kept" class="ipf-line">{{ run.kept }}</p>
    </template>
  </div>

  <!-- ── 进行中 ── -->
  <div v-else class="ipc">
    <div class="ipc-h">
      <h4>正在导入 <b>{{ n0(run.count) }}</b> {{ run.unit }}</h4>
      <span class="ipc-meta">{{ run.meta }}</span>
      <span v-if="!run.seg" class="ipc-el">已用 <b>{{ mss(run.elapsed) }}</b></span>
    </div>
    <div class="ipc-bar" :class="{ ind: !run.seg }"><i :style="run.seg ? { width: pct } : undefined" /></div>
    <div v-if="run.seg" class="ipc-sub">
      <span>第 {{ cur + 1 }} 段 · {{ segAt(cur).label }} · {{ n0(segAt(cur).n) }} 条</span>
      <span class="r">已写入 <b>{{ n0(written) }}</b> / {{ n0(run.count) }} 条</span>
    </div>
    <div v-else class="ipc-sub">这一步一次写完，中途没有进度可看</div>
    <ul class="ipc-steps sep">
      <li v-for="(s, i) in run.steps" :key="i" :class="i < run.stage ? 'done' : i === run.stage ? 'now' : 'todo'">
        <component v-if="i < run.stage" :is="iconFor('check')" :size="15" class="st" />
        <span v-else-if="i === run.stage" class="st page-spin ipc-spin" aria-hidden="true" />
        <i v-else class="st dot" />
        <span>{{ s.label }}</span>
        <em>{{ stepNote(i, s.note) }}</em>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* 卡:块内浅底(同 ImportResultToast .ir-stat 的 surface-card + radius-md) */
.ipc { display:flex; flex-direction:column; gap:10px; padding:16px 18px; border-radius:var(--radius-md); background:var(--surface-card); }
.ipc-h { display:flex; align-items:baseline; gap:10px; min-width:0; }
.ipc-h h4 { margin:0; flex:0 0 auto; font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); }
.ipc-h h4 b, .ipc-el b, .ipc-sub b { font-family:var(--font-mono); font-weight:var(--fw-semibold); }
.ipc-meta { flex:1 1 auto; min-width:0; font-size:var(--fs-micro); font-family:var(--font-mono); color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ipc-el { flex:0 0 auto; margin-left:auto; font-size:var(--fs-micro); color:var(--text-muted); }
.ipc-el b { color:var(--text-primary); }

/* 进度条:6 高,蓝;失败红。不确定态是一截横移的条(不写百分比) */
.ipc-bar { position:relative; height:6px; border-radius:3px; background:var(--border-subtle); overflow:hidden; }
.ipc-bar > i { position:absolute; top:0; bottom:0; left:0; border-radius:inherit; background:var(--hue-blue); transition:width var(--dur-base) var(--ease-out); }
.ipc-bar.bad > i { background:var(--hue-red); }
.ipc-bar.ind > i { width:30%; animation:ipc-slide 1.4s var(--ease-standard) infinite; }
@keyframes ipc-slide { from { transform:translateX(-100%); } to { transform:translateX(340%); } }
@keyframes ipc-breathe { 50% { opacity:.35; } }
/* 减少动态:不横移,原地呼吸。全局那条把一切动画压成 1ms —— 这里要更高优先级把它顶回来(同 motion.css .page-spin 例外) */
@media (prefers-reduced-motion: reduce) {
  .ipc-bar.ind > i { left:35%; transform:none; animation:ipc-breathe 1.6s ease-in-out infinite !important; animation-duration:1.6s !important; animation-iteration-count:infinite !important; }
}

.ipc-sub { display:flex; justify-content:space-between; gap:12px; font-size:var(--fs-micro); color:var(--text-muted); font-family:var(--font-mono); }
.ipc-sub .r { flex:0 0 auto; }
.ipc-sub b { color:var(--text-primary); }

/* 步骤表:左图标 · 名 · 右注 */
.ipc-steps { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
.ipc-steps.sep { border-top:1px solid var(--divider); padding-top:14px; margin-top:2px; }
.ipc-steps li { display:flex; align-items:center; gap:12px; font-size:var(--fs-body); color:var(--text-primary); }
.ipc-steps li.todo { color:var(--text-muted); }
.ipc-steps li.bad { color:var(--delta-down-text); }
.ipc-steps em { margin-left:auto; font-style:normal; font-size:var(--fs-micro); font-family:var(--font-mono); color:var(--text-muted); white-space:nowrap; }
.ipc-steps li.bad em { color:var(--delta-down-text); }
.st { flex:0 0 auto; }
.done .st { color:var(--hue-green); }
.bad .st { color:var(--hue-red); }
.ipc-spin.page-spin { width:15px; height:15px; border-width:2px; box-sizing:border-box; }
.dot { width:15px; height:15px; display:grid; place-items:center; }
.dot::before { content:''; width:7px; height:7px; border-radius:50%; border:1px solid var(--border-strong); box-sizing:border-box; }

/* 失败 */
.ipf { display:flex; flex-direction:column; gap:14px; }
.ipf-h { display:flex; align-items:center; gap:10px; }
.ipf-h h4 { margin:0; font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); }
.ipf-ic { flex:0 0 auto; color:var(--hue-red); }
.ipf-line { margin:0; font-size:var(--fs-label); color:var(--text-secondary); }
.ipf-box { display:flex; flex-direction:column; gap:4px; padding:12px 14px; border-radius:var(--radius-sm); background:var(--danger-soft); color:var(--delta-down-text); font-size:var(--fs-label); }
.ipf-box small { font-size:var(--fs-micro); font-family:var(--font-mono); opacity:.85; }
</style>
