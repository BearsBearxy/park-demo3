<script setup lang="ts">
// 合同弹窗(新增/编辑/续签三态) — 样式 1:1 LedgerNewCompanyDialog/FinDialogs(.ct-mask/.ct-dlg 居中弹窗,
// Teleport to body,回车提交,错误行内提示);字段多,两列排布。
// 无 prop=新增(emit created);initial=编辑(全字段回填,提交走 update);renewFrom=续签(租户/楼栋/单元锁定,
// 提交走 renew,原合同将标记已续签)。编辑/续签成功 emit saved 携带最新 DTO,由父级刷新 list+summary+drawer。
// 计费(CONTRACT-CARD-SPEC §6.2 单一编辑):选物业类型 → 钉死费用组自动出现(无自由加费用名);条件项 checkbox
// 勾选落行(电梯/变压器填月额,infra 为 per_sqm 填面积×单价);宿舍门禁/网络只填间数;空地为附加段。
// 月租金/租赁面积由计费行汇总(不双录入,无独立月租金输入)。
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import FPUnitPicker from '@/components/fp/FPUnitPicker.vue'
import { selectedAreaSums, prefillRentArea } from '@/components/fp/fpUnitPicker'
import type { FPUnitOption } from '@/components/fp/fpUnitPicker'
import { contractApi } from '@/api/contract'
import { tenantApi } from '@/api/tenant'
import { buildingApi } from '@/api/building'
import {
  FEE_NAME, defaultBillMode, lineMonthly, isRentKey,
  PROPERTY_TYPES, PROPERTY_TYPE_LABEL, PINNED_FEES, COND_FEES, OPTIONAL_FEES,
  BUILDING_RENT_KEYS, feeLabel, inferPropertyType, pinnedDefaultUnitPrice,
} from '@/types/contract'
import type { ContractDTO, RentFreePeriod, FeeKey, PropertyType, BillingLineDTO, BillingLineReq } from '@/types/contract'
import type { TenantDTO } from '@/types/tenant'
import type { BuildingDTO } from '@/types/building'

const props = defineProps<{
  /** 编辑态:待编辑合同(与 renewFrom 互斥) */
  initial?: ContractDTO | null
  /** 续签态:原合同(与 initial 互斥) */
  renewFrom?: ContractDTO | null
  /** 新增态可选:预设并锁定楼栋(楼栋抽屉「新增合同」入口) */
  presetBuildingId?: number | null
}>()
const emit = defineEmits<{ close: []; created: []; saved: [ContractDTO] }>()

const mode = computed<'new' | 'edit' | 'renew'>(() =>
  props.renewFrom ? 'renew' : props.initial ? 'edit' : 'new')

// 下拉候选(ds/Select):值一律字符串,数字字段进出各转一道
const STATUS_OPTS = [
  { value: 'draft', label: 'draft · 草稿' },
  { value: 'active', label: 'active · 执行中' },
  { value: 'terminated', label: 'terminated · 已终止' },
]
const POWER_TYPE_OPTS = [
  { value: '', label: '待录' },
  { value: 'industrial', label: '大工业' },
  { value: 'commercial', label: '商业(办公室类)' },
  { value: 'resident', label: '居民(宿舍类)' },
]
const TERM_TYPE_OPTS = [
  { value: '', label: '—' },
  { value: 'explicit', label: 'explicit · 明确起止' },
  { value: 'multiple', label: 'multiple · 多段' },
  { value: 'relative', label: 'relative · 相对表述' },
  { value: 'none', label: 'none · 无' },
]

const tenants = ref<TenantDTO[]>([])
// FPTenantPicker 候选(spec §T5):id/name=companyName/期区/关联主租户名
const tenantOptions = computed(() =>
  tenants.value.map(t => ({ id: t.id, name: t.companyName, phase: t.phase, parentName: t.parentName })))
const buildings = ref<BuildingDTO[]>([])
const buildingOpts = computed(() => buildings.value.map(b => ({ value: String(b.id), label: b.name })))

const contractNo = ref('')
const tenantId = ref<number | null>(null)
const buildingId = ref<number | null>(null)
// 单元多选(S15 §2 FPUnitPicker):有序数组,首个=主单元(提交 unitId),其余=extraUnitIds;跨栋可选
const unitSel = ref<number[]>([])
const unitOptions = ref<FPUnitOption[]>([])
const unitsLoading = ref(false)
const buildingArea = ref<number | null>(null)   // 建筑面积㎡(可清空:留空保存=租赁面积×0.8 后端重算,裁定①)
const rentArea = ref<number | null>(null)        // 续签态可改;新增/编辑为计费行汇总只读
const monthlyRent = ref<number | null>(null)     // 续签态可改;新增/编辑由计费行汇总,提交时算出
const deposit = ref<number | null>(null)
// 电费签约要素(裁定④;合同级,非计费行):KVA 仅大工业可填(其余置灰,后端同校验)
const powerType = ref<string>('')                // ''=待录
const kva = ref<number | null>(null)
// 用电分类不锁配电容量(用户拍板 2026-07-27):非大工业也有报装 kVA,切分类不清容量
function onPowerTypeChange() { err.value = '' }
// 免租期行编辑(F2):note 恒为 string 便于 v-model,提交时空 note 不写入
const rentFreeRows = ref<{ start: string; end: string; note: string }[]>([])
const startDate = ref('')
const endDate = ref('')
const signDate = ref('')
// 期限原文三件套(CONTRACT-CARD-V2-SPEC §6):原文留档为参考,不参与计费(§1)。
// 三件套恒为 string 便于 v-model,提交时空串转 null。
const termText = ref('')
const termType = ref('')          // ''|explicit|multiple|relative|none
const tierPriceNote = ref('')
const status = ref('active')
const remark = ref('')

const err = ref('')
const submitting = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
// 计费明细是否到位。编辑提交是「整组落库最终态」:detail 请求挂了 → segments/otherItems 空着,
// 界面与「这份合同本来就没录计费行」长得一模一样,用户改个备注保存就把全部计费行删光、月租金归零、
// 单元解绑,无二次确认无撤销。故必须把「没取到」和「本来就没有」分成两态。新增/续签无详情可取,天然到位。
const detailLoaded = ref(props.initial == null)
const DETAIL_FAIL = '计费明细加载失败,请关闭重开——此时保存会清空该合同的计费行'
// 遮罩误点会丢整份录入(标的段/费用行/免租期);dirty 由弹窗内任一输入/勾选冒上来置位,不做深比较
const dirty = ref(false)

// ─── 标的段(CONTRACT-CARD-SPEC §1/§6.2):段=物业类型+位置;段内费用行由类型钉死组决定 ──────
type SegRow = { id: number | null; feeKey: FeeKey; area: number | null; areaShared: number | null; unitPrice: number | null; coeff: number | null; roomCount: number | null; amountOverride: number | null; autoArea?: boolean }
// unitIds=该段租金面积落到哪几个单元(billing_term_unit)。段级而非行级:两个消费方(BuildingService
// 单元派生面积 / AllocService 按层取面积)都只读**建筑类租金行**的绑定,给每行各配一个选择器纯属噪声。
type Segment = { propertyType: PropertyType; location: string; rows: SegRow[]; unitIds: number[] }
const segments = ref<Segment[]>([])
const showTypeMenu = ref(false)
// 「添加标的段」菜单的点外关闭(UI-OVERLAY-SPEC)。手写而非换 ds/Popover.vue 包一层:Popover 的面板样式
// 固定(240px 宽/8px 内边距/top calc(100%+8px)/zIndex 60)与 .ct-seg-menu 不同,换过去会改外观与定位。
// 触发器与菜单同在 .ct-seg-add 内,故 contains 判定挂这一个根节点即可(菜单未 teleport)。
const segAddRef = ref<HTMLElement | null>(null)
function onTypeMenuDoc(e: MouseEvent) {
  if (segAddRef.value && !segAddRef.value.contains(e.target as Node)) showTypeMenu.value = false
}
// Esc 只关菜单:不阻断传播会被本弹窗的 window keydown(见下方 onKey)接走,整份合同录入一起关掉
function onTypeMenuKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); showTypeMenu.value = false }
}
// capture=true 不能省:宿主 .ct-dlg 带 @mousedown.stop(同 FPDrawer.vue:33 的 .fp-dwr),
// 冒泡阶段的 document 监听在弹窗内永远收不到事件,点外关闭会整体失效;capture 先于 .stop 派发。
watch(showTypeMenu, (v) => {
  if (v) {
    document.addEventListener('mousedown', onTypeMenuDoc, true)
    document.addEventListener('keydown', onTypeMenuKey, true)
  } else {
    document.removeEventListener('mousedown', onTypeMenuDoc, true)
    document.removeEventListener('keydown', onTypeMenuKey, true)
  }
})

function newRow(feeKey: FeeKey): SegRow {
  return { id: null, feeKey, area: null, areaShared: null, unitPrice: pinnedDefaultUnitPrice(feeKey), coeff: null, roomCount: null, amountOverride: null }
}
function buildSegment(pt: PropertyType): Segment {
  return { propertyType: pt, location: '', rows: PINNED_FEES[pt].map(newRow), unitIds: [] }
}
function addSegment(pt: PropertyType) { segments.value.push(buildSegment(pt)); showTypeMenu.value = false; err.value = ''; applyUnitAreaPrefill() }
function removeSegment(i: number) { segments.value.splice(i, 1) }

// 其他费用独立标的(2026-08-07 旭化成裁定):单行一笔杂费,location=收费项目名,金额直填;
// 与物业段平级,不带段类型;非金额字段原样透传保证存量往返无损
type OtherItem = SegRow & { location: string; billMode: string | null }
const otherItems = ref<OtherItem[]>([])
function addOtherItem() {
  otherItems.value.push({ ...newRow('other'), location: '', billMode: 'per_month' })
  showTypeMenu.value = false; err.value = ''
}
function removeOtherItem(i: number) { otherItems.value.splice(i, 1) }

// 钉死行(按 PINNED 序渲染;编辑态遗留合同若缺行,groupLines 已补齐)
function pinnedRows(seg: Segment): SegRow[] {
  return PINNED_FEES[seg.propertyType]
    .map(k => seg.rows.find(r => r.feeKey === k))
    .filter((r): r is SegRow => !!r)
}
function hasFee(seg: Segment, key: FeeKey): boolean { return seg.rows.some(r => r.feeKey === key) }
// 只在 hasFee 为真时渲染 → find 必命中;fallback 仅为满足类型(不会被 v-model 用到)
function condRow(seg: Segment, key: FeeKey): SegRow { return seg.rows.find(r => r.feeKey === key) ?? newRow(key) }
function toggleFee(seg: Segment, key: FeeKey, on: boolean) {
  err.value = ''
  if (on) {
    if (!hasFee(seg, key)) {
      const row = newRow(key)
      // per_sqm 条件项(infra):面积预填=该段租金行面积,可改
      if (isSqm(key)) row.area = seg.rows.find(r => isRentKey(r.feeKey))?.area ?? null
      seg.rows.push(row)
    }
  } else seg.rows = seg.rows.filter(r => r.feeKey !== key)
}
// 遗留费项(既非钉死亦非条件/可选):保留可见+可删,防编辑保存时静默丢失
function extraRows(seg: Segment): SegRow[] {
  const known = new Set<FeeKey>([...PINNED_FEES[seg.propertyType], ...COND_FEES[seg.propertyType], ...OPTIONAL_FEES])
  return seg.rows.filter(r => !known.has(r.feeKey))
}
function removeRow(seg: Segment, row: SegRow) { seg.rows = seg.rows.filter(r => r !== row) }

const isSqm = (k: FeeKey) => defaultBillMode(k) === 'per_sqm_month'
const isRoom = (k: FeeKey) => { const m = defaultBillMode(k); return m === 'per_room_year' || m === 'per_room_month' }
function rowMonthly(row: SegRow): string {
  const m = lineMonthly({ feeKey: row.feeKey, billMode: defaultBillMode(row.feeKey), area: row.area, unitPrice: row.unitPrice, coeff: row.coeff, roomCount: row.roomCount, amountOverride: row.amountOverride }, kva.value)
  if (m != null) return m.toLocaleString('en-US')
  // 存坏救济:per_sqm 行月额曾被存进 override(计费忽略致0)→ 回显原值标「待定」,补面积×单价后自动替换
  if (isSqm(row.feeKey) && isNum(row.amountOverride)) return row.amountOverride.toLocaleString('en-US') + ' 待定'
  return '待录'
}

onMounted(async () => {
  inputRef.value?.focus()
  if (props.renewFrom) {
    // 续签:租户/楼栋/单元锁定;合同号/日期留空,租金/押金/面积预填可改;计费行由后端继承原合同。
    rentArea.value = props.renewFrom.rentArea
    monthlyRent.value = props.renewFrom.monthlyRent
    deposit.value = props.renewFrom.deposit
    status.value = 'active'
    return
  }
  // 这一路挂了会让下面整段回填不执行,弹窗变成一片空白。detailLoaded 保持 false 已经挡住了删数据,
  // 但用户看不出为什么空——补一条提示,别让人对着空表单猜。
  try {
    ;[tenants.value, buildings.value] = await Promise.all([tenantApi.list(), buildingApi.list()])
  } catch {
    err.value = '租户/楼栋清单加载失败,请关闭重开' + (props.initial ? '——此时保存会清空该合同的计费行' : '')
    return
  }
  loadAllUnits()   // 不阻塞:chips 在候选到位后自动解析,缺档期间以「未知单元」可见
  const c = props.initial
  if (c) {
    contractNo.value = c.contractNo
    tenantId.value = c.tenantId
    buildingId.value = c.buildingId
    buildingArea.value = c.buildingArea ?? null
    rentArea.value = c.rentArea
    deposit.value = c.deposit
    powerType.value = c.powerType ?? ''
    kva.value = c.kva ?? null
    rentFreeRows.value = (c.rentFree ?? []).map(p => ({ start: p.start, end: p.end, note: p.note ?? '' }))
    startDate.value = c.startDate ?? ''
    endDate.value = c.endDate ?? ''
    signDate.value = c.signDate ?? ''
    termText.value = c.termText ?? ''
    termType.value = c.termType ?? ''
    tierPriceNote.value = c.tierPriceNote ?? ''
    status.value = c.status === 'expiring' || c.status === 'expired' ? 'active' : c.status   // 派生桶回收纳为存储态
    remark.value = c.remark ?? ''
    // 计费行:详情端点带出(按 propertyType,location,seq 排序),分组进可编辑标的段
    try {
      const d = await contractApi.detail(c.id)
      // 其他费用独立标的:propertyType 空的 other 行不入段;段内 other(存量导入)照旧走遗留行
      const isIndepOther = (l: BillingLineDTO) => l.feeKey === 'other' && l.propertyType == null
      otherItems.value = d.billingLines.filter(isIndepOther).map(l => ({
        id: l.id, feeKey: 'other' as FeeKey, location: l.location, billMode: l.billMode ?? 'per_month',
        area: l.area ?? null, areaShared: l.areaShared ?? null, unitPrice: l.unitPrice ?? null,
        coeff: l.coeff ?? null, roomCount: l.roomCount ?? null, amountOverride: l.amountOverride ?? null,
      }))
      segments.value = groupLines(d.billingLines.filter(l => !isIndepOther(l)))
      // 主单元居首,附加单元按回带序;主可为空(遗留数据)时首个附加即为主展示——保存前用户可见
      const extra = (d.extraUnitIds ?? []).filter(id => id !== c.unitId)
      unitSel.value = c.unitId != null ? [c.unitId, ...extra] : [...extra]
      detailLoaded.value = true   // 只有整段赋值走完才算到位,中途抛错一律留 false
    } catch {
      err.value = DETAIL_FAIL   // 提交闸门 + 保存按钮置灰都盯这一态
    }
  } else if (props.presetBuildingId != null) {
    buildingId.value = props.presetBuildingId
  }
})

// 全楼栋单元候选(跨栋可选;后端无全量单元端点,并发逐栋 detail——S15 后端零改约束)
async function loadAllUnits() {
  unitsLoading.value = true
  try {
    const ds = await Promise.all(buildings.value.map(b => buildingApi.detail(b.id)))
    unitOptions.value = ds.flatMap((d, i) => d.units.map(u => ({
      id: u.id, buildingId: buildings.value[i].id, buildingName: buildings.value[i].name,
      floor: u.floor, unitNo: u.unitNo, area: u.area, status: u.status, phase: buildings.value[i].phase,
    })))
  } catch { /* 失败不拦:已选 id 仍以「未知单元」chips 可见,提交不受影响 */ }
  finally { unitsLoading.value = false }
}

// 详情计费行 → 标的段(按 propertyType+location 分组;遗留 propertyType 空按租金行反推;钉死行缺失补齐)
function groupLines(lines: BillingLineDTO[]): Segment[] {
  const segs: Segment[] = []
  for (const l of lines) {
    const pt = (l.propertyType ?? inferPropertyType(l.feeKey)) as PropertyType
    let g = segs.find(s => s.propertyType === pt && s.location === l.location)
    if (!g) { g = { propertyType: pt, location: l.location, rows: [], unitIds: [] }; segs.push(g) }
    g.rows.push({ id: l.id, feeKey: l.feeKey, area: l.area ?? null, areaShared: l.areaShared ?? null, unitPrice: l.unitPrice ?? null, coeff: l.coeff ?? null, roomCount: l.roomCount ?? null, amountOverride: l.amountOverride ?? null })
    // 段绑定=段内建筑类租金行绑定的并集(那是唯一被读的一档;其余行的绑定原样透传,提交时不动)
    if (BUILDING_RENT_KEYS.includes(l.feeKey))
      for (const uid of l.unitIds ?? []) if (!g.unitIds.includes(uid)) g.unitIds.push(uid)
  }
  for (const s of segs)
    for (const k of PINNED_FEES[s.propertyType])
      if (!s.rows.some(r => r.feeKey === k)) s.rows.push(newRow(k))
  return segs
}

// 单元候选已是全楼栋(跨栋可选):切换楼栋不再清已选单元——chips 带栋名可见,不会隐形残留
function onBuildingChange() { err.value = '' }

// 标的面积预填(a方案联动半):选单元变化/新增段时,每段首条租金行面积格空或0 → 自动填Σ同类型
// 选中单元面积(宿舍段=phase4栋Σ,其余=非宿舍Σ);用户已填的值绝不覆盖;autoArea 标记出
// 「来自单元档案,可改」提示+短暂高亮,用户改动该格即清
function applyUnitAreaPrefill() {
  const sums = selectedAreaSums(unitSel.value, unitOptions.value)
  for (const seg of segments.value) {
    const row = seg.rows.find(r => BUILDING_RENT_KEYS.includes(r.feeKey))
    if (!row) continue
    const v = prefillRentArea(row.feeKey, row.area, sums)
    if (v != null) { row.area = v; row.autoArea = true }
  }
}
function onUnitSelChange() {
  err.value = ''
  applyUnitAreaPrefill()
  // 合同层面取消的单元不能继续留在段绑定里(会绑到一个本合同已经不占的单元上)
  for (const s of segments.value) s.unitIds = s.unitIds.filter(u => unitSel.value.includes(u))
}

// ── 段↔单元绑定(billing_term_unit)──
const unitLabel = (id: number) => {
  const u = unitOptions.value.find(o => o.id === id)
  return u ? `${u.floor}F-${u.unitNo}` : `#${id}`
}
function toggleSegUnit(seg: Segment, unitId: number) {
  const i = seg.unitIds.indexOf(unitId)
  if (i >= 0) seg.unitIds.splice(i, 1); else seg.unitIds.push(unitId)
  dirty.value = true
  err.value = ''
}

const round2 = (n: number) => Math.round(n * 100) / 100
const isNum = (v: number | null): v is number => typeof v === 'number' && !Number.isNaN(v)

// 面积分类汇总(S15 §3):建筑类租金行拆非宿舍/宿舍两桶(空地租金单列不计);无该类行=null
function areaSum(pred: (k: FeeKey) => boolean): number | null {
  let sum = 0, has = false
  for (const seg of segments.value)
    for (const r of seg.rows)
      if (pred(r.feeKey) && isNum(r.area)) { sum += r.area; has = true }
  return has ? round2(sum) : null
}
// 租赁面积(非宿舍)=Σ非 rent_dorm 建筑类租金行;提交 rentArea 用此口径(与后端新口径一致)
const nonDormAreaSum = computed<number | null>(() => areaSum(k => BUILDING_RENT_KEYS.includes(k) && k !== 'rent_dorm'))
// 宿舍面积=Σ rent_dorm 行;仅有宿舍行时显示
const dormAreaSum = computed<number | null>(() => areaSum(k => k === 'rent_dorm'))
const rentAreaShow = computed<number | null>(() => nonDormAreaSum.value ?? rentArea.value)
// 建筑面积提示=非宿舍Σ×0.8(留空保存由后端同口径重算)
const bldAreaHint = computed<number | null>(() => rentAreaShow.value != null ? round2(rentAreaShow.value * 0.8) : null)
// 段面积(段内建筑类租金行面积之和,供段头只读展示;空地段无此显示)
function segArea(seg: Segment): number | null {
  let sum = 0, has = false
  for (const r of seg.rows) if (BUILDING_RENT_KEYS.includes(r.feeKey) && isNum(r.area)) { sum += r.area; has = true }
  return has ? round2(sum) : null
}
// 月租金 = 各计费行月额之和(§3.2 缓存口径;提交时算出,不双录入)
function monthlyTotal(): number {
  let s = 0
  for (const seg of segments.value)
    for (const r of seg.rows) {
      const m = lineMonthly({ feeKey: r.feeKey, billMode: defaultBillMode(r.feeKey), area: r.area, unitPrice: r.unitPrice, coeff: r.coeff, roomCount: r.roomCount, amountOverride: r.amountOverride }, kva.value)
      if (m != null) s += m
    }
  // 其他费用独立标的同计入(镜像抽屉合计口径)
  for (const o of otherItems.value) {
    const m = lineMonthly({ feeKey: 'other', billMode: o.billMode ?? 'per_month', area: o.area, unitPrice: o.unitPrice, coeff: o.coeff, roomCount: o.roomCount, amountOverride: o.amountOverride }, kva.value)
    if (m != null) s += m
  }
  return round2(s)
}

// ─── F2 免租期行编辑 ──────────────────────────────────────
function addRentFreeRow() { rentFreeRows.value.push({ start: '', end: '', note: '' }) }
function removeRentFreeRow(i: number) { rentFreeRows.value.splice(i, 1) }
function rowWarn(r: { start: string; end: string }): string {
  if (!r.start || !r.end) return ''
  if (r.start > r.end) return '开始日期晚于结束日期'
  if (startDate.value && r.start < startDate.value) return '早于合同开始日期'
  if (endDate.value && r.end > endDate.value) return '晚于合同结束日期'
  return ''
}

const num = (v: number | null) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0)
const numOrNull = (v: number | null) => (isNum(v) ? v : null)

// Esc 关闭:与 TenantNewDialog 同一套(window keydown;picker 浮层的 Esc 已在组件内 stopPropagation)
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  // 菜单开着时卸载:capture 标志必须与注册时一致,否则移不掉(UI-OVERLAY-SPEC §3)
  document.removeEventListener('mousedown', onTypeMenuDoc, true)
  document.removeEventListener('keydown', onTypeMenuKey, true)
})
// 遮罩误点:本弹窗表单体量大(标的段/费用行/免租期),已有录入时先确认再丢
function onMaskDown() {
  if (dirty.value && !confirm('弹窗内已有未保存的录入,关闭将全部丢失。确认关闭?')) return
  emit('close')
}

async function submit() {
  if (submitting.value) return
  // 详情未到位就走编辑提交 = 拿空计费行做整组替换,等于删光该合同的计费行
  if (mode.value === 'edit' && !detailLoaded.value) { err.value = DETAIL_FAIL; return }
  if (!contractNo.value.trim()) { err.value = '请输入合同号'; return }
  if (mode.value !== 'renew') {
    if (tenantId.value == null) { err.value = '请选择租户'; return }
    if (buildingId.value == null) { err.value = '请选择楼栋'; return }
  }
  const rfRows = rentFreeRows.value.filter(r => r.start || r.end || r.note.trim())
  for (const r of rfRows) {
    if (!r.start || !r.end) { err.value = '免租期起止日期需填写完整'; return }
    if (r.start > r.end) { err.value = '免租期开始日期不能晚于结束日期'; return }
  }
  // 其他费用独立标的:收费项目名即 location,空名无法分组/回读
  for (const o of otherItems.value)
    if (!o.location.trim()) { err.value = '其他费用需填写收费项目名'; return }
  submitting.value = true
  try {
    if (mode.value === 'renew') {
      const dto = await contractApi.renew(props.renewFrom!.id, {
        contractNo: contractNo.value.trim(),
        startDate: startDate.value || null,
        endDate: endDate.value || null,
        signDate: signDate.value || null,
        monthlyRent: num(monthlyRent.value),
        deposit: num(deposit.value),
        rentArea: num(rentArea.value),
      })
      emit('saved', dto)
      return
    }
    // 计费行整组落库(单一编辑最终态):每行带 propertyType 供后端钉死白名单校验;seq=段内行序
    const lines: BillingLineReq[] = []
    for (const seg of segments.value) {
      const loc = seg.location.trim() || '主'
      seg.rows.forEach((r, i) => lines.push({
        id: r.id, propertyType: seg.propertyType, location: loc, feeKey: r.feeKey, billMode: defaultBillMode(r.feeKey),
        area: numOrNull(r.area), areaShared: numOrNull(r.areaShared), unitPrice: numOrNull(r.unitPrice), coeff: numOrNull(r.coeff),
        roomCount: numOrNull(r.roomCount),
        // per_sqm 行 override 无效(仅 per_month 生效):面积×单价齐了即清,救回存坏的 infra 条件行
        amountOverride: isSqm(r.feeKey) && isNum(r.area) && isNum(r.unitPrice) ? null : numOrNull(r.amountOverride),
        seq: i,
        // 只有建筑类租金行显式送绑定(唯一被读的一档);其余行送 null=后端沿用旧绑定快照,不误清
        unitIds: BUILDING_RENT_KEYS.includes(r.feeKey) ? seg.unitIds : null,
      }))
    }
    // 其他费用独立标的:不带段类型(后端跳过钉死校验),位置=收费项目名;非金额字段透传保存量往返无损
    otherItems.value.forEach((o, i) => lines.push({
      id: o.id, propertyType: null, location: o.location.trim(), feeKey: 'other', billMode: o.billMode ?? 'per_month',
      area: numOrNull(o.area), areaShared: numOrNull(o.areaShared), unitPrice: numOrNull(o.unitPrice), coeff: numOrNull(o.coeff),
      roomCount: numOrNull(o.roomCount), amountOverride: numOrNull(o.amountOverride), seq: i,
    }))
    // 反推五标量供 fee_src 覆盖律(镜像后端 syncScalarCache:无该类行则保留原缓存)
    const find = (p: (l: BillingLineReq) => boolean) => lines.find(p)
    const rentL = find(l => isRentKey(l.feeKey))
    const mgmtL = find(l => l.feeKey === 'mgmt')
    const infraL = find(l => l.feeKey === 'infra')
    const elevL = find(l => l.feeKey === 'elevator')
    const transL = find(l => l.feeKey === 'transformer')
    const init = props.initial
    const req = {
      contractNo: contractNo.value.trim(),
      tenantId: tenantId.value!,
      buildingId: buildingId.value!,
      unitId: unitSel.value[0] ?? null,          // 首个=主单元
      extraUnitIds: unitSel.value.slice(1),      // 其余=附加单元(含跨栋)
      buildingArea: numOrNull(buildingArea.value),
      rentArea: nonDormAreaSum.value ?? num(rentArea.value),   // S15 §3:宿舍面积不计入
      unitPrice: rentL ? (rentL.unitPrice ?? null) : (init?.unitPrice ?? null),
      monthlyRent: monthlyTotal(),                 // §3.2:计费行月额之和,不双录入
      deposit: num(deposit.value),
      mgmtFeePrice: mgmtL ? (mgmtL.unitPrice ?? null) : (init?.mgmtFeePrice ?? null),
      infraFeePrice: infraL ? (infraL.unitPrice ?? null) : (init?.infraFeePrice ?? null),
      // 电梯规则参数 N/L 退役为缓存(§3.3):UI 不再录入,编辑态原样透传保留,新增为 null
      elevatorCount: init?.elevatorCount ?? null,
      elevatorFloors: init?.elevatorFloors ?? null,
      elevatorFee: elevL ? (elevL.amountOverride ?? null) : (init?.elevatorFee ?? null),
      transformerFee: transL ? (transL.amountOverride ?? null) : (init?.transformerFee ?? null),
      powerType: powerType.value || null,
      kva: numOrNull(kva.value),
      rentFree: rfRows.length
        ? rfRows.map<RentFreePeriod>(r =>
            r.note.trim() ? { start: r.start, end: r.end, note: r.note.trim() } : { start: r.start, end: r.end })
        : null,
      startDate: startDate.value || null,
      endDate: endDate.value || null,
      signDate: signDate.value || null,
      termText: termText.value.trim() || null,
      termType: termType.value || null,
      tierPriceNote: tierPriceNote.value.trim() || null,
      status: status.value,
      remark: remark.value.trim() || null,
      billingLines: lines,
    }
    if (mode.value === 'edit') {
      emit('saved', await contractApi.update(props.initial!.id, req))
    } else {
      await contractApi.create(req)
      emit('created')
    }
  } catch (e) {
    err.value = (e as { message?: string })?.message ?? '操作失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="ct-mask" @mousedown="onMaskDown">
      <!-- dirty 靠 capture 阶段收弹窗内所有原生输入/勾选(含 picker 内部),不逐字段挂标记 -->
      <div class="ct-dlg" role="dialog" aria-modal="true" @mousedown.stop
           @input.capture="dirty = true" @change.capture="dirty = true">
        <div class="ct-dlg-h">
          <h3>{{ mode === 'edit' ? '编辑合同' : mode === 'renew' ? '续签合同' : '新增合同' }}</h3>
          <p v-if="mode === 'renew'">为「{{ renewFrom?.contractNo }}」创建续签新约,租户/楼栋/单元沿用原合同。提交后原合同将标记为已续签。</p>
          <p v-else-if="mode === 'edit'">修改该合同的字段并保存(全量提交)。</p>
          <p v-else>录入一份租赁合同。执行中/即将到期的合同将计入月租金、占用所选单元并派生楼栋出租率。</p>
        </div>
        <div class="ct-dlg-b">
          <div class="ct-grid">
            <div class="ct-field">
              <div class="lab">合同号 <i>*</i></div>
              <input ref="inputRef" class="ct-in" :class="{ err: err === '请输入合同号' }" v-model="contractNo"
                     maxlength="32" placeholder="如:HT-2026-001" @input="err = ''" @keydown.enter="submit" />
            </div>
            <div class="ct-field">
              <div class="lab">状态 <i>*</i></div>
              <!-- ds/Select 的选项是 button,不派发原生 change,收不进上面的 @change.capture → dirty 手动置位 -->
              <Select :options="STATUS_OPTS" :model-value="status" :disabled="mode === 'renew'"
                      @update:model-value="status = $event; dirty = true" />
            </div>
            <div class="ct-field">
              <div class="lab">租户 <i>*</i></div>
              <input v-if="mode === 'renew'" class="ct-in" :value="renewFrom?.tenantName" disabled />
              <FPTenantPicker v-else v-model="tenantId" :tenants="tenantOptions"
                              :invalid="err === '请选择租户'" @update:model-value="err = ''" />
            </div>
            <div class="ct-field">
              <div class="lab">楼栋 <i>*</i></div>
              <input v-if="mode === 'renew'" class="ct-in" :value="renewFrom?.buildingName" disabled />
              <Select v-else :options="buildingOpts" placeholder="请选择楼栋"
                      :invalid="err === '请选择楼栋'"
                      :model-value="buildingId == null ? '' : String(buildingId)"
                      :disabled="mode === 'new' && presetBuildingId != null"
                      @update:model-value="buildingId = +$event; onBuildingChange(); dirty = true" />
            </div>
            <!-- 单元多选(S15 §2 FPUnitPicker):全楼栋分组候选,跨栋可选;首个=主单元(★可换主),其余=附加单元 -->
            <div class="ct-field ct-field-wide">
              <div class="lab">单元 · 可跨栋多选,首个为主单元(★可换主)</div>
              <input v-if="mode === 'renew'" class="ct-in" :value="renewFrom?.floorInfo || '未指定单元'" disabled />
              <FPUnitPicker v-else v-model="unitSel" :units="unitOptions" :loading="unitsLoading"
                            @update:model-value="onUnitSelChange()" />
            </div>
            <!-- 建筑面积 → 面积分类(计费行汇总只读,S15 §3);月租金/租金单价并入下方标的段,不双录入 -->
            <div class="ct-field">
              <div class="lab">建筑面积 ㎡</div>
              <input v-if="mode === 'renew'" class="ct-in" :value="renewFrom?.buildingArea ?? '—'" disabled title="续签继承原合同" />
              <input v-else class="ct-in" type="number" min="0" v-model.number="buildingArea"
                     :placeholder="bldAreaHint != null ? `留空=${bldAreaHint.toLocaleString('en-US')}(非宿舍×0.8)` : '留空=非宿舍租赁面积×0.8'"
                     title="可清空:留空保存后自动=租赁面积(非宿舍)×0.8 重算;显式填值则尊重填值"
                     @input="err = ''" @keydown.enter="submit" />
            </div>
            <div class="ct-field">
              <div class="lab">租赁面积(非宿舍) ㎡{{ mode === 'renew' ? '' : ' · 自动汇总' }}</div>
              <input v-if="mode === 'renew'" class="ct-in" type="number" min="0" v-model.number="rentArea" placeholder="0"
                     @input="err = ''" @keydown.enter="submit" />
              <input v-else class="ct-in" disabled placeholder="按非宿舍标的段租金面积汇总"
                     title="租赁面积(非宿舍)=各标的段建筑类租金面积之和(宿舍段除外),面积只在标的段内录入"
                     :value="rentAreaShow != null ? rentAreaShow.toLocaleString('en-US') : ''" />
            </div>
            <div v-if="mode !== 'renew' && dormAreaSum != null" class="ct-field">
              <div class="lab">宿舍面积 ㎡ · 自动汇总</div>
              <input class="ct-in" disabled
                     title="宿舍面积=各宿舍段租金行面积之和,不计入租赁面积(非宿舍)与建筑面积换算"
                     :value="dormAreaSum.toLocaleString('en-US')" />
            </div>
            <div v-if="mode === 'renew'" class="ct-field">
              <div class="lab">月租金 元</div>
              <input class="ct-in" type="number" min="0" v-model.number="monthlyRent" placeholder="0"
                     @input="err = ''" @keydown.enter="submit" />
            </div>
            <div class="ct-field">
              <div class="lab">押金 元</div>
              <input class="ct-in" type="number" min="0" v-model.number="deposit" placeholder="0"
                     @input="err = ''" @keydown.enter="submit" />
            </div>
            <!-- 电费签约要素(裁定④;合同级,非计费行;续签由后端继承,不展示) -->
            <template v-if="mode !== 'renew'">
              <div class="ct-field">
                <div class="lab">用电分类</div>
                <Select :options="POWER_TYPE_OPTS" :model-value="powerType"
                        @update:model-value="powerType = $event; onPowerTypeChange(); dirty = true" />
              </div>
              <div class="ct-field">
                <div class="lab">配电容量 KVA</div>
                <input class="ct-in" type="number" min="0" step="0.01" v-model.number="kva"
                       placeholder="签约时租户申报"
                       @input="err = ''" @keydown.enter="submit" />
              </div>
            </template>
            <!-- 标的段(§6.2):选物业类型 → 钉死费用组;条件项 checkbox;宿舍按间;空地附加段;月单价只读派生,无合计 -->
            <div v-if="mode !== 'renew'" class="ct-field ct-span2">
              <div class="lab">标的段 · 选类型钉死费用组(费用名固定不可增删;条件项勾选落行:电梯/变压器填月额,基础维护填面积×单价;月单价只读派生,合计属账单管理)</div>
              <div class="ct-bl">
                <div v-for="(seg, si) in segments" :key="si" class="ct-bl-seg">
                  <div class="ct-bl-seghd">
                    <span class="ct-seg-badge">{{ PROPERTY_TYPE_LABEL[seg.propertyType] }}</span>
                    <input class="ct-in ct-bl-loc" v-model="seg.location" maxlength="255"
                           placeholder="位置(如:E座3-4层 / 宿舍楼 / 空地一 / 主)" @input="err = ''" />
                    <span v-if="segArea(seg) != null" class="ct-seg-area">{{ segArea(seg)!.toLocaleString('en-US') }} ㎡</span>
                    <button type="button" class="ct-rf-del" title="删除标的段" @click="removeSegment(si)">
                      <component :is="iconFor('trash-2')" :size="14" />
                    </button>
                  </div>
                  <!-- 段↔单元绑定(2026-08-14):公共电核算「按层取面积」靠它把该段租金面积落到楼层。
                       不绑=回退整栋面积口径,同栋跨层户会被多收 —— 过去这个绑定只有迁移脚本写得进去。
                       候选只列本合同已选的单元:段是合同的一部分,绑到合同外的单元没有意义。 -->
                  <div v-if="unitSel.length" class="ct-bl-bind">
                    <span class="ct-bl-bindlab"
                          title="该段的租金面积算在哪几个单元上;不选=按整栋面积口径参与公摊分摊">面积落在</span>
                    <button v-for="u in unitSel" :key="u" type="button" class="ct-bl-uchip"
                            :class="{ on: seg.unitIds.includes(u) }" @click="toggleSegUnit(seg, u)">
                      {{ unitLabel(u) }}
                    </button>
                    <span v-if="!seg.unitIds.length" class="ct-bl-bindhint">未绑 · 按整栋面积摊</span>
                  </div>
                  <!-- 钉死行:费用名固定,只填数值 -->
                  <div v-for="row in pinnedRows(seg)" :key="'p' + row.feeKey" class="ct-bl-row">
                    <span class="ct-bl-feename">{{ feeLabel(seg.propertyType, row.feeKey) }}</span>
                    <template v-if="isSqm(row.feeKey)">
                      <input class="ct-in ct-bl-n" :class="{ 'auto-area': row.autoArea }" type="number" min="0" step="0.01"
                             v-model.number="row.area" placeholder="面积"
                             :title="row.autoArea ? '来自单元档案,可改' : ''"
                             @input="err = ''; row.autoArea = false" />
                      <!-- 公摊面积(S5 §1/§4):仅租金行;填了=左侧面积为建筑面积,分摊按两者之和;留空=面积已含公摊 -->
                      <input v-if="isRentKey(row.feeKey)" class="ct-in ct-bl-n" type="number" min="0" step="0.01" v-model.number="row.areaShared"
                             placeholder="公摊(选填)" title="填了公摊 = 面积格为建筑面积,公摊分摊按 面积+公摊 之和;留空 = 面积已含公摊" @input="err = ''" />
                      <input class="ct-in ct-bl-n" type="number" min="0" step="0.0001" v-model.number="row.unitPrice" placeholder="单价" @input="err = ''" />
                      <input class="ct-in ct-bl-n" type="number" min="0" step="0.01" v-model.number="row.coeff" placeholder="系数1" @input="err = ''" />
                    </template>
                    <template v-else-if="isRoom(row.feeKey)">
                      <input class="ct-in ct-bl-n" type="number" min="0" step="0.01" v-model.number="row.unitPrice" placeholder="单价/间" @input="err = ''" />
                      <input class="ct-in ct-bl-n" type="number" min="0" step="1" v-model.number="row.roomCount" placeholder="间数" @input="err = ''" />
                    </template>
                    <span class="ct-bl-mo mono" :class="{ pending: rowMonthly(row).includes('待') }">{{ rowMonthly(row) }}</span>
                  </div>
                  <!-- 条件项:勾选才落行(首层无梯=不勾=不出现);电梯/变压器 per_month 填月额,infra per_sqm 填面积×单价 -->
                  <div v-for="k in COND_FEES[seg.propertyType]" :key="'c' + k" class="ct-bl-cond">
                    <label class="ct-chk">
                      <input type="checkbox" :checked="hasFee(seg, k)" @change="toggleFee(seg, k, ($event.target as HTMLInputElement).checked)" />
                      {{ feeLabel(seg.propertyType, k) }}
                    </label>
                    <template v-if="hasFee(seg, k)">
                      <template v-if="isSqm(k)">
                        <input class="ct-in ct-bl-n" type="number" min="0" step="0.01" v-model.number="condRow(seg, k).area" placeholder="面积" @input="err = ''" />
                        <input class="ct-in ct-bl-n" type="number" min="0" step="0.0001" v-model.number="condRow(seg, k).unitPrice" placeholder="单价" @input="err = ''" />
                      </template>
                      <input v-else class="ct-in ct-bl-n" type="number" min="0" step="0.01" v-model.number="condRow(seg, k).amountOverride" placeholder="月额" @input="err = ''" />
                      <span class="ct-bl-mo mono" :class="{ pending: rowMonthly(condRow(seg, k)).includes('待') }">{{ rowMonthly(condRow(seg, k)) }}</span>
                    </template>
                  </div>
                  <!-- 可选:土地使用税(全类型) -->
                  <div v-for="k in OPTIONAL_FEES" :key="'o' + k" class="ct-bl-cond">
                    <label class="ct-chk">
                      <input type="checkbox" :checked="hasFee(seg, k)" @change="toggleFee(seg, k, ($event.target as HTMLInputElement).checked)" />
                      {{ feeLabel(seg.propertyType, k) }}
                    </label>
                    <template v-if="hasFee(seg, k)">
                      <input class="ct-in ct-bl-n" type="number" min="0" step="0.01" v-model.number="condRow(seg, k).amountOverride" placeholder="月额" @input="err = ''" />
                      <span class="ct-bl-mo mono" :class="{ pending: rowMonthly(condRow(seg, k)).includes('待') }">{{ rowMonthly(condRow(seg, k)) }}</span>
                    </template>
                  </div>
                  <!-- 遗留费项(非该类型钉死/条件/可选;保留可见+可删,防静默丢失) -->
                  <div v-for="row in extraRows(seg)" :key="'x' + (row.id ?? row.feeKey)" class="ct-bl-row">
                    <span class="ct-bl-feename">{{ FEE_NAME[row.feeKey] }} <em>遗留</em></span>
                    <input class="ct-in ct-bl-n" type="number" min="0" step="0.01" v-model.number="row.amountOverride" placeholder="月额" @input="err = ''" />
                    <span class="ct-bl-mo mono" :class="{ pending: rowMonthly(row).includes('待') }">{{ rowMonthly(row) }}</span>
                    <button type="button" class="ct-rf-del" title="删除该遗留费项" @click="removeRow(seg, row)">
                      <component :is="iconFor('x')" :size="14" />
                    </button>
                  </div>
                </div>
                <!-- 其他费用独立标的(旭化成裁定):单行一笔,收费项目名+金额,可删可多条 -->
                <div v-for="(o, oi) in otherItems" :key="'ot' + oi" class="ct-bl-seg">
                  <div class="ct-bl-seghd">
                    <span class="ct-seg-badge">其他费用</span>
                    <input class="ct-in ct-bl-loc" v-model="o.location" maxlength="255"
                           placeholder="收费项目(如:车位变更手续费)" @input="err = ''" />
                    <input class="ct-in ct-other-amt" type="number" min="0" step="0.01" v-model.number="o.amountOverride"
                           placeholder="金额 元/月" @input="err = ''" />
                    <button type="button" class="ct-rf-del" title="删除该费用" @click="removeOtherItem(oi)">
                      <component :is="iconFor('trash-2')" :size="14" />
                    </button>
                  </div>
                </div>
                <!-- 添加标的段:选物业类型 → 钉死组自动出现;其他费用=独立单行标的 -->
                <div class="ct-seg-add" ref="segAddRef">
                  <Button variant="gray" size="sm" @click="showTypeMenu = !showTypeMenu">
                    <template #leading><component :is="iconFor('plus')" :size="14" /></template>
                    添加标的段
                  </Button>
                  <div v-if="showTypeMenu" class="ct-seg-menu">
                    <button v-for="pt in PROPERTY_TYPES" :key="pt" type="button" class="ct-seg-menu-item" @click="addSegment(pt)">
                      {{ PROPERTY_TYPE_LABEL[pt] }}
                    </button>
                    <button type="button" class="ct-seg-menu-item" @click="addOtherItem()">其他费用</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="ct-field">
              <div class="lab">开始日期</div>
              <input class="ct-in" type="date" v-model="startDate" @input="err = ''" @keydown.enter="submit" />
            </div>
            <div class="ct-field">
              <div class="lab">结束日期</div>
              <input class="ct-in" type="date" v-model="endDate" @input="err = ''" @keydown.enter="submit" />
            </div>
            <div class="ct-field">
              <div class="lab">签订日期</div>
              <input class="ct-in" type="date" v-model="signDate" @input="err = ''" @keydown.enter="submit" />
            </div>
            <!-- 期限原文三件套(V2-SPEC §6):白纸黑字留档,多段/相对表述的唯一事实源,不参与计费 -->
            <template v-if="mode !== 'renew'">
              <div class="ct-field ct-span2">
                <div class="lab">期限原文</div>
                <textarea class="ct-in ct-ta" rows="2" v-model="termText" maxlength="255"
                          placeholder="如:2023年7月14日起至2026年7月13日 / 竣工验收次日起计九年" @input="err = ''"></textarea>
              </div>
              <div class="ct-field">
                <div class="lab">期限类型</div>
                <Select :options="TERM_TYPE_OPTS" :model-value="termType"
                        @update:model-value="termType = $event; err = ''; dirty = true" />
              </div>
              <div class="ct-field">
                <div class="lab">分年阶梯价(原文留档)</div>
                <textarea class="ct-in ct-ta" rows="2" v-model="tierPriceNote" maxlength="500"
                          placeholder="合同原文照抄" @input="err = ''"></textarea>
              </div>
            </template>
            <!-- F2 免租期行式编辑(续签不继承旧租期条款,不展示) -->
            <div v-if="mode !== 'renew'" class="ct-field ct-span2">
              <div class="lab">免租期(装修期等,仅展示不参与应收)</div>
              <div class="ct-rf">
                <div v-for="(r, i) in rentFreeRows" :key="i" class="ct-rf-item">
                  <div class="ct-rf-row">
                    <input class="ct-in" type="date" v-model="r.start" @input="err = ''" />
                    <span class="ct-rf-arrow">→</span>
                    <input class="ct-in" type="date" v-model="r.end" @input="err = ''" />
                    <input class="ct-in ct-rf-note" v-model="r.note" maxlength="50" placeholder="备注,如:装修期" @input="err = ''" />
                    <button type="button" class="ct-rf-del" title="删除该段" @click="removeRentFreeRow(i)">
                      <component :is="iconFor('x')" :size="14" />
                    </button>
                  </div>
                  <!-- 提示位常驻(LAYOUT-STABILITY §4.2):改日期时红字不得把「添加免租期」按钮顶走 -->
                  <div class="ct-rf-warn"><template v-if="rowWarn(r)">⚠ {{ rowWarn(r) }}</template></div>
                </div>
                <div>
                  <Button variant="gray" size="sm" :disabled="rentFreeRows.length >= 24" @click="addRentFreeRow">
                    <template #leading><component :is="iconFor('plus')" :size="14" /></template>
                    添加免租期
                  </Button>
                </div>
              </div>
            </div>
            <div class="ct-field ct-span2">
              <div class="lab">备注</div>
              <input class="ct-in" v-model="remark" maxlength="255" placeholder="选填"
                     @input="err = ''" @keydown.enter="submit" />
            </div>
          </div>
          <div class="ct-erm">{{ err }}</div>
        </div>
        <div class="ct-dlg-f">
          <Button variant="gray" size="sm" @click="emit('close')">取消</Button>
          <!-- 计费明细没到位时保存=清空计费行,按钮直接点不动(不只靠 submit 里 return) -->
          <Button variant="filled" size="sm" :disabled="submitting || (mode === 'edit' && !detailLoaded)" @click="submit">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            {{ mode === 'edit' ? '保存' : mode === 'renew' ? '续签' : '创建' }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 1:1 FinDialogs .fin-mask/.fin-dlg(居中弹窗,遵 DESIGN-FIDELITY §7);两列表单为本弹窗新增 */
/* z-index 320:高于 FPDrawer(300/301),编辑/续签态从抽屉打开时弹窗须压在抽屉之上 */
.ct-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:320; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:fp-fade-in .16s forwards; }
.ct-dlg { width:min(640px,92vw); max-height:88vh; overflow-y:auto; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); animation:fp-rise-in .2s var(--ease-standard) both; }
.ct-dlg-h { padding:20px 22px 0; }
.ct-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.ct-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.ct-dlg-b { padding:18px 22px 4px; }
.ct-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px 14px; }
.ct-span2 { grid-column:span 2; }
.ct-field .lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
.ct-field .lab i { color:var(--hue-red); font-style:normal; }
.ct-field-wide { grid-column:1 / -1; }
/* 高度对齐设计系统 md=36(ds/Input 与 ds/Select 同档):此前 38/40px,而同一表单网格里的
   下拉已是 ds/Select 的 36px,并排就差 2~4px。改这里而不是改 Select —— 36 是三个 ds 控件
   (Button/Input/Select)共同的 md 档,38/40 才是各表单自己发明的。 */
.ct-in { width:100%; box-sizing:border-box; height:36px; padding:0 12px; font-size:var(--fs-body); color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.ct-in:focus { border-color:var(--hue-blue); }
.ct-in.err { border-color:var(--hue-red); }
.ct-in:disabled { background:var(--bg-sunken); color:var(--text-disabled); cursor:not-allowed; }
/* 期限原文/阶梯价留档:多行输入,.ct-in 的固定行高在此放开 */
.ct-ta { height:auto; padding:8px 12px; line-height:1.5; resize:vertical; }
/* 标的段编辑(§6.2):段头=类型徽标+位置+段面积;钉死行=费用名(固定)+数值+月单价;条件/可选=checkbox+月额 */
.ct-bl { display:flex; flex-direction:column; gap:12px; }
.ct-bl-seg { border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:10px; display:flex; flex-direction:column; gap:8px; background:var(--surface-card); }
.ct-bl-seghd { display:flex; align-items:center; gap:8px; }
.ct-seg-badge { flex:0 0 auto; padding:3px 10px; border-radius:999px; background:var(--hue-blue); color:#fff; font-size:12px; font-weight:var(--fw-semibold); }
.ct-bl-loc { flex:1 1 auto; height:34px; font-size:12.5px; font-weight:var(--fw-medium); }
.ct-seg-area { flex:0 0 auto; font-size:12px; font-family:var(--font-mono); color:var(--text-muted); }
/* 段↔单元绑定 chips:未绑给橙提示(公摊会回退整栋口径),绑了就是普通选中态 */
.ct-bl-bind { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.ct-bl-bindlab { font-size:11.5px; color:var(--text-muted); cursor:help; }
.ct-bl-uchip { height:24px; padding:0 9px; border:1px solid var(--border-subtle); border-radius:999px; background:var(--surface-white); font-size:11.5px; font-family:var(--font-mono); color:var(--text-secondary); cursor:pointer; }
.ct-bl-uchip:hover { border-color:var(--hue-blue); }
.ct-bl-uchip.on { background:var(--hue-blue); border-color:var(--hue-blue); color:#fff; }
.ct-bl-bindhint { font-size:11px; color:rgb(178,100,0); }
/* 其他费用独立块:金额窄列(段头行内,高度对齐位置输入) */
.ct-other-amt { flex:0 0 120px; height:34px; font-size:12.5px; padding:0 8px; }
.ct-bl-row, .ct-bl-cond { display:flex; align-items:center; gap:6px; }
.ct-bl-row .ct-in, .ct-bl-cond .ct-in { height:34px; font-size:12.5px; padding:0 8px; }
.ct-bl-feename { flex:0 0 148px; font-size:12.5px; color:var(--text-primary); }
.ct-bl-feename em { font-style:normal; font-size:10.5px; color:var(--text-muted); }
.ct-bl-n { flex:1 1 0; min-width:0; }
/* 标的面积预填提示:来自单元档案的自动填充短暂高亮(title 注明「来自单元档案,可改」),用户改动即清 */
.ct-bl-n.auto-area { border-color:var(--hue-blue); animation:ctAutoFill 1.8s var(--ease-standard); }
@keyframes ctAutoFill { from { background:rgba(59,130,246,.14); } to { background:var(--surface-white); } }
.ct-chk { flex:0 0 148px; display:inline-flex; align-items:center; gap:6px; font-size:12.5px; color:var(--text-secondary); cursor:pointer; }
.ct-chk input { accent-color:var(--hue-blue); }
.ct-bl-mo { flex:0 0 88px; text-align:right; font-family:var(--font-mono); font-size:12.5px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.ct-bl-mo.pending { color:var(--text-disabled); font-family:var(--font-sans); font-weight:var(--fw-regular); }
.ct-seg-add { position:relative; }
.ct-seg-menu { position:absolute; top:100%; left:0; margin-top:4px; z-index:var(--z-popover); display:flex; flex-direction:column; min-width:120px; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-md); box-shadow:0 12px 32px rgba(28,28,28,.18); overflow:hidden; }
.ct-seg-menu-item { padding:8px 12px; border:none; background:none; text-align:left; font-size:12.5px; color:var(--text-primary); cursor:pointer; }
.ct-seg-menu-item:hover { background:var(--bg-hover); color:var(--hue-blue); }
/* F2 免租期行式编辑 */
.ct-rf { display:flex; flex-direction:column; gap:8px; }
.ct-rf-row { display:flex; align-items:center; gap:8px; }
.ct-rf-row .ct-in { height:34px; font-size:12.5px; }
.ct-rf-row input[type="date"].ct-in { flex:0 0 138px; width:138px; }
.ct-rf-arrow { flex:0 0 auto; font-size:12px; color:var(--text-disabled); }
.ct-rf-note { flex:1 1 auto; min-width:0; }
.ct-rf-del { flex:0 0 auto; display:grid; place-items:center; width:28px; height:28px; border:none; background:none; border-radius:var(--radius-sm); color:var(--text-muted); cursor:pointer; }
.ct-rf-del:hover { background:var(--bg-hover); color:var(--hue-red); }
.ct-rf-warn { font-size:11.5px; line-height:14px; min-height:14px; color:rgb(168,98,0); margin-top:3px; }
.ct-erm { font-size:11.5px; color:var(--hue-red); margin-top:8px; min-height:14px; }
.ct-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
</style>
