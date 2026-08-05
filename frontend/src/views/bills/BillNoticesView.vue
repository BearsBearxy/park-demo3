<script setup lang="ts">
// 催缴单屏(S4-BILL-NOTICE-SPEC §7 S4-4):一户一单列表 + 明细抽屉 + 重新生成。
// 列表照 PoolLedgerView 的 FPLedgerTable 手法(34px 行/sticky 表头/mono 空值'–')+
// LIST-PAGE-SPEC 列宽铁律(逐列定宽,一列弹性,交互零位移);账外单(offbook)整行降淡。
// 明细抽屉照 MeterDetailDrawer 的 FPDrawer 手法:单头 + premise 分段小计行表(BILL-DERIVE-SPEC §1.1)
// + 取价审计链 info 悬浮;底部 issue/void 按 status 显隐。写操作 admin(viewer 隐藏),GET 全员。
import { computed, onMounted, ref, watch } from 'vue'
import {
  billNoticesApi, type BillNoticeDTO, type BillNoticeDetailDTO,
} from '@/api/billNotices'
import { metersApi } from '@/api/meters'
import { buildYearOptions } from '@/utils/yearGate'
import {
  NOTICE_KIND_LABEL, NOTICE_STATUS_LABEL, auditTitle, billFeeLabel,
  groupLinesByPremise, noticeKindLabel, noticeKpis, segLabel,
} from '@/utils/billNoticeLogic'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPStat from '@/components/fp/FPStat.vue'

const auth = useAuthStore()
const canEdit = computed(() => !auth.isReadonly)

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fmt2 = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback

// ── 账期(年数据驱动;bill-notices 无 years 端点,复用抄表年份——单随读数走,alloc 屏同手法) ──
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  buildYearOptions(dataYears.value, today).map(y => ({ value: String(y), label: `${y}年` })))
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const ym = computed(() => `${year.value}-${pad2(month.value)}`)

// ── 数据(竞态守卫:快速切年月只接受最新一次请求) ──
const rows = ref<BillNoticeDTO[] | null>(null)
let seq = 0
async function loadMonth() {
  const my = ++seq
  const data = await billNoticesApi.list(ym.value).catch(() => [] as BillNoticeDTO[])
  if (my !== seq) return
  rows.value = data
}
onMounted(async () => {
  try {
    dataYears.value = await metersApi.years()
    const latest = dataYears.value[dataYears.value.length - 1]
    if (latest && latest !== year.value) { year.value = latest; return }   // watch 触发 loadMonth
  } catch { /* 年份失败不阻断 */ }
  loadMonth()
})
watch([year, month], loadMonth)

// ── KPI 条(单数/明细行数/总额合计/警告单数) ──
const kpis = computed(() => noticeKpis(rows.value ?? []))

// ── 筛选:单据类/仅看有警告/租户搜索 ──
const kindFilter = ref('')
const warnOnly = ref(false)
const q = ref('')
const KIND_OPTS = [{ value: '', label: '全部单据' },
  ...Object.entries(NOTICE_KIND_LABEL).map(([value, label]) => ({ value, label }))]
const filtered = computed(() => (rows.value ?? []).filter(r =>
  (kindFilter.value === '' || r.noticeKind === kindFilter.value)
  && (!warnOnly.value || !!r.warn)
  && (q.value.trim() === '' || (r.tenantName ?? '').includes(q.value.trim()))))
const footTotal = computed(() => filtered.value.reduce((s, r) => s + (r.totalAmount ?? 0), 0))
const footLines = computed(() => filtered.value.reduce((s, r) => s + r.lineCount, 0))

// ── 重新生成(admin;confirm 后 POST generate,轻提示显摘要,完成刷新) ──
const generating = ref(false)
const okMsg = ref('')
let okTimer: ReturnType<typeof setTimeout> | undefined
function flashOk(msg: string) {
  okMsg.value = msg
  clearTimeout(okTimer)
  okTimer = setTimeout(() => { okMsg.value = '' }, 5000)
}
async function onGenerate() {
  if (generating.value) return
  if (!confirm(`重新生成 ${ym.value} 催缴单:先删后插覆盖本月草稿/作废单,按当前读数与价目重派;已签发单跳过不覆盖(须先作废)。确认?`)) return
  generating.value = true
  try {
    const res = await billNoticesApi.generate(ym.value)
    flashOk(`已生成 ${res.generated} 单 / ${res.lines} 行,${res.warned} 单带警告(含已签发跳过户)`)
    await loadMonth()
  } catch (e) { alert(errMsg(e, '生成失败')) } finally { generating.value = false }
}

// ── 明细抽屉 ──
const dlgOpen = ref(false)
const dlgLoading = ref(false)
const detail = ref<BillNoticeDetailDTO | null>(null)
async function openDetail(r: BillNoticeDTO) {
  dlgOpen.value = true
  dlgLoading.value = true
  detail.value = null
  try { detail.value = await billNoticesApi.detail(r.id) }
  catch (e) { alert(errMsg(e, '明细加载失败')); dlgOpen.value = false }
  finally { dlgLoading.value = false }
}
const groups = computed(() => (detail.value ? groupLinesByPremise(detail.value.lines) : []))
// 单场地/无场地不出分带与小计(小计=合计,纯噪音);多场地才分段(§1.1)
const showBands = computed(() => groups.value.length > 1)
const drawerSub = computed(() => {
  const d = detail.value
  if (!d) return ''
  return [`${d.ym} · ${noticeKindLabel(d.noticeKind)}`,
    `收款 ${d.payCompanyName ?? '未设收款公司'}`, `${d.lines.length} 行`].join(' · ')
})

// issue/void(admin;按 status 显隐;confirm)
const acting = ref(false)
async function transition(action: 'issue' | 'void') {
  const d = detail.value
  if (!d || acting.value) return
  const tip = action === 'issue'
    ? `签发「${d.tenantName ?? '#' + d.tenantId}」${d.ym} 催缴单?签发后不被「重新生成」覆盖,改数须先作废。`
    : `作废「${d.tenantName ?? '#' + d.tenantId}」${d.ym} 催缴单?作废单在下次重新生成时清除重派。`
  if (!confirm(tip)) return
  acting.value = true
  try {
    const res = action === 'issue' ? await billNoticesApi.issue(d.id) : await billNoticesApi.void(d.id)
    d.status = res.status
    await loadMonth()
  } catch (e) { alert(errMsg(e, '操作失败')) } finally { acting.value = false }
}
</script>

<template>
  <div v-if="!rows" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="bn-page">
    <!-- 标题行:h2+账期;右=重新生成(admin) -->
    <div class="bn-head">
      <div class="bn-head-l">
        <h2 class="bn-title"><span class="ic"><component :is="iconFor('file-check-2')" :size="18" /></span>催缴单</h2>
        <div style="width:96px">
          <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
        </div>
        <div style="width:84px">
          <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
        </div>
      </div>
      <div class="bn-actions">
        <Button v-if="canEdit" variant="outline" size="sm" :disabled="generating" @click="onGenerate">
          <template #leading><component :is="iconFor(rows.length ? 'refresh-cw' : 'play')" :size="14" /></template>
          {{ generating ? '生成中…' : rows.length ? '重新生成' : '生成本月' }}
        </Button>
      </div>
    </div>

    <!-- KPI 条 -->
    <div class="bn-kpis">
      <FPStat label="催缴单数" :value="String(kpis.count)" tint="blue" />
      <FPStat label="明细行数" :value="String(kpis.lineCount)" />
      <FPStat label="本期总额(元)" :value="fmt2(kpis.total)" tint="sky" />
      <FPStat label="警告单数" :value="String(kpis.warned)" :sub="kpis.warned ? '悬停行尾「!」看原文' : undefined" />
    </div>

    <!-- 生成摘要轻提示(5s 自消) -->
    <div v-if="okMsg" class="bn-bar ok">
      <component :is="iconFor('check')" :size="14" />
      <span>{{ okMsg }}</span>
    </div>
    <div v-if="rows.length === 0" class="bn-bar">
      <component :is="iconFor('info')" :size="14" />
      <span>{{ year }}年{{ month }}月暂无催缴单。
        <template v-if="canEdit">点右上「生成本月」按当月读数、价目与公摊快照派生。</template>
        <template v-else>请管理员生成。</template>
      </span>
    </div>

    <!-- 筛选行:单据类 + 仅看有警告 + 租户搜索 -->
    <div class="bn-toolbar">
      <div style="width:130px">
        <Select :options="KIND_OPTS" :model-value="kindFilter" size="sm" @update:model-value="kindFilter = $event" />
      </div>
      <label class="bn-chk">
        <input type="checkbox" v-model="warnOnly" />
        仅看有警告
      </label>
      <span style="flex:1"></span>
      <input v-model="q" class="bn-search" type="text" placeholder="搜租户名" />
    </div>

    <!-- 一行一单(pl-table 手法:sticky 表头/34px 行/tfoot 钉底合计) -->
    <div class="bn-wrap">
      <table class="bn-table">
        <colgroup>
          <col style="width:220px" />
          <col style="width:88px" />
          <col style="width:150px" />
          <col /><!-- 位置:唯一弹性列 -->
          <col style="width:60px" />
          <col style="width:116px" />
          <col style="width:72px" />
          <col style="width:52px" />
        </colgroup>
        <thead>
          <tr>
            <th class="l">租户</th>
            <th class="l" title="合一单/水电费单/维护费单/宿舍单/账外单;账外单出单不入应收,整行降淡">单据</th>
            <th class="l">收款主体</th>
            <th class="l" title="合同费项位置拼接(多场地租户逗号分隔),明细内按场地分段小计">位置</th>
            <th>行数</th>
            <th>本期合计(元)</th>
            <th class="l">状态</th>
            <th title="门禁告警:缺价/表未归属合同/费项未设收款公司/合计为负…悬停「!」看原文">警告</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id" :class="{ offbook: r.noticeKind === 'offbook' }" @click="openDetail(r)">
            <td class="l">
              <span class="bn-tname" :title="r.tenantName ?? undefined">{{ r.tenantName ?? '#' + r.tenantId }}</span>
            </td>
            <td class="l"><span class="bn-kind" :class="r.noticeKind">{{ noticeKindLabel(r.noticeKind) }}</span></td>
            <td class="l"><span class="bn-txt" :class="{ dim: !r.payCompanyName }" :title="r.payCompanyName ?? undefined">{{ r.payCompanyName ?? '未设置' }}</span></td>
            <td class="l"><span class="bn-txt dim" :title="r.premiseText ?? undefined">{{ r.premiseText || '–' }}</span></td>
            <td><span class="bn-nv">{{ r.lineCount }}</span></td>
            <td><span class="bn-sumc" :class="{ neg: r.totalAmount < 0 }">{{ fmt2(r.totalAmount) }}</span></td>
            <td class="l"><span class="bn-st" :class="r.status">{{ NOTICE_STATUS_LABEL[r.status] ?? r.status }}</span></td>
            <td class="ct"><span v-if="r.warn" class="bn-warn" :title="r.warn">!</span></td>
          </tr>
          <tr v-if="filtered.length === 0">
            <td class="bn-noro" :colspan="8">
              {{ rows.length === 0 ? '本月尚未生成催缴单' : '无匹配单据 —— 换筛选条件试试' }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th class="l"><span class="bn-foot-lbl">合　计 · {{ filtered.length }} 单</span></th>
            <th colspan="3"></th>
            <th><span class="bn-foot-v">{{ footLines }}</span></th>
            <th><span class="bn-foot-v">{{ fmt2(footTotal) }}</span></th>
            <th colspan="2"></th>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- 明细抽屉:单头 + premise 分段小计行表 + issue/void -->
    <FPDrawer
      :open="dlgOpen"
      :title="detail ? (detail.tenantName ?? '#' + detail.tenantId) : '催缴单明细'"
      :subtitle="drawerSub"
      icon="file-check-2"
      :width="960"
      :fixedHeight="true"
      @close="dlgOpen = false"
    >
      <template #badge>
        <template v-if="detail">
          <span class="bn-kind" :class="detail.noticeKind">{{ noticeKindLabel(detail.noticeKind) }}</span>
          <span class="bn-st" :class="detail.status">{{ NOTICE_STATUS_LABEL[detail.status] ?? detail.status }}</span>
        </template>
      </template>

      <div v-if="dlgLoading || !detail" class="bn-empty">加载中…</div>
      <template v-else>
        <!-- 单头 -->
        <div v-if="detail.warn" class="bn-bar warn">
          <component :is="iconFor('alert-triangle')" :size="14" />
          <span>{{ detail.warn }}</span>
        </div>
        <div class="bn-hgrid">
          <div class="bn-hfld"><label>收款主体</label><span :class="{ dim: !detail.payCompanyName }">{{ detail.payCompanyName ?? '未设置' }}</span></div>
          <div class="bn-hfld"><label>位置</label><span :class="{ dim: !detail.premiseText }">{{ detail.premiseText || '—' }}</span></div>
          <div class="bn-hfld"><label>本期合计</label><span class="mono">{{ fmt2(detail.totalAmount) }} 元</span></div>
          <div class="bn-hfld"><label>上期欠费</label><span class="mono dim" title="催缴闭环接口点,S4 恒 0,待收款流水接入">{{ fmt2(detail.prevDue) }} 元</span></div>
        </div>

        <!-- 明细行表:premise 分段(多场地才分带+小计) -->
        <div class="bn-dwrap">
          <table class="bn-dtable">
            <colgroup>
              <col style="width:38px" />
              <col style="width:98px" />
              <col style="width:120px" />
              <col style="width:38px" />
              <col style="width:84px" />
              <col style="width:84px" />
              <col style="width:52px" />
              <col style="width:84px" />
              <col style="width:82px" />
              <col style="width:94px" />
              <col /><!-- 备注:唯一弹性列 -->
              <col style="width:30px" />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th class="l">费项</th>
                <th class="l">表</th>
                <th class="l" title="分时段:尖/峰/平/谷">段</th>
                <th>上月行至</th>
                <th>本月行至</th>
                <th>倍率</th>
                <th>用量</th>
                <th>单价</th>
                <th>金额(元)</th>
                <th class="l">备注</th>
                <th title="取价审计链:price_key/作用域/价目月/判定分支"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="g in groups" :key="g.premise ?? '(none)'">
                <tr v-if="showBands" class="bn-band">
                  <td :colspan="12" class="l"><span class="bn-band-lbl">{{ g.label }}</span></td>
                </tr>
                <tr v-for="l in g.lines" :key="l.lineNo">
                  <td><span class="bn-nv dim">{{ l.lineNo }}</span></td>
                  <td class="l"><span class="bn-txt" :title="l.feeKey">{{ billFeeLabel(l.feeKey) }}</span></td>
                  <td class="l"><span class="bn-txt" :class="{ dim: !l.meterLabel }">{{ l.meterLabel ?? '–' }}</span></td>
                  <td class="l"><span class="bn-txt">{{ segLabel(l.seg) }}</span></td>
                  <td><span class="bn-nv" :class="{ empty: l.prevRead == null }">{{ fmt(l.prevRead) }}</span></td>
                  <td><span class="bn-nv" :class="{ empty: l.currRead == null }">{{ fmt(l.currRead) }}</span></td>
                  <td><span class="bn-nv" :class="{ empty: l.factorSnap == null }">{{ fmt(l.factorSnap) }}</span></td>
                  <td><span class="bn-nv" :class="{ empty: l.qty == null }">{{ fmt(l.qty) }}</span></td>
                  <td><span class="bn-nv" :class="{ empty: l.priceSnap == null }" :title="l.priceSnap != null ? String(l.priceSnap) : undefined">{{ fmt(l.priceSnap) }}</span></td>
                  <td><span class="bn-sumc" :class="{ neg: l.amount < 0 }">{{ fmt2(l.amount) }}</span></td>
                  <td class="l"><span class="bn-txt dim" :title="l.note ?? undefined">{{ l.note || '' }}</span></td>
                  <td class="ct">
                    <span v-if="auditTitle(l)" class="bn-info" :title="auditTitle(l)!">
                      <component :is="iconFor('info')" :size="13" />
                    </span>
                  </td>
                </tr>
                <tr v-if="showBands" class="bn-sub">
                  <td :colspan="9" class="l"><span class="bn-txt dim">小计 · {{ g.label }}</span></td>
                  <td><span class="bn-sumc">{{ fmt2(g.subtotal) }}</span></td>
                  <td :colspan="2"></td>
                </tr>
              </template>
            </tbody>
            <tfoot>
              <tr>
                <th :colspan="9" class="l"><span class="bn-foot-lbl">本期合计</span></th>
                <th><span class="bn-foot-v">{{ fmt2(detail.totalAmount) }}</span></th>
                <th :colspan="2"></th>
              </tr>
            </tfoot>
          </table>
        </div>
      </template>

      <template v-if="detail && canEdit" #footer>
        <span class="bn-ftnote">
          {{ detail.status === 'draft' ? '草稿:重新生成会覆盖;签发后锁定不被重跑覆盖'
            : detail.status === 'issued' ? '已签发:重新生成跳过本户;改数须先作废' : '已作废:下次重新生成时清除重派' }}
        </span>
        <Button v-if="detail.status !== 'void'" variant="outline" size="sm" class="bn-void" :disabled="acting" @click="transition('void')">
          <template #leading><component :is="iconFor('x-circle')" :size="14" /></template>
          作废
        </Button>
        <Button v-if="detail.status === 'draft'" variant="filled" size="sm" :disabled="acting" @click="transition('issue')">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          签发
        </Button>
      </template>
    </FPDrawer>
  </div>
</template>

<style scoped>
.bn-page { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* 标题行(pl-head 家族) */
.bn-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.bn-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bn-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.bn-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.bn-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* KPI 条 */
.bn-kpis { flex: 0 0 auto; display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; }

/* 提示条(pl-bar 家族) */
.bn-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); flex-wrap: wrap; }
.bn-bar.warn { border-color: var(--hue-orange); background: rgb(255, 250, 235); color: rgb(138, 97, 0); }
.bn-bar.ok { border-style: solid; border-color: var(--hue-green); background: rgb(240, 251, 244); color: rgb(21, 108, 60); }

/* 筛选行 */
.bn-toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bn-chk { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
.bn-chk input { accent-color: var(--hue-blue); }
.bn-search { width: 230px; height: 32px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); font-size: 12.5px; background: var(--surface-white); color: var(--text-primary); }
.bn-search:focus { outline: none; border-color: var(--hue-blue); }

/* ── 列表宽表(pl-table/FPLedgerTable 手法:sticky 表头/34px 行/tfoot 钉底) ── */
.bn-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); }
.bn-table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; font-family: var(--font-sans); }
.bn-table th, .bn-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0 8px; overflow: hidden; }
.bn-table thead th { position: sticky; top: 0; height: 34px; background: var(--surface-card); color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: right; z-index: 4; white-space: nowrap; }
.bn-table thead th.l, .bn-table td.l { text-align: left; }
.bn-table td.ct { text-align: center; }
.bn-table tbody td { height: 34px; background: var(--surface-white); vertical-align: middle; text-align: right; cursor: pointer; }
.bn-table tbody tr:hover td { background: var(--surface-card); }
/* 账外单视觉降淡(出单不入应收) */
.bn-table tbody tr.offbook { opacity: .55; }
.bn-table tbody tr:last-child td { cursor: default; }
.bn-noro { text-align: center !important; padding: 40px 16px !important; color: var(--text-disabled); font-size: var(--fs-label); cursor: default !important; }
.bn-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 40px; font-weight: var(--fw-semibold); background: var(--surface-white); border-top: 2px solid var(--border-strong); font-family: var(--font-mono); color: var(--text-primary); text-align: right; }
.bn-table tfoot th.l { text-align: left; }
.bn-foot-lbl { display: block; text-align: left; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
.bn-foot-v { display: block; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--brand-deep); }

/* 单元格家族(pl 同款) */
.bn-tname { display: block; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-txt { display: block; text-align: left; font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-txt.dim { color: var(--text-muted); }
.bn-nv { display: block; text-align: right; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-nv.empty, .bn-nv.dim { color: var(--text-disabled); }
.bn-sumc { display: block; text-align: right; font-weight: var(--fw-semibold); color: var(--hue-blue); font-size: 12px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bn-sumc.neg { color: var(--hue-red); }

/* 单据类 badge */
.bn-kind { display: inline-block; font-size: 11px; border-radius: var(--radius-full); padding: 1px 8px; background: var(--surface-sunken); color: var(--text-secondary); white-space: nowrap; }
.bn-kind.combined { background: var(--accent-blue); color: var(--hue-blue); }
.bn-kind.dorm { background: rgb(240, 251, 244); color: rgb(21, 128, 61); }
.bn-kind.offbook { background: var(--surface-sunken); color: var(--text-muted); }
.bn-kind.fee { background: var(--accent-sky, var(--surface-sunken)); color: var(--text-secondary); }
.bn-kind.maint { background: rgb(255, 246, 219); color: rgb(146, 100, 0); }

/* 状态 badge */
.bn-st { display: inline-block; font-size: 11px; border-radius: var(--radius-full); padding: 1px 8px; white-space: nowrap; }
.bn-st.draft { background: var(--surface-sunken); color: var(--text-secondary); }
.bn-st.issued { background: rgb(240, 251, 244); color: rgb(21, 128, 61); }
.bn-st.void { background: rgb(255, 238, 237); color: var(--hue-red); }

/* 警告角标(悬停显原文) */
.bn-warn { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: var(--radius-full); background: rgb(255, 238, 237); color: var(--hue-red); font-size: 11px; font-weight: var(--fw-semibold); cursor: help; }

/* ── 抽屉:单头 + 明细行表(md-htable 家族) ── */
.bn-empty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }
.bn-hgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 18px; margin-bottom: 12px; }
.bn-hfld { min-width: 0; }
.bn-hfld label { display: block; margin-bottom: 4px; font-size: var(--fs-label); color: var(--text-muted); }
.bn-hfld span { font-size: var(--fs-body); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.bn-hfld .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.bn-hfld .dim, .bn-hfld .mono.dim { color: var(--text-disabled); }
.bn-bar.warn + .bn-hgrid { margin-top: 12px; }

.bn-dwrap { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: auto; }
.bn-dtable { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 12px; white-space: nowrap; }
.bn-dtable th, .bn-dtable td { box-sizing: border-box; padding: 0 8px; border-bottom: 1px solid var(--divider); overflow: hidden; text-overflow: ellipsis; }
.bn-dtable thead th { position: sticky; top: 0; z-index: 2; height: 30px; text-align: right; font-weight: var(--fw-medium); font-size: 11px; color: var(--text-muted); background: var(--surface-card); }
.bn-dtable thead th.l, .bn-dtable td.l { text-align: left; }
.bn-dtable td.ct { text-align: center; }
.bn-dtable tbody td { height: 30px; text-align: right; background: var(--surface-white); vertical-align: middle; }
.bn-dtable tbody tr:last-child td { border-bottom: none; }
/* premise 分带(pl-band 轻量版)与小计行 */
.bn-dtable tr.bn-band td { height: 30px; background: var(--surface-sunken); border-top: 1px solid var(--border-strong); }
.bn-band-lbl { font-size: 12px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.bn-dtable tr.bn-sub td { background: var(--surface-card); }
.bn-dtable tfoot th { position: sticky; bottom: 0; height: 34px; background: var(--surface-white); border-top: 2px solid var(--border-strong); text-align: right; font-family: var(--font-mono); }
.bn-dtable tfoot th.l { text-align: left; }
/* 审计链 info 图标 */
.bn-info { display: inline-grid; place-items: center; color: var(--text-disabled); cursor: help; }
.bn-info:hover { color: var(--hue-blue); }

/* 抽屉页脚 */
.bn-ftnote { flex: 1 1 auto; min-width: 0; font-size: 11.5px; color: var(--text-muted); }
.bn-void { color: var(--hue-red); }
</style>
