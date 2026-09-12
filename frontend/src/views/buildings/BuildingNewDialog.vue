<script setup lang="ts">
// 新建/编辑楼栋弹窗 — 样式 1:1 参考 ledger/LedgerNewCompanyDialog.vue
// 传 initial=编辑态(隐藏每层单元数、加状态下拉、提交走 update);不传=新增态(原流程不变)
import { ref, computed, onMounted } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import type { BuildingDTO, BuildingCreateReq, BuildingUpdateReq } from '@/types/building'
import { useZonesStore } from '@/stores/zones'

const props = defineProps<{ existingNames: string[]; initial?: BuildingDTO }>()
const emit = defineEmits<{ close: []; create: [req: BuildingCreateReq]; update: [req: BuildingUpdateReq] }>()

const zones = useZonesStore()
onMounted(() => zones.ensure())
// 期区决定这栋楼的电表/公摊池/损耗归到哪一期,与「期数」不是一回事(宿舍楼期数是 1 但期区是宿舍)。
// ''=未标注,提交时转 null(Select modelValue 只能是 string)。
const zoneOpts = computed(() => [{ value: '', label: '(未标注)' },
  ...zones.list.map(z => ({ value: z.code, label: z.name }))])
const zone = ref(props.initial?.zone ?? '')

const isEdit = !!props.initial
const name = ref(props.initial?.name ?? '')
const phase = ref<number | null>(props.initial?.phase ?? 1)
const floorCount = ref<number | null>(props.initial?.floorCount ?? null)
const perFloor = ref<number | null>(0)
const totalArea = ref<number | null>(props.initial?.totalArea ?? null)
const rentableArea = ref<number | null>(props.initial?.rentableArea ?? null)
// BuildingDTO 不含 remark,编辑态初值留空(留空提交即清空原备注)
const remark = ref('')
const statusLabel = ref(props.initial?.status === 0 ? '停用' : '启用')
const err = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
onMounted(() => inputRef.value?.focus())

function submit() {
  const v = name.value.trim()
  if (!v) { err.value = '请输入楼栋名称'; return }
  if (props.existingNames.includes(v) && v !== props.initial?.name) { err.value = '已存在同名楼栋'; return }
  if (!phase.value || phase.value <= 0) { err.value = '期数需为大于 0 的数字'; return }
  if (!floorCount.value || floorCount.value <= 0) { err.value = '层数需为大于 0 的数字'; return }
  if (!isEdit && (typeof perFloor.value !== 'number' || perFloor.value < 0)) { err.value = '每层单元数需为不小于 0 的数字(0=不生成)'; return }
  if (!totalArea.value || totalArea.value <= 0) { err.value = '总面积需为大于 0 的数字'; return }
  if (!rentableArea.value || rentableArea.value <= 0) { err.value = '可租面积需为大于 0 的数字'; return }
  if (rentableArea.value > totalArea.value) { err.value = '可租面积不能大于总面积'; return }
  const base = {
    name: v, phase: phase.value, floorCount: floorCount.value,
    totalArea: totalArea.value, rentableArea: rentableArea.value,
    remark: remark.value.trim() || undefined, zone: zone.value || null,
  }
  if (isEdit) emit('update', { ...base, status: statusLabel.value === '停用' ? 0 : 1 })
  else emit('create', { ...base, perFloor: perFloor.value! })
}
</script>

<template>
  <Teleport to="body">
    <!-- 编辑态从楼栋抽屉(FPDrawer 300/301)的页脚按钮打开,须压过抽屉 → 升一档 --z-modal-2 -->
    <div class="lg-dlg-mask" :class="{ nested: isEdit }" @click="emit('close')">
      <div class="lg-dlg" @click.stop>
        <div class="lg-dlg-h">
          <h3>{{ isEdit ? '编辑楼栋' : '新建楼栋' }}</h3>
          <p v-if="isEdit">修改楼栋基础信息与状态。单元仅在创建时生成,编辑不会增删单元。</p>
          <p v-else>录入楼栋基础资产信息。填写「每层单元数」后将按 层数 × 每层单元数 自动生成单元,面积按可租面积均摊。</p>
        </div>
        <div class="lg-dlg-b">
          <div class="lg-dlg-lab">楼栋名称</div>
          <input ref="inputRef" class="lg-dlg-in" :class="{ err }" v-model="name"
                 placeholder="如:三期 G 栋"
                 @input="err = ''" @keydown.enter="submit" />
          <div class="bnd-grid">
            <div>
              <div class="lg-dlg-lab">期数</div>
              <input class="lg-dlg-in" type="number" min="1" v-model.number="phase"
                     @input="err = ''" @keydown.enter="submit" />
            </div>
            <div>
              <Select v-model="zone" label="期区" :options="zoneOpts" size="sm"
                      title="期区决定这栋楼的电表、公摊池、损耗归到哪一期。与「期数」不是一回事——宿舍楼期数是 1 但期区是宿舍" />
            </div>
            <div>
              <div class="lg-dlg-lab">层数</div>
              <input class="lg-dlg-in" type="number" min="1" v-model.number="floorCount"
                     placeholder="如:5" @input="err = ''" @keydown.enter="submit" />
            </div>
            <div v-if="!isEdit">
              <div class="lg-dlg-lab">每层单元数</div>
              <input class="lg-dlg-in" type="number" min="0" v-model.number="perFloor"
                     placeholder="0=不生成" @input="err = ''" @keydown.enter="submit" />
            </div>
            <div v-else>
              <div class="lg-dlg-lab">状态</div>
              <Select :options="['启用', '停用']" v-model="statusLabel" />
            </div>
            <div>
              <div class="lg-dlg-lab">总面积 ㎡</div>
              <input class="lg-dlg-in" type="number" min="0" v-model.number="totalArea"
                     placeholder="如:6000" @input="err = ''" @keydown.enter="submit" />
            </div>
            <div>
              <div class="lg-dlg-lab">可租面积 ㎡</div>
              <input class="lg-dlg-in" type="number" min="0" v-model.number="rentableArea"
                     placeholder="如:5600" @input="err = ''" @keydown.enter="submit" />
            </div>
            <div>
              <div class="lg-dlg-lab">备注(可选)</div>
              <input class="lg-dlg-in" v-model="remark" :placeholder="isEdit ? '选填,留空将清空原备注' : '选填'"
                     @input="err = ''" @keydown.enter="submit" />
            </div>
          </div>
          <div class="lg-dlg-erm">{{ err }}</div>
        </div>
        <div class="lg-dlg-f">
          <Button variant="gray" size="sm" @click="emit('close')">取消</Button>
          <Button variant="filled" size="sm" @click="submit">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            {{ isEdit ? '保存' : '创建' }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 1:1 from ledger/LedgerNewCompanyDialog.vue */
.lg-dlg-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:var(--z-modal); display:grid; place-items:center; opacity:0; animation:fp-fade-in var(--dur-base) forwards; }
/* 嵌套态(编辑楼栋从抽屉里打开)升一档,与同场景的 ContractNewDialog .ct-mask 同档。
   层级是结构问题不是实例问题,故用 class 切档,不用内联 :style 打补丁(见 PAGE-BEHAVIOR-SPEC §3)。
   与 BuildingDrawer 的 .bd-mask(同 320)不会同屏:那三个小弹窗都由抽屉内按钮触发,
   而任一遮罩铺开后抽屉页脚的「编辑楼栋」已点不到,两者互斥;真同屏也由 DOM 后序取胜。 */
.lg-dlg-mask.nested { z-index:var(--z-modal-2); }
.lg-dlg { width:min(480px,90vw); background:var(--surface-white); border-radius:var(--radius-xl); box-shadow:0 16px 48px rgba(28,28,28,.22);
  overflow:hidden; animation:fp-rise-in var(--dur-base) var(--ease-standard) both; }
.lg-dlg-h { padding:20px 22px 0; }
.lg-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.lg-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.lg-dlg-b { padding:18px 22px 4px; }
.lg-dlg-lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
.lg-dlg-in { width:100%; box-sizing:border-box; height:40px; padding:0 12px; font-size:13.5px; color:var(--text-primary);
  border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white);
  font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.lg-dlg-in:focus { border-color:var(--hue-blue); }
.lg-dlg-in.err { border-color:var(--hue-red); }
.lg-dlg-erm { font-size:11.5px; color:var(--hue-red); margin-top:6px; min-height:14px; }
.lg-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
.bnd-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-top:12px; }
</style>
