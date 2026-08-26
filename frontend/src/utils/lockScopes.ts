/**
 * 编辑锁作用域表（CONCURRENCY-SPEC §3.1）——**全站唯一的一份**。
 *
 * 为什么要有这个文件，而不是各屏各拼各的字符串：§3.2 那条规则要求
 * 计费参数 / 公共电核算 / 催缴单 / 系数簿 **四个写面共占同一把锁**。
 * 靠四处字面量恰好写得一样来维持，是一种迟早会烂的约定 ——
 * 有人改了其中一处的格式，四把锁就变成两把，而**表现是「锁没生效」，不是报错**。
 * 放在这里，"它们相等" 由 lockScopes.spec.ts 钉死。
 */
const pad2 = (n: number) => String(n).padStart(2, '0')

/** 出账链共占的那把月锁。见 §3.2。 */
const billingChain = (year: number, month: number) => `billing-chain:${year}-${pad2(month)}`

export const S = {
  // ── 出账链：四个写面同一把锁（§3.2） ──
  paramCenter: billingChain,
  poolLedger: billingChain,
  billNotices: billingChain,
  /** ⚠ 传**生效月**，不是催缴单页当前账期 —— 生效月由窗口内独立选择，两者可以不同。 */
  coefBook: billingChain,

  // ── 按期锁 ──
  ledger: (companyId: number, year: number, month: number) =>
    `ledger:${companyId}:${year}-${pad2(month)}`,
  elecCost: (year: number, month: number) => `elec-cost:${year}-${pad2(month)}`,

  // ── 按年锁（§3.1 D：表档案全局无期，抽屉可任意补录历史月，锁到月挡不住串写） ──
  meters: (year: number) => `meters:${year}`,
  pvMeter: (year: number) => `pv-meter:${year}`,
  /** §3.3 已记残留风险：cp_station 是 car/ebike 共享表，分锁挡不住桩库层面的串写（已接受）。 */
  cpMeter: (vehicleType: string, year: number) => `cp-meter:${vehicleType}:${year}`,

  // ── 附表族（SchedHeader 7 屏） ──
  // ⚠ 每一条都在两处消费：页头的 :scope 与年份门的 :scope-of。写两遍字面量必然有一天不同步，
  //   而不同步的表现是「锁没生效」，不是报错。
  //
  // ⚠ 键一律是 `模块:限定:期` 的**冒号分段**形式。CONCURRENCY-SPEC §3.1 原文写的是
  //   `sched:utilities{no}:{year}`（数字与名字粘着），那样「按模块前缀找」就没法做 ——
  //   `sched:utilities` 匹配不上 `sched:utilities13:...`，除非放宽边界，
  //   而放宽边界会让 `sched:pv:2025` 误伤 `sched:pv:20251`。键是内存态标识符、不落库，
  //   改成分段零迁移。
  pv: (year: number) => `sched:pv:${year}`,
  /** ⚠ §3.1：clearImported(y) 跨 energy+basic 两类 → type 不得进键 */
  elecSched: (year: number) => `sched:elec:${year}`,
  charging: (no: number, year: number) => `sched:charging:${no}:${year}`,
  utilities: (no: number, year: number) => `sched:utilities:${no}:${year}`,
  salary: (year: number, month: number) => `sched:salary:${year}-${pad2(month)}`,
  salaryYear: (year: number) => `sched:salary:${year}`,
  s10: (phase: number | string, year: number, month: number) =>
    `sched:s10:${phase}:${year}-${pad2(month)}`,
  s10Year: (phase: number | string, year: number) => `sched:s10:${phase}:${year}`,
  /** 损益附表 1–5：pnlApi.save 是整年 clear+insert，园区全局、无公司维度 */
  pnl: (schedule: string, year: number) => `pnl:${schedule}:${year}`,

  /**
   * 三大报表。**「全部汇总」不可写 → 无锁**：useFinStatementScreen 里
   * `if (... || isAll.value) return` 让它根本存不了盘，给它一把锁只会平白挡住别人。
   */
  report: (stmt: string, companyId: number | 'all' | null, year: number, month: number | null) =>
    companyId === 'all' || companyId == null || month == null
      ? null
      : `report:${stmt}:${companyId}:${year}-${pad2(month)}`,
}

/**
 * 导航项 → 作用域前缀（侧栏 / 页签的小圆点用）。
 *
 * ⚠ 这张表**会烂**：谁改了上面的作用域模板却忘了改它，圆点就永远不亮 ——
 *   而且不报错、没人发现。lockScopes.spec.ts 里那条「每个前缀都对得上某个构造器」
 *   是它唯一的护栏。
 */
export const NAV_SCOPE_PREFIX: Record<string, string> = {
  'ledger': 'ledger',
  'params': 'billing-chain',
  'alloc': 'billing-chain',
  'bill-notices': 'billing-chain',
  'meters': 'meters',
  'pv-income': 'sched:pv',
  'car-charging': 'sched:charging:7',
  'ebike-charging': 'sched:charging:8',
  'sales-income': 'sched:s10',
  'elec-cost': 'sched:elec',
  'salary': 'sched:salary',
  'utilities': 'sched:utilities',
  'income-statement': 'report:is',
  'balance-sheet': 'report:bs',
  'trial-balance': 'report:tb',
  'rent-pnl': 'pnl:rent',
  'elec-pnl': 'pnl:elec',
  'water-pnl': 'pnl:water',
  'ops-pnl': 'pnl:ops',
  'expense-pnl': 'pnl:expense',
}
