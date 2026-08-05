<script setup lang="ts">
// 合同弹窗(新增/编辑/续签三态) — 样式 1:1 LedgerNewCompanyDialog/FinDialogs(.ct-mask/.ct-dlg 居中弹窗,
// Teleport to body,回车提交,错误行内提示);字段多,两列排布。
// 无 prop=新增(emit created);initial=编辑(全字段回填,提交走 update);renewFrom=续签(租户/楼栋/单元锁定,
// 提交走 renew,原合同将标记已续签)。编辑/续签成功 emit saved 携带最新 DTO,由父级刷新 list+summary+drawer。
// 计费(CONTRACT-CARD-SPEC §6.2 单一编辑):选物业类型 → 钉死费用组自动出现(无自由加费用名);条件项(电梯/变压器)
// checkbox 勾选填月额;宿舍门禁/网络只填间数;空地为附加段。月租金/租赁面积由计费行汇总(不双录入,无独立月租金输入)。
import { ref, computed, onMounted } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
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
import type { BuildingDTO, UnitDTO } from '@/types/building'

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

const STATUS_OPTS = [
  { value: 'draft', label: 'draft · 草稿' },
  { value: 'active', label: 'active · 执行中' },
  { value: 'terminated', label: 'terminated · 已终止' },
]

const tenants = ref<TenantDTO[]>([])
// FPTenantPicker 候选(spec §T5):id/name=companyName/期区/关联主租户名
const tenantOptions = computed(() =>
  tenants.value.map(t => ({ id: t.id, name: t.companyName, phase: t.phase, parentName: t.parentName })))
const buildings = ref<BuildingDTO[]>([])
const units = ref<UnitDTO[]>([])

const contractNo = ref('')
const tenantId = ref<number | null>(null)
const buildingId = ref<number | null>(null)
const unitId = ref<number | null>(null)
const extraUnitIds = ref<number[]>([])   // 附加单元(多场地合同,主单元之外;整组替换语义同后端)
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

// ─── 标的段(CONTRACT-CARD-SPEC §1/§6.2):段=物业类型+位置;段内费用行由类型钉死组决定 ──────
type SegRow = { id: number | null; feeKey: FeeKey; area: number | null; areaShared: number | null; unitPrice: number | null; coeff: number | null; roomCount: number | null; amountOverride: number | null }
type Segment = { propertyType: PropertyType; location: string; rows: SegRow[] }
const segments = ref<Segment[]>([])
const showTypeMenu = ref(false)

function newRow(feeKey: FeeKey): SegRow {
  return { id: null, feeKey, area: null, areaShared: null, unitPrice: pinnedDefaultUnitPrice(feeKey), coeff: null, roomCount: null, amountOverride: null }
}
function buildSegment(pt: PropertyType): Segment {
  return { propertyType: pt, location: '', rows: PINNED_FEES[pt].map(newRow) }
}
function addSegment(pt: PropertyType) { segments.value.push(buildSegment(pt)); showTypeMenu.value = false; err.value = '' }
function removeSegment(i: number) { segments.value.splice(i, 1) }

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
  if (on) { if (!hasFee(seg, key)) seg.rows.push(newRow(key)) }
  else seg.rows = seg.rows.filter(r => r.feeKey !== key)
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
  return m != null ? m.toLocaleString('en-US') : '待录'
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
  ;[tenants.value, buildings.value] = await Promise.all([tenantApi.list(), buildingApi.list()])
  const c = props.initial
  if (c) {
    contractNo.value = c.contractNo
    tenantId.value = c.tenantId
    buildingId.value = c.buildingId
    if (c.buildingId != null) units.value = (await buildingApi.detail(c.buildingId)).units
    unitId.value = c.unitId
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
    const d = await contractApi.detail(c.id)
    segments.value = groupLines(d.billingLines)
    extraUnitIds.value = d.extraUnitIds ?? []
  } else if (props.presetBuildingId != null) {
    buildingId.value = props.presetBuildingId
    units.value = (await buildingApi.detail(props.presetBuildingId)).units
  }
})

// 详情计费行 → 标的段(按 propertyType+location 分组;遗留 propertyType 空按租金行反推;钉死行缺失补齐)
function groupLines(lines: BillingLineDTO[]): Segment[] {
  const segs: Segment[] = []
  for (const l of lines) {
    const pt = (l.propertyType ?? inferPropertyType(l.feeKey)) as PropertyType
    let g = segs.find(s => s.propertyType === pt && s.location === l.location)
    if (!g) { g = { propertyType: pt, location: l.location, rows: [] }; segs.push(g) }
    g.rows.push({ id: l.id, feeKey: l.feeKey, area: l.area ?? null, areaShared: l.areaShared ?? null, unitPrice: l.unitPrice ?? null, coeff: l.coeff ?? null, roomCount: l.roomCount ?? null, amountOverride: l.amountOverride ?? null })
  }
  for (const s of segs)
    for (const k of PINNED_FEES[s.propertyType])
      if (!s.rows.some(r => r.feeKey === k)) s.rows.push(newRow(k))
  return segs
}

// 选楼栋后载入其单元列表(可留空);切换楼栋清空已选单元。
async function onBuildingChange() {
  err.value = ''
  unitId.value = null
  extraUnitIds.value = []
  try {
    units.value = buildingId.value == null ? [] : (await buildingApi.detail(buildingId.value)).units
  } catch {
    units.value = []   // 失败清空,不残留上一栋的单元列表(派生审计)
    err.value = '单元列表加载失败,请重选楼栋'
  }
}

function toggleExtraUnit(id: number) {
  const i = extraUnitIds.value.indexOf(id)
  if (i >= 0) extraUnitIds.value.splice(i, 1)
  else extraUnitIds.value.push(id)
  err.value = ''
}

const round2 = (n: number) => Math.round(n * 100) / 100
const isNum = (v: number | null): v is number => typeof v === 'number' && !Number.isNaN(v)

// 租赁面积=各段建筑类租金行面积之和(空地租金单列不计);无该类行=null(回落续签 rentArea)
const rentAreaSum = computed<number | null>(() => {
  let sum = 0, has = false
  for (const seg of segments.value)
    for (const r of seg.rows)
      if (BUILDING_RENT_KEYS.includes(r.feeKey) && isNum(r.area)) { sum += r.area; has = true }
  return has ? round2(sum) : null
})
const rentAreaShow = computed<number | null>(() => rentAreaSum.value ?? rentArea.value)
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

async function submit() {
  if (submitting.value) return
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
        roomCount: numOrNull(r.roomCount), amountOverride: numOrNull(r.amountOverride), seq: i,
      }))
    }
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
      unitId: unitId.value,
      extraUnitIds: extraUnitIds.value.filter(id => id !== unitId.value),
      buildingArea: numOrNull(buildingArea.value),
      rentArea: rentAreaSum.value ?? num(rentArea.value),
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
    <div class="ct-mask" @mousedown="emit('close')">
      <div class="ct-dlg" role="dialog" aria-modal="true" @mousedown.stop>
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
              <select class="ct-in" v-model="status" :disabled="mode === 'renew'">
                <option v-for="o in STATUS_OPTS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
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
              <select v-else class="ct-in" :class="{ err: err === '请选择楼栋' }" v-model="buildingId"
                      :disabled="mode === 'new' && presetBuildingId != null" @change="onBuildingChange()">
                <option :value="null" disabled>请选择楼栋</option>
                <option v-for="b in buildings" :key="b.id" :value="b.id">{{ b.name }}</option>
              </select>
            </div>
            <div class="ct-field">
              <div class="lab">单元</div>
              <input v-if="mode === 'renew'" class="ct-in" :value="renewFrom?.floorInfo || '未指定单元'" disabled />
              <select v-else class="ct-in" v-model="unitId" :disabled="buildingId == null" @change="err = ''">
                <option :value="null">留空 · 不指定单元</option>
                <option v-for="u in units" :key="u.id" :value="u.id">
                  {{ u.floor }}F-{{ u.unitNo }} · {{ u.area }}㎡{{ u.status === 'vacant' ? '' : ' · 非空置' }}
                </option>
              </select>
            </div>
            <!-- 附加单元(多场地合同):主单元之外再勾选,占用/楼栋派生按并集自动跟随 -->
            <div v-if="mode !== 'renew'" class="ct-field ct-field-wide">
              <div class="lab">附加单元 · 多场地可多选{{ extraUnitIds.length ? `(已选${extraUnitIds.length})` : '' }}</div>
              <div class="ct-units" :class="{ dim: buildingId == null }">
                <span v-if="buildingId == null" class="ct-units-empty">先选楼栋</span>
                <span v-else-if="units.filter(u => u.id !== unitId).length === 0" class="ct-units-empty">该栋无其他单元</span>
                <label v-else v-for="u in units.filter(u => u.id !== unitId)" :key="u.id" class="ct-unit-chk">
                  <input type="checkbox" :checked="extraUnitIds.includes(u.id)" @change="toggleExtraUnit(u.id)" />
                  {{ u.floor }}F-{{ u.unitNo }}
                </label>
              </div>
            </div>
            <!-- 建筑面积 → 租赁面积(计费行汇总只读);月租金/租金单价并入下方标的段,不双录入 -->
            <div class="ct-field">
              <div class="lab">建筑面积 ㎡</div>
              <input v-if="mode === 'renew'" class="ct-in" :value="renewFrom?.buildingArea ?? '—'" disabled title="续签继承原合同" />
              <input v-else class="ct-in" type="number" min="0" v-model.number="buildingArea" placeholder="留空=租赁面积×0.8"
                     title="可清空:留空保存后自动=租赁面积×0.8 重算;显式填值则尊重填值"
                     @input="err = ''" @keydown.enter="submit" />
            </div>
            <div class="ct-field">
              <div class="lab">租赁面积 ㎡{{ mode === 'renew' ? '' : ' · 自动汇总' }}</div>
              <input v-if="mode === 'renew'" class="ct-in" type="number" min="0" v-model.number="rentArea" placeholder="0"
                     @input="err = ''" @keydown.enter="submit" />
              <input v-else class="ct-in" disabled placeholder="按标的段建筑类租金面积汇总"
                     title="租赁面积=各标的段建筑类租金面积之和,面积只在标的段内录入"
                     :value="rentAreaShow != null ? rentAreaShow.toLocaleString('en-US') : ''" />
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
                <select class="ct-in" v-model="powerType" @change="onPowerTypeChange">
                  <option value="">待录</option>
                  <option value="industrial">大工业</option>
                  <option value="commercial">商业(办公室类)</option>
                  <option value="resident">居民(宿舍类)</option>
                </select>
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
              <div class="lab">标的段 · 选类型钉死费用组(费用名固定不可增删;条件项电梯/变压器勾选填月额;月单价只读派生,合计属账单管理)</div>
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
                  <!-- 钉死行:费用名固定,只填数值 -->
                  <div v-for="row in pinnedRows(seg)" :key="'p' + row.feeKey" class="ct-bl-row">
                    <span class="ct-bl-feename">{{ feeLabel(seg.propertyType, row.feeKey) }}</span>
                    <template v-if="isSqm(row.feeKey)">
                      <input class="ct-in ct-bl-n" type="number" min="0" step="0.01" v-model.number="row.area" placeholder="面积" @input="err = ''" />
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
                    <span class="ct-bl-mo mono" :class="{ pending: rowMonthly(row) === '待录' }">{{ rowMonthly(row) }}</span>
                  </div>
                  <!-- 条件项:电梯/变压器 勾选才落行填月额(首层无梯=不勾=不出现) -->
                  <div v-for="k in COND_FEES[seg.propertyType]" :key="'c' + k" class="ct-bl-cond">
                    <label class="ct-chk">
                      <input type="checkbox" :checked="hasFee(seg, k)" @change="toggleFee(seg, k, ($event.target as HTMLInputElement).checked)" />
                      {{ feeLabel(seg.propertyType, k) }}
                    </label>
                    <template v-if="hasFee(seg, k)">
                      <input class="ct-in ct-bl-n" type="number" min="0" step="0.01" v-model.number="condRow(seg, k).amountOverride" placeholder="月额" @input="err = ''" />
                      <span class="ct-bl-mo mono" :class="{ pending: rowMonthly(condRow(seg, k)) === '待录' }">{{ rowMonthly(condRow(seg, k)) }}</span>
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
                      <span class="ct-bl-mo mono" :class="{ pending: rowMonthly(condRow(seg, k)) === '待录' }">{{ rowMonthly(condRow(seg, k)) }}</span>
                    </template>
                  </div>
                  <!-- 遗留费项(非该类型钉死/条件/可选;保留可见+可删,防静默丢失) -->
                  <div v-for="row in extraRows(seg)" :key="'x' + (row.id ?? row.feeKey)" class="ct-bl-row">
                    <span class="ct-bl-feename">{{ FEE_NAME[row.feeKey] }} <em>遗留</em></span>
                    <input class="ct-in ct-bl-n" type="number" min="0" step="0.01" v-model.number="row.amountOverride" placeholder="月额" @input="err = ''" />
                    <span class="ct-bl-mo mono" :class="{ pending: rowMonthly(row) === '待录' }">{{ rowMonthly(row) }}</span>
                    <button type="button" class="ct-rf-del" title="删除该遗留费项" @click="removeRow(seg, row)">
                      <component :is="iconFor('x')" :size="14" />
                    </button>
                  </div>
                </div>
                <!-- 添加标的段:选物业类型 → 钉死组自动出现 -->
                <div class="ct-seg-add">
                  <Button variant="gray" size="sm" @click="showTypeMenu = !showTypeMenu">
                    <template #leading><component :is="iconFor('plus')" :size="13" /></template>
                    添加标的段
                  </Button>
                  <div v-if="showTypeMenu" class="ct-seg-menu">
                    <button v-for="pt in PROPERTY_TYPES" :key="pt" type="button" class="ct-seg-menu-item" @click="addSegment(pt)">
                      {{ PROPERTY_TYPE_LABEL[pt] }}
                    </button>
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
                <select class="ct-in" v-model="termType" @change="err = ''">
                  <option value="">—</option>
                  <option value="explicit">explicit · 明确起止</option>
                  <option value="multiple">multiple · 多段</option>
                  <option value="relative">relative · 相对表述</option>
                  <option value="none">none · 无</option>
                </select>
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
                  <div v-if="rowWarn(r)" class="ct-rf-warn">⚠ {{ rowWarn(r) }}</div>
                </div>
                <div>
                  <Button variant="gray" size="sm" :disabled="rentFreeRows.length >= 24" @click="addRentFreeRow">
                    <template #leading><component :is="iconFor('plus')" :size="13" /></template>
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
          <Button variant="filled" size="sm" :disabled="submitting" @click="submit">
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
.ct-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:320; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:ctfade .16s forwards; }
@keyframes ctfade { to { opacity:1; } }
.ct-dlg { width:min(640px,92vw); max-height:88vh; overflow-y:auto; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); animation:ctrise .2s var(--ease-standard) both; }
@keyframes ctrise { from { opacity:0; transform:translateY(8px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
.ct-dlg-h { padding:20px 22px 0; }
.ct-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.ct-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.ct-dlg-b { padding:18px 22px 4px; }
.ct-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px 14px; }
.ct-span2 { grid-column:span 2; }
.ct-field .lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
.ct-field .lab i { color:var(--hue-red); font-style:normal; }
.ct-field-wide { grid-column:1 / -1; }
.ct-units { display:flex; flex-wrap:wrap; gap:4px 10px; max-height:96px; overflow-y:auto; padding:8px 10px; border:1px solid var(--border-subtle); border-radius:var(--radius-md); background:var(--surface-white); }
.ct-units.dim { background:var(--surface-muted, #fafafa); }
.ct-units-empty { font-size:12.5px; color:var(--text-disabled); }
.ct-unit-chk { display:inline-flex; align-items:center; gap:5px; font-size:12.5px; color:var(--text-secondary); cursor:pointer; white-space:nowrap; }
.ct-unit-chk input { accent-color:var(--hue-blue); }
.ct-in { width:100%; box-sizing:border-box; height:40px; padding:0 12px; font-size:13.5px; color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.ct-in:focus { border-color:var(--hue-blue); }
.ct-in.err { border-color:var(--hue-red); }
.ct-in:disabled { background:var(--bg-sunken); color:var(--text-disabled); cursor:not-allowed; }
select.ct-in { appearance:auto; }
/* 期限原文/阶梯价留档:多行输入,.ct-in 的固定行高在此放开 */
.ct-ta { height:auto; padding:8px 12px; line-height:1.5; resize:vertical; }
/* 标的段编辑(§6.2):段头=类型徽标+位置+段面积;钉死行=费用名(固定)+数值+月单价;条件/可选=checkbox+月额 */
.ct-bl { display:flex; flex-direction:column; gap:12px; }
.ct-bl-seg { border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:10px; display:flex; flex-direction:column; gap:8px; background:var(--surface-card); }
.ct-bl-seghd { display:flex; align-items:center; gap:8px; }
.ct-seg-badge { flex:0 0 auto; padding:3px 10px; border-radius:999px; background:var(--hue-blue); color:#fff; font-size:12px; font-weight:var(--fw-semibold); }
.ct-bl-loc { flex:1 1 auto; height:34px; font-size:12.5px; font-weight:var(--fw-medium); }
.ct-seg-area { flex:0 0 auto; font-size:12px; font-family:var(--font-mono); color:var(--text-muted); }
.ct-bl-row, .ct-bl-cond { display:flex; align-items:center; gap:6px; }
.ct-bl-row .ct-in, .ct-bl-cond .ct-in { height:34px; font-size:12.5px; padding:0 8px; }
.ct-bl-feename { flex:0 0 148px; font-size:12.5px; color:var(--text-primary); }
.ct-bl-feename em { font-style:normal; font-size:10.5px; color:var(--text-disabled); }
.ct-bl-n { flex:1 1 0; min-width:0; }
.ct-chk { flex:0 0 148px; display:inline-flex; align-items:center; gap:6px; font-size:12.5px; color:var(--text-secondary); cursor:pointer; }
.ct-chk input { accent-color:var(--hue-blue); }
.ct-bl-mo { flex:0 0 88px; text-align:right; font-family:var(--font-mono); font-size:12.5px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.ct-bl-mo.pending { color:var(--text-disabled); font-family:var(--font-sans); font-weight:var(--fw-regular); }
.ct-seg-add { position:relative; }
.ct-seg-menu { position:absolute; top:100%; left:0; margin-top:4px; z-index:2; display:flex; flex-direction:column; min-width:120px; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-md); box-shadow:0 12px 32px rgba(28,28,28,.18); overflow:hidden; }
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
.ct-rf-warn { font-size:11.5px; color:rgb(168,98,0); margin-top:3px; }
.ct-erm { font-size:11.5px; color:var(--hue-red); margin-top:8px; min-height:14px; }
.ct-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
</style>
