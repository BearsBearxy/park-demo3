<script setup lang="ts">
// ⓪ 年份选择层 — 共享附表脚手架(附表 6/7/8/11/12/办公三期水电 复用)。
// 年份 = 后端 overview 确定性范围 ∪ 用户「受管额外年份」(localStorage)。
// 支持自由新增年份(含 2024 之前 / 未来年),删除仅限「无后端数据的受管年」(数据年不可删)。
// 样式 1:1 移植 sched-common.jsx SchedYearGate(.sm-gate/.sm-ycard/.sm-ynew/.sm-ydlg)。
import { ref, computed, watch } from 'vue'
import { iconFor } from '@/components/ds/icon'

export interface YearCard {
  year: number
  hasData: boolean
  metric: string   // 有数据时显示的主指标,如 "¥123.4万"
  label: string    // metric 下方说明,如 "全年电费收益 · 26 条"
}

const props = defineProps<{
  icon: string
  title: string
  sub: string
  years: YearCard[]
  current: number          // 最新年(蓝高亮 + 「最新」角标)
  footer?: string
  storeKey: string         // localStorage 受管年份键(每附表/实例唯一,如 'pv' / 'charging-7')
  backLabel?: string       // 传入即显示返回按钮(台账/报表把门放在公司之后,需回上一层;附表不传,原样)
}>()
const emit = defineEmits<{ pick: [year: number]; back: [] }>()

// ── 受管额外年份(localStorage,允许 overview 范围外的年) ──
const lsKey = computed(() => `fp-sched-years-${props.storeKey}`)
function loadManaged(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(lsKey.value) || '[]')
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : []
  } catch { return [] }
}
const managed = ref<number[]>(loadManaged())
watch(lsKey, () => { managed.value = loadManaged() })   // 切换实例(如充电桩 7↔8)时重载
function persist() { localStorage.setItem(lsKey.value, JSON.stringify(managed.value)) }

// ── 合并:数据年(带 summary)∪ 受管额外年(无 summary → 待录入),去重排序 ──
const dataYears = computed(() => new Set(props.years.filter((y) => y.hasData).map((y) => y.year)))
const displayYears = computed<YearCard[]>(() => {
  const map = new Map<number, YearCard>()
  props.years.forEach((y) => map.set(y.year, y))
  managed.value.forEach((y) => { if (!map.has(y)) map.set(y, { year: y, hasData: false, metric: '', label: '' }) })
  return [...map.values()].sort((a, b) => a.year - b.year)
})
// 可删除 = 受管年 且 无后端数据(数据年有记录,不可删)
const removable = (year: number) => managed.value.includes(year) && !dataYears.value.has(year)
function removeYear(year: number) { managed.value = managed.value.filter((y) => y !== year); persist() }

// ── 新增年份弹窗 ──
const dlg = ref(false)
const input = ref('')
const err = ref('')
function openDlg() { input.value = ''; err.value = ''; dlg.value = true }
function submit() {
  const y = parseInt(input.value.trim(), 10)
  if (!y || String(y).length !== 4) { err.value = '请输入四位年份,如 2023'; return }
  if (y < 2000 || y > 2099) { err.value = '年份需在 2000 – 2099 之间'; return }
  if (displayYears.value.some((c) => c.year === y)) { err.value = `${y} 年已存在`; return }
  managed.value = [...managed.value, y]; persist()
  dlg.value = false
  emit('pick', y)   // 新增后直接进入该年录入
}
</script>

<template>
  <div class="sm-gate">
    <div class="sm-gate-head">
      <div class="sm-gate-headl">
        <button v-if="backLabel" class="sm-gate-back" :title="backLabel" @click="emit('back')">
          <component :is="iconFor('arrow-left')" :size="16" />
        </button>
        <div>
          <h2 class="sm-gate-title">
            <span class="ic"><component :is="iconFor(icon)" :size="18" /></span>{{ title }}
          </h2>
          <p class="sm-gate-sub">{{ sub }}</p>
        </div>
      </div>
    </div>
    <div class="sm-gate-labelrow">
      <div class="sm-gate-label">
        <component :is="iconFor('calendar')" :size="16" />选择年份
        <span class="hint">· 点击进入对应年份的明细表 · 可新增年份(含更早 / 未来年)</span>
      </div>
    </div>
    <div class="sm-gate-grid">
      <div
        v-for="y in displayYears"
        :key="y.year"
        :class="['sm-ycard', { cur: y.year === current }]"
        @click="emit('pick', y.year)"
      >
        <button
          v-if="removable(y.year)"
          class="sm-yc-del"
          title="移除该年(无数据)"
          @click.stop="removeYear(y.year)"
        ><component :is="iconFor('trash-2')" :size="14" /></button>
        <!-- hover 进入箭头:仅非当前年显示;当前年右上角是「最新」角标,不再叠箭头(避免重叠冲突) -->
        <span v-else-if="y.year !== current" class="sm-yc-go"><component :is="iconFor('arrow-right')" :size="16" /></span>
        <div class="sm-yc-head">
          <div class="sm-yc-year">{{ y.year }}<span class="u">年</span></div>
          <span v-if="y.year === current" class="sm-yc-tag">最新</span>
        </div>
        <div v-if="y.hasData" class="sm-yc-foot">
          <div class="sm-yc-metric">{{ y.metric }}</div>
          <div class="sm-yc-mlabel">{{ y.label }}</div>
        </div>
        <div v-else class="sm-yc-wait">
          <component :is="iconFor('file-plus')" :size="14" />待录入 · 进入后可录入
        </div>
      </div>
      <!-- 新增年份卡 -->
      <div class="sm-ynew" @click="openDlg">
        <span class="ic"><component :is="iconFor('plus')" :size="21" /></span>
        <span class="t">新增年份</span>
      </div>
    </div>
    <p v-if="footer" class="sm-foot"><component :is="iconFor('info')" :size="13" />{{ footer }}</p>

    <!-- 新增年份弹窗 -->
    <div v-if="dlg" class="sm-ymask" @mousedown="dlg = false">
      <div class="sm-ydlg" @mousedown.stop>
        <div class="sm-ydlg-h">
          <h3>新增年份</h3>
          <p>新增一个会计年份(可早于现有年份或为未来年),进入后即可在编辑模式下录入。</p>
        </div>
        <div class="sm-ydlg-b">
          <input
            class="sm-yin" :class="{ err: !!err }" v-model="input"
            inputmode="numeric" placeholder="如:2023" maxlength="4"
            @keydown.enter="submit"
          />
          <div class="sm-yerr">{{ err }}</div>
        </div>
        <div class="sm-ydlg-f">
          <button class="sm-ybtn gray" @click="dlg = false">取消</button>
          <button class="sm-ybtn filled" @click="submit"><component :is="iconFor('check')" :size="14" />新增</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 from sched-common.jsx SchedStyles (.sm-gate / .sm-ycard / .sm-ynew / .sm-ydlg 段) */
.sm-gate { display:flex; flex-direction:column; gap:18px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.sm-gate-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.sm-gate-headl { display:flex; align-items:center; gap:12px; min-width:0; }
.sm-gate-back { width:34px; height:34px; flex:0 0 auto; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:var(--radius-md); cursor:pointer; display:grid; place-items:center; color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.sm-gate-back:hover { background:var(--bg-hover); color:var(--text-primary); }
.sm-gate-title { margin:0; display:flex; align-items:center; gap:11px; font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.sm-gate-title .ic { width:34px; height:34px; border-radius:10px; background:var(--surface-sunken); display:grid; place-items:center; color:var(--text-secondary); flex:0 0 auto; }
.sm-gate-sub { margin:6px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.sm-gate-labelrow { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.sm-gate-label { flex:0 0 auto; display:flex; align-items:center; gap:8px; font-size:var(--fs-body); font-weight:var(--fw-semibold); color:var(--text-primary); }
.sm-gate-label .hint { font-size:12px; font-weight:var(--fw-regular); color:var(--text-muted); }

.sm-gate-grid { flex:0 0 auto; display:grid; grid-template-columns:repeat(auto-fill, minmax(238px,1fr)); gap:16px; }
.sm-ycard { position:relative; display:flex; flex-direction:column; min-height:152px; padding:21px 23px; box-sizing:border-box; cursor:pointer; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard); }
.sm-ycard:hover { border-color:var(--border-strong); box-shadow:0 8px 24px rgba(28,28,28,.10); transform:translateY(-2px); }
.sm-ycard.cur { background:var(--accent-blue); border-color:transparent; }
.sm-ycard.cur:hover { box-shadow:0 10px 26px rgba(28,28,28,.13); }
.sm-yc-head { display:flex; align-items:flex-start; justify-content:space-between; }
.sm-yc-year { font-size:34px; font-weight:var(--fw-semibold); letter-spacing:-0.02em; line-height:1; color:var(--text-primary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.sm-yc-year .u { font-size:14px; font-weight:var(--fw-medium); color:var(--text-muted); margin-left:4px; font-family:var(--font-sans); }
.sm-yc-tag { font-size:10.5px; font-weight:var(--fw-semibold); padding:2px 9px; border-radius:var(--radius-full); background:var(--ink-900); color:#fff; }
.sm-yc-go { position:absolute; top:21px; right:21px; width:30px; height:30px; border-radius:50%; display:grid; place-items:center; color:var(--text-disabled); background:var(--surface-card); opacity:0; transform:translateX(-4px); transition:opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.sm-ycard:hover .sm-yc-go { opacity:1; transform:translateX(0); background:var(--ink-900); color:#fff; }
.sm-yc-del { position:absolute; top:16px; right:16px; z-index:4; width:30px; height:30px; border:1px solid var(--border-subtle); border-radius:50%; background:var(--surface-white); color:var(--text-secondary); cursor:pointer; display:grid; place-items:center; opacity:0; transition:opacity var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard); }
.sm-ycard:hover .sm-yc-del { opacity:1; }
.sm-yc-del:hover { background:rgb(255,238,237); color:var(--hue-red); border-color:rgb(255,210,206); }
.sm-yc-foot { margin-top:auto; }
.sm-yc-metric { font-size:19px; font-weight:var(--fw-semibold); font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--text-primary); letter-spacing:-0.01em; white-space:nowrap; }
.sm-yc-mlabel { font-size:11.5px; color:var(--text-muted); margin-top:5px; }
.sm-yc-wait { margin-top:auto; font-size:12.5px; color:var(--text-disabled); display:inline-flex; align-items:center; gap:6px; }

/* 新增年份卡 */
.sm-ynew { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:11px; min-height:152px; box-sizing:border-box; cursor:pointer; background:transparent; border:1px dashed var(--border-strong); border-radius:var(--radius-lg); color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard); }
.sm-ynew:hover { background:var(--accent-blue); color:var(--hue-blue); border-color:var(--hue-blue); }
.sm-ynew .ic { width:42px; height:42px; border-radius:50%; background:var(--surface-card); display:grid; place-items:center; transition:background var(--dur-fast) var(--ease-standard); }
.sm-ynew:hover .ic { background:#fff; }
.sm-ynew .t { font-size:13.5px; font-weight:var(--fw-semibold); }

.sm-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }

/* 新增年份弹窗 */
.sm-ymask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:140; display:grid; place-items:center; }
.sm-ydlg { width:min(384px,90vw); background:var(--surface-white); border-radius:var(--radius-xl); box-shadow:0 16px 48px rgba(28,28,28,.22); overflow:hidden; }
.sm-ydlg-h { padding:20px 22px 0; }
.sm-ydlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.sm-ydlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.sm-ydlg-b { padding:16px 22px 4px; }
.sm-yin { width:100%; box-sizing:border-box; height:40px; padding:0 12px; font-size:14px; color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-mono); font-variant-numeric:tabular-nums; transition:border-color var(--dur-fast) var(--ease-standard); }
.sm-yin:focus { border-color:var(--hue-blue); }
.sm-yin.err { border-color:var(--hue-red); }
.sm-yerr { font-size:11.5px; color:var(--hue-red); margin-top:7px; min-height:14px; }
.sm-ydlg-f { display:flex; justify-content:flex-end; gap:8px; padding:14px 22px 20px; }
.sm-ybtn { height:34px; padding:0 16px; border-radius:var(--radius-full); border:none; cursor:pointer; font-family:var(--font-sans); font-size:13px; font-weight:var(--fw-medium); display:inline-flex; align-items:center; gap:6px; transition:background var(--dur-fast) var(--ease-standard), filter var(--dur-fast) var(--ease-standard); }
.sm-ybtn.gray { background:var(--surface-sunken); color:var(--text-secondary); }
.sm-ybtn.gray:hover { background:var(--ink-100); }
.sm-ybtn.filled { background:var(--ink-900); color:#fff; }
.sm-ybtn.filled:hover { background:rgb(58,58,58); }
</style>
