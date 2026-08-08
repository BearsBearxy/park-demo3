<script setup lang="ts">
// 楼栋损耗(POOL-ENGINE-SPEC §6,S3-B1 刀2)— 新路由 /alloc-loss,紧随公共电核算。
// FPLedgerTable 手法(sticky 首列/34px 行/mono 空值'–'/tfoot 钉底);行数≤20 不虚拟滚动。
// units=楼栋损耗快照;对账区两行=读时派生(供电侧总表 vs 单元总表Σ/分表Σ),单元行后接续渲染。
// 编辑态(EDIT-MODE-SPEC v2):调整度数/调整损耗/g_adj 行内改 → PUT /cfg scope=building:{id}
// 月行 loss_adj_qty/loss_adj_rate/loss_g_adj(commitAdj 模式)→ 提示重新生成。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import { allocApi, type AllocCfgDTO, type AllocLossDTO } from '@/api/alloc'
import { POOL_ZONE_LABEL, buildLossReconRows, lossFooter } from '@/utils/poolLedgerLogic'
import { buildYearOptions } from '@/utils/yearGate'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'

const auth = useAuthStore()
const canEdit = computed(() => !auth.isReadonly)

// ── 编辑模式(EDIT-MODE-SPEC v2):不跨会话;KeepAlive 切页签回来也回浏览态 ──
const editMode = ref(false)
onDeactivated(() => { editMode.value = false })

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fpct = (r: number | null | undefined) => (r == null ? '–' : (r * 100).toFixed(2) + '%')
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback

// ── 账期 + zone Segmented(只有一期/二期;宿舍无损耗单元) ──
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  buildYearOptions(dataYears.value, today).map(y => ({ value: String(y), label: `${y}年` })))
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const ym = computed(() => `${year.value}-${pad2(month.value)}`)
const zone = ref<string>('p1')
const ZONE_OPTS = [{ value: 'p1', label: '一期' }, { value: 'p2', label: '二期' }]

// ── 数据(竞态守卫) ──
const loss = ref<AllocLossDTO | null>(null)
const cfgs = ref<AllocCfgDTO[]>([])
let seq = 0
async function loadMonth() {
  const my = ++seq
  const [ls, cs] = await Promise.all([
    allocApi.loss(ym.value),
    allocApi.cfg(ym.value).catch(() => [] as AllocCfgDTO[]),
  ])
  if (my !== seq) return
  loss.value = ls; cfgs.value = cs
}
onMounted(async () => {
  try {
    dataYears.value = await allocApi.years()
    const latest = dataYears.value[dataYears.value.length - 1]
    if (latest && latest !== year.value) { year.value = latest; return }   // watch 触发 loadMonth
  } catch { /* 年份失败不阻断 */ }
  loadMonth()
})
watch([year, month], loadMonth)

const generated = computed(() => loss.value?.generated ?? false)
const units = computed(() => (loss.value?.units ?? []).filter(u => u.zone === zone.value))
const reconRows = computed(() =>
  buildLossReconRows((loss.value?.recon ?? []).find(r => r.zone === zone.value)))
const foot = computed(() => lossFooter(units.value))

// 列模型:铝缆列仅 p2,公摊分摊度数列仅 p1
const isP2 = computed(() => zone.value === 'p2')
// 基础 9 列(位置/总表/分表/损耗量/原率/调整度/调整损/收租率/备注)+铝缆(p2)+公摊度数(p1)
const colCount = computed(() => 9 + (isP2.value ? 1 : 0) + (zone.value === 'p1' ? 1 : 0))
const LBL_W = 210
const w = (px: number) => ({ width: px + 'px', minWidth: px + 'px', maxWidth: px + 'px' })
const fixLbl = { ...w(LBL_W), left: '0px', borderRight: '1px solid var(--border-subtle)' }

// ── 行内人工参数(编辑态):building:{headBuildingId} 月行,commitAdj 模式 → 提示重新生成 ──
const cfgDirty = ref(false)
const cfgRaw = (buildingId: number, key: string) =>
  cfgs.value.find(c => c.scope === `building:${buildingId}` && c.cfgKey === key && c.acctMonth === ym.value)
function commitAdj(buildingId: number, key: 'loss_adj_qty' | 'loss_adj_rate' | 'loss_g_adj', raw: string) {
  const t = raw.trim()
  const v = t === '' ? null : Number(t)
  if (v != null && !isFinite(v)) { alert('请输入数字'); return }
  allocApi.saveCfg({ scope: `building:${buildingId}`, cfgKey: key, acctMonth: ym.value, value: v })
    .then(() => { cfgDirty.value = true; loadMonth() })
    .catch(e => alert(errMsg(e, '保存失败，请重试')))
}
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
        <Button v-if="canEdit" :variant="editMode ? 'filled' : 'outline'" size="sm" @click="editMode = !editMode">
          <template #leading><component :is="iconFor(editMode ? 'check' : 'pencil')" :size="14" /></template>
          {{ editMode ? '完成' : '编辑模式' }}
        </Button>
      </div>
    </div>

    <!-- 提示条:本月未生成 / 参数已变请重新生成(生成入口在公共电核算屏) -->
    <div v-if="!generated" class="ll-bar">
      <component :is="iconFor('info')" :size="14" />
      <span>{{ year }}年{{ month }}月未生成 —— 损耗快照为空;在「公共电核算」屏点「生成本月」后此处落数。</span>
    </div>
    <div v-if="cfgDirty" class="ll-bar warn">
      <component :is="iconFor('alert-triangle')" :size="14" />
      <span>参数已变,请重新生成 —— 屏上数字仍是旧快照,到「公共电核算」屏点「重新生成」后生效。</span>
    </div>

    <!-- 台账式宽表:单元行 + 对账区两行(供电侧总表 vs 单元合计) + tfoot 合计 -->
    <div class="ll-wrap">
      <table class="ll-table">
        <thead>
          <tr>
            <th class="ll-th ll-fix-th ll-fix" :style="fixLbl">位置</th>
            <th class="ll-th" :style="w(108)">总表用电量</th>
            <th v-if="isP2" class="ll-th" :style="w(104)" title="仅陈列,不入总表/分表合计">铝缆用电量</th>
            <th class="ll-th" :style="w(108)">分表用电量</th>
            <th class="ll-th" :style="w(100)">损耗量</th>
            <th class="ll-th" :style="w(92)">原损耗率</th>
            <th v-if="zone === 'p1'" class="ll-th" :style="w(116)" title="一期:园区公共池/均摊座数+g_adj;编辑态改 g_adj">公摊分摊度数</th>
            <th class="ll-th" :style="w(96)" title="人工调整度数(如 −1500),building 月行 loss_adj_qty">调整度数</th>
            <th class="ll-th" :style="w(92)" title="人工加点(一期 0.003~0.018/二期 0.002),building 月行 loss_adj_rate">调整损耗</th>
            <th class="ll-th" :style="w(116)">收取租户损耗率</th>
            <th class="ll-th" :style="w(170)">备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in units" :key="u.headBuildingId">
            <td class="ll-fix" :style="fixLbl">
              <span class="ll-lbl" :title="u.label">
                {{ u.label }}
                <span v-if="u.variant === 'share_only'" class="ll-var" title="纯公摊式:率=G/C+加点">公摊式</span>
                <span v-else-if="u.variant === 'none'" class="ll-var dim" title="不核算(组内无分表或 D=C)">不核算</span>
              </span>
            </td>
            <td><span class="ll-nv" :class="{ empty: u.cQty == null }">{{ fmt(u.cQty) }}</span></td>
            <td v-if="isP2"><span class="ll-nv" :class="{ empty: u.cableQty == null }">{{ fmt(u.cableQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.dQty == null }">{{ fmt(u.dQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.eQty == null, neg: (u.eQty ?? 0) < 0 }">{{ fmt(u.eQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.rawRate == null }">{{ fpct(u.rawRate) }}</span></td>
            <td v-if="zone === 'p1'">
              <input v-if="editMode" class="ll-ni" type="number" step="any"
                     :value="cfgRaw(u.headBuildingId, 'loss_g_adj')?.value ?? ''"
                     placeholder="g_adj –" :title="`g_adj 人工调整(如 −1500);当前快照 G=${fmt(u.gQty)}`"
                     @change="commitAdj(u.headBuildingId, 'loss_g_adj', ($event.target as HTMLInputElement).value)" />
              <span v-else class="ll-nv" :class="{ empty: u.gQty == null }">{{ fmt(u.gQty) }}</span>
            </td>
            <td>
              <input v-if="editMode" class="ll-ni" type="number" step="any"
                     :value="cfgRaw(u.headBuildingId, 'loss_adj_qty')?.value ?? ''"
                     placeholder="–" title="人工调整度数,回车/失焦保存;清空=删行"
                     @change="commitAdj(u.headBuildingId, 'loss_adj_qty', ($event.target as HTMLInputElement).value)" />
              <span v-else class="ll-nv" :class="{ empty: u.adjQty == null }">{{ fmt(u.adjQty) }}</span>
            </td>
            <td>
              <input v-if="editMode" class="ll-ni" type="number" step="any"
                     :value="cfgRaw(u.headBuildingId, 'loss_adj_rate')?.value ?? ''"
                     placeholder="–" title="人工加点(小数,如 0.003),回车/失焦保存"
                     @change="commitAdj(u.headBuildingId, 'loss_adj_rate', ($event.target as HTMLInputElement).value)" />
              <span v-else class="ll-nv" :class="{ empty: u.adjRate == null }">{{ fpct(u.adjRate) }}</span>
            </td>
            <td><span class="ll-rate" :class="{ empty: u.tenantRate == null }">{{ fpct(u.tenantRate) }}</span></td>
            <td><span class="ll-txt" :title="u.note ?? undefined">{{ u.note ?? '–' }}</span></td>
          </tr>
          <tr v-if="units.length === 0">
            <td class="ll-noro" :colspan="colCount">{{ POOL_ZONE_LABEL[zone] }}本月无损耗单元(需生成快照)</td>
          </tr>
          <!-- 对账区两行(读时派生;p1 的Σ排除 A座 loss_recon=0) -->
          <tr v-for="(r, i) in reconRows" :key="'rc' + i" class="ll-recon">
            <td class="ll-fix" :style="fixLbl"><span class="ll-lbl">{{ r.label }}</span></td>
            <td><span class="ll-nv" :class="{ empty: r.cQty == null }">{{ fmt(r.cQty) }}</span></td>
            <td v-if="isP2"></td>
            <td><span class="ll-nv" :class="{ empty: r.dQty == null }">{{ fmt(r.dQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: r.loss == null, neg: (r.loss ?? 0) < 0 }">{{ fmt(r.loss) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: r.rate == null }">{{ fpct(r.rate) }}</span></td>
            <td :colspan="colCount - 5 - (isP2 ? 1 : 0)"></td>
          </tr>
        </tbody>
        <!-- tfoot 合计:Σ总表/铝缆/分表/损耗量(率不合计) -->
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
.ll-bar.warn { border-color: var(--hue-orange); background: rgb(255, 250, 235); color: rgb(138, 97, 0); }

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
.ll-rate { display: block; text-align: right; font-size: 12px; padding: 0 8px; font-weight: var(--fw-semibold); color: var(--hue-blue); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ll-rate.empty { color: var(--text-disabled); font-weight: var(--fw-regular); }
.ll-txt { display: block; text-align: left; font-size: 12px; padding: 0 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 对账区两行(分隔带样式对标 mlg-bsum) */
.ll-table tbody tr.ll-recon td { height: 40px; background: var(--surface-sunken); border-top: 2px solid var(--border-strong); border-bottom: 2px solid var(--border-strong); }
.ll-table tbody tr.ll-recon + tr.ll-recon td { border-top: none; }

/* 行内 input(透明格) */
.ll-ni { width: 100%; box-sizing: border-box; border: 1px solid transparent; background: transparent; text-align: right; font-size: 12px; padding: 3px 6px; outline: none; color: var(--text-primary); font-family: var(--font-mono); border-radius: var(--radius-sm); }
.ll-ni:focus { background: var(--accent-blue); border-color: var(--hue-blue); }
.ll-ni::-webkit-outer-spin-button, .ll-ni::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.ll-ni::placeholder { color: var(--text-disabled); }

.ll-noro { text-align: center; padding: 40px 16px; color: var(--text-disabled); font-size: var(--fs-label); }

.ll-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 40px; font-weight: var(--fw-semibold); background: var(--surface-white); border-top: 2px solid var(--border-strong); font-family: var(--font-mono); color: var(--text-primary); }
.ll-table tfoot th.ll-fix { z-index: 7; }
.ll-foot-lbl { display: block; padding: 0 10px; text-align: left; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
.ll-foot-v { display: block; text-align: right; padding: 0 8px; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--brand-deep); }
</style>
