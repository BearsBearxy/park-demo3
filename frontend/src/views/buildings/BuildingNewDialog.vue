<script setup lang="ts">
// 新建楼栋弹窗 — 样式 1:1 参考 ledger/LedgerNewCompanyDialog.vue
import { ref, onMounted } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import type { BuildingCreateReq } from '@/types/building'

const props = defineProps<{ existingNames: string[] }>()
const emit = defineEmits<{ close: []; create: [req: BuildingCreateReq] }>()

const name = ref('')
const phase = ref<number | null>(1)
const floorCount = ref<number | null>(null)
const perFloor = ref<number | null>(0)
const totalArea = ref<number | null>(null)
const rentableArea = ref<number | null>(null)
const remark = ref('')
const err = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
onMounted(() => inputRef.value?.focus())

function submit() {
  const v = name.value.trim()
  if (!v) { err.value = '请输入楼栋名称'; return }
  if (props.existingNames.includes(v)) { err.value = '已存在同名楼栋'; return }
  if (!phase.value || phase.value <= 0) { err.value = '期数需为大于 0 的数字'; return }
  if (!floorCount.value || floorCount.value <= 0) { err.value = '层数需为大于 0 的数字'; return }
  if (typeof perFloor.value !== 'number' || perFloor.value < 0) { err.value = '每层单元数需为不小于 0 的数字(0=不生成)'; return }
  if (!totalArea.value || totalArea.value <= 0) { err.value = '总面积需为大于 0 的数字'; return }
  if (!rentableArea.value || rentableArea.value <= 0) { err.value = '可租面积需为大于 0 的数字'; return }
  if (rentableArea.value > totalArea.value) { err.value = '可租面积不能大于总面积'; return }
  emit('create', {
    name: v, phase: phase.value, floorCount: floorCount.value,
    totalArea: totalArea.value, rentableArea: rentableArea.value,
    perFloor: perFloor.value, remark: remark.value.trim() || undefined,
  })
}
</script>

<template>
  <Teleport to="body">
    <div class="lg-dlg-mask" @click="emit('close')">
      <div class="lg-dlg" @click.stop>
        <div class="lg-dlg-h">
          <h3>新建楼栋</h3>
          <p>录入楼栋基础资产信息。填写「每层单元数」后将按 层数 × 每层单元数 自动生成单元,面积按可租面积均摊。</p>
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
              <div class="lg-dlg-lab">层数</div>
              <input class="lg-dlg-in" type="number" min="1" v-model.number="floorCount"
                     placeholder="如:5" @input="err = ''" @keydown.enter="submit" />
            </div>
            <div>
              <div class="lg-dlg-lab">每层单元数</div>
              <input class="lg-dlg-in" type="number" min="0" v-model.number="perFloor"
                     placeholder="0=不生成" @input="err = ''" @keydown.enter="submit" />
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
              <input class="lg-dlg-in" v-model="remark" placeholder="选填"
                     @input="err = ''" @keydown.enter="submit" />
            </div>
          </div>
          <div class="lg-dlg-erm">{{ err }}</div>
        </div>
        <div class="lg-dlg-f">
          <Button variant="gray" size="sm" @click="emit('close')">取消</Button>
          <Button variant="filled" size="sm" @click="submit">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            创建
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 1:1 from ledger/LedgerNewCompanyDialog.vue */
.lg-dlg-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:80; display:grid; place-items:center; opacity:0; animation:lgfade .16s forwards; }
@keyframes lgfade { to { opacity:1; } }
.lg-dlg { width:min(480px,90vw); background:var(--surface-white); border-radius:var(--radius-xl); box-shadow:0 16px 48px rgba(28,28,28,.22);
  overflow:hidden; animation:lgrise .2s var(--ease-standard) both; }
@keyframes lgrise { from { opacity:0; transform:translateY(10px) scale(.99); } to { opacity:1; transform:translateY(0) scale(1); } }
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
