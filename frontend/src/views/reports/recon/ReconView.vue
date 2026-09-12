<script setup lang="ts">
// 收入核对 ①月份层 — P2-E Task3。年份胶囊 + 4 指标条 + 12 月卡 → 点月进 ②工作台。
// 视觉 1:1 移植 recon-page-v3.js(--pa-* → demo3 令牌,映射见 plan Task3);
// overview 仅 counts 无金额字段 → 指标条按户数口径聚合(不硬造总额)。
// PAGE-BEHAVIOR-SPEC §1 加载门 + v-else 紧邻链;切月不清 data(避免闪加载门),竞态守卫换数据。
import { ref, computed, onMounted } from 'vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import { REPORT_STEPS, periodLabel } from '@/nav/reportPeriod'
import { periodOf, type DeepPeriod } from '@/nav/deepLink'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
import { reconApi } from '@/api/recon'
import type { ReconMonth, ReconMonthMeta, ReconOverview } from '@/types/recon'
import { iconFor } from '@/components/ds/icon'
import ReconWorkbench from './ReconWorkbench.vue'

const overview = ref<ReconOverview | null>(null)
const year = ref(0)
const maxYear = ref(0)                       // 默认年=两本账有数据的最大年,作为上限
const month = ref<number | null>(null)       // null → ①月份层
const data = ref<ReconMonth | null>(null)    // ②工作台整月对照

// 期间条(设计稿 §3.2c)。本屏认 y/m,co 不认但原样带回去 —— 否则跳回利润表就丢了公司。
// carry 只在深链 apply 时写(见 pickMonth 之后):不能写成 computed(route.query) —— 屏停用时全局 route 跟着别的屏变。
const carry = ref<DeepPeriod | null>(null)
const stripLabel = computed(() => periodLabel(year.value, month.value, null))
const stripQuery = computed<Record<string, string>>(() => {
  const co = carry.value?.co
  return {
    p: periodOf(year.value, month.value),
    ...(co === 'all' || typeof co === 'number' ? { co: String(co) } : {}),
  }
})

onMounted(async () => {
  // 不带年的 overview 定默认年与上限:maxYear 只由它决定 —— 改前 overview(carry.year) 原样回传深链那年,
  // 深链 2023 进来 maxYear 就成了 2023,「下一年」按钮锁死。深链已落年时只取上限,不覆盖 overview / year。
  const o = await reconApi.overview()
  maxYear.value = o.year
  if (!year.value) { overview.value = o; year.value = o.year }
})

// 切年不清 overview(同「切月不清 data」口径),竞态守卫
let yearReq = 0
async function setYear(y: number) {
  year.value = y
  const reqId = ++yearReq
  const o = await reconApi.overview(y)
  if (reqId === yearReq) overview.value = o
}

// ── 指标条:当年 12 月聚合(户数口径) ──
const months = computed(() => overview.value?.months ?? [])
const agg = computed(() => {
  let hasData = 0, entities = 0, diff = 0, miss = 0
  for (const m of months.value) {
    if (m.hasData) hasData++
    entities += m.entityCount; diff += m.diffCount; miss += m.missCount
  }
  return { hasData, entities, diff, miss }
})

// 月卡状态:缺记红 > 差异橙 > 已配平蓝(E3 三色)
function cardColor(m: ReconMonthMeta): string {
  return m.missCount > 0 ? 'var(--hue-red)' : m.diffCount > 0 ? 'var(--hue-orange)' : 'var(--hue-blue)'
}
function cardText(m: ReconMonthMeta): string {
  if (m.diffCount === 0 && m.missCount === 0) return '已配平'
  const parts: string[] = []
  if (m.diffCount > 0) parts.push(`${m.diffCount} 户差异`)
  if (m.missCount > 0) parts.push(`${m.missCount} 户缺记`)
  return parts.join(' · ')
}

// ── ②工作台:点月进入;切月不清 data,守卫换数据 ──
let monthReq = 0
async function pickMonth(m: number) {
  month.value = m
  const reqId = ++monthReq
  const d = await reconApi.month(year.value, m)
  if (reqId === monthReq) data.value = d
}

// ── 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM 直落该月工作台,只有年 → 停在月份层;报表中心 / 期间条都走这里 ──
// 放在 setYear / pickMonth 之后:apply 同步走到 setYear 的 ++yearReq,放前面撞 let 的 TDZ。
// 本屏没有草稿(处置标记即时 upsert),不传 dirty、不接 note、不加 toast。year 初值 0 → current 报 null(不是「0 年」)。
async function applyDeep(t: DeepPeriod) {
  carry.value = t
  if (t.year !== year.value) await setYear(t.year)
  if (t.month != null) await pickMonth(t.month)
  else month.value = null
}
useDeepPeriod({
  current: () => ({ p: year.value ? periodOf(year.value, month.value) : null }),
  apply: (t) => { void applyDeep(t).catch(() => {}) },
  // current().p 在①月份层是光秃秃一个年份(深链相等判专用) —— 页签上下文按用户真实看到的来:
  // 还在选月就没有期(与三大报表同裁定,2026-09-06 T3 评审坐实本屏漏了这一道)。
  ctx: () => ({ p: year.value && month.value != null ? periodOf(year.value, month.value) : null }),
})

// 处置标记后局部更新 entities(不整页刷)
function onPatch(tenantName: string, marked: boolean, note: string | null) {
  if (!data.value) return
  data.value = {
    ...data.value,
    entities: data.value.entities.map(e =>
      e.tenantName === tenantName ? { ...e, marked, markNote: note } : e),
  }
}
</script>

<template>
  <!-- ① 月份层 -->
  <!-- fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC 迁移(月卡/指标条定列 grid 窄档降列,
       工作台见 ReconWorkbench),摘掉 base.css 的 800px 屏级地板 -->
  <template v-if="month === null">
    <!-- fp-fluid:本屏已迁移,摘 800px 屏级地板;根级 v-if 分支挂标(§8) -->
    <div v-if="overview" class="rc3 rc-page fp-fluid">
      <!-- 期间条:九张报表横跳不换期。
           不画返回钮 —— 月份层就是本屏自己的门,上面没有一层可回;换年在右边那个年份胶囊上。
           (2026-09-03 修复:合并 977af27 时 sed 反向引用把这一段写成了字面反斜杠 1,期间条随之丢失) -->
      <FPStepStrip :steps="REPORT_STEPS" current="reconciliation" :period="stripLabel"
                   :query="stripQuery" hide-back />
      <div class="rc-months-head">
        <div>
          <h2 class="rc-ptitle">收入核对</h2>
          <p class="rc-psub">按月核对:月度台账(各管理公司之和)⇄ 附表10(按期区申报)</p>
        </div>
        <span class="fin-ypill">
          <button title="上一年" @click="setYear(year - 1)"><component :is="iconFor('chevron-left')" :size="15" /></button>
          <span class="v">{{ year }}</span>
          <button :disabled="year >= maxYear" title="下一年" @click="setYear(year + 1)"><component :is="iconFor('chevron-right')" :size="15" /></button>
        </span>
      </div>

      <div class="rc-metric-strip">
        <div><div class="ml">已核对月份</div><div class="mv num">{{ agg.hasData }} / 12</div><div class="ms">{{ year }} 年</div></div>
        <div><div class="ml">核对户次</div><div class="mv num">{{ agg.entities }}</div><div class="ms">全年累计</div></div>
        <div><div class="ml">差异户次</div><div class="mv num" :class="{ 't-diff': agg.diff > 0 }">{{ agg.diff }}</div><div class="ms">两侧都有但金额不符</div></div>
        <div><div class="ml">缺记户次</div><div class="mv num" :class="{ 't-miss': agg.miss > 0 }">{{ agg.miss }}</div><div class="ms">仅一本账有记录</div></div>
      </div>

      <div class="rc-mlabel">选择核对月份</div>
      <div class="rc-month-grid">
        <template v-for="m in months" :key="m.month">
          <div v-if="!m.hasData" class="rc-mcard empty">
            <div class="mn">{{ m.month }} 月</div>
            <div class="mstate">暂无数据</div>
          </div>
          <div v-else class="rc-mcard" @click="pickMonth(m.month)">
            <div class="mn">{{ m.month }} 月</div>
            <div class="mstate" :style="{ color: cardColor(m) }">
              <span class="dot" :style="{ background: cardColor(m) }"></span>{{ cardText(m) }}
            </div>
            <div class="mfig">{{ m.entityCount }} 户 · 台账 ⇄ 附表10</div>
          </div>
        </template>
      </div>
    </div>
    <div v-else class="page-loading fp-fluid"><span class="page-spin" /></div>
  </template>

  <!-- ② 工作台 -->
  <ReconWorkbench
    v-else-if="data"
    :year="data.year"
    :month="data.month"
    :entities="data.entities"
    @back="month = null"
    @patch="onPatch"
  />

  <!-- PAGE-BEHAVIOR-SPEC §1 加载门:v-else 紧邻上方状态链(PAGE-BEHAVIOR-SPEC §1.2) -->
  <div v-else class="page-loading fp-fluid"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 recon-page-v3.js 月份层样式,--pa-* → demo3 令牌:
   ink→text-primary mute→text-muted border→border-subtle success→hue-blue
   warning→hue-orange danger→hue-red bg-soft→surface-card radius-xl→radius-xl shadow-md→shadow-md */
.rc3 { font-size: 13px; color: var(--text-primary); font-family: var(--font-sans); }
.rc3 .num { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
.rc3 .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 7px; display: inline-block; }
.rc3 .t-diff { color: var(--hue-orange); } .rc3 .t-miss { color: var(--hue-red); }

.rc-page { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; box-sizing: border-box; }
.rc-months-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 6px; }
.rc-ptitle { margin: 0; font: var(--type-h2); font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.rc-psub { margin: 4px 0 0; font-size: var(--fs-label); color: var(--text-muted); }

/* 年份胶囊(fin-ypill scoped 复刻,同 FinMonthGrid) */
.fin-ypill { display: inline-flex; align-items: center; gap: 2px; background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: var(--radius-full); padding: 3px; }
.fin-ypill button { width: 28px; height: 28px; border: none; background: transparent; border-radius: var(--radius-full); cursor: pointer; color: var(--text-secondary); display: grid; place-items: center; transition: background var(--dur-fast) var(--ease-standard); }
.fin-ypill button:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.fin-ypill button:disabled { opacity: .4; cursor: not-allowed; }
.fin-ypill .v { font-size: 13.5px; font-weight: var(--fw-semibold); color: var(--text-primary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; padding: 0 8px; white-space: nowrap; }

.rc-metric-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 36px; padding: 6px 0 20px; border-bottom: 1px solid var(--border-subtle); margin: 14px 0 20px; }
.rc-metric-strip .ml { font-size: 12px; color: var(--text-muted); margin-bottom: 7px; }
.rc-metric-strip .mv { font-size: 22px; font-weight: 600; letter-spacing: -.02em; }
.rc-metric-strip .ms { font-size: 11.5px; color: var(--text-muted); margin-top: 4px; }

.rc-mlabel { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
.rc-month-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.rc-mcard { position: relative; border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); padding: 18px 18px 16px; cursor: pointer; background: var(--surface-white); transition: transform var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard); overflow: hidden; }
.rc-mcard:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: var(--border-strong); }
.rc-mcard.empty { cursor: default; color: var(--text-muted); background: var(--surface-card); }
.rc-mcard.empty:hover { transform: none; box-shadow: none; border-color: var(--border-subtle); }
.rc-mcard .mn { font-size: 20px; font-weight: 700; }
.rc-mcard .mstate { font-size: 12px; margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; }
.rc-mcard .mfig { font-size: 11.5px; color: var(--text-muted); margin-top: 9px; font-variant-numeric: tabular-nums; font-family: var(--font-mono); }

/* ── 窄档(RESPONSIVE-LAYOUT-SPEC §1,宽档规则在前):定列 grid 按档降列 ──
   指标条 4 定列在 M 档(内容区最窄 ~475px)每格只剩 ~100px,数字与说明会互相挤;
   月卡同理:「N 户差异 · N 户缺记」一行放不下。降列是静态按档,不随内容抖动 */
@media (max-width: 960px) { /* M↓ */
  .rc-metric-strip { grid-template-columns: repeat(2, 1fr); gap: 16px 28px; }
  .rc-month-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 600px) { /* S */
  .rc-month-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
