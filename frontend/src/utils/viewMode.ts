// 一屏两本账时，「上次看的是哪一本」记在本机。
//
// 三份规范（PV-METER-SPEC §2 / CP-METER-SPEC §2 / ELEC-COST-SPEC §4）都写着
// 「会话内记住选择（KeepAlive），刷新重进重选」，而**实现从落笔那天起就没做到**：
// 选择存屏内 ref，侧栏点击走 `tabs.openFresh()` 递增 epoch，KeepAlive 缓存当场作废。
// openFresh 的语义（2026-07-07 定）比那三份规范（07-18/19）早 11 天 —— 两份文档从没对过账。
//
// ⚠ 这里比规范多走一步：记**本机**而不是**会话**。理由是它与账期不同 ——
//   账期停在三个月前是危险的（你以为在看最新月），所以 `stores/screenPeriod` 只记会话内；
//   而「我是财务，我看报送台账」是一个**对每个人都不会变**的属性，
//   左栏又常驻显示着当前在哪一本，没有隐性状态，记住纯赚。
const key = (screen: string) => `fp-view-mode:${screen}`

/** 读。localStorage 是用户可改的，认不出的值一律退回 fallback。 */
export function loadViewMode<T extends string>(
  screen: string, allowed: readonly T[], fallback: T,
): T {
  try {
    const v = localStorage.getItem(key(screen))
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback   // 隐私模式等读不到就用默认，这只是便利
  }
}

export function saveViewMode(screen: string, mode: string): void {
  try { localStorage.setItem(key(screen), mode) } catch { /* 存不进就算了 */ }
}
