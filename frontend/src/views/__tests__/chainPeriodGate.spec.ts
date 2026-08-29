import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { CHAIN } from '@/nav/billingChain'

/**
 * 门禁：**出账链五屏不许再自己拿账期**（2026-08-28 设计稿 §3.1，BOOK-WORKBENCH-SPEC §7-1）。
 *
 * 防的是一件很容易悄悄回来的事：谁给其中一屏加回一对年月 `Select`（或一个屏内 `year` ref），
 * 那一屏的期就又和另外四屏分了家 —— 而它们抢的是同一把 `billing-chain:{年}-{月}` 月锁。
 * **表现不是报错，是「两个屏显示的月份不一样，而且都不提示」**，正是改造前的老毛病。
 *
 * 判据挑的是 `yearOpts` / `monthOpts` 这一对：它们是「顺手落进某个期」那个输入的唯一形态
 * （LIST-PAGE-SPEC §2 的定宽年月选择器，全站 8 屏一个写法）。屏内 `year` ref 同理。
 *
 * ⚠ 这条抓源码形状，抓不到「接了 store 但没真的用」。行为由
 *   `chainPeriodFlow.spec.ts` 挂载测把关（卸载重挂后期还在）。这里保证的是**不回潮**。
 */

const VIEWS = join(__dirname, '..')

/** 路由值 → 屏文件。加新屏进链时这里要一起加，漏了下面的自检会点名。 */
const FILES: Record<string, string> = {
  'params': '/params/ParamCenterView.vue',
  'meters': '/meters/MeterView.vue',
  'alloc': '/alloc/PoolLedgerView.vue',
  'alloc-loss': '/alloc/LossLedgerView.vue',
  'bill-notices': '/bills/BillNoticesView.vue',
}

const src = (rel: string) => readFileSync(join(VIEWS, rel), 'utf8')

describe('出账链账期门禁', () => {
  it('链上每一屏都指得到一个真实文件 —— 表烂了下面全是空断言', () => {
    expect(CHAIN.length).toBe(5)
    for (const s of CHAIN) {
      const rel = FILES[s.value]
      expect(rel, `${s.value}（${s.label}）在 CHAIN 里但 FILES 表里没有`).toBeTruthy()
      expect(existsSync(join(VIEWS, rel)), `${rel} 不存在`).toBe(true)
    }
  })

  it.each(Object.entries(FILES))('%s 不自己拿账期', (route, rel) => {
    const s = src(rel)

    expect(/\byearOpts\b/.test(s),
      `${rel} 又出现了年份下拉 —— 期只能从出账月矩阵来，五屏共一份`).toBe(false)
    expect(/\bmonthOpts\b/.test(s),
      `${rel} 又出现了月份下拉 —— 同上`).toBe(false)
    expect(/const\s+(year|month)\s*=\s*ref\b/.test(s),
      `${rel} 有屏内 year/month ref —— 侧栏点击会 openFresh 重建组件，屏内 ref 每次都被清掉，` +
      '用户每次点侧栏都撞选期矩阵（这正是「我想随意打开某个表来看」那条反馈）').toBe(false)
    // 判据是 **import 那一行**,不是「文中出现过这个词」:注释里说明它为什么退场是好事,
    // 因为标志物出现在自己的墓志铭里而变红,只会逼人把注释写差。
    expect(/^import .*latestPeriodOf.*from/m.test(s),
      `${rel} 还在 import 默认账期猜测器 —— 期现在一定是用户在矩阵上点出来的`).toBe(false)
  })

  it.each(Object.entries(FILES))('%s 接着组级账期与那道门', (route, rel) => {
    const s = src(rel)
    expect(s.includes('useBillingPeriodStore'), `${rel} 没接 stores/billingPeriod`).toBe(true)
    expect(s.includes('<ChainMonthGate'), `${rel} 没有出账月矩阵那道门`).toBe(true)
    expect(s.includes('<FPStepStrip'), `${rel} 没有链路条 —— 换屏就换不了期，链断在这里`).toBe(true)
    expect(s.includes(`current="${route}"`),
      `${rel} 的链路条没标出自己是哪一环（current="${route}"）`).toBe(true)
  })

  it('门只在没有期时出现 —— 否则选过期的人每次点侧栏还是被拦', () => {
    for (const rel of Object.values(FILES)) {
      expect(src(rel), `${rel} 的门没挂在 !period.picked 上`)
        .toMatch(/<ChainMonthGate\s+v-if="!period\.picked"/)
    }
  })
})
