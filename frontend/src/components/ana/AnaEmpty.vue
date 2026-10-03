<script setup lang="ts">
// 「数据待录入」统一空态卡(spec 通用降级规则②):说明缺什么、去哪录,深链到录入屏,不画假图。
// to 为路由路径(如 '/contracts');不传则纯提示(移植 ana-charts.jsx Empty 的语义)。
// 2026-10-01 外形换成 FPEmpty 的 sm 档(十件 ⑦,画布 06-D 右格):图标方块 + 一句 + 副句 + 一个钮。props 不变。
//
// 「去录入」按目标屏**所在层的可见性**显隐(§6):园区股东只有经营分析层,给他一条
// 「去台账录入」的链接,是把他引到一个侧边栏根本没有入口的屏 —— 点进去他自己回不来。
// 判在这里而不是 17 个调用点:调用点只知道自己缺什么数,不知道看的人是谁;
// 而漏掉一处不报错,只是那一张卡继续引错人。说明文字照旧全给 —— 缺什么数该让他知道。
//
// 判据本身在 `navAccess.canReach`(2026-09-08 从这里抽出去):屏内手写的 RouterLink
// 也是跨层引导,当初漏在门外,两处不能各判一遍。
import { computed } from 'vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import { canReach } from '@/nav/navAccess'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ label?: string; hint?: string; to?: string; toText?: string }>()
const auth = useAuthStore()
const canGo = computed(() => canReach(props.to, auth.navLayers, auth.can('system:view')))
</script>

<template>
  <FPEmpty class="ana-empty" size="sm" :sub="hint">
    {{ label || '当前筛选下暂无数据' }}
    <template v-if="canGo || $slots.default" #action>
      <RouterLink v-if="canGo" class="go" :to="to!">{{ toText || '去录入' }} →</RouterLink>
      <slot />
    </template>
  </FPEmpty>
</template>

<style scoped>
/* 跳转链接做成 FPEmpty sm 档按钮的样子(描边 28 高),同一张卡里只有一个钮 */
.go {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  box-sizing: border-box;
  border: 1px solid var(--border-control);
  border-radius: var(--radius-full);
  background: var(--surface-white);
  color: var(--text-primary);
  font-size: var(--fs-label);
  white-space: nowrap;
  text-decoration: none;
}
.go:hover { background: var(--surface-card); }
</style>
