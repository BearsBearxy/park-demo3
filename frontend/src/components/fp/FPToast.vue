<script setup lang="ts">
/**
 * FPToast — 短暂反馈提示。**唯一合规的「操作成功/失败」反馈载体。**
 *
 * 立件起因（2026-08-22）：全站 5 处「保存成功」绿条写成**流内** `<div v-if="okMsg">`，
 * 一进一出把下面整块内容顶两次 —— LAYOUT-STABILITY-SPEC §4 明判 ❌，
 * 已登记在 noInteractionLayoutShift.spec.ts 的 KNOWN_DEBT 里。本组件收编那 5 处。
 *
 * 为什么是浮层而不是流内条：规范 §2 的做法优先级是
 *   1 不加 > 2 浮层 > 3 预留位 > 4 流内条（流内条只许出现在首屏加载期）。
 * toast 属于「交互触发」，只能走 2。
 *
 * 为什么贴**底部**：屏幕/卡片顶部已经被「生成告警」这类 .pl-float 占着（那是要读的清单，
 * 不是短暂反馈）。一上一下各司其职，两者同时出现也不会叠在一起。
 * jfen 原始文档也写着 "Toast appear at the bottom." / "Recedes from the bottom"。
 *
 * 视觉规格 = jfen Figma 的 Toast 组件（Dev Mode 实测：Height Hug 36 / Radius 16 /
 * Padding 8·12·8·12 / Gap 8 / Colors Black-80%）。**语气只由图标区分，底色恒定深色** ——
 * 这与本仓已有的 AppShell `.fp-net-toast`（--ink-900 深底白字）是同一套语言。
 * 首版曾沿用被收编那 5 处绿条的浅色语义底，属偏离设计系统，2026-08-22 按设计稿纠正。
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { iconFor } from '@/components/ds/icon'

const props = withDefaults(defineProps<{
  /** 消息文本，空串 = 不显示。用 v-model 绑定，自动消失时组件会把它置空 */
  modelValue: string
  tone?: 'success' | 'info' | 'warning' | 'error'
  /** card = 贴宿主容器底部（**宿主必须 position:relative**）；page = 贴屏幕底部居中 */
  placement?: 'card' | 'page'
  /** 自动消失毫秒数，0 = 不自动关（错误提示常用 0，让用户自己读完关掉） */
  duration?: number
}>(), { tone: 'success', placement: 'card', duration: 3000 })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// 图标走 fill 实心（CSS 覆盖 lucide 根 svg 的 fill="none"，子 path 继承）：
// 绿实心圆 + 白勾 / 黄实心三角 + 深色感叹号 —— 语气**只由图标区分**，底色恒定深色。
const ICONS = { success: 'check-circle-2', info: 'info', warning: 'alert-triangle', error: 'x-circle' } as const

let timer: ReturnType<typeof setTimeout> | null = null
const clear = () => { if (timer) { clearTimeout(timer); timer = null } }

// 换一条新消息要重置计时 —— 否则第二条会继承第一条剩下的时间，一闪就没
watch(() => props.modelValue, (msg) => {
  clear()
  if (msg && props.duration > 0) timer = setTimeout(() => emit('update:modelValue', ''), props.duration)
}, { immediate: true })

onBeforeUnmount(clear)

function close() { clear(); emit('update:modelValue', '') }
</script>

<template>
  <Transition name="fpt">
    <div v-if="modelValue" :class="['fpt', `fpt--${tone}`, `fpt--${placement}`]" role="status" aria-live="polite">
      <component :is="iconFor(ICONS[tone])" :size="20" class="fpt-i" />
      <span class="fpt-m">{{ modelValue }}</span>
      <!-- 设计稿无关闭按钮（toast 一律自动消失）。duration=0 是本仓的扩展用法
           （错误提示让用户读完再关），那种情况下不给按钮就永远关不掉，故只在此时渲染。 -->
      <button v-if="duration === 0" class="fpt-x" type="button" aria-label="关闭" @click="close">
        <component :is="iconFor('x')" :size="14" />
      </button>
    </div>
  </Transition>
</template>

<style scoped>
/* 居中胶囊，不是横条 —— 横条读起来像 banner(要持续读的信息)，toast 是一闪而过的反馈。
   left/right/margin:auto 而非 transform:translateX(-50%)：transform 会和进场动画的
   translateY 打架，要写成一条 transform 才行，不如交给 margin 居中。 */
.fpt {
  position: absolute;
  left: 0; right: 0; bottom: 12px;
  width: fit-content;
  max-width: min(560px, 90%);
  margin: 0 auto;
  z-index: var(--z-popover);

  /* jfen Toast 规格（Figma Dev Mode 实测）：
     Height Hug 36 · Radius 16 · Padding 8/12/8/12 · Gap 8 · Colors Black/80%
     36 = 8(上) + 20(图标与行高) + 8(下)；87(「Done」态宽) = 12 + 20 + 8 + 35 + 12。
     Black/80% 在本仓的语言里就是 --ink-700 = rgba(28,28,28,.8)
     —— 近黑而非纯黑 #000（readme「never pure #000 for body」）。 */
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  background: var(--ink-700);
  color: var(--text-on-solid);
  box-shadow: 0 12px 32px rgba(28, 28, 28, .32);
  font-family: var(--font-sans);
  /* 设计稿的字号落在 13px，但 13 不在字号阶梯里（UI-CONSISTENCY-SPEC §2 禁阶梯外/禁小数）。
     取 --fs-body(14px)：行高 20px 正好凑满 36px 高，总宽也回到设计稿的 87px。 */
  font-size: var(--fs-body);
  line-height: 20px;
}

/* page = 贴屏幕底部。--z-toast 是最高档，不被任何弹窗遮挡（DESIGN-FIDELITY §八）。
   与 AppShell 的 .fp-net-toast 同一个 bottom:28px 与同一套深色语言，两者同时出现不打架。 */
.fpt--page { position: fixed; bottom: 28px; z-index: var(--z-toast); }

.fpt-i { flex: 0 0 auto; }
.fpt-m { min-width: 0; overflow-wrap: anywhere; }

.fpt-x {
  flex: 0 0 auto;
  display: inline-grid; place-items: center;
  width: 20px; height: 20px;
  border: none; background: none; border-radius: var(--radius-full);
  color: inherit; opacity: .65; cursor: pointer;
}
.fpt-x:hover { opacity: 1; background: rgba(255, 255, 255, .14); }

/* 语气只由图标区分，底色恒定 —— 这是与 jfen 设计稿一致的地方，也是与旧版浅色语义底最大的差别。
   CSS 的 fill 会覆盖 lucide 根 svg 的 presentation attribute fill="none"（作者样式表优先级更高），
   子 path 无自身 fill 故继承；stroke 仍是 currentColor，由下面的 color 控制。

   ⚠ **深底上不能直接用 --hue-***：那几个是为**白底**调的
   （--hue-green 注释写着「对白底 4.05:1」；--hue-orange 2026-08-20 还专门从 0.70 压暗到 0.54，
   好让白底上的白字与边框更清楚）。压暗后放到 Black/80% 底（合成后 rgb(73,73,73)）上，
   canvas 实测对比度 green 2.21 / red 1.79 / blue 1.85 —— 全部不过 WCAG SC 1.4.11 的
   图形元素 3:1，info 那档几乎与底色同亮度、等于看不见。
   故按同色相把 L 提到 ~0.72–0.78 另取一组；--hue-yellow 本就亮（实测 4.75）直接引用。
   ⚠ 将来做暗色模式时，这组应提升为全局的「深底语义色」令牌，届时把这里换掉。 */
.fpt {
  --fpt-success: oklch(0.78 0.150 150);
  --fpt-warning: var(--hue-yellow);
  --fpt-error:   oklch(0.72 0.160 27);
  --fpt-info:    oklch(0.74 0.120 250);
}
.fpt--success .fpt-i { fill: var(--fpt-success); color: var(--ink-900); }
.fpt--warning .fpt-i { fill: var(--fpt-warning); color: var(--ink-900); }
.fpt--error   .fpt-i { fill: var(--fpt-error);   color: var(--ink-900); }
.fpt--info    .fpt-i { fill: var(--fpt-info);    color: var(--ink-900); }

/* 只动 opacity/transform，不动尺寸 —— 进出场都不得引起任何重排 */
.fpt-enter-active, .fpt-leave-active { transition: opacity .18s ease, transform .18s ease; }
.fpt-enter-from, .fpt-leave-to { opacity: 0; transform: translateY(6px); }
</style>
