<script setup lang="ts">
// 本版重点卡:「本次更新」弹窗与「更新记录」共用这一张(VERSION-UPDATE-SPEC §2 / §4)。
// 右边的配图按版本取(./art.ts),每版一张、不互相覆盖 —— 关掉弹窗后在更新记录里还看得到。
// 没登记配图的版本只出文字。
import { computed } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { iconFor } from '@/components/ds/icon'
import type { ReleaseNote } from '@/types/changelog'
import { RELEASE_ART } from './art'

const props = defineProps<{ note: ReleaseNote; linkable: boolean }>()
defineEmits<{ go: [] }>()
const art = computed(() => RELEASE_ART[props.note.version])
</script>

<template>
  <section v-if="note.feature" class="rfc">
    <div class="rfc-tx">
      <div class="rfc-top">
        <span class="rfc-ic"><component :is="iconFor(note.feature.icon)" :size="16" /></span>
        <span class="rfc-chip">新增</span>
      </div>
      <h3>{{ note.feature.title }}</h3>
      <p>{{ note.feature.desc }}</p>
      <button v-if="note.feature.to && linkable" type="button" class="rfc-lnk" @click="$emit('go')">
        {{ note.feature.toLabel ?? '去看看' }}<ChevronRight :size="12" />
      </button>
    </div>
    <!-- 配图:静态示意,不接数据;宽 200、内宽 178(RELEASE-NOTES-SPEC §5) -->
    <div v-if="art" class="rfc-pic" aria-hidden="true"><component :is="art" /></div>
  </section>
</template>

<style scoped>
.rfc {
  display: flex; gap: 16px; padding: 16px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-card);
}
.rfc-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
.rfc-top { display: flex; align-items: center; gap: 8px; }
.rfc-ic {
  width: 30px; height: 30px; flex: 0 0 auto; border-radius: var(--radius-sm);
  display: grid; place-items: center; color: var(--text-secondary);
  background: var(--surface-white); border: 1px solid var(--border-subtle);
}
.rfc-chip {
  display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: var(--radius-full);
  font-size: var(--fs-micro); font-weight: var(--fw-semibold); color: var(--hue-blue); background: var(--accent-blue);
}
.rfc h3 { margin: 10px 0 0; font-size: var(--fs-h3); font-weight: var(--fw-semibold); }
.rfc p { margin: 4px 0 0; font-size: var(--fs-label); line-height: 18px; color: var(--text-muted); }
.rfc-lnk {
  display: inline-flex; align-items: center; gap: 1px; margin-top: auto; padding: 10px 0 0;
  border: none; background: transparent; cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-link);
}
.rfc-pic {
  flex: 0 0 200px; align-self: stretch; padding: 10px; display: flex; flex-direction: column; gap: 6px;
  background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: 10px;
}
/* S 档:上下排 */
@media (max-width: 600px) {
  .rfc { flex-direction: column; }
  .rfc-pic { flex: 0 0 auto; align-self: stretch; }
}
</style>
