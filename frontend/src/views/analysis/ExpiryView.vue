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
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaPill from '@/components/ana/AnaPill.vue'
import { iconFor } from '@/components/ds/icon'
import { fnum } from '@/components/ana/anaFmt'
import { fetchContracts } from '@/analysis/anaData'
import type { ContractDTO } from '@/types/contract'
import { contractStatusOf } from '@/components/fp/contractStatus'
import {
  buildExpiringSoon, buildExpiryStats, buildExpiryWall, buildPareto, buildRentRoll,
  concentrationOption, paretoOption, rentRollOption, rentRollRefText, rentRollSentence, wallOption,
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
const soon = computed(() => buildExpiringSoon(contracts.value, today))

// ── 合约租金带(Task 7,FORECAST §1.1):锁定实线 + 续签区间(蒙特卡洛)。asOf 显式取一次今天,
// 不在 expiry.logic 里碰系统时钟(全局约束①)。
const asOf = today.toLocaleDateString('sv')
const rentRoll = computed(() => buildRentRoll(contracts.value, asOf, 12))
const rentRollOpt = computed(() => rentRollOption(rentRoll.value))
const rentRollText = computed(() => rentRollSentence(rentRoll.value))
const rentRollRef = computed(() => rentRollRefText(rentRoll.value))
const rentRollHasMaster = computed(() => rentRoll.value.months.some((m) => m.masterLease > 0))

// ── T4(design-boards):五个 KPI 瓦读的是 rentRoll 同一份计算(锁定/续签/缺口),
// 不为瓦另算一次 —— 这正是 T4/T5 合并成一个任务的理由(卡片与瓦对不上,已经在这个项目上出过两次)。
const asOfYm = asOf.slice(0, 7)
const rentRollLast = computed(() => rentRoll.value.months[rentRoll.value.months.length - 1])

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
             禁的是后者)。差异与理由写在下方「合约租金带」卡的口径浮层里。 -->
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
            <span class="hint">锁定实线 + 续签区间 · 不含新招租{{ rentRollHasMaster ? ' · 另有整租未计入' : '' }}</span></div>
          <AnaEChart v-if="rentRollText" :option="rentRollOpt" :height="260" />
          <p v-if="rentRollText" class="ana-read">{{ rentRollText }}</p>
          <p class="ana-ref">{{ rentRollRef }}</p>
          <!-- I5(对抗复查):本分支唯一一条模拟带,原来是唯一一张没有自己口径浮层的带卡。
               三件必须说清楚的事:阴影是什么、谁不在图里、以及最要紧的「它是下界不是预测」。 -->
          <AnaMethodNote>
            「已实现」= 预测起点(今天)那一个点,已经是事实,不是模拟;「已锁定」= 已签约覆盖到该月的
            合同月租向后延伸的同一条线(免租期整月落在区间内的不计)。「预计」= 在「已锁定」之上加历史
            续签率模拟一万次后的中位数;阴影(80% 区间)= 续签部分落在 10~90 分位的范围,不是校准过的
            命中率——它来自「哪几户会续签」这层真实的随机性,不是凭空编出来的一个数。
            历史续签率按「租约」算、不按合同行算:同一份租约被拆成几个价格档的(合同屏标「递增」徽标),
            只算一次到期,换档不算一次续签;整租合同不进这张图(存在时卡头标注)。设计稿标注的续签率
            20%(18/90)按今天的库口径查不出这两个数,上方「历史续签率」瓦按实测口径出数,以它为准。
            图上红色标注是最近一次到期扎堆造成的锁定线缺口,已把拉低它的合同标出。
            ⚠ 这条带结构上不含新招租 —— 今天空着的单元将来租出去的租金不在任何一次模拟里。
            所以它是未来租金的下界,不是租金预测:实际租金只会等于或高于它。
          </AnaMethodNote>
        </div>

        <!-- 临期 90 天清单(仅有临期合同时渲染;点行去合同屏(带合同号,合同屏预填搜索)) -->
        <div v-if="soon.length > 0" class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">临期 90 天</span><span class="hint">共 {{ soon.length }} 份 · 按到期日升序<span class="hint-desk"> · 点行去合同屏</span></span></div>
          <div class="exp-scroll">
            <table class="ak-tbl">
              <thead><tr><th>租户</th><th>合同号</th><th>月租金(万)</th><th>到期日</th><th>剩余天数</th></tr></thead>
              <tbody>
                <tr v-for="r in soon" :key="r.id" class="exp-row" @click="router.push({ path: '/contracts', query: { contractNo: r.contractNo } })">
                  <td style="text-align: left">{{ r.tenantName }}</td>
                  <td class="mono mut">{{ r.contractNo }}</td>
                  <td class="mono">{{ wan(r.monthlyRent) }}</td>
                  <td class="mono mut">{{ r.endDate }}</td>
                  <td class="mono">{{ r.daysLeft }} 天</td>
                </tr>
              </tbody>
            </table>
          </div>
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
          <!-- I5(对抗复查):这段原来写着「续约概率/预测留存需历史续约数据,暂不展示(不画假图)」,
               而本分支已经在下面两张卡之外画上了一条按历史续签率模拟的租金带 —— 浮层与屏上自相矛盾。
               改成指路:续签不确定性在「合约租金带」那张卡上,口径写在那张卡自己的浮层里。 -->
          <AnaMethodNote v-if="wall.totalCount > 0">到期墙口径:按合同止日逐季聚合,仅计生效/临期合同(止日早于今天的不进墙);
            到期墙本身只排期不预测(止日在库里,不是随机量)。续签会不会发生带来的金额不确定性,见上方「合约租金带」卡及其口径说明。
            零租金合同 {{ stats.zeroRent }} 份(免租/内部占用等)不计入分布。</AnaMethodNote>
          <AnaMethodNote v-else>原型「到期墙/续约概率/预测留存」依赖合同起止日期与流失健康分,当前 {{ stats.dateMissing }} 份合同日期均未录入,
            已降级为租金结构视图,补录后自动恢复;rent_area 字段当前全为 0,面积分布暂不展示(不画假图)。零租金合同
            {{ stats.zeroRent }} 份(免租/内部占用等)不计入分布。</AnaMethodNote>
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
