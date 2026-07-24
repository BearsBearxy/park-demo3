// 园区抄表异常标记(METER-SPEC §1):只标不拦——真实抄表就有漏抄/换表,拦了导不进。
// 纯函数,meterLogic.spec.ts 锁定。
export interface MeterReadingFlags {
  missing: boolean       // 漏抄:本月总读数空(黄)
  negative: boolean      // 倒走:总用量<0,疑换表/抄错(红)
  touMismatch: boolean   // 时段不符:尖峰平谷四段用量齐全但 Σ段≠总,超容差 max(1, |总|×1%)(红)
}

export interface MeterReadingLike {
  currTotal: number | null
  usageTotal: number | null
  usageSharp: number | null
  usagePeak: number | null
  usageFlat: number | null
  usageValley: number | null
}

export function readingFlags(r: MeterReadingLike): MeterReadingFlags {
  const segs = [r.usageSharp, r.usagePeak, r.usageFlat, r.usageValley]
  const allSegs = segs.every(s => s != null)
  const segSum = segs.reduce((a: number, b) => a + (b ?? 0), 0)
  return {
    missing: r.currTotal == null,
    negative: r.usageTotal != null && r.usageTotal < 0,
    touMismatch: allSegs && r.usageTotal != null
      && Math.abs(segSum - r.usageTotal) > Math.max(1, Math.abs(r.usageTotal) * 0.01),
  }
}
