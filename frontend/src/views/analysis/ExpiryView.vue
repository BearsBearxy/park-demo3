<script setup lang="ts">
// 到期墙与续约(expiry) — v2 重构(spec 2026-07-08 §二.11):AnaShell #kpis + av2 栅格;
// 合同金额 Pareto(ECharts 柱线,点柱→清单展开该租户)+ Top10 集中度环 + 清单(点行→行内展开该租户全部合同);
// 到期墙实装(2026-07-12,plans/2026-07-12-demo3-expiry-wall.md):有日期数据时渲染 8 季柱图 + 临期 90 天清单,
// 无日期时保留降级空态(判据 wall.totalCount > 0,本机数据日期全 NULL 仍走空态,口径数值不变)。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaRentBandChart from '@/components/ana/AnaRentBandChart.vue'
import AnaRenewalChart from '@/components/ana/AnaRenewalChart.vue'
import type { RentBandCol, GapInput } from './rentBandChart.logic'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaPill from '@/components/ana/AnaPill.vue'
import { iconFor } from '@/components/ds/icon'
import { fnum } from '@/components/ana/anaFmt'
import { fetchContracts } from '@/analysis/anaData'
import type { ContractDTO } from '@/types/contract'
import { contractStatusOf } from '@/components/fp/contractStatus'
import {
  buildExpiryStats, buildExpiryWall, buildPareto, buildRentRoll,
  concentrationOption, paretoOption, priorityReadout, priorityRefText,
  renewalRateReadout, renewalRateBand, renewalRateLineOption, sensitivityRows, sensitivitySentence, sensitivityGapSentence,
  rentRollOption, rentRollRefText, rentRollSentence, wallOption,
} from './expiry.logic'

const router = useRouter()
const loading = ref(true)
const contracts = ref<ContractDTO[]>([])

async function reload() {
  try {
    contracts.value = await fetchContracts()
  } finally {
    loading.value = false
  }
}
onMounted(reload)
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例 —— 纯读屏没有草稿要保,
// 切回来该看最新的(导入中心导完租户,回这屏必须是新名单)。
onReactivated(() => { void reload() })

const wan = (v: number) => fnum(v / 10000, 1)
// 文案取权威表(contractStatus.ts):此前本屏是同一批状态的第三套叫法(在租/临期/到期/终止),
// 合同管理是「执行中/即将到期/已到期/已终止」,租户组合分析又是第二套。
const statusZh = (s: string) => contractStatusOf(s).label

const stats = computed(() => buildExpiryStats(contracts.value))
const pareto = computed(() => buildPareto(contracts.value))
const paretoOpt = computed(() => paretoOption(pareto.value))
const concOpt = computed(() => (stats.value ? concentrationOption(stats.value.top10Sum, stats.value.rentSum) : {}))

// ── 到期墙(2026-07-12 实装:云上合同已带日期;totalCount=0 时仍走降级空态) ──
const today = new Date()
const wall = computed(() => buildExpiryWall(contracts.value, today))
const wallOpt = computed(() => wallOption(wall.value))   // tooltip 闭包引用 wall,wall 变更随 computed 重建
const wallRentSum = computed(() => wall.value.quarters.reduce((s, q) => s + q.rentSum, 0))

// ── 合约租金带(Task 7,FORECAST §1.1):锁定实线 + 续签区间(蒙特卡洛)。asOf 显式取一次今天,
// 不在 expiry.logic 里碰系统时钟(全局约束①)。
const asOf = today.toLocaleDateString('sv')
const rentRoll = computed(() => buildRentRoll(contracts.value, asOf, 12))
// 自绘图的列:历史 12 个月(只有已实现)+ 预测 12 个月(锁定/预计/上下沿)。
// 万元一次换到位,组件里不再做单位换算 —— 换算散在两处,接缝迟早对不上。
const wanOf = (v: number) => +(v / 10000).toFixed(2)
const bandCols = computed<RentBandCol[]>(() => {
  const r = rentRoll.value
  const hist: RentBandCol[] = r.history.map((h) => ({
    month: h.month, realized: wanOf(h.locked), locked: null, mid: null, lo: null, hi: null,
  }))
  const fwd: RentBandCol[] = r.months.map((m, i) => ({
    month: m.month,
    // 第 0 月是「今天」:它既是历史的末点也是预测的起点,两段在这一点接上才不会断开。
    realized: i === 0 ? wanOf(m.locked) : null,
    locked: wanOf(m.locked),
    mid: wanOf(m.locked + m.renewalMid),
    lo: wanOf(m.locked + m.renewalLo),
    hi: wanOf(m.locked + m.renewalHi),
  }))
  // 历史末点与预测起点之间要连上:把历史最后一格的 realized 延到起点那一列
  return [...hist, ...fwd]
})
const bandSplitIdx = computed(() => rentRoll.value.history.length)
const bandGap = computed<GapInput | null>(() => {
  const g = rentRoll.value.gap
  if (!g) return null
  const col = bandSplitIdx.value + g.monthsAway
  const m = rentRoll.value.months[g.monthsAway]
  return {
    colIndex: col, dropWan: +(g.totalRentSum / 10000).toFixed(1), names: g.names, count: g.count,
    endLabel: m ? m.month : '',
  }
})
const rentRollText = computed(() => rentRollSentence(rentRoll.value))
const rentRollRef = computed(() => rentRollRefText(rentRoll.value))
const rentRollHasMaster = computed(() => rentRoll.value.months.some((m) => m.masterLease > 0))

// ── T4(design-boards):五个 KPI 瓦读的是 rentRoll 同一份计算(锁定/续签/缺口),
// 不为瓦另算一次 —— 这正是 T4/T5 合并成一个任务的理由(卡片与瓦对不上,已经在这个项目上出过两次)。
const asOfYm = asOf.slice(0, 7)
const rentRollLast = computed(() => rentRoll.value.months[rentRoll.value.months.length - 1])

// ── T6(design-boards):「先谈哪几户」—— rentRoll.expiringList 已经按月租金降序,直接读,
// 不再另过滤一遍(与「未来12月到期」瓦、续签抽样池同一批合同,理由见 buildRentRoll 内注释)。
const priorityRead = computed(() => priorityReadout(rentRoll.value.expiringList, rentRoll.value.expiringRentSum))
const priorityRef = computed(() => priorityRefText(rentRoll.value.expiringList, rentRoll.value.expiringRentSum))

// ── T7(design-boards):「续签率从哪来」—— 区间是续签率本身的历史不确定性(只抽 p),
// 与「合约租金带」卡的金额区间(抽 p 之后还要抽哪几户续签)是两件事。
const renewalRateRead = computed(() => renewalRateReadout(rentRoll.value.renewalHits, rentRoll.value.renewalN))
const renewalBand = computed(() => renewalRateBand(rentRoll.value.renewalHits, rentRoll.value.renewalN))

// ── T7(design-boards):「续签率变一档,年末差多少」—— 固定续签率(0/历史/40%/60%)下,
// 视界最后一月的租金是「哪几户续签」随机性的期望值(闭式解,详见 sensitivityFinalRent 注释),
// 不复用 simulateRenewalDraws(那个函数每轮重新从后验抽 p,答的是另一个问题)。
const sensitivity = computed(() =>
  sensitivityRows(rentRollLast.value.locked, rentRoll.value.expiringRentSum, rentRoll.value.months[0].locked, rentRoll.value.renewalP))
const sensitivityRead = computed(() => sensitivitySentence(sensitivity.value))
// F1(修复轮1,design-boards):板上收尾行——历史续签率下的缺口,折算成约等于几户中型厂房。
// 见 sensitivityGapSentence 注释:「中型厂房」口径查库定,不是拍脑袋。
const sensitivityGapRead = computed(() => sensitivityGapSentence(sensitivity.value, rentRoll.value.months[0].locked))

const listed = computed(() => [...contracts.value].sort((a, b) => b.monthlyRent - a.monthlyRent))
const maxRent = computed(() => listed.value[0]?.monthlyRent || 1)

// ── 清单行内展开(spec §二.11:点行→展开该租户合同详情) ──
const expandedId = ref<number | null>(null)
const expandedTenant = computed(() => listed.value.find((c) => c.id === expandedId.value)?.tenantName ?? null)
const tenantContracts = computed(() =>
  expandedTenant.value ? listed.value.filter((c) => c.tenantName === expandedTenant.value) : [])
function toggleRow(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}
// Pareto 点柱 → 清单展开该合同行(屏内联动)
function onParetoClick(p: unknown) {
  const idx = (p as { dataIndex?: number }).dataIndex
  if (idx == null || !pareto.value.ids[idx]) return
  expandedId.value = pareto.value.ids[idx]
}
</script>

<template>
  <!-- §五:期间无关屏(合同快照),隐期间控件显口径徽章 -->
  <AnaShell period-mode="none" scope-chip="合同快照">
    <template #kpis>
      <template v-if="!loading && stats">
        <AnaKpiTile label="合同总数" :value="stats.total + ' 份'" />
        <!-- T4(design-boards):「月租金合计」改成「当前合约租金」——board 上同名瓦读的是锁定线
             第 0 月(今天)的值,不是全部合同(含早已到期/日期缺失行)原样求和,口径更准。 -->
        <AnaKpiTile label="当前合约租金" :value="'¥' + wan(rentRoll.months[0].locked) + '万/月'"
          :note="rentRoll.months[0].lockedCount + ' 份在租 · ' + asOfYm" />
        <AnaKpiTile label="有租金合同" :value="stats.withRent + ' 份'" :note="'零租金 ' + stats.zeroRent + ' 份'" />
        <AnaKpiTile label="租金中位数" :value="'¥' + wan(stats.medRent) + '万'" note="有租金口径" />
        <AnaKpiTile label="Top10 集中度" :value="stats.top10Pct + '%'" :note="'Top10 ¥' + wan(stats.top10Sum) + '万/月'" />
        <!-- T4:「日期待补录」改成「未来12月到期」——日期缺失已经在页头 AnaPill 里提示,这个位置
             换成 board 上的「2026 到期」瓦(读的是喂给续签抽样的同一批合同,见 rentRoll.expiringCount)。 -->
        <AnaKpiTile label="未来12月到期" :value="rentRoll.expiringCount + ' 份'"
          :note="'涉及月租 ' + wan(rentRoll.expiringRentSum) + ' 万'" />
        <AnaKpiTile label="历史续签率" :value="(rentRoll.renewalP * 100).toFixed(1) + '%'"
          :note="rentRoll.renewalN + ' 份已到期中 ' + rentRoll.renewalHits + ' 份续签'" />
        <!-- T4 ruling:这里印 80% ——是模拟分布本身的 10~90 分位宽度,不是回测校准声明(驾驶舱那条
             禁的是后者)。 -->
        <AnaKpiTile :label="rentRollLast.month + ' 预计'" :value="'¥' + wan(rentRollLast.locked + rentRollLast.renewalMid) + '万/月'"
          :note="'80% 在 ' + wan(rentRollLast.locked + rentRollLast.renewalLo) + '~' + wan(rentRollLast.locked + rentRollLast.renewalHi) + ' 万'" />
        <AnaKpiTile label="最近的缺口" :value="rentRoll.gap ? rentRoll.gap.monthsAway + ' 月' : '—'"
          :note="rentRoll.gap ? rentRoll.gap.count + ' 份到期 · ' + wan(rentRoll.gap.totalRentSum) + ' 万' : '未来12月内无缺口'" />
      </template>
    </template>

    <div v-if="loading" class="page-loading"><span class="page-spin" /></div>

    <div v-else-if="!stats" class="ak-page">
      <div class="ak-head"><div class="ak-h-l"><span class="ak-h-ic"><component :is="iconFor('calendar-clock')" :size="20" /></span>
        <div><h2 class="ak-title">到期墙与续约</h2><p class="ak-sub">合同快照口径</p></div></div></div>
      <div class="ak-card">
        <AnaEmpty label="暂无合同数据" hint="录入合同后此处展示到期墙与租金结构" to="/contracts" toText="去合同录入" />
      </div>
    </div>

    <div v-else class="ak-page">
      <div class="ak-head">
        <div class="ak-h-l"><span class="ak-h-ic"><component :is="iconFor('calendar-clock')" :size="20" /></span>
          <div>
            <h2 class="ak-title">到期墙与续约</h2>
            <p class="ak-sub">{{ wall.totalCount > 0
              ? '合同快照口径 · 按合同止日逐季聚合,未来 8 季到期时间轴'
              : '合同快照口径 · 起止日期未录入,到期时间轴降级为租金结构视图' }}</p>
          </div>
        </div>
        <AnaPill v-if="wall.totalCount > 0" tone="legal" icon="calendar-clock">合同快照口径 · {{ stats.total - stats.dateMissing }} 份带日期</AnaPill>
        <AnaPill v-else tone="warn" icon="flask-conical">合同日期缺失 · 降级视图</AnaPill>
      </div>

      <div class="av2-grid">
        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">到期墙 · 未来 8 季</span>
            <span class="hint">{{ wall.totalCount > 0
              ? `未来8季到期 ${wall.totalCount} 份 · ¥${wan(wallRentSum)}万/月`
              : '按季到期月租金 + 续约概率(需合同起止日期)' }}</span></div>
          <AnaEChart v-if="wall.totalCount > 0" :option="wallOpt" :height="250" />
          <AnaEmpty v-else :label="'到期时间轴暂不可用:' + stats.dateMissing + ' 份合同的起止/签订日期均未录入'"
            hint="补录合同起止日期后,此处将展示未来 8 季到期租金墙、临期清单与续约预测"
            to="/contracts" toText="去合同屏补录日期" />
        </div>

        <!-- 合约租金带(Task 7):不是给到期墙加带 —— 到期墙(上一张卡)是无时间轴的 8 季排期柱,
             这张才是以月为 x 轴的图。锁定实线 = 已签约覆盖到该月的合同;续签区间 = 到期后是否
             续签的蒙特卡洛不确定性;n/份续签数同屏可见(D1 可执行形式,见 rentRollRefText)。
             F5(修复轮1):图与句子共用 rentRollText 同一个 v-if —— decided(历史)与 pool(未来)
             是两个独立的过滤条件,结构上可能出现「n 很小但 pool 非空」,不能让图和句子各自
             按不同条件决定露不露出,那样会撕裂 D1 的「同屏」前提。 -->
        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">合约租金带 · 未来 12 月</span>
            <span class="hint">锁定实线 + 续签区间 · 不含新招租,是下界{{ rentRollHasMaster ? ' · 另有整租未计入' : '' }}</span></div>
          <AnaRentBandChart v-if="rentRollText" :cols="bandCols" :split-idx="bandSplitIdx" :gap="bandGap" :height="280" />
          <p v-if="rentRollText" class="ana-read">{{ rentRollText }}</p>
          <p class="ana-ref">{{ rentRollRef }}</p>
        </div>

        <!-- T6(design-boards):「先谈哪几户」—— 既有「临期90天」卡改造:population 从 90 天窗口
             换成 rentRoll.expiringList(未来12月、与续签抽样同一批合同),排序从到期日改成月租金降序。
             点行去合同屏的交互原样保留。 -->
        <div v-if="rentRoll.expiringList.length > 0" class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">先谈哪几户</span><span class="hint">共 {{ rentRoll.expiringList.length }} 份 · 按到期月租排序<span class="hint-desk"> · 点行去合同屏</span></span></div>
          <div class="exp-scroll">
            <table class="ak-tbl">
              <thead><tr><th>到期</th><th>租户</th><th>月租(万)</th><th>剩余</th></tr></thead>
              <tbody>
                <tr v-for="r in rentRoll.expiringList" :key="r.id" class="exp-row" @click="router.push({ path: '/contracts', query: { contractNo: r.contractNo } })">
                  <td class="mono mut" style="text-align: left">{{ r.endDate.slice(2, 7) }}</td>
                  <td style="text-align: right">{{ r.tenantName }}</td>
                  <td class="mono">{{ wan(r.monthlyRent) }}</td>
                  <td class="mono">{{ r.monthsLeft }} 月</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="priorityRead" class="ana-read">{{ priorityRead }}</p>
          <p v-if="priorityRead" class="ana-ref">{{ priorityRef }}</p>
        </div>

        <!-- T7(design-boards):「续签率从哪来」—— 历史到期结果统计 + 续签率本身的区间(只抽 p,
             不抽哪几户续签),与「合约租金带」卡的金额区间是两件事,分开说。 -->
        <div v-if="rentRoll.renewalN > 0" class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">续签率从哪来</span><span class="hint">历史到期结果统计</span></div>
          <div style="display: flex; flex-direction: column; gap: 9px">
            <div class="exp-kv"><span class="k">历史到期</span><span class="v">{{ rentRoll.renewalN }} 份</span></div>
            <div class="exp-kv"><span class="k">续签</span><span class="v" style="color: var(--hue-blue)">{{ rentRoll.renewalHits }} 份</span></div>
            <div class="exp-kv" style="padding-top: 8px; border-top: 1px solid var(--divider)"><span class="k">未续签</span><span class="v">{{ rentRoll.renewalN - rentRoll.renewalHits }} 份</span></div>
          </div>
          <!-- 稿上那条数轴(原 Ruling-7 判的不做,用户 2026-09-12 要求补上):
               0~100% 的横轴 + 观测值 + 它自己的 80% 区间。与上面三行计数不重复——
               计数给的是 18/72,轴给的是这个比例落在哪儿、有多宽。 -->
          <AnaRenewalChart v-if="renewalRateRead" :hits="rentRoll.renewalHits" :n="rentRoll.renewalN"
            :band="renewalBand" :height="112" />
          <p v-if="renewalRateRead" class="ana-read">{{ renewalRateRead }}</p>
          <p v-if="renewalRateRead" class="ana-ref">历史{{ rentRoll.renewalN }}份 · 口径同历史续签率瓦</p>
        </div>

        <!-- T7(design-boards):「续签率变一档,年末差多少」—— 固定续签率(不抽 p)下的期望值表,
             不复用 simulateRenewalDraws(那个函数会把 p 的不确定性也混进来,见 sensitivityFinalRent 注释)。 -->
        <!-- 门槛用 renewalN(有没有历史续签数据),不用 sensitivity.length —— 后者是固定 4 档,
             恒为真,拿它当门禁形同虚设(sensitivityRows 是纯算术,没有历史数据也会算出一张
             退化的表,那张表没有意义,不该露出来)。 -->
        <div v-if="rentRoll.renewalN > 0" class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">续签率变一档</span><span class="hint">年末差多少</span></div>
          <table class="ak-tbl">
            <thead><tr><th>续签率</th><th>{{ rentRollLast.month }} 月租(万)</th><th>对今天</th><th>够不够</th></tr></thead>
            <tbody>
              <tr v-for="row in sensitivity" :key="row.ratePct + row.tag">
                <td style="text-align: left">{{ row.ratePct }}%{{ row.tag ? ' ' + row.tag : '' }}</td>
                <td class="mono">{{ row.finalRentWan }}</td>
                <td class="mono">{{ row.deltaPct >= 0 ? '+' : '' }}{{ row.deltaPct }}%</td>
                <td>{{ row.verdict }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="sensitivityRead" class="ana-read">{{ sensitivityRead }}</p>
          <p v-if="sensitivityGapRead" class="ana-read">{{ sensitivityGapRead }}</p>
          <p v-if="sensitivityRead" class="ana-ref">与上方合约租金带同一份锁定线</p>
        </div>

        <div class="av2-card av2-s8">
          <div class="av2-card-h"><span class="t">合同金额 Pareto</span><span class="hint">Top20 · 柱=月租金(万) 线=累计占比<span class="hint-desk"> · 点柱→清单展开</span></span></div>
          <AnaEChart :option="paretoOpt" :height="300" @chart-click="onParetoClick" />
        </div>

        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">租金集中度</span><span class="hint">Top10 合同占比</span></div>
          <div style="position: relative">
            <AnaEChart :option="concOpt" :height="300" />
            <div class="exp-ring-c">
              <b>{{ stats.top10Pct }}%</b><span>Top10 集中度</span>
            </div>
          </div>
          <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 9px">
            <div class="exp-kv"><span class="k">月租金合计</span><span class="v">¥{{ wan(stats.rentSum) }}万/月</span></div>
            <div class="exp-kv"><span class="k">Top10 合计</span><span class="v" style="color: var(--hue-blue)">¥{{ wan(stats.top10Sum) }}万/月</span></div>
            <div class="exp-kv" style="padding-top: 8px; border-top: 1px solid var(--divider)">
              <span class="k">其余 {{ stats.total - 10 }} 份合计</span><span class="v">¥{{ wan(stats.rentSum - stats.top10Sum) }}万/月</span></div>
          </div>
        </div>

        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">合同清单</span><span class="hint">共 {{ listed.length }} 份 · 按月租金降序<span class="hint-desk"> · 点行展开该租户合同详情</span></span></div>
          <div class="exp-scroll">
            <table class="ak-tbl">
              <thead><tr><th>合同号</th><th>租户</th><th>楼栋</th><th>楼层</th><th>月租金(万)</th><th>占最高</th><th>状态</th></tr></thead>
              <tbody>
                <template v-for="c in listed" :key="c.id">
                  <tr class="exp-row" :class="{ on: expandedId === c.id }" @click="toggleRow(c.id)">
                    <td class="mono mut" style="text-align: left">{{ c.contractNo }}</td>
                    <td style="text-align: right">{{ c.tenantName }}</td>
                    <td class="mut">{{ c.buildingName }}</td>
                    <td class="mut">{{ c.floorInfo || '—' }}</td>
                    <td class="mono">{{ wan(c.monthlyRent) }}</td>
                    <td><span class="ak-inbar"><i :style="{ width: (c.monthlyRent / maxRent * 100) + '%' }"></i></span></td>
                    <td class="mut">{{ statusZh(c.status) }}</td>
                  </tr>
                  <tr v-if="expandedId === c.id" class="exp-detail">
                    <td colspan="7">
                      <div class="exp-det-h">{{ c.tenantName }} · 名下合同 {{ tenantContracts.length }} 份 ·
                        合计 ¥{{ wan(tenantContracts.reduce((s, x) => s + x.monthlyRent, 0)) }}万/月</div>
                      <div v-for="tc in tenantContracts" :key="tc.id" class="exp-det-r">
                        <span class="mono">{{ tc.contractNo }}</span>
                        <span>{{ tc.buildingName }} · {{ tc.floorInfo || '—' }}</span>
                        <span>面积 {{ tc.rentArea > 0 ? tc.rentArea + '㎡' : '—' }}</span>
                        <span>押金 {{ tc.deposit > 0 ? '¥' + wan(tc.deposit) + '万' : '—' }}</span>
                        <span>起止 {{ tc.startDate || '—' }} ~ {{ tc.endDate || '—' }}</span>
                        <span class="mono" style="font-weight: 600">¥{{ wan(tc.monthlyRent) }}万/月</span>
                        <span>{{ statusZh(tc.status) }}</span>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
.exp-kv { display: flex; justify-content: space-between; font-size: var(--fs-label); }
.exp-kv .k { color: var(--text-muted); }
.exp-kv .v { font-family: var(--font-mono); font-weight: 600; }
.exp-scroll { max-height: 480px; overflow: auto; }
.exp-scroll thead th { position: sticky; top: 0; background: var(--surface-white); z-index: 1; }
.exp-row { cursor: pointer; }
.exp-row:hover td, .exp-row.on td { background: var(--bg-hover); }
.exp-detail td { background: var(--surface-sunken); padding: 10px 12px; }
.exp-det-h { font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; }
.exp-det-r { display: flex; gap: 14px; flex-wrap: wrap; font-size: var(--fs-micro); color: var(--text-secondary); padding: 3px 0; }
.exp-ring-c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; gap: 2px; }
.exp-ring-c b { font-size: 20px; font-family: var(--font-mono); color: var(--text-primary); }
.exp-ring-c span { font-size: var(--fs-micro); color: var(--text-muted); }
</style>
