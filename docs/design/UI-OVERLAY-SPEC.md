# UI-OVERLAY-SPEC — 浮层必须点外面就关

> 定稿 2026-08-15。需求来源：用户报障「修复所有页面里面，所有卡片，所有编辑模式下的
> popover 下拉条，点开了点击别的区域不会回弹关闭的问题，完全反用户使用习惯」。

## 0. 一句话

**任何浮层（下拉、popover、菜单、选择器面板），点它外面就必须关。**
这是三十年桌面/网页的肌肉记忆，不关＝坏了。

---

## 1. 铁律一：点外关闭必须挂 capture 阶段

```ts
document.addEventListener('mousedown', onDoc, true)   // ← 第三参 true 不能省
```

**为什么**：宿主容器普遍带 `@mousedown.stop`。本仓库最典型的是 `FPDrawer.vue:33`：

```html
<div class="fp-dwr" @mousedown.stop>   <!-- 挡住 backdrop 的关闭 -->
```

冒泡阶段的 `document` 监听在这个容器**内部永远收不到事件** ——
于是抽屉里每一个下拉，点外面都不关，只能再点一次触发器或按 Esc。
capture 阶段先于任何 `.stop` 派发，不受影响。

同样带 `.stop` 的还有表格行（`@click.stop` 防止行点击冒泡开抽屉）、卡片、勾选列，
所以**不在弹窗里的浮层也一律挂 capture**，别赌宿主没有 `.stop`。

用 `mousedown` 而不是 `click`：`click` 要等 mouseup，拖选文本、快速连点时行为不稳。

## 2. 铁律二：Esc 只关自己，必须 stopPropagation

```ts
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
}
```

**为什么**：宿主弹窗自己也监听 `window keydown` 的 Esc 来关闭。不阻断的话，
用户想收起一个下拉，结果**整个抽屉一起关掉**，录到一半的表单全丢。

## 3. 铁律三：浮层自身要清理监听

`onUnmounted` / 关闭时 `removeEventListener`，且 **capture 标志必须与注册时一致**
（`removeEventListener(type, fn)` 不带 `true` 移不掉 capture 监听，会泄漏）。

## 3.5 什么不算浮层（别照字面扩大化）

本规范只管**浮在内容之上、遮挡下方**的定位元素 —— CSS 上有 `position:absolute/fixed` +
`z-index`（通常还有 `box-shadow`）。判据不是「有个 ref(false) 控制开合」。

**不适用**：内联折叠区 / 手风琴 / 「展开·收起」区块。它们在正常文档流里，
展开只是把后面的内容往下顶，不遮挡任何东西。给它们加点外关闭是**把好控件改坏**：

> 实例（2026-08-15 扫全站时判定保留）：`PoolLedgerView.vue` 池配置抽屉②段的
> 「从其他位置添加表」`.pl-otherbox` —— 无 position/z-index/shadow，是 `border-top` 虚线分隔的
> 流式折叠区。若按本规范挂 capture 监听，用户在②段搜到表勾选后、转头去改③段基数或点页脚保存，
> 搜索面板连同 40 条候选**当场收起**，必须重新展开重搜。折叠控件在桌面与网页惯例里
> 从不因点外部而收起。同类还有各屏告警清单的「展开/收起」、`LossLedgerView` 的 `cfgOpen`。

一句话判据：**它盖住别的东西吗？盖住＝浮层，顶开＝折叠区。**

## 4. 参考实现

`frontend/src/components/ds/Popover.vue` 是基准，新写浮层直接照抄它的三段：
`onDoc` / `onKey` / `watch(isOpen)` 注册与注销。

已按本规范对齐的共用组件：

| 组件 | 用在哪 |
|---|---|
| `ds/Popover.vue` | 通用浮层基座 |
| `ds/Select.vue` | 全站下拉（年/月/筛选/表单字段） |
| `fp/FPTenantPicker.vue` | 租户选择器 |
| `fp/FPUnitPicker.vue` | 单元选择器 |
| `fp/FPPager.vue` | 跳页浮层 |
| `shell/TabStrip.vue` | 页签溢出菜单 |

## 5. 新写浮层的自查

1. 有没有 `document.addEventListener('mousedown', ..., **true**)`？
2. Esc 有没有 `stopPropagation()`？
3. 注销时 capture 标志一致吗？
4. **能不能不自己写** —— 优先用 `ds/Popover.vue` 包一层，别再复制第七份。

## 6. 不做

不引入全局浮层管理器/焦点陷阱（focus trap）。当前浮层都是轻量下拉，
一个 capture 监听足够；真出现嵌套浮层的层级冲突再议。
