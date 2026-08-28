// src/styles/breakpoints.ts — 断点唯一事实源(RESPONSIVE-LAYOUT-SPEC §1)。
// 四档语义(桌面优先 max-width 划档):
//   S ≤600 / M 601–960 / L 961–1280 / XL >1280
// CSS 侧不引用本文件、写字面量 + 档注释(如 `@media (max-width: 960px) { /* M↓ */ }`)——
// @media 条件里进不了 CSS 自定义属性,这是语言限制不是偷懒;
// 本文件供 JS/TS(useViewport 等)引用,改断点值必须 CSS/TS 两边同改。
export const BP = { s: 600, m: 960, l: 1280 } as const
