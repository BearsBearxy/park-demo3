<script setup lang="ts">
// 公司下拉(画布 09 ReportIS / ReportPickEmpty / ReportStates)—— 三大报表的公司选择,取代左栏
// (BOOK-WORKBENCH-SPEC §7-2 三大报表例外)。同一颗挂两处:期间条「‹ 换期 年-月 [公司 ▾]」与选期矩阵标题
// 「利润表 • [公司 ▾]」。面板:全部汇总(N 家)、各公司(当前打勾);底部「新增公司 / 重命名 / 删除(红)」各看各的权限
// (RBAC v4:新增 / 删除 = canAddDel「月度台账 · 新增删除公司」,重命名 = canRename「催缴单 · 收款公司」;一项都没有不出这一栏),
// 后两颗作用于当前打勾那家,停在「全部汇总」时置灰不挪位。
// 编辑中(locked)只写公司名、不给下拉 —— 换公司会丢草稿,稿上编辑态那一格是纯文字。
// 浮层规矩照抄 FPMoreMenu:点外关走 document capture(带 open 守卫),Esc 只关自己不冒泡。
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{
  companies: { id: number | string; name: string }[]
  current: number | 'all' | null
  /** 新增 / 删除公司 */
  canAddDel: boolean
  /** 重命名公司 */
  canRename: boolean
  /** 编辑中:只写名字 */
  locked?: boolean
  /** lg = 矩阵标题那一档(跟 h2 同行) */
  size?: 'sm' | 'lg'
}>()
const emit = defineEmits<{ pick: [id: number | 'all']; add: []; rename: []; remove: [] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const name = computed(() => props.current === 'all'
  ? '全部汇总'
  : props.companies.find(c => c.id === props.current)?.name ?? '')

function onDocDown(e: MouseEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return
  e.stopPropagation()
  open.value = false
}
function unbind() {
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKey, true)
}
watch(open, (v) => {
  if (!v) return unbind()
  document.addEventListener('mousedown', onDocDown, true)
  document.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(unbind)

function pick(id: number | 'all') {
  open.value = false
  if (id !== props.current) emit('pick', id)
}
function act(e: 'add' | 'rename' | 'remove') {
  open.value = false
  if (e === 'add') emit('add')
  else if (e === 'rename') emit('rename')
  else emit('remove')
}
</script>

<template>
  <span v-if="locked" class="fcm-name" :class="size">{{ name }}</span>
  <div v-else ref="root" class="fcm" :class="size">
    <button type="button" class="fcm-btn" :class="{ on: open }" aria-haspopup="menu" :aria-expanded="open"
            @click="open = !open">
      <span class="fcm-cur">{{ name }}</span>
      <component :is="iconFor('chevron-down')" :size="size === 'lg' ? 14 : 12" class="fcm-dd" />
    </button>
    <div v-if="open" class="fcm-pop" role="menu">
      <button type="button" class="fcm-it" :class="{ on: current === 'all' }" role="menuitemradio"
              :aria-checked="current === 'all'" @click="pick('all')">
        <span class="fcm-l">全部汇总</span>
        <span class="fcm-n">{{ companies.length }} 家</span>
        <component :is="iconFor('check')" v-if="current === 'all'" :size="14" class="fcm-ck" />
      </button>
      <button v-for="c in companies" :key="c.id" type="button" class="fcm-it" :class="{ on: current === c.id }"
              role="menuitemradio" :aria-checked="current === c.id" @click="pick(c.id as number)">
        <span class="fcm-l">{{ c.name }}</span>
        <component :is="iconFor('check')" v-if="current === c.id" :size="14" class="fcm-ck" />
      </button>
      <div v-if="canAddDel || canRename" class="fcm-foot">
        <button v-if="canAddDel" type="button" class="fcm-a" @click="act('add')">新增公司</button>
        <button v-if="canRename" type="button" class="fcm-a" :disabled="current === 'all'" @click="act('rename')">重命名</button>
        <button v-if="canAddDel" type="button" class="fcm-a del" :disabled="current === 'all'" @click="act('remove')">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fcm { position: relative; flex: none; display: inline-flex; }
/* 胶囊:28 高 / radius-full / 描边,与 ds/Button sm 同高(期间条那一档);lg 跟 h2 同行 */
.fcm-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px 0 12px; box-sizing: border-box;
  border: 1px solid var(--border-control); border-radius: var(--radius-full);
  background: var(--surface-white); cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); font-weight: var(--fw-semibold);
  color: var(--text-primary); white-space: nowrap;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.fcm-btn:hover, .fcm-btn.on { border-color: var(--border-control-strong); }
.fcm.lg .fcm-btn { height: 32px; padding: 0 12px 0 14px; font-size: var(--fs-h4); }
.fcm-dd { flex: none; color: var(--text-muted); }
.fcm-name { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; }
.fcm-name.lg { font-size: var(--fs-h4); }

.fcm-pop {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: var(--z-popover);
  width: 248px; padding: 6px; box-sizing: border-box;
  background: var(--surface-white); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md); box-shadow: var(--shadow-pop);
  display: flex; flex-direction: column; gap: 1px;
  animation: fp-pop-in var(--dur-fast) var(--ease-out);
}
.fcm-it {
  display: flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 10px; box-sizing: border-box;
  border: none; border-radius: var(--radius-sm); background: transparent; cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-body); color: var(--text-secondary); text-align: left;
}
.fcm-it:hover { background: var(--surface-sunken); color: var(--text-primary); }
.fcm-it.on { background: var(--surface-sunken); color: var(--text-primary); font-weight: var(--fw-semibold); }
.fcm-l { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fcm-n { flex: none; font-size: var(--fs-label); font-weight: var(--fw-regular); color: var(--text-muted); }
.fcm-ck { flex: none; color: var(--hue-blue); }
.fcm-foot {
  display: flex; align-items: center; gap: 14px;
  margin-top: 4px; padding: 8px 10px 4px; border-top: 1px solid var(--divider);
}
.fcm-a {
  padding: 0; border: none; background: transparent; cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); color: var(--hue-blue);
}
.fcm-a.del { color: var(--status-danger); }
.fcm-a:disabled { color: var(--text-disabled); cursor: default; }
</style>
