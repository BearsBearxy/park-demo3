// 自适应每页行数(主数据屏约定:表格不滚动,超出直接翻页):所有输入都是布局常量——
// 卡片定高(.mx-listcard)撑出的 wrap.clientHeight、固定行高 --mx-row-h(rowH 参数)、
// thead 实高(样式常量)。与渲染内容零耦合:严禁测量 tbody 行高,否则形成
// 「pageSize→内容→尺寸→pageSize」反馈回路(2026-07-15 深页码抽搐闪烁 bug 的根因)。
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** 纯计算:可用高÷行高向下取整,钳位 [min,max](单测锁定)。 */
export const fitRows = (availH: number, theadH: number, rowH: number, min = 6, max = 30): number =>
  Math.min(max, Math.max(min, Math.floor((availH - theadH) / rowH)))

export function useFitRows(wrap: Ref<HTMLElement | null>, rowH = 56, fallback = 10): Ref<number> {
  const pageSize = ref(fallback)
  const measure = () => {
    const el = wrap.value
    if (!el || !el.clientHeight) return                         // 未布局(jsdom/未挂载)时保持 fallback
    const cs = getComputedStyle(el)
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    // thead 高是样式常量(不随数据/页码变),实测仅为免硬编码;未渲染时兜底 36
    const theadH = el.querySelector('thead')?.getBoundingClientRect().height || 36
    pageSize.value = fitRows(el.clientHeight - pad, theadH, rowH)
  }
  // clientHeight 由卡片定高+flex 布局决定(与行数无关),pageSize 变更不会反过来触发重算
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null   // jsdom 无 RO → 保持 fallback
  watch(wrap, (el, old) => {
    if (old && ro) ro.unobserve(old)
    if (el && ro) ro.observe(el)                                // 首次挂载/布局尺寸变 → 重算
    measure()
  })
  onMounted(() => {
    measure()
    if (ro) ro.observe(document.documentElement)                // 100vh 变化(改窗口高)也触发
    window.addEventListener('resize', measure)                  // RO 对 html 盒尺寸不敏感的环境(如 DPR 模拟)兜底
  })
  onBeforeUnmount(() => {
    ro?.disconnect()
    window.removeEventListener('resize', measure)
  })
  return pageSize
}
