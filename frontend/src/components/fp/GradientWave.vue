<script setup lang="ts">
// 流动渐变背景(移植自 React 组件 gradient-wave.tsx,引擎见 ./gradientWave.ts)。
// 铺满最近的定位祖先;WebGL 不可用时什么都不画,露出下面的底色。
// 参数在挂载时读一次(调用方传的都是常量);isPlaying 可随时切换。
// 减动效(prefers-reduced-motion)只画一帧不动。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GradientWaveEngine, WaveDeform } from './gradientWave'

const props = withDefaults(defineProps<{
  colors?: string[]
  isPlaying?: boolean
  shadowPower?: number
  darkenTop?: boolean
  noiseSpeed?: number
  noiseFrequency?: [number, number]
  deform?: WaveDeform
}>(), {
  colors: () => ['#38bdf8', '#ffffff', '#38bdf8', '#ffffff', '#38bdf8', '#ffffff'],
  isPlaying: true,
  shadowPower: 8,
  darkenTop: false,
  noiseSpeed: 0.00001,
  noiseFrequency: () => [0.0001, 0.0009],
  deform: () => ({ incline: 0.5, noiseAmp: 250, noiseFlow: 5 }),
})

const canvasEl = ref<HTMLCanvasElement | null>(null)
let engine: GradientWaveEngine | null = null
const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const play = (on: boolean) => {
  if (!engine) return
  if (reduced) engine.renderStill()
  else if (on) engine.start()
  else engine.stop()
}

onMounted(async () => {
  const { GradientWaveEngine } = await import('./gradientWave')
  if (!canvasEl.value) return   // 引擎加载期间已卸载:模板引用已被置空
  try {
    engine = new GradientWaveEngine(canvasEl.value, {
      colors: props.colors,
      shadowPower: props.shadowPower,
      darkenTop: props.darkenTop,
      noiseSpeed: props.noiseSpeed,
      noiseFrequency: props.noiseFrequency,
      deform: props.deform,
    })
  } catch (e) {
    console.warn('GradientWave: WebGL 不可用,保留底色', e)
    return
  }
  play(props.isPlaying)
})

watch(() => props.isPlaying, play)

onBeforeUnmount(() => {
  engine?.dispose()
  engine = null
})
</script>

<template>
  <div class="gwave" aria-hidden="true"><canvas ref="canvasEl" class="gwave-c" /></div>
</template>

<style scoped>
.gwave { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.gwave-c { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
</style>
