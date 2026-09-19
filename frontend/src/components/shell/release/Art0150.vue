<script setup lang="ts">
// 0.15.0 重点「深色外观」的配图:账号菜单缩样 —— 名字、「外观」三段段控(深色选中)、版本更新一行。
// 字与颜色照 IconRail 账号菜单(.fp-user-name / .fp-user-appr / .fp-appr-seg / .fp-user-row)抄,字号压到 12 / 11。
import { Sparkles, SunMoon } from 'lucide-vue-next'
</script>

<template>
  <div class="nm">周明</div>
  <div class="h"><SunMoon :size="12" />外观</div>
  <div class="seg"><span>浅色</span><span class="on">深色</span><span>跟随系统</span></div>
  <div class="row"><Sparkles :size="12" />版本更新<span class="ver">v0.15.0</span></div>
</template>

<style scoped>
.nm { height: 20px; font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); }
.h { display: flex; align-items: center; gap: 6px; height: 20px; font-size: var(--fs-micro); color: var(--text-secondary); }
.seg { display: flex; gap: 2px; padding: 3px; border-radius: var(--radius-full); background: var(--surface-sunken); }
.seg span {
  flex: 1; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-full); font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap;
}
.seg .on { background: var(--surface-raised); color: var(--text-primary); box-shadow: var(--shadow-pill); }
.row { display: flex; align-items: center; gap: 6px; height: 24px; font-size: var(--fs-micro); color: var(--text-secondary); }
.ver { margin-left: auto; font-family: var(--font-mono); color: var(--text-muted); }
</style>
