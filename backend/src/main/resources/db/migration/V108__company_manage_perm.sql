-- 第 15 权限点 company:manage(2026-08-24 拍板):新增/删除记账公司=建删账册(BOOK-WORKBENCH §9)。
-- 公司改名与收款账户仍归 master:edit;建司删司是更重的动作单独放权。
-- 只授内建 admin;其他角色由主管在角色屏自行勾选(权限矩阵按 Perm.META 自动渲染第 15 行)。
INSERT INTO auth_role_perm (role_id, perm)
SELECT id, 'company:manage' FROM auth_role WHERE code = 'admin'
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = auth_role.id AND p.perm = 'company:manage');
