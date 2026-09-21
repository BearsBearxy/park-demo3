// src/composables/useTopBarAction.ts — 屏把自己的主动作挂进手机顶栏(RESPONSIVE-LAYOUT-SPEC §5.10)。
//
// 用法(在屏组件的 setup 里,一行):
//   useTopBarAction(() => ({ label: edit ? '退出编辑' : '编辑模式', icon: Pencil, onClick: toggle }))
// 传 getter / computed 时 label 跟着变;传 null 表示这一刻这屏没有主动作。
// 顶栏只在 S 档挂载,所以别档调它是空转 —— 屏不必自己判档。
//
// ⚠ 走 store 不走具名插槽:屏渲染在 AppShell 的默认 slot 里,而顶栏是 AppShell **自己模板里**
//   的节点(AppShell.vue:168)—— 屏不是顶栏的父级,插槽递不下去;让屏 import AppShell 会成环。
//   这条路抄的是仓里已有的 ui.paletteReq(首页搜索框开命令面板)。
import { markRaw, onActivated, onDeactivated, onUnmounted, toValue, watchEffect, type MaybeRefOrGetter } from 'vue'
import { useUiStore, type TopBarAction } from '@/stores/ui'

export function useTopBarAction(action: MaybeRefOrGetter<TopBarAction | null>) {
  const ui = useUiStore()
  // 页签是 KeepAlive 的(App.vue:75):离屏只停用不卸载。不摘的话上一屏的动作留在下一屏顶栏上;
  // 而且停用的屏里 watchEffect 照跑,live 这道闸是防它在别人的屏上把自己重新写回去。
  let live = true

  // ⚠ **清场必须判所有权,不能无条件清空**(2026-09-21 对抗复查抓到,是会让整个功能失效的那种)。
  //   换屏的真实次序是:新屏 setup → watchEffect 建立即登记 → **然后**路由 afterEach 里
  //   tabs.commit() 给上一屏 dropState()(纪元 +1 → KeepAlive 按 exclude 卸载上一屏)。
  //   上一屏的 onUnmounted 因此落在新屏登记**之后**,无条件 `ui.topBarAction = null`
  //   会把新屏刚挂上的那颗当场抹掉,而且不会再有人写回来 ——
  //   现象是「手机上换到抄表屏,顶栏的『编辑模式』根本不出现」,这两屏在 S 档的唯一写入口就没了。
  //   令牌只认自己那一份:别人已经覆盖过,就不是我的了,不许清。
  //   ⚠ 令牌要能比得出来:store 里的 ref 会给对象套一层响应式代理,存进去再读回来
  //   `ui.topBarAction === mine` 恒为 false(proxy !== raw),令牌当场失效、清场又变回无条件
  //   —— 实测四条既有断言一起红。markRaw 让它存的就是原对象:这个对象装的是组件与回调,
  //   不是要深层追踪的数据;label 变化靠「getter 每次返回新对象、整个 ref 被替换」传出去,
  //   不依赖深层响应式。
  let mine: TopBarAction | null = null
  const apply = () => {
    if (!live) return
    const next = toValue(action)
    mine = next ? markRaw(next) : null
    ui.topBarAction = mine
  }
  const drop = () => {
    live = false
    if (ui.topBarAction === mine) ui.topBarAction = null
    mine = null
  }

  watchEffect(apply)
  onActivated(() => { live = true; apply() })
  onDeactivated(drop)
  onUnmounted(drop)
}
