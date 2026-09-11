<script setup lang="ts">
// 租户对标(tenant-peer)v1 — design-boards T8/T9/T10/T11:新建屏(理由见 docs/superpowers/plans/
// 2026-09-11-design-boards.md「画板 Peer」一节:选中单个租户看它在同类里的位置,与既有
// TenantPortfolioView 的组合层视角不是同一个主语)。
//
// T8/T9:骨架 + 单位租金对标直方图。T10:「哪些期区能给区间」+「同一招式用在电费上会翻车」
// 两张卡。T11:「这张图为什么可信/和预测图的区别」对照卡。四张卡都在「单位租金」页签下——
// 电费/缴费行为两个页签在设计稿里没有对应的卡片规格(不是「本任务先跳过」,是稿子本身没定义
// 画什么;T10 的「电费会翻车」卡是拿电费当反例摆在单位租金页签里说明,不是补上电费页签的
// 内容),所以这两个页签禁用 + hover 写「暂未开放」。
//
// 数据变换纯函数见 ./TenantPeer.logic.ts(单测,含 break-verify 记录见 t8-report.md / t10-report.md)。
import { computed, onMounted, ref, watch } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaUnitRentHist from '@/components/ana/AnaUnitRentHist.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import { fetchBuildings, fetchContractDetail, fetchContracts, fetchS10TenantMap, fetchTenants } from '@/analysis/anaData'
import type { ContractDTO, PropertyType } from '@/types/contract'
import type { TenantDTO } from '@/types/tenant'
import type { AnalysisS10Row } from '@/api/analysis'
import { PROPERTY_TYPE_LABEL } from '@/types/contract'
import { fint } from '@/components/ana/anaFmt'
import {
  MIN_SAMPLE, buildPeerRows, primaryRowOf, eligibleTenants, phaseZoneLabel, phaseStatsOf,
  buildUnitRentHist, unitRentReadout, unitRentRefText, dominantPropertyType,
  phaseTableRows, phaseTableReadout, phaseTableRefText, latestElecSpread, elecTrapReadout, elecTrapRefText,
  type PeerRow,
} from './TenantPeer.logic'

const loaded = ref(false)
const err = ref('')
const contracts = ref<ContractDTO[]>([])
const phaseOf = ref<Map<number, number>>(new Map())
const tenants = ref<TenantDTO[]>([])
const s10Map = ref<Map<string, AnalysisS10Row[]>>(new Map())

async function reload() {
  // 切回重读会重跑本函数:错误不清,重试成功后屏上仍挂着上次的失败文案(P3 T2 评审坐实)
  err.value = ''
  try {
    const [cs, bs, ts, s10] = await Promise.all([fetchContracts(), fetchBuildings(), fetchTenants(), fetchS10TenantMap()])
    contracts.value = cs
    phaseOf.value = new Map(bs.map((b) => [b.id, b.phase]))
    tenants.value = ts
    s10Map.value = s10
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  } finally {
    loaded.value = true
  }
}
onMounted(reload)
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例——纯读屏没有草稿要保,合同/楼栋改了回来要看最新的。
onReactivated(() => { void reload() })

// asOf 显式取一次今天(同 ExpiryView 的既有约定:「在租」是合同快照,不随期间选择器变化;
// 全局约束①要求锚点显式传入,故 .logic.ts 内部不碰系统时钟,只在这里取一次)。
const today = new Date()
const asOf = today.toLocaleDateString('sv')
const periodLabel = asOf.slice(0, 7)

const peerRows = computed(() => buildPeerRows(contracts.value, phaseOf.value, asOf))
// F4 修复轮1:徽章期区取 tenant.phase,不是 building.phase——两者可能不一致(见 TenantPeer.logic.ts 注释)。
const tenantPhaseOf = computed(() => new Map(tenants.value.map((t) => [t.id, t.phase])))
const tenantOptions = computed(() => eligibleTenants(peerRows.value, tenantPhaseOf.value))

// ── 租户选择(默认候选首户;候选变化时若当前选中已不在候选里才改选,避免用户手选后被悄悄换人)──
const selTenantId = ref<number | null>(null)
watch(tenantOptions, (opts) => {
  if (selTenantId.value != null && opts.some((o) => o.id === selTenantId.value)) return
  selTenantId.value = opts[0]?.id ?? null
}, { immediate: true })

const primaryRow = computed<PeerRow | null>(() =>
  selTenantId.value == null ? null : primaryRowOf(peerRows.value, selTenantId.value))

// ── 单位租金对标(T9):同类 = 选中租户所在期区、在租、已录面积的合同(含本户自己) ──
const phaseZone = computed(() => (primaryRow.value ? phaseZoneLabel(primaryRow.value.phase) : ''))
const phaseGroupRows = computed(() =>
  primaryRow.value ? peerRows.value.filter((r) => r.phase === primaryRow.value!.phase) : [])
const phaseValues = computed(() => phaseGroupRows.value.map((r) => r.unitRent))
const stats = computed(() => phaseStatsOf(phaseValues.value))
const hist = computed(() => (stats.value ? buildUnitRentHist(phaseValues.value, stats.value.p90) : null))
// ── 头部「物业类型」:只为选中租户的主合同查一次计费行。
// F2(对抗复查)时这里扩成整批同类都查,为的是给口径浮层那句「这批同类物业类型是否单一」
// 提供数据。浮层 2026-09-12 拆掉,那句话没了,请求跟着收回来 —— 期区一 25 份同类就是
// 25 次 fetchContractDetail,留着是白付的钱。
const propTypeCache = ref<Map<number, PropertyType | null>>(new Map())
watch(primaryRow, async (row) => {
  if (!row || propTypeCache.value.has(row.contractId)) return
  try {
    const detail = await fetchContractDetail(row.contractId)
    propTypeCache.value.set(row.contractId, dominantPropertyType(detail.billingLines))
  } catch {
    propTypeCache.value.set(row.contractId, null)
  }
}, { immediate: true })
const propertyTypeLabel = computed(() => {
  const row = primaryRow.value
  if (!row) return '—'
  if (!propTypeCache.value.has(row.contractId)) return '…'
  const pt = propTypeCache.value.get(row.contractId)
  return pt ? PROPERTY_TYPE_LABEL[pt] : '—'
})
const readout = computed(() =>
  primaryRow.value ? unitRentReadout(primaryRow.value.unitRent, phaseValues.value, phaseZone.value) : null)
const refText = computed(() => unitRentRefText(phaseValues.value.length, phaseZone.value, periodLabel))


// ── T10「哪些期区能给区间」:不看选中哪个租户,四个期区一次性给行(population 同上,按期区分组)──
const phaseRows = computed(() => phaseTableRows(peerRows.value))
const phaseTableRead = computed(() => phaseTableReadout(phaseRows.value))
const phaseTableRef = computed(() => phaseTableRefText(periodLabel))

// ── T10「同一招式，用在电费上会翻车」:园区全量电费(附表10 最新一期),不分层——反例本身 ──
const elecSpread = computed(() => latestElecSpread(s10Map.value))
const elecRead = computed(() => (elecSpread.value ? elecTrapReadout(elecSpread.value) : null))
const elecRef = computed(() => (elecSpread.value ? elecTrapRefText(elecSpread.value) : ''))

// ── 页签(板上三个,只有「单位租金」有内容——见文件头注释)──
type TabKey = 'rent' | 'elec' | 'pay'
const tab = ref<TabKey>('rent')
const TABS: { k: TabKey; l: string; on: boolean }[] = [
  { k: 'rent', l: '单位租金', on: true },
  { k: 'elec', l: '电费', on: false },
  { k: 'pay', l: '缴费行为', on: false },
]
</script>

<template>
  <AnaShell period-mode="none" scope-chip="合同快照">
    <div v-if="!loaded" class="page-loading"><span class="page-spin" /></div>

    <div v-else-if="err" class="ak-page">
      <AnaEmpty label="分析数据加载失败" :hint="err" />
    </div>

    <div v-else-if="!tenantOptions.length" class="ak-page">
      <AnaEmpty label="没有在租且已录面积的合同" hint="录入合同起止日期与租赁面积后,此处按同期区呈现单位租金分布" to="/contracts" toText="去录入合同" />
    </div>

    <div v-else class="ak-page">
      <div class="tp-head">
        <div class="tp-head-l">
          <h2 class="ak-title">{{ periodLabel }} · {{ primaryRow?.tenantName ?? '—' }}</h2>
          <p class="ak-sub">{{ phaseZone }} · {{ propertyTypeLabel }} {{ primaryRow ? fint(primaryRow.rentArea) : '—' }} ㎡</p>
        </div>
        <FPTenantPicker v-model="selTenantId" :tenants="tenantOptions" placeholder="选择租户" class="tp-picker" />
      </div>

      <div class="anx-seg tp-tabs" role="group" aria-label="对标维度">
        <button v-for="t in TABS" :key="t.k" :class="{ on: tab === t.k }" :disabled="!t.on"
          :title="t.on ? undefined : '暂未开放'" @click="tab = t.k">{{ t.l }}</button>
      </div>

      <template v-if="tab === 'rent'">
      <div class="av2-card">
        <div class="av2-card-h">
          <span class="t">单位租金对标</span>
          <span class="hint">元/㎡·月(含费)· {{ phaseZone }}在租合同</span>
        </div>
        <template v-if="stats && hist && primaryRow">
          <AnaUnitRentHist :bins="hist.bins" :cap-hi="hist.capHi" :overflow-count="hist.overflowCount"
            :overflow-max="hist.overflowMax" :stats="stats" :self-value="primaryRow.unitRent"
            :self-name="primaryRow.tenantName" :height="280" />
          <p v-if="hist.overflowCount" class="tp-overflow">{{ hist.overflowCount }} 份 &gt; {{ hist.capHi }},最高 {{ hist.overflowMax.toFixed(1) }}</p>
          <p v-if="readout" class="ana-read">{{ readout }}</p>
          <p class="ana-ref">{{ refText }}</p>
        </template>
        <AnaEmpty v-else label="同类样本不足" :hint="`${phaseZone}在租且已录面积的合同仅 ${phaseValues.length} 份,不足 ${MIN_SAMPLE} 份,无法画分布区间`" />
      </div>

      <!-- T10:「哪些期区能给区间」—— 板上四行表标签写「在租」,数字却是不过滤日期的总体(168/100/3/2),
           复现不出;板还把期区二的成因诊断错了(说宿舍/厂房混杂,真实原因是无租金计费行合同,
           已实测坐实)。这里按屏上实际用的口径现算,不抄板的字面数字。 -->
      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">哪些期区能给区间</span>
          <span class="hint">样本 &lt; {{ MIN_SAMPLE }} 不画带</span>
        </div>
        <table class="ak-tbl">
          <thead><tr><th>期区</th><th>样本</th><th>中位</th><th>区间</th></tr></thead>
          <tbody>
            <tr v-for="row in phaseRows" :key="row.phase">
              <td>{{ phaseZoneLabel(row.phase) }}</td>
              <td class="mono">{{ row.n }}</td>
              <td class="mono">{{ row.median != null ? row.median.toFixed(1) : '—' }}</td>
              <td class="mono">{{ row.p10 != null ? row.p10.toFixed(1) + ' ~ ' + row.p90!.toFixed(1) : '样本不足' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="ana-read">{{ phaseTableRead }}</p>
        <p class="ana-ref">{{ phaseTableRef }}</p>
      </div>

      <!-- T10:「同一招式，用在电费上会翻车」—— 反例卡:把「单位租金对标」同一招(p10~p90 一条带)
           套在电费上,不分层、不除以面积,看带有多宽。数字是附表10 最新一期现算,不是板上的
           62/7,554/79,750/122 倍那组示意数字。 -->
      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">同一招式，用在电费上会翻车</span>
          <span class="hint">{{ elecSpread ? elecSpread.period + ' · ' + elecSpread.n + ' 户' : '—' }}</span>
        </div>
        <template v-if="elecSpread">
          <table class="ak-tbl">
            <thead><tr><th>p10</th><th>p90</th><th>最高</th></tr></thead>
            <tbody>
              <tr>
                <td class="mono">{{ fint(elecSpread.p10) }}</td>
                <td class="mono">{{ fint(elecSpread.p90) }}</td>
                <td class="mono">{{ fint(elecSpread.max) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="elecRead" class="ana-read">{{ elecRead }}</p>
          <p v-if="elecRead" class="ana-ref">{{ elecRef }}</p>
        </template>
        <AnaEmpty v-else label="附表10 未导入" hint="录入销售收入(附表10)后,此处按最新一期呈现电费分布宽度" />
      </div>

      <!-- T11:「这张图为什么可信 / 和预测图的区别」—— 对标带 vs 预测带对照表。「预测带月度数据不够、
           不敢标百分比」不是本卡新论证的结论,是驾驶舱「这条带过去准不准」卡(滚动起点回测,
           CockpitView.vue)已经测过的既有发现,这里只是拿来跟对标带对照,
           不重新论证一遍——也不把到期屏的续签率带一起拉进来:那张带走的是历史租约抽样,不是
           月度时间序列回归,「需要多少历史/会不会过时」这两条维度上跟驾驶舱预测带不是同一回事,
           混进来比较会是本卡自己制造的一次误诊断。 -->
      <div class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">这张图为什么可信</span>
          <span class="hint">和预测图的区别</span>
        </div>
        <table class="ak-tbl">
          <thead><tr><th>维度</th><th>对标带(本屏)</th><th>预测带(驾驶舱月度收入)</th></tr></thead>
          <tbody>
            <tr>
              <td>区间从哪来</td>
              <td>{{ phaseValues.length }} 个真实同类</td>
              <td>历史数据外推(回归拟合)</td>
            </tr>
            <tr>
              <td>需要多少历史</td>
              <td>当期 1 次快照即可</td>
              <td>至少数年月度数据才够校准</td>
            </tr>
            <tr>
              <td>会不会过时</td>
              <td>每次打开按最新数据重算</td>
              <td>数据一多就要重新拟合,模型会漂</td>
            </tr>
            <tr>
              <td>这个项目现在</td>
              <td>能上</td>
              <td>月度数据不够,不敢标百分比</td>
            </tr>
          </tbody>
        </table>
        <p class="ana-read">对标带今天能用，预测带月度数据不够</p>
        <p class="ana-ref">对标=本屏同类·预测=驾驶舱月度回归</p>
      </div>
      </template>

      <div v-else class="av2-card">
        <div class="av2-card-h"><span class="t">{{ TABS.find((t) => t.k === tab)?.l }}</span></div>
        <AnaEmpty label="暂未开放" hint="本屏目前只做单位租金对标" />
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
.tp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.tp-head-l { min-width: 0; }
.tp-picker { width: 240px; flex: 0 0 auto; }
.tp-tabs { margin-bottom: 14px; }
.tp-overflow { font-size: var(--fs-micro); color: var(--text-muted); margin: 4px 0 0; }
</style>
