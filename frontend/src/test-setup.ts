// vitest 全局前置。
//
// 2026-09-12:三张图改成自绘 SVG 之后,组件用 ResizeObserver 量容器宽度(1 个 SVG 单位 = 1 个
// CSS 像素,否则卡片一宽整幅就等比放大 —— 那个 bug 用户当场看出来了)。jsdom 没有这个 API,
// 于是所有挂载了这些图的屏级 spec 全线崩在 `ResizeObserver is not defined`。
// 在这里补一个空壳:组件只用它做「宽度变了就重算」,测试环境里宽度不会变,不实现也不影响判据。
if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
