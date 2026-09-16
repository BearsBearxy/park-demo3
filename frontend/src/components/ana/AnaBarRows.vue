<script setup lang="ts">
// DOM 条形清单容器(.ak-bar-rows):视口内首挂、切回页签擦入 320(2026-09-16 行为矩阵,同 PvRoiView 进度条)。
// 擦在容器上、不逐行:换期时行键变了的行(新进前 N、按月作键的换年)是新行,不该每行各擦一次;
// 换期同键行的条长由 .ak-bar-fill 的 clip-path 过渡 200。
import { ref } from 'vue'
import { useEnterPhase } from './anaMotion'
import './ana.css'

const el = ref<HTMLElement | null>(null)
const first = useEnterPhase(el)
</script>

<template>
  <div ref="el" :class="['ak-bar-rows', { first }]" @animationend.self="first = false" @animationcancel.self="first = false">
    <slot />
  </div>
</template>
