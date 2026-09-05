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

  /**
   * 账册模板（第 16/17 权限点 book-template:edit / :switch）。
   *
   * **锁到 (册, 年, 月)** —— 跟着 pin 键走。
   *
   * ⚠ 2026-08-27 改过口径。初版锁到**账册**，理由写的是「改模板会改动这本账册所有月份的
   *   列结构」。那句话在 PR #9（模板归并成一条全局链 + pin 按月独立，V110/V111/V112）之后
   *   **不再成立**：设计 P4 白纸黑字「改完存成新版本，只把当前月切到新版；
   *   同册其他月份、其他册一律不动」，面板自己的头部文案也是这么写的。
   *
   *   真正会被两个人抢的是**那一个月的 pin**：`booksApi.saveTemplate(bookId, def, y, m)`
   *   与 `booksApi.pin(bookId, ver, y, m)` 两个写口带的都是这三个键。
   *   继续锁到册就是多锁 —— A 改 3 月模板会平白挡住 B 改 7 月，而它们根本不碰同一份东西。
   *
   *   链本身（版本号 链尾+1、只追加不改写）不进锁：P4 明说版本就是「一套列的快照」，
   *   两条并行的快照是**有意允许**的，不是丢失更新。
   *
   * ⚠ 2026-08-29 再改一次:**screen 进键**。面板长在两屏里（月度台账 / 附表10），
   *   而 `NAV_SCOPE_PREFIX` 要靠前缀把「谁在这屏里编辑」分开。裸 `book-template` 前缀
   *   跨两屏 —— 台账某公司的模板被改，附表10 的圆点也跟着亮。
   *   分段之后两屏各注册各的（`book-template:ledger` / `book-template:s10`），互不误伤。
   *   键是内存态标识符、不落库（见本文件顶部），后端把 scope 当不透明字符串（LockService
   *   只拿它当 map 键，不解析），所以改分段**零迁移**。
   */
  bookTemplate: (screen: 'ledger' | 's10', bookId: number, year: number, month: number) =>
    `book-template:${screen}:${bookId}:${year}-${pad2(month)}`,

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
 *   而且不报错、没人发现。lockScopes.spec.ts 里那两条护栏（正向：每个前缀都对得上某个
 *   构造器；反向：每个构造器都被某个前缀覆盖）是它仅有的保障。
 *
 * ⚠ **一个导航项可以有多个锁根**（2026-08-29 放开）。四个屏底下各装着两本账
 *   （报送台账走 `sched:*`，运营账走 `pv-meter:*` / `cp-meter:*` / `elec-cost:*`），
 *   改前这里是 `Record<string, string>`，一对一，那三条**没有任何办法登记进去** ——
 *   于是有人正在改分栋抄表，侧栏圆点永远不亮。这不是有人忘了填，是类型表达不了。
 *   反向护栏就是为了让下一个漏登记的构造器当场变红。
 */
export const NAV_SCOPE_PREFIX: Record<string, string | string[]> = {
  // 账册模板面板长在这两屏里,自带第 16 权限点与独立的锁 —— 只握模板锁的人
  // (没进屏的编辑模式)改前不会让圆点亮。反向护栏 2026-08-29 抓到的。
  // 键里带 screen,所以两屏各注册各的,不会互相误亮。
  'ledger': ['ledger', 'book-template:ledger'],
  'params': 'billing-chain',
  'alloc': 'billing-chain',
  // reconciliation / import / alloc-loss 三屏没有编辑锁(纯查看/仅登记,楼栋损耗全文件无
  // useEditMode / 无 acquire),不补键 —— 补了是一个永远不亮的键(2026-09-06 复查撤回 alloc-loss)
  'bill-notices': 'billing-chain',
  'meters': 'meters',
  'pv-income': ['sched:pv', 'pv-meter'],
  'car-charging': ['sched:charging:7', 'cp-meter:car'],
  'ebike-charging': ['sched:charging:8', 'cp-meter:ebike'],
  'sales-income': ['sched:s10', 'book-template:s10'],
  'elec-cost': ['sched:elec', 'elec-cost'],
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

/**
 * 这把锁为什么会同时锁住好几个屏 —— 给用户看的一句话。
 *
 * 出账链那把 `billing-chain` 一锁锁三屏（§3.2：它们打的是同一批快照表）。
 * 不解释的话用户会看到「计费参数 / 公共电核算 / 催缴单 同时亮红点」而莫名其妙 ——
 * 用户 2026-08-26 原话：「莫名其妙」。
 */
export function scopeNote(scope: string | null | undefined): string | null {
  if (!scope) return null
  if (scope.startsWith('billing-chain:')) {
    return '出账链三屏（计费参数 · 公共电核算 · 催缴单）与系数簿共用同一把月锁 —— '
         + '它们改的是同一批出账快照，锁住一个就是锁住四个'
  }
  return null
}

/**
 * 从锁 scope 里抠出期。scope 一律 `模块:限定:期` 冒号分段(见本文件头注释):
 *   billing-chain:2025-06 → '2025-06'   meters:2025 → '2025'
 *   ledger:3:2025-06     → '2025-06'   report:is:1:2025-06 → '2025-06'
 *   book-template:ledger:7:2025-06 → '2025-06'   无期 → null
 * ⚠ sched:s10 一个前缀两种粒度(月锁 …:2025-06 与年锁 …:2025 并存,S.s10 / S.s10Year),
 *   这里**照实返回**,不把年补成月 —— periodLink 的 p 本就允许只有年(nav/deepLink.ts)。
 */
export function scopePeriod(scope: string | null | undefined): string | null {
  if (!scope) return null
  const last = scope.slice(scope.lastIndexOf(':') + 1)
  return /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(last) ? last : null
}

/**
 * 反查这把锁属于哪一屏。边界规则与 presence.editorsUnder 逐字同形(=== p 或 p+':' 或 p+'-' 开头)。
 * ⚠ 一把锁可命中多个 nav —— `billing-chain` 底下有 params / alloc / bill-notices 三屏,
 *   它们共用一把月锁(spec §3.3)。裁定:**取 NAV_SCOPE_PREFIX 声明序的第一个**,
 *   这样「谁在编辑」的 chip 有一个稳定去处,而不是随 Object.keys 顺序漂。
 */
export function navOfScope(scope: string | null | undefined): string | null {
  if (!scope) return null
  for (const [nav, pre] of Object.entries(NAV_SCOPE_PREFIX)) {
    const ps = Array.isArray(pre) ? pre : [pre]
    if (ps.some(p => scope === p || scope.startsWith(p + ':') || scope.startsWith(p + '-'))) return nav
  }
  return null
}
