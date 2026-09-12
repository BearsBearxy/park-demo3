// src/nav/fpNav.ts — 导航单一事实源(50屏×4层)。源: app/shell.jsx FP_NAV(+预算对比/能源分析/园区抄表/公摊分摊/系统管理)。
// 数据层按动词四组(SIDEBAR-UX-REDESIGN §2.1):档案(静态) / 出账(每月工序:计费参数→园区抄表→公共电核算→楼栋损耗→催缴单)
//   / 记账(月｜年,按后端 DataHomeService.scheduleSources 的 monthly()/yearly() 分) / 导入。
// 带标题的组可折叠:SidebarPanel 按 section.title 派生展开态,接口不加字段(§3.2)。
// S21:「价目管理」/price-cfg 退役,由「计费参数」/params 取代(router 里 /price-cfg 重定向)。
// 2026-09-03(D4):「银行流水」/bank-flow 条目删除 —— 后端从没有这块数据,占位常驻是死 UI;router 里 /bank-flow 重定向到首页。
export interface NavItem { value: string; label: string; icon: string; kind: string }
export interface NavSection { title?: string; items: NavItem[] }
export interface NavLayer { id: string; label: string; short: string; icon: string; caption: string; home: string; sections: NavSection[] }

export const FP_NAV: NavLayer[] = [
  { id: 'data', label: '数据中心', short: '数据', icon: 'database', caption: '本月出账 · 记账 · 导入 · 档案', home: 'data-home', sections: [
    { items: [{ value: 'data-home', label: '本月出账', icon: 'calendar-check', kind: 'data-home' }] },
    { title: '档案', items: [
      { value: 'buildings', label: '楼栋管理', icon: 'building-2', kind: 'buildings' },
      { value: 'tenants', label: '租户管理', icon: 'users', kind: 'tenants' },
      // 合同管理从出账链移入档案(D7):它是静态档案,不是每月工序
      { value: 'contracts', label: '合同管理', icon: 'file-text', kind: 'contracts' } ] },
    { title: '出账 · 每月工序', items: [
      { value: 'params', label: '计费参数', icon: 'sliders-horizontal', kind: 'params' },
      { value: 'meters', label: '园区抄表', icon: 'gauge', kind: 'meters' },
      { value: 'alloc', label: '公共电核算', icon: 'share-2', kind: 'alloc' },
      { value: 'alloc-loss', label: '楼栋损耗', icon: 'trending-down', kind: 'allocLoss' },
      { value: 'bill-notices', label: '催缴单', icon: 'file-check-2', kind: 'billNotices' } ] },
    { title: '记账 · 按月', items: [
      { value: 'ledger', label: '月度台账', icon: 'book-open', kind: 'ledger' },
      { value: 'sales-income', label: '附表10 销售收入', icon: 'coins', kind: 'sales' },
      { value: 'salary', label: '附表12 工资明细', icon: 'wallet', kind: 'schedule12' } ] },
    { title: '记账 · 按年', items: [
      { value: 'pv-income', label: '附表6 光伏发电', icon: 'sun', kind: 'schedule6' },
      { value: 'car-charging', label: '附表7 汽车充电桩', icon: 'car', kind: 'schedule7' },
      { value: 'ebike-charging', label: '附表8 电动车充电桩', icon: 'bike', kind: 'schedule8' },
      { value: 'elec-cost', label: '附表11 电费成本', icon: 'zap', kind: 'schedule11' },
      // 办公·三期水电走 SchedYearGate(年门),归年组
      { value: 'utilities', label: '办公·三期水电', icon: 'plug', kind: 'utilities' } ] },
    { items: [{ value: 'import', label: '导入中心', icon: 'upload', kind: 'import' }] },
  ] },
  { id: 'reports', label: '账簿与报表', short: '报表', icon: 'book-marked', caption: '核算输出 · 单一事实来源', home: 'reports-home', sections: [
    { items: [{ value: 'reports-home', label: '报表中心', icon: 'layout-dashboard', kind: 'reports-home' }] },
    { title: '三大报表', items: [
      { value: 'income-statement', label: '利润表', icon: 'trending-up', kind: 'incomeStatement' },
      { value: 'balance-sheet', label: '资产负债表', icon: 'scale', kind: 'balanceSheet' },
      { value: 'trial-balance', label: '科目余额表', icon: 'table-2', kind: 'trialBalance' } ] },
    { title: '损益附表', items: [
      { value: 'rent-pnl', label: '附表1 租金损益', icon: 'home', kind: 'schedule5' },
      { value: 'elec-pnl', label: '附表2 用电损益', icon: 'zap', kind: 'schedule2' },
      { value: 'water-pnl', label: '附表3 用水损益', icon: 'droplets', kind: 'water' },
      { value: 'ops-pnl', label: '附表4 运管损益', icon: 'wrench', kind: 'opsPnl' },
      { value: 'expense-pnl', label: '附表5 费用支出', icon: 'banknote', kind: 'expense' } ] },
    { items: [{ value: 'reconciliation', label: '收入核对', icon: 'git-compare', kind: 'recon' }] },
  ] },
  { id: 'analysis', label: '经营分析', short: '分析', icon: 'pie-chart', caption: '决策视图 · 园区 / 租户 / 管理公司 三维', home: 'cockpit', sections: [
    { items: [
      { value: 'cockpit', label: '经营驾驶舱', icon: 'gauge', kind: 'ana' },
      // 异常提醒中心升到第 2 行(SIDEBAR-UX-REDESIGN §2.3):高管第二眼就该看到哪里不对,不该压在第 19 行
      { value: 'anomaly', label: '异常提醒中心', icon: 'bell-ring', kind: 'ana' } ] },
    { title: '园区维度', items: [
      { value: 'park', label: '出租与楼栋', icon: 'building-2', kind: 'ana' },
      { value: 'park-energy', label: '园区能耗', icon: 'zap', kind: 'ana' } ] },
    { title: '租户维度', items: [
      { value: 'tenant-energy', label: '用能与缴费', icon: 'activity', kind: 'ana' },
      { value: 'tenant-portfolio', label: '结构与续约', icon: 'users', kind: 'ana' },
      // design-boards T8/T9:选中单个租户,看它在同类(同期区在租合同)里的位置——与上面两屏的
      // 组合层视角(全体租户分布/结构)不是同一个主语,新建屏而不是加卡(理由见 board-peer.txt 对应 plan)
      { value: 'tenant-peer', label: '租户对标', icon: 'git-compare', kind: 'ana' } ] },
    { title: '管理公司维度', items: [
      { value: 'fin-pnl', label: '利润表分析', icon: 'bar-chart-3', kind: 'ana' },
      { value: 'fin-balance', label: '资产负债分析', icon: 'scale', kind: 'ana' },
      { value: 'fin-cashflow', label: '现金流量分析', icon: 'wallet', kind: 'ana' },
      { value: 'fin-expense', label: '费用与报销', icon: 'receipt', kind: 'ana' } ] },
    { title: '经营专题', items: [
      { value: 'churn', label: '租户流失预警', icon: 'siren', kind: 'ana' },
      { value: 'expiry', label: '到期墙与续约', icon: 'calendar-clock', kind: 'ana' },
      { value: 'breakeven', label: '盈亏平衡与敏感性', icon: 'scale-3d', kind: 'ana' },
      { value: 'budget', label: '预算对比', icon: 'target', kind: 'ana' },
      { value: 'pnl-analysis', label: '损益附表分析', icon: 'layers', kind: 'pnlAnalysis' } ] },
    { title: '能源专题', items: [
      { value: 'pv-roi', label: '光伏投资回收', icon: 'sun', kind: 'pvRoi' },
      // 分栋抄表分析独立成屏(PV-ANALYSIS-SPEC §01):与 pv-roi 两套数据源、两套时间维、两套期间语义;图标用表格与 sun 分开
      { value: 'pv-meter-analysis', label: '光伏分栋分析', icon: 'table-2', kind: 'ana' },
      { value: 'elec-analysis', label: '电费成本分析', icon: 'zap', kind: 'ana' },
      { value: 'charging-analysis', label: '充电桩分析', icon: 'plug', kind: 'ana' } ] },
  ] },
  // 第 4 层不进 navLayers:可见性直接跟 system:view 走(RBAC-SPEC §4),无权即整层不显示。
  { id: 'system', label: '系统管理', short: '系统', icon: 'settings', caption: '账号与权限 · 仅管理员可见', home: 'sys-users', sections: [
    { items: [
      { value: 'sys-users', label: '用户管理', icon: 'users', kind: 'system' },
      { value: 'sys-roles', label: '角色权限', icon: 'shield-check', kind: 'system' },
      // P2:计费参数 / 导入 / 账号与角色三张来源表 union 的只读时间线(RBAC-SPEC §7)
      { value: 'sys-logs', label: '操作日志', icon: 'scroll-text', kind: 'system' } ] },
  ] },
]

export interface RouteMeta { value: string; layer: string; layerLabel: string; layerIcon: string; page: string; icon: string; kind: string }
/** 全部屏 + 所属层;`group` 是所在带标题组的标题(无标题组为 undefined),派生字段,只给命令面板搜索用,fpBuildRoutes 不吃。 */
export function fpAllPages(): (NavItem & { layer: string; layerLabel: string; layerIcon: string; group?: string })[] {
  return FP_NAV.flatMap(L => L.sections.flatMap(s => s.items.map(it => ({ ...it, layer: L.id, layerLabel: L.label, layerIcon: L.icon, group: s.title }))))
}
export function fpFindLayer(value: string): NavLayer { return FP_NAV.find(L => L.sections.some(s => s.items.some(it => it.value === value))) ?? FP_NAV[0] }
export function fpBuildRoutes(): Record<string, RouteMeta> {
  const map: Record<string, RouteMeta> = {}
  for (const p of fpAllPages()) map[p.value] = { value: p.value, layer: p.layer, layerLabel: p.layerLabel, layerIcon: p.layerIcon, page: p.label, icon: p.icon, kind: p.kind }
  return map
}
