<script setup lang="ts">
// 租户流失预警(churn) — v2 重构(spec 2026-07-08 §二.10):AnaShell #kpis + av2 栅格;
// 风险象限散点(AnaEChart,均值 markLine 十字,点点→goLedger 深链)+ 已流失清单 + s10 出现/消失正负柱。
// 口径与 v1 完全一致(模型抽至 churn.logic.ts,数值锚点:在租247/已流失22户/流失月应收26.2万/整体收款率81.3%)。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaPill from '@/components/ana/AnaPill.vue'
import { iconFor } from '@/components/ds/icon'
import { fnum, sgn } from '@/components/ana/anaFmt'
import { anaSettings } from '@/analysis/anaSettings'
import { fetchLedgerRows, fetchS10Rows } from '@/analysis/anaData'
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import { buildChurnModel, churnFlowOption, churnScatterOption, mZh, TIER_ECOLOR, type Tier } from './churn.logic'

const loading = ref(true)
const ledger = ref<AnalysisLedgerRow[]>([])
const s10 = ref<AnalysisS10Row[]>([])

onMounted(async () => {
  try {
    ;[ledger.value, s10.value] = await Promise.all([fetchLedgerRows(), fetchS10Rows()])
  } finally {
    loading.value = false
  }
})

const tierColor = (t: Tier) => (t === 'high' ? 'var(--hue-red)' : t === 'mid' ? 'var(--hue-orange)' : 'var(--fill-blue)')
const tierBg = (t: Tier) => (t === 'high' ? 'rgb(255,238,237)' : t === 'mid' ? 'rgb(255,243,230)' : 'var(--surface-sunken)')
const tierZh = (t: Tier) => (t === 'high' ? '高' : t === 'mid' ? '中' : '低')
const wan = (v: number) => fnum(v / 10000, 1)

const model = computed(() => buildChurnModel(ledger.value, s10.value, anaSettings.churnTh))

const scatterOpt = computed(() => (model.value ? churnScatterOption(model.value.list, model.value.overallRate) : {}))
const flowOpt = computed(() => churnFlowOption(model.value?.flows ?? []))
const detail = computed(() => model.value?.list.slice(0, 30) ?? [])

// 深链必须 openFresh:KeepAlive 缓存的 LedgerView 只在 onMounted 消费 query,
// 裸 RouterLink 命中缓存实例不会定位(复审;与收入核对跳转同款语义)
const router = useRouter()
const tabs = useTabsStore()
function goLedger(tenant: string, company: string, ym: string) {
  tabs.openFresh('ledger', { pin: true })
  router.push({ path: '/ledger', query: { y: ym.slice(0, 4), m: String(+ym.slice(5, 7)), company, tenant } })
}
// 散点点点→该租户末期台账(spec §二.10 下钻)
function onScatterClick(p: unknown) {
  const d = (p as { data?: { name?: string; company?: string } }).data
  if (d?.name && model.value) goLedger(d.name, d.company ?? '', model.value.lastYm)
}
</script>

<template>
  <!-- §五:期间无关屏(全窗口活跃度,窗口由台账/s10 数据 firstYm~lastYm 派生),隐期间控件显口径徽章 -->
  <AnaShell period-mode="none" scope-chip="全窗口活跃度">
    <template #kpis>
      <template v-if="!loading && model">
        <AnaKpiTile label="高风险" :value="model.counts.high + ' 户'" :note="'评分≥' + anaSettings.churnTh" />
        <AnaKpiTile label="中风险" :value="model.counts.mid + ' 户'" :note="(anaSettings.churnTh - 20) + '–' + (anaSettings.churnTh - 1) + ' 分'" />
        <AnaKpiTile label="低风险" :value="model.counts.low + ' 户'" :note="'在租 ' + model.list.length + ' 户'" />
        <AnaKpiTile label="已流失" :value="model.churned.length + ' 户'" :note="mZh(model.firstYm) + '在租 · ' + mZh(model.lastYm) + '缺席'" />
        <AnaKpiTile label="流失月应收" :value="'¥' + wan(model.churnedRecv) + '万/月'" :note="mZh(model.firstYm) + '口径'" />
        <AnaKpiTile label="平均风险分" :value="String(model.avgScore)" :note="'预警线 ' + anaSettings.churnTh + '(顶栏可调)'" />
      </template>
    </template>

    <div v-if="loading" class="page-loading"><span class="page-spin" /></div>

    <div v-else-if="!model" class="ak-page">
      <div class="ak-head"><div class="ak-h-l"><span class="ak-h-ic"><component :is="iconFor('siren')" :size="20" /></span>
        <div><h2 class="ak-title">租户流失预警</h2><p class="ak-sub">全窗口活跃度口径</p></div></div></div>
      <div class="ak-card">
        <AnaEmpty label="台账数据未录入,活跃度流失分析暂不可用"
          hint="流失口径依赖月度台账(应收/实收)与附表10 销售收入" to="/ledger" toText="去台账录入" />
      </div>
    </div>

    <div v-else class="ak-page">
      <div class="ak-head">
        <div class="ak-h-l"><span class="ak-h-ic"><component :is="iconFor('siren')" :size="20" /></span>
          <div>
            <h2 class="ak-title">租户流失预警</h2>
            <p class="ak-sub">活跃度风险分 = 缴费恶化(40%) + s10收入下行(30%) + 用能下行(30%),缺项按权重归一 · 窗口 {{ model.firstYm }} ~ {{ model.lastYm }}</p>
          </div>
        </div>
        <AnaPill tone="warn" icon="flask-conical">启发式模型 · 活跃度口径</AnaPill>
      </div>

      <div class="av2-grid">
        <div class="av2-card av2-s8">
          <div class="av2-card-h"><span class="t">风险象限散点</span><span class="hint">环比 × 收款率 · 气泡=月应收 · 虚线=均值 · 点点→台账 · 超±范围的点钉在边缘(悬停看真值)</span></div>
          <AnaEChart :option="scatterOpt" :height="310" @chart-click="onScatterClick" />
          <div class="cz-legend" style="margin-top: 6px">
            <span v-for="t in (['high', 'mid', 'low'] as const)" :key="t" class="cz-leg">
              <span class="sw" :style="{ background: TIER_ECOLOR[t] }"></span>{{ tierZh(t) }}风险</span>
          </div>
        </div>

        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">已流失清单</span><span class="hint">{{ mZh(model.firstYm) }}在租 ∩ {{ mZh(model.lastYm) }}缺席 · {{ model.churned.length }} 户</span></div>
          <div class="churn-scroll">
            <table class="ak-tbl">
              <thead><tr><th>租户</th><th>{{ mZh(model.firstYm) }}应收(万)</th><th>台账</th></tr></thead>
              <tbody>
                <tr v-for="c in model.churned" :key="c.name">
                  <td>{{ c.name }}</td>
                  <td class="mono">{{ wan(c.recv) }}</td>
                  <td><button class="churn-link" @click="goLedger(c.name, c.company, model!.firstYm)">查台账 →</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="av2-card av2-s8">
          <div class="av2-card-h"><span class="t">流失预警明细</span><span class="hint">在租 {{ model.list.length }} 户 · 风险分降序前 {{ detail.length }} · 点租户→台账</span></div>
          <div class="churn-scroll tall">
            <table class="ak-tbl">
              <thead><tr><th>租户</th><th>风险分</th><th>缴费分</th><th>收入分</th><th>用能分</th><th>s10收入Δ</th><th>收款率</th><th>月应收(万)</th></tr></thead>
              <tbody>
                <tr v-for="t in detail" :key="t.name">
                  <td><span class="nm2">
                    <span class="rk" :style="{ background: tierBg(t.tier), color: tierColor(t.tier) }">{{ tierZh(t.tier) }}</span>
                    <button class="churn-link" @click="goLedger(t.name, t.company, model!.lastYm)">{{ t.name }}</button>
                  </span></td>
                  <td class="mono" :style="{ fontWeight: 600, color: tierColor(t.tier) }">{{ t.score }}</td>
                  <td class="mono mut">{{ t.payScore }}</td>
                  <td class="mono mut">{{ t.revScore ?? '—' }}</td>
                  <td class="mono mut">{{ t.elecScore ?? '—' }}</td>
                  <td class="mono" :style="{ color: t.gone10 ? 'var(--hue-red)' : undefined }">{{ t.gone10 ? '消失' : t.revMom != null ? sgn(t.revMom) : '—' }}</td>
                  <td class="mono mut">{{ t.payRate != null ? t.payRate.toFixed(0) + '%' : '—' }}</td>
                  <td class="mono">{{ wan(t.recv) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <AnaMethodNote>合同起止日期未录入,原型「临期续约/资历」因子不可用,已改为业务活跃度口径:缴费恶化(40%,台账 {{ mZh(model.lastYm) }} 收款率)
            + s10收入下行(30%)+ 用能下行(30%,均为相邻有数月环比;s10 末期缺席记满分),缺项按权重归一。台账仅
            {{ mZh(model.firstYm) }}/{{ mZh(model.lastYm) }} 两期,用于相对排序与预警分流,非精算违约概率;预警线可在顶栏「目标与阈值」调整。</AnaMethodNote>
        </div>

        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">s10 逐月出现/消失</span><span class="hint">相邻有数月名单对比 · 上=新出现 下=消失(户)</span></div>
          <AnaEChart :option="flowOpt" :height="260" />
        </div>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
.churn-link { color: inherit; text-decoration: none; border: none; background: transparent; padding: 0; font: inherit; cursor: pointer; }
.churn-link:hover { color: var(--text-link); text-decoration: underline; }
.churn-scroll { max-height: 330px; overflow: auto; }
.churn-scroll.tall { max-height: 420px; }
.churn-scroll thead th { position: sticky; top: 0; background: var(--surface-white); z-index: 1; }
</style>
