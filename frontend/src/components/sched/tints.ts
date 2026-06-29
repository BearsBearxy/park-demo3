// 附表期别色点(组头/抽屉 chip 的彩色圆点)。tint 是纯前端显示口径,不进 DTO。
// 按期别在 phases 数组中的序号取色,循环 slate→blue→cyan(对齐原型 S6_TINT 的 p1/p2/p3 配色)。
const TINTS = ['var(--fill-slate)', 'var(--fill-blue)', 'var(--fill-cyan)']
export const phaseTint = (index: number): string => TINTS[((index % 3) + 3) % 3]
