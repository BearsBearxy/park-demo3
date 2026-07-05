<script setup lang="ts">
// 导入中心 — 1:1 移植 screen-import.jsx。统一入口:按数据类型卡片(状态/最近导入/就地上传) + 导入记录表。
// 卡片「上传」就地开该类型导入抽屉(复用 importRegistry);ledger 先选公司+年月;charging 先取 cats。
import { ref, onMounted, computed, h } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import FPSortableTable, { type SortableColumn } from '@/components/fp/FPSortableTable.vue'
import type { SortState } from '@/components/fp/fpSort'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import { IMPORT_TYPES, runImport, type ImportCtx, type ImportTypeEntry } from '@/utils/importRegistry'
import { tenantApi } from '@/api/tenant'
import { suggestParent } from '@/utils/tenantSuggest'
import LedgerImportResolveDialog, { type ResolveItem, type ResolveDecision } from '@/views/ledger/LedgerImportResolveDialog.vue'
import { importLogApi } from '@/api/importLog'
import { companyApi, ledgerApi } from '@/api/ledger'
import { chargingApi } from '@/api/charging'
import type { ImportLogOverviewDTO, ImportLogDTO } from '@/types/importLog'
import type { ImportResultDTO } from '@/types/import'
import type { CompanyDTO } from '@/types/ledger'

const overview = ref<ImportLogOverviewDTO | null>(null)   // §6 加载信号
const importing = ref(false)
const activeKey = ref<string | null>(null)
const ctx = ref<ImportCtx>({})
const importResult = ref<ImportResultDTO | null>(null)
const sort = ref<SortState | null>({ key: 'createdAt', dir: 'desc' })

// ledger 上下文表单
const ledgerForm = ref(false)
const companies = ref<CompanyDTO[]>([])
// 默认会计期 = 当前年月(不硬编码,跨年自适应)
const now = new Date()
const lf = ref<{ companyId: number | null; year: number; month: number }>({ companyId: null, year: now.getFullYear(), month: now.getMonth() + 1 })

onMounted(reload)
async function reload() { overview.value = await importLogApi.overview() }

const activeEntry = computed<ImportTypeEntry | null>(() =>
  activeKey.value ? IMPORT_TYPES.find(t => t.key === activeKey.value) ?? null : null)
// 空对象兜底仅为类型占位:模板 v-if="importing && activeEntry" 保证渲染时必有 activeEntry
const modalProps = computed(() => activeEntry.value ? activeEntry.value.modalProps(ctx.value) : ({} as ReturnType<ImportTypeEntry['modalProps']>))

// ── 每类状态(由 latestByType 派生) ─────────────────────────
const IM_ST: Record<string, { label: string; c: string; bg: string }> = {
  done:    { label: '已是最新', c: 'var(--hue-blue)',   bg: 'var(--accent-blue)' },
  partial: { label: '部分',     c: 'var(--hue-orange)', bg: 'rgb(252,243,232)' },
  warn:    { label: '有告警',   c: 'var(--hue-orange)', bg: 'rgb(252,243,232)' },
  missing: { label: '未导入',   c: 'var(--hue-red)',    bg: 'rgb(252,235,233)' },
}
const latestByKey = computed<Record<string, ImportLogDTO>>(() => {
  const m: Record<string, ImportLogDTO> = {}
  for (const r of overview.value?.latestByType ?? []) m[r.dataType] = r
  return m
})
function tileState(key: string): keyof typeof IM_ST {
  const r = latestByKey.value[key]
  if (!r) return 'missing'
  return r.status === 'complete' ? 'done' : r.status === 'partial' ? 'partial' : 'warn'
}
function fmtTime(iso?: string): string {
  if (!iso) return '—'
  return iso.slice(0, 16).replace('T', ' ')   // YYYY-MM-DD HH:mm
}

// ── 打开某类型导入 ──────────────────────────────────────────
async function openImport(entry: ImportTypeEntry) {
  activeKey.value = entry.key
  ctx.value = {}
  if (entry.context === 'ledger') {
    if (!companies.value.length) companies.value = await companyApi.list()
    lf.value = { companyId: companies.value[0]?.id ?? null, year: now.getFullYear(), month: now.getMonth() + 1 }
    ledgerForm.value = true
    return
  }
  if (entry.key.startsWith('charging_')) {
    const no = Number(entry.key.split('_')[1])
    ctx.value = { cats: await chargingApi.cats(no) }
  }
  importing.value = true
}
function confirmLedger() {
  const c = companies.value.find(x => x.id === lf.value.companyId)
  if (!c) return
  ctx.value = { companyId: c.id, companyName: c.name, year: lf.value.year, month: lf.value.month }
  ledgerForm.value = false
  importing.value = true
}

// ── 导入回调 → runImport(执行+记录) → 刷新 + toast ──────────
async function handleImport(recs: ImportRec[], fileName: string) {
  importing.value = false
  // 台账走未登记租户预检(与 LedgerView.onImport 同款编排,复用 ResolveDialog/suggestParent)
  if (activeKey.value === 'ledger') { await ledgerPrecheck(recs, fileName); return }
  await doRun(recs, fileName)
}

// ── 台账未登记租户预检(hub 版;确认建档/跳过后继续 doRun) ─────
const resolveItems = ref<ResolveItem[] | null>(null)
const pendingLedger = ref<{ recs: ImportRec[]; fileName: string } | null>(null)
let tenantCache: { id: number; companyName: string; parentId?: number | null }[] = []
async function ledgerPrecheck(recs: ImportRec[], fileName: string) {
  try { tenantCache = await tenantApi.list() }
  catch { await doRun(recs, fileName); return }   // 拉不到租户表则直接导入,由后端逐行报错
  const known = new Set(tenantCache.map(t => t.companyName))
  const unknown = [...new Set(recs.map(r => String(r.tenantName ?? '').trim()).filter(n => n && !known.has(n)))]
  if (!unknown.length) { await doRun(recs, fileName); return }
  resolveItems.value = unknown.map(name => ({ name, suggest: suggestParent(name, tenantCache) }))
  pendingLedger.value = { recs, fileName }
}
async function onResolveConfirm(decisions: ResolveDecision[]) {
  const pending = pendingLedger.value
  resolveItems.value = null
  pendingLedger.value = null
  if (!pending) return
  for (const d of decisions) {
    if (d.action === 'skip') continue
    try {
      await tenantApi.create({
        companyName: d.name, businessType: '未分类',
        parentId: d.action === 'link' ? d.parentId : undefined,
        remark: '台账导入时自动创建',
      })
    } catch (e) { alert((e as { message?: string })?.message ?? '创建租户失败'); return }
  }
  const skipNames = new Set(decisions.filter(d => d.action === 'skip').map(d => d.name))
  const recs = pending.recs.filter(r => !skipNames.has(String(r.tenantName ?? '').trim()))
  await doRun(recs, pending.fileName)
}
function onResolveCancel() { resolveItems.value = null; pendingLedger.value = null }
async function handleSections(picks: unknown[], fileName: string) {
  importing.value = false
  await doRun(picks as Parameters<typeof runImport>[1], fileName)
}
async function doRun(payload: Parameters<typeof runImport>[1], fileName: string) {
  if (!activeKey.value) return
  try {
    importResult.value = await runImport(activeKey.value, payload, ctx.value, fileName)
    await reload()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// ── 导入记录表列 ────────────────────────────────────────────
const cols: SortableColumn<ImportLogDTO>[] = [
  { key: 'fileName', header: '文件', render: (r) => h('span', { style: 'display:flex;align-items:center;gap:8px' }, [
    h(iconFor('file-spreadsheet'), { size: 15 }),
    h('span', { style: 'font-weight:var(--fw-medium);color:var(--text-primary);white-space:nowrap' }, r.fileName),
  ]) },
  { key: 'typeLabel', header: '类型', width: 110, render: (r) => h('span', { style: 'color:var(--text-secondary)' }, r.typeLabel) },
  { key: 'ok', header: '行数', width: 76, align: 'right', mono: true, render: (r) => String(r.rows || '—') },
  { key: 'status', header: '结果', width: 160, sortValue: (r) => (r.status === 'rejected' ? -1 : r.ok),
    render: (r) => r.status === 'rejected'
      ? h('span', { style: 'color:var(--hue-red);font-size:12.5px' }, '已拒绝 · 模板不匹配')
      : h('span', { style: 'font-size:12.5px;color:var(--text-secondary)' }, [
          h('span', { style: 'color:var(--hue-blue);font-weight:600' }, String(r.ok)), ' 成功',
          ...(r.warn > 0 ? [h('span', { style: 'color:var(--hue-orange)' }, ` · ${r.warn} 告警`)] : []),
        ]) },
  { key: 'operator', header: '操作人', width: 90, render: (r) => h('span', { style: 'color:var(--text-muted)' }, r.operator || '—') },
  { key: 'createdAt', header: '时间', width: 130, mono: true, render: (r) => h('span', { style: 'color:var(--text-muted);font-size:12px' }, fmtTime(r.createdAt)) },
]
</script>

<template>
  <div v-if="overview" class="im">
    <div class="im-head">
      <div>
        <h2 class="im-title">导入中心</h2>
        <p class="im-sub">所有 Excel 数据的统一入口 · 导入即归集到对应台账与报表</p>
      </div>
      <div class="im-actions">
        <Button variant="outline" size="sm" disabled>
          <template #leading><component :is="iconFor('download')" :size="15" /></template>下载模板
        </Button>
      </div>
    </div>

    <!-- 顶部区:选类型再导(不做自动识别文件类型) -->
    <div class="im-drop" @click="($event.currentTarget as HTMLElement).nextElementSibling?.scrollIntoView({ behavior: 'smooth' })">
      <span class="im-drop-icon"><component :is="iconFor('upload-cloud')" :size="26" /></span>
      <div class="im-drop-main">
        <div class="im-drop-t">按数据类型上传 Excel</div>
        <div class="im-drop-d">在下方选择数据类型 → 就地上传/粘贴 → 系统按模板列校验后入库(暂不支持拖拽自动识别类型)</div>
      </div>
    </div>

    <div>
      <h3 class="im-section-t">按数据类型导入</h3>
      <p class="im-sub" style="margin:0 0 14px">每类数据对应一张模板,卡片显示最近导入状态</p>
      <div class="im-grid">
        <div v-for="t in IMPORT_TYPES" :key="t.key" class="im-tile">
          <div class="im-tile-top">
            <span class="im-tile-icon"><component :is="iconFor(t.icon)" :size="19" /></span>
            <span style="min-width:0">
              <div class="im-tile-name">{{ t.label }}</div>
              <div class="im-tile-tag">{{ t.tag }}</div>
            </span>
            <span class="im-pill" :style="{ color: IM_ST[tileState(t.key)].c, background: IM_ST[tileState(t.key)].bg }">
              {{ IM_ST[tileState(t.key)].label }}
            </span>
          </div>
          <div class="im-tile-meta">
            <span>最近导入 <b>{{ fmtTime(latestByKey[t.key]?.createdAt) }}</b></span>
            <span><b>{{ latestByKey[t.key]?.ok ?? 0 }}</b> 行</span>
          </div>
          <div class="im-tile-foot">
            <Button variant="outline" size="sm" full-width @click="openImport(t)">
              <template #leading><component :is="iconFor('upload')" :size="14" /></template>上传
            </Button>
          </div>
        </div>
      </div>
    </div>

    <Card surface="white" :padding="0" style="border:1px solid var(--border-subtle);overflow:hidden">
      <div class="im-hist-h">
        <span style="font-size:var(--fs-h4);font-weight:var(--fw-semibold)">导入记录</span>
        <span style="font-size:var(--fs-label);color:var(--text-muted)">近 30 天</span>
      </div>
      <div style="padding:0 4px">
        <FPSortableTable :columns="cols" :rows="overview.history" row-key="id" :sort="sort" @sort-change="sort = $event" />
      </div>
    </Card>
  </div>
  <div v-else class="page-loading"><span class="page-spin" /></div>

  <!-- ledger 上下文:先选公司+年月 -->
  <div v-if="ledgerForm" class="im-ctx-scrim" @mousedown="ledgerForm = false">
    <div class="im-ctx" @mousedown.stop>
      <h3>导入 月度台账 · 选择目标</h3>
      <label>记账公司
        <select v-model.number="lf.companyId">
          <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <div class="im-ctx-ym">
        <label>年<input type="number" v-model.number="lf.year" /></label>
        <label>月
          <select v-model.number="lf.month"><option v-for="m in 12" :key="m" :value="m">{{ m }}</option></select>
        </label>
      </div>
      <div class="im-ctx-foot">
        <Button variant="gray" size="sm" @click="ledgerForm = false">取消</Button>
        <Button variant="filled" size="sm" :disabled="lf.companyId == null" @click="confirmLedger">下一步</Button>
      </div>
    </div>
  </div>

  <FpImportModal
    v-if="importing && activeEntry"
    v-bind="modalProps"
    @close="importing = false"
    @import="handleImport"
    @import-sections="handleSections"
  />
  <!-- 台账未登记租户预检(自管显隐,放最后不打断状态链) -->
  <LedgerImportResolveDialog
    v-if="resolveItems"
    :items="resolveItems"
    @confirm="onResolveConfirm"
    @close="onResolveCancel"
  />
  <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
</template>

<style scoped>
/* 1:1 from screen-import.jsx ImStyles */
.im { display:flex; flex-direction:column; gap:20px; max-width:1200px; margin:0 auto; width:100%; }
.im-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.im-title { margin:0; font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.im-sub { margin:5px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.im-actions { display:flex; gap:8px; }

.im-drop { display:flex; align-items:center; gap:18px; padding:24px; border:1.5px dashed var(--border-strong); border-radius:var(--radius-lg); background:var(--surface-card); cursor:pointer; transition:background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard); }
.im-drop:hover { background:var(--accent-slate); border-color:var(--hue-blue); }
.im-drop-icon { width:52px; height:52px; border-radius:var(--radius-md); background:var(--surface-white); display:grid; place-items:center; color:var(--hue-blue); flex:0 0 auto; border:1px solid var(--border-subtle); }
.im-drop-main { flex:1; min-width:0; }
.im-drop-t { font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); }
.im-drop-d { font-size:var(--fs-label); color:var(--text-muted); margin-top:2px; }

.im-section-t { font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); margin:0 0 4px; }
.im-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(248px,1fr)); gap:14px; }
.im-tile { display:flex; flex-direction:column; gap:12px; padding:16px; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); transition:box-shadow var(--dur-fast) var(--ease-standard); }
.im-tile:hover { box-shadow:0 4px 16px rgba(28,28,28,.07); }
.im-tile-top { display:flex; align-items:flex-start; gap:10px; }
.im-tile-icon { width:36px; height:36px; border-radius:var(--radius-sm); background:var(--accent-slate); display:grid; place-items:center; color:var(--ink-900); flex:0 0 auto; }
.im-tile-name { font-size:var(--fs-body); font-weight:var(--fw-semibold); color:var(--text-primary); }
.im-tile-tag { font-size:11px; color:var(--text-disabled); }
.im-pill { font-size:11px; font-weight:var(--fw-semibold); padding:2px 9px; border-radius:var(--radius-full); white-space:nowrap; margin-left:auto; flex:0 0 auto; height:fit-content; }
.im-tile-meta { display:flex; align-items:center; justify-content:space-between; font-size:var(--fs-label); color:var(--text-muted); }
.im-tile-meta b { color:var(--text-secondary); font-family:var(--font-mono); font-weight:var(--fw-semibold); }
.im-tile-foot { display:flex; gap:8px; }

.im-hist-h { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid var(--divider); }

/* ledger 上下文小弹层 */
.im-ctx-scrim { position:fixed; inset:0; z-index:320; background:rgba(28,28,28,.32); backdrop-filter:blur(2px); display:grid; place-items:center; }
.im-ctx { width:min(380px,92vw); background:var(--surface-white); border-radius:var(--radius-lg); padding:20px 22px; display:flex; flex-direction:column; gap:14px; box-shadow:0 12px 40px rgba(28,28,28,.18); }
.im-ctx h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.im-ctx label { display:flex; flex-direction:column; gap:5px; font-size:12.5px; color:var(--text-secondary); }
.im-ctx select, .im-ctx input { height:34px; border:1px solid var(--border-subtle); border-radius:8px; padding:0 10px; font-size:13px; color:var(--text-primary); background:var(--surface-white); outline:none; }
.im-ctx select:focus, .im-ctx input:focus { border-color:var(--border-strong); }
.im-ctx-ym { display:flex; gap:12px; }
.im-ctx-ym label { flex:1; }
.im-ctx-foot { display:flex; gap:10px; justify-content:flex-end; margin-top:4px; }
</style>
