import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 门禁：**三个运营账屏不许再自己猜账期**（2026-08-29「两本账」设计稿 §③）。
 *
 * 这三屏改前**零选期层**：点完功能卡直接落表，`latestPeriodOf` 自己 snap 到最后一个有数据的月
 * —— BOOK-WORKBENCH-SPEC §7-1 一字不差禁止的「顺手落进某个期」。
 * 出账链五屏在 2026-08-28/29 刚从这个形状迁走（`chainPeriodGate.spec.ts` 是那边的门禁），
 * 这三屏当时没跟上，隔了一天才被逐屏读源码翻出来。这条门禁防的就是它再溜回去。
 *
 * ⚠ 判据抓源码形状，抓不到「接了 store 但没真的用」。
 *   行为由 `useMonthGate.spec.ts`（期跨实例保留）与各屏挂载测把关。
 */

const VIEWS = join(__dirname, '..')

/** 三个运营账屏 → 它们各自的会话期 key。加新屏进来这里要一起加。 */
const SCREENS: Record<string, string> = {
  '/pv/PvMeterView.vue': 'pv-meter',
  '/charging/CpMeterView.vue': 'cp-meter:',      // 带车型，附表7/8 各记各的
  '/elec/ElecCostView.vue': 'elec-cost',
}

const src = (rel: string) => readFileSync(join(VIEWS, rel), 'utf8')

describe('运营账屏选期门禁', () => {
  it('三个屏都指得到真实文件 —— 表烂了下面全是空断言', () => {
    expect(Object.keys(SCREENS)).toHaveLength(3)
    for (const rel of Object.keys(SCREENS)) {
      expect(existsSync(join(VIEWS, rel)), `${rel} 不存在`).toBe(true)
    }
  })

  it.each(Object.entries(SCREENS))('%s 不自己猜账期', (rel) => {
    const s = src(rel)
    // ⚠ 折叠空白后再查 import:多行导入会从行锚正则(^import ...$)底下溜过去;
    //   直接全文含断言又会误伤注释里的历史提及。标识符本身拆不开。
    expect(/import[^;]*?\blatestPeriodOf\b[^;]*?from/.test(s.replace(/\s+/g, ' ')),
      `${rel} 还在 import 默认账期猜测器 —— 期只能从选期矩阵来`).toBe(false)
    expect(/\byearOpts\b/.test(s), `${rel} 又出现了年份下拉`).toBe(false)
    expect(/\bmonthOpts\b/.test(s), `${rel} 又出现了月份下拉`).toBe(false)
    expect(/const\s+(year|month)\s*=\s*ref\b/.test(s),
      `${rel} 有屏内 year/month ref —— 侧栏点击会 openFresh 重建组件，屏内 ref 每次被清掉，` +
      '用户每次点侧栏都撞选期矩阵').toBe(false)
  })

  it.each(Object.entries(SCREENS))('%s 接着通用月门', (rel, key) => {
    const s = src(rel)
    expect(s.includes('useMonthGate'), `${rel} 没接 composables/useMonthGate`).toBe(true)
    expect(s.includes('<FPMonthGate'), `${rel} 没有选期矩阵那道门`).toBe(true)
    expect(s.includes(`key: \`${key}`) || s.includes(`key: '${key}'`),
      `${rel} 的会话期 key 不是 ${key}`).toBe(true)
    expect(s, `${rel} 的门没挂在 !picked 上`).toMatch(/<FPMonthGate\s+v-if="!picked"/)
  })

  it('附表7/8 的账期清单按车型取 —— 汽车屏不该被电动车拖走', () => {
    // 改前 cpMeterApi.months() 不接车型，拿的是两种车的月份全集：
    // 电动车录到 2026-03、汽车只到 2025-12 时，汽车屏一进来就落在 2026-03，满屏空。
    expect(src('/charging/CpMeterView.vue')).toContain('cpMeterApi.months(props.vehicleType)')
    const api = readFileSync(join(VIEWS, '..', 'api', 'cpMeter.ts'), 'utf8')
    expect(api).toMatch(/months:\s*\(vehicleType\?: string\)/)
  })

  it('附表7/8 的会话期与手工年都按车型分键 —— 两个屏各记各的', () => {
    const s = src('/charging/CpMeterView.vue')
    expect(s).toContain('key: `cp-meter:${props.vehicleType}`')
    expect(s).toContain("store: ['cp-meter', props.vehicleType]")
  })
})
