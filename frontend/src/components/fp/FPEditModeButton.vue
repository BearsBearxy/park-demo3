<script setup lang="ts">
// 编辑模式按钮 —— **全站唯一的一份**（EDIT-MODE-SPEC §2 / CONCURRENCY-SPEC §4）。
//
// 立这个组件的原因，是一次真实的事故：九个屏各自复制了一份逐字相同的
// `<Button v-if="canEnter" :variant="editMode ? 'filled':'outline'">{{ editMode ? '完成':'编辑模式' }}</Button>`。
// 加编辑锁时只有两处跟着改了三态显示，其余七屏**锁真的挡住了、界面却一个字不变** ——
// 用户点下去没反应，按钮还写着「编辑模式」。比不加锁更糟：看起来像坏了。
//
// 锁位就长在这颗按钮上，不另加 chip —— 那是用户的手本来就要去的地方，
// 也是唯一需要知道锁在谁手上的时刻。四态**同宽**（min-width:150px），换文案不挪版。
import { computed } from 'vue'
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'
import type { LockHolder } from '@/api/locks'

const props = withDefaults(defineProps<{
  /** 当前是不是编辑态 */
  edit: boolean
  /**
   * 这一期此刻被**别人**占着（来自在场表，不用点就知道）。
   * 不传 = 这一屏没上锁，退化成加锁之前的两态按钮。
   */
  heldByOther?: LockHolder | null
  /** 按钮画不画。无写权限且不能请求提权的账号（只读 / 园区股东）传 false */
  canEnter?: boolean
  /** 保存中之类的临时禁用 */
  disabled?: boolean
  /**
   * 审核闸(SIDEBAR-UX-REDESIGN §7.5)的药丸文案,如「已审核 · 李审 03-05」。
   * 非空 = 按钮位换成**同尺寸**禁用药丸。来自 useEditMode 的 reviewNote,屏不要自己拼。
   */
  reviewNote?: string | null
  /** 药丸的 tooltip，如「撤销审核需审核员」。 */
  reviewTip?: string | null
}>(), { heldByOther: null, canEnter: true, disabled: false, reviewNote: null, reviewTip: null })

defineEmits<{ toggle: [] }>()

const held = computed(() => (props.edit ? null : props.heldByOther))
const idleMin = computed(() => Math.floor((held.value?.idleMs ?? 0) / 60000))
</script>

<template>
  <!-- 审核闸(§7.5):已审核 / 待审核时按钮位换成同尺寸禁用药丸。撤销要找审核员 —— tooltip 说的就是这句。
       与下面那颗 Button 同 min-width / 同高 —— 换的是内容不是版面(LAYOUT-STABILITY)。
       canEnter 为假(只读账号 / 园区股东)时两颗都不出:那种账号本来就没有编辑按钮,
       单给他看一句「已审核」是凭空多一条他用不上的信息。 -->
  <span v-if="canEnter && reviewNote" class="fp-emb fp-emb-rv" :title="reviewTip ?? undefined">
    <component :is="iconFor('lock')" :size="14" />{{ reviewNote }}
  </span>
  <Button
    v-else-if="canEnter"
    class="fp-emb"
    :class="{ held: !!held, idle: held?.idle }"
    :variant="edit ? 'filled' : 'outline'"
    size="sm"
    :disabled="disabled"
    @click="$emit('toggle')"
  >
    <template #leading>
      <span v-if="held" class="fp-emb-av" :class="{ dim: held.idle }">
        {{ held.displayName.slice(0, 1) }}
      </span>
      <component v-else :is="iconFor(edit ? 'check' : 'pencil')" :size="14" />
    </template>
    <template v-if="edit">完成</template>
    <template v-else-if="held">
      {{ held.displayName }} {{ held.idle ? `空闲 ${idleMin} 分` : '编辑中' }}
    </template>
    <template v-else>编辑模式</template>
  </Button>
</template>

<style scoped>
/* 四态同宽 —— 「编辑模式」/「张三 编辑中」/「张三 空闲 23 分」/「完成」换文案不挪版 */
.fp-emb { min-width: 150px; justify-content: center; }
/* 审核药丸:逐项对齐 ds/Button 的 size="sm"(height 28 / padding 0 12px / fs-label / radius-full),
   只是点不动。数字不是拍的 —— 见 Button.vue 的 SIZES.sm。 */
.fp-emb-rv {
  height: 28px; padding: 0 12px; box-sizing: border-box;
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-full);
  background: var(--bg-subtle); color: var(--text-muted);
  font-size: var(--fs-label); line-height: 1; white-space: nowrap; cursor: not-allowed;
}
/* 他人活跃占着:橙描边,一眼看出握在别人手上 */
.fp-emb.held {
  border-color: var(--hue-orange);
  background: rgb(252, 243, 232);
  color: var(--hue-orange);
}
/* 他人空闲 ≥20 分钟:同尺寸,只褪成灰 —— 「他在改」和「他人不在了」的接管门槛不一样 */
.fp-emb.held.idle {
  border-color: var(--border-strong);
  background: var(--surface-white);
  color: var(--text-muted);
}
.fp-emb-av {
  width: 18px; height: 18px; flex: 0 0 auto; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--fill-blue); color: #fff;
  font-size: 9.5px; font-weight: var(--fw-semibold);
}
.fp-emb-av.dim { opacity: .55; }
</style>
