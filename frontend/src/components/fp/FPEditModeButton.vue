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
}>(), { heldByOther: null, canEnter: true, disabled: false })

defineEmits<{ toggle: [] }>()

const held = computed(() => (props.edit ? null : props.heldByOther))
const idleMin = computed(() => Math.floor((held.value?.idleMs ?? 0) / 60000))
</script>

<template>
  <Button
    v-if="canEnter"
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
