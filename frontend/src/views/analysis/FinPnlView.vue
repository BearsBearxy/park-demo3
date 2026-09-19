<script setup lang="ts">
// 利润表分析(fin-pnl)v2 — spec §二.7:公司选择器保留;全年损益瀑布(ECharts 透明垫底柱,
// 点级→该科目 12 月趋势卡切换);12 月趋势(对比 环比/预算,预算=budget_row 当年值/12 虚线);
// 收入结构堆叠;is 快照表保留。排版=AnaShell v2(#kpis=迷你利润表链条,spec 2026-07-11 §C)+ av2-grid(主图 s8/次图 s4)。
// 数值口径与 v1 完全一致(snap/wf/结构序列计算未动);数据变换纯函数见 finPnl.logic.ts。
import { computed, ref, watch } from 'vue'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaPill from '@/components/ana/AnaPill.vue'
import AnaBarRow from '@/components/ana/AnaBarRow.vue'
import AnaBarRows from '@/components/ana/AnaBarRows.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import DsSelect from '@/components/ds/Select.vue'
import { iconFor } from '@/components/ds/icon'
import { usePeriod } from '@/analysis/usePeriod'
import { useCompare } from '@/analysis/useCompare'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import {
  fetchAvailableMonths, fetchBudgetAll, fetchCompanies, fetchPnlSummary, fetchReportAll, fetchReportPeriod,
  type PnlSummary,
} from '@/analysis/anaData'
import { computeRow, IS_ROWS } from '@/reports/incomeStatement'
import { FILL, fint, fnum } from '@/components/ana/anaFmt'
import {
  budgetMonthlyWan, momOverlay, pnlChain, structOption, subjectMonthly, subjectTrendOption, waterfallOption,
  type WfItem,
} from './finPnl.logic'
import type { BudgetRowDTO } from '@/api/budget'
import type { CompanyDTO } from '@/types/ledger'
import type { ReportPeriodDTO } from '@/types/report'

const period = usePeriod()
const ready = ref(false)
const cmp = useCompare(['mom', 'budget'])   // 与 AnaShell :compare 同支持集

// ── 公司选择器(法人口径;'0'=全部公司汇总,只影响 is 快照卡) ──
const companies = ref<CompanyDTO[]>([])
const cid = ref('0')
const companyOpts = computed(() => [
  { value: '0', label: '全部公司(汇总)' },
  ...companies.value.map((c) => ({ value: String(c.id), label: c.name })),
])
// 已画在屏上的那一组(年 / 报表月 / 公司)。选择器立刻变(控件回显),这三个等数据一起换 ——
// 换期在途旧内容留在原地退让(C5-02),卡头与口径徽章不许先印新期配旧数
const loadedYear = ref(period.sel.value.year)
const loadedYm = ref<string | null>(null)
const loadedCid = ref(cid.value)
const companyLabel = computed(() =>
  loadedCid.value === '0' ? '全部公司(汇总)' : companies.value.find((c) => String(c.id) === loadedCid.value)?.name ?? '—')

// ── 期间派生:pnl 用所选年;is 快照月 = 所选年内最近报表月(§五策略3:年切真响应,
// 不再跨年沿用旧快照;所选年无报表 → null → 空态) ──
const year = computed(() => period.sel.value.year)
const reportMonths = ref<string[]>([])
const reportYm = computed(() => {
  const inYear = reportMonths.value.filter((m) => +m.slice(0, 4) === year.value)
  return inYear.length ? inYear[inYear.length - 1] : null
})

// ── 数据 ──
const pnlSum = ref<PnlSummary | null>(null)
const isDto = ref<ReportPeriodDTO | null>(null)
const budgetRows = ref<BudgetRowDTO[]>([])
// 在途(C5-02):初值 true —— 首进那趟不点亮(useDeferredFlag 只认变化);换年 / 换公司 / 报表月补取才退让
const loading = ref(true)
const staleShown = useDeferredFlag(loading)
let token = 0
watch([year, cid, reportYm], async ([y, c, rym]) => {
  const t = ++token
  loading.value = true
  try {
    const [cos, months, buds] = await Promise.all([
      fetchCompanies(), fetchAvailableMonths(),
      fetchBudgetAll().catch(() => [] as BudgetRowDTO[]),   // 预算仅供对比虚线,失败不拖垮本屏
    ])
    const [ps, dto] = await Promise.all([
      y ? fetchPnlSummary(y) : Promise.resolve(null),
      rym
        ? (c === '0'
            ? fetchReportAll('is', +rym.slice(0, 4), +rym.slice(5, 7))
            : fetchReportPeriod('is', +c, +rym.slice(0, 4), +rym.slice(5, 7)))
        : Promise.resolve(null),
    ])
    if (t !== token) return
    companies.value = cos
    reportMonths.value = months.sources.report ?? []
    budgetRows.value = buds
    pnlSum.value = ps
    isDto.value = dto
  } catch {
    if (t === token) { pnlSum.value = null; isDto.value = null }
  } finally {
    // 只有取的就是当前该取的那一期才算落地(同 FinBalanceView)。首进第一趟 rym 还是 null(月份列表没到),
    // 它一写 reportMonths,reportYm 就变、紧跟着第二趟 —— 这里先亮 ready 会在两趟之间闪一张
    // 「该公司该期无利润表数据」空卡(或整屏年空态),第二趟到数再换掉,整页跳一下。
    if (t === token && rym === reportYm.value) {
      ready.value = true
      loading.value = false
      loadedYear.value = y
      loadedYm.value = rym
      loadedCid.value = c
    }
  }
}, { immediate: true })

// §五策略3:所选年园区损益与法人报表均无数据 → 全屏空态(禁止沿用旧年图表)
const yearEmpty = computed(() => !pnlSum.value?.months.length && !loadedYm.value)

// ── is 快照取数(复用 reports/incomeStatement 已测小计公式;自定义子类行求和) ──
function isValOf(dto: ReportPeriodDTO): (no: number, field: 'cur' | 'ytd') => number {
  const kids = new Map<string, string[]>()
  for (const cr of dto.customRows) {
    const l = kids.get(cr.parentKey) ?? []
    l.push(cr.rowKey)
    kids.set(cr.parentKey, l)
  }
  const leaf = (no: number, f: string): number => dto.amounts[String(no)]?.[f] ?? 0
  const kidSum = (no: number, f: string): number | null => {
    const ks = kids.get(String(no))
    if (!ks?.length) return null
    return ks.reduce((s, k) => s + (dto.amounts[k]?.[f] ?? 0), 0)
  }
  return (no, field) => computeRow(no, field, leaf, kidSum)
}
const isVal = computed(() => (isDto.value ? isValOf(isDto.value) : null))
const hasIs = computed(() => !!isDto.value && Object.keys(isDto.value.amounts).length > 0)

const snap = computed(() => {
  const v = isVal.value
  if (!v) return null
  const rev = v(1, 'ytd'), cost = v(2, 'ytd')
  const op = v(21, 'ytd'), tot = v(30, 'ytd'), net = v(32, 'ytd')
  const nonOp = v(22, 'ytd') - v(24, 'ytd')
  return { rev, cost, op, tot, net, nonOp }
})

// KPI 条 → 迷你利润表链条(spec 2026-07-11 §C:替换普通瓦片;数值口径=snap,同 v1)
const chain = computed(() => (snap.value ? pnlChain(snap.value) : []))
const chainAmt = (v: number): string => (v < 0 ? '−' : '') + '¥' + fint(Math.abs(v) / 1e4)   // 单位「万」在模板里另画 14 号
// 链条尾注(口径同原「营业外占利润总额」瓦片:占比=nonOp/tot,tot=0 → —)
const nonOpNote = computed(() => {
  const s = snap.value
  if (!s) return ''
  const share = s.tot ? Math.round((s.nonOp / s.tot) * 100) + '%' : '—'
  return '营业外占利润总额 ' + share + ' · 营业外净额 ¥' + fnum(s.nonOp / 1e4, 1) + '万'
})

// ── pnl 园区口径:瀑布(全年累计,计算同 v1) ──
const yearSum = (a: (number | null)[]): number => a.reduce((s: number, v) => s + (v ?? 0), 0)
const wf = computed<WfItem[]>(() => {
  const ps = pnlSum.value
  if (!ps || !ps.months.length) return []
  const by = ps.bySchedule
  const rev = (['s1', 's2', 's3', 's4'] as const).reduce((s, k) => s + yearSum(by[k].rev), 0) / 1e4
  const items: WfItem[] = [
    { name: '营业收入', value: rev, type: 'start' },
    { name: '租金成本', value: -yearSum(by.s1.cost) / 1e4, type: 'dec' },
    { name: '用电成本', value: -yearSum(by.s2.cost) / 1e4, type: 'dec' },
    { name: '用水成本', value: -yearSum(by.s3.cost) / 1e4, type: 'dec' },
    { name: '运管成本', value: -yearSum(by.s4.cost) / 1e4, type: 'dec' },
    { name: '运营费用', value: -yearSum(by.s5.cost) / 1e4, type: 'dec' },
  ]
  const end = items.reduce((s, it) => s + it.value, 0)
  return [...items, { name: '园区总损益', value: end, type: 'end' }]
})
const wfOpt = computed(() => waterfallOption(wf.value))

// 瀑布点级 → 科目 12 月趋势卡切换(spec 下钻)
const subject = ref('营业收入')
function onWfClick(params: unknown) {
  const name = (params as { name?: string }).name
  if (name && wf.value.some((it) => it.name === name)) subject.value = name
}

// ── 12 月趋势(选中科目;对比开关:环比=上期虚线/预算=budget_row 当年值/12 虚线) ──
const mLabels = computed(() => (pnlSum.value?.months ?? []).map((m) => m + '月'))
const subjectVals = computed(() => (pnlSum.value ? subjectMonthly(pnlSum.value, subject.value) : []))
const budgetWan = computed(() => budgetMonthlyWan(budgetRows.value, loadedYear.value, subject.value))
const trendOpt = computed(() => subjectTrendOption(mLabels.value, subjectVals.value, subject.value, {
  mom: cmp.mode.value === 'mom' ? momOverlay(subjectVals.value) : null,
  budget: cmp.mode.value === 'budget' ? budgetWan.value : null,
}))

// ── 收入结构堆叠(附表1-4,序列值同 v1:缺月按 0) ──
const at = (arr: (number | null)[], m: number): number => (arr[m - 1] ?? 0) / 1e4
const structOpt = computed(() => {
  const ps = pnlSum.value
  if (!ps) return {}
  const defs = [['s1', '租金'], ['s2', '用电'], ['s3', '用水'], ['s4', '运管']] as const
  return structOption(mLabels.value,
    defs.map(([k, nm]) => ({ name: nm, values: ps.months.map((m) => at(ps.bySchedule[k].rev, m)) })))
})

// ── is 科目占比 + 全表(同 v1) ──
const shareRows = computed(() => {
  const v = isVal.value, s = snap.value
  if (!v || !s || !s.rev) return []
  const defs: [string, number][] = [
    ['营业成本', 2], ['营业税金及附加', 3], ['销售费用', 11], ['管理费用', 14], ['财务费用', 18], ['所得税费用', 31],
  ]
  return defs.map(([nm, no], i) => ({
    name: nm, value: +((v(no, 'ytd') / s.rev) * 100).toFixed(1), fill: FILL[i % FILL.length],
  }))
})

interface IsTblRow { label: string; level: number; type: string; cur: number | null; ytd: number | null; share: number | null }
const isTable = computed<IsTblRow[]>(() => {
  const v = isVal.value
  if (!v) return []
  const rev = v(1, 'ytd')
  return IS_ROWS.map((r) => (r.type === 'label'
    ? { label: r.label, level: r.level, type: r.type, cur: null, ytd: null, share: null }
    : {
        label: r.label, level: r.level, type: r.type,
        cur: v(r.no, 'cur'), ytd: v(r.no, 'ytd'),
        share: rev ? (v(r.no, 'ytd') / rev) * 100 : null,
      }))
})

const fmtW = (v: number): string => fnum(v / 1e4, 1)   // 表格单元(元→万,1 位小数)
</script>

<template>
  <!-- §五:年敏感屏 → 只年控件(进屏强制年粒度) -->
  <AnaShell :compare="['mom', 'budget']" period-mode="year" :busy="staleShown">
    <template #tools>
      <span class="fin-name"><component :is="iconFor('bar-chart-3')" :size="14" />利润表分析</span>
      <span class="fin-lbl"><component :is="iconFor('scale')" :size="12" />公司</span>
      <DsSelect size="sm" :options="companyOpts" :model-value="cid" :style="{ width: '172px' }"
        @update:model-value="cid = $event" />
    </template>

    <!-- §C 迷你利润表链条:收入−成本=毛利−费用=营业利润→净利润(连接符由 kind 派生);!snap 不渲 -->
    <template #kpis>
      <div v-if="chain.length" class="fin-chain">
        <template v-for="(n, i) in chain" :key="n.label">
          <span v-if="i" class="op">{{ n.kind === 'neg' ? '−' : chain[i - 1].kind === 'neg' ? '=' : '→' }}</span>
          <!-- 格底(KpiFormula A):加减的数 slate、等号右边的结果 sky、最后的净利润 blue;利润类(sub)为负标红,收入 / 成本不标 -->
          <span class="node" :class="i === chain.length - 1 ? 'last' : n.kind === 'sub' ? 'res' : ''">
            <span class="nl">{{ n.label }}</span>
            <span class="nv" :style="n.kind === 'sub' && n.value < 0 ? { color: 'var(--delta-down-text)' } : undefined">{{ chainAmt(n.value) }}<span class="u">万</span></span>
            <span class="np">{{ n.pct == null ? '—' : n.pct + '%' }}</span>
          </span>
        </template>
        <span class="tail">{{ nonOpNote }}</span>
      </div>
    </template>

    <!-- 换期在途:旧内容留在原地退让(C5-02),不上骨架(用户 2026-09-16 拍板)。
         data-stale-host 常挂,类摘掉后退场才是 200 -->
    <div class="fin-page" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">
      <div class="fin-head">
        <span class="sub">上=损益附表1-5 全年走势(园区口径 · {{ loadedYear || '—' }}年) · 下=利润表快照(法人口径 · {{ loadedYm ?? '—' }}) · 单位 万元</span>
        <AnaPill tone="legal" icon="scale">法人口径 · {{ companyLabel }}</AnaPill>
      </div>

      <!-- §五策略3:所选年空 → 全屏空态,禁止沿用旧年图表 -->
      <div v-if="ready && yearEmpty" class="av2-card">
        <AnaEmpty :label="loadedYear + ' 年损益数据未录入'"
          hint="该年无损益附表(1~5)与利润表快照;切换年份或先录入数据"
          to="/rent-pnl" toText="去录入损益附表" />
      </div>

      <div v-else class="av2-grid">
        <div v-if="ready && !hasIs" class="av2-card av2-s12">
          <AnaEmpty label="该公司该期无利润表数据" hint="在报表中心录入利润表后,此处呈现盈利指标、科目占比与全表"
            to="/income-statement" toText="去录入利润表" />
        </div>

        <!-- 主图 s8:利润形成瀑布(园区口径,点级→右侧科目趋势) -->
        <div class="av2-card av2-s8">
          <div class="av2-card-h"><span class="t">利润形成瀑布 · {{ loadedYear || '—' }} 全年累计</span>
            <span class="hint">园区口径 · 蓝＝加项 / 红＝减项<span class="hint-desk"> · 点击柱→右侧科目 12 月趋势</span></span></div>
          <AnaEChart v-if="wf.length" :option="wfOpt" :height="300" @chart-click="onWfClick" />
          <AnaEmpty v-else-if="ready" label="该年度无损益附表数据" hint="录入附表1-5(租金/用电/用水/运管/费用)后呈现利润拆解"
            to="/rent-pnl" toText="去录入损益附表" />
        </div>

        <!-- 次图 s4:选中科目 12 月趋势(对比开关:环比/预算) -->
        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">{{ subject }} · 12 月趋势</span>
            <span class="hint">覆盖 {{ mLabels.length }} 期 · 万元</span></div>
          <template v-if="mLabels.length">
            <AnaEChart :option="trendOpt" :height="300" />
          </template>
          <AnaEmpty v-else-if="ready" label="该年度无逐月数据" hint="录入损益附表后呈现科目趋势" />
        </div>

        <!-- 收入结构堆叠 s8 -->
        <div v-if="mLabels.length" class="av2-card av2-s8">
          <div class="av2-card-h"><span class="t">收入结构</span>
            <span class="hint">园区口径 · 附表1-4 收入构成 · 万元</span></div>
          <AnaEChart :option="structOpt" :height="250" />
        </div>

        <!-- 科目占比 s4(法人口径,SVG 条形原语保留) -->
        <div v-if="hasIs" class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">科目占比</span><span class="hint">{{ loadedYm }} 本年累计 · 占营业收入</span></div>
          <AnaBarRows>
            <AnaBarRow v-for="r in shareRows" :key="r.name" :name="r.name" :value="r.value" :max="100" :fill="r.fill" />
          </AnaBarRows>
        </div>

        <!-- is 快照全表 s12(保留) -->
        <div v-if="hasIs" class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">利润表全表</span>
            <span class="hint">{{ companyLabel }} · 本月 / 本年累计 / 占收入 · 万元</span></div>
          <table class="ak-tbl">
            <thead><tr><th>项目</th><th>本月</th><th>本年累计</th><th>占收入</th></tr></thead>
            <tbody>
              <tr v-for="r in isTable" :key="r.label"
                :style="r.type === 'subtotal' ? { background: 'var(--surface-card)' } : undefined">
                <td :style="{
                  fontWeight: r.type === 'subtotal' ? 600 : 400,
                  paddingLeft: r.level ? '22px' : undefined,
                  color: r.level ? 'var(--text-secondary)' : 'var(--text-primary)',
                }">{{ r.label }}</td>
                <td class="mono mut">{{ r.cur == null ? '' : fmtW(r.cur) }}</td>
                <td class="mono" :style="{ fontWeight: r.type === 'subtotal' ? 700 : 400 }">{{ r.ytd == null ? '' : fmtW(r.ytd) }}</td>
                <td class="mono mut">{{ r.share == null ? '' : r.share.toFixed(1) + '%' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
/* 工具条口径标签 + v2 紧凑页头(复刻 AnaShell .anx-lbl 观感) */
.fin-name { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.fin-lbl { font-size: var(--fs-micro); color: var(--text-muted); display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.fin-page { display: flex; flex-direction: column; gap: 10px; max-width: 1640px; margin: 0 auto; }
.fin-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.fin-head .sub { font-size: var(--fs-micro); color: var(--text-muted); }

/* §C 迷你利润表链条(KPI-CARD-SPEC §4 利润公式条,像素照抄稿 KpiFormula A .fx.a):每个数一格浅底,
   运算符在格与格之间;尾注独占下一行靠右。格 min-width:max-content → 窄屏放不下整格折行,不压扁数字。
   .av2-kpis 单子项自然占满整行 */
.fin-chain { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
.fin-chain .node { flex: 1 1 0; min-width: max-content; display: flex; flex-direction: column; gap: 2px; border-radius: var(--radius-md); padding: 10px 14px; background: var(--accent-slate); }
.fin-chain .node.res { background: var(--accent-sky); }
.fin-chain .node.last { background: var(--accent-blue); }
.fin-chain .nl { font-size: var(--fs-label); line-height: 18px; color: var(--text-primary); white-space: nowrap; }
.fin-chain .nv { font-family: var(--font-mono); font-size: var(--fs-h2); line-height: 26px; font-weight: var(--fw-semibold); font-variant-numeric: tabular-nums; letter-spacing: var(--ls-tight); color: var(--text-primary); white-space: nowrap; }
.fin-chain .nv .u { font-family: var(--font-sans); font-size: var(--fs-body); font-weight: var(--fw-medium); }
.fin-chain .np { font-family: var(--font-mono); font-size: var(--fs-micro); line-height: 16px; color: var(--text-muted-tint); }
.fin-chain .op { flex: 0 0 auto; width: 16px; text-align: center; font-size: var(--fs-h2); color: var(--text-muted); user-select: none; }
.fin-chain .tail { flex: 1 0 100%; font-size: var(--fs-micro); font-family: var(--font-mono); color: var(--text-muted); text-align: right; white-space: nowrap; }
</style>
