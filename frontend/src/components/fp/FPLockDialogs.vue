<script setup lang="ts">
/**
 * 编辑锁的两个弹窗:被别人占着时的**接管抽屉**、编辑中被踢时的**失锁提示**。
 *
 * 为什么是一个共享件而不是每屏各挂两个:2026-08-30 的阶段性验收查出 7 个屏
 * 两个都没挂 —— 病根正是「每屏各接一遍,漏了没人发现」。各挂两个就是把同一个病根再种七回。
 *
 * 不含 FPElevateDialog:那个 7 屏各自都有且工作正常,不去搅动能用的代码。
 * 不含 dirtyCount/copyText:四个有草稿态的屏序列化各不相同,单独立项(spec §4.2)。
 */
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'
import type { LockHolder, Eviction } from '@/api/locks'

defineProps<{
  /** 来自 useEditMode。非空 = 锁被别人占着 → 接管抽屉自动开 */
  lockedBy: LockHolder | null
  /** 来自 useEditMode。非空 = 本屏刚被接管 → 失锁弹窗自动开 */
  evictedBy: Eviction | null
  /** 来自 useEditMode 的 lockScope()。**原样透传** —— 共占锁的 scopeNote 靠它 */
  scope: string | null
  /** 给人看的一句话,如「公共电核算 2024-02」。取本屏 FPElevateDialog 的 :page 措辞 */
  what: string
}>()

defineEmits<{ taken: []; 'close-takeover': []; 'close-evicted': [] }>()
</script>

<template>
  <FPTakeoverDrawer :holder="lockedBy" :scope="scope ?? ''" :what="what"
                    @close="$emit('close-takeover')" @taken="$emit('taken')" />
  <FPEvictedDialog :eviction="evictedBy" :what="what"
                   @close="$emit('close-evicted')" />
</template>
