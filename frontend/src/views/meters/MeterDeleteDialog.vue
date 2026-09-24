<script setup lang="ts">
// 删除表的确认框(用户 2026-09-24「为什么删除南盛物流要去计费参数重新生成」):
// 先问后端这块表被什么挡着(delete-impact),再说能不能删、怎么删 ——
//   有读数 / 在公摊池里:删不了,说去哪处理;
//   只在草稿 / 已作废的催缴单里:列出这几张单,勾「同时删掉」才能删(连单一起删,那几个月显示需重算);
//   在已确认 / 已导出 / 已签发的单里:列出来,先到催缴单屏作废。删单要出账运行权限,没有就不给勾。
// 真正的删由抽屉传进来的 run 做(同 MeterAssignDialog):删到一半本框被外面强制关掉(编辑态转假、换表、
// 切走页签)时,抽屉还在,删完照样刷新列表、关抽屉。
import { ref, computed, onMounted } from 'vue'
import { metersApi, type MeterDeleteImpactDTO } from '@/api/meters'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ds/Button.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'

const props = defineProps<{
  edit: boolean
  meterId: number
  meterName: string
  run: (dropDraftNotices: boolean) => Promise<unknown>
}>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const canDrop = computed(() => auth.can('billing-run:edit'))
const STATUS: Record<string, string> = { draft: '草稿', void: '已作废', confirmed: '已确认', exported: '已导出', issued: '已签发' }
const isOpen = (s: string) => s === 'draft' || s === 'void'
// 勾选项原文:后端没勾时的 409 逐字引用它(MeterService.delete)
const kinds = computed(() => (imp.value?.notices.some(n => n.status === 'void') ? '草稿/已作废' : '草稿'))

const imp = ref<MeterDeleteImpactDTO | null>(null)
const impErr = ref('')          // 只在成功分支清
async function load() {
  try {
    imp.value = await metersApi.deleteImpact(props.meterId)
    impErr.value = ''
  } catch (e) {
    impErr.value = (e as { message?: string })?.message ?? '没查出这块表挂在哪些单里，请重试'
  }
}
onMounted(load)

const blocked = computed(() => !!imp.value && (imp.value.readings > 0 || imp.value.poolBindings.length > 0))
const tick = ref(false)
const busy = ref(false)
const err = ref('')             // 只在成功分支清(成功后抽屉关框)
const canConfirm = computed(() => {
  const i = imp.value
  if (!props.edit || !i || blocked.value || i.lockedCount > 0 || busy.value) return false
  return i.draftCount === 0 || (canDrop.value && tick.value)
})

// 删除途中不许取消:删成什么样得看得到(失败要留在框里说原因)
function close() { if (!busy.value) emit('close') }
async function confirm() {
  if (!props.edit) return
  if (!canConfirm.value) return
  busy.value = true
  try {
    await props.run(tick.value)
    err.value = ''
  } catch (e) {
    err.value = (e as { message?: string })?.message ?? '删除失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <FPDrawer open title="删除表" :subtitle="meterName" icon="trash-2" :width="520" tier="modal-2" @close="close">
    <p v-if="!imp && !impErr" class="dd-hint">正在查这块表挂在哪些单里…</p>
    <template v-else-if="imp">
      <template v-if="blocked">
        <p v-if="imp.readings > 0" class="dd-lk">
          这块表有 {{ imp.readings }} 条读数,不能删(历史账要保留)。不再用了请在「档案变更」的「在册状态」里加一行已拆或停用,之前的月份不受影响。
        </p>
        <p v-if="imp.poolBindings.length" class="dd-lk">
          这块表在公摊池「{{ imp.poolBindings.join('、') }}」里,不能删。请先到公共电核算把它从池成员中解绑。
        </p>
      </template>
      <p v-else-if="!imp.notices.length" class="dd-line">删掉「{{ meterName }}」?删了不能恢复。</p>
      <template v-else>
        <p class="dd-line">这块表还在 {{ imp.notices.length }} 张催缴单里:</p>
        <ul class="dd-list">
          <li v-for="n in imp.notices" :key="n.noticeId" :class="{ lk: !isOpen(n.status) }">
            {{ n.ym }} · {{ n.tenantName ?? '—' }} · {{ STATUS[n.status] ?? n.status }} {{ n.lines }} 行
          </li>
        </ul>
        <p v-if="imp.lockedCount > 0" class="dd-lk">
          其中 {{ imp.lockedCount }} 张已确认、已导出或已签发,不能跟着删。先到催缴单屏作废这些单,再回来删这块表。
        </p>
        <label v-else-if="canDrop" class="dd-ck">
          <input v-model="tick" type="checkbox" >
          <span>同时删掉这 {{ imp.draftCount }} 张{{ kinds }}催缴单(这几个月会显示需重算,重算后按现在的读数重出)</span>
        </label>
        <p v-else class="dd-lk">删这些草稿单要有「出账运行」权限。请有这项权限的同事来删这块表。</p>
      </template>
    </template>

    <!-- 影响没查出来 / 删除失败:一行常驻,出错不把下面的按钮顶走 -->
    <p class="dd-err">
      <template v-if="impErr || err">{{ [impErr, err].filter(Boolean).join(' ') }}</template>
      <Button v-if="impErr" variant="outline" size="sm" @click="load">重试</Button>
    </p>

    <template #footer>
      <Button variant="gray" size="sm" :disabled="busy" @click="close">取消</Button>
      <Button variant="danger" size="sm" :disabled="!canConfirm" @click="confirm">删除</Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
.dd-line { margin: 0; font-size: var(--fs-body); color: var(--text-primary); overflow-wrap: anywhere; }
.dd-hint { margin: 0; font-size: var(--fs-label); color: var(--text-secondary); }
.dd-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-label); color: var(--text-secondary); overflow-wrap: anywhere; }
.dd-list li.lk { color: var(--caution-text); }
.dd-lk { margin: 0; font-size: var(--fs-label); color: var(--caution-text); overflow-wrap: anywhere; }
.dd-ck { display: flex; align-items: flex-start; gap: 8px; font-size: var(--fs-label); color: var(--text-primary); cursor: pointer; overflow-wrap: anywhere; }
.dd-ck input { margin-top: 2px; flex: 0 0 auto; }
.dd-err { margin: 0; min-height: 18px; line-height: 18px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: var(--fs-label); color: var(--hue-red); overflow-wrap: anywhere; }
</style>
