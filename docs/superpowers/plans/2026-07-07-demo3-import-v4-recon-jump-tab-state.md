# Plan:导入 v4(同名合并+垃圾行过滤)+ 核对跳转深链 + Tab 状态保持(2026-07-07)

依据 spec:
- [2026-07-06-demo3-ledger-import-v2-design.md](../specs/2026-07-06-demo3-ledger-import-v2-design.md) §八/§九(v4)
- [2026-07-07-demo3-recon-jump-tab-state-design.md](../specs/2026-07-07-demo3-recon-jump-tab-state-design.md)

前置事实(全域对账 2026-07-07 结论):小附表×5/工资/三大报表/损益附表全对齐;台账仅 B2·1月万众宿舍同名双行 last-wins 丢调整行;附表10 库正确但文件含未标合计的合计行与 '0' 行(库内 2 条 '0' 已手清)。

## WP-A 导入 v4(纯前端)
- A1 `importHeaderMatch.ts`:matchByHeader 第5参 `opts?: { skipName?: (name: string) => boolean }`,收行处 name 命中即跳;导出 `isGarbageTenantName`(纯数字 或 /^\d{6}/ 开头)。缺省无过滤(办公水电月份列保命线)。
- A2 `importRegistry.ts`:台账 parseLedgerSheet 与 附表10(splitSections 调用链,读 importSections.ts 确认注入点)传入 isGarbageTenantName;台账段内同名合并(数值键相加、note 去重「；」拼接、__ 键取首行)。
- A3 测试:万众宿舍双行样例、'202510二期'/'0' 过滤、办公水电无过滤回归、既有全量。
- 验收:npm run test + typecheck 全绿。

## WP-B 核对跳转深链 + Tab 状态(纯前端)
- B1 `stores/tabs.ts`:epoch: Record<string,number>(内存态)+ epochOf(value) + openFresh(value,opts)(epoch++ 后走 open);close() 时 epoch++。单测。
- B2 `App.vue`:router-view 改 v-slot + `<keep-alive :max="10">`,key = 路由 value+':'+epochOf(充电桩7/8 兄弟路由防线靠 value 不同,不回归)。
- B3 `SidebarPanel.vue`:点击改 tabs.openFresh + router.push;TabStrip 点击语义不变(恢复缓存)。
- B4 `ReconWorkbench.vue` jump:改 openFresh(value,{pin:true}) + query(台账 {y,m,company,tenant};附表10 {y,m,phase,tenant});company=ledgerCards[0].companyName,phase=s10Cards[0].phase。
- B5 `LedgerView.vue`:onMounted 消费 query → 按名解析公司 → pickCompany/pickYear/pickMonth 链 → 定位;`LedgerWideTable.vue` 增 focusTenant prop(scrollIntoView center + 高亮闪烁 ~2s CSS)。
- B6 `S10View.vue`:消费 query(y/m/phase)→ 加载 → `S10Table.vue` 同款 focusTenant。
- B7 视图 KeepAlive 化注意:LedgerView/S10View 等有 onMounted 单次加载,缓存恢复 = 不重拉(spec 语义);onActivated 不加载(除非深链残留,深链靠 openFresh 新实例,无需 onActivated)。
- 验收:tabs 单测 + 全量测试 + typecheck;人工清单(spec §三)。

## 执行方式
两个 WP 文件不相交(A:utils;B:shell/stores/views),workflow 并行实现 → 双视角对抗复审(A 对账证据回放 / B 语义矩阵+全量回归)→ 主会话修复确认项 → 复测。
DB 收尾:修完后用户重导一次 台账测试.xlsx(列级 upsert 治愈万众宿舍两列);其余域无需动。
