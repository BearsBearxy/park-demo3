/**
 * 年表屏按月份行上锁(SIDEBAR-UX-REDESIGN §7.1 D18)。
 *
 * 附表6/7/8/11 与附13/14 是**年表屏**:一屏 12 个月的行,而审核是一张表 × 一个月。
 * 所以闸不能长在页头那颗编辑按钮上(那会连没审的月一起锁死),得落到行上。
 *
 * 四张表(PvTable / ChargingTable / ElecTable / UtilitiesTable)行类型各不相同,
 * 但都有 `acctMonth: 'YYYY-MM'`,判据只此一句 —— 各写一遍必漂移。
 */
export const rowLocked = (locked: Set<number> | undefined, acctMonth: string | null | undefined): boolean =>
  !!locked && !!acctMonth && locked.has(+acctMonth.slice(5, 7))

/** 锁住的行上那个图标的 tooltip。四张表同一句。 */
export const ROW_LOCK_TIP = '该月已审核 / 待审核 —— 撤销审核后才能改'
