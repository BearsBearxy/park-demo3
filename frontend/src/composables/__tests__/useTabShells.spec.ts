// KeepAlive 按页签卸载(App.vue + useTabShells)。「❗」开头的做过破坏验证。
// 照 App.vue 的写法搭一个最小的 KeepAlive:key = value:epoch,exclude = 过期纪元的壳名。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, KeepAlive, nextTick, onUnmounted, reactive, ref } from 'vue'
import { shellOf, staleShellNames, useScreen } from '../useTabShells'

// ⚠ 壳按 key 全局缓存(同一 key 永远同一个壳 —— 生产里 value → 组件是固定的)。
//   每条用例用自己的一组 value,否则会拿到上一条用例的壳、里面包的是上一条的组件。
let run = 0
function harness() {
  const p = `t${++run}-`
  const L = p + 'ledger'
  const T = p + 'tenants'
  const gone: string[] = []
  const seen: Record<string, string> = {}
  const screen = (name: string) => defineComponent({
    name,
    setup() { seen[name] = useScreen(); onUnmounted(() => gone.push(name)); return () => h('div', name) },
  })
  const SCREENS: Record<string, ReturnType<typeof screen>> = { [L]: screen('ledger'), [T]: screen('tenants') }
  const epoch = reactive<Record<string, number>>({})
  const current = ref(L)
  const w = mount(defineComponent({
    setup() {
      const stale = computed(() => staleShellNames(epoch))
      return () => h(KeepAlive, { exclude: stale.value }, {
        default: () => {
          const key = `${current.value}:${epoch[current.value] ?? 0}`
          return h(shellOf(key, SCREENS[current.value]), { key })
        },
      })
    },
  }))
  return { w, gone, seen, epoch, current, L, T }
}
const settle = async () => { for (let i = 0; i < 3; i++) await nextTick() }

describe('KeepAlive 按页签卸载', () => {
  it('staleShellNames:当前纪元之前的壳都作废', () => {
    expect(staleShellNames({ ledger: 2, tenants: 0 })).toEqual(['kt:ledger:0', 'kt:ledger:1'])
  })

  it('❗关掉一个不在前台的页签(epoch++):它的缓存实例当场卸载', async () => {
    const { gone, epoch, current, L, T } = harness()
    current.value = T                   // 台账切走,进缓存
    await settle()
    expect(gone).toEqual([])
    epoch[L] = 1                        // 关掉台账页签 → dropState
    await settle()
    expect(gone).toEqual(['ledger'])
  })

  it('❗重新加载前台页签:旧实例卸载,换上新实例', async () => {
    const { w, gone, epoch, L } = harness()
    epoch[L] = 1
    await settle()
    expect(gone).toEqual(['ledger'])
    expect(w.text()).toBe('ledger')
  })

  it('❗在当前页签里换一屏(同一拍里切走 + 旧屏纪元 +1):旧实例卸载,新屏照常显示', async () => {
    const { w, gone, epoch, current, L, T } = harness()
    current.value = T
    epoch[L] = 1
    await settle()
    expect(gone).toEqual(['ledger'])
    expect(w.text()).toBe('tenants')
  })

  it('❗壳告诉壳里的屏它是哪一屏(useScreen);不在壳里是空串', async () => {
    const { seen, current, L, T } = harness()
    current.value = T
    await settle()
    expect(seen).toEqual({ ledger: L, tenants: T })
    let bare = 'x'
    mount(defineComponent({ setup() { bare = useScreen(); return () => null } }))
    expect(bare).toBe('')
  })

  it('切走的页签(纪元不变)照旧缓存', async () => {
    const { gone, current, L, T } = harness()
    current.value = T
    await settle()
    current.value = L
    await settle()
    expect(gone).toEqual([])
  })

  it('同一 key 永远是同一个壳(否则 KeepAlive 命不中缓存)', () => {
    const C = defineComponent({ render: () => null })
    expect(shellOf('same:0', C)).toBe(shellOf('same:0', C))
  })
})
