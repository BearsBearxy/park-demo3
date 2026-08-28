<script setup lang="ts">
// 收入核对 ②对账工作台 — P2-E Task3。左租户清单(搜索+四档 Segmented+状态点) /
// 右单户双源对照(台账按公司分卡 ⇄ 附表10按期分卡 + 同名科目对照行 + 底部配平条)。
// 视觉 1:1 移植 recon-page-v3.js 工作台段(--pa-* → demo3 令牌);处置浮层改居中弹窗(§7,FinDialogs 范式)。
// 标记/取消核实走 reconApi 后 emit patch,由父级局部更新 entities(不整页刷)。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { reconApi } from '@/api/recon'
import type { FeeLine, ReconEntity } from '@/types/recon'
import { filterEntities, segCounts, statusColor, type ReconSeg } from '@/reports/recon'
import { finMoney } from '@/utils/finFmt'
import { leavesOf, PHASES } from '@/views/sales-income/layout'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{
  year: number
  month: number
  entities: ReconEntity[]
}>()
const emit = defineEmits<{
  back: []
  patch: [tenantName: string, marked: boolean, note: string | null]
}>()

const router = useRouter()
const tabs = useTabsStore()

// ── 左清单状态 ──
const seg = ref<ReconSeg>('all')
const query = ref('')
const selName = ref<string | null>(null)

const SEGS: { value: ReconSeg; label: string }[] = [
  { value: 'all', label: '全部' }, { value: 'diff', label: '有差异' },
  { value: 'miss', label: '缺记' }, { value: 'ok', label: '已平' },
]
const counts = computed(() => segCounts(props.entities))
const list = computed(() => filterEntities(props.entities, seg.value, query.value))
const selected = computed<ReconEntity | null>(() =>
  props.entities.find(e => e.tenantName === selName.value) ?? list.value[0] ?? props.entities[0] ?? null)

// 顶栏汇总
const summary = computed(() => {
  let ok = 0, diff = 0, miss = 0, tot = 0
  for (const e of props.entities) {
    tot += e.diff
    if (e.status === 'ok') ok++
    else if (e.status === 'diff') diff++
    else miss++
  }
  return { ok, diff, miss, tot }
})

// ── 格式化/标签 ──
const signed = (n: number) => (Math.abs(n) <= 0.005 ? '¥0' : (n > 0 ? '+' : '−') + finMoney(Math.abs(n)))
const amt = (v: number | null) => (v == null ? '—' : finMoney(v))
const colorOf = (e: ReconEntity) => `var(${statusColor(e.status)})`

// 科目标签:FeeLine 自带 label(键=台账字段名/s10 独有 colId 与台账分卡键同);
// s10 分卡键=s10 colId → 附表10 版面叶子标签(office 版面 25 叶=全并集,复用 sales-income/layout)。
const S10_LABEL: Record<string, string> = Object.fromEntries(leavesOf('office').map(l => [l.colId, l.label]))
const feeLabel = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const f of selected.value?.fees ?? []) m[f.key] = f.label
  return m
})
const phaseName = (p: number) => PHASES.find(x => x.phase === p)?.name ?? `${p} 期`

// 清单行副标题:台账侧公司名,缺记户回落期区名
function subOf(e: ReconEntity): string {
  if (e.ledgerCards.length) return e.ledgerCards.map(c => c.companyName).join(' / ')
  if (e.s10Cards.length) return e.s10Cards.map(c => phaseName(c.phase)).join(' / ')
  return '—'
}

// 科目行三态(E2/E3):onlySide=缺记红;|delta|>容差=不符橙;否则对齐
function feeState(f: FeeLine): 'ok' | 'diff' | 'miss' {
  if (f.onlySide) return 'miss'
  return Math.abs(f.delta) > 0.005 ? 'diff' : 'ok'
}
const pendingFees = computed(() => (selected.value?.fees ?? []).filter(f => feeState(f) !== 'ok').length)

// ── 处置浮层(居中弹窗 §7):点差异行/配平条开;fee=null 表示整户口径 ──
const dlg = ref<{ fee: FeeLine | null } | null>(null)
const note = ref('')
const busy = ref(false)

function openDlg(fee: FeeLine | null) {
  if (!selected.value) return
  note.value = selected.value.markNote ?? ''
  dlg.value = { fee }
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && dlg.value) dlg.value = null
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const dlgVals = computed(() => {
  const e = selected.value
  if (!e) return null
  const f = dlg.value?.fee ?? null
  return {
    title: f ? f.label : e.tenantName,
    l: f ? f.ledgerAmt : e.ledgerTotal,
    s: f ? f.s10Amt : e.s10Total,
    d: f ? f.delta : e.diff,
    state: f ? feeState(f) : e.status,
  }
})

// 跳转深链(spec 2026-07-07 §一):目标页固定为钉住 tab + 全新实例(openFresh)+ query 自动钻取定位租户行。
// 多公司记户取第一张卡(弹窗里本就按卡展示);query 由 LedgerView/S10View onMounted 消费。
function jumpLedger() {
  const e = selected.value
  if (!e) return
  dlg.value = null
  tabs.openFresh('ledger', { pin: true })
  router.push({ path: '/ledger', query: {
    y: props.year, m: props.month,
    company: e.ledgerCards[0]?.companyName ?? '', tenant: e.tenantName,
  } })
}
function jumpS10() {
  const e = selected.value
  if (!e) return
  dlg.value = null
  tabs.openFresh('sales-income', { pin: true })
  router.push({ path: '/sales-income', query: {
    y: props.year, m: props.month,
    phase: e.s10Cards[0]?.phase ?? 1, tenant: e.tenantName,
  } })
}
// 标记已核实(upsert 备注)/已核实则取消核实;成功后 emit patch 局部更新
async function confirmMark() {
  const e = selected.value
  if (!e || busy.value) return
  busy.value = true
  try {
    if (e.marked) {
      await reconApi.unmark(props.year, props.month, e.tenantName)
      emit('patch', e.tenantName, false, null)
    } else {
      const n = note.value.trim() || null
      await reconApi.mark(props.year, props.month, { tenantName: e.tenantName, tenantId: e.tenantId, note: n })
      emit('patch', e.tenantName, true, n)
    }
    dlg.value = null
  } catch (err) {
    alert((err as { message?: string })?.message ?? '操作失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <!-- fp-fluid:工作台已按 RESPONSIVE-LAYOUT-SPEC 迁移(≤960 清单/对照上下堆叠、
       ≤600 对照双栏降单列),摘掉 base.css 的 800px 屏级地板 -->
  <div class="rc3 rc-wb fp-fluid">
    <!-- 顶栏 -->
    <div class="rc-top">
      <div class="rc-top-row">
        <button class="rc-back" title="返回月份" @click="emit('back')"><component :is="iconFor('chevron-left')" :size="16" /></button>
        <div>
          <div class="rc-title">{{ year }} 年 {{ month }} 月 · 收入核对</div>
          <div class="rc-sub">
            共 <b>{{ entities.length }}</b> 户 · 已平 <b>{{ summary.ok }}</b> ·
            有差异 <b class="t-diff">{{ summary.diff }}</b> · 缺记 <b class="t-miss">{{ summary.miss }}</b> ·
            合计差额 <b class="num" :class="summary.miss > 0 ? 't-miss' : summary.diff > 0 ? 't-diff' : 't-ok'">{{ signed(summary.tot) }}</b>
          </div>
        </div>
      </div>
    </div>

    <div class="rc-body">
      <!-- 左:租户清单 -->
      <div class="rc-master">
        <div class="rc-mtop">
          <div class="rc-search">
            <component :is="iconFor('search')" :size="14" />
            <input v-model="query" placeholder="搜索租户" />
          </div>
          <div class="rc-seg">
            <button v-for="s in SEGS" :key="s.value" :data-f="s.value" :class="{ on: seg === s.value }" @click="seg = s.value">
              {{ s.label }} <span class="n">{{ counts[s.value] }}</span>
            </button>
          </div>
        </div>
        <div class="rc-list">
          <div
            v-for="e in list" :key="e.tenantName"
            class="rc-li" :class="{ on: selected?.tenantName === e.tenantName, marked: e.marked }"
            @click="selName = e.tenantName"
          >
            <span class="dot" :style="{ background: colorOf(e) }"></span>
            <div class="rc-li-main">
              <div class="rc-li-name">{{ e.tenantName }}</div>
              <div class="rc-li-sub">{{ subOf(e) }}</div>
            </div>
            <div class="rc-li-right">
              <span v-if="e.marked" class="rc-li-tag mk"><component :is="iconFor('check')" :size="12" />已核实</span>
              <span v-else-if="e.status === 'ok'" class="rc-li-tag" style="color:var(--hue-blue)"><span class="dot" style="background:var(--hue-blue)"></span>已对齐</span>
              <div v-else class="rc-li-diff num" :style="{ color: colorOf(e) }">{{ signed(e.diff) }}</div>
            </div>
          </div>
          <div v-if="!list.length" class="rc-empty">无匹配租户</div>
        </div>
      </div>

      <!-- 右:单户对照 -->
      <div v-if="selected" class="rc-detail">
        <div class="rc-dhead">
          <div class="rc-dtitle">
            <h2>{{ selected.tenantName }}</h2>
            <span v-for="c in selected.ledgerCards" :key="c.companyName" class="rc-chip">{{ c.companyName }}</span>
            <span v-if="selected.marked" class="rc-chip mk"><component :is="iconFor('check')" :size="11" />已核实</span>
          </div>
          <div class="rc-dmeta">左 月度台账 · {{ selected.ledgerCards.length }} 家管理公司 ⇄ 右 附表10 · {{ selected.s10Cards.length }} 个期区</div>

          <div v-if="selected.status === 'ok'" class="rc-banner ok">
            <span class="dot" style="background:var(--hue-blue)"></span>
            <div class="bx"><b>两本账配平</b> · 各管理公司台账之和 = 附表10 申报,同名科目全部对齐。</div>
          </div>
          <div v-else-if="selected.marked" class="rc-banner ok">
            <span class="dot" style="background:var(--hue-blue)"></span>
            <div class="bx"><b>差异已核实</b>{{ selected.markNote ? ' · ' + selected.markNote : '' }}</div>
            <button class="bbtn" @click="openDlg(null)">取消核实</button>
          </div>
          <div v-else class="rc-banner" :class="selected.status">
            <component :is="iconFor('alert-triangle')" :size="15" />
            <div class="bx">
              <b>两本账未配平 · 差额 {{ signed(selected.diff) }}</b> ·
              {{ selected.status === 'miss'
                ? (selected.ledgerCards.length === 0 ? '台账缺记:附表10 有申报,台账无对应记账。' : '附表10 缺申报:台账已记账,附表10 无该户。')
                : '橙色科目为两侧金额不符,点击差异行或配平条处置。' }}
            </div>
            <button class="bbtn" @click="openDlg(null)"><component :is="iconFor('check')" :size="13" />标记已核实</button>
          </div>
        </div>

        <div class="rc-dscroll">
          <div class="rc-cwrap">
            <!-- 左卡:月度台账按公司 -->
            <div>
              <div class="rc-colhead"><component :is="iconFor('list')" :size="14" />月度台账 · 按收款公司 <span class="tot num">{{ finMoney(selected.ledgerTotal) }}</span></div>
              <div v-for="c in selected.ledgerCards" :key="c.companyName" class="rc-cocard">
                <div class="rc-coh">
                  <span class="dot" style="background:var(--hue-blue)"></span>
                  <div class="nm">{{ c.companyName }}</div>
                  <div class="ssum num">{{ finMoney(c.total) }}</div>
                </div>
                <div v-for="(v, k) in c.fees" :key="k" class="rc-cline">
                  <div class="lf"><div class="lf-fee">{{ feeLabel[k] ?? k }}</div></div>
                  <div class="lf-amt num">{{ finMoney(v) }}</div>
                </div>
              </div>
              <div v-if="!selected.ledgerCards.length" class="rc-cocard missbox">
                <div class="rc-coh miss"><span class="dot" style="background:var(--hue-red)"></span><div class="nm t-miss">台账缺记</div></div>
                <div class="rc-cline"><div class="lf"><div class="lf-meta">附表10 有申报,台账无对应记账,须补记。</div></div></div>
              </div>
            </div>

            <!-- 中轴 -->
            <div class="rc-axis">
              <div class="rc-axis-line"></div>
              <div class="rc-node" :class="selected.status">
                <component :is="iconFor(selected.status === 'ok' ? 'check' : 'alert-triangle')" :size="15" />
              </div>
            </div>

            <!-- 右卡:附表10 按期区 -->
            <div>
              <div class="rc-colhead"><component :is="iconFor('file-text')" :size="14" />附表10 · 按期区申报 <span class="tot num">{{ finMoney(selected.s10Total) }}</span></div>
              <div v-for="c in selected.s10Cards" :key="c.phase" class="rc-cocard">
                <div class="rc-coh">
                  <span class="dot" style="background:var(--hue-orange)"></span>
                  <div class="nm">{{ phaseName(c.phase) }} · 销售收入流水</div>
                  <div class="ssum num">{{ finMoney(c.total) }}</div>
                </div>
                <div v-for="(v, k) in c.fees" :key="k" class="rc-cline">
                  <div class="lf"><div class="lf-fee">{{ S10_LABEL[k] ?? k }}</div></div>
                  <div class="lf-amt num">{{ finMoney(v) }}</div>
                </div>
              </div>
              <div v-if="!selected.s10Cards.length" class="rc-cocard missbox">
                <div class="rc-coh miss"><span class="dot" style="background:var(--hue-red)"></span><div class="nm t-miss">附表10 缺申报</div></div>
                <div class="rc-cline"><div class="lf"><div class="lf-meta">台账已记账,附表10 无该户申报,须补报。</div></div></div>
              </div>
            </div>

            <!-- 中部:同名科目对照(E2) -->
            <div class="rc-fees">
              <div class="rc-fees-h">同名科目对照 · {{ selected.fees.length }} 项<span v-if="pendingFees" class="pend">{{ pendingFees }} 项不符</span></div>
              <div class="rc-fee-row head">
                <div>科目</div><div class="num">台账</div><div class="num">附表10</div><div class="num">差额</div>
              </div>
              <div
                v-for="f in selected.fees" :key="f.key"
                class="rc-fee-row" :class="feeState(f)"
                @click="feeState(f) !== 'ok' && openDlg(f)"
              >
                <div class="lbl">
                  {{ f.label }}
                  <span v-if="f.onlySide" class="rc-rtag miss">{{ f.onlySide === 'ledger' ? '仅台账' : '仅附表10' }}</span>
                </div>
                <div class="num">{{ amt(f.ledgerAmt) }}</div>
                <div class="num">{{ amt(f.s10Amt) }}</div>
                <div class="num" :class="{ 't-diff': feeState(f) === 'diff', 't-miss': feeState(f) === 'miss' }">{{ signed(f.delta) }}</div>
              </div>
            </div>

            <!-- 底部配平条 -->
            <div class="rc-balance" :class="selected.status" @click="openDlg(null)">
              <div class="bl"><span class="k">台账合计</span><span class="v num">{{ finMoney(selected.ledgerTotal) }}</span></div>
              <span class="eq">{{ selected.status === 'ok' ? '=' : '≠' }}</span>
              <div class="bl"><span class="k">附表10合计</span><span class="v num">{{ finMoney(selected.s10Total) }}</span></div>
              <div class="verdict" :style="{ color: colorOf(selected) }">
                <component :is="iconFor(selected.status === 'ok' ? 'check' : 'alert-triangle')" :size="15" />
                {{ selected.status === 'ok' ? '已配平' : `差额 ${signed(selected.diff)}${selected.marked ? ' · 已核实' : ' · 待处置'}` }}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="rc-detail"><div class="rc-empty" style="margin:auto">该月无核对实体</div></div>
    </div>

    <!-- 处置浮层(居中弹窗 §7:Teleport + backdrop 居中 + Esc 关闭) -->
    <Teleport to="body">
      <div v-if="dlg && selected && dlgVals" class="rc-mask" @mousedown="dlg = null">
        <div class="rc-pop" role="dialog" aria-modal="true" @mousedown.stop>
          <div class="rc-pop-title"><component :is="iconFor('alert-triangle')" :size="14" />{{ dlgVals.title }} · 差异处置</div>
          <div class="rc-pop-amts">
            <div class="rc-pop-amt"><span class="k">台账(各公司之和)</span><span class="v">{{ dlgVals.l == null ? '未记账' : finMoney(dlgVals.l) }}</span></div>
            <div class="rc-pop-amt"><span class="k">附表10</span><span class="v">{{ dlgVals.s == null ? '未申报' : finMoney(dlgVals.s) }}</span></div>
            <div class="rc-pop-amt"><span class="k">差额</span><span class="v" :style="{ color: dlgVals.state === 'miss' ? 'var(--hue-red)' : dlgVals.state === 'diff' ? 'var(--hue-orange)' : 'var(--hue-blue)' }">{{ signed(dlgVals.d) }}</span></div>
          </div>
          <div class="rc-pop-jumps">
            <button class="rc-pop-btn" @click="jumpLedger"><component :is="iconFor('arrow-right')" :size="12" />去改台账</button>
            <button class="rc-pop-btn" @click="jumpS10"><component :is="iconFor('arrow-right')" :size="12" />去改附表10</button>
          </div>
          <textarea v-model="note" :disabled="selected.marked" placeholder="核对备注(可选):说明差异原因与处理方式…"></textarea>
          <button class="rc-pop-confirm" :class="{ undo: selected.marked }" :disabled="busy" @click="confirmMark">
            <component v-if="!selected.marked" :is="iconFor('check')" :size="14" />
            {{ selected.marked ? '取消核实' : '标记已核实' }}
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 1:1 recon-page-v3.js 工作台样式,--pa-* → demo3 令牌:
   ink→text-primary mute→text-muted body→text-secondary border→border-subtle border-strong→border-strong
   success→hue-blue warning→hue-orange danger→hue-red bg-soft→surface-card bg-softer→surface-sunken
   brand-bg→accent-blue success-bg→accent-blue warning-bg→rgb(255,243,230) danger-bg→rgb(253,232,230)
   radius-xl→radius-xl shadow-sm/md→shadow-sm/md faint→text-disabled
   字号/字重后续已归档到令牌阶梯:12.5/11.5/10.5/9.5 这类小数档一律取就近档,同名科目对照行
   (.rc-fee-row,三列定宽 120px)与左清单(定宽 286px)一律取小的那档,放大会撑破定宽列。
   两处暖色底 rgb(255,243,230)/rgb(253,232,230) 令牌里没有对应的暖色 accent,仍留字面量。 */
.rc3 { font-size: var(--fs-body); color: var(--text-primary); font-family: var(--font-sans); }
.rc3 .num { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
.rc3 .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 7px; display: inline-block; }
.rc3 .t-ok { color: var(--hue-blue); } .rc3 .t-diff { color: var(--hue-orange); } .rc3 .t-miss { color: var(--hue-red); }

/* 外壳 */
.rc-wb { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.rc-top { flex: 0 0 auto; padding-bottom: 14px; border-bottom: 1px solid var(--border-subtle); }
.rc-top-row { display: flex; align-items: flex-start; gap: 12px; }
.rc-back { width: 32px; height: 32px; border: 0; background: var(--surface-sunken); border-radius: var(--radius-sm); cursor: pointer; display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.rc-back:hover { background: var(--surface-card); }
.rc-title { font-size: var(--fs-h2); font-weight: var(--fw-bold); letter-spacing: -.02em; }
.rc-sub { font-size: var(--fs-label); color: var(--text-muted); margin-top: 4px; display: flex; gap: 7px; flex-wrap: wrap; align-items: center; }
.rc-sub b { font-weight: var(--fw-semibold); color: var(--text-secondary); }
.rc-sub b.t-diff { color: var(--hue-orange); } .rc-sub b.t-miss { color: var(--hue-red); } .rc-sub b.t-ok { color: var(--hue-blue); }

.rc-body { flex: 1; min-height: 0; display: flex; gap: 16px; margin-top: 16px; }

/* 左:租户清单 */
.rc-master { flex: 0 0 286px; display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); background: var(--surface-white); overflow: hidden; }
.rc-mtop { padding: 13px 13px 10px; border-bottom: 1px solid var(--border-subtle); }
.rc-search { height: 32px; padding: 0 12px; display: flex; align-items: center; gap: 8px; background: var(--surface-sunken); border-radius: var(--radius-full); color: var(--text-muted); margin-bottom: 10px; }
.rc-search input { flex: 1; border: 0; background: transparent; font: inherit; font-size: var(--fs-label); color: var(--text-primary); outline: none; min-width: 0; }
.rc-seg { display: flex; gap: 4px; background: var(--surface-sunken); border-radius: 9px; padding: 3px; }
.rc-seg button { flex: 1; height: 28px; border: 0; cursor: pointer; border-radius: 7px; background: transparent; font: inherit; font-size: var(--fs-micro); font-weight: var(--fw-medium); color: var(--text-muted); display: inline-flex; align-items: center; justify-content: center; gap: 5px; transition: all var(--dur-fast) var(--ease-standard); }
.rc-seg button .n { font-size: var(--fs-micro); padding: 0 5px; height: 15px; line-height: 15px; border-radius: var(--radius-full); background: var(--border-subtle); color: var(--text-muted); }
.rc-seg button.on { background: var(--surface-white); color: var(--text-primary); font-weight: var(--fw-semibold); box-shadow: var(--shadow-sm); }
.rc-seg button.on[data-f="all"] .n { background: var(--ink-900); color: #fff; }
.rc-seg button.on[data-f="diff"] .n { background: var(--hue-orange); color: #fff; }
.rc-seg button.on[data-f="miss"] .n { background: var(--hue-red); color: #fff; }
.rc-seg button.on[data-f="ok"] .n { background: var(--hue-blue); color: #fff; }
.rc-list { flex: 1; min-height: 0; overflow-y: auto; padding: 7px; }
.rc-li { position: relative; padding: 11px 12px 11px 14px; border-radius: 11px; cursor: pointer; transition: background var(--dur-fast) var(--ease-standard); display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
.rc-li:hover { background: var(--surface-card); }
.rc-li.on { background: var(--accent-blue); }
.rc-li.on::before { content: ''; position: absolute; left: 1px; top: 12px; bottom: 12px; width: 3px; border-radius: 2px; background: var(--ink-900); }
.rc-li.marked { opacity: .55; }
.rc-li-main { flex: 1; min-width: 0; }
.rc-li-name { font-size: var(--fs-body); font-weight: var(--fw-semibold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-li-sub { font-size: var(--fs-micro); color: var(--text-muted); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-li-right { text-align: right; flex: 0 0 auto; white-space: nowrap; }
.rc-li-diff { font-size: var(--fs-label); font-weight: var(--fw-semibold); }
.rc-li-tag { font-size: var(--fs-micro); display: inline-flex; align-items: center; gap: 5px; justify-content: flex-end; }
.rc-li-tag.mk { color: var(--text-muted); }
.rc-empty { padding: 34px 18px; text-align: center; color: var(--text-muted); font-size: var(--fs-label); }

/* 右:对账详情 */
.rc-detail { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); background: var(--surface-white); overflow: hidden; }
.rc-dhead { padding: 17px 22px 15px; border-bottom: 1px solid var(--border-subtle); flex: 0 0 auto; }
.rc-dtitle { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rc-dtitle h2 { font-size: var(--fs-h3); font-weight: var(--fw-bold); letter-spacing: -.01em; margin: 0; white-space: nowrap; }
.rc-chip { font-size: var(--fs-micro); font-weight: var(--fw-medium); color: var(--text-secondary); background: var(--surface-sunken); padding: 3px 9px; border-radius: var(--radius-full); white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
.rc-chip.mk { background: var(--accent-blue); color: var(--hue-blue); }
.rc-dmeta { font-size: var(--fs-label); color: var(--text-muted); margin-top: 7px; }
.rc-banner { display: flex; align-items: center; gap: 11px; margin-top: 13px; padding: 11px 14px; border-radius: 11px; font-size: var(--fs-label); flex-wrap: wrap; }
.rc-banner.ok { background: var(--accent-blue); }
.rc-banner.diff { background: rgb(255,243,230); }
.rc-banner.miss { background: rgb(253,232,230); }
.rc-banner .bx { flex: 1; min-width: 220px; line-height: 1.5; }
.rc-banner b { font-weight: var(--fw-semibold); }
.rc-banner .bbtn { height: 28px; padding: 0 12px; border: 1px solid var(--border-strong); background: var(--surface-white); cursor: pointer; border-radius: var(--radius-sm); font: inherit; font-size: var(--fs-micro); font-weight: var(--fw-medium); color: var(--text-primary); display: inline-flex; align-items: center; gap: 6px; }
.rc-banner .bbtn:hover { background: var(--surface-card); }
.rc-dscroll { flex: 1; min-height: 0; overflow-y: auto; }

.rc-cwrap { display: grid; grid-template-columns: 1fr 60px 1fr; padding: 18px 22px 22px; align-items: start; }
.rc-colhead { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: var(--fs-label); font-weight: var(--fw-semibold); }
.rc-colhead .tot { margin-left: auto; font-size: var(--fs-body); font-weight: var(--fw-bold); }
.rc-cocard { border: 1px solid var(--border-subtle); border-radius: 13px; margin-bottom: 12px; overflow: hidden; }
.rc-cocard.missbox { border-color: var(--hue-red); }
.rc-coh { display: flex; align-items: center; gap: 9px; padding: 10px 13px; background: var(--surface-card); border-bottom: 1px solid var(--border-subtle); }
.rc-coh.miss { background: rgb(253,232,230); }
.rc-coh .nm { font-size: var(--fs-label); font-weight: var(--fw-semibold); flex: 1; }
.rc-coh .ssum { font-size: var(--fs-body); font-weight: var(--fw-semibold); }
.rc-cline { display: flex; align-items: center; gap: 10px; padding: 9px 13px; border-bottom: 1px solid var(--border-subtle); }
.rc-cline:last-child { border-bottom: 0; }
.rc-cline .lf { flex: 1; min-width: 0; }
.rc-cline .lf-fee { font-size: var(--fs-label); font-weight: var(--fw-medium); display: flex; align-items: center; gap: 7px; }
.rc-cline .lf-meta { font-size: var(--fs-micro); color: var(--text-muted); }
.rc-cline .lf-amt { font-size: var(--fs-body); font-weight: var(--fw-medium); flex: 0 0 auto; }
.rc-rtag { font-size: var(--fs-micro); font-weight: var(--fw-semibold); padding: 1px 7px; border-radius: var(--radius-full); }
.rc-rtag.miss { background: var(--hue-red); color: #fff; }

.rc-axis { display: flex; flex-direction: column; align-items: center; padding-top: 38px; position: relative; align-self: stretch; }
.rc-axis-line { position: absolute; top: 0; bottom: 18px; width: 1px; background: var(--border-subtle); }
.rc-node { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-white); border: 1px solid var(--border-subtle); z-index: 1; }
.rc-node.ok { border-color: var(--hue-blue); color: var(--hue-blue); }
.rc-node.diff { border-color: var(--hue-orange); color: var(--hue-orange); background: rgb(255,243,230); }
.rc-node.miss { border-color: var(--hue-red); color: var(--hue-red); background: rgb(253,232,230); }

/* 中部:同名科目对照行(label|台账|附表10|差额) */
.rc-fees { grid-column: 1 / -1; border: 1px solid var(--border-subtle); border-radius: 13px; margin-top: 4px; overflow: hidden; }
.rc-fees-h { display: flex; align-items: center; gap: 8px; padding: 10px 13px; background: var(--surface-card); border-bottom: 1px solid var(--border-subtle); font-size: var(--fs-label); font-weight: var(--fw-semibold); }
.rc-fees-h .pend { font-size: var(--fs-micro); font-weight: var(--fw-semibold); color: var(--hue-orange); background: rgb(255,243,230); padding: 1px 8px; border-radius: var(--radius-full); }
.rc-fee-row { display: grid; grid-template-columns: 1fr 120px 120px 120px; gap: 10px; align-items: center; padding: 9px 13px; border-bottom: 1px solid var(--border-subtle); font-size: var(--fs-label); }
.rc-fee-row:last-child { border-bottom: 0; }
.rc-fee-row .num { text-align: right; }
.rc-fee-row.head { font-size: var(--fs-micro); color: var(--text-muted); background: var(--surface-white); font-weight: var(--fw-medium); }
.rc-fee-row .lbl { font-weight: var(--fw-medium); display: flex; align-items: center; gap: 7px; min-width: 0; }
.rc-fee-row.diff { background: rgb(255,243,230); cursor: pointer; }
.rc-fee-row.diff:hover { background: rgb(255,236,205); }
.rc-fee-row.miss { background: rgb(253,232,230); cursor: pointer; }
.rc-fee-row.miss:hover { background: rgb(255,224,222); }

/* 底部配平条 */
.rc-balance { grid-column: 1 / -1; position: sticky; bottom: 0; display: flex; align-items: center; gap: 14px; margin-top: 8px; padding: 14px 18px; border-radius: 13px; background: var(--accent-blue); box-shadow: 0 -6px 16px rgba(28,28,28,.05); cursor: pointer; }
.rc-balance.diff { background: rgb(255,243,230); }
.rc-balance.miss { background: rgb(253,232,230); }
.rc-balance .bl { display: flex; align-items: baseline; gap: 8px; }
.rc-balance .bl .k { font-size: var(--fs-micro); color: var(--text-muted); }
.rc-balance .bl .v { font-size: var(--fs-h3); font-weight: var(--fw-bold); }
/* eq 的 300 是细体 =/≠ 符号,字重阶梯只到 400,提到 400 会让它抢两侧金额的视线,故保留字面量 */
.rc-balance .eq { font-size: var(--fs-h3); color: var(--text-muted); font-weight: 300; }
.rc-balance .verdict { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: var(--fs-body); font-weight: var(--fw-semibold); }

/* 处置浮层:居中弹窗(§7,FinDialogs .fin-mask 范式) */
.rc-mask { position: fixed; inset: 0; background: rgba(28,28,28,.34); z-index: var(--z-modal); display: grid; place-items: center; padding: 24px; box-sizing: border-box; backdrop-filter: blur(2px); opacity: 0; animation: fp-fade-in var(--dur-base) forwards; }
.rc-pop { width: min(320px, 92vw); max-height: 88vh; overflow-y: auto; background: var(--surface-white); border-radius: 14px; box-shadow: var(--shadow-md), 0 8px 28px rgba(28,28,28,.14); border: 1px solid var(--border-subtle); padding: 16px; box-sizing: border-box; font-size: var(--fs-body); color: var(--text-primary); font-family: var(--font-sans); animation: rcpop var(--dur-fast) var(--ease-out) both; }
@keyframes rcpop { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
.rc-pop-title { font-size: var(--fs-body); font-weight: var(--fw-bold); margin-bottom: 11px; display: flex; align-items: center; gap: 7px; }
.rc-pop-amts { display: flex; flex-direction: column; gap: 7px; padding-bottom: 11px; margin-bottom: 11px; border-bottom: 1px solid var(--border-subtle); }
.rc-pop-amt { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: var(--fs-label); }
.rc-pop-amt .k { color: var(--text-muted); }
.rc-pop-amt .v { font-weight: var(--fw-semibold); font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
.rc-pop-jumps { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-bottom: 9px; }
.rc-pop-btn { height: 30px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--surface-white); cursor: pointer; font: inherit; font-size: var(--fs-micro); font-weight: var(--fw-medium); color: var(--text-primary); display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.rc-pop-btn:hover { background: var(--surface-card); }
.rc-pop textarea { width: 100%; box-sizing: border-box; min-height: 52px; resize: vertical; border: 1px solid var(--border-strong); border-radius: 9px; padding: 8px 10px; font: inherit; font-size: var(--fs-label); color: var(--text-primary); outline: none; margin-bottom: 11px; background: var(--surface-white); }
.rc-pop textarea:focus { border-color: var(--text-primary); }
.rc-pop textarea:disabled { background: var(--surface-sunken); color: var(--text-muted); }
.rc-pop-confirm { width: 100%; height: 34px; border-radius: 9px; border: 0; background: var(--ink-900); color: #fff; cursor: pointer; font: inherit; font-size: var(--fs-label); font-weight: var(--fw-semibold); display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.rc-pop-confirm:hover { background: rgb(58,58,58); }
.rc-pop-confirm:disabled { opacity: .55; cursor: not-allowed; }
.rc-pop-confirm.undo { background: var(--surface-white); color: var(--text-primary); border: 1px solid var(--border-strong); }
.rc-pop-confirm.undo:hover { background: var(--surface-card); }

/* ── 窄档(RESPONSIVE-LAYOUT-SPEC §1,宽档规则在前) ── */
@media (max-width: 960px) { /* M↓ */
  /* 左清单 286px 定宽会把右侧对照挤到不可用(M 档内容区最窄 ~475px,余 ~170px 摆不下双栏)。
     §5.6 精神是「左轨收顶部」,但本清单带搜索/分段过滤,收成 chips 会丢过滤能力——
     改上下堆叠:清单定高内滚(rc-list 本就 overflow-y:auto),对照占余下高度 */
  .rc-body { flex-direction: column; }
  .rc-master { flex: 0 0 300px; }
}
@media (max-width: 600px) { /* S */
  .rc-master { flex-basis: 220px; }   /* 手机竖屏高度紧,清单再收一档,详情多留空间 */
  /* 对照双栏 1fr 60px 1fr:S 档改上下堆叠;中轴列(装饰性连线+状态节点,配平结论
     在 banner 与配平条各有一份)随之隐藏,不丢信息 */
  .rc-cwrap { grid-template-columns: 1fr; padding: 14px 14px 16px; }
  .rc-axis { display: none; }
  /* 同名科目对照 3×120px 定列收窄:字号降一档(fs-micro)后 ¥ 千分位金额 ~12 字符
     即 ~80px 放得下;ponytail:亿级金额会溢出串列,真出现再改横滚 */
  .rc-fee-row { grid-template-columns: minmax(0, 1fr) 82px 82px 88px; gap: 6px; padding: 9px 10px; font-size: var(--fs-micro); }
  /* 配平条允许折行:S 档宽度放不下「合计 = 合计 + 结论」一行;折行按档静态确定 */
  .rc-balance { flex-wrap: wrap; gap: 8px 14px; }
  /* iOS 聚焦不缩放(§6.5):S 档输入控件 16px */
  .rc-search input { font-size: var(--fs-input-m); }
}
</style>
