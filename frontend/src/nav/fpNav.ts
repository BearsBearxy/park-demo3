// src/nav/fpNav.ts — 导航单一事实源(49屏×4层)。源: app/shell.jsx FP_NAV(+预算对比/能源分析/园区抄表/公摊分摊/系统管理)。
// 数据层按业务时序三组(BILL-FORWARD 第0刀):档案(静态) → 出账链(应收派生:合同→计费参数→园区抄表→公共电核算→楼栋损耗→催缴单,新屏落此) → 实际数(事后录入,与出账链对账)。
// S21:「价目管理」/price-cfg 退役,由「计费参数」/params 取代(router 里 /price-cfg 重定向)。
export interface NavItem { value: string; label: string; icon: string; kind: string }
export interface NavSection { title?: string; items: NavItem[] }
export interface NavLayer { id: string; label: string; short: string; icon: string; caption: string; home: string; sections: NavSection[] }

export const FP_NAV: NavLayer[] = [
  { id: 'data', label: '数据中心', short: '数据', icon: 'database', caption: '录入与维护 · 数据进来的地方', home: 'data-home', sections: [
    { items: [{ value: 'data-home', label: '数据中心首页', icon: 'layout-dashboard', kind: 'data-home' }] },
    { title: '主数据', items: [
      { value: 'buildings', label: '楼栋管理', icon: 'building-2', kind: 'buildings' },
      { value: 'tenants', label: '租户管理', icon: 'users', kind: 'tenants' } ] },
    { title: '出账链 · 应收派生', items: [
      { value: 'contracts', label: '合同管理', icon: 'file-text', kind: 'contracts' },
      { value: 'params', label: '计费参数', icon: 'sliders-horizontal', kind: 'params' },
      { value: 'meters', label: '园区抄表', icon: 'gauge', kind: 'meters' },
      { value: 'alloc', label: '公共电核算', icon: 'share-2', kind: 'alloc' },
      { value: 'alloc-loss', label: '楼栋损耗', icon: 'trending-down', kind: 'allocLoss' },
      { value: 'bill-notices', label: '催缴单', icon: 'file-check-2', kind: 'billNotices' } ] },
    { title: '实际数 · 事后录入', items: [
      { value: 'ledger', label: '月度台账', icon: 'book-open', kind: 'ledger' },
      { value: 'pv-income', label: '附表6 光伏发电', icon: 'sun', kind: 'schedule6' },
      { value: 'car-charging', label: '附表7 汽车充电桩', icon: 'car', kind: 'schedule7' },
      { value: 'ebike-charging', label: '附表8 电动车充电桩', icon: 'bike', kind: 'schedule8' },
      { value: 'sales-income', label: '附表10 销售收入', icon: 'coins', kind: 'sales' },
      { value: 'elec-cost', label: '附表11 电费成本', icon: 'zap', kind: 'schedule11' },
      { value: 'salary', label: '附表12 工资明细', icon: 'wallet', kind: 'schedule12' },
      { value: 'utilities', label: '办公·三期水电', icon: 'plug', kind: 'utilities' },
      { value: 'bank-flow', label: '银行流水', icon: 'landmark', kind: 'placeholder' } ] },
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
    { items: [{ value: 'cockpit', label: '经营驾驶舱', icon: 'gauge', kind: 'ana' }] },
    { title: '园区维度', items: [
      { value: 'park', label: '出租与楼栋', icon: 'building-2', kind: 'ana' },
      { value: 'park-energy', label: '园区能耗', icon: 'zap', kind: 'ana' } ] },
    { title: '租户维度', items: [
      { value: 'tenant-energy', label: '用能与缴费', icon: 'activity', kind: 'ana' },
      { value: 'tenant-portfolio', label: '结构与续约', icon: 'users', kind: 'ana' } ] },
    { title: '管理公司维度', items: [
      { value: 'fin-pnl', label: '利润表分析', icon: 'bar-chart-3', kind: 'ana' },
      { value: 'fin-balance', label: '资产负债分析', icon: 'scale', kind: 'ana' },
      { value: 'fin-cashflow', label: '现金流量分析', icon: 'wallet', kind: 'ana' },
      { value: 'fin-expense', label: '费用与报销', icon: 'receipt', kind: 'ana' } ] },
    { title: '专题分析', items: [
      { value: 'churn', label: '租户流失预警', icon: 'siren', kind: 'ana' },
      { value: 'expiry', label: '到期墙与续约', icon: 'calendar-clock', kind: 'ana' },
      { value: 'breakeven', label: '盈亏平衡与敏感性', icon: 'scale-3d', kind: 'ana' },
      { value: 'pnl-analysis', label: '损益附表分析', icon: 'layers', kind: 'pnlAnalysis' },
      { value: 'budget', label: '预算对比', icon: 'target', kind: 'ana' },
      { value: 'pv-roi', label: '光伏投资回收', icon: 'sun', kind: 'pvRoi' },
      { value: 'elec-analysis', label: '电费成本分析', icon: 'zap', kind: 'ana' },
      { value: 'charging-analysis', label: '充电桩分析', icon: 'plug', kind: 'ana' } ] },
    { title: '监控', items: [{ value: 'anomaly', label: '异常提醒中心', icon: 'bell-ring', kind: 'ana' }] },
  ] },
  // 第 4 层不进 navLayers:可见性直接跟 system:view 走(RBAC-SPEC §4),无权即整层不显示。
  // 「操作日志」是 P2,本轮不建屏也不放导航项 —— 放了就是个必然 404 的入口。
  { id: 'system', label: '系统管理', short: '系统', icon: 'settings', caption: '账号与权限 · 仅管理员可见', home: 'sys-users', sections: [
    { items: [
      { value: 'sys-users', label: '用户管理', icon: 'users', kind: 'system' },
      { value: 'sys-roles', label: '角色权限', icon: 'shield-check', kind: 'system' } ] },
  ] },
]

export interface RouteMeta { value: string; layer: string; layerLabel: string; layerIcon: string; page: string; icon: string; kind: string }
export function fpAllPages(): (NavItem & { layer: string; layerLabel: string; layerIcon: string })[] {
  return FP_NAV.flatMap(L => L.sections.flatMap(s => s.items.map(it => ({ ...it, layer: L.id, layerLabel: L.label, layerIcon: L.icon }))))
}
export function fpFindLayer(value: string): NavLayer { return FP_NAV.find(L => L.sections.some(s => s.items.some(it => it.value === value))) ?? FP_NAV[0] }
export function fpBuildRoutes(): Record<string, RouteMeta> {
  const map: Record<string, RouteMeta> = {}
  for (const p of fpAllPages()) map[p.value] = { value: p.value, layer: p.layer, layerLabel: p.layerLabel, layerIcon: p.layerIcon, page: p.label, icon: p.icon, kind: p.kind }
  return map
}
