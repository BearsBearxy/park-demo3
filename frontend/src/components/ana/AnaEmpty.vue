<script setup lang="ts">
// 「数据待录入」统一空态卡(spec 通用降级规则②):说明缺什么、去哪录,深链到录入屏,不画假图。
// to 为路由路径(如 '/contracts');不传则纯提示(移植 ana-charts.jsx Empty 的语义)。
//
// 「去录入」按目标屏**所在层的可见性**显隐(§6):园区股东只有经营分析层,给他一条
// 「去台账录入」的链接,是把他引到一个侧边栏根本没有入口的屏 —— 点进去他自己回不来。
// 判在这里而不是 17 个调用点:调用点只知道自己缺什么数,不知道看的人是谁;
// 而漏掉一处不报错,只是那一张卡继续引错人。说明文字照旧全给 —— 缺什么数该让他知道。
//
// 判据本身在 `navAccess.canReach`(2026-09-08 从这里抽出去):屏内手写的 RouterLink
// 也是跨层引导,当初漏在门外,两处不能各判一遍。
import { computed } from 'vue'
import { canReach } from '@/nav/navAccess'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ label?: string; hint?: string; to?: string; toText?: string }>()
const auth = useAuthStore()
const canGo = computed(() => canReach(props.to, auth.navLayers, auth.can('system:view')))
</script>

<template>
  <div class="ana-empty">
    <div class="lb">{{ label || '当前筛选下暂无数据' }}</div>
    <div v-if="hint" class="ht">{{ hint }}</div>
    <RouterLink v-if="canGo" class="go" :to="to!">{{ toText || '去录入' }} →</RouterLink>
    <slot />
  </div>
</template>

<style scoped>
/* 空态里的提示文字正是「该去哪儿录数据」的引导 —— 改前继承 --text-disabled(1.51:1),
   等于把最该看清的那句话涂成最看不清的。--text-disabled 只给真正禁用的控件。 */
.ana-empty { padding: 44px 0; text-align: center; color: var(--text-muted); }
.lb { font-size: var(--fs-body); color: var(--text-muted); }
.ht { font-size: 12px; margin-top: 4px; }
.go { display: inline-block; margin-top: 10px; font-size: 12px; color: var(--text-link); text-decoration: none; }
.go:hover { text-decoration: underline; }
</style>
