// KeepAlive 的「按页签卸载」(TAB-BAR-SPEC §1;App.vue 用)。
// KeepAlive 按 key 缓存,却只按「组件名」清(include / exclude)。epoch++ 之后旧 key 的实例还躺在缓存里 ——
// 关掉 / 重新加载一个页签,它的编辑锁与编辑态就成了僵尸(onUnmounted 不跑,只有挤满 max 才被清;
// 2026-09-18 对抗复查)。给每个 key 包一层以 key 命名的壳,exclude 列出「过期纪元」的壳名:
// 纪元一变,旧壳立刻出列,KeepAlive 当场卸掉它(锁随 onUnmounted 释放)。
// 缓存里因此只有开着的页签(换下去的屏 commit 时也弃状态),不设 max(TAB-BAR-SPEC §1)。
//
// 壳顺带告诉壳里的屏「你是哪一屏」(useScreen):编辑态登记(auth.openEditor)要带上它,
// 页签条才判得出「这一屏我是不是正在编辑」。
import { h, defineComponent, markRaw, provide, inject, type Component, type InjectionKey } from 'vue'

const SCREEN: InjectionKey<string> = Symbol('fp-screen')

/** 当前组件所在的页签 value;不在页签壳里(测试直挂)为 ''。只能在 setup 里调。 */
export function useScreen(): string {
  return inject(SCREEN, '')
}

// ponytail: 壳和作废壳名都只增不减,每换一次页签多一个小对象、一个名字;一整天几百次也就几百个,
//           KeepAlive 剔除时逐个比名字。真嫌多再在 dropState 里删旧壳、exclude 只列 e-1。
const shells = new Map<string, Component>()

/** key = `value:epoch`。同一 key 永远拿到同一个壳(KeepAlive 靠组件身份 + key 命中缓存)。 */
export function shellOf(key: string, C: Component): Component {
  let w = shells.get(key)
  if (!w) {
    const screen = key.slice(0, key.lastIndexOf(':'))
    w = markRaw(defineComponent({ name: 'kt:' + key, setup: () => { provide(SCREEN, screen); return () => h(C) } }))
    shells.set(key, w)
  }
  return w
}

/** 过期纪元的壳名:value 当前纪元是 e,则 0 … e-1 都已作废。 */
export function staleShellNames(epoch: Record<string, number>): string[] {
  return Object.entries(epoch).flatMap(([v, e]) => Array.from({ length: e }, (_, n) => `kt:${v}:${n}`))
}
