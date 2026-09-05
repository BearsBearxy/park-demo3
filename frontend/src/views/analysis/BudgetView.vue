<script setup lang="ts">
// 预算对比(budget)v2 — spec §二.15 + 图表清晰化 §T3:五年子弹图小倍数(一 option 三 grid 横排,
// 实际=柱/预算=紫杠刻度,前瞻年只有紫杠,ECharts)
// + 达成 bullets(SVG 保留)+ 总表明细(关键行点击→深链对应 /rent-pnl 等附表路由)+ 前瞻卡。
// 数据与口径与 v1 完全一致:budget_row 全量 + PNL_SOT_FROM_YEAR 起实际=损益附表实时推算;
// 成本费用 = 收入 − 利润。图数据纯函数抽于 budgetView.logic.ts(单测)。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useTabsStore } from '@/stores/tabs'
import { periodLink, periodOf } from '@/nav/deepLink'
import AnaShell from './AnaShell.vue'
import AnaBullet from '@/components/ana/AnaBullet.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import { iconFor } from '@/components/ds/icon'
import { usePeriod } from '@/analysis/usePeriod'
import { fetchBudgetAll, fetchPnlSummary, fetchPnlYear } from '@/analysis/anaData'
import { bulletOption, extractS5GroupTotals, matchBudgetKey, pnlKeyTotals, PNL_SOT_FROM_YEAR, type BudgetKey } from '@/analysis/budget'
import type { BudgetRowDTO } from '@/api/budget'
import { finMoney, finFmt, finWan } from '@/utils/finFmt'
import { sgn, NEG, POS } from '@/components/ana/anaFmt'
import { comboBarData, comboBudgetData, keyRoute } from './budgetView.logic'

const router = useRouter()
const tabs = useTabsStore()
const period = usePeriod()
const year = computed(() => period.sel.value.year)

const rows = ref<BudgetRowDTO[]>([])
const pnlKeys = ref<Map<number, Record<BudgetKey, number | null>>>(new Map())
const ready = ref(false)

async function reload() {
  try {
    rows.value = await fetchBudgetAll()
    const pnlYears = [...new Set(rows.value.map(r => r.year))].filter(y => y >= PNL_SOT_FROM_YEAR)
    const m = new Map<number, Record<BudgetKey, number | null>>()
    await Promise.all(pnlYears.map(y =>
      // s5 原始行另拉一次:管理/销售/财务/修缮组级小计(复审:整体 s5 口径会假超支)
      Promise.all([fetchPnlSummary(y), fetchPnlYear('s5', y).catch(() => null)])
        .then(([s, s5dto]) => { m.set(y, pnlKeyTotals(s, s5dto ? extractS5GroupTotals(s5dto) : undefined)) })
        .catch(() => { /* 无 pnl → 用文件值 */ })))
    pnlKeys.value = m
  } catch { rows.value = [] } finally { ready.value = true }
}
onMounted(reload)
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例 —— 纯读屏没有草稿要保,
// 切回来该看最新的(导入中心导完租户,回这屏必须是新名单)。
onReactivated(() => { void reload() })

// ── 年×关键行取值(实际:pnl 推算优先,回退文件发生额) ──
const years = computed(() => [...new Set(rows.value.map(r => r.year))].sort((a, b) => a - b))
const byYear = computed(() => {
  const m = new Map<number, BudgetRowDTO[]>()
  for (const r of rows.value) {
    const list = m.get(r.year) ?? []
    list.push(r)
    m.set(r.year, list)
  }
  for (const list of m.values()) list.sort((a, b) => a.sortOrder - b.sortOrder)
  return m
})
function keyRow(y: number, k: BudgetKey): BudgetRowDTO | undefined {
  return byYear.value.get(y)?.find(r => matchBudgetKey(r.label, r.sub) === k)
}
function keyBudget(y: number, k: BudgetKey): number | null { return keyRow(y, k)?.budget ?? null }
function keyActual(y: number, k: BudgetKey): number | null {
  const p = pnlKeys.value.get(y)?.[k]
  return p != null ? p : keyRow(y, k)?.actual ?? null
}
// 成本费用 = 收入 − 利润(同侧口径两者都有才算)
function costOf(y: number, side: 'budget' | 'actual'): number | null {
  const get = side === 'budget' ? keyBudget : keyActual
  const r = get(y, 'revenue'), p = get(y, 'profit')
  return r != null && p != null ? r - p : null
}

// ── 卡1 五年子弹图(ECharts,§T3):三 grid 横排(收入/成本费用/利润),实际=柱+预算=紫杠;
//    前瞻年(仅预算)无柱只有紫杠;取数仍走 comboBarData/comboBudgetData,只换呈现 ──
interface BandCol { year: number; actual: number | null; budget: number | null }
const bandGroups = computed(() => {
  const mk = (actual: (y: number) => number | null, budget: (y: number) => number | null): BandCol[] =>
    years.value.map(y => ({ year: y, actual: actual(y), budget: budget(y) }))
  return [
    { name: '收入', cols: mk(y => keyActual(y, 'revenue'), y => keyBudget(y, 'revenue')) },
    { name: '成本费用', cols: mk(y => costOf(y, 'actual'), y => costOf(y, 'budget')) },
    { name: '利润', cols: mk(y => keyActual(y, 'profit'), y => keyBudget(y, 'profit')) },
  ]
})
const COMBO_COLOR: Record<string, string> = { 收入: '#378ADD', 成本费用: '#85B7EB', 利润: '#185FA5' }
const comboOpt = computed<object>(() => bulletOption(
  years.value.map(String),
  bandGroups.value.map(g => ({
    name: g.name, color: COMBO_COLOR[g.name],
    bars: comboBarData(g.cols), budget: comboBudgetData(g.cols),
  })),
))

// ── 卡2 当年达成率 bullets(成本超预算红 invert;SVG 保留) ──
const bulletItems = computed(() => {
  const y = year.value
  const defs: { name: string; a: number | null; b: number | null; invert: boolean }[] = [
    { name: '收入', a: keyActual(y, 'revenue'), b: keyBudget(y, 'revenue'), invert: false },
    { name: '成本费用', a: costOf(y, 'actual'), b: costOf(y, 'budget'), invert: true },
    { name: '利润', a: keyActual(y, 'profit'), b: keyBudget(y, 'profit'), invert: false },
  ]
  return defs.flatMap(d => (d.a != null && d.b != null && d.b > 0
    ? [{ name: d.name, a: d.a, b: d.b, invert: d.invert, rate: d.a / d.b * 100 }] : []))
})
// 结构同 AnaBullet.BulletRow(不从 SFC 导类型,结构化匹配即可)
const bulletRows = computed(() => bulletItems.value.map(d => ({
  name: d.name, value: +d.rate.toFixed(1), target: 100,
  color: d.invert ? (d.rate <= 100 ? POS : NEG) : undefined,
})))

// ── 卡3 总表明细(当年):项目|预算|实际|达成率|差异;关键行点击 → 深链对应损益附表 ──
const detail = computed(() => {
  const y = year.value
  return (byYear.value.get(y) ?? []).map(r => {
    const k = matchBudgetKey(r.label, r.sub)
    const p = k ? pnlKeys.value.get(y)?.[k] ?? null : null
    const actual = p != null ? p : r.actual
    return {
      label: r.label, sub: r.sub, note: r.note,
      budget: r.budget, actual, fromPnl: p != null,
      link: keyRoute(k),
      rate: actual != null && r.budget ? actual / r.budget * 100 : null,
      diff: actual != null && r.budget != null ? actual - r.budget : null,
    }
  })
})
// 深链走 openFresh(页签语义,spec §4.1);发链 periodLink(§4.2):年表屏只取年,p=YYYY(改前 ?y=,parsePeriod 仍认旧书签)
function goSched(nav: string): void {
  tabs.openFresh(nav, { pin: true })
  router.push(periodLink(nav, { p: periodOf(year.value, null) }))
}

// ── 卡4 前瞻:最大「只有预算、无实际」年 vs 上一年实际 ──
const outlook = computed(() => {
  const fy = [...years.value].reverse().find(y => keyBudget(y, 'revenue') != null && keyActual(y, 'revenue') == null)
  if (!fy) return null
  const base = fy - 1
  const items = [
    { name: '收入', b: keyBudget(fy, 'revenue'), a: keyActual(base, 'revenue') },
    { name: '成本费用', b: costOf(fy, 'budget'), a: costOf(base, 'actual') },
    { name: '利润', b: keyBudget(fy, 'profit'), a: keyActual(base, 'profit') },
  ].filter((i): i is { name: string; b: number; a: number | null } => i.b != null)
  return items.length ? { fy, base, items } : null
})
const chgPct = (b: number, a: number | null): string => (a ? sgn((b / a - 1) * 100) : '—')

// ── KPI 条(达成率三项 + 前瞻收入预算 + 年份覆盖) ──
const achOf = (name: string) => bulletItems.value.find(d => d.name === name) ?? null
const kpiAch = (name: string) => {
  const d = achOf(name)
  return { value: d ? d.rate.toFixed(1) + '%' : '—', delta: d ? +(d.rate - 100).toFixed(1) : null }
}
const kpiOutlook = computed(() => {
  const rev = outlook.value?.items.find(i => i.name === '收入')
  if (!outlook.value || !rev) return null
  return { fy: outlook.value.fy, base: outlook.value.base, b: rev.b, delta: rev.a ? +((rev.b / rev.a - 1) * 100).toFixed(1) : null }
})
</script>

<template>
  <!-- §五:年敏感屏(预算为年度口径),只年控件;数据一次拉全年份,达成/明细/前瞻均随所选年响应式派生 -->
  <AnaShell period-mode="year">
    <template #kpis>
      <template v-if="ready && rows.length">
        <AnaKpiTile :label="year + ' 收入达成'" :value="kpiAch('收入').value" :delta="kpiAch('收入').delta" kind="vs 预算" />
        <AnaKpiTile :label="year + ' 成本费用达成'" :value="kpiAch('成本费用').value" :delta="kpiAch('成本费用').delta" kind="vs 预算" invert />
        <AnaKpiTile :label="year + ' 利润达成'" :value="kpiAch('利润').value" :delta="kpiAch('利润').delta" kind="vs 预算" />
        <AnaKpiTile v-if="kpiOutlook" :label="kpiOutlook.fy + ' 收入预算(前瞻)'" :value="finWan(kpiOutlook.b)"
          :delta="kpiOutlook.delta" :kind="'较 ' + kpiOutlook.base + ' 实际'" />
        <AnaKpiTile label="预算年份覆盖" :value="years[0] + '–' + years[years.length - 1]"
          :note="years.length + ' 个年度 · ' + PNL_SOT_FROM_YEAR + ' 起实际=损益推算'" />
      </template>
    </template>

    <div v-if="!ready" class="page-loading"><span class="page-spin" /></div>

    <!-- 无预算数据 → 全屏空态引导导入中心 -->
    <div v-else-if="!rows.length" class="bv2-page">
      <AnaEmpty label="暂无预算数据" hint="在导入中心导入「年度预算」工作簿(全面预算总表)后,这里展示五年对比与达成率"
        to="/import" to-text="去导入中心" />
    </div>

    <div v-else class="bv2-page">
      <div v-if="period.sel.value.gran === 'month'" class="bv2-gran-hint">
        <component :is="iconFor('info')" :size="13" />预算为年度口径,本屏按 {{ year }} 全年展示
      </div>

      <div class="av2-grid">
        <!-- 主图 span8:五年子弹图小倍数(§T3) -->
        <div class="av2-card av2-s8">
          <div class="av2-card-h">
            <span class="t">五年对比 · 实际 vs 预算目标</span>
            <span class="hint">柱=实际 · 紫杠=预算目标<span class="hint-desk"> · 悬停看达成率</span></span>
          </div>
          <AnaEChart :option="comboOpt" :height="300" />
        </div>

        <!-- span4:当年达成率 bullets(SVG 保留) -->
        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">{{ year }} 年达成率</span><span class="hint">实际 / 预算 · 超支标红</span></div>
          <template v-if="bulletItems.length">
            <AnaBullet :rows="bulletRows" :target="100" unit="%" />
            <div class="bv2-ach-rows">
              <div v-for="d in bulletItems" :key="d.name" class="r">
                <span class="nm">{{ d.name }}</span>
                <span class="v">实际 {{ finMoney(d.a) }} / 预算 {{ finMoney(d.b) }}</span>
                <span class="gap" :style="{ color: (d.invert ? d.a > d.b : d.a < d.b) ? 'var(--hue-red)' : 'var(--hue-blue)' }">
                  {{ d.invert ? (d.a > d.b ? '超支 ' : '结余 ') : (d.a < d.b ? '缺口 ' : '超额 ') }}{{ finMoney(Math.abs(d.b - d.a)) }}
                </span>
              </div>
            </div>
          </template>
          <AnaEmpty v-else :label="year + ' 年无「预算 vs 实际」配对数据'"
            hint="需要该年预算行与实际(损益附表推算或文件发生额)同时存在" />
        </div>

        <!-- span8:总表明细(关键行点击 → 深链对应损益附表) -->
        <div class="av2-card av2-s8">
          <div class="av2-card-h">
            <span class="t">{{ year }} 年总表明细</span>
            <span class="hint">关键行实际=损益推算(系统标记)<span class="hint-desk"> · 点击关键行 → 对应损益附表</span></span>
          </div>
          <div v-if="detail.length" class="bv2-tbl-wrap">
            <table class="bv2-tbl">
              <thead>
                <tr><th>项目</th><th class="n">预算</th><th class="n">实际</th><th class="n">达成率</th><th class="n">差异</th><th>备注</th></tr>
              </thead>
              <tbody>
                <tr v-for="(d, i) in detail" :key="i" :class="{ sub: d.sub, key: d.fromPnl, lk: !!d.link }"
                  :title="d.link ? '打开对应损益附表' : undefined" @click="d.link && goSched(d.link)">
                  <td class="lbl">{{ d.label }}<span v-if="d.fromPnl" class="pnl-tag">系统</span>
                    <component :is="iconFor('arrow-right')" v-if="d.link" :size="12" class="go-ic" /></td>
                  <td class="n">{{ d.budget != null ? finFmt(d.budget) || '0.00' : '—' }}</td>
                  <td class="n">{{ d.actual != null ? finFmt(d.actual) || '0.00' : '—' }}</td>
                  <td class="n">{{ d.rate != null ? d.rate.toFixed(1) + '%' : '—' }}</td>
                  <td class="n" :style="d.diff != null && d.diff < 0 ? { color: 'var(--hue-red)' } : undefined">
                    {{ d.diff != null ? (d.diff < 0 ? '−' : '+') + finFmt(Math.abs(d.diff)) : '—' }}</td>
                  <!-- 预算备注常写整段说明(如「包括除四害、绿化、消防维护…」),截断后看不到口径 -->
                  <td class="note" :title="d.note ?? undefined">{{ d.note ?? '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <AnaEmpty v-else :label="year + ' 年无预算总表行'" hint="切换年份查看,或到导入中心导入该年预算" to="/import" to-text="去导入中心" />
        </div>

        <!-- span4:前瞻卡 -->
        <div class="av2-card av2-s4">
          <div class="av2-card-h">
            <span class="t">{{ outlook ? outlook.fy + ' 前瞻' : '前瞻' }}</span>
            <span class="hint">{{ outlook ? `${outlook.fy} 预算 vs ${outlook.base} 实际` : '暂无仅预算年份' }}</span>
          </div>
          <div v-if="outlook" class="bv2-outlook">
            <div v-for="i in outlook.items" :key="i.name" class="r">
              <span class="nm">{{ i.name }}</span>
              <span class="v">{{ finMoney(i.b) }}</span>
              <span class="d" :style="{ color: (i.a != null && i.b >= i.a) === (i.name !== '成本费用') ? 'var(--hue-blue)' : 'var(--hue-red)' }">
                {{ chgPct(i.b, i.a) }}</span>
              <span class="base">{{ i.a != null ? `上年实际 ${finMoney(i.a)}` : '上年实际 —' }}</span>
            </div>
          </div>
          <AnaEmpty v-else label="暂无前瞻年份" hint="导入含下年度预算的「全面预算总表」后展示" to="/import" to-text="去导入中心" />
        </div>
      </div>

      <AnaMethodNote>
        口径:{{ PNL_SOT_FROM_YEAR }} 年起关键行(收入总计/成本总计/费用总计/利润)实际=损益附表实时推算(系统标记),其余行为文件值;
        成本费用 = 收入 − 利润;预算为年度口径。
      </AnaMethodNote>
    </div>
  </AnaShell>
</template>

<style scoped>
.bv2-page { display: flex; flex-direction: column; gap: 10px; width: 100%; box-sizing: border-box; }
.bv2-gran-hint { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--hue-orange); background: rgb(255,243,230); border-radius: var(--radius-full); padding: 5px 13px; white-space: nowrap; }

/* 达成明细行 */
.bv2-ach-rows { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; border-top: 1px solid var(--divider); padding-top: 12px; }
.bv2-ach-rows .r { display: flex; align-items: baseline; gap: 10px; font-size: 12px; flex-wrap: wrap; }
.bv2-ach-rows .nm { flex: 0 0 64px; color: var(--text-secondary); }
.bv2-ach-rows .v { font-family: var(--font-mono); color: var(--text-muted); }
.bv2-ach-rows .gap { margin-left: auto; font-family: var(--font-mono); font-weight: var(--fw-semibold); white-space: nowrap; }

/* 前瞻卡 */
.bv2-outlook { display: flex; flex-direction: column; gap: 12px; }
.bv2-outlook .r { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.bv2-outlook .nm { flex: 0 0 64px; font-size: 12px; color: var(--text-secondary); }
.bv2-outlook .v { font-size: 15px; font-weight: var(--fw-semibold); font-family: var(--font-mono); color: var(--text-primary); }
.bv2-outlook .d { font-size: 12px; font-family: var(--font-mono); font-weight: var(--fw-semibold); }
.bv2-outlook .base { margin-left: auto; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); white-space: nowrap; }

/* 总表明细 */
.bv2-tbl-wrap { overflow: auto; max-height: 420px; }
.bv2-tbl { border-collapse: separate; border-spacing: 0; width: 100%; font-size: var(--fs-label); }
.bv2-tbl th, .bv2-tbl td { padding: 8px 12px; border-bottom: 1px solid var(--divider); text-align: left; white-space: nowrap; }
.bv2-tbl th { font-size: 11px; color: var(--text-muted); font-weight: var(--fw-semibold); position: sticky; top: 0; background: var(--surface-white); }
.bv2-tbl th.n, .bv2-tbl td.n { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.bv2-tbl tr.sub .lbl { padding-left: 34px; color: var(--text-secondary); }
.bv2-tbl tr.key td { font-weight: var(--fw-semibold); background: var(--surface-card); }
.bv2-tbl tr.lk { cursor: pointer; }
.bv2-tbl tr.lk:hover td { background: var(--bg-hover); }
.bv2-tbl .pnl-tag { margin-left: 8px; font-size: var(--fs-micro); font-weight: var(--fw-semibold); color: var(--hue-blue); background: var(--accent-sky); border-radius: var(--radius-full); padding: 1px 7px; }
.bv2-tbl .go-ic { margin-left: 6px; color: var(--text-disabled); vertical-align: middle; }
.bv2-tbl .note { max-width: 340px; overflow: hidden; text-overflow: ellipsis; color: var(--text-muted); font-size: var(--fs-micro); }
</style>
