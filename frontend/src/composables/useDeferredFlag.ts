import { ref, watch, onScopeDispose, type Ref } from 'vue'

/**
 * 「在途超过 delayMs 才亮」——加载指示器的防闪延迟（加载态设计稿 §08）。
 *
 * 本地后端常在几十毫秒内返回。没有这道延迟，指示器**闪现即消失**：
 * 用户眼角瞥到一下变化，回头看又什么都没有 —— 比不显示更晃眼。
 *
 * ⚠ **进场等、退场立刻**。数据都已经在屏幕上了，还盖着一层退让就是纯碍事。
 *   这是「慢在用户决定处、快在系统响应处」那条经验的一个实例。
 *
 * 每次 source 由假转真都**重新从 0 计时** —— 用户连点两次月份是常态，
 * 第二趟是新的一趟，不该沾第一趟的光提前亮。
 *
 * @param source 真实的「在途」状态
 * @param delayMs 熬过这么久才亮。200ms 是设计稿定的：比它快的请求全程静默
 */
export function useDeferredFlag(source: Ref<boolean>, delayMs = 200): Ref<boolean> {
  const flag = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (timer !== null) { clearTimeout(timer); timer = null }
  }

  watch(source, (on) => {
    clear()
    if (!on) { flag.value = false; return }   // 退场:立刻灭
    timer = setTimeout(() => { timer = null; flag.value = true }, delayMs)
  })

  // 组件卸载时别留一个会把 flag 点亮的定时器 —— 那时候已经没人看了
  onScopeDispose(clear)

  return flag
}
