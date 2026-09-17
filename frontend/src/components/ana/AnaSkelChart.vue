<script setup lang="ts">
// 顶替 AnaEChart 的骨架块:高度走与图同一张降档表,≤600 数据到的那一帧不跳。
// 只给「顶替 AnaEChart」用;顶替自绘图的骨架照旧写死(自绘图不降档)。
import { chartHeightFor } from './anaChartHeight'
defineProps<{ height: number }>()
</script>

<template>
  <div class="fp-shim" :style="{ height: chartHeightFor(height) + 'px' }" />
</template>
