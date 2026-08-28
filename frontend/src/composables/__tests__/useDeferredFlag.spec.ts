import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useDeferredFlag } from '@/composables/useDeferredFlag'

/**
 * 「在途超过 200ms 才亮」——加载态设计稿 §08 的防闪延迟。
 *
 * 本地后端常在几十毫秒内返回。没有这道延迟的话，指示器**闪现即消失**，
 * 比什么都不显示更晃眼：用户眼角瞥到一下变化，回头看又什么都没有。
 */

afterEach(() => { vi.useRealTimers() })

describe('useDeferredFlag', () => {
  it('快响应全程不亮 —— 这是它存在的全部理由', async () => {
    vi.useFakeTimers()
    const src = ref(false)
    const flag = useDeferredFlag(src, 200)

    src.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(120)   // 一次 120ms 的请求
    expect(flag.value, '120ms 就回来了，不该亮过').toBe(false)

    src.value = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(flag.value, '结束之后更不该亮 —— 定时器必须被撤掉').toBe(false)
  })

  it('慢响应才亮', async () => {
    vi.useFakeTimers()
    const src = ref(false)
    const flag = useDeferredFlag(src, 200)

    src.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(199)
    expect(flag.value).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(flag.value).toBe(true)
  })

  it('结束时立刻灭，不拖延', async () => {
    // 进场要等（防闪），退场要快 —— 数据已经在屏幕上了，还盖着一层退让就是纯碍事。
    // 「慢在用户决定处，快在系统响应处」。
    vi.useFakeTimers()
    const src = ref(false)
    const flag = useDeferredFlag(src, 200)

    src.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(400)
    expect(flag.value).toBe(true)

    src.value = false
    await nextTick()
    expect(flag.value, '不许再等一个 200ms').toBe(false)
  })

  it('连点两次换月：第二次不重新计时，也不会漏灭', async () => {
    // 用户快速连点月份是常态。若每次 true 都重置定时器，慢请求就永远等不到亮；
    // 若结束时没清干净，会留一个「亮着但其实已经好了」的幽灵。
    vi.useFakeTimers()
    const src = ref(false)
    const flag = useDeferredFlag(src, 200)

    src.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(150)
    src.value = false           // 第一次回来了
    await nextTick()
    src.value = true            // 立刻又点了一次
    await nextTick()
    await vi.advanceTimersByTimeAsync(150)
    expect(flag.value, '第二次是新的一趟，重新从 0 计时').toBe(false)
    await vi.advanceTimersByTimeAsync(60)
    expect(flag.value).toBe(true)

    src.value = false
    await nextTick()
    expect(flag.value).toBe(false)
  })
})
