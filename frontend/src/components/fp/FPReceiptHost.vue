<script setup lang="ts">
// 结果回执的宿主(十件 ⑧,画布 02-C / 06-B ⑧):挂在 AppShell,照 utils/receipt 的队列画。
// 每条就是一个 FPToast(同一个深色胶囊、同一套图标语气、同一个计时:成功走它的默认 4 秒,
// 失败 tone=error 恒不自收),这里只管叠放:底部居中,旧的在上、新的在下,最多 3 条。
// 层级 --z-toast:弹窗里做完的动作,回执也要盖得住。
import { onBeforeUnmount } from 'vue'
import FPToast from './FPToast.vue'
import { receipts, receipt } from '@/utils/receipt'

const TONE = { ok: 'success', warn: 'warning', fail: 'error' } as const

// 外壳卸载(退出登录是 SPA 跳 /login,不刷新页面)时清空:队列是模块级的,不清的话没收掉的失败 / 警告回执
// 会在下一次登录(可能换了账号)原样冒出来,收藏回执的「撤销」还会删到新账号的收藏。同 FPConfirmHost 的清队
onBeforeUnmount(() => receipts.splice(0))
</script>

<template>
  <Teleport to="body">
    <!-- 常驻 live region:先有区域、后进内容,读屏才播得出来(失败 / 警告那条自己是 role=alert) -->
    <div class="frh" aria-live="polite">
      <TransitionGroup name="frh">
        <div v-for="r in receipts" :key="r.id" class="frh-i">
          <FPToast :model-value="r.text" :tone="TONE[r.tone]" placement="stack" :reset-key="r.n"
                   :duration="r.tone === 'warn' ? 0 : undefined" :retry-text="r.action?.label"
                   @retry="r.action?.run()" @update:model-value="receipt.dismiss(r.id)" />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
/* 整列不接点击,只有胶囊本身接 —— 列是满宽的,否则底部一条看不见的带子会吃掉下面的点击 */
.frh {
  position: fixed; left: 0; right: 0; bottom: 28px;
  z-index: var(--z-toast);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  pointer-events: none;
}
.frh-i { max-width: 90vw; pointer-events: auto; }

/* 进场同 FPToast:淡入 + 6px 上浮;出场只淡不动;其余几条让位时平移过去 */
.frh-enter-active { transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out); }
.frh-leave-active { transition: opacity var(--dur-fast) var(--ease-standard); }
.frh-enter-from { opacity: 0; transform: translateY(6px); }
.frh-leave-to { opacity: 0; }
.frh-move { transition: transform var(--dur-base) var(--ease-out); }

/* S 档抬到手机底栏之上(RESPONSIVE-LAYOUT §4.5),与原断网条同一个高度 */
@media (max-width: 600px) {
  .frh { bottom: calc(56px + 20px + env(safe-area-inset-bottom)); }
}
</style>
