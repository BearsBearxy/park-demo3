<script setup lang="ts">
// 确认弹窗宿主(十件 ⑨,画布 02-A / 02-B / 06-B ⑨):挂在 AppShell,画 ask() 队头那一条。
// 居中 440;标题是问句,正文给数(数字加粗),主按钮写动作本身。
// danger:主按钮红、默认焦点在「取消」;否则焦点在主按钮。Esc、点外面 = 取消(只关自己,不连带底下的抽屉)。
// 层级 --z-confirm:导入窗、抽屉里也会问,要盖住一切弹窗。
import { computed, nextTick, ref, watch, onBeforeUnmount, type ComponentPublicInstance } from 'vue'
import Button from '@/components/ds/Button.vue'
import { askQueue, answer } from '@/utils/ask'

const cur = computed(() => askQueue[0] ?? null)
// 正文里的数单独拎出来加粗(稿 02-A「这页有 3 处」、02-B「共 76 条」):奇数位是数
const parts = computed(() => (cur.value?.body ?? '').split(/(\d[\d,.]*)/))

const cancelBtn = ref<ComponentPublicInstance | null>(null)
const actBtn = ref<ComponentPublicInstance | null>(null)
let back: HTMLElement | null = null

// 挂 window 的捕获阶段:ds/Popover 的 Esc 监听挂在 document 捕获,同节点上 stopPropagation 拦不住它;
// window 捕获比 document 早一站,在这里拦下,底下开着的菜单 / 抽屉才不会跟着一起关
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  answer(false)
}

watch(cur, async (c, prev) => {
  if (c && !prev) {
    back = document.activeElement as HTMLElement | null
    window.addEventListener('keydown', onKey, true)
  } else if (!c && prev) {
    window.removeEventListener('keydown', onKey, true)
    back?.focus?.()
    back = null
  }
  if (!c) return
  await nextTick()
  ;((c.danger ? cancelBtn : actBtn).value?.$el as HTMLElement | undefined)?.focus()
})

// 外壳卸载(退出登录)时还在等的一律按「取消」答掉,不留永远不落地的 Promise
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  while (askQueue.length) answer(false)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fch">
      <div v-if="cur" class="fch-scrim" @mousedown.self="answer(false)">
        <div class="fch-card" role="alertdialog" aria-modal="true" aria-labelledby="fch-t"
             :aria-describedby="cur.body ? 'fch-b' : undefined">
          <h3 id="fch-t" class="fch-t">{{ cur.title }}</h3>
          <p v-if="cur.body" id="fch-b" class="fch-b"><template v-for="(p, i) in parts" :key="i"><b v-if="i % 2">{{ p }}</b><template v-else>{{ p }}</template></template></p>
          <div class="fch-f">
            <Button ref="cancelBtn" variant="outline" @click="answer(false)">{{ cur.cancel ?? '取消' }}</Button>
            <Button ref="actBtn" :variant="cur.danger ? 'danger' : 'filled'" @click="answer(true)">{{ cur.action }}</Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fch-scrim {
  position: fixed; inset: 0;
  z-index: var(--z-confirm);
  background: var(--scrim);
  display: grid; place-items: center;
  padding: 16px;
}
.fch-card {
  width: min(440px, 100%);
  box-sizing: border-box;
  padding: 24px;
  background: var(--surface-raised);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-dialog);
  font-family: var(--font-sans);
  animation: fp-rise-in var(--dur-base) var(--ease-out) both;
}
.fch-t { margin: 0; font-size: var(--fs-h3); line-height: 24px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.fch-b { margin: 8px 0 0; font-size: var(--fs-body); line-height: 20px; color: var(--text-secondary); }
.fch-b b { font-weight: var(--fw-semibold); color: var(--text-primary); }
.fch-f { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }

.fch-enter-active { transition: opacity var(--dur-base) var(--ease-out); }
.fch-leave-active { transition: opacity var(--dur-fast) var(--ease-standard); }
.fch-enter-from, .fch-leave-to { opacity: 0; }
</style>
