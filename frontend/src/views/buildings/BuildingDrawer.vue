<script setup lang="ts">
import { ref, computed } from 'vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
import FPStat from '@/components/fp/FPStat.vue'
import FPSectionLabel from '@/components/fp/FPSectionLabel.vue'
import FPUnitMap from '@/components/fp/FPUnitMap.vue'
import Avatar from '@/components/ds/Avatar.vue'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import ContractNewDialog from '@/views/contracts/ContractNewDialog.vue'
import { buildingApi } from '@/api/building'
import { fpMoney, fpWan } from '@/utils/money'
import { leasedAreaShow, occPct, OCC_NULL_WHY } from '@/types/building'
import type { BuildingDTO, BuildingDetailDTO, BuildingUpdateReq, UnitDTO } from '@/types/building'
import type { UnitDTO as MapUnit } from '@/components/fp/FPUnitMap.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const props = defineProps<{
  open: boolean
  building: BuildingDTO | null
  detail: BuildingDetailDTO | null
  // 显式转发给 FPDrawer 的同名 prop(不用 $attrs,避免连带透传别的属性)
  fixedHeight?: boolean
}>()

const emit = defineEmits<{ close: []; edit: []; delete: []; refreshed: [BuildingDetailDTO] }>()

const selUnit = ref<UnitDTO | null>(null)

// 删除确认弹窗(样式自带,结构参考 FinDialogs delco 的 .fin-mask/.fin-dlg)
const delConfirm = ref(false)
function confirmDelete() { delConfirm.value = false; emit('delete') }

// reset selection when drawer opens new building
// FPUnitMap 回传的就是本组件经 :building 传入的完整 UnitDTO,仅事件签名较窄,cast 回来
function onPick(u: MapUnit) { selUnit.value = u as UnitDTO }

// ponytail: derive tenant list from units — no extra API call
const tenants = computed(() => {
  if (!props.detail) return []
  const seen = new Set<number>()
  const result: { id: number; companyName: string; units: UnitDTO[]; rent: number }[] = []
  for (const u of props.detail.units) {
    if (u.tenantId == null || seen.has(u.tenantId)) continue
    seen.add(u.tenantId)
    const unitGroup = props.detail.units.filter(x => x.tenantId === u.tenantId)
    const rent = unitGroup.reduce((s, x) => s + (x.monthlyRent ?? 0), 0)
    result.push({ id: u.tenantId, companyName: u.companyName ?? '—', units: unitGroup, rent })
  }
  return result
})

const b = computed(() => props.building)
const units = computed(() => props.detail?.units ?? [])

// unit-status label map — mirrors FPUnitMap
const STATUS_LABEL: Record<string, string> = {
  occupied: '在租', expiring: '即将到期', reserved: '待入驻', vacant: '空置',
}

// contract status for selected unit (best active contract status label)
function selUnitContractStatus(u: UnitDTO): string {
  if (!u.tenantId) return 'vacant'
  // Infer from unit status
  return u.status === 'occupied' ? 'active' : u.status === 'expiring' ? 'expiring' : 'draft'
}

function resetSel() { selUnit.value = null }

// ─── 楼层/单元管理 ─────────────────────────────────────────
const errMsg = (e: unknown) => (e as { message?: string })?.message ?? '操作失败'
// ds/Select 的 value 一律字符串,楼层号进出各转一次
const floorOpts = computed(() =>
  Array.from({ length: b.value?.floorCount ?? 0 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}F` })))

// 所有写操作成功后:重拉 detail、同步已选单元、emit 让 BuildingsView 重拉 list+summary
async function refresh() {
  if (!props.building) return
  const d = await buildingApi.detail(props.building.id)
  selUnit.value = d.units.find(u => u.id === selUnit.value?.id) ?? null
  emit('refreshed', d)
}

// 单元图行尾「+」:该层新增单元(unitNo 后端自动生成)
async function onAddUnit(floor: number) {
  if (!b.value) return
  try { await buildingApi.addUnit(b.value.id, { floor }); await refresh() }
  catch (e) { alert(errMsg(e)) }
}

// 换层(unitNo/面积不变,仅改 floor)
async function moveUnitToFloor(u: UnitDTO, floor: number) {
  await buildingApi.updateUnit(u.id, { floor, unitNo: u.unitNo, area: u.area ?? 0 })
}
// 下拉是受控的(值来自 selUnit.floor),失败时不必手工回滚:状态没动,显示自然还是原楼层
async function onMoveFloor(v: string) {
  const u = selUnit.value
  const f = +v
  if (!u || f === u.floor) return
  try { await moveUnitToFloor(u, f); await refresh() }
  catch (err) { alert(errMsg(err)) }
}
// 在租租户行「换层」快捷:对该租户在本栋的全部单元执行换层
// model-value 恒为 ''(纯动作触发器),选完自动回到 placeholder「换层」
async function onTenantMove(tUnits: UnitDTO[], v: string) {
  const f = +v
  if (!f) return
  try {
    for (const u of tUnits) if (u.floor !== f) await moveUnitToFloor(u, f)
    await refresh()
  } catch (err) { alert(errMsg(err)); await refresh() }
}

// 编辑单元(小弹窗改 unitNo/面积)
const unitDlg = ref(false)
const uNo = ref('')
const uArea = ref<number | null>(null)
const uErr = ref('')
function openUnitDlg() {
  if (!selUnit.value) return
  uNo.value = selUnit.value.unitNo
  uArea.value = selUnit.value.area
  uErr.value = ''
  unitDlg.value = true
}
async function submitUnitEdit() {
  const u = selUnit.value
  if (!u) return
  if (!uNo.value.trim()) { uErr.value = '请输入单元号'; return }
  try {
    await buildingApi.updateUnit(u.id, {
      floor: u.floor,
      unitNo: uNo.value.trim(),
      area: typeof uArea.value === 'number' && !Number.isNaN(uArea.value) ? uArea.value : 0,
    })
    unitDlg.value = false
    await refresh()
  } catch (e) { uErr.value = errMsg(e) }
}

// 删除单元(有合同后端 409)
const delUnitConfirm = ref(false)
async function confirmDeleteUnit() {
  const u = selUnit.value
  if (!u) return
  delUnitConfirm.value = false
  try { await buildingApi.removeUnit(u.id); await refresh() }
  catch (e) { alert(errMsg(e)) }
}

// 楼层管理:BuildingUpdateReq 是全量 PUT,从当前 DTO 组装完整 body
function updBody(floorCount: number): BuildingUpdateReq {
  const x = b.value!
  return {
    name: x.name, phase: x.phase, floorCount,
    totalArea: x.totalArea, rentableArea: x.rentableArea,
    status: x.status, remark: x.remark ?? undefined, zone: x.zone,
  }
}
const topHasUnits = computed(() => units.value.some(u => u.floor === (b.value?.floorCount ?? 0)))
const canRemoveTop = computed(() => !!b.value && b.value.floorCount > 1 && !topHasUnits.value)
async function addFloor() {
  if (!b.value) return
  try { await buildingApi.update(b.value.id, updBody(b.value.floorCount + 1)); await refresh() }
  catch (e) { alert(errMsg(e)) }
}
async function removeTopFloor() {
  if (!b.value || !canRemoveTop.value) return
  try { await buildingApi.update(b.value.id, updBody(b.value.floorCount - 1)); await refresh() }
  catch (e) { alert(errMsg(e)) }
}

// 新增合同(锁定当前楼栋),成功后刷新 drawer detail + 上抛列表刷新
const contractDlg = ref(false)
async function onContractCreated() {
  contractDlg.value = false
  await refresh()
}
</script>

<template>
  <FPDrawer
    :open="open"
    :title="b?.name ?? ''"
    :subtitle="b ? `${b.phaseName} · ${b.kind} · ${b.floorCount} 层` : ''"
    :icon="b?.phase === 4 ? 'bed-double' : 'building-2'"
    :width="640"
    :fixed-height="fixedHeight"
    @close="emit('close'); resetSel()"
  >
    <template #badge>
      <FPContractStatus v-if="b" :status="b.status === 1 ? 'active' : 'terminated'" />
    </template>

    <template #footer>
      <!-- 危险态跟全站多数派(TenantDrawer/ContractDrawer 页脚删除)统一走 danger:
           原来和旁边「编辑楼栋」同为 gray,一眼分不出,误点即连带删掉栋内全部单元 -->
      <Button v-if="auth.can('master:edit')" variant="danger" size="sm" @click="delConfirm = true">
        <template #leading><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></template>
        删除
      </Button>
      <Button v-if="auth.can('master:edit')" variant="gray" size="sm" @click="emit('edit')">
        <template #leading><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></template>
        编辑楼栋
      </Button>
      <!-- 新增合同=合同写(contract:edit),与楼栋/单元的 master:edit 分属两个权限点 -->
      <Button v-if="auth.can('contract:edit')" variant="filled" size="sm" @click="contractDlg = true">
        <template #leading><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></template>
        新增合同
      </Button>
    </template>

    <!-- A: 6 FPStat grid -->
    <div v-if="b" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      <!-- 在租面积回落合同派生汇总(S15 服务刀字段):单元面积Σ恒0不再显示 0 / 可租
           出租率算不出来时(§3)副标让位给缺因:此时分母本就缺失,面积口径会显示成「x / 0 ㎡」,更没信息量 -->
      <FPStat
        label="出租率" tint="blue"
        :value="b.status === 0 ? '停用' : occPct(b.occRate)"
        :sub="b.occRate == null ? OCC_NULL_WHY : `${leasedAreaShow(b).toLocaleString('en-US')} / ${b.rentableArea.toLocaleString('en-US')} ㎡`"
      />
      <FPStat
        label="在租单元" tint="slate"
        :value="`${b.occupiedCount}/${b.unitCount}`"
        :sub="`空置 ${b.vacantCount} · 待入驻 ${b.reservedCount}`"
      />
      <FPStat
        label="月租金" tint="sky"
        :value="fpWan(b.monthlyRent)"
        :sub="`${b.tenantIds.length} 户在租`"
      />
      <FPStat label="总面积" :value="b.totalArea.toLocaleString('en-US')" sub="㎡" />
      <FPStat label="可租面积" :value="b.rentableArea.toLocaleString('en-US')" sub="㎡" />
      <FPStat label="即将到期" :value="String(b.expiringCount)" sub="单元(90 天内)" />
      <!-- 建筑面积=栋内在租合同建筑面积汇总(只读,BILL-FORWARD 刀1 面积链路) -->
      <FPStat label="建筑面积" :value="b.tenantBuildingArea ? b.tenantBuildingArea.toLocaleString('en-US') : '—'" sub="㎡ · 在租合同汇总" />
    </div>

    <!-- B: Unit map -->
    <div v-if="detail">
      <FPSectionLabel icon="layout-grid">
        楼层单元图
        <template #right>
          <span style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:var(--text-muted)">点击单元查看租户</span>
            <Button v-if="auth.can('master:edit')" variant="outline" size="sm" @click="addFloor">添加楼层</Button>
            <Button
              v-if="auth.can('master:edit')"
              variant="outline" size="sm"
              :disabled="!canRemoveTop"
              :title="topHasUnits ? '顶层存在单元,不可删除' : ((b?.floorCount ?? 0) <= 1 ? '至少保留一层' : undefined)"
              @click="removeTopFloor"
            >删除顶层</Button>
          </span>
        </template>
      </FPSectionLabel>
      <FPUnitMap
        :building="{ units, floorCount: b?.floorCount ?? 0 }"
        :selectedNo="selUnit?.unitNo ?? null"
        :can-add="auth.can('master:edit')"
        @pick="onPick"
        @add-unit="onAddUnit"
      />
    </div>
    <!-- detail 未到时的等量级骨架(§6.4):楼层单元图是抽屉里最高的一块,高度归零 → detail 到达时
         下方「在租租户」整体下坠。高度按真实量级估:区标题+图例约 70px,每层一行 ≥44px + 6px gap = 50px -->
    <div
      v-else
      class="bd-mapskel"
      :style="{ minHeight: 70 + (b?.floorCount ?? 6) * 50 + 'px' }"
      aria-hidden="true"
    ></div>

    <!-- C: Selected unit panel -->
    <div
      v-if="selUnit"
      style="background:var(--surface-card);border-radius:var(--radius-lg);padding:14px 16px"
    >
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px" :style="{ marginBottom: selUnit.tenantId ? '10px' : '0' }">
        <span style="display:flex;align-items:center;gap:9px">
          <span style="font-family:var(--font-mono);font-size:14px;font-weight:var(--fw-semibold)">{{ selUnit.floor }}F-{{ selUnit.unitNo }}</span>
          <span style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">{{ selUnit.area?.toLocaleString('en-US') }} ㎡</span>
          <!-- 合同派生面积(S15 服务刀字段):单元未录面积时给占用合同的租赁面积兜底展示 -->
          <span v-if="!selUnit.area && selUnit.derivedArea"
                style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono)"
                title="合同派生面积:单元未录面积,取占用合同计费行面积(绑定行Σ,无绑定按同类型行均摊)">≈{{ selUnit.derivedArea.toLocaleString('en-US') }} ㎡ 合同</span>
        </span>
        <span style="display:flex;align-items:center;gap:8px">
          <!-- 跨栋占用(S15 服务刀字段):经附加单元挂入的外栋合同 -->
          <span v-if="selUnit.crossBuilding"
                style="font-size:11.5px;color:rgb(64,84,124);background:var(--accent-slate);padding:2px 8px;border-radius:999px"
                title="跨栋占用:该单元由其他楼栋的合同经附加单元挂入">跨栋{{ selUnit.homeBuildingName ? ' · ' + selUnit.homeBuildingName : '' }}</span>
          <span style="font-size:12px;color:var(--text-muted)">{{ STATUS_LABEL[selUnit.status] }}</span>
        </span>
      </div>
      <div v-if="selUnit.tenantId" style="display:flex;align-items:center;gap:10px">
        <Avatar :name="selUnit.companyName ?? ''" :size="32" />
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:var(--fw-medium)">{{ selUnit.companyName }}</div>
          <div style="font-size:11.5px;color:var(--text-muted)">
            {{ selUnit.businessType }} · {{ selUnit.contractNo ?? '—' }} · {{ fpMoney(selUnit.monthlyRent) }}/月
          </div>
        </div>
        <FPContractStatus :status="selUnitContractStatus(selUnit)" />
      </div>
      <div v-else style="font-size:12.5px;color:var(--text-muted)">
        该单元当前{{ STATUS_LABEL[selUnit.status] }}，可发起招商或新增合同。
      </div>
      <!-- 单元操作区:换层 / 编辑 / 删除(整条=单元写操作,无 master:edit 不出现;上方单元信息照常显示) -->
      <div v-if="auth.can('master:edit')" style="display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border-subtle)">
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)">
          换层
          <Select
            size="sm" :options="floorOpts" :model-value="String(selUnit.floor)"
            :style="{ width: '84px' }" @update:model-value="onMoveFloor"
          />
        </label>
        <span style="flex:1"></span>
        <Button variant="outline" size="sm" @click="openUnitDlg">编辑单元</Button>
        <Button variant="outline" size="sm" @click="delUnitConfirm = true">删除单元</Button>
      </div>
    </div>

    <!-- D: Tenant list -->
    <div>
      <FPSectionLabel icon="users">在租租户 · {{ tenants.length }}</FPSectionLabel>
      <div v-if="tenants.length === 0" style="font-size:13px;color:var(--text-disabled);padding:8px 0">暂无在租租户</div>
      <div v-else style="display:flex;flex-direction:column;gap:2px">
        <div
          v-for="t in tenants"
          :key="t.id"
          style="display:flex;align-items:center;gap:11px;padding:9px 8px;border-radius:var(--radius-sm)"
        >
          <Avatar :name="t.companyName" :size="30" />
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:var(--fw-medium)">{{ t.companyName }}</div>
            <div style="font-size:11.5px;color:var(--text-muted)">
              {{ t.units.map(u => u.unitNo).join('、') }} · {{ t.units.reduce((s, u) => s + (u.area ?? 0), 0).toLocaleString('en-US') }} ㎡
            </div>
          </div>
          <span style="font-family:var(--font-mono);font-size:12.5px;font-weight:var(--fw-semibold)">{{ fpMoney(t.rent) }}</span>
          <Select
            v-if="auth.can('master:edit')"
            size="sm" placeholder="换层" title="将该租户单元移至目标楼层"
            :options="floorOpts" :model-value="''"
            :style="{ width: '84px', flex: '0 0 auto' }"
            @update:model-value="onTenantMove(t.units, $event)"
          />
        </div>
      </div>
    </div>

    <!-- E: Remark -->
    <div v-if="b?.remark">
      <FPSectionLabel icon="sticky-note">备注</FPSectionLabel>
      <p style="margin:0;font-size:13px;color:var(--text-secondary);line-height:1.6">{{ b.remark }}</p>
    </div>
  </FPDrawer>

  <!-- 删除确认弹窗 -->
  <Teleport to="body">
    <div v-if="delConfirm && b" class="bd-mask" @mousedown="delConfirm = false">
      <div class="bd-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="bd-dlg-h">
          <h3>删除楼栋</h3>
          <p>确认删除“{{ b.name }}”?其全部单元将一并删除,此操作不可撤销。有合同的楼栋不可删除。</p>
        </div>
        <div class="bd-dlg-f">
          <Button variant="gray" size="sm" @click="delConfirm = false">取消</Button>
          <Button variant="danger" size="sm" @click="confirmDelete">确认删除</Button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 编辑单元弹窗 -->
  <Teleport to="body">
    <div v-if="unitDlg && selUnit" class="bd-mask" @mousedown="unitDlg = false">
      <div class="bd-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="bd-dlg-h">
          <h3>编辑单元</h3>
          <p>修改 {{ selUnit.floor }}F-{{ selUnit.unitNo }} 的单元号与面积。</p>
        </div>
        <div class="bd-dlg-b">
          <div class="bd-field">
            <div class="lab">单元号 <i>*</i></div>
            <input class="bd-in" :class="{ err: uErr === '请输入单元号' }" v-model="uNo" maxlength="16"
                   placeholder="如:101" @input="uErr = ''" @keydown.enter="submitUnitEdit" />
          </div>
          <div class="bd-field">
            <div class="lab">面积 ㎡</div>
            <input class="bd-in" type="number" min="0" v-model.number="uArea" placeholder="0"
                   @input="uErr = ''" @keydown.enter="submitUnitEdit" />
          </div>
          <div class="bd-erm">{{ uErr }}</div>
        </div>
        <div class="bd-dlg-f">
          <Button variant="gray" size="sm" @click="unitDlg = false">取消</Button>
          <Button variant="filled" size="sm" @click="submitUnitEdit">保存</Button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 删除单元确认弹窗 -->
  <Teleport to="body">
    <div v-if="delUnitConfirm && selUnit" class="bd-mask" @mousedown="delUnitConfirm = false">
      <div class="bd-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="bd-dlg-h">
          <h3>删除单元</h3>
          <p>确认删除单元“{{ selUnit.floor }}F-{{ selUnit.unitNo }}”?此操作不可撤销。存在合同记录的单元不可删除。</p>
        </div>
        <div class="bd-dlg-f">
          <Button variant="gray" size="sm" @click="delUnitConfirm = false">取消</Button>
          <Button variant="danger" size="sm" @click="confirmDeleteUnit">确认删除</Button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 新增合同(锁定当前楼栋) -->
  <ContractNewDialog
    v-if="contractDlg && b"
    :preset-building-id="b.id"
    @close="contractDlg = false"
    @created="onContractCreated"
  />
</template>

<style scoped>
/* 1:1 参考 FinDialogs .fin-mask/.fin-dlg;z-index 高于 FPDrawer(300/301) */
.bd-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:320; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:fp-fade-in var(--dur-base) forwards; }
.bd-dlg { width:min(440px,92vw); background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); animation:fp-rise-in var(--dur-base) var(--ease-standard) both; }
.bd-dlg-h { padding:20px 22px 0; }
.bd-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.bd-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.bd-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:20px 22px 20px; }

/* 编辑单元弹窗表单(1:1 ContractNewDialog .ct-in) */
.bd-dlg-b { display:flex; flex-direction:column; gap:12px; padding:18px 22px 0; }
.bd-field .lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
.bd-field .lab i { color:var(--hue-red); font-style:normal; }
.bd-in { width:100%; box-sizing:border-box; height:40px; padding:0 12px; font-size:13.5px; color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.bd-in:focus { border-color:var(--hue-blue); }
.bd-in.err { border-color:var(--hue-red); }
.bd-erm { font-size:11.5px; color:var(--hue-red); min-height:14px; }

/* 楼层单元图加载骨架(高度由内联 min-height 给,按楼层数估) */
.bd-mapskel { background:var(--bg-sunken); border-radius:var(--radius-lg); }

</style>
