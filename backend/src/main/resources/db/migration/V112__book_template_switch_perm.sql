-- 第 17 权限点 book-template:switch(2026-08-26 拍板):更换账册版本。
-- 与第 16 点 book-template:edit 分开:换一套别人的列、和在本月微调列名,是两种风险。
-- 只授内建 admin;其他角色由主管在角色屏勾选(矩阵按 Perm.META 自动渲染第 17 行)。
INSERT INTO auth_role_perm (role_id, perm)
SELECT id, 'book-template:switch' FROM auth_role WHERE code = 'admin'
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = auth_role.id AND p.perm = 'book-template:switch');
