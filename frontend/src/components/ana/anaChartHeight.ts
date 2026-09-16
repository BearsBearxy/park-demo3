// src/components/ana/anaChartHeight.ts —— AnaEChart 的 S 档图高降档,抽出来给「顶替 AnaEChart 的骨架块」共用。
// 骨架与图同高 = 数据到的那一帧零位移(≤600 首进整页跳,就是骨架按桌面高、图按降档高)。
//
// S 档(视口 ≤600)图高降档:xl/lg→260、md→220、sm→180、xs→150(RESPONSIVE-LAYOUT-SPEC §5.2)。
// matchMedia 在调用时判:图与骨架各自挂载时判一次,不跟随 resize —— 手机不改窗宽,旋屏走整页重挂载;
// 也因此零响应式重排,同一视口内高度即终态(LAYOUT-STABILITY §1)。
// 五档「同一行卡等高」的约束(见 AnaEChart height 注释)在 S 档随单列堆叠自然失效 —— 一行只有一张卡,
// 没有并排可对齐;降档只需整组同改(xl 与 lg 合并到 260 正是这个意思),无需逐行核对。
// ⚠ 只管 AnaEChart:自绘图不降档,顶替自绘图的骨架照旧写死高度。
const S_HEIGHT: Record<number, number> = { 440: 260, 300: 260, 250: 220, 200: 180, 170: 150 }

export const isSViewport = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 600px)').matches

export function chartHeightFor(h: number): number {
  return isSViewport() ? S_HEIGHT[h] ?? h : h
}
