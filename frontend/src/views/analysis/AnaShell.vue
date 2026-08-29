<script setup lang="ts">
// P3 分析层外壳(视觉 1:1 app/screen-analysis.jsx anx-* 工具条):
// 期间控制(按月/按年/年月下拉/步进,可用范围由真数据派生)+「目标与阈值」设置弹层(localStorage)。
// 期间/阈值均为模块级单例 —— 屏组件直接 import usePeriod()/anaSettings 消费,切屏不丢。
// v2(2026-07-08):工具条右侧对比开关(仅当屏传 compare 支持集才显示;useCompare 单例,屏自行
// 同支持集调 useCompare 读 mode)+ 可选 #kpis 槽(紧贴工具条下,.av2-kpis 容器)。均可选 → 现屏零改动。
// §五 期间语义(2026-07-09):periodMode 'full'(默认)|'year'(只年;**纯局部展示,不写穿粒度单例**——
// 复审:强制 setGran 会静默改写 full 屏的月/年选择,年步进走本地 stepYear)|'none'(隐期间控件,
// 改显 scopeChip 口径徽章)。均可选 → 未传屏零变化。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { iconFor } from '@/components/ds/icon'
import { fetchAvailableMonths } from '@/analysis/anaData'
import { providePeriodMonths, usePeriod } from '@/analysis/usePeriod'
import { anaSettings, resetAnaSettings, saveAnaSettings } from '@/analysis/anaSettings'
import { useCompare, type CompareMode } from '@/analysis/useCompare'
import AnaPill from '@/components/ana/AnaPill.vue'
import '@/components/ana/ana.css'
import Select from '@/components/ds/Select.vue'

const props = defineProps<{
  compare?: CompareMode[]                 // 屏声明的对比支持集(不传 = 不显示开关)
  periodMode?: 'full' | 'year' | 'none'   // 期间语义(不传 = 'full' 零变化)
  scopeChip?: string                      // periodMode='none' 时的口径徽章文案
}>()

const pmode = computed(() => props.periodMode ?? 'full')

// 对比开关(支持集为屏静态声明,挂载时定死)
const CMP_MODES: CompareMode[] = ['none', 'mom', 'yoy', 'budget']
const CMP_LABEL: Record<CompareMode, string> = { none: '无', mom: '环比', yoy: '同比', budget: '预算' }
const CMP_TIP: Record<CompareMode, string> = { none: '', mom: '本屏不支持环比', yoy: '本屏不支持同比(2024 无月度数据)', budget: '本屏不支持预算对比(无预算基准)' }
const cmp = props.compare ? useCompare(props.compare) : null

const period = usePeriod()
const loaded = ref(false)
const asof = computed(() => period.months.value[period.months.value.length - 1] ?? '—')

onMounted(async () => {
  try {
    const dto = await fetchAvailableMonths()
    providePeriodMonths(dto.months, dto.sources?.pnl)   // 默认期落「最近有损益数据的月」,非全局最新空月
  } finally {
    loaded.value = true
  }
})

// 'year' 屏年步进(本地,不动 gran 单例;屏只读 sel.year,与粒度无关)
const yearIdx = computed(() => period.years.value.indexOf(period.sel.value.year))
const yAtStart = computed(() => yearIdx.value <= 0)
const yAtEnd = computed(() => yearIdx.value < 0 || yearIdx.value >= period.years.value.length - 1)
function stepYear(dir: 1 | -1) {
  const ys = period.years.value
  if (!ys.length) return
  const ni = Math.min(ys.length - 1, Math.max(0, (yearIdx.value < 0 ? ys.length - 1 : yearIdx.value) + dir))
  period.setYear(ys[ni])
}

// ── 设置弹层 ──
// 点外关闭/Esc 三段照 ds/Popover.vue(UI-OVERLAY-SPEC §4)。这里没换成 Popover 组件:
// 面板外观全在 scoped .anx-pop(268px/圆角 14/自定阴影/top 42px/z-index 30),Popover 的
// 面板 div 不吃父组件 scoped class,换过去要把这些改写成内联 style 对象,视觉会漂。
const pop = ref(false)
const popRoot = ref<HTMLElement | null>(null)

function onDoc(e: MouseEvent) {
  if (popRoot.value && !popRoot.value.contains(e.target as Node)) pop.value = false
}
function onKey(e: KeyboardEvent) {
  // Esc 只关本弹层:不阻断传播的话,宿主(监听 window keydown 的抽屉/弹窗)会跟着一起关
  if (e.key === 'Escape') { e.stopPropagation(); pop.value = false }
}
// 第三参 true = capture 阶段。本弹层的触发按钮与面板自带 @click.stop,宿主容器也普遍带
// .stop(FPDrawer.vue:33 的 <div class="fp-dwr" @mousedown.stop>),冒泡阶段的 document
// 监听在这些容器内收不到事件,点外关闭会整条失效;capture 先于 .stop 派发。
// 注销必须同样带 true —— 不带移不掉 capture 监听,会泄漏。
watch(pop, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
  } else {
    document.removeEventListener('mousedown', onDoc, true)
    document.removeEventListener('keydown', onKey, true)
  }
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDoc, true)
  document.removeEventListener('keydown', onKey, true)
})

function onNum(key: 'occTarget' | 'collectTarget' | 'churnTh' | 'breakevenFixedRatio' | 'pvInvestment' | 'spikeTh', e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  saveAnaSettings({ [key]: Number.isFinite(v) ? v : 0 })
}
</script>

<template>
  <!-- fp-fluid:分析层已按 RESPONSIVE-LAYOUT-SPEC §5.2 迁移(av2 两列 KPI/工具条两行/图高降档),
       在屏根摘掉 base.css 的 800px 屏级地板;18+1 屏全部以本壳为根,一处摘全层。 -->
  <div class="anx-shell fp-fluid">
    <div class="anx-tools">
      <!-- 期间控制('none' 整体隐藏,改显 scopeChip 口径徽章;'year' 隐藏粒度切换与月下拉) -->
      <div v-if="pmode !== 'none'" class="anx-period">
        <span class="anx-lbl"><component :is="iconFor('calendar')" :size="14" />期间</span>
        <div v-if="pmode === 'full'" class="anx-seg">
          <button :class="{ on: period.sel.value.gran === 'month' }" @click="period.setGran('month')">按月</button>
          <button :class="{ on: period.sel.value.gran === 'year' }" @click="period.setGran('year')">按年</button>
        </div>
        <!-- 期间年/月:ds/Select。改前是原生 <select> 把**触发器**画成了药丸+自绘箭头,
             但点开的**面板由操作系统渲染**,CSS 管不到 —— 用户从抄表屏(ds/Select,白底圆角浮层带对勾)
             切到任一分析屏,同样是「选年月」却是两个控件。本组件被 18 个分析屏共用,故改这一处 = 18 屏受益。
             宽度按 LIST-PAGE-SPEC §2 的 110 / 92px(给窄了会把「2024年」截成「202…」)。 -->
        <div class="anx-selw" style="width: 110px">
          <Select size="sm" :disabled="!period.years.value.length"
                  :options="period.years.value.map(y => ({ value: String(y), label: `${y}年` }))"
                  :model-value="String(period.sel.value.year)"
                  @update:model-value="period.setYear(+$event)" />
        </div>
        <div v-if="pmode === 'full' && period.sel.value.gran === 'month'" class="anx-selw" style="width: 92px">
          <Select size="sm" :disabled="!period.years.value.length"
                  :options="period.monthNumsOf(period.sel.value.year).map(m => ({ value: String(m), label: `${m}月` }))"
                  :model-value="String(period.sel.value.month)"
                  @update:model-value="period.setMonth(+$event)" />
        </div>
        <div class="anx-nav">
          <button :disabled="pmode === 'year' ? yAtStart : period.atStart.value"
            @click="pmode === 'year' ? stepYear(-1) : period.step(-1)"><component :is="iconFor('chevron-left')" :size="15" /></button>
          <button :disabled="pmode === 'year' ? yAtEnd : period.atEnd.value"
            @click="pmode === 'year' ? stepYear(1) : period.step(1)"><component :is="iconFor('chevron-right')" :size="15" /></button>
        </div>
      </div>
      <div v-else-if="scopeChip" style="display: inline-flex; align-items: center; gap: 8px">
        <span class="anx-lbl"><component :is="iconFor('calendar')" :size="14" />口径</span>
        <AnaPill>{{ scopeChip }}</AnaPill>
      </div>

      <!-- 屏自定工具扩展位 -->
      <slot name="tools" />

      <div class="anx-right">
        <!-- v2 对比开关(仅屏声明支持集时显示;不支持项禁用+title 说明) -->
        <div v-if="cmp" class="anx-cmp">
          <span class="anx-lbl">对比</span>
          <div class="anx-seg" role="group" aria-label="对比开关">
            <button
              v-for="m in CMP_MODES" :key="m"
              :class="{ on: cmp.mode.value === m }"
              :disabled="m !== 'none' && !cmp.supported.includes(m)"
              :title="m !== 'none' && !cmp.supported.includes(m) ? CMP_TIP[m] : undefined"
              @click="cmp.set(m)"
            >{{ CMP_LABEL[m] }}</button>
          </div>
        </div>
        <!-- ≤600 缩「数据截至」为「截至」:CSS 藏前缀 span,不引 JS 档位分支(jsdom 无
             matchMedia,模板换词要么恒桌面要么加分支;藏字则测试 text() 口径不变)。 -->
        <span class="anx-lbl"><component :is="iconFor('clock')" :size="12" /><span class="anx-asof-prefix">数据</span>截至 {{ asof }}</span>
        <div ref="popRoot" style="position: relative">
          <button class="anx-icobtn" :class="{ on: pop }" title="目标与阈值" @click.stop="pop = !pop">
            <component :is="iconFor('sliders-horizontal')" :size="16" />
          </button>
          <div v-if="pop" class="anx-pop" @click.stop>
            <h4>目标与阈值</h4>
            <div class="anx-fld"><label>出租率目标 (%)</label>
              <input type="number" min="50" max="100" :value="anaSettings.occTarget" @change="onNum('occTarget', $event)" /></div>
            <div class="anx-fld"><label>收缴率目标 (%)</label>
              <input type="number" min="50" max="100" :value="anaSettings.collectTarget" @change="onNum('collectTarget', $event)" /></div>
            <div class="anx-fld"><label>风险线/流失预警 (分)</label>
              <input type="number" min="30" max="90" :value="anaSettings.churnTh" @change="onNum('churnTh', $event)" /></div>
            <div class="anx-fld"><label>能耗突变阈值 (%)</label>
              <input type="number" min="10" max="200" :value="anaSettings.spikeTh" @change="onNum('spikeTh', $event)" /></div>
            <div class="anx-fld"><label>固定成本占比</label>
              <input type="number" min="0" max="1" step="0.01" :value="anaSettings.breakevenFixedRatio" @change="onNum('breakevenFixedRatio', $event)" /></div>
            <div class="anx-fld"><label>光伏投资 (万)</label>
              <input type="number" min="0" :value="anaSettings.pvInvestment" @change="onNum('pvInvestment', $event)" /></div>
            <div style="display: flex; justify-content: space-between; margin-top: 4px">
              <button class="anx-link" @click="resetAnaSettings()">恢复默认</button>
              <button class="anx-link" style="color: var(--text-primary); font-weight: 600" @click="pop = false">完成</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- v2 可选 KPI 条(紧贴工具条下,.av2-kpis 栅格容器;不传槽 = 零渲染)
         §6.4:容器**不得**被 loaded 门整条挡掉——它一插入就把下方全部内容整体下推(16 屏中招)。
         这里直接放开门(不再判 loaded),依据:loaded 只表示 fetchAvailableMonths 完成,与各屏自己的
         数据就绪无关(且该请求走 anaData cached,二次进屏几乎立即 true),所以各屏 #kpis 早就要在
         「本屏数据未到」时渲染一遍——瓦片绑定本来就是 null-safe(atPeriod/colPick 等返回 null → 显 '—'),
         不会出 NaN/undefined。高度稳定另由 .anx-kpis 的 min-height 兜(见下)。 -->
    <div v-if="$slots.kpis" class="anx-kpis av2-kpis"><slot name="kpis" /></div>

    <div class="anx-body">
      <div v-if="!loaded" class="page-loading"><span class="page-spin" /></div>
      <slot v-else />
    </div>
  </div>
</template>

<style scoped>
/* anx-* 移植 app/screen-analysis.jsx AnaBarStyles(仅本层用,DS 令牌) */
.anx-shell { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 100%; }
.anx-tools { position: sticky; top: 0; z-index: 20; flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 9px 18px; border-bottom: 1px solid var(--divider); flex-wrap: wrap; background: var(--surface-overlay); backdrop-filter: blur(8px); }
.anx-body { flex: 1; min-height: 0; padding: 24px; box-sizing: border-box; }
.anx-lbl { font-size: var(--fs-micro); color: var(--text-muted); display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.anx-link { border: none; background: transparent; color: var(--text-link); font-size: var(--fs-micro); cursor: pointer; font-family: var(--font-sans); display: inline-flex; align-items: center; gap: 3px; }
.anx-icobtn { width: 34px; height: 34px; border-radius: 10px; border: 1px solid var(--border-subtle); background: var(--surface-white); color: var(--text-secondary); cursor: pointer; display: grid; place-items: center; transition: background var(--dur-fast), color var(--dur-fast); position: relative; }
.anx-icobtn:hover, .anx-icobtn.on { background: var(--bg-hover); color: var(--text-primary); }

/* .anx-seg 已迁往全局 components/ana/ana.css:它同时被 #tools 插槽里的子屏用,
   scoped 样式不透传插槽内容(插槽带的是宿主屏的 data-v),留在这里子屏那份会变成裸原生按钮。 */
/* min-height = 12(本容器 padding-top)+ 82.9(一行 .av2-kpi 瓦片实高)≈ 94,取整向下,
   保证「常驻空条 → 瓦片填入」零位移,且加载完成后 min-height 永不生效(不多占一个像素)。
   瓦片 82.9 的来源(AnaKpiTile.vue,box-sizing:border-box 但高度 auto 故边框外加):
   padding 10+10 + .l 20(line-height 继承 --lh-snug:20px)+ gap 3 + .vr 20(.v 行盒 20 / .spk 20 取大)
   + gap 3 + .d 14.85(11px × line-height 1.35)+ 边框 1×2 = 82.85。
   ⚠ 改瓦片 padding / 字号 / 行高时必须回来同步这个数,否则重新出现撑开或多余留白。
   窄屏 auto-fit 换行成两行属响应式,不算抖动,故只保一行的量。
   2026-08-20 同步过一次:边框 0.5→1px(0.5px 在非整数 DPR 下渲染不稳)、副行 10.5→11px
   (中文可读性下限),两项合计 +1.65px,故 93 → 94。
   S 档 .av2-kpis 定两列(ana.css §5.2 块)与 auto-fit 换行同理:行数是「视口档 × 瓦片数」的
   静态函数,挂载即终态,min-height 仍只须兜一行的量——多行自然超过下限,不必随档改值。 */
.anx-kpis { flex: 0 0 auto; padding: 12px 24px 0; min-height: 94px; }
.anx-selw { flex: 0 0 auto; }
/* 工具条三个分组(改前是内联 style——媒体查询盖不住内联,M/S 收纳只能先收编成类;数值照抄零变化) */
.anx-period { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.anx-cmp { display: inline-flex; align-items: center; gap: 8px; }
.anx-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.anx-nav { display: inline-flex; gap: 2px; }
.anx-nav button { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--border-subtle); background: var(--surface-white); color: var(--text-secondary); cursor: pointer; display: grid; place-items: center; }
.anx-nav button:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.anx-nav button:disabled { opacity: .4; cursor: default; }
.anx-pop { position: absolute; top: 42px; right: 0; z-index: 30; background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: 14px; box-shadow: 0 8px 28px rgba(28,28,28,.16); padding: 16px; width: 268px; }
.anx-pop h4 { margin: 0 0 12px; font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); }
.anx-fld { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.anx-fld label { font-size: 12px; color: var(--text-secondary); }
.anx-fld input { width: 74px; font-family: var(--font-mono); font-size: var(--fs-label); text-align: right; border: 1px solid var(--border-subtle); border-radius: 8px; padding: 5px 8px; outline: none; }
.anx-fld input:focus { border-color: var(--border-strong); }
/* M/S(≤960,§5.2):工具条收进两行,且行组成静态确定——右侧组 flex-basis:100% 恒占第二行,
   不靠内容宽度自然换行(那会随 asof 文案/对比开关有无在一行两行间跳,sticky 条高度也跟着跳)。
   右对齐由 justify-content 接手(占满整行后 margin-left:auto 失效)。 */
@media (max-width: 960px) {
  .anx-tools { gap: 6px 8px; }
  .anx-period { gap: 6px; }
  .anx-right { flex-basis: 100%; justify-content: flex-end; gap: 8px; }
}
/* S(≤600):期间行按 390 视口做减法(可用宽 390−12×2=366)。定宽项全是确定值:
   seg 88(CJK 24×2+padding 16×2+缝 2+框 6)+ 年 110 + 月 92(LIST-PAGE-SPEC §2 下限,
   ≤600 下 Select 字号升 16px 防 iOS 聚焦缩放,再窄必截)+ 步进 58 + 缝 15 = 363。
   为此隐掉「期间/对比」字样(控件自明)——「数据截至」是数据信息,保留。
   seg 收窄只动本组件模板里的两条(scoped 带 data-v),#tools 插槽/卡头 mini seg 不受影响。 */
@media (max-width: 600px) {
  .anx-tools { padding: 9px 12px; }
  .anx-period { gap: 5px; }
  .anx-period > .anx-lbl, .anx-cmp > .anx-lbl { display: none; }
  .anx-tools .anx-seg button { padding: 5px 8px; }
  .anx-right { gap: 6px; }
  /* §06 第二行(.anx-right,≤960 已定死 flex-basis:100%)组成固定:对比 seg + 截至 + 设置钮。
     「数据」二字藏掉省 ~22px(390 预算下对比四钮 + 截至 + 34 钮 ≈ 300,留余量);
     行高由行内 34px 设置钮恒定撑住,文案增减不改行数、不跳高度。 */
  .anx-asof-prefix { display: none; }
  /* §06 弹层钳视口:锚点(设置钮)右缘距视口右 ≥12(工具条 padding),右对齐 + 宽不超
     min(268px,92vw) ⇒ 左缘在 ≥280px 视口内恒 ≥0,无需 JS 测溢出改位。top:42 沿用基档。 */
  .anx-pop { width: min(268px, 92vw); }
}
@media print { .anx-tools { display: none !important; } .anx-body { padding: 0; } }
</style>
