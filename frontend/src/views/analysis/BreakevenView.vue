<script setup lang="ts">
// 盈亏平衡与敏感性(breakeven) — v2 重构(spec 2026-07-08 §二.12):AnaShell #kpis + av2 栅格;
// CVP 线(AnaEChart:收入/总成本,markPoint 保本点,markArea 盈利区;固定成本系数滑杆改动即时重算 option)
// + 敏感性龙卷风横条 + 固定/变动逐月堆叠。口径与 v1 一致(CVP 计算抽至 breakeven.logic.ts,数值不变)。
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaSkelChart from '@/components/ana/AnaSkelChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaPeriodBanner from '@/components/ana/AnaPeriodBanner.vue'
import AnaPill from '@/components/ana/AnaPill.vue'
import { iconFor } from '@/components/ds/icon'
import { STATUS, fnum } from '@/components/ana/anaFmt'
import { usePeriod, ymOf, type PeriodSel } from '@/analysis/usePeriod'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import { anaSettings, saveAnaSettings } from '@/analysis/anaSettings'
import { fetchPnlSummary, fetchS10Rows, type PnlSummary } from '@/analysis/anaData'
import type { AnalysisS10Row } from '@/api/analysis'
import { anchorMonth, calcBe, conclusionText, cvpOption, s10UsedOf, splitData, splitOption, tornadoItems, tornadoOption } from './breakeven.logic'
import '@/components/ana/ana.css'

const period = usePeriod()
const loading = ref(true)
const summary = ref<PnlSummary | null>(null)
const s10 = ref<AnalysisS10Row[]>([])

async function reload() {
  try {
    s10.value = await fetchS10Rows()
  } finally { /* s10 缺失不阻塞(敏感性因子降级) */ }
}
onMounted(reload)
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例 —— 纯读屏没有草稿要保,
// 切回来该看最新的(导入中心导完租户,回这屏必须是新名单)。
onReactivated(() => { void reload() })
// 换年在途(C5-02):旧内容留在原地退让,图不卸载;过 200ms 才亮、退场立刻
const staleShown = useDeferredFlag(loading)
// 屏上画着的那一期(C5-02 ①):换年在途时 sel.year 已是新年、summary 还是旧年 —— 这段时间口径月与横幅
// 停在上一次对得上的选择,不拿新年的月去对旧年的数(旧图会先跳到另一个口径月,再换成新年)。
// 同年内换月 / 换粒度不取数,即时跟。声明在下面那条 immediate watch 之前。
const drawnSel = ref<PeriodSel>(period.sel.value)
watch([summary, period.sel], ([s, sel]) => { if (!s || s.year === sel.year) drawnSel.value = sel })
const drawnYm = computed(() => (drawnSel.value.gran === 'month' ? ymOf(drawnSel.value.year, drawnSel.value.month) : null))
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
  const sel = drawnSel.value
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
// C6-15:拖滑杆那一次重算瞬到(图不落后手指),换年 / 换月仍走 200 形变。sliding 故意不做响应式:
// 三个 option 本就因 be 变而重算,重算发生在 onFr 触发的这次 flush 里,flush 完摘掉。
let sliding = false
// 首进占位瓦的副行(隐形):第三张的静态说明在窄瓦里折三行,其余按真副行的长度留
const KPI_HOLD = ['保本 ¥000.0万', '当月收入 ¥000.0万', '扣除随收入变动的成本后剩余(边际贡献率)', '系数 0.00(滑杆可调)', '口径月 0000-00', '口径月 0000-00']
const cvpOpt = computed(() => (be.value ? cvpOption(be.value, sliding) : {}))
const torOpt = computed(() => (be.value ? tornadoOption(tornadoItems(be.value, s10Used.value), sliding) : {}))
const split = computed(() =>
  summary.value && be.value ? splitData(summary.value.months, summary.value.cost, be.value.fr) : { periods: [], fixed: [], vari: [] })
const splitOpt = computed(() => splitOption(split.value, sliding))

// §C4 人话结论行(数据模板抽纯函数;全负空态下不显,空态提示已说清)
const conclusion = computed(() => (be.value && ymUsed.value ? conclusionText(be.value, ymUsed.value) : ''))

// 固定成本系数滑杆(spec §二.12:改动即时重算;与顶栏「目标与阈值」同源持久化)
function onFr(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  sliding = true
  saveAnaSettings({ breakevenFixedRatio: Number.isFinite(v) ? v : 0 })
  void nextTick(() => { sliding = false })
}
</script>

<template>
  <AnaShell :busy="staleShown" :kpi-hold="loading && !summary ? KPI_HOLD : 0">
    <template #kpis>
      <!-- 瓦片门只看 be:换年时旧瓦留在原位,由外壳 .anx-kpis 同拍退让 -->
      <template v-if="be">
        <AnaKpiTile label="保本收入达成率" :value="be.bePct != null ? be.bePct.toFixed(0) + '%' : '—'"
          :note="be.beRev != null ? '保本 ¥' + wan(be.beRev) + '万' : '无法保本'" />
        <AnaKpiTile label="安全边际" :value="be.safety != null ? be.safety.toFixed(0) + ' pt' : '—'"
          :note="'当月收入 ¥' + wan(be.rev) + '万'" />
        <AnaKpiTile label="收入留存率" :value="(be.cm * 100).toFixed(0) + '%'" note="扣除随收入变动的成本后剩余(边际贡献率)" />
        <AnaKpiTile label="月固定成本" :value="'¥' + wan(be.fixed) + '万'" :note="'系数 ' + be.fr.toFixed(2) + '(滑杆可调)'" />
        <AnaKpiTile label="月净利" profit :value="(be.profit >= 0 ? '¥' : '−¥') + wan(Math.abs(be.profit)) + '万'" :note="'口径月 ' + ymUsed" />
        <AnaKpiTile label="s10 开票收入" :value="s10Used ? '¥' + wan(s10Used.total) + '万' : '—'"
          :note="s10Used ? '口径月 ' + s10Used.ym : '附表10 未录入'" />
      </template>
    </template>

    <!-- 首进:版式已知就不转圈(C6-01)。块高逐块照它顶替的那块 —— 页头 44(.ak-h-ic 40 /
         标题行 20 + 4 + 副标行 20)、结论条一行 20、卡头 20(.av2-card-h 下距 8 合 28)、
         三张图 300 / 300 / 250(各自 :height 字面值,AnaSkelChart 与图同表降档)、系数滑杆一行 20。
         数据到了原地硬切,不做淡入;KPI 行由 .anx-kpis 的 min-height 94 兜位。 -->
    <!-- skel:start —— 首进骨架(与下方真版式逐块同高,改真版式的卡头 / 文字行时同步改这里;anaSkeletonParity.spec 盯着) -->
    <div v-if="loading && !summary" class="ak-page ana-skel">
      <!-- 页头、结论行、卡头照抄真版式(手机上会折行,灰条顶不住);随数据变的字换成同长的隐形占位 -->
      <div class="ak-head">
        <div class="ak-h-l"><span class="ak-h-ic"><component :is="iconFor('scale-3d')" :size="20" /></span>
          <div>
            <h2 class="ak-title">盈亏平衡与敏感性</h2>
            <p class="ak-sub">本量利(CVP)、保本收入、驱动敏感性 · 月度口径 · 口径月 <span class="ana-hole">0000-00</span></p>
          </div>
        </div>
        <AnaPill tone="warn" icon="flask-conical">拆分系数假设 · 估算值</AnaPill>
      </div>
      <div class="av2-card bev-concl"><span class="ana-hole">按当前成本结构,月收入 ≥ ¥000.0万 即保本;口径月(0000-00)收入 ¥000.0万,达成 000%</span></div>
      <div class="av2-grid">
        <div class="av2-card av2-s8">
          <div class="av2-card-h"><span class="t">保本点测算</span><span class="hint">本量利 CVP · 收入/总成本交点=保本</span></div>
          <AnaSkelChart :height="300" />
          <div class="bev-slider"><span class="k">固定成本系数</span><span class="fp-shim" style="flex: 1; height: 20px"></span><span class="k">(拖动即时重算保本点)</span></div>
        </div>
        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">哪个因素对利润影响最大</span><span class="hint">各驱动 ±10% · 龙卷风图</span></div>
          <AnaSkelChart :height="300" />
        </div>
        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">固定/变动成本拆分 · 逐月</span>
            <span class="hint"><span class="ana-hole">0000</span>年覆盖 <span class="ana-hole">00</span> 期 · 万元(预算数据未录入,替代原型预算视图)</span></div>
          <AnaSkelChart :height="250" />
        </div>
      </div>
    </div>
    <!-- skel:end -->

    <!-- 换年在途:两种内容都原地退让(C5-02),data-stale-host 常挂 —— 类摘掉后退场也是 200 -->
    <div v-else-if="!be" class="ak-page" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">
      <div class="ak-head"><div class="ak-h-l"><span class="ak-h-ic"><component :is="iconFor('scale-3d')" :size="20" /></span>
        <div><h2 class="ak-title">盈亏平衡与敏感性</h2><p class="ak-sub">期间 {{ period.label.value }}</p></div></div></div>
      <div class="ak-card">
        <AnaEmpty :label="(summary?.year ?? period.sel.value.year) + '年损益附表未录入,盈亏平衡分析不可用'"
          hint="CVP 模型依赖损益附表 s1~s5 的月度收入/成本" to="/rent-pnl" toText="去损益附表录入" />
      </div>
    </div>

    <div v-else class="ak-page" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">
      <!-- §五策略2:所选月无 pnl 覆盖回退口径月 → 显式横幅(相等不渲染;按年粒度无所选月不适用) -->
      <AnaPeriodBanner v-if="drawnYm && ymUsed && drawnYm !== ymUsed"
        :selected="drawnYm" :used="ymUsed" source="损益附表" />
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
        </div>

        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">哪个因素对利润影响最大</span><span class="hint">各驱动 ±10% · 龙卷风图</span></div>
          <!-- §五策略2:口径月无 s10 数据回退最新 s10 月 → 卡顶横幅(相等不渲染) -->
          <AnaPeriodBanner v-if="s10Used && ymUsed && s10Used.ym !== ymUsed"
            :selected="ymUsed" :used="s10Used.ym" source="附表10 " style="margin-bottom: 8px" />
          <AnaEChart :option="torOpt" :height="300" />
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
.bev-concl { display: flex; align-items: center; gap: 7px; margin-bottom: 12px; font-size: var(--fs-label); color: var(--text-primary); }
.bev-concl .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.bev-slider { display: flex; align-items: center; gap: 8px; margin: 8px 2px 2px; }
.bev-slider .k { font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; }
.bev-slider .v { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.bev-slider input[type='range'] { flex: 1; min-width: 80px; max-width: 240px; accent-color: var(--fill-blue); }
</style>
