-- v4:权限细到菜单单项(用户 2026-10-09 拍板,RBAC-SPEC §15)。只增不删、幂等:旧键行保留(回滚到 0.32 时旧代码照常),
-- 新代码只认新键。空库(没有角色)什么都不插,整份重放一遍什么都不变。两条链都跑(老链 V1..V137 + common,起点链 V137 baseline + common)。
-- 启动时 config/LegacyPermBackfill 会把本文件正文原样再跑一遍:回滚期间在 0.32 存过的角色只剩旧键,升回来时补上新键。
-- 只用派生表,不建临时表:字面量跟着列的排序规则走,不会撞「排序规则不一致」。

-- ① 查看:角色在 v3 下能打开哪一屏(navAccess 的进屏门,编辑隐含的查看也算),就给那一屏的 :view
INSERT INTO auth_role_perm (role_id, perm)
SELECT DISTINCT p.role_id, CONCAT(g.scr, ':view')
FROM auth_role_perm p
JOIN (            SELECT 'master:view' AS k, 'master:view' AS v
  UNION ALL SELECT 'master:edit', 'master:view'          UNION ALL SELECT 'company:manage', 'master:view'
  UNION ALL SELECT 'contract:view', 'contract:view'      UNION ALL SELECT 'contract:edit', 'contract:view'
  UNION ALL SELECT 'param:view', 'param:view'            UNION ALL SELECT 'param-policy:edit', 'param:view'
  UNION ALL SELECT 'param-monthly:edit', 'param:view'
  UNION ALL SELECT 'meter:view', 'meter:view'            UNION ALL SELECT 'meter-master:edit', 'meter:view'
  UNION ALL SELECT 'meter-reading:edit', 'meter:view'
  UNION ALL SELECT 'billing:view', 'billing:view'        UNION ALL SELECT 'billing-run:edit', 'billing:view'
  UNION ALL SELECT 'billing-issue:edit', 'billing:view'
  UNION ALL SELECT 'entry:view', 'entry:view'            UNION ALL SELECT 'entry:edit', 'entry:view'
  UNION ALL SELECT 'book-template:edit', 'entry:view'    UNION ALL SELECT 'book-template:switch', 'entry:view'
  UNION ALL SELECT 'salary:view', 'salary:view'          UNION ALL SELECT 'salary:edit', 'salary:view'
  UNION ALL SELECT 'report:view', 'report:view'          UNION ALL SELECT 'report:edit', 'report:view'
  UNION ALL SELECT 'analysis:view', 'analysis:view'
  UNION ALL SELECT 'system:view', 'system:view'          UNION ALL SELECT 'system:edit', 'system:view'
) i ON i.k = p.perm
JOIN (            SELECT 'master:view' AS v, 'data-home' AS scr
  UNION ALL SELECT 'contract:view', 'data-home'  UNION ALL SELECT 'param:view', 'data-home'
  UNION ALL SELECT 'meter:view', 'data-home'     UNION ALL SELECT 'billing:view', 'data-home'
  UNION ALL SELECT 'entry:view', 'data-home'     UNION ALL SELECT 'salary:view', 'data-home'
  UNION ALL SELECT 'master:view', 'buildings'    UNION ALL SELECT 'master:view', 'tenants'
  UNION ALL SELECT 'contract:view', 'contracts'  UNION ALL SELECT 'param:view', 'params'
  UNION ALL SELECT 'meter:view', 'meters'
  UNION ALL SELECT 'billing:view', 'alloc'       UNION ALL SELECT 'billing:view', 'alloc-loss'
  UNION ALL SELECT 'billing:view', 'bill-notices'
  UNION ALL SELECT 'entry:view', 'ledger'        UNION ALL SELECT 'entry:view', 'sales-income'
  UNION ALL SELECT 'salary:view', 'salary'
  UNION ALL SELECT 'entry:view', 'pv-income'     UNION ALL SELECT 'meter:view', 'pv-income'
  UNION ALL SELECT 'entry:view', 'car-charging'  UNION ALL SELECT 'meter:view', 'car-charging'
  UNION ALL SELECT 'entry:view', 'ebike-charging' UNION ALL SELECT 'meter:view', 'ebike-charging'
  UNION ALL SELECT 'entry:view', 'elec-cost'     UNION ALL SELECT 'entry:view', 'utilities'
  UNION ALL SELECT 'master:view', 'import'       UNION ALL SELECT 'contract:view', 'import'
  UNION ALL SELECT 'param:view', 'import'        UNION ALL SELECT 'meter:view', 'import'
  UNION ALL SELECT 'billing:view', 'import'      UNION ALL SELECT 'entry:view', 'import'
  UNION ALL SELECT 'salary:view', 'import'       UNION ALL SELECT 'report:view', 'import'
  UNION ALL SELECT 'report:view', 'reports-home' UNION ALL SELECT 'report:view', 'income-statement'
  UNION ALL SELECT 'report:view', 'balance-sheet' UNION ALL SELECT 'report:view', 'trial-balance'
  UNION ALL SELECT 'report:view', 'rent-pnl'     UNION ALL SELECT 'report:view', 'elec-pnl'
  UNION ALL SELECT 'report:view', 'water-pnl'    UNION ALL SELECT 'report:view', 'ops-pnl'
  UNION ALL SELECT 'report:view', 'expense-pnl'  UNION ALL SELECT 'report:view', 'reconciliation'
  UNION ALL SELECT 'analysis:view', 'cockpit'    UNION ALL SELECT 'analysis:view', 'anomaly'
  UNION ALL SELECT 'analysis:view', 'park'       UNION ALL SELECT 'analysis:view', 'park-energy'
  UNION ALL SELECT 'analysis:view', 'tenant-energy' UNION ALL SELECT 'analysis:view', 'tenant-portfolio'
  UNION ALL SELECT 'analysis:view', 'tenant-peer' UNION ALL SELECT 'analysis:view', 'fin-pnl'
  UNION ALL SELECT 'analysis:view', 'fin-balance' UNION ALL SELECT 'analysis:view', 'fin-cashflow'
  UNION ALL SELECT 'analysis:view', 'fin-expense' UNION ALL SELECT 'analysis:view', 'churn'
  UNION ALL SELECT 'analysis:view', 'expiry'     UNION ALL SELECT 'analysis:view', 'breakeven'
  UNION ALL SELECT 'analysis:view', 'budget'     UNION ALL SELECT 'analysis:view', 'pnl-analysis'
  UNION ALL SELECT 'analysis:view', 'pv-roi'     UNION ALL SELECT 'analysis:view', 'pv-meter-analysis'
  UNION ALL SELECT 'analysis:view', 'elec-analysis' UNION ALL SELECT 'analysis:view', 'charging-analysis'
  UNION ALL SELECT 'system:view', 'sys-users'    UNION ALL SELECT 'system:view', 'sys-roles'
  UNION ALL SELECT 'system:view', 'sys-logs'
) g ON g.v = i.v
WHERE NOT EXISTS (SELECT 1 FROM auth_role_perm x WHERE x.role_id = p.role_id AND x.perm = CONCAT(g.scr, ':view'));

-- ② 动作:旧编辑键 → 新动作,只在这个角色已经有那一屏的 :view(上一步给的)时才给 —— 动作隐含本屏查看,
--    不加这个条件,没有那一屏查看的角色会凭空多看到一屏(15.3 标「需本屏查看」的几行)
INSERT INTO auth_role_perm (role_id, perm)
SELECT DISTINCT p.role_id, m.nk
FROM auth_role_perm p
JOIN (            SELECT 'master:edit' AS ok, 'buildings:edit' AS nk
  UNION ALL SELECT 'master:edit', 'tenants:edit'            UNION ALL SELECT 'master:edit', 'bill-notices:payee'
  UNION ALL SELECT 'company:manage', 'ledger:company'
  UNION ALL SELECT 'contract:edit', 'contracts:edit'
  UNION ALL SELECT 'param-policy:edit', 'params:edit'       UNION ALL SELECT 'param-policy:edit', 'alloc:pools'
  UNION ALL SELECT 'param-policy:edit', 'bill-notices:coef' UNION ALL SELECT 'param-policy:edit', 'elec-cost:price'
  UNION ALL SELECT 'param-monthly:edit', 'params:monthly'
  UNION ALL SELECT 'meter-master:edit', 'meters:archive'    UNION ALL SELECT 'meter-master:edit', 'pv-income:archive'
  UNION ALL SELECT 'meter-master:edit', 'car-charging:archive' UNION ALL SELECT 'meter-master:edit', 'ebike-charging:archive'
  UNION ALL SELECT 'meter-reading:edit', 'meters:edit'      UNION ALL SELECT 'meter-reading:edit', 'pv-income:reading'
  UNION ALL SELECT 'meter-reading:edit', 'car-charging:reading' UNION ALL SELECT 'meter-reading:edit', 'ebike-charging:reading'
  UNION ALL SELECT 'billing-run:edit', 'alloc:edit'         UNION ALL SELECT 'billing-run:edit', 'alloc-loss:edit'
  UNION ALL SELECT 'billing-run:edit', 'bill-notices:edit'  UNION ALL SELECT 'billing-run:edit', 'params:recalc'
  UNION ALL SELECT 'billing-issue:edit', 'bill-notices:issue'
  UNION ALL SELECT 'entry:edit', 'ledger:edit'              UNION ALL SELECT 'entry:edit', 'sales-income:edit'
  UNION ALL SELECT 'entry:edit', 'pv-income:edit'           UNION ALL SELECT 'entry:edit', 'car-charging:edit'
  UNION ALL SELECT 'entry:edit', 'ebike-charging:edit'      UNION ALL SELECT 'entry:edit', 'elec-cost:edit'
  UNION ALL SELECT 'entry:edit', 'utilities:edit'           UNION ALL SELECT 'entry:edit', 'import:edit'
  UNION ALL SELECT 'book-template:edit', 'ledger:template'  UNION ALL SELECT 'book-template:edit', 'sales-income:template'
  UNION ALL SELECT 'book-template:switch', 'ledger:version' UNION ALL SELECT 'book-template:switch', 'sales-income:version'
  UNION ALL SELECT 'report:edit', 'income-statement:edit'   UNION ALL SELECT 'report:edit', 'balance-sheet:edit'
  UNION ALL SELECT 'report:edit', 'trial-balance:edit'      UNION ALL SELECT 'report:edit', 'rent-pnl:edit'
  UNION ALL SELECT 'report:edit', 'elec-pnl:edit'           UNION ALL SELECT 'report:edit', 'water-pnl:edit'
  UNION ALL SELECT 'report:edit', 'ops-pnl:edit'            UNION ALL SELECT 'report:edit', 'expense-pnl:edit'
  UNION ALL SELECT 'report:edit', 'reconciliation:edit'     UNION ALL SELECT 'report:edit', 'park:edit'
  UNION ALL SELECT 'report:edit', 'anomaly:edit'            UNION ALL SELECT 'report:edit', 'fin-cashflow:edit'
  UNION ALL SELECT 'report:edit', 'churn:edit'              UNION ALL SELECT 'report:edit', 'breakeven:edit'
  UNION ALL SELECT 'report:edit', 'pv-roi:edit'
  UNION ALL SELECT 'system:edit', 'sys-users:edit'          UNION ALL SELECT 'system:edit', 'sys-roles:edit'
) m ON m.ok = p.perm
WHERE EXISTS (SELECT 1 FROM auth_role_perm s
              WHERE s.role_id = p.role_id AND s.perm = CONCAT(SUBSTRING_INDEX(m.nk, ':', 1), ':view'))
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm x WHERE x.role_id = p.role_id AND x.perm = m.nk);
