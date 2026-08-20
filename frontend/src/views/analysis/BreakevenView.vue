<script setup lang="ts">
// 盈亏平衡与敏感性(breakeven) — v2 重构(spec 2026-07-08 §二.12):AnaShell #kpis + av2 栅格;
// CVP 线(AnaEChart:收入/总成本,markPoint 保本点,markArea 盈利区;固定成本系数滑杆改动即时重算 option)
// + 敏感性龙卷风横条 + 固定/变动逐月堆叠。口径与 v1 一致(CVP 计算抽至 breakeven.logic.ts,数值不变)。
import { computed, onMounted, ref, watch } from 'vue'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaPeriodBanner from '@/components/ana/AnaPeriodBanner.vue'
import AnaPill from '@/components/ana/AnaPill.vue'
import { iconFor } from '@/components/ds/icon'
import { STATUS, fnum } from '@/components/ana/anaFmt'
import { usePeriod } from '@/analysis/usePeriod'
import { anaSettings, saveAnaSettings } from '@/analysis/anaSettings'
import { fetchPnlSummary, fetchS10Rows, type PnlSummary } from '@/analysis/anaData'
import type { AnalysisS10Row } from '@/api/analysis'
import { anchorMonth, calcBe, conclusionText, cvpOption, s10UsedOf, splitData, splitOption, tornadoItems, tornadoOption } from './breakeven.logic'
import '@/components/ana/ana.css'

const period = usePeriod()
const loading = ref(true)
const summary = ref<PnlSummary | null>(null)
const s10 = ref<AnalysisS10Row[]>([])

onMounted(async () => {
  try {
    s10.value = await fetchS10Rows()
  } finally { /* s10 缺失不阻塞(敏感性因子降级) */ }
})
let token = 0   // 年切竞态守卫(范式同 FinPnlView):过期响应弃写
watch(() => period.sel.value.year, async (y) => {
  if (!y) return   // usePeriod 初始化前 year=0:不发 /pnl/*/0(后端年份门必 400,复审)
  const t = ++token
  loading.value = true
  try {
    const sum = await fetchPnlSummary(y)
    if (t === token) summary.value = sum
  } catch { if (t === token) summary.value = null /* 拉失败清空→空态,禁止新年份标签配旧年数值(审计4对齐) */ } finally {
    if (t === token) loading.value = false
  }
}, { immediate: true })

const wan = (v: number) => fnum(v / 10000, 1)

// ── 口径月(§C4):选中月有 pnl 覆盖用选中月,否则退最近一个收入>0 的覆盖月;全负维持最新+主区空态 ──
const anchor = computed(() => {
  const s = summary.value
  if (!s) return { month: null, allNegative: false }
  const sel = period.sel.value
  return anchorMonth(s.months, s.revenue, sel.gran === 'month' && sel.year === s.year ? sel.month : null)
})
const monthUsed = computed(() => anchor.value.month)
const ymUsed = computed(() =>
  summary.value && monthUsed.value != null ? summary.value.year + '-' + String(monthUsed.value).padStart(2, '0') : null)

// ── CVP 模型(月度口径;系数滑杆/顶栏改动 → anaSettings 响应式即时重算) ──
const be = computed(() => {
  const s = summary.value, m = monthUsed.value
  if (!s || m == null) return null
  return calcBe(s.revenue[m - 1] ?? 0, s.cost[m - 1] ?? 0, anaSettings.breakevenFixedRatio)
})
const s10Used = computed(() => s10UsedOf(s10.value, ymUsed.value))

// ── ECharts option(be/s10Used 变 → 即时重算) ──
const cvpOpt = computed(() => (be.value ? cvpOption(be.value) : {}))
const torOpt = computed(() => (be.value ? tornadoOption(tornadoItems(be.value, s10Used.value)) : {}))
const split = computed(() =>
  summary.value && be.value ? splitData(summary.value.months, summary.value.cost, be.value.fr) : { periods: [], fixed: [], vari: [] })
const splitOpt = computed(() => splitOption(split.value))

// §C4 人话结论行(数据模板抽纯函数;全负空态下不显,空态提示已说清)
const conclusion = computed(() => (be.value && ymUsed.value ? conclusionText(be.value, ymUsed.value) : ''))

// 固定成本系数滑杆(spec §二.12:改动即时重算;与顶栏「目标与阈值」同源持久化)
function onFr(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  saveAnaSettings({ breakevenFixedRatio: Number.isFinite(v) ? v : 0 })
}
</script>

<template>
  <AnaShell>
    <template #kpis>
      <template v-if="!loading && be">
        <AnaKpiTile label="保本收入达成率" :value="be.bePct != null ? be.bePct.toFixed(0) + '%' : '—'"
          :note="be.beRev != null ? '保本 ¥' + wan(be.beRev) + '万' : '无法保本'" />
        <AnaKpiTile label="安全边际" :value="be.safety != null ? be.safety.toFixed(0) + ' pt' : '—'"
          :note="'当月收入 ¥' + wan(be.rev) + '万'" />
        <AnaKpiTile label="收入留存率" :value="(be.cm * 100).toFixed(0) + '%'" note="扣除随收入变动的成本后剩余(边际贡献率)" />
        <AnaKpiTile label="月固定成本" :value="'¥' + wan(be.fixed) + '万'" :note="'系数 ' + be.fr.toFixed(2) + '(滑杆可调)'" />
        <AnaKpiTile label="月净利" :value="(be.profit >= 0 ? '¥' : '−¥') + wan(Math.abs(be.profit)) + '万'" :note="'口径月 ' + ymUsed" />
        <AnaKpiTile label="s10 开票收入" :value="s10Used ? '¥' + wan(s10Used.total) + '万' : '—'"
          :note="s10Used ? '口径月 ' + s10Used.ym : '附表10 未录入'" />
      </template>
    </template>

    <div v-if="loading" class="page-loading"><span class="page-spin" /></div>

    <div v-else-if="!be" class="ak-page">
      <div class="ak-head"><div class="ak-h-l"><span class="ak-h-ic"><component :is="iconFor('scale-3d')" :size="20" /></span>
        <div><h2 class="ak-title">盈亏平衡与敏感性</h2><p class="ak-sub">期间 {{ period.label.value }}</p></div></div></div>
      <div class="ak-card">
        <AnaEmpty :label="period.sel.value.year + '年损益附表未录入,盈亏平衡分析不可用'"
          hint="CVP 模型依赖损益附表 s1~s5 的月度收入/成本" to="/rent-pnl" toText="去损益附表录入" />
      </div>
    </div>

    <div v-else class="ak-page">
      <!-- §五策略2:所选月无 pnl 覆盖回退口径月 → 显式横幅(相等不渲染;按年粒度无所选月不适用) -->
      <AnaPeriodBanner v-if="period.ym.value && ymUsed && period.ym.value !== ymUsed"
        :selected="period.ym.value" :used="ymUsed" source="损益附表" />
      <div class="ak-head">
        <div class="ak-h-l"><span class="ak-h-ic"><component :is="iconFor('scale-3d')" :size="20" /></span>
          <div>
            <h2 class="ak-title">盈亏平衡与敏感性</h2>
            <p class="ak-sub">本量利(CVP)、保本收入、驱动敏感性 · 月度口径 · 口径月 {{ ymUsed }}</p>
          </div>
        </div>
        <AnaPill tone="warn" icon="flask-conical">拆分系数假设 · 估算值</AnaPill>
      </div>

      <!-- §C4 人话结论行(数据模板,仿驾驶舱 cv2-concl 简化版;保本无解走替代句) -->
      <div v-if="conclusion && !anchor.allNegative" class="av2-card bev-concl">
        <span class="dot" :style="{ background: be.bePct != null ? STATUS.good.color : STATUS.watch.color }"></span>{{ conclusion }}
      </div>

      <!-- §C4 全负空态:各覆盖月收入均≤0,口径月维持最新覆盖月,不画倒挂 CVP -->
      <div v-if="anchor.allNegative" class="ak-card">
        <AnaEmpty label="当前各覆盖月收入均为负,保本测算不适用"
          :hint="'口径月维持最新覆盖月 ' + ymUsed + ';CVP 模型需收入为正才能求保本点'" />
      </div>

      <div v-else class="av2-grid">
        <div class="av2-card av2-s8">
          <div class="av2-card-h"><span class="t">保本点测算</span><span class="hint">本量利 CVP · 收入/总成本交点=保本</span></div>
          <AnaEChart :option="cvpOpt" :height="300" />
          <div class="bev-slider">
            <span class="k">固定成本系数</span>
            <input type="range" min="0" max="1" step="0.01" :value="anaSettings.breakevenFixedRatio" @input="onFr" />
            <span class="v mono">{{ be.fr.toFixed(2) }}</span>
            <span class="k">(拖动即时重算保本点)</span>
          </div>
          <AnaMethodNote>面积/出租率未录入,横轴由原型「出租率」改造为「收入达成率」(当月收入=100%);
            收入线 = 收入 × 达成率,成本线 = 固定成本 + 变动成本 × 达成率。</AnaMethodNote>
        </div>

        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">哪个因素对利润影响最大</span><span class="hint">各驱动 ±10% · 龙卷风图</span></div>
          <!-- §五策略2:口径月无 s10 数据回退最新 s10 月 → 卡顶横幅(相等不渲染) -->
          <AnaPeriodBanner v-if="s10Used && ymUsed && s10Used.ym !== ymUsed"
            :selected="ymUsed" :used="s10Used.ym" source="附表10 " style="margin-bottom: 8px" />
          <AnaEChart :option="torOpt" :height="300" />
          <AnaMethodNote>各驱动单独 ±10% 对月净利的影响(其余不变);红=下行、蓝=上行。基于固定/变动成本
            {{ (be.fr * 100).toFixed(0) }}/{{ (100 - be.fr * 100).toFixed(0) }} 拆分假设(滑杆或顶栏「目标与阈值」可调),仅供敏感性排序。</AnaMethodNote>
        </div>

        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">固定/变动成本拆分 · 逐月</span>
            <span class="hint">{{ summary!.year }}年覆盖 {{ split.periods.length }} 期 · 万元(预算数据未录入,替代原型预算视图)</span></div>
          <AnaEChart :option="splitOpt" :height="250" />
        </div>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
/* §C4 人话结论行(仿驾驶舱 cv2-concl 简化版:单句单圆点) */
.bev-concl { display: flex; align-items: center; gap: 7px; margin-bottom: 12px; font-size: 12.5px; color: var(--text-primary); }
.bev-concl .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.bev-slider { display: flex; align-items: center; gap: 8px; margin: 8px 2px 2px; }
.bev-slider .k { font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }
.bev-slider .v { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.bev-slider input[type='range'] { flex: 1; min-width: 80px; max-width: 240px; accent-color: var(--fill-blue); }
</style>
