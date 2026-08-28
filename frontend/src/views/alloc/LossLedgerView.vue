<script setup lang="ts">
// 楼栋损耗(POOL-ENGINE-SPEC §6,S3-B1 刀2)— 新路由 /alloc-loss,紧随公共电核算。
// FPLedgerTable 手法(sticky 首列/34px 行/mono 空值'–'/tfoot 钉底);行数≤20 不虚拟滚动。
// units=楼栋损耗快照;对账区两行=读时派生(供电局总表 vs 各栋总表合计 / 各栋分表合计),单元行后接续渲染。
// S21(S21-PARAM-CENTER-SPEC §5.6):本屏**零写入口** —— 原「本月口径」面板与行内 损耗调整度数/损耗率加点/G调整 三格编辑
// 全部收敛到「计费参数」页(/params);这里只读:损耗调整度数/损耗率加点两格带「仅本月/长期」徽标、点击跳参数页;
// G 格悬浮给分解式「(a + b + …) ÷ 6 = G」;手工率覆盖时收取率并排显公式率。
// 屏级告警(LAYOUT-STABILITY-SPEC §6,2026-08-25):「快照过期」原为头部流内橙条(顶动表格且清不掉),
// 改为工具条上的常驻 chip + 右侧抽屉;判定逻辑不变,仍是 staleText(status,'pool')。
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { allocApi, type AllocLossDTO, type AllocLossUnitDTO } from '@/api/alloc'
import { paramsApi, type ParamRowDTO, type ParamStatusDTO } from '@/api/params'
import { buildLossReconRows, lossFooter } from '@/utils/poolLedgerLogic'
import { zoneLabel } from '@/utils/zoneLabel'
import { rangeBadge, staleText } from '@/utils/paramCenterLogic'
import { buildYearOptions } from '@/utils/yearGate'
import { latestPeriodOf } from '@/utils/defaultPeriod'
import { onReactivated } from '@/composables/onReactivated'
import { useTabsStore } from '@/stores/tabs'
import { useZonesStore } from '@/stores/zones'
import { iconFor } from '@/components/ds/icon'
import FPAlertChip from '@/components/fp/FPAlertChip.vue'
import FPAlertPanel, { type AlertGroup } from '@/components/fp/FPAlertPanel.vue'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fpct = (r: number | null | undefined) => (r == null ? '–' : (r * 100).toFixed(2) + '%')

// ── 账期(整体数据驱动)+ zone Segmented(只有一期/二期;宿舍无损耗单元) ──
// today 只喂 buildYearOptions 的「∪ 当前年」窗口;年月初值由 onMounted 的 latestPeriodOf(/months 全集取 max)一起定(§4)
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  buildYearOptions(dataYears.value, today).map(y => ({ value: String(y), label: `${y}年` })))
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const ym = computed(() => `${year.value}-${pad2(month.value)}`)
const zone = ref<string>('p1')
const zones = useZonesStore()
onMounted(() => zones.ensure())
// 宿舍无损耗单元(后端 AllocService.lossGroups() 第一道过滤就排 dorm,行号随改动漂移故不写死)。
// 期区清单接口化之后必须在这里主动排掉,否则会多出一个恒空的宿舍 tab,
// 把一个刻意的设计读成一个 bug。
const ZONE_OPTS = computed(() => zones.list.filter(z => z.code !== 'dorm')
  .map(z => ({ value: z.code, label: z.name })))

// ── 数据(竞态守卫):损耗快照 + 本 zone 栋级参数(只读徽标用,只拉三个键几十行)+ 参数状态(stale 条) ──
const loss = ref<AllocLossDTO | null>(null)
const params = ref<ParamRowDTO[]>([])
const status = ref<ParamStatusDTO | null>(null)
let seq = 0
async function loadMonth() {
  const my = ++seq
  const [ls, ps, st] = await Promise.all([
    allocApi.loss(ym.value),
    paramsApi.list(ym.value, zone.value, { scope: 'building:', key: 'loss_adj_qty,loss_adj_rate,loss_rate_manual' })
      .catch(() => [] as ParamRowDTO[]),
    paramsApi.status(ym.value).catch(() => null),
  ])
  if (my !== seq) return
  loss.value = ls; params.value = ps; status.value = st
}
onMounted(async () => {
  try {
    // years 供年下拉、months 定默认账期,互不依赖 → 并发,一个往返拿齐
    const [ys, months] = await Promise.all([allocApi.years(), allocApi.lossMonths()])
    dataYears.value = ys
    // §4:year 与 month 一起 snap 到最后一个**有损耗快照**的账期(原来只 snap year、month 留系统当月,
    // 拼出的账期没快照,一进来就是「本月未生成」的灰条)。判据走 /alloc/loss-months 直查快照表。
    const p = latestPeriodOf(months)
    if (p && (p.year !== year.value || p.month !== month.value)) {
      year.value = p.year; month.value = p.month; return   // watch 触发 loadMonth
    }
  } catch { /* 年份失败不阻断 */ }
  loadMonth()
})
watch([year, month, zone], loadMonth)
// 页签切回:参数页那边可能刚重算过 —— 池快照时间变了就整月重拉(数字与 stale 条一起变新),没变只刷状态
// (回包前若已换月(seq 变了)就丢弃,别让旧月 status 盖住新月的 stale 条)
onReactivated(async () => {
  const my = seq, before = status.value?.poolSnapshotAt
  const st = await paramsApi.status(ym.value).catch(() => null)
  if (my !== seq || !st) return
  if (st.poolSnapshotAt !== before) loadMonth()
  else status.value = st
})

const generated = computed(() => loss.value?.generated ?? false)
const units = computed(() => (loss.value?.units ?? []).filter(u => u.zone === zone.value))
const reconRows = computed(() =>
  buildLossReconRows((loss.value?.recon ?? []).find(r => r.zone === zone.value)))
const foot = computed(() => lossFooter(units.value))
const staleMsg = computed(() => staleText(status.value, 'pool'))

// 列模型:铝缆列仅 p2,公摊分摊度数列仅 p1
const isP2 = computed(() => zone.value === 'p2')
// 基础 9 列(位置/总表/分表/损耗量/原率/调整度/调整损/收租率/备注)+铝缆(p2)+公摊度数(p1)
const colCount = computed(() => 9 + (isP2.value ? 1 : 0) + (zone.value === 'p1' ? 1 : 0))
// 「位置」列定宽按期别取:一期是单栋名(+「仅按公摊分摊度数」徽标)230 够;二期共用总表的归组标签
// 「二期 二车间/二期 三车间/二期 四车间(二期 三车间供电)」实测 331px,给 360 不截(用户可见文字一律不截断)
// ponytail: 归组再并进一栋(4 栋一组 ≈ 430px)会再截 —— 到时按 units 里最长 label 估宽
const LBL_W = computed(() => (isP2.value ? 360 : 230))
const w = (px: number) => ({ width: px + 'px', minWidth: px + 'px', maxWidth: px + 'px' })
const fixLbl = computed(() => ({ ...w(LBL_W.value), left: '0px', borderRight: '1px solid var(--border-subtle)' }))

// ── 只读镜像:格里的数是快照(生成时用的值),徽标是**当前生效**参数的生效方式(仅本月 / 长期);两者不一致时 stale 条会亮 ──
// LIST-PAGE-SPEC §8:模板里每格 4 次调用,徽标对象按 (栋,键) 在 computed 里建一次 Map,模板只 get(不在渲染里线性 find + new 对象)
interface ParamBadge { text: string; tone: 'month' | 'from' | 'inherit'; title: string }
const badges = computed(() => {
  const m = new Map<string, ParamBadge>()
  for (const r of params.value) {
    if (r.mode == null) continue
    const b = rangeBadge(r)
    m.set(`${r.scope}|${r.key}`, { text: b.tone === 'month' ? '仅本月' : '长期', tone: b.tone, title: `${r.rangeText} · 点击去计费参数页改` })
  }
  return m
})
const badgeOf = (buildingId: number, key: string) => badges.value.get(`building:${buildingId}|${key}`) ?? null
// G 悬浮分解式(spec §4.1):「(45.28 + 59.57 + 138.33 + 893.01 + 1195.53) ÷ 6 = 388.62」,分项=池名+本次生成的池快照净量
// (算式里不加千分位:「1,195.53 + …」的逗号会和加号打架)
const plain = (v: number | null | undefined) => (v == null ? '–' : String(v))
const gTitle = (u: AllocLossUnitDTO) => {
  const parts = u.gParts ?? []
  if (!parts.length || u.gDiv == null) return '公摊分摊度数 = 一期园区公共电池本月净量合计 ÷ 均摊栋数（四舍五入到 2 位），各栋同值；本月无池快照'
  return `公摊分摊度数 = 一期园区公共电池本月净量合计 ÷ 均摊栋数（四舍五入到 2 位），各栋同值\n`
    + `（${parts.map(p => plain(p.qty)).join(' + ')}）÷ ${plain(u.gDiv)} = ${plain(u.gQty)}\n`
    + parts.map(p => `${p.name}：${plain(p.qty)}`).join('\n')
}
// 收取损耗率:手工指定时并排显公式率(spec §4.2 快照同时保存两者)
const rateTitle = (u: AllocLossUnitDTO) => u.manualRate != null
  ? `损耗率（手工指定）${fpct(u.manualRate)}（公式算出 ${fpct(u.formulaRate)}）—— 手工指定的率在计费参数页按月填`
  : undefined

// ── 跳参数页(深链协议:KeepAlive 缓存实例只在 setup 消费 query,必须 openFresh) ──
const router = useRouter()
const tabs = useTabsStore()
const alertOpen = ref(false)
// edit=1:[去重算] 落地直接进编辑态(重算按钮只在编辑态出)
function gotoParams(section: 'monthly' | 'constant' | 'rule', edit = false) {
  alertOpen.value = false   // 抽屉里点走的:本屏被 KeepAlive 缓存,不关的话切回来抽屉还盖着
  tabs.openFresh('params', { pin: true })
  router.push({ path: '/params', query: { ym: ym.value, zone: zone.value, section, ...(edit ? { edit: '1' } : {}) } })
}

// ── 屏级告警(§6):本屏只有「快照过期」一类;chip 两态常驻,详情与动作都在抽屉里 ──
const alertGroups = computed<AlertGroup[]>(() => staleMsg.value ? [{
  key: 'stale',
  title: '快照过期',
  desc: '计费参数改过之后没有重算 —— 本屏的损耗量、损耗率还是改参前那份快照算出来的。'
      + '不处理的话,按这些率出的催缴单会一直沿用旧数。去计费参数页「重算本月」即可清除。',
  items: [{ text: staleMsg.value, hint: `${year.value}年${month.value}月`, onClick: () => gotoParams('monthly', true) }],
  action: { label: '去计费参数页重算', icon: 'refresh-cw', run: () => gotoParams('monthly', true) },
}] : [])
</script>

<template>
  <div v-if="!loss" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="ll-page">
    <!-- 标题行 -->
    <div class="ll-head">
      <div class="ll-head-l">
        <h2 class="ll-title"><span class="ic"><component :is="iconFor('trending-down')" :size="18" /></span>楼栋损耗</h2>
        <div style="width:110px">
          <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
        </div>
        <div style="width:92px">
          <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
        </div>
        <Segmented :options="ZONE_OPTS" v-model="zone" size="sm" />
      </div>
      <div class="ll-actions">
        <!-- §6:屏级告警入口,位置固定;无告警时 quiet 态仍占位 -->
        <FPAlertChip :count="alertGroups.length" @open="alertOpen = true" />
        <!-- 本屏零写入口:口径(损耗核算方式/归组/总表取数/不计入的表)、损耗调整度数/损耗率加点/手工指定率全在计费参数页 ③ 核算口径 -->
        <Button variant="outline" size="sm" title="本月对本期生效的损耗核算口径与人工参数,去计费参数页看 / 改" @click="gotoParams('rule')">
          <template #leading><component :is="iconFor('sliders-horizontal')" :size="14" /></template>
          核算口径设置
        </Button>
      </div>
    </div>

    <!-- 提示条:只剩「本月未生成」(首屏加载期,§3 允许);「快照过期」已改走 chip + 抽屉 -->
    <div v-if="!generated" class="ll-bar">
      <component :is="iconFor('info')" :size="14" />
      <span>{{ year }}年{{ month }}月未生成 —— 损耗快照为空;在「公共电核算」屏点「生成本月」或在「计费参数」页「重算本月」后此处落数。</span>
    </div>

    <!-- 台账式宽表:单元行 + 对账区两行(供电局总表 vs 各栋总表合计 / 各栋分表合计) + tfoot 合计 -->
    <div class="ll-wrap">
      <table class="ll-table">
        <thead>
          <tr>
            <th class="ll-th ll-fix-th ll-fix" :style="fixLbl">位置</th>
            <th class="ll-th" :style="w(108)">总表用电量</th>
            <th v-if="isP2" class="ll-th" :style="w(104)" title="仅列示,不计入总表 / 分表合计">铝缆用电量</th>
            <th class="ll-th" :style="w(108)">分表用电量</th>
            <th class="ll-th" :style="w(100)">损耗量</th>
            <th class="ll-th" :style="w(92)">原损耗率</th>
            <th v-if="zone === 'p1'" class="ll-th" :style="w(116)" title="一期:园区公共电池本月净量合计 ÷ 均摊栋数（四舍五入到 2 位），各栋同值；悬停格子看分解式">公摊分摊度数</th>
            <th class="ll-th" :style="w(116)" title="损耗调整度数（正数多收 / 负数少收），按楼栋按月；在计费参数页 ① 本月参数改">损耗调整度数</th>
            <th class="ll-th" :style="w(104)" title="损耗率加点（如 0.3%），按楼栋长期；在计费参数页 ② 长期常数改">损耗率加点</th>
            <th class="ll-th" :style="w(160)" title="按损耗核算方式算出的率；填了「损耗率（手工指定）」则以它为准并并排显示公式算出的率">收取损耗率</th>
            <th class="ll-th" :style="w(170)">备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in units" :key="u.headBuildingId">
            <td class="ll-fix" :style="fixLbl">
              <span class="ll-lbl" :title="u.label">
                {{ u.label }}
                <span v-if="u.variant === 'share_only'" class="ll-var" title="仅按公摊分摊度数核算：率 = 公摊分摊度数 ÷ 分母 + 加点">仅按公摊分摊度数</span>
                <span v-else-if="u.variant === 'none'" class="ll-var dim" title="不核算（组内无分表或设为只列示用量）">不核算</span>
              </span>
            </td>
            <td><span class="ll-nv" :class="{ empty: u.cQty == null }">{{ fmt(u.cQty) }}</span></td>
            <td v-if="isP2"><span class="ll-nv" :class="{ empty: u.cableQty == null }">{{ fmt(u.cableQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.dQty == null }">{{ fmt(u.dQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.eQty == null, neg: (u.eQty ?? 0) < 0 }">{{ fmt(u.eQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.rawRate == null }">{{ fpct(u.rawRate) }}</span></td>
            <!-- G:只读派生值,悬浮给分解式(池名+净量逐项 ÷ 均摊栋数);分栋差异不再走 G调整,走「调整度数」 -->
            <td v-if="zone === 'p1'">
              <span class="ll-nv help" :class="{ empty: u.gQty == null }" :title="gTitle(u)">{{ fmt(u.gQty) }}</span>
            </td>
            <!-- 损耗调整度数 / 损耗率加点:格里是快照值,徽标是当前生效参数的生效方式;点击去参数页改 -->
            <td>
              <span class="ll-nv ll-pv" :class="{ empty: u.adjQty == null }" title="点击去计费参数页改（① 本月参数 · 损耗调整度数）"
                    role="button" tabindex="0" @click="gotoParams('monthly')" @keydown.enter.prevent="gotoParams('monthly')">
                {{ fmt(u.adjQty) }}
                <span v-if="badgeOf(u.headBuildingId, 'loss_adj_qty')" class="ll-badge"
                      :class="badgeOf(u.headBuildingId, 'loss_adj_qty')!.tone" :title="badgeOf(u.headBuildingId, 'loss_adj_qty')!.title">
                  {{ badgeOf(u.headBuildingId, 'loss_adj_qty')!.text }}</span>
              </span>
            </td>
            <td>
              <span class="ll-nv ll-pv" :class="{ empty: u.adjRate == null }" title="点击去计费参数页改（② 长期常数 · 损耗率加点）"
                    role="button" tabindex="0" @click="gotoParams('constant')" @keydown.enter.prevent="gotoParams('constant')">
                {{ fpct(u.adjRate) }}
                <span v-if="badgeOf(u.headBuildingId, 'loss_adj_rate')" class="ll-badge"
                      :class="badgeOf(u.headBuildingId, 'loss_adj_rate')!.tone" :title="badgeOf(u.headBuildingId, 'loss_adj_rate')!.title">
                  {{ badgeOf(u.headBuildingId, 'loss_adj_rate')!.text }}</span>
              </span>
            </td>
            <td>
              <span class="ll-rate" :class="{ empty: u.tenantRate == null }" :title="rateTitle(u)">
                <template v-if="u.manualRate != null"><span class="ll-manual">手工指定</span>{{ fpct(u.tenantRate) }}<span class="ll-formula">（公式 {{ fpct(u.formulaRate) }}）</span></template>
                <template v-else>{{ fpct(u.tenantRate) }}</template>
              </span>
            </td>
            <td><span class="ll-txt" :title="u.note ?? undefined">{{ u.note ?? '–' }}</span></td>
          </tr>
          <tr v-if="units.length === 0">
            <td class="ll-noro" :colspan="colCount">{{ zoneLabel(zone) }}本月无损耗单元（需生成快照）</td>
          </tr>
          <!-- 对账区两行(读时派生;一期的合计排除 供电局对账=不参与 的 A座):供电局读数落「总表用电量」列,各栋合计落「分表用电量」列 -->
          <tr v-for="(r, i) in reconRows" :key="'rc' + i" class="ll-recon">
            <td class="ll-fix" :style="fixLbl"><span class="ll-lbl">{{ r.label }}</span></td>
            <td><span class="ll-nv" :class="{ empty: r.supplyQty == null }" title="供电局总表本月读数">{{ fmt(r.supplyQty) }}</span></td>
            <td v-if="isP2"></td>
            <td><span class="ll-nv" :class="{ empty: r.sumQty == null }" :title="i === 0 ? '各栋总表合计' : '各栋分表合计'">{{ fmt(r.sumQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: r.loss == null, neg: (r.loss ?? 0) < 0 }">{{ fmt(r.loss) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: r.rate == null }">{{ fpct(r.rate) }}</span></td>
            <td :colspan="colCount - 5 - (isP2 ? 1 : 0)"></td>
          </tr>
        </tbody>
        <!-- tfoot 合计:总表/铝缆/分表/损耗量 合计(率不合计) -->
        <tfoot>
          <tr>
            <th class="ll-fix" :style="fixLbl"><span class="ll-foot-lbl">合　计</span></th>
            <th><span class="ll-foot-v">{{ fmt(foot.cQty) }}</span></th>
            <th v-if="isP2"><span class="ll-foot-v">{{ fmt(foot.cableQty) }}</span></th>
            <th><span class="ll-foot-v">{{ fmt(foot.dQty) }}</span></th>
            <th><span class="ll-foot-v">{{ fmt(foot.eQty) }}</span></th>
            <th :colspan="colCount - 4 - (isP2 ? 1 : 0)"></th>
          </tr>
        </tfoot>
      </table>
    </div>

    <FPAlertPanel :open="alertOpen" :groups="alertGroups" @close="alertOpen = false" />
  </div>
</template>

<style scoped>
.ll-page { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

.ll-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.ll-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ll-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.ll-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.ll-actions { display: flex; align-items: center; gap: 8px; }

.ll-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }

/* ── 宽表(FPLedgerTable 手法) ── */
.ll-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); }
.ll-table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-family: var(--font-sans); }
.ll-table th, .ll-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0; }
.ll-table thead th { position: sticky; top: 0; background: var(--surface-card); color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: center; padding: 0 8px; z-index: 4; height: 38px; }
.ll-fix-th { z-index: 8; vertical-align: middle; }
.ll-table tbody td { height: 34px; background: var(--surface-white); vertical-align: middle; }
.ll-table tbody tr:hover td { background: var(--surface-card); }
.ll-fix { position: sticky; z-index: 3; background: var(--surface-white); }
.ll-table tbody tr:hover .ll-fix { background: var(--surface-card); }

.ll-lbl { display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.ll-var { flex: 0 0 auto; font-size: var(--fs-micro); font-weight: var(--fw-regular); color: var(--hue-blue); background: rgb(232, 240, 254); border-radius: var(--radius-full); padding: 1px 7px; cursor: help; }
.ll-var.dim { color: var(--text-muted); background: var(--bg-sunken); }

.ll-nv { display: block; text-align: right; font-size: 12px; padding: 0 8px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ll-nv.empty { color: var(--text-disabled); }
.ll-nv.neg { color: var(--hue-red); }
.ll-nv.help { cursor: help; text-decoration: underline dotted; text-underline-offset: 3px; }
/* 只读参数镜像格:可点(跳参数页),值 + 生效方式徽标 */
.ll-pv { cursor: pointer; display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.ll-pv:hover { color: var(--hue-blue); }
.ll-badge { flex: 0 0 auto; font-family: var(--font-sans); font-size: 10px; line-height: 14px; border-radius: var(--radius-full); padding: 0 5px; background: var(--bg-sunken); color: var(--text-muted); }
.ll-badge.month { background: rgb(255, 247, 235); color: rgb(180, 83, 9); }
.ll-badge.from { background: rgb(232, 240, 254); color: var(--hue-blue); }
.ll-rate { display: block; text-align: right; font-size: 12px; padding: 0 8px; font-weight: var(--fw-semibold); color: var(--hue-blue); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ll-rate.empty { color: var(--text-disabled); font-weight: var(--fw-regular); }
/* 手工率覆盖:「手工」小标 + 手工率(主)+ 公式率(灰,并排备查) */
.ll-manual { font-family: var(--font-sans); font-size: 10px; font-weight: var(--fw-regular); border-radius: var(--radius-full); padding: 0 5px; margin-right: 4px; background: rgb(255, 247, 235); color: rgb(180, 83, 9); vertical-align: 1px; }
.ll-formula { font-size: 10.5px; font-weight: var(--fw-regular); color: var(--text-muted); }
.ll-txt { display: block; text-align: left; font-size: 12px; padding: 0 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 对账区两行(分隔带样式对标 mlg-bsum) */
.ll-table tbody tr.ll-recon td { height: 40px; background: var(--surface-sunken); border-top: 2px solid var(--border-strong); border-bottom: 2px solid var(--border-strong); }
.ll-table tbody tr.ll-recon + tr.ll-recon td { border-top: none; }

.ll-noro { text-align: center; padding: 40px 16px; color: var(--text-disabled); font-size: var(--fs-label); }

.ll-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 40px; font-weight: var(--fw-semibold); background: var(--surface-white); border-top: 2px solid var(--border-strong); font-family: var(--font-mono); color: var(--text-primary); }
.ll-table tfoot th.ll-fix { z-index: 7; }
.ll-foot-lbl { display: block; padding: 0 10px; text-align: left; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
.ll-foot-v { display: block; text-align: right; padding: 0 8px; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--brand-deep); }
</style>
