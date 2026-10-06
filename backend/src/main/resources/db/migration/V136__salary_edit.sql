-- 工资录入 salary:edit(用户 2026-10-04 拍板「按你推荐」,RBAC-SPEC §11.8)。工资的写从 entry:edit 拆出来:
-- 挂 entry:edit 时,看不见工资(没有 salary:view)的财务专员照样能经导入中心往这张表里写。
--
-- 给谁:**同时有 entry:edit 与 salary:view** 的每个角色,内置与自建同等对待 —— 原来既能写工资又看得见的照旧能写;
-- 只有 entry:edit 的(种子里的财务专员)从此写不了工资。种子里命中的是 admin 与 finance_manager。
-- salary:edit 隐含 salary:view(UserPermissionCache 装载时展开,不落库),所以这里不另种查看。
--
-- 幂等:INSERT 带 NOT EXISTS(照 V134 的形状),UPDATE 只改原句;整份重放一遍什么都不该变。

INSERT INTO auth_role_perm (role_id, perm)
SELECT r.id, 'salary:edit' FROM auth_role r
WHERE EXISTS (SELECT 1 FROM auth_role_perm e WHERE e.role_id = r.id AND e.perm = 'entry:edit')
  AND EXISTS (SELECT 1 FROM auth_role_perm s WHERE s.role_id = r.id AND s.perm = 'salary:view')
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm x WHERE x.role_id = r.id AND x.perm = 'salary:edit');

-- 财务专员的角色备注跟着改:角色屏与账号的角色选择器原样显示它,「录入」在 V136 之后不再含工资。
-- 只改 V101 种的原句,客户改过的不动;重放时原句已不在,什么都不改
UPDATE auth_role SET remark = '录入/抄表/出账运行;不可改档案、合同、计费口径、工资'
WHERE code = 'finance_clerk' AND remark = '录入/抄表/出账运行;不可改档案、合同、计费口径';
