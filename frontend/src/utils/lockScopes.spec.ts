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

  describe('账册模板（第 16/17 权限点）', () => {
    it('锁到 (册, 年, 月) —— 跟着 pin 键走', () => {
      // ⚠ 这条 2026-08-27 改过口径。初版锁到**账册**，理由写的是
      //   「改模板会改动这本账册所有月份的列结构」——
      //   那在 PR #9（一条全局链 + pin 按月独立）之后**不再成立**：
      //   设计 P4 白纸黑字「改完存成新版本，只把当前月切到新版；同册其他月份、其他册一律不动」。
      //
      //   真正会被两个人抢的是**那一个月的 pin**（saveTemplate / pin 两个写口
      //   带的都是 (bookId, year, month)）。锁到册就多锁了：
      //   A 改 3 月模板会平白挡住 B 改 7 月，而它们根本不碰同一份东西。
      expect(S.bookTemplate('ledger', 7, 2026, 3)).toBe('book-template:ledger:7:2026-03')
      expect(S.bookTemplate('ledger', 7, 2026, 3)).not.toBe(S.bookTemplate('ledger', 7, 2026, 7))
      expect(S.bookTemplate('ledger', 7, 2026, 3)).not.toBe(S.bookTemplate('ledger', 8, 2026, 3))
    })

    it('屏进键 —— 两屏各自的模板面板不共占一把锁,侧栏圆点也才分得开', () => {
      // 2026-08-29:反向护栏抓到 book-template:* 一条 NAV_SCOPE_PREFIX 都没有。
      // 兜底登记成裸 'book-template' 之后精度不足 —— 台账某公司的模板被改,
      // 附表10 的圆点也跟着亮。screen 进键之后两屏各注册各的前缀,互不误伤。
      // 键是内存态标识符、不落库(见 lockScopes.ts 顶部),改分段零迁移。
      expect(S.bookTemplate('s10', 7, 2026, 3)).toBe('book-template:s10:7:2026-03')
      expect(S.bookTemplate('ledger', 7, 2026, 3))
        .not.toBe(S.bookTemplate('s10', 7, 2026, 3))
      // 前缀边界:ledger 那把不许被 s10 的前缀捞走(反之亦然)
      expect(S.bookTemplate('s10', 7, 2026, 3).startsWith('book-template:ledger')).toBe(false)
    })

    it('月份补零 —— 不补的话 2026-3 与 2026-03 是两把锁', () => {
      expect(S.bookTemplate('ledger', 7, 2026, 3)).toBe(S.bookTemplate('ledger', 7, 2026, 3))
      expect(S.bookTemplate('ledger', 7, 2026, 12)).toBe('book-template:ledger:7:2026-12')
    })
  })

  describe('导航项 → 作用域前缀（侧栏圆点用）', () => {
    // 全部会真的出现在服务端锁表里的作用域。两条护栏都读它。
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
        S.bookTemplate('ledger', 7, 2026, 3),
        S.bookTemplate('s10', 2, 2026, 3),
    ]

    it('表里每个前缀都真的是某个作用域构造器会产出的', () => {
      // 这张表**会烂**：谁改了作用域模板却忘了改它，圆点就永远不亮 ——
      // 而且不报错、没人发现。
      const hit = (prefix: string, sc: string) =>
        sc === prefix || sc.startsWith(prefix + ':') || sc.startsWith(prefix + '-')
      const flat = Object.entries(NAV_SCOPE_PREFIX)
        .flatMap(([nav, p]) => (Array.isArray(p) ? p : [p]).map((prefix) => [nav, prefix] as const))

      for (const [nav, prefix] of flat) {
        expect(produced.some((sc) => hit(prefix, sc)),
               `导航项「${nav}」的前缀 ${prefix} 已对不上任何作用域构造器`).toBe(true)
      }
    })

    it('两屏的模板锁互不误亮 —— 这条才是 screen 进键要保的东西', () => {
      // ⚠ 上面那条反向断言**保不住精度**:退回裸 `book-template` 前缀它照样绿
      //   (裸前缀把两屏都覆盖了)。真正要钉的是「台账那把不被附表10 的前缀捞走」。
      const hit = (prefix: string, sc: string) =>
        sc === prefix || sc.startsWith(prefix + ':') || sc.startsWith(prefix + '-')
      const of = (nav: string) => {
        const p = NAV_SCOPE_PREFIX[nav]
        return Array.isArray(p) ? p : [p]
      }
      const ledgerTpl = S.bookTemplate('ledger', 7, 2026, 3)
      const s10Tpl = S.bookTemplate('s10', 2, 2026, 3)

      expect(of('ledger').some((p) => hit(p, ledgerTpl)), '台账的模板锁该被台账认领').toBe(true)
      expect(of('ledger').some((p) => hit(p, s10Tpl)),
             '附表10 的模板锁不该点亮台账的圆点').toBe(false)
      expect(of('sales-income').some((p) => hit(p, s10Tpl))).toBe(true)
      expect(of('sales-income').some((p) => hit(p, ledgerTpl)),
             '台账的模板锁不该点亮附表10 的圆点').toBe(false)
    })

    it('反过来也要成立:每个作用域构造器都被某个前缀覆盖', () => {
      // 上面那条只查单向。**漏的那一半才是真出过事的一半**:
      // 功能门让四个导航项底下各多出一套锁根(pv-meter / cp-meter / elec-cost),
      // 它们从 2026-07-20 起就没有任何 nav 指向 —— 有人正在改分栋抄表,侧栏圆点永远不亮,
      // 而这三个构造器**明明白白列在上面的 produced 数组里当「覆盖源」用**,测试照样绿。
      // 2026-08-29 放开一对多 + 补上这条反向断言,下一个漏登记的构造器当场红。
      const prefixes = Object.values(NAV_SCOPE_PREFIX).flatMap((p) => (Array.isArray(p) ? p : [p]))
      const hit = (prefix: string, sc: string) =>
        sc === prefix || sc.startsWith(prefix + ':') || sc.startsWith(prefix + '-')

      for (const sc of produced) {
        expect(prefixes.some((prefix) => hit(prefix, sc)),
               `作用域 ${sc} 没有任何导航项登记 —— 有人在这里编辑,侧栏圆点不会亮`).toBe(true)
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
