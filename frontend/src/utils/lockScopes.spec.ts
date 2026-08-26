import { describe, it, expect } from 'vitest'
import { S, NAV_SCOPE_PREFIX } from './lockScopes'

describe('编辑锁作用域表（CONCURRENCY-SPEC §3.1）', () => {
  describe('§3.2 出账链必须共占同一把月锁', () => {
    // ParamService.recalc() 内部就是 alloc.generate(ym) + billNotice.generate(ym)：
    // 这三个动作打的是**同一批快照表**（alloc_pool_result → alloc_loss_result → bill_notice，
    // 均为先删后插）。三屏各锁各的等于没锁 —— A 在参数页重算 2024-02、
    // B 同时在催缴单页点生成，两把不同的锁全放行。
    it('计费参数 / 公共电核算 / 催缴单 三屏的键完全相同', () => {
      const a = S.paramCenter(2024, 2)
      const b = S.poolLedger(2024, 2)
      const c = S.billNotices(2024, 2)

      expect(a).toBe(b)
      expect(b).toBe(c)
      expect(a).toBe('billing-chain:2024-02')
    })

    it('系数簿取的是**生效月**，不是催缴单页当前的账期', () => {
      // ⚠ §3.1 E 段点名的坑：生效月由窗口内独立选择，可以与页面 ym 不同。
      // 取错了就会锁住一个没人在改的月，而真正在改的那个月毫无保护。
      expect(S.coefBook(2024, 3)).toBe('billing-chain:2024-03')
      expect(S.coefBook(2024, 3)).not.toBe(S.billNotices(2024, 2))
    })
  })

  describe('月份补零 —— 键是字符串，2024-2 和 2024-02 是两把不同的锁', () => {
    it('个位月补零', () => {
      expect(S.paramCenter(2024, 2)).toBe('billing-chain:2024-02')
      expect(S.elecCost(2025, 6)).toBe('elec-cost:2025-06')
      expect(S.ledger(3, 2025, 6)).toBe('ledger:3:2025-06')
    })
  })

  describe('按年锁的屏不带月份', () => {
    it('园区抄表 / 光伏分栋抄表锁到年', () => {
      // §3.1 D：metersApi.list() 表档案全局无期，抽屉可任意补录历史月 —— 锁到月挡不住串写
      expect(S.meters(2025)).toBe('meters:2025')
      expect(S.pvMeter(2025)).toBe('pv-meter:2025')
    })

    it('充电桩按车型分锁（§3.3 已记残留风险：桩库是共享表）', () => {
      expect(S.cpMeter('car', 2025)).toBe('cp-meter:car:2025')
      expect(S.cpMeter('ebike', 2025)).not.toBe(S.cpMeter('car', 2025))
    })
  })

  describe('导航项 → 作用域前缀（侧栏圆点用）', () => {
    it('表里每个前缀都真的是某个作用域构造器会产出的', () => {
      // 这张表**会烂**：谁改了作用域模板却忘了改它，圆点就永远不亮 ——
      // 而且不报错、没人发现。这条测试是它唯一的护栏。
      const produced = [
        S.ledger(3, 2025, 6),
        S.paramCenter(2025, 6),
        S.meters(2025),
        S.pvMeter(2025),
        S.cpMeter('car', 2025),
        S.cpMeter('ebike', 2025),
        S.elecCost(2025, 6),
        S.report('is', 3, 2025, 6)!,
        S.report('bs', 3, 2025, 6)!,
        S.report('tb', 3, 2025, 6)!,
        S.pv(2025), S.elecSched(2025),
        S.charging(7, 2025), S.charging(8, 2025),
        S.utilities(13, 2025), S.utilities(14, 2025),
        S.salary(2025, 6), S.s10(1, 2025, 6),
        S.pnl('rent', 2025), S.pnl('elec', 2025), S.pnl('water', 2025),
        S.pnl('ops', 2025), S.pnl('expense', 2025),
      ]
      const covers = (prefix: string) => produced.some(
        (sc) => sc === prefix || sc.startsWith(prefix + ':') || sc.startsWith(prefix + '-'))

      for (const [nav, prefix] of Object.entries(NAV_SCOPE_PREFIX)) {
        expect(covers(prefix), `导航项「${nav}」的前缀 ${prefix} 已对不上任何作用域构造器`).toBe(true)
      }
    })
  })

  describe('三大报表', () => {
    it('按公司 + 期', () => {
      expect(S.report('is', 3, 2025, 6)).toBe('report:is:3:2025-06')
    })

    it('「全部汇总」视图不可写 → 没有锁', () => {
      // useFinStatementScreen 第 180 行 `if (... || isAll.value) return` —— 它根本存不了盘，
      // 给它一把锁只会平白挡住别人。
      expect(S.report('is', 'all', 2025, 6)).toBeNull()
    })

    it('期没选全时没有锁', () => {
      expect(S.report('bs', null, 2025, 6)).toBeNull()
      expect(S.report('bs', 3, 2025, null)).toBeNull()
    })
  })
})
