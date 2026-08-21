// 合同状态的唯一事实源(METRIC-SOURCE-SPEC §1「一个判断只有一处实现」)。
//
// 2026-08-20 抽出。此前 MAP 内联在 FPContractStatus.vue 里,分析层够不着,于是
// TenantPortfolioView 自己又写了一套 —— 写反了:已到期给灰、已终止给红,与权威**正好对调**。
// 用户在合同管理看到「已到期=红(该跟进)/已终止=灰(正常收尾)」,切到租户组合分析变成反的,
// 会据此判定「已终止那批出了问题」去追查,而真正该跟进的已到期被灰色淡化。
// 这是本轮审计里唯一一条会让用户**读出错误业务结论**的颜色问题,故收敛到一处。
//
// label 同时收敛三套叫法:执行中/生效中/在租 → 执行中;草稿/待入驻 → 草稿;到期→已到期;终止→已终止。
export type ContractTone = 'neutral' | 'blue' | 'orange' | 'red' | 'slate'

export const CONTRACT_STATUS: Record<string, { tone: ContractTone; label: string }> = {
  draft: { tone: 'neutral', label: '草稿' },
  future: { tone: 'neutral', label: '未生效' }, // 已签但起租日未到(后端 effectiveStatus,2026-07-28)
  active: { tone: 'blue', label: '执行中' },
  expiring: { tone: 'orange', label: '即将到期' },
  expired: { tone: 'red', label: '已到期' },
  terminated: { tone: 'neutral', label: '已终止' },
  renewed: { tone: 'slate', label: '已续签' }, // 灰蓝:正常被新一期取代,区别于 terminated 的中性灰
}

/** tone → 实心色。与 ds/Badge.vue TONES[tone].dot 同值 —— 图表/进度条要的是实心色,
 *  Badge 要的是「点+底+字」三件套,共用 tone 名而非共用样式对象,避免把 Badge 的 fill/text 拖进图表。 */
export const CONTRACT_TONE_COLOR: Record<ContractTone, string> = {
  neutral: 'var(--ink-500)',
  blue: 'var(--hue-blue)',
  orange: 'var(--hue-orange)',
  red: 'var(--hue-red)',
  slate: 'var(--fill-slate)',
}

export const contractStatusOf = (s: string) =>
  CONTRACT_STATUS[s] ?? { tone: 'neutral' as const, label: s }

export const contractStatusColor = (s: string) => CONTRACT_TONE_COLOR[contractStatusOf(s).tone]
