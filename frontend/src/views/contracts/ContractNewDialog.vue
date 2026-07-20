<script setup lang="ts">
// 合同弹窗(新增/编辑/续签三态) — 样式 1:1 LedgerNewCompanyDialog/FinDialogs(.ct-mask/.ct-dlg 居中弹窗,
// Teleport to body,回车提交,错误行内提示);字段多,两列排布。
// 无 prop=新增(emit created);initial=编辑(全字段回填,提交走 update);renewFrom=续签(租户/楼栋/单元锁定,
// 提交走 renew,原合同将被终止)。编辑/续签成功 emit saved 携带最新 DTO,由父级刷新 list+summary+drawer。
import { ref, computed, onMounted } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import { contractApi } from '@/api/contract'
import { tenantApi } from '@/api/tenant'
import { buildingApi } from '@/api/building'
import { RENT_AREA_FACTOR } from '@/types/contract'
import type { ContractDTO, RentFreePeriod } from '@/types/contract'
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
  { value: 'expiring', label: 'expiring · 即将到期' },
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
const buildingArea = ref<number | null>(null)   // 建筑面积㎡(V33,可空)
const rentArea = ref<number | null>(null)
const unitPrice = ref<number | null>(null)      // 租金单价 元/㎡/月(V33,可空)
const monthlyRent = ref<number | null>(null)
const deposit = ref<number | null>(null)
// 免租期行编辑(F2):note 恒为 string 便于 v-model,提交时空 note 不写入
const rentFreeRows = ref<{ start: string; end: string; note: string }[]>([])
const startDate = ref('')
const endDate = ref('')
const signDate = ref('')
const status = ref('active')
const remark = ref('')

const err = ref('')
const submitting = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  inputRef.value?.focus()
  if (props.renewFrom) {
    // 续签:租户/楼栋/单元锁定展示无需选项;合同号/日期留空,租金/押金/面积预填可改。
    // 建筑面积/单价由后端继承原合同(renew req 无此字段),仅锁定展示;免租期属旧租期条款不继承。
    rentArea.value = props.renewFrom.rentArea
    monthlyRent.value = props.renewFrom.monthlyRent
    deposit.value = props.renewFrom.deposit
    status.value = 'active'
    rentAreaDirty.value = true
    monthlyRentDirty.value = true
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
    unitPrice.value = c.unitPrice ?? null
    monthlyRent.value = c.monthlyRent
    deposit.value = c.deposit
    rentFreeRows.value = (c.rentFree ?? []).map(p => ({ start: p.start, end: p.end, note: p.note ?? '' }))
    startDate.value = c.startDate ?? ''
    endDate.value = c.endDate ?? ''
    signDate.value = c.signDate ?? ''
    status.value = c.status
    remark.value = c.remark ?? ''
    // 编辑态初始即视为脏:存量租赁面积/月租金不被联动冲掉
    rentAreaDirty.value = true
    monthlyRentDirty.value = true
  } else if (props.presetBuildingId != null) {
    // 新增态预设楼栋:回填并载入其单元(下拉锁定)
    buildingId.value = props.presetBuildingId
    units.value = (await buildingApi.detail(props.presetBuildingId)).units
  }
})

// 选楼栋后载入其单元列表(可留空);切换楼栋清空已选单元。
// 用 @change 而非 watch:编辑态程序化回填 buildingId/unitId 时不应触发联动清空/覆盖
async function onBuildingChange() {
  err.value = ''
  unitId.value = null
  units.value = buildingId.value == null ? [] : (await buildingApi.detail(buildingId.value)).units
}

// 选单元自动带出租赁面积(可改),并链动月租金(与 F1 联动同口径)
function onUnitChange() {
  const u = units.value.find(x => x.id === unitId.value)
  if (u) { rentArea.value = u.area; syncMonthlyRent() }
}

// ─── F1 面积/租金联动 ─────────────────────────────────────
// 建筑面积→租赁面积=÷RENT_AREA_FACTOR;租赁面积/单价→月租金=×单价(均 round2,可改)。
// 目标框被手动改过即置脏、不再被联动覆盖;编辑/续签态初始即脏(onMounted 置位)。
const rentAreaDirty = ref(false)
const monthlyRentDirty = ref(false)
const round2 = (n: number) => Math.round(n * 100) / 100
const isNum = (v: number | null): v is number => typeof v === 'number' && !Number.isNaN(v)

function syncMonthlyRent() {
  if (!monthlyRentDirty.value && isNum(rentArea.value) && isNum(unitPrice.value))
    monthlyRent.value = round2(rentArea.value * unitPrice.value)
}
function onBuildingAreaInput() {
  err.value = ''
  if (!rentAreaDirty.value && isNum(buildingArea.value)) {
    rentArea.value = round2(buildingArea.value / RENT_AREA_FACTOR)
    syncMonthlyRent()
  }
}
function onRentAreaInput() { err.value = ''; rentAreaDirty.value = true; syncMonthlyRent() }
function onUnitPriceInput() { err.value = ''; syncMonthlyRent() }
function onMonthlyRentInput() { err.value = ''; monthlyRentDirty.value = true }

// ─── F2 免租期行编辑 ──────────────────────────────────────
function addRentFreeRow() { rentFreeRows.value.push({ start: '', end: '', note: '' }) }
function removeRentFreeRow(i: number) { rentFreeRows.value.splice(i, 1) }

// 越界合同期=黄色警示不阻断(spec);缺日期/起止倒挂在 submit 阻断(后端同样校验)
function rowWarn(r: { start: string; end: string }): string {
  if (!r.start || !r.end) return ''
  if (r.start > r.end) return '开始日期晚于结束日期'
  if (startDate.value && r.start < startDate.value) return '早于合同开始日期'
  if (endDate.value && r.end > endDate.value) return '晚于合同结束日期'
  return ''
}

// v-model.number 清空输入时值退化为 ''(string),统一收敛为数字,默认 0
const num = (v: number | null) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0)
// V33 可空列(建筑面积/单价)语义=留空不推测,空值不塌缩成 0
const numOrNull = (v: number | null) => (isNum(v) ? v : null)

async function submit() {
  if (submitting.value) return
  if (!contractNo.value.trim()) { err.value = '请输入合同号'; return }
  if (mode.value !== 'renew') {
    if (tenantId.value == null) { err.value = '请选择租户'; return }
    if (buildingId.value == null) { err.value = '请选择楼栋'; return }
  }
  // 免租期行校验(F2):全空行忽略;缺起止/倒挂阻断;越界合同期仅行内黄警示不阻断
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
    const req = {
      contractNo: contractNo.value.trim(),
      tenantId: tenantId.value!,
      buildingId: buildingId.value!,
      unitId: unitId.value,
      buildingArea: numOrNull(buildingArea.value),
      rentArea: num(rentArea.value),
      unitPrice: numOrNull(unitPrice.value),
      monthlyRent: num(monthlyRent.value),
      deposit: num(deposit.value),
      rentFree: rfRows.length
        ? rfRows.map<RentFreePeriod>(r =>
            r.note.trim() ? { start: r.start, end: r.end, note: r.note.trim() } : { start: r.start, end: r.end })
        : null,
      startDate: startDate.value || null,
      endDate: endDate.value || null,
      signDate: signDate.value || null,
      status: status.value,
      remark: remark.value.trim() || null,
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
          <p v-if="mode === 'renew'">为「{{ renewFrom?.contractNo }}」创建续签新约,租户/楼栋/单元沿用原合同。提交后原合同将标记为已终止。</p>
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
              <select v-else class="ct-in" v-model="unitId" :disabled="buildingId == null" @change="onUnitChange()">
                <option :value="null">留空 · 不指定单元</option>
                <option v-for="u in units" :key="u.id" :value="u.id">
                  {{ u.floor }}F-{{ u.unitNo }} · {{ u.area }}㎡{{ u.status === 'vacant' ? '' : ' · 非空置' }}
                </option>
              </select>
            </div>
            <!-- F1 字段顺序:建筑面积 → 租赁面积(自动/可改) → 租金单价 → 月租金(自动/可改) -->
            <div class="ct-field">
              <div class="lab">建筑面积 ㎡</div>
              <input v-if="mode === 'renew'" class="ct-in" :value="renewFrom?.buildingArea ?? '—'" disabled title="续签继承原合同" />
              <input v-else class="ct-in" type="number" min="0" v-model.number="buildingArea" placeholder="选填"
                     @input="onBuildingAreaInput" @keydown.enter="submit" />
            </div>
            <div class="ct-field">
              <div class="lab">租赁面积 ㎡</div>
              <input class="ct-in" type="number" min="0" v-model.number="rentArea" placeholder="0"
                     @input="onRentAreaInput" @keydown.enter="submit" />
            </div>
            <div class="ct-field">
              <div class="lab">租金单价 元/㎡·月</div>
              <input v-if="mode === 'renew'" class="ct-in" :value="renewFrom?.unitPrice ?? '—'" disabled title="续签继承原合同" />
              <input v-else class="ct-in" type="number" min="0" step="0.01" v-model.number="unitPrice" placeholder="选填"
                     @input="onUnitPriceInput" @keydown.enter="submit" />
            </div>
            <div class="ct-field">
              <div class="lab">月租金 元</div>
              <input class="ct-in" type="number" min="0" v-model.number="monthlyRent" placeholder="0"
                     @input="onMonthlyRentInput" @keydown.enter="submit" />
            </div>
            <div class="ct-field">
              <div class="lab">押金 元</div>
              <input class="ct-in" type="number" min="0" v-model.number="deposit" placeholder="0"
                     @input="err = ''" @keydown.enter="submit" />
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
.ct-in { width:100%; box-sizing:border-box; height:40px; padding:0 12px; font-size:13.5px; color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.ct-in:focus { border-color:var(--hue-blue); }
.ct-in.err { border-color:var(--hue-red); }
.ct-in:disabled { background:var(--bg-sunken); color:var(--text-disabled); cursor:not-allowed; }
select.ct-in { appearance:auto; }
/* F2 免租期行式编辑 */
.ct-rf { display:flex; flex-direction:column; gap:8px; }
.ct-rf-row { display:flex; align-items:center; gap:8px; }
.ct-rf-row .ct-in { height:34px; font-size:12.5px; }
.ct-rf-row input[type="date"].ct-in { flex:0 0 138px; width:138px; }
.ct-rf-arrow { flex:0 0 auto; font-size:12px; color:var(--text-disabled); }
.ct-rf-note { flex:1 1 auto; min-width:0; }
.ct-rf-del { flex:0 0 auto; display:grid; place-items:center; width:28px; height:28px; border:none; background:none; border-radius:var(--radius-sm); color:var(--text-muted); cursor:pointer; }
.ct-rf-del:hover { background:var(--bg-hover); color:var(--hue-red); }
/* 越界黄色警示(不阻断);文字用深琥珀保证可读性,与列表页临期色同源 */
.ct-rf-warn { font-size:11.5px; color:rgb(168,98,0); margin-top:3px; }
.ct-erm { font-size:11.5px; color:var(--hue-red); margin-top:8px; min-height:14px; }
.ct-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
</style>
