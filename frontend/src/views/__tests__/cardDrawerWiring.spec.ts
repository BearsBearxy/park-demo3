// src/views/__tests__/cardDrawerWiring.spec.ts
// S 档「卡片 → 只读行抽屉」这条动线的**接线**门禁。
//
// 出处(2026-09-20 对抗复查):附表12 的 `@row="rowDetail = $event"` 整行删掉,
// 四个 salary 相关 spec 共 47 条断言**全绿** —— 表组件 emit 了、抽屉组件自己也测了,
// 但没有一条测试把这两头连起来。手机上点卡什么都不发生,而那正是该建抽屉的全部理由。
//
// 为什么是源码级断言而不是 mount View:这两屏进表要先过「年份矩阵 → 选月」两层门,
// 把整条路走一遍只为验一行 v-on,成本远大于收益;而这条断言钉的是**两头都在**——
// 删掉任意一半(emit 绑定 / 抽屉挂载 / 表上的 @row-click)它立刻红,不是恒真。
// 同时钉住宽档不许被牵连:抽屉必须挂在 `v-if="rowDetail"` 上,rowDetail 只由 @row 赋值。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

/** 用 FPWideCards + 有只读行抽屉的屏:表组件 / 屏组件 / 抽屉组件 / 事件名 */
const WIRED = [
  { name: '附表12 工资明细', table: 'salary/SalaryTable.vue', view: 'salary/SalaryView.vue', drawer: 'SalaryRowDrawer' },
  { name: '附表11 电费成本', table: 'elec/ElecTable.vue',     view: 'elec/ElecView.vue',     drawer: 'ElecRowDrawer' },
  { name: '损益附表',        table: 'reports/pnl/PnlTable.vue', view: 'reports/pnl/PnlScheduleView.vue', drawer: 'PnlRowDrawer' },
]

describe('S 档卡片 → 只读行抽屉:两头都得在', () => {
  it.each(WIRED)('❗$name:卡片点击 → 某个 ref → 抽屉,三节缺一不可', ({ table, view, drawer }) => {
    const t = read(table)
    // 抽屉挂在表里(损益附表)还是屏里(工资 / 电费)都算数 —— 钉的是这条链接通,不是文件怎么分
    const both = t + '\n' + read(view)

    // ① 卡片上真的绑了 @row-click。卡片写死了 cursor:pointer 与 :active,
    //    不绑就是「按下去有反应、什么都不发生」——2026-09-20 复查报的正是这个。
    const tag = t.match(/<FPWideCards[\s\S]*?\/>/)?.[0]
    expect(tag, `${table} 里没找到 <FPWideCards>`).toBeTruthy()
    const bind = tag!.match(/@row-click="(?:emit\('(\w+)',\s*\$event\)|(\w+)\s*=\s*\$event)"/)
    expect(bind, `${table} 的卡片没绑 @row-click`).toBeTruthy()

    // ② 事件落到一个 ref 上。表里直接赋值的,ref 名就在绑定里;
    //    经 emit 转一手的,屏里必须有 `@<事件名>="<ref> = $event"`。
    const ref = bind![2] ?? both.match(new RegExp(`@${bind![1]}="(\\w+)\\s*=\\s*\\$event"`))?.[1]
    expect(ref, `${view} 没接住表抛上来的行(emit '${bind![1]}' 无人接)`).toBeTruthy()

    // ③ 抽屉被挂载,门控就是那个 ref;@close 把它清回 null(否则关不掉)。
    //    宽档这个 ref 恒 null —— 桌面点行本来就没有行为,抽屉不进 DOM。
    expect(both, `没 import ${drawer}`).toMatch(new RegExp(`import ${drawer} from`))
    // 挂载形态两种都算:`v-if="<ref>"`(工资 / 电费)或 `:row="<ref>"` 由抽屉自己判空
    // (损益附表:它的 v-if 是 cardMode,行为空时抽屉不渲)。钉的是抽屉确实吃这个 ref。
    expect(both, `${drawer} 没有引用 ${ref}`)
      .toMatch(new RegExp(`<${drawer}[\\s\\S]{0,240}?(?:v-if="${ref}"|:row="${ref}")`))
    expect(both, `${drawer} 没接 @close 清空 ${ref}`)
      .toMatch(new RegExp(`<${drawer}[\\s\\S]{0,240}?@close="${ref} = null"`))
  })

  it('❗反向:没有抽屉的屏不许留一个按下去什么都不发生的卡', () => {
    // 附表10 与科目余额表的卡是有去处的 —— 前者点开绑定抽屉(bindRow),
    // 后者整卡点击接管 ▸ 展开下级。月度台账点开的是既有的 LedgerTenantDrawer。
    // 这条断言钉住「每一处 <FPWideCards> 都绑了某个点击去处」,新增调用方漏绑会红。
    const CALLERS = [
      'ledger/LedgerWideTable.vue', 'sales-income/S10Table.vue', 'salary/SalaryTable.vue',
      'elec/ElecTable.vue', 'reports/pnl/PnlTable.vue', 'reports/trial-balance/TrialBalanceView.vue',
    ]
    for (const f of CALLERS) {
      const tag = read(f).match(/<FPWideCards[\s\S]*?\/>/)?.[0]
      expect(tag, `${f} 里没找到 <FPWideCards>`).toBeTruthy()
      expect(tag, `${f} 的卡片没有任何点击去处`).toMatch(/@row-click=/)
    }
  })
})
