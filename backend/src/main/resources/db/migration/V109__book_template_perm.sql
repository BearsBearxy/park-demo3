-- 第 16 权限点 book-template:edit(2026-08-24 拍板):账册模板编辑独立成点——
-- 模板入口移出页面编辑模式,面板内单独编辑门;查看历史版本(GET)全员可看。
-- 只授内建 admin;其他角色由主管在角色屏勾选(矩阵按 Perm.META 自动渲染第 16 行)。
INSERT INTO auth_role_perm (role_id, perm)
SELECT id, 'book-template:edit' FROM auth_role WHERE code = 'admin'
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = auth_role.id AND p.perm = 'book-template:edit');
