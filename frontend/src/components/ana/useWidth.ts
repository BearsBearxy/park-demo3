// src/components/ana/useWidth.ts — 图表自适应宽度 composable(移植 ana-charts.jsx useWidth)。
// ResizeObserver 监听容器宽度;jsdom 无 ResizeObserver 时退回初始宽(单测冒烟可 mount)。
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useWidth(init = 480): { el: Ref<HTMLElement | null>; width: Ref<number> } {
  const el = ref<HTMLElement | null>(null)
  const width = ref(init)
  let ro: ResizeObserver | null = null
  onMounted(() => {
    const node = el.value
    if (!node) return
    const update = () => { width.value = Math.max(160, node.clientWidth || init) }
    update()
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update)
      ro.observe(node)
    }
  })
  onBeforeUnmount(() => { ro?.disconnect() })
  return { el, width }
}
