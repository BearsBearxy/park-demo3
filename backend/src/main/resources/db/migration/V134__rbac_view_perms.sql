-- RBAC-SPEC v3「读写分开」(2026-10-04 用户拍板,推翻 v2 拍板 #8「读全开」与 #11「工资全开」)。
-- 9 个查看点:master contract param meter billing entry salary report analysis 各一个 :view。
-- 编辑隐含同组查看在 UserPermissionCache 装载快照时展开,**不落库**;这里只种「查看」本身。
--
-- 迁移前每个账号都能读全站。迁移后「现有角色照旧能看」,只收紧两处:
--   ① 工资:salary:view 只给 admin、finance_manager(拍板 #11 推翻)
--   ② 园区股东:只给 analysis:view + report:view,导航层加上报表(拍板 #8 推翻)
-- 自建角色与内置角色同等对待(第 ① 段不看 builtin)。
--
-- 幂等:INSERT 带 NOT EXISTS(照 V108 / V109 / V112 / V124 的形状),UPDATE 是定值;整份重放一遍什么都不该变。

-- ① 除园区股东外的每个角色:8 个查看点,工资除外
INSERT INTO auth_role_perm (role_id, perm)
SELECT r.id, v.p FROM auth_role r, (
            SELECT 'master:view' p UNION ALL SELECT 'contract:view' UNION ALL SELECT 'param:view'
  UNION ALL SELECT 'meter:view'    UNION ALL SELECT 'billing:view'  UNION ALL SELECT 'entry:view'
  UNION ALL SELECT 'report:view'   UNION ALL SELECT 'analysis:view'
) v
WHERE r.code <> 'shareholder'
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm x WHERE x.role_id = r.id AND x.perm = v.p);

-- ② 工资明细只给系统管理员与财务主管。财务专员仍有 entry:edit(能导入工资),但看不到内容;
--    写接口的回包也按 salary:view 收(SalaryService.visible)
INSERT INTO auth_role_perm (role_id, perm)
SELECT r.id, 'salary:view' FROM auth_role r
WHERE r.code IN ('admin', 'finance_manager')
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm x WHERE x.role_id = r.id AND x.perm = 'salary:view');

-- ③ 园区股东:经营分析 + 报表。分析独立放行,不依赖各模块查看权(v1 的空壳问题)
INSERT INTO auth_role_perm (role_id, perm)
SELECT r.id, v.p FROM auth_role r, (SELECT 'analysis:view' p UNION ALL SELECT 'report:view') v
WHERE r.code = 'shareholder'
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm x WHERE x.role_id = r.id AND x.perm = v.p);

UPDATE auth_role SET nav_layers = 'analysis,reports' WHERE code = 'shareholder';

-- ④ 角色备注跟着改:角色屏与账号的角色选择器原样显示它,V101 / V124 种的几句在 V134 之后不成立了。
--    只改没被客户动过的原值(WHERE remark = 原句),重放时原句已不在,什么都不改
UPDATE auth_role SET remark = '只读;导航有经营分析、账簿与报表'
WHERE code = 'shareholder' AND remark = '只读;导航只有经营分析';
UPDATE auth_role SET remark = '只审不录:能看除工资外的各模块,不能改'
WHERE code = 'reviewer' AND remark = '只审不录:只有 review:approve,零 :edit';
UPDATE auth_role SET remark = '只读;除工资明细外都能看'
WHERE code IN ('gm', 'viewer') AND remark = '只读;导航全部可见';
