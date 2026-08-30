import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 「7 个屏都接上了锁弹窗」的结构证明 —— 一份守七屏。
 *
 * 为什么是源码断言而不是七次真 mount:这七屏各自要十几个 API mock
 * (见 cpMeterFlow.spec.ts:24-44),七份堆一起没法维护,而这里要守的不是行为
 * (行为已由 meterPeriodFlow.spec.ts 的两条真 mount 证明),是**别漏**。
 * 表驱动的理由同 exactPlaceholderScreens.spec.ts:「改法一模一样,各写一份必然长歪」。
 *
 * 2026-08-30 阶段性验收查出的病根就是「每屏各接一遍,漏了没人发现」——
 * 以后再有屏接 useEditMode + scope,在下表加一行即可。
 */
/** 剥掉 HTML 注释与 JS 行注释 —— 被注释掉的代码不算「接上了」。 */
const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

const SCREENS = [
  '../pv/PvMeterView.vue',
  '../charging/CpMeterView.vue',
  '../elec/ElecCostView.vue',
  '../meters/MeterView.vue',
  '../alloc/PoolLedgerView.vue',
  '../bills/BillNoticesView.vue',
  '../params/ParamCenterView.vue',
]

describe('锁弹窗覆盖度(C1/C2 不回潮)', () => {
  for (const rel of SCREENS) {
    it(`❗${rel} 接上了 FPLockDialogs 且四个绑定齐`, () => {
      // ⚠ 先剥掉注释再断言。源码文本断言看不见「被注释掉」—— 把整行包进 <!-- --> 后
      //    这些字面量仍在文件里,断言照样绿(2026-08-30 做破坏验证时实测撞到)。
      //    剥掉之后,删掉、注释掉两种失效模式才都挡得住。
      const s = stripComments(readFileSync(join(__dirname, rel), 'utf8'))
      expect(s.includes('<FPLockDialogs'), `${rel} 没挂 FPLockDialogs —— 别人占锁时按钮是死的`).toBe(true)
      expect(/:locked-by="lockedBy"/.test(s), `${rel} 没绑 locked-by —— 接管抽屉永远不开`).toBe(true)
      expect(/:evicted-by="evictedBy"/.test(s), `${rel} 没绑 evicted-by —— 被踢时静默`).toBe(true)
      expect(/:scope="lockScope\(\)"/.test(s), `${rel} 没透传 scope —— 共占锁那句话说不出来`).toBe(true)
      expect(/@taken="onTaken"/.test(s), `${rel} 没接 taken —— 接管成功后进不了编辑态`).toBe(true)
    })

    it(`❗${rel} 的解构取了这四项`, () => {
      const s = stripComments(readFileSync(join(__dirname, rel), 'utf8'))
      for (const k of ['lockedBy', 'evictedBy', 'lockScope', 'onTaken']) {
        expect(new RegExp(`\\b${k}\\b`).test(s), `${rel} 解构里没有 ${k}`).toBe(true)
      }
    })
  }
})
