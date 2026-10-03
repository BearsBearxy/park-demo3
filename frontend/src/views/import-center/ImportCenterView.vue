<script setup lang="ts">
// 导入中心 — 1:1 移植 screen-import.jsx。统一入口:按数据类型卡片(状态/最近导入/就地上传) + 导入记录表。
// 卡片「上传」就地开该类型导入抽屉(复用 importRegistry);ledger 先选公司+年月;charging 先取 cats。
import { ref, onMounted, computed, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { parsePeriod, periodLink, periodOf } from '@/nav/deepLink'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Select from '@/components/ds/Select.vue'
import DatePicker from '@/components/ds/DatePicker.vue'
import FPSortableTable, { type SortableColumn } from '@/components/fp/FPSortableTable.vue'
import type { SortState } from '@/components/fp/fpSort'
import FpImportModal, { type ImportRec, type ImportPayload } from '@/components/import/FpImportModal.vue'
import { settle, type ImportOutcome, type ImportRunProgress } from '@/components/import/importRun'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import { ask } from '@/utils/ask'
import { IMPORT_TYPES, runImport, type ImportCtx, type ImportTypeEntry } from '@/utils/importRegistry'
import { useAuthStore } from '@/stores/auth'
import { canViewPage } from '@/nav/navAccess'
import { useZonesStore } from '@/stores/zones'
import { importLogApi } from '@/api/importLog'
import { companyApi, ledgerApi } from '@/api/ledger'
import { booksApi } from '@/api/books'
import type { Book } from '@/types/book'
import { chargingApi } from '@/api/charging'
import type { ImportLogOverviewDTO, ImportLogDTO } from '@/types/importLog'
import type { CompanyDTO } from '@/types/ledger'

// 权限挂在 import kind 上而非本屏(RBAC §5.6):无该模块写权限的磁贴不显示。
// 下方「导入记录」表不过滤 —— 进得来这一屏(数据层任一查看或报表查看)就能看谁导了什么,只有文件名、行数、操作人。
const auth = useAuthStore()
const visibleTypes = computed(() => IMPORT_TYPES.filter(t => auth.can(t.module)))
const zones = useZonesStore()

const overview = ref<ImportLogOverviewDTO | null>(null)   // §6 加载信号
const importing = ref(false)
const activeKey = ref<string | null>(null)
const ctx = ref<ImportCtx>({})
const sort = ref<SortState | null>({ key: 'createdAt', dir: 'desc' })

// ledger 上下文表单
const ledgerForm = ref(false)
const companies = ref<CompanyDTO[]>([])
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM&co=<公司 id> 预填台账类表单。本屏没有「当前期」,读一次即可,不接 useDeepPeriod ——
// 所以产出方要 `tabs.openFresh('import')` 再 push(KeepAlive 缓存实例不再读 query,与 PoolLedgerView 同口径)。
// 只有年的链接(?p=YYYY)不认:年月是一对,半个期不预填(与台账 / 附10 的 t.month == null 早退同口径)。
// 默认会计期 = 深链的期,没有就当前年月(不硬编码,跨年自适应);公司 = 深链的 co(必须在名单里),没有就首家。
const route = useRoute()
const router = useRouter()
const tabs = useTabsStore()
const parsed = parsePeriod(route.query as Record<string, unknown>)
const deep = parsed?.month != null ? parsed : null
const now = new Date()
function defaultLf(): { companyId: number | null; year: number; month: number } {
  const dc = deep?.co
  const companyId = typeof dc === 'number' && companies.value.some(c => c.id === dc) ? dc : companies.value[0]?.id ?? null
  return { companyId, year: deep?.year ?? now.getFullYear(), month: deep?.month ?? now.getMonth() + 1 }
}
// 初值只解析出年月:此刻 companies 还没拉,公司必落 null;真正的预填在 openImport 里 companyApi.list 之后重跑 defaultLf()
const lf = ref(defaultLf())
// 年(手输)+ 月下拉合成一个月份字段(DATE-PICKER-SPEC D1):值 YYYY-MM,年不设上下限(同改前手输)
const lfYm = computed(() => `${lf.value.year}-${String(lf.value.month).padStart(2, '0')}`)
function setLfYm(v: string) { lf.value.year = +v.slice(0, 4); lf.value.month = +v.slice(5, 7) }
const companyOpts = computed(() => companies.value.map(c => ({ value: String(c.id), label: c.name })))

onMounted(reload)
async function reload() { overview.value = await importLogApi.overview() }

const activeEntry = computed<ImportTypeEntry | null>(() =>
  activeKey.value ? IMPORT_TYPES.find(t => t.key === activeKey.value) ?? null : null)
// 空对象兜底仅为类型占位:模板 v-if="importing && activeEntry" 保证渲染时必有 activeEntry
const modalProps = computed(() => activeEntry.value ? activeEntry.value.modalProps(ctx.value) : ({} as ReturnType<ImportTypeEntry['modalProps']>))

// ── 每类状态(由 latestByType 派生) ─────────────────────────
const IM_ST: Record<string, { label: string; c: string; bg: string }> = {
  done:    { label: '已是最新', c: 'var(--hue-blue)',   bg: 'var(--accent-blue)' },
  partial: { label: '部分',     c: 'var(--hue-orange)', bg: 'var(--warn-soft)' },
  warn:    { label: '有告警',   c: 'var(--hue-orange)', bg: 'var(--warn-soft)' },
  missing: { label: '未导入',   c: 'var(--hue-red)',    bg: 'var(--danger-soft)' },
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
// 账册模板缓存(§3 现行版全局生效:导入中心的列匹配也必须跟现行版,不退静态种子表——审查#25/#29)
let ledgerBooks: Book[] | null = null
let s10Books: Book[] | null = null

async function openImport(entry: ImportTypeEntry) {
  activeKey.value = entry.key
  ctx.value = {}
  if (entry.key === 's10') {
    if (!s10Books) s10Books = await booksApi.list('s10').catch(() => null)
    if (s10Books) ctx.value = { bookDefs: Object.fromEntries(
      s10Books.filter(b => b.phase != null).map(b => [b.phase!, b.definition])) }
  }
  // 期区清单喂 meter sheet 名反查(与 MeterView 页内导入同一份 store,拉不到留空数组 → meterExcel 回落写死三区)
  if (entry.key === 'meter') {
    await zones.ensure()
    ctx.value = { zones: zones.list }
  }
  if (entry.context === 'ledger') {
    if (!companies.value.length) companies.value = await companyApi.list()
    lf.value = defaultLf()
    ledgerForm.value = true
    return
  }
  if (entry.key.startsWith('charging_')) {
    const no = Number(entry.key.split('_')[1])
    ctx.value = { cats: await chargingApi.cats(no) }
  }
  importing.value = true
}
async function confirmLedger() {
  const c = companies.value.find(x => x.id === lf.value.companyId)
  if (!c) return
  if (activeKey.value === 'ledger' && !ledgerBooks)
    ledgerBooks = await booksApi.list('ledger').catch(() => null)
  ctx.value = { companyId: c.id, companyName: c.name, year: lf.value.year, month: lf.value.month,
    companyNames: companies.value.map(x => x.name),   // 整册拆段的 sheet 名识别用
    // 现行版模板(§3):列匹配与模板列跟账册;导入中心无列映射面板宿主,
    // 未匹配列由 registry 整批拦并指去台账页处置(§4 兜底口径)
    bookDef: ledgerBooks?.find(b => b.companyId === c.id)?.definition }
  ledgerForm.value = false
  importing.value = true
}

// ── 点导入 → 开跑前的确认(弹窗 confirm)→ runImport(执行+记录,弹窗 runner)→ 刷新记录表 → 弹窗原地出结果卡 ──
// 台账两道核对与预检(与 LedgerView.onImport 同款编排):①文件标题年月≠目标年月先确认 ②目标月已有数据先确认覆盖。
// 段模式(元素带 .records)不做这两问(规范 v1 边界)。
// V105:台账未登记租户不再预检拦截/自动建档 —— 配不上的名字照常入库为未绑定行,
// 到「月度台账」页的问题抽屉里绑定/改名/建档(与页内导入同一套语义)。
async function confirmRun(payload: ImportPayload): Promise<boolean> {
  if (activeKey.value !== 'ledger' || (payload as { records?: unknown }[])[0]?.records) return true
  const recs = payload as ImportRec[]
  const ym = recs[0]?.__ymDetected as { year: number; month: number } | undefined
  if (ym && (ym.year !== ctx.value.year || ym.month !== ctx.value.month) && !(await ask({
    title: `仍导入到 ${ctx.value.year} 年 ${ctx.value.month} 月？`,
    body: `文件标题识别为 ${ym.year} 年 ${ym.month} 月,当前导入目标是 ${ctx.value.year} 年 ${ctx.value.month} 月。`,
    action: '仍要导入',
  }))) return false
  return confirmLedgerOverwrite(recs)
}
// 台账②覆盖预检:目标月已有 N 家重叠租户行 → 确认后才导(拉不到本月数据则不拦,同租户表预检策略)
async function confirmLedgerOverwrite(recs: ImportRec[]): Promise<boolean> {
  try {
    const dto = await ledgerApi.month(ctx.value.companyId!, ctx.value.year!, ctx.value.month!)
    const existing = new Set(dto.rows.map(r => r.tenantName))
    // 按去重租户家数计(同名多行文件下与 LedgerView 同口径,复审:计数口径)
    const n = new Set(recs.map(r => String(r.tenantName ?? '').trim()).filter(nm => existing.has(nm))).size
    return n === 0 || await ask({
      title: `导入会覆盖 ${ctx.value.year} 年 ${ctx.value.month} 月 ${n} 家租户的台账`,
      body: `这 ${n} 家已有台账数据,文件里提供的列会被覆盖。`,
      action: '仍要导入',
    })
  } catch { return true }
}
// 导后「去查看」(SIDEBAR-UX-REDESIGN §9 P0b):只给期在导入时就已知的三类 —— 台账(ctx)、附10 / 附12(第一段 pick 的 year/month/phase);
// 平铺行的期在行里,本屏不解析,其余类型结果弹层照旧。年表屏 / 抄表屏的导入以后要接再加。
const viewTo = ref<{ path: string; query: Record<string, string> } | null>(null)
function viewLink(key: string, c: ImportCtx, payload: unknown[]): typeof viewTo.value {
  const first = payload[0] as { year?: number; month?: number; phase?: number; records?: unknown[] } | undefined
  // 台账只给平铺单段:整册多段(元素带 .records)入库的是各段自己识别出的公司 / 月,表单里的 ctx 只是兜底,按它发链会把人送去一个可能一行都没有的册与期
  if (key === 'ledger' && !first?.records && c.year && c.month && c.companyId)
    return periodLink('ledger', { p: periodOf(c.year, c.month), co: c.companyId })
  if (key === 's10' && first?.year && first.month)
    return periodLink('sales-income', { p: periodOf(first.year, first.month), co: first.phase })
  if (key === 'salary' && first?.year && first.month)
    return periodLink('salary', { p: periodOf(first.year, first.month) })
  return null
}
// 不 bump epoch:目标页签活着就走它 onReactivated 那条深链,不活就新实例 setup 那条。
// 页面里的链接 = 新页签紧挨本页右边(TAB-BAR-SPEC §2),导入中心不被换掉。
function goView() {
  const to = viewTo.value
  importing.value = false
  if (!to) return
  tabs.open(to.path.slice(1), { pin: true })   // viewTo 的 path 恒为 '/' + 屏 value(periodLink)
  router.push(to)
}
// 导入弹窗的 runner(UI-OVERLAY-SPEC §8):弹窗不关,写 + 记 import_log → 刷新导入记录;失败交给弹窗的失败卡。
// ctx 带上 _run:附表10 逐段画真进度、断了从断的那段接着导(其余类型不认它)。
async function runEntry(payload: ImportPayload, fileName: string, p?: ImportRunProgress): Promise<ImportOutcome | null> {
  if (!activeKey.value) return null
  viewTo.value = null
  const res = await runImport(activeKey.value, payload, { ...ctx.value, _run: p }, fileName)
  // 看不了目标屏就不出「去查看」(RBAC v3):财务专员有 entry:edit 能导工资,却没有 salary:view
  const link = viewLink(activeKey.value, ctx.value, payload as unknown[])
  viewTo.value = link && canViewPage(link.path, auth.can) ? link : null
  return settle(res, p, reload)
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
          <template #leading><component :is="iconFor('download')" :size="14" /></template>下载模板
        </Button>
      </div>
    </div>

    <!-- 原顶部「按数据类型上传 Excel」虚线块长得像拖放区却不收拖放,删掉;那句说明并进下面的副句 -->
    <div>
      <h3 class="im-section-t">按数据类型导入</h3>
      <p class="im-sub" style="margin:0 0 14px">每类数据对应一张模板,卡片显示最近导入状态;点卡片「上传」就地上传或粘贴,系统按模板列校验后入库</p>
      <FPEmpty v-if="!visibleTypes.length" size="sm" sub="下方仍可查看全部导入记录。">当前账号没有任何导入权限</FPEmpty>
      <div v-else class="im-grid">
        <div v-for="t in visibleTypes" :key="t.key" class="im-tile">
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
        <Select size="sm" :options="companyOpts" :model-value="lf.companyId == null ? '' : String(lf.companyId)"
          placeholder="请选择公司" @update:model-value="lf.companyId = +$event" />
      </label>
      <label>年月
        <DatePicker mode="month" size="sm" :model-value="lfYm" aria-label="年月" @update:model-value="setLfYm" />
      </label>
      <div class="im-ctx-foot">
        <Button variant="gray" size="sm" @click="ledgerForm = false">取消</Button>
        <Button variant="filled" size="sm" :disabled="lf.companyId == null" @click="confirmLedger">下一步</Button>
      </div>
    </div>
  </div>

  <!-- 「去查看」(SIDEBAR-UX-REDESIGN §9 P0b)只在导入中心有:结果卡多一颗按钮 -->
  <FpImportModal
    v-if="importing && activeEntry"
    v-bind="modalProps"
    :runner="runEntry"
    :confirm="confirmRun"
    :segmented="activeKey === 's10'"
    :go="viewTo ? '去查看' : undefined"
    done-note="从导入中心导入"
    @go="goView"
    @close="importing = false"
  />
</template>

<style scoped>
/* 1:1 from screen-import.jsx ImStyles */
.im { display:flex; flex-direction:column; gap:20px; max-width:1200px; margin:0 auto; width:100%; }
.im-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.im-title { margin:0; font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.im-sub { margin:5px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.im-actions { display:flex; gap:8px; }

.im-section-t { font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); margin:0 0 4px; }
.im-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(248px,1fr)); gap:14px; }
.im-tile { display:flex; flex-direction:column; gap:12px; padding:16px; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); transition:box-shadow var(--dur-fast) var(--ease-standard); }
.im-tile:hover { box-shadow:0 4px 16px rgba(28,28,28,.07); }
.im-tile-top { display:flex; align-items:flex-start; gap:10px; }
.im-tile-icon { width:36px; height:36px; border-radius:var(--radius-sm); background:var(--accent-slate); display:grid; place-items:center; color:var(--ink-900); flex:0 0 auto; }
.im-tile-name { font-size:var(--fs-body); font-weight:var(--fw-semibold); color:var(--text-primary); }
.im-tile-tag { font-size:11px; color:var(--text-muted); }
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
.im-ctx-foot { display:flex; gap:10px; justify-content:flex-end; margin-top:4px; }
</style>
