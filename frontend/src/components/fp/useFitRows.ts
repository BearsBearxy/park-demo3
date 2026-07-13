// 自适应每页行数(主数据屏约定:表格不滚动,超出直接翻页):按表格卡的视口高度上限
// (.mx-tablewrap max-height)与实测表头/行高,算出恰好填满的行数。行高不同的屏
// (租户两行式 vs 合同单行式)各自得到正好放得下的数量,换屏幕/改窗口自动重算。
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** 纯计算:可用高÷行高向下取整,钳位 [min,max](单测锁定)。 */
export const fitRows = (availH: number, theadH: number, rowH: number, min = 6, max = 30): number =>
  Math.min(max, Math.max(min, Math.floor((availH - theadH) / rowH)))

export function useFitRows(wrap: Ref<HTMLElement | null>, fallback = 10): Ref<number> {
  const pageSize = ref(fallback)
  const measure = () => {
    const el = wrap.value
    if (!el) return
    const cs = getComputedStyle(el)
    const maxH = parseFloat(cs.maxHeight)                       // .mx-tablewrap 的视口上限
    const thead = el.querySelector('thead')
    const row = el.querySelector('tbody tr')
    if (!maxH || !thead || !row) return                         // 数据未渲染时保持 fallback
    const pad = parseFloat(cs.paddingTop) || 0
    pageSize.value = fitRows(maxH - pad, thead.getBoundingClientRect().height, row.getBoundingClientRect().height)
  }
  // 基于 max-height(固定值)而非实际高度计算,pageSize 变更引发的内容高度变化不会造成抖动
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null   // jsdom 无 RO → 保持 fallback
  watch(wrap, (el, old) => {
    if (old && ro) ro.unobserve(old)
    if (el && ro) ro.observe(el)                                // 数据首次渲染/窗口高变 → 尺寸变 → 重算
    measure()
  })
  onMounted(() => {
    measure()
    if (ro) ro.observe(document.documentElement)                // 100vh 变化(改窗口高)也触发
  })
  onBeforeUnmount(() => ro?.disconnect())
  return pageSize
}
