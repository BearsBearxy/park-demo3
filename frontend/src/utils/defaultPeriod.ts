// 默认账期整体数据驱动(METRIC-SOURCE-SPEC §4)—— 八个按账期取数的屏共用。
// 病根(2026-08-18 审计立档证据第 4 条):这些屏过去只把 year snap 到 xxxApi.years() 的最新有数据年,
// month 却一直留在 `new Date().getMonth()+1`。数据到 2024、系统是 8 月 → 拼出 2024-08 这个
// **任何数据源里都不存在**的账期,用户打开就是空表。规范原文:「year 与 month 必须一起 snap,禁止分别决定」。
//
// 落地形态即规范 §4 写的那句「先取该屏数据源的 ym 全集 → 取最大者」:后端各域给了
// GET /api/<域>/months(返 'YYYY-MM' 升序全集),前端一个往返取 max。
// 中间一版曾用「12 个月各拉一次整月包只为读 .length」的探测法,首载请求从 2 涨到 13~14
// (/meters 一包 524KB → 6MB),与本次优化目标相反,已随 /months 端点上线整体删除。
//
// ⚠ 判据必须是该屏**真正消费的那份数据**的账期全集,不能拿"任何月都非空"的接口凑数:
//   /alloc/pools 的 rows 是 alloc_rule 全表左连当月快照,拿它判有无恒为 true,默认月会恒定落 12 月。
//   池屏/损耗屏因此各有专用的 /alloc/pool-months、/alloc/loss-months 直查快照表。
export interface Period { year: number; month: number }

/**
 * 从 'YYYY-MM' 全集取最后一个账期(后端 /months 端点的消费函数)。
 * 纯函数不发请求:零填充定宽,字典序即时间序,不用解析成 Date 再比 —— 也因此不依赖后端是否已排好序。
 * 空集 = null,调用方保留自己的当月默认(库里一条数据都没有时,要录第一笔只能从当月起)。
 */
export const latestPeriodOf = (yms: readonly string[]): Period | null => {
  const max = yms.reduce((a, b) => (b > a ? b : a), '')
  return max ? { year: +max.slice(0, 4), month: +max.slice(5, 7) } : null
}
