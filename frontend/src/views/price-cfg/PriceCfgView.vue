<script setup lang="ts">
// 价目管理 v2(PRICE-CFG-SPEC §6)— 数据中心·出账链组(合同管理之后)。派生引擎取价的单一事实源:
// 单视图双栏(取消 tabs)。左栏价目表=版本链生效价(费项|范围|生效价|生效自|更新时间),编辑态末列
// 录"自选定月起"的新版本(改价不扰历史账期);右栏=版本状态卡+户级例外卡。取价规则见
// utils/priceCfgLogic.resolvePrice(月变键精确命中/常数键前滚,与 S3 引擎同规则)。
// 编辑模式遵 EDIT-MODE-SPEC v2(浏览态零写入口);56px 行高遵 LIST-PAGE-SPEC(全量小表免分页,
// 短窗外层滚动);加载门/覆盖层遵 DESIGN-FIDELITY §6/§7。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import { priceCfgApi, type PriceCfgDTO } from '@/api/priceCfg'
import { allocApi } from '@/api/alloc'
import { tenantApi } from '@/api/tenant'
import { buildYearOptions } from '@/utils/yearGate'
import type { TenantDTO } from '@/types/tenant'
import {
  PRICE_KEYS, SCOPE_LABEL, buildPriceGrid, buildVersionStatus, type PriceKeyMeta,
} from '@/utils/priceCfgLogic'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Select from '@/components/ds/Select.vue'
import Input from '@/components/ds/Input.vue'
import Badge from '@/components/ds/Badge.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import type { FPTenantOption } from '@/components/fp/fpTenantPicker'

const auth = useAuthStore()
const canEdit = computed(() => !auth.isReadonly)
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback
const fmtTime = (iso: string) => iso.slice(0, 16).replace('T', ' ') // YYYY-MM-DD HH:mm

// ── 编辑模式(EDIT-MODE-SPEC v2):不跨会话;KeepAlive 切页签回来也回浏览态 ──
const editMode = ref(false)
onDeactivated(() => { editMode.value = false; drawer.value = false })

// ── 年月(alloc 式,年清单来自现有口径) ──
const pad2 = (n: number) => String(n).padStart(2, '0')
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  buildYearOptions(dataYears.value, today).map(y => ({ value: String(y), label: `${y}年` })))
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const ym = computed(() => `${year.value}-${pad2(month.value)}`)
const prevYm = computed(() =>
  month.value === 1 ? `${year.value - 1}-12` : `${year.value}-${pad2(month.value - 1)}`)

// ── 数据(GET 无参全量,版本链解析归前端;月切换重拉顺带刷新并发改动) ──
const rows = ref<PriceCfgDTO[] | null>(null)
const tenants = ref<TenantDTO[]>([])
const tenantOpts = computed<FPTenantOption[]>(() =>
  tenants.value.map(t => ({ id: t.id, name: t.companyName, phase: t.phase })))

// 竞态守卫:快速切年月只接受最新一次请求
let seq = 0
async function loadBook() {
  const my = ++seq
  const rs = await priceCfgApi.list()
  if (my !== seq) return
  rows.value = rs
}
onMounted(async () => {
  tenantApi.list().then(ts => { tenants.value = ts })
  try {
    dataYears.value = await allocApi.years()
    const latest = dataYears.value[dataYears.value.length - 1]
    if (latest && latest !== year.value) { year.value = latest; return } // watch 触发 loadBook
  } catch { /* 年份失败不阻断 */ }
  loadBook()
})
watch([year, month], loadBook)

// ── 左栏价目表:版本链解析 + 编辑态录新版本(即时写回免脏守卫) ──
const grid = computed(() => buildPriceGrid(rows.value ?? [], ym.value))
const vs = computed(() => buildVersionStatus(rows.value ?? [], ym.value))
const SCOPE_TONE: Record<string, 'neutral' | 'blue' | 'cyan' | 'orange'> =
  { '': 'neutral', p1: 'blue', p2: 'cyan', dorm: 'orange' }

// 录新版本:acctMonth=选定月(只影响选定月及以后账期);清空=删除选定月版本行
function commit(scope: string, key: string, raw: string) {
  const t = raw.trim()
  const v = t === '' ? null : Number(t)
  if (v != null && !isFinite(v)) { alert('请输入数字'); return }
  priceCfgApi.save({ scope, cfgKey: key, acctMonth: ym.value, value: v })
    .then(loadBook)
    .catch(e => alert(errMsg(e, '保存失败')))
}

// 复制上月电价(编辑态;仅月变电价 6 键,目标月已有版本跳过=幂等)
async function onCopy() {
  if (!confirm(`确认复制上月电价 ${prevYm.value} → ${ym.value}?仅复制电价 6 个月变键的版本,目标月已有版本的键跳过不覆盖。`)) return
  try {
    const r = await priceCfgApi.copy(prevYm.value, ym.value)
    alert(`复制完成:新增 ${r.copied} 行,跳过已存在 ${r.skipped} 行。`)
    await loadBook()
  } catch (e) { alert(errMsg(e, '复制失败')) }
}

// ── 右栏户级例外(紧凑表) ──
interface ExRow {
  id: number; tenant: string; fee: string; unit: string
  value: number; monthLabel: string; note: string; raw: PriceCfgDTO
}
const keyMeta = new Map<string, PriceKeyMeta>(PRICE_KEYS.map(m => [m.key, m]))
const exceptions = computed<ExRow[]>(() =>
  (rows.value ?? []).filter(r => r.scope.startsWith('tenant:')).map(r => ({
    id: r.id,
    tenant: r.tenantName ?? r.scope,
    fee: keyMeta.get(r.cfgKey)?.label ?? r.cfgKey,
    unit: keyMeta.get(r.cfgKey)?.unit ?? '',
    value: r.value,
    monthLabel: r.acctMonth === '' ? '长期' : r.acctMonth,
    note: r.note ?? '',
    raw: r,
  })))

function delException(r: ExRow) {
  if (!confirm(`确认删除「${r.tenant} · ${r.fee}」例外？删除后该户回退默认价。`)) return
  priceCfgApi.save({ scope: r.raw.scope, cfgKey: r.raw.cfgKey, acctMonth: r.raw.acctMonth, value: null })
    .then(loadBook)
    .catch(e => alert(errMsg(e, '删除失败')))
}

// 新增例外抽屉(FPDrawer 居中卡):租户+overridable 费项+生效月(空=长期)+值+备注
const drawer = ref(false)
const exErr = ref('')
const OVERRIDABLE = PRICE_KEYS.filter(k => k.overridable)
const feeOpts = OVERRIDABLE.map(k => ({ value: k.key, label: `${k.label}(${k.unit})` }))
const exForm = ref({ tenantId: null as number | null, cfgKey: OVERRIDABLE[0].key, month: '', value: '', note: '' })
function openDrawer() {
  exForm.value = { tenantId: null, cfgKey: OVERRIDABLE[0].key, month: '', value: '', note: '' }
  exErr.value = ''
  drawer.value = true
}
async function submitException() {
  const f = exForm.value
  if (f.tenantId == null) { exErr.value = '请选择租户'; return }
  const v = Number(f.value)
  if (f.value.trim() === '' || !isFinite(v)) { exErr.value = '请输入数值'; return }
  const m = f.month.trim()
  if (m !== '' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) { exErr.value = '生效月格式 YYYY-MM,留空=长期'; return }
  try {
    await priceCfgApi.save({ scope: `tenant:${f.tenantId}`, cfgKey: f.cfgKey, acctMonth: m, value: v, note: f.note.trim() || null })
    drawer.value = false
    await loadBook()
  } catch (e) { exErr.value = errMsg(e, '保存失败') }
}
</script>

<template>
  <div v-if="!rows" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="pc-page">
    <!-- 标题行 -->
    <div class="pc-head">
      <div>
        <h2 class="pc-title"><span class="ic"><component :is="iconFor('tags')" :size="18" /></span>价目管理</h2>
        <p class="pc-sub">收费价目版本簿 · 派生取价单一事实源</p>
      </div>
    </div>

    <!-- 工具栏:年月+月变价状态徽标 | 复制上月电价(编辑态)+编辑模式 -->
    <div class="mx-toolbar">
      <div class="pc-tb-left">
        <div style="width:110px">
          <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
        </div>
        <div style="width:92px">
          <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
        </div>
        <span class="pc-mbadge" :class="vs.monthlyMissing.length ? 'bad' : 'ok'"
              :title="vs.monthlyMissing.length
                ? `缺当月电价版本,该月派生将被门禁拦截:${vs.monthlyMissing.join('、')}`
                : `${ym} 电价 6 键当月版本齐备`">
          电价 {{ vs.monthlyHit }}/{{ vs.monthlyTotal }}
        </span>
      </div>
      <div class="mx-toolbar-right">
        <Button v-if="editMode" variant="outline" size="sm" @click="onCopy">
          <template #leading><component :is="iconFor('copy')" :size="14" /></template>
          复制上月电价
        </Button>
        <Button v-if="canEdit" :variant="editMode ? 'filled' : 'outline'" size="sm" @click="editMode = !editMode">
          <template #leading><component :is="iconFor(editMode ? 'check' : 'pencil')" :size="14" /></template>
          {{ editMode ? '完成' : '编辑模式' }}
        </Button>
      </div>
    </div>

    <!-- 空态三分支:整簿无任何版本 -->
    <div v-if="rows.length === 0" class="pc-emptybar">
      <component :is="iconFor('info')" :size="14" />
      <span>
        价目簿暂无任何版本 ——
        <template v-if="editMode">可直接在左侧表格「新价」列录入,自 {{ ym }} 起生效。</template>
        <template v-else-if="canEdit">进入右上角「编辑模式」开始录入价目。</template>
        <template v-else>价目由管理员维护,录入后此处展示生效价。</template>
      </span>
    </div>

    <!-- 双栏:左=价目表 右=版本状态+户级例外 -->
    <div class="mx-body pc-body">
      <!-- ══ 左栏·价目表 ══ -->
      <Card surface="white" :padding="0" class="pc-listcard">
        <div class="pc-cardhead">
          <div class="pc-cardtitles">
            <span class="pc-cardtitle">价目表 · {{ year }}年{{ month }}月</span>
            <span class="pc-cardsub">生效价=版本链解析(与派生引擎同口径);改价=录入自选定月起的新版本,历史账期不受扰动</span>
          </div>
        </div>
        <div class="pc-tablewrap">
          <table class="pc-table">
            <colgroup>
              <col style="width:280px" /><col style="width:84px" /><col style="width:150px" /><col style="width:92px" /><col style="width:160px" />
              <col v-if="editMode" style="width:150px" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>费项</th><th>范围</th><th class="num">生效价</th><th>生效自</th><th>更新时间</th>
                <th v-if="editMode" class="num">新价({{ month }}月起)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="g in grid" :key="g.group">
                <tr class="grp"><td :colspan="editMode ? 7 : 6">{{ g.group }}</td></tr>
                <tr v-for="r in g.rows" :key="r.meta.key + '|' + r.scope">
                  <td class="lbl" :title="r.meta.hint">
                    {{ r.meta.label }}<span class="pc-unit">{{ r.meta.unit }}</span>
                  </td>
                  <td><Badge :tone="SCOPE_TONE[r.scope] ?? 'neutral'" :dot="false">{{ SCOPE_LABEL[r.scope] ?? r.scope }}</Badge></td>
                  <td class="num eff"><span :class="{ zero: !r.eff }">{{ r.eff?.value ?? '—' }}</span></td>
                  <td class="mut">{{ r.eff ? (r.eff.effMonth === '' ? '长期' : r.eff.effMonth) : '—' }}</td>
                  <td class="mut mono">{{ r.eff ? fmtTime(r.eff.updatedAt) : '—' }}</td>
                  <td v-if="editMode" class="num">
                    <input class="pc-in" type="number" step="any" :value="r.cur?.value ?? ''"
                           :placeholder="`自 ${ym} 起`"
                           :title="`回车/失焦保存,只影响 ${ym} 及以后账期;清空=删除 ${ym} 版本`" @click.stop
                           @change="commit(r.scope, r.meta.key, ($event.target as HTMLInputElement).value)" />
                  </td>
                  <td></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </Card>

      <!-- ══ 右栏 ══ -->
      <div class="pc-side">
        <!-- 上卡·版本状态 -->
        <Card surface="white" :padding="0" class="pc-listcard">
          <div class="pc-cardhead">
            <div class="pc-cardtitles"><span class="pc-cardtitle">版本状态 · {{ ym }}</span></div>
          </div>
          <div class="pc-vs">
            <div class="pc-vsrow">
              <span class="k">电价当月版本</span>
              <span class="v mono" :class="vs.monthlyMissing.length ? 'bad' : 'ok'">{{ vs.monthlyHit }}/{{ vs.monthlyTotal }}</span>
            </div>
            <div v-if="vs.monthlyMissing.length" class="pc-vsmiss">缺:{{ vs.monthlyMissing.join('、') }}</div>
            <div class="pc-vsdiv" />
            <div v-for="g in vs.groups" :key="g.group" class="pc-vsrow">
              <span class="k">{{ g.group }}</span>
              <span class="v mono" :class="{ zero: g.effective === 0 }">{{ g.effective }}/{{ g.total }} 键生效</span>
            </div>
            <div class="pc-vsdiv" />
            <div class="pc-vsrow">
              <span class="k">最近更新</span>
              <span v-if="vs.latest" class="v" :title="vs.latest.label">{{ vs.latest.label }} · {{ fmtTime(vs.latest.updatedAt) }}</span>
              <span v-else class="v zero">—</span>
            </div>
          </div>
        </Card>

        <!-- 下卡·户级例外 -->
        <Card surface="white" :padding="0" class="pc-listcard">
          <div class="pc-cardhead">
            <div class="pc-cardtitles">
              <span class="pc-cardtitle">户级例外</span>
              <span class="pc-cardsub">户级价覆盖分区与全园(级联第一优先)</span>
            </div>
            <Button v-if="editMode" variant="outline" size="sm" @click="openDrawer">
              <template #leading><component :is="iconFor('plus')" :size="14" /></template>
              新增
            </Button>
          </div>
          <div v-if="exceptions.length === 0" class="pc-exempty">
            暂无户级例外,全部租户按默认价目计价<template v-if="editMode">;点上方「新增」为个别租户设置专属价</template>。
          </div>
          <table v-else class="pc-extab">
            <colgroup><col /><col style="width:88px" /><col style="width:62px" /><col style="width:64px" /><col v-if="editMode" style="width:32px" /></colgroup>
            <thead>
              <tr><th>租户</th><th>费项</th><th class="num">值</th><th>生效自</th><th v-if="editMode"></th></tr>
            </thead>
            <tbody>
              <tr v-for="r in exceptions" :key="r.id" :title="r.note || undefined">
                <td class="ten" :title="r.tenant">{{ r.tenant }}</td>
                <td class="mut" :title="`${r.fee}(${r.unit})`">{{ r.fee }}</td>
                <td class="num mono">{{ r.value }}</td>
                <td class="mut">{{ r.monthLabel }}</td>
                <td v-if="editMode" class="ops">
                  <button class="pc-del" title="删除例外" @click.stop="delException(r)">
                    <component :is="iconFor('trash-2')" :size="13" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>

    <!-- 新增例外抽屉(编辑态) -->
    <FPDrawer :open="drawer" title="新增户级例外" subtitle="户级价覆盖分区与全园默认 · 生效月留空=长期生效"
              icon="tags" :width="460" @close="drawer = false">
      <FPTenantPicker :tenants="tenantOpts" v-model="exForm.tenantId" placeholder="选择租户" />
      <Select v-model="exForm.cfgKey" label="费项(仅可户级覆盖项)" :options="feeOpts" size="sm" />
      <Input v-model="exForm.month" label="生效月" placeholder="YYYY-MM,留空=长期" size="sm" />
      <Input v-model="exForm.value" label="值" placeholder="如 4.45" size="sm" />
      <Input v-model="exForm.note" label="备注" placeholder="数值来源锚点,如:合同约定" size="sm" />
      <div class="pc-dlg-err">{{ exErr }}</div>
      <template #footer>
        <Button variant="gray" size="sm" @click="drawer = false">取消</Button>
        <Button variant="filled" size="sm" @click="submitException">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          保存
        </Button>
      </template>
    </FPDrawer>
  </div>
</template>

<style scoped>
/* 页面纵排(壳层滚动;全量小表不分页) */
.pc-page { display: flex; flex-direction: column; gap: 16px; box-sizing: border-box; max-width: 1400px; margin: 0 auto; width: 100%; }

.pc-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pc-title { margin: 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.pc-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.pc-sub { margin: 5px 0 0; font-size: var(--fs-label); color: var(--text-muted); }

.pc-tb-left { display: flex; align-items: center; gap: 10px; }

/* 月变价状态徽标:6/6 绿 / 缺 N 红 */
.pc-mbadge { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: var(--radius-full); font-size: var(--fs-label); font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; cursor: default; }
.pc-mbadge.ok { color: rgb(22, 142, 77); background: rgba(52, 199, 89, 0.14); }
.pc-mbadge.bad { color: var(--hue-red); background: rgba(255, 59, 48, 0.12); }

/* 空态提示条(三分支) */
.pc-emptybar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }

/* 双栏(§6 v2):左表格弹性 + 右 360px;窄窗右栏 wrap 到下方
   (全局 .mx-body 是 224px KPI 栏语义,此处按 v2 覆写列模板,并自带窄窗降级) */
.pc-body { grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start; }
@media (max-width: 1100px) { .pc-body { grid-template-columns: 1fr; grid-template-rows: none; } }
.pc-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* 列表卡(LIST-PAGE-SPEC 形态) */
.pc-listcard { border: 1px solid var(--border-subtle); overflow: hidden; }
.pc-cardhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 18px 12px; border-bottom: 1px solid var(--divider); }
.pc-cardtitles { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.pc-cardtitle { font-size: 14.5px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.pc-cardsub { font-size: var(--fs-label); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc-tablewrap { overflow-x: auto; }

/* 左栏表格:定宽列律+等高行(--mx-row-h 56px);内容 ellipsis 不撑行 */
.pc-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: var(--font-sans); }
.pc-table th { position: sticky; top: 0; z-index: 2; background: var(--surface-white); padding: 8px 14px; text-align: left; font: var(--type-label); font-weight: var(--fw-regular); color: var(--text-muted); white-space: nowrap; border-bottom: 1px solid var(--divider); }
.pc-table th.num { text-align: right; }
.pc-table tbody tr { height: var(--mx-row-h, 56px); border-bottom: 1px solid var(--divider); }
.pc-table tbody tr:last-child { border-bottom: none; }
.pc-table td { padding: 0 14px; vertical-align: middle; font-size: 12.5px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc-table td.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pc-table td.eff { font-weight: var(--fw-semibold); }
.pc-table td.lbl { font-weight: var(--fw-medium); }
.pc-table td.mut { color: var(--text-muted); }
.pc-table td.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 12px; }
.pc-table .zero { color: var(--text-disabled); font-weight: var(--fw-regular); }
/* 分组小节头行(§2 group) */
.pc-table tbody tr.grp { height: 38px; background: var(--surface-card); }
.pc-table tr.grp td { font: var(--type-label); font-weight: var(--fw-semibold); color: var(--text-secondary); }

.pc-unit { margin-left: 6px; font-size: var(--fs-micro); color: var(--text-disabled); font-weight: var(--fw-regular); }

/* 行内输入(编辑态,即时写回) */
.pc-in { width: 100%; min-width: 0; box-sizing: border-box; height: 30px; padding: 0 8px; text-align: right; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-body); color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard); appearance: textfield; -moz-appearance: textfield; }
.pc-in::-webkit-outer-spin-button, .pc-in::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pc-in:focus { outline: none; border-color: var(--hue-blue); }
.pc-in::placeholder { color: var(--text-disabled); font-family: var(--font-sans); }

/* 右栏·版本状态卡(紧凑列表) */
.pc-vs { padding: 10px 18px 14px; display: flex; flex-direction: column; gap: 8px; }
.pc-vsrow { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12.5px; }
.pc-vsrow .k { color: var(--text-secondary); flex: 0 0 auto; }
.pc-vsrow .v { color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-vsrow .v.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pc-vsrow .v.ok { color: rgb(22, 142, 77); font-weight: var(--fw-semibold); }
.pc-vsrow .v.bad { color: var(--hue-red); font-weight: var(--fw-semibold); }
.pc-vsrow .v.zero, .pc-vs .zero { color: var(--text-disabled); }
.pc-vsmiss { font-size: var(--fs-label); color: var(--hue-red); line-height: 1.5; }
.pc-vsdiv { border-top: 1px solid var(--divider); margin: 2px 0; }

/* 右栏·户级例外紧凑表 */
.pc-exempty { padding: 18px; font-size: var(--fs-label); color: var(--text-muted); }
.pc-extab { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: var(--font-sans); }
.pc-extab th { padding: 8px 10px; text-align: left; font: var(--type-label); font-weight: var(--fw-regular); color: var(--text-muted); white-space: nowrap; border-bottom: 1px solid var(--divider); }
.pc-extab th.num { text-align: right; }
.pc-extab tbody tr { border-bottom: 1px solid var(--divider); }
.pc-extab tbody tr:last-child { border-bottom: none; }
.pc-extab td { padding: 9px 10px; vertical-align: middle; font-size: 12px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc-extab td.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pc-extab td.ten { font-weight: var(--fw-medium); }
.pc-extab td.mut { color: var(--text-muted); }
.pc-extab td.mono { font-family: var(--font-mono); }
.pc-extab td.ops { padding: 0 6px; text-align: right; overflow: visible; }
.pc-del { width: 24px; height: 24px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; }
.pc-del:hover { background: rgb(255, 238, 237); color: var(--hue-red); }

.pc-dlg-err { font-size: 11.5px; color: var(--hue-red); min-height: 14px; }
</style>
