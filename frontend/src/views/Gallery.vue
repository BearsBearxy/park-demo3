<template>
  <div class="gallery fp-scroll">
    <h1 class="gallery__title">Design System Gallery</h1>
    <p v-if="componentNames.length === 0" class="gallery__empty">
      No components yet — add <code>.vue</code> files to <code>src/components/ds/</code>.
    </p>
    <div v-else class="gallery__grid">
      <div
        v-for="name in componentNames"
        :key="name"
        class="gallery__cell"
      >
        <p class="gallery__label">{{ name }}</p>
        <component :is="mods[name]" />
      </div>
    </div>

    <!-- P3 分析图表冒烟段:每图一个静态样例(纯展示,真数据绑定在 analysis 屏) -->
    <h1 class="gallery__title" style="margin-top: var(--space-10)">分析图表(ana)</h1>
    <div class="gallery__grid">
      <div class="gallery__cell">
        <p class="gallery__label">AnaStatBar</p>
        <AnaStatBar :items="[
          { label: '均值', value: '128.4' }, { label: 'σ', value: '12.1' },
          { label: '环比', value: '+3.2%', delta: 3.2 }, { label: '峰值', value: '156.0', note: '10月' }]" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaBoxPlot</p>
        <AnaBoxPlot :groups="[
          { name: '一期', values: [12, 15, 18, 22, 25, 30, 14] },
          { name: '二期', values: [20, 24, 26, 30, 35, 28, 22] },
          { name: '三期', values: [8, 10, 12, 15, 11, 9, 14] }]" unit="元" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaWaterfall</p>
        <AnaWaterfall :items="[
          { name: '收入', value: 598, type: 'start' },
          { name: '成本', value: -378, type: 'dec' },
          { name: '其他', value: 42, type: 'inc' },
          { name: '损益', value: 262, type: 'end' }]" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaRadar</p>
        <AnaRadar :axes="['出租率', '租金', '收缴', '规模', '能效']" :series="[
          { name: '一期', color: 'rgb(120,140,176)', values: [88, 72, 95, 80, 66] },
          { name: '二期', color: 'rgb(129,174,232)', values: [92, 85, 90, 95, 70] }]" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaScatter</p>
        <AnaScatter :points="[
          { x: 1200, y: 10.5, r: 3, label: '甲' }, { x: 2400, y: 12.6, r: 6, label: '乙' },
          { x: 800, y: 15.8, r: 2, label: '丙' }, { x: 3600, y: 9.8, r: 8, label: '丁' }]"
          x-label="面积" y-label="强度" :benchmark="{ y: 12.2 }" :height="220" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaDeviationBars</p>
        <AnaDeviationBars :items="[
          { name: '甲公司', value: 132 }, { name: '乙公司', value: 96 }, { name: '丙公司', value: 118 }]"
          :mean="110" :std="14" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaSparkGrid</p>
        <AnaSparkGrid :cols="2" :items="[
          { name: '道路照明', series: [22, 25, 24, 28, 26, 30], cur: 30, mom: 15.4 },
          { name: '公共办公', series: [20, 19, 21, 22, 20, 21], cur: 21, mom: 5.0 },
          { name: '给排水泵', series: [14, 15, 13, 16, 15, 14], cur: 14, mom: -6.7 },
          { name: '电梯', series: [12, 12, 13, 12, 11, 12], cur: 12, mom: 9.1 }]" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaBullet</p>
        <AnaBullet :rows="[
          { name: '一期', value: 88 }, { name: '二期', value: 95 }, { name: '三期', value: 72 }]"
          :target="90" :max="100" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaStackedCols(stack)</p>
        <AnaStackedCols :periods="['1月', '2月', '6月']" :series="[
          { name: '租金', color: 'rgb(120,140,176)', values: [514, 480, 530] },
          { name: '用电', color: 'rgb(129,174,232)', values: [116, 130, 180] },
          { name: '其他', color: 'rgb(196,226,244)', values: [80, 74, 90] }]" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaStackedCols(group)</p>
        <AnaStackedCols mode="group" :periods="['一期', '二期', '三期']" :series="[
          { name: '收入', color: 'rgb(120,140,176)', values: [200, 346, 51] },
          { name: '成本', color: 'rgb(196,226,244)', values: [182, 155, 40] }]" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaRatioArc</p>
        <div style="display: flex; gap: 12px; flex-wrap: wrap">
          <AnaRatioArc :value="0.62" label="资产负债率" sub="负债/资产" tone="warn" />
          <AnaRatioArc :value="1.85" :max="3" label="流动比率" sub="流动资产/负债" />
        </div>
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaTrend</p>
        <AnaTrend :labels="['1月', '2月', '3月', '4月', '5月', '6月']"
          :cur="[420, 435, 460, 452, 480, 505]" :prev="[400, 410, 420, 430, 428, 440]" :height="160" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaMoMBars</p>
        <AnaMoMBars :labels="['1月', '2月', '3月', '4月', '5月', '6月']" :series="[420, 435, 410, 452, 480, 470]" :height="120" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaHeatmap</p>
        <AnaHeatmap :cols="['1月', '2月', '3月', '4月']" :rows="[
          { name: '租金', values: [5, 8, -3, 12] },
          { name: '用电', values: [-6, 4, 9, -2] },
          { name: '运管', values: [2, -1, 3, 6] }]" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaStatTile / AnaMetricStrip</p>
        <AnaStatTile icon="gauge" label="月度收入" value="¥598.0万" status="good" :yoy="6.2" :mom="1.8"
          tint="slate" :cur="[420, 435, 460, 452, 480, 505]" />
        <div style="height: 12px"></div>
        <AnaMetricStrip :items="[
          { label: '收入', value: '¥598万', delta: 6.2, deltaKind: '同比' },
          { label: '成本', value: '¥378万', delta: 2.1, invert: true, deltaKind: '同比' }]" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaVerdictBanner / AnaInsightHero</p>
        <AnaVerdictBanner :verdict="{ level: 'good', headline: '经营整体平稳', points: [
          { tone: 'good', text: '收入同比 +6.2%' }, { tone: 'watch', text: '收缴率低于目标' }] }" asof="2025-10" />
        <div style="height: 12px"></div>
        <AnaInsightHero label="园区总损益" value="¥220.3万" status="good" :yoy="19.2"
          headline="10月损益创年内新高,租金与用电双驱动。"
          :read="[{ tone: 'good', text: '租金损益 +19.2%' }, { tone: 'risk', text: '水费损益转负' }]" />
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaAnomalyCard / AnaBarRow / 标签徽章</p>
        <AnaAnomalyCard :a="{ id: 'x1', sev: 'watch', type: '收缴率', metric: '低于阈值', title: '乙公司 10月收缴率 82%', detail: '低于目标 96%,应收 ¥12.4万未收', value: '82%' }" />
        <div style="height: 12px"></div>
        <AnaBarRow name="一期" :value="88" :target="90" :delta="1.2" />
        <div style="height: 12px; display: flex; gap: 8px"></div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
          <AnaTag :tag="{ text: '近6期新高', tone: 'good' }" />
          <AnaPill tone="warn" icon="alert-triangle">口径:两期覆盖</AnaPill>
          <AnaStatusPill level="risk" />
        </div>
        <AnaMethodNote>示例:评分由收缴/用能/临期三信号加权。</AnaMethodNote>
      </div>
      <div class="gallery__cell">
        <p class="gallery__label">AnaEmpty(数据待录入空态)</p>
        <AnaEmpty label="合同起止日期未录入" hint="到期时间轴需要合同 start/end 日期" to="/contracts" to-text="去合同管理补录" />
      </div>
      <div class="gallery__cell" style="grid-column: 1 / -1">
        <p class="gallery__label">FigLineChart</p>
        <FigLineChart :model="figModel" title="营收趋势(样例)" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AnaStatBar from '@/components/ana/AnaStatBar.vue'
import AnaBoxPlot from '@/components/ana/AnaBoxPlot.vue'
import AnaWaterfall from '@/components/ana/AnaWaterfall.vue'
import AnaRadar from '@/components/ana/AnaRadar.vue'
import AnaScatter from '@/components/ana/AnaScatter.vue'
import AnaDeviationBars from '@/components/ana/AnaDeviationBars.vue'
import AnaSparkGrid from '@/components/ana/AnaSparkGrid.vue'
import AnaBullet from '@/components/ana/AnaBullet.vue'
import AnaStackedCols from '@/components/ana/AnaStackedCols.vue'
import AnaRatioArc from '@/components/ana/AnaRatioArc.vue'
import AnaTrend from '@/components/ana/AnaTrend.vue'
import AnaMoMBars from '@/components/ana/AnaMoMBars.vue'
import AnaHeatmap from '@/components/ana/AnaHeatmap.vue'
import AnaStatTile from '@/components/ana/AnaStatTile.vue'
import AnaMetricStrip from '@/components/ana/AnaMetricStrip.vue'
import AnaVerdictBanner from '@/components/ana/AnaVerdictBanner.vue'
import AnaInsightHero from '@/components/ana/AnaInsightHero.vue'
import AnaAnomalyCard from '@/components/ana/AnaAnomalyCard.vue'
import AnaBarRow from '@/components/ana/AnaBarRow.vue'
import AnaTag from '@/components/ana/AnaTag.vue'
import AnaPill from '@/components/ana/AnaPill.vue'
import AnaStatusPill from '@/components/ana/AnaStatusPill.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import FigLineChart, { type FigModel } from '@/components/ana/FigLineChart.vue'

// ponytail: eager glob — new DS components appear here without editing this file
const rawMods = import.meta.glob('../components/ds/*.vue', { eager: true }) as Record<string, { default: unknown }>

// Map filename stem -> component default export
const mods = computed(() =>
  Object.fromEntries(
    Object.entries(rawMods).map(([path, mod]) => {
      const name = path.replace('../components/ds/', '').replace('.vue', '')
      return [name, mod.default]
    }),
  ),
)

const componentNames = computed(() => Object.keys(mods.value))

// FigLineChart 静态样例 model(主题×粒度)
const figModel: FigModel = {
  unit: '万',
  themes: [
    { name: '同比', sub: '今年 vs 去年同期', gran: {
      月: { lines: [
        { name: '今年', color: 'rgb(28,28,28)', kind: 'area', pts: [420, 435, 460, 452, 480, 505, 490, 512, 530, 545] },
        { name: '去年同期', color: 'rgb(150,152,158)', kind: 'compare', pts: [400, 410, 420, 430, 428, 440, 445, 452, 470, 480] }],
        labels: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月'],
        value: '¥545.0万', delta: '+13.5%', up: true, rangeLabel: '2025年1–10月' },
      季: { lines: [
        { name: '今年', color: 'rgb(28,28,28)', kind: 'area', pts: [1315, 1437, 1532] },
        { name: '去年同期', color: 'rgb(150,152,158)', kind: 'compare', pts: [1230, 1298, 1367] }],
        labels: ['Q1', 'Q2', 'Q3'], value: '¥1532万', delta: '+12.1%', up: true, rangeLabel: '2025年Q1–Q3' },
    } },
    { name: '构成', sub: '分业务收入堆叠', gran: {
      月: { stacked: true, lines: [
        { name: '租金', color: 'rgb(120,140,176)', kind: 'stack', pts: [300, 310, 320, 315, 330, 345, 335, 350, 360, 370] },
        { name: '用电', color: 'rgb(129,174,232)', kind: 'stack', pts: [80, 85, 95, 92, 100, 110, 105, 112, 118, 122] },
        { name: '其他', color: 'rgb(196,226,244)', kind: 'stack', pts: [40, 40, 45, 45, 50, 50, 50, 50, 52, 53] }],
        labels: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月'],
        value: '¥545.0万', delta: '+13.5%', up: true, rangeLabel: '2025年1–10月' },
    } },
  ],
}
</script>

<style scoped>
.gallery {
  height: 100%;
  padding: var(--space-8);
  background: var(--bg-app);
}

.gallery__title {
  font: var(--type-h1);
  color: var(--text-primary);
  margin-bottom: var(--space-6);
}

.gallery__empty {
  font: var(--type-body);
  color: var(--text-muted);
}

.gallery__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-6);
}

.gallery__cell {
  background: var(--bg-panel);
  border: var(--border-width) solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
}

.gallery__label {
  font: var(--type-label);
  color: var(--text-muted);
  margin-bottom: var(--space-4);
  text-transform: uppercase;
  letter-spacing: var(--ls-wide);
}
</style>
